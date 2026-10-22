//! An in-memory QRTR for tests: a tiny name server (lookups, subscriptions,
//! NEW/DEL_SERVER), service endpoints that record requests, optional auto
//! replies, injected resets, and an open-socket count for leak checks.

use super::msg::{self, Msg};
use super::transport::{
    encode_ctrl, parse_ctrl, timed_out, Datagram, Transport, QRTR_PORT_CTL, QRTR_TYPE_DEL_SERVER,
    QRTR_TYPE_NEW_LOOKUP, QRTR_TYPE_NEW_SERVER,
};
use std::collections::{HashMap, VecDeque};
use std::io;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub const LOCAL_NODE: u32 = 1;

type Responder = Arc<dyn Fn(u32, &Msg) -> Option<Vec<u8>> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct Sent {
    pub sock: u64,
    pub svc: u32,
    pub msg: Msg,
}

#[derive(Default)]
struct SockState {
    q: VecDeque<(Vec<u8>, u32, u32)>,
    err: Option<i32>,
    shut: bool,
    peer_svc: Option<u32>,
}

#[derive(Default)]
struct NetState {
    next_id: u64,
    socks: HashMap<u64, SockState>,
    servers: HashMap<u32, (u32, u32)>,
    lookups: Vec<(u64, u32)>,
    sent: Vec<Sent>,
    fail_open: bool,
    responder: Option<Responder>,
}

pub struct FakeNet {
    st: Mutex<NetState>,
    cv: Condvar,
}

pub struct FakeTransport(Arc<FakeNet>);

pub struct FakeSock {
    net: Arc<FakeNet>,
    id: u64,
}

impl FakeNet {
    pub fn new() -> Arc<FakeNet> {
        Arc::new(FakeNet { st: Mutex::new(NetState::default()), cv: Condvar::new() })
    }

    pub fn transport(self: &Arc<Self>) -> FakeTransport {
        FakeTransport(self.clone())
    }

    fn notify(st: &mut NetState, cmd: u32, svc: u32, node: u32, port: u32) {
        let pkt = encode_ctrl(cmd, svc, 1, node, port);
        for &(sock, s) in &st.lookups {
            if s == svc {
                if let Some(ss) = st.socks.get_mut(&sock) {
                    ss.q.push_back((pkt.to_vec(), LOCAL_NODE, QRTR_PORT_CTL));
                }
            }
        }
    }

    pub fn add_server(&self, svc: u32, node: u32, port: u32) {
        let mut st = self.st.lock().unwrap();
        st.servers.insert(svc, (node, port));
        Self::notify(&mut st, QRTR_TYPE_NEW_SERVER, svc, node, port);
        self.cv.notify_all();
    }

    /// Listed for later lookups, but no NEW_SERVER notification.
    pub fn add_server_silently(&self, svc: u32, node: u32, port: u32) {
        self.st.lock().unwrap().servers.insert(svc, (node, port));
    }

    pub fn del_server(&self, svc: u32) {
        let mut st = self.st.lock().unwrap();
        if let Some((node, port)) = st.servers.remove(&svc) {
            Self::notify(&mut st, QRTR_TYPE_DEL_SERVER, svc, node, port);
        }
        self.cv.notify_all();
    }

    pub fn remove_server_silently(&self, svc: u32) {
        self.st.lock().unwrap().servers.remove(&svc);
    }

    /// ECONNRESET on every client socket talking to `svc`.
    pub fn reset_clients(&self, svc: u32) {
        let mut st = self.st.lock().unwrap();
        for ss in st.socks.values_mut() {
            if ss.peer_svc == Some(svc) {
                ss.err = Some(libc::ECONNRESET);
            }
        }
        self.cv.notify_all();
    }

    /// ENETRESET on every open socket, name-server watchers included.
    pub fn reset_all(&self) {
        let mut st = self.st.lock().unwrap();
        for ss in st.socks.values_mut() {
            ss.err = Some(libc::ENETRESET);
        }
        self.cv.notify_all();
    }

    pub fn set_fail_open(&self, on: bool) {
        self.st.lock().unwrap().fail_open = on;
    }

    pub fn set_responder(&self, f: impl Fn(u32, &Msg) -> Option<Vec<u8>> + Send + Sync + 'static) {
        self.st.lock().unwrap().responder = Some(Arc::new(f));
    }

    pub fn sent(&self) -> Vec<Sent> {
        self.st.lock().unwrap().sent.clone()
    }

    /// Waits until at least `n` requests reached service endpoints.
    pub fn wait_sent(&self, n: usize, timeout: Duration) -> Vec<Sent> {
        let end = Instant::now() + timeout;
        let mut st = self.st.lock().unwrap();
        while st.sent.len() < n {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            st = self.cv.wait_timeout(st, left).unwrap().0;
        }
        st.sent.clone()
    }

    /// Delivers `bytes` from `svc`'s endpoint to its newest client socket.
    pub fn reply(&self, svc: u32, bytes: Vec<u8>) {
        let mut st = self.st.lock().unwrap();
        let (node, port) = st.servers.get(&svc).copied().unwrap_or((0, 0));
        let id = st.socks.iter().filter(|(_, s)| s.peer_svc == Some(svc)).map(|(id, _)| *id).max();
        if let Some(id) = id {
            st.socks.get_mut(&id).unwrap().q.push_back((bytes, node, port));
        }
        self.cv.notify_all();
    }

    pub fn open_sockets(&self) -> usize {
        self.st.lock().unwrap().socks.len()
    }
}

impl Transport for FakeTransport {
    fn open(&self) -> io::Result<Box<dyn Datagram>> {
        let mut st = self.0.st.lock().unwrap();
        if st.fail_open {
            return Err(io::Error::from_raw_os_error(libc::EAFNOSUPPORT));
        }
        st.next_id += 1;
        let id = st.next_id;
        st.socks.insert(id, SockState::default());
        Ok(Box::new(FakeSock { net: self.0.clone(), id }))
    }
}

impl Drop for FakeSock {
    fn drop(&mut self) {
        let mut st = self.net.st.lock().unwrap();
        st.socks.remove(&self.id);
        let id = self.id;
        st.lookups.retain(|(s, _)| *s != id);
    }
}

impl Datagram for FakeSock {
    fn send_to(&self, node: u32, port: u32, buf: &[u8]) -> io::Result<()> {
        let mut st = self.net.st.lock().unwrap();
        let ss = st.socks.get(&self.id).unwrap();
        if ss.shut {
            return Err(io::Error::new(io::ErrorKind::NotConnected, "shut"));
        }
        if let Some(e) = ss.err {
            return Err(io::Error::from_raw_os_error(e));
        }
        if port == QRTR_PORT_CTL {
            if buf.len() >= 8 && u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) == QRTR_TYPE_NEW_LOOKUP {
                let svc = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
                let mut out = Vec::new();
                if let Some(&(n, p)) = st.servers.get(&svc) {
                    out.push(encode_ctrl(QRTR_TYPE_NEW_SERVER, svc, 1, n, p).to_vec());
                }
                out.push(encode_ctrl(QRTR_TYPE_NEW_SERVER, 0, 0, 0, 0).to_vec());
                st.lookups.push((self.id, svc));
                let ss = st.socks.get_mut(&self.id).unwrap();
                for p in out {
                    ss.q.push_back((p, LOCAL_NODE, QRTR_PORT_CTL));
                }
                self.net.cv.notify_all();
            }
            debug_assert!(parse_ctrl(buf).is_some());
            return Ok(());
        }
        let svc = match st.servers.iter().find(|(_, &ep)| ep == (node, port)) {
            Some((&svc, _)) => svc,
            None => return Err(io::Error::from_raw_os_error(libc::EHOSTUNREACH)),
        };
        let m = msg::parse(buf).expect("fake: unparsable request");
        st.socks.get_mut(&self.id).unwrap().peer_svc = Some(svc);
        st.sent.push(Sent { sock: self.id, svc, msg: m.clone() });
        if let Some(r) = st.responder.clone() {
            if let Some(reply) = r(svc, &m) {
                st.socks.get_mut(&self.id).unwrap().q.push_back((reply, node, port));
            }
        }
        self.net.cv.notify_all();
        Ok(())
    }

    fn recv(&self, buf: &mut [u8], timeout: Duration) -> io::Result<(usize, u32, u32)> {
        let end = Instant::now() + timeout;
        let mut st = self.net.st.lock().unwrap();
        loop {
            let ss = st.socks.get_mut(&self.id).unwrap();
            if ss.shut {
                return Err(io::Error::new(io::ErrorKind::NotConnected, "shut"));
            }
            if let Some(e) = ss.err {
                return Err(io::Error::from_raw_os_error(e));
            }
            if let Some((b, n, p)) = ss.q.pop_front() {
                let len = b.len().min(buf.len());
                buf[..len].copy_from_slice(&b[..len]);
                return Ok((len, n, p));
            }
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(timed_out());
            }
            st = self.net.cv.wait_timeout(st, left).unwrap().0;
        }
    }

    fn local_node(&self) -> u32 {
        LOCAL_NODE
    }

    fn shutdown(&self) {
        let mut st = self.net.st.lock().unwrap();
        if let Some(ss) = st.socks.get_mut(&self.id) {
            ss.shut = true;
        }
        self.net.cv.notify_all();
    }
}
