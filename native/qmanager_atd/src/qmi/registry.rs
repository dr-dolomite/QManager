//! The QMI service registry: one long-lived client socket per service, a
//! demux reader thread per socket, and a name-server watcher thread.
//!
//! Threads (all 128 KiB stacks):
//! - `qmi-ns`: owns a socket subscribed to the name server for every service
//!   (NEW_LOOKUP is a standing subscription), applies NEW_SERVER / DEL_SERVER,
//!   and runs the backoff re-lookups (250 ms doubling to 2 s) for services
//!   that went down. If its own socket is reset it reopens it with the same
//!   backoff and re-subscribes.
//! - `qmi-<svc>`: reads the service's client socket. A response goes to the
//!   waiter registered under its txn; an indication goes to subscribers; any
//!   socket error (ECONNRESET/ENETRESET on SSR) marks the service down and
//!   the thread exits.
//!
//! Requests run on the caller's thread: allocate a txn and register a waiter
//! under the service mutex, send, release, then wait on a private channel
//! for at most the request timeout (1 s), or less if the caller's deadline
//! (`request_by`) comes first.
//!
//! Fast-fail circuit. A service that is listed but silent (NAS wedged after
//! an SSR, a modem that stopped answering) would make every request wait the
//! full timeout. After `circuit_after` consecutive timeouts (no response
//! within the full request timeout, or a send that timed out) the circuit
//! opens: requests fail at once with `modem_not_ready`, except one probe let
//! through at most every `probe_every` (half-open). Any response on the
//! current link (success or a QMI error), and every link rebuild (NEW_SERVER,
//! a backoff re-lookup), closes it. The snapshot sampler's 2 s cadence is
//! what normally probes a recovering service.
//!
//! Locking. Three kinds of mutex: `Service.inner` (state, current link, txn
//! counter), `Link.pending` (txn -> waiter) and `Service.subs`. The only
//! nesting is inner -> pending. No lock is held while waiting for a reply,
//! while a demux thread blocks in recv, or across a lookup; the demux thread
//! takes `pending` or `subs` alone and calls `mark_down` holding nothing, so
//! there is no cycle. A waiter's channel has room for its single reply and is
//! sent to with try_send while its entry is removed under `pending`, so a
//! reply, a timeout and an SSR drain can never block each other or answer a
//! request twice.
//!
//! SSR and fds. A link (socket + pending map) is replaced, never repaired.
//! `mark_down` detaches it from the service only if it is still the current
//! one (pointer identity, or the DEL_SERVER endpoint), then closes it:
//! shutdown + stop flag (its demux thread exits within one tick) and every
//! pending waiter answered `modem_not_ready` at once. The socket fd closes
//! when the last `Arc<Link>` drops: the demux thread's on exit, an in-flight
//! request's on return (bounded by the request timeout). New requests see
//! state Down and fail fast without touching any socket.

use super::allow;
use super::error::QmiError;
use super::msg::{self, Msg, Tlv, KIND_IND, KIND_REQ, KIND_RESP};
use super::transport::{self, Ctrl, Datagram, QrtrTransport, Transport, QRTR_PORT_CTL};
use super::{service_name, SERVICES, SVC_NAS};
use crate::common::proto::mono_ms;
use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::SeqCst};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const THREAD_STACK: usize = 128 * 1024;
/// Request TLV bodies above this are refused as bad_args (reads need a few
/// bytes at most).
pub const MAX_REQUEST_BODY: usize = 1024;
/// Undelivered indications per subscriber before new ones are dropped.
#[allow(dead_code)] // consumed by the phase 2 indication path
pub const SUB_QUEUE: usize = 64;
const RECV_BUF: usize = 65536;

#[derive(Clone, Debug)]
pub struct Config {
    /// Per-request wait for the response (Phase 0 p99 < 5 ms).
    pub request_timeout: Duration,
    /// One name-server lookup (local, sub-millisecond on the device).
    pub lookup_timeout: Duration,
    /// Re-lookup backoff after a service goes down: min, doubling to max.
    pub backoff_min: Duration,
    pub backoff_max: Duration,
    /// Longest a reader blocks before re-checking its stop flag.
    pub tick: Duration,
    /// Service losses closer together than this are one SSR.
    pub ssr_merge: Duration,
    /// Consecutive timeouts that open the fast-fail circuit (0 = never).
    pub circuit_after: u32,
    /// While open, one probe request is let through at most this often.
    pub probe_every: Duration,
}

impl Default for Config {
    fn default() -> Config {
        Config {
            request_timeout: Duration::from_secs(1),
            lookup_timeout: Duration::from_millis(500),
            backoff_min: Duration::from_millis(250),
            backoff_max: Duration::from_secs(2),
            tick: Duration::from_millis(250),
            ssr_merge: Duration::from_secs(2),
            circuit_after: 2,
            probe_every: Duration::from_secs(1),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SvcState {
    /// Client socket open, demux running.
    Up,
    /// Was up; lost to a reset or DEL_SERVER; re-lookup in progress.
    Down,
    /// Never found (or no QRTR at all).
    Unavailable,
}

impl SvcState {
    pub fn as_str(self) -> &'static str {
        match self {
            SvcState::Up => "up",
            SvcState::Down => "down",
            SvcState::Unavailable => "unavailable",
        }
    }
}

/// Mutex poisoning can only follow a panic, which aborts in release builds;
/// in tests, keep going with the inner value.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct Waiter {
    msg: u16,
    tx: SyncSender<Result<Msg, QmiError>>,
}

/// One client socket to one service endpoint, and its in-flight requests.
struct Link {
    sock: Box<dyn Datagram>,
    node: u32,
    port: u32,
    pending: Mutex<HashMap<u16, Waiter>>,
    stop: AtomicBool,
}

impl Link {
    fn close(&self) {
        self.stop.store(true, SeqCst);
        self.sock.shutdown();
        for (_, w) in lock(&self.pending).drain() {
            let _ = w.tx.try_send(Err(QmiError::ModemNotReady(None)));
        }
    }
}

struct Inner {
    state: SvcState,
    link: Option<Arc<Link>>,
    txn: u16,
    retry_at: Option<Instant>,
    backoff: Duration,
    /// Internal indication registration, replayed on every rebuilt socket
    /// (registrations are per client socket and die with it).
    ind_reg: Option<(u16, Vec<Tlv>)>,
    /// Consecutive timeouts on the current link (the circuit is open at
    /// `circuit_after`).
    timeouts: u32,
    /// While open: the earliest moment the next probe may go out.
    probe_at: Option<Instant>,
}

impl Inner {
    fn close_circuit(&mut self) {
        self.timeouts = 0;
        self.probe_at = None;
    }
}

struct Service {
    id: u32,
    inner: Mutex<Inner>,
    subs: Mutex<Vec<SyncSender<Msg>>>,
}

impl Service {
    fn publish(&self, m: &Msg) {
        lock(&self.subs).retain(|tx| match tx.try_send(m.clone()) {
            Ok(()) | Err(TrySendError::Full(_)) => true,
            Err(TrySendError::Disconnected(_)) => false,
        });
    }
}

enum Lost<'a> {
    /// This link's socket failed.
    Link(&'a Arc<Link>),
    /// The name server withdrew this endpoint.
    Endpoint(u32, u32),
}

struct Shared {
    transport: Box<dyn Transport>,
    cfg: Config,
    services: Vec<Service>,
    stop: AtomicBool,
    ssr_count: AtomicU64,
    last_ssr_ms: AtomicU64,
    last_loss_ms: AtomicU64,
    down: AtomicUsize,
}

pub struct Registry {
    shared: Arc<Shared>,
    watcher: Mutex<Option<JoinHandle<()>>>,
}

fn next_txn(ctr: &mut u16, pending: &HashMap<u16, Waiter>) -> u16 {
    loop {
        let t = *ctr;
        *ctr = ctr.wrapping_add(1);
        if t != 0 && !pending.contains_key(&t) {
            return t;
        }
    }
}

impl Shared {
    fn idx(&self, svc: u32) -> Option<usize> {
        self.services.iter().position(|s| s.id == svc)
    }

    fn call(self: &Arc<Self>, i: usize, msg_id: u16, tlvs: &[Tlv], deadline: Option<Instant>) -> Result<Msg, QmiError> {
        if msg::tlvs_len(tlvs) > MAX_REQUEST_BODY {
            return Err(QmiError::BadArgs(None));
        }
        let svc = self.services.get(i).ok_or(QmiError::Unavailable)?;
        let mut g = lock(&svc.inner);
        let link = match (g.state, &g.link) {
            (SvcState::Up, Some(l)) => l.clone(),
            (SvcState::Unavailable, _) => return Err(QmiError::Unavailable),
            _ => return Err(QmiError::ModemNotReady(None)),
        };
        // The caller's budget, checked before anything is sent.
        let wait = match deadline {
            Some(d) => d.saturating_duration_since(Instant::now()).min(self.cfg.request_timeout),
            None => self.cfg.request_timeout,
        };
        if wait.is_zero() {
            return Err(QmiError::ModemNotReady(None));
        }
        if self.cfg.circuit_after > 0 && g.timeouts >= self.cfg.circuit_after {
            let now = Instant::now();
            match g.probe_at {
                Some(t) if now < t => return Err(QmiError::ModemNotReady(None)),
                // Half-open: this request is the probe; the next one waits.
                _ => g.probe_at = Some(now + self.cfg.probe_every),
            }
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let txn = {
            let mut p = lock(&link.pending);
            let txn = next_txn(&mut g.txn, &p);
            p.insert(txn, Waiter { msg: msg_id, tx });
            txn
        };
        let sent = link.sock.send_to(link.node, link.port, &msg::encode(KIND_REQ, txn, msg_id, tlvs));
        if let Err(e) = sent {
            lock(&link.pending).remove(&txn);
            if transport::is_timeout(&e) {
                self.note_timeout(&mut g, &link);
                return Err(QmiError::Timeout);
            }
            drop(g);
            self.mark_down(i, Lost::Link(&link));
            return Err(QmiError::ModemNotReady(None));
        }
        drop(g);
        let r = match rx.recv_timeout(wait) {
            Ok(r) => r,
            Err(RecvTimeoutError::Timeout) => {
                if lock(&link.pending).remove(&txn).is_some() {
                    Err(QmiError::Timeout)
                } else {
                    // Answered (or drained) between the timeout and the lock.
                    rx.try_recv().unwrap_or(Err(QmiError::ModemNotReady(None)))
                }
            }
            Err(RecvTimeoutError::Disconnected) => Err(QmiError::ModemNotReady(None)),
        };
        match &r {
            // A response, whatever its result TLV says: the service is alive.
            Ok(_) => {
                let mut g = lock(&svc.inner);
                if g.link.as_ref().map_or(false, |l| Arc::ptr_eq(l, &link)) {
                    g.close_circuit();
                }
            }
            // Only a full-length wait is evidence of a silent service; a wait
            // the caller's deadline cut short says nothing.
            Err(QmiError::Timeout) if wait >= self.cfg.request_timeout => {
                let mut g = lock(&svc.inner);
                self.note_timeout(&mut g, &link);
            }
            Err(_) => {}
        }
        r.and_then(Msg::into_result)
    }

    /// One more consecutive timeout on `link`, if it is still the current one
    /// (a rebuilt link starts with a closed circuit).
    fn note_timeout(&self, g: &mut Inner, link: &Arc<Link>) {
        if !g.link.as_ref().map_or(false, |l| Arc::ptr_eq(l, link)) {
            return;
        }
        g.timeouts = g.timeouts.saturating_add(1);
        if self.cfg.circuit_after > 0 && g.timeouts >= self.cfg.circuit_after {
            // Opened, or a probe failed: the next probe is a full period away.
            g.probe_at = Some(Instant::now() + self.cfg.probe_every);
        }
    }

    /// The name server lists `svc` at (node, port): bring it up there.
    fn on_found(self: &Arc<Self>, i: usize, node: u32, port: u32) {
        let svc = &self.services[i];
        if self.stop.load(SeqCst) {
            return;
        }
        let replay = {
            let mut g = lock(&svc.inner);
            if let (SvcState::Up, Some(l)) = (g.state, &g.link) {
                if l.node == node && l.port == port {
                    return;
                }
            }
            let sock = match self.transport.open() {
                Ok(s) => s,
                Err(_) => {
                    if g.state == SvcState::Down {
                        g.retry_at = Some(Instant::now() + g.backoff);
                    }
                    return;
                }
            };
            let link = Arc::new(Link { sock, node, port, pending: Mutex::new(HashMap::new()), stop: AtomicBool::new(false) });
            if spawn_demux(self.clone(), i, link.clone()).is_err() {
                return;
            }
            if let Some(old) = g.link.replace(link) {
                old.close();
            }
            if g.state == SvcState::Down {
                self.down.fetch_sub(1, SeqCst);
            }
            g.state = SvcState::Up;
            g.retry_at = None;
            g.backoff = self.cfg.backoff_min;
            g.close_circuit();
            g.ind_reg.clone()
        };
        if let Some((msg_id, tlvs)) = replay {
            let _ = self.call(i, msg_id, &tlvs, None);
        }
    }

    fn mark_down(&self, i: usize, lost: Lost<'_>) {
        let svc = &self.services[i];
        let mut g = lock(&svc.inner);
        let hit = match (&g.link, lost) {
            (Some(cur), Lost::Link(l)) => Arc::ptr_eq(cur, l),
            (Some(cur), Lost::Endpoint(n, p)) => cur.node == n && cur.port == p,
            (None, _) => false,
        };
        if !hit {
            return;
        }
        let link = match g.link.take() {
            Some(l) => l,
            None => return,
        };
        g.state = SvcState::Down;
        g.close_circuit();
        g.backoff = self.cfg.backoff_min;
        g.retry_at = Some(Instant::now() + g.backoff);
        link.close();
        let was_down = self.down.fetch_add(1, SeqCst);
        let now = mono_ms();
        let last = self.last_loss_ms.swap(now, SeqCst);
        let merge = self.cfg.ssr_merge.as_millis() as u64;
        if was_down == 0 && (last == 0 || now.saturating_sub(last) >= merge) {
            self.ssr_count.fetch_add(1, SeqCst);
            self.last_ssr_ms.store(now.max(1), SeqCst);
        }
    }

    fn on_ctrl(self: &Arc<Self>, c: Ctrl) {
        match c {
            Ctrl::NewServer { svc, node, port } => {
                if let Some(i) = self.idx(svc) {
                    self.on_found(i, node, port);
                }
            }
            Ctrl::DelServer { svc, node, port } => {
                if let Some(i) = self.idx(svc) {
                    self.mark_down(i, Lost::Endpoint(node, port));
                }
            }
            Ctrl::EndOfList | Ctrl::Other => {}
        }
    }

    /// Subscribes, then applies the initial listing (until every lookup's
    /// end marker, or the lookup timeout). None when QRTR can't be reached.
    fn initial_lookup(self: &Arc<Self>) -> Option<Box<dyn Datagram>> {
        let s = transport::watch(&*self.transport, &SERVICES).ok()?;
        let end = Instant::now() + self.cfg.lookup_timeout;
        let mut buf = [0u8; 256];
        let mut ends = 0;
        while ends < SERVICES.len() {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            match s.recv(&mut buf, left) {
                Ok((n, _, port)) if port == QRTR_PORT_CTL => match transport::parse_ctrl(&buf[..n]) {
                    Some(Ctrl::EndOfList) => ends += 1,
                    Some(c) => self.on_ctrl(c),
                    None => {}
                },
                Ok(_) => {}
                Err(e) if transport::is_timeout(&e) => break,
                Err(_) => return None,
            }
        }
        Some(s)
    }

    /// Re-looks-up every down service whose backoff has expired.
    fn retry_due(self: &Arc<Self>) {
        let now = Instant::now();
        for i in 0..self.services.len() {
            let due = {
                let g = lock(&self.services[i].inner);
                g.state == SvcState::Down && g.retry_at.map_or(true, |t| t <= now)
            };
            if !due {
                continue;
            }
            match transport::lookup(&*self.transport, self.services[i].id, self.cfg.lookup_timeout) {
                Ok(Some((node, port))) => self.on_found(i, node, port),
                _ => {
                    let mut g = lock(&self.services[i].inner);
                    if g.state == SvcState::Down {
                        g.backoff = (g.backoff * 2).min(self.cfg.backoff_max);
                        g.retry_at = Some(Instant::now() + g.backoff);
                    }
                }
            }
        }
    }

    /// How long the watcher may block: one tick, or less if a re-lookup is due.
    fn next_wait(&self) -> Duration {
        let now = Instant::now();
        let mut w = self.cfg.tick;
        for s in &self.services {
            let g = lock(&s.inner);
            if let (SvcState::Down, Some(t)) = (g.state, g.retry_at) {
                w = w.min(t.saturating_duration_since(now));
            }
        }
        w.max(Duration::from_millis(1))
    }
}

fn spawn_demux(shared: Arc<Shared>, i: usize, link: Arc<Link>) -> io::Result<()> {
    let name = format!("qmi-{}", service_name(shared.services[i].id));
    thread::Builder::new().name(name).stack_size(THREAD_STACK).spawn(move || demux(shared, i, link))?;
    Ok(())
}

fn demux(shared: Arc<Shared>, i: usize, link: Arc<Link>) {
    let mut buf = vec![0u8; RECV_BUF];
    loop {
        if link.stop.load(SeqCst) || shared.stop.load(SeqCst) {
            return;
        }
        match link.sock.recv(&mut buf, shared.cfg.tick) {
            Ok((n, node, port)) => {
                if node != link.node || port != link.port {
                    continue;
                }
                let m = match msg::parse(&buf[..n]) {
                    Some(m) => m,
                    None => continue,
                };
                match m.kind {
                    KIND_RESP => {
                        let mut p = lock(&link.pending);
                        if p.get(&m.txn).map(|w| w.msg) == Some(m.id) {
                            if let Some(w) = p.remove(&m.txn) {
                                let _ = w.tx.try_send(Ok(m));
                            }
                        }
                    }
                    KIND_IND => shared.services[i].publish(&m),
                    _ => {}
                }
            }
            Err(e) if transport::is_timeout(&e) => {}
            Err(_) => {
                if !link.stop.load(SeqCst) {
                    shared.mark_down(i, Lost::Link(&link));
                }
                return;
            }
        }
    }
}

fn watcher(shared: Arc<Shared>, mut ns: Option<Box<dyn Datagram>>) {
    let cfg = shared.cfg.clone();
    let mut ns_backoff = cfg.backoff_min;
    let mut ns_retry = Instant::now() + ns_backoff;
    let mut buf = [0u8; 256];
    while !shared.stop.load(SeqCst) {
        if ns.is_none() && Instant::now() >= ns_retry {
            match transport::watch(&*shared.transport, &SERVICES) {
                Ok(s) => {
                    ns = Some(s);
                    ns_backoff = cfg.backoff_min;
                }
                Err(_) => {
                    ns_backoff = (ns_backoff * 2).min(cfg.backoff_max);
                    ns_retry = Instant::now() + ns_backoff;
                }
            }
        }
        shared.retry_due();
        let mut wait = shared.next_wait();
        if ns.is_none() {
            wait = wait.min(ns_retry.saturating_duration_since(Instant::now()).max(Duration::from_millis(1)));
        }
        let failed = match &ns {
            Some(s) => match s.recv(&mut buf, wait) {
                Ok((n, _, port)) => {
                    if port == QRTR_PORT_CTL {
                        if let Some(c) = transport::parse_ctrl(&buf[..n]) {
                            shared.on_ctrl(c);
                        }
                    }
                    false
                }
                Err(e) => !transport::is_timeout(&e),
            },
            None => {
                thread::sleep(wait);
                false
            }
        };
        if failed {
            // The name-server socket was reset too (SSR resets every port):
            // reopen and re-subscribe after the backoff.
            ns = None;
            ns_retry = Instant::now() + ns_backoff;
            ns_backoff = (ns_backoff * 2).min(cfg.backoff_max);
        }
    }
}

impl Registry {
    /// Looks every service up once (synchronously, bounded by the lookup
    /// timeout), connects the ones found and starts the watcher.
    pub fn start(transport: Box<dyn Transport>, cfg: Config) -> Registry {
        let services = SERVICES
            .iter()
            .map(|&id| Service {
                id,
                inner: Mutex::new(Inner {
                    state: SvcState::Unavailable,
                    link: None,
                    txn: 1,
                    retry_at: None,
                    backoff: cfg.backoff_min,
                    ind_reg: None,
                    timeouts: 0,
                    probe_at: None,
                }),
                subs: Mutex::new(Vec::new()),
            })
            .collect();
        let shared = Arc::new(Shared {
            transport,
            cfg,
            services,
            stop: AtomicBool::new(false),
            ssr_count: AtomicU64::new(0),
            last_ssr_ms: AtomicU64::new(0),
            last_loss_ms: AtomicU64::new(0),
            down: AtomicUsize::new(0),
        });
        let ns = shared.initial_lookup();
        let sh = shared.clone();
        let watcher = thread::Builder::new()
            .name("qmi-ns".into())
            .stack_size(THREAD_STACK)
            .spawn(move || watcher(sh, ns))
            .ok();
        Registry { shared, watcher: Mutex::new(watcher) }
    }

    /// The real AF_QIPCRTR transport with the default timings.
    pub fn start_qrtr() -> Registry {
        Registry::start(Box::new(QrtrTransport), Config::default())
    }

    /// A client request: refused unless (svc, msg) is on the read-only
    /// allow-list; otherwise the successful response, or the typed error
    /// (including a failing result TLV).
    pub fn request(&self, svc: u32, msg_id: u16, tlvs: &[Tlv]) -> Result<Msg, QmiError> {
        self.request_by(svc, msg_id, tlvs, None)
    }

    /// `request`, but never waiting past `deadline`: past it the request
    /// fails `modem_not_ready` without being sent, and the response wait is
    /// cut to what is left.
    pub fn request_by(&self, svc: u32, msg_id: u16, tlvs: &[Tlv], deadline: Option<Instant>) -> Result<Msg, QmiError> {
        allow::check_client(svc, msg_id)?;
        let i = self.shared.idx(svc).ok_or(QmiError::Unavailable)?;
        self.shared.call(i, msg_id, tlvs, deadline)
    }

    /// Internal only: NAS Indication Register on the registry's own NAS
    /// socket. Remembered and replayed on every rebuilt socket, since a
    /// registration dies with its client socket.
    #[allow(dead_code)] // consumed by the phase 2 indication path
    pub fn register_indications(&self, svc: u32, tlvs: &[Tlv]) -> Result<(), QmiError> {
        let msg_id = allow::NAS_INDICATION_REGISTER;
        if svc != SVC_NAS || !allow::internal_allowed(svc, msg_id) {
            return Err(QmiError::Refused { svc, msg: msg_id });
        }
        let i = self.shared.idx(svc).ok_or(QmiError::Unavailable)?;
        lock(&self.shared.services[i].inner).ind_reg = Some((msg_id, tlvs.to_vec()));
        self.shared.call(i, msg_id, tlvs, None).map(|_| ())
    }

    /// Indications from `svc`, from now on (across socket rebuilds). A
    /// subscriber that falls `SUB_QUEUE` behind loses the newest ones.
    #[allow(dead_code)] // consumed by the phase 2 indication path
    pub fn subscribe(&self, svc: u32) -> Option<Receiver<Msg>> {
        let i = self.shared.idx(svc)?;
        let (tx, rx) = mpsc::sync_channel(SUB_QUEUE);
        lock(&self.shared.services[i].subs).push(tx);
        Some(rx)
    }

    pub fn state(&self, svc: u32) -> Option<SvcState> {
        let i = self.shared.idx(svc)?;
        Some(lock(&self.shared.services[i].inner).state)
    }

    pub fn states(&self) -> Vec<(u32, SvcState)> {
        self.shared.services.iter().map(|s| (s.id, lock(&s.inner).state)).collect()
    }

    /// SSR episodes seen (losses within `ssr_merge` of each other count once).
    pub fn ssr_count(&self) -> u64 {
        self.shared.ssr_count.load(SeqCst)
    }

    /// CLOCK_MONOTONIC ms of the last SSR episode's first loss.
    #[allow(dead_code)] // consumed by the phase 2 indication path
    pub fn last_ssr_mono_ms(&self) -> Option<u64> {
        match self.shared.last_ssr_ms.load(SeqCst) {
            0 => None,
            t => Some(t),
        }
    }

    /// Stops the watcher (joined) and every demux thread (each exits within
    /// one tick); pending requests answer modem_not_ready. Idempotent.
    pub fn shutdown(&self) {
        self.shared.stop.store(true, SeqCst);
        // Join the watcher first: it is the only thread that creates links.
        let h = lock(&self.watcher).take();
        if let Some(h) = h {
            let _ = h.join();
        }
        for s in &self.shared.services {
            let link = lock(&s.inner).link.take();
            if let Some(l) = link {
                l.close();
            }
        }
    }
}

impl Drop for Registry {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::super::fake::FakeNet;
    use super::super::msg::{encode, result_tlv};
    use super::super::{SVC_DMS, SVC_DSD, SVC_UIM, SVC_WDS};
    use super::*;

    fn cfg() -> Config {
        Config {
            request_timeout: Duration::from_millis(500),
            lookup_timeout: Duration::from_millis(100),
            backoff_min: Duration::from_millis(5),
            backoff_max: Duration::from_millis(20),
            tick: Duration::from_millis(5),
            ssr_merge: Duration::ZERO,
            circuit_after: 2,
            probe_every: Duration::from_millis(200),
        }
    }

    const PORTS: [(u32, u32); 5] = [(SVC_NAS, 0x40), (SVC_DMS, 0x41), (SVC_UIM, 0x42), (SVC_WDS, 0x43), (SVC_DSD, 0x44)];

    fn net_all_up() -> Arc<FakeNet> {
        let net = FakeNet::new();
        for (svc, port) in PORTS {
            net.add_server(svc, 0, port);
        }
        net
    }

    fn ok_reply(svc: u32, m: &Msg) -> Vec<u8> {
        encode(KIND_RESP, m.txn, m.id, &[result_tlv(None), Tlv::new(0x10, &[svc as u8])])
    }

    fn echo(net: &Arc<FakeNet>) {
        net.set_responder(|svc, m| Some(ok_reply(svc, m)));
    }

    fn wait_until(mut f: impl FnMut() -> bool) -> bool {
        let end = Instant::now() + Duration::from_secs(2);
        while Instant::now() < end {
            if f() {
                return true;
            }
            thread::sleep(Duration::from_millis(2));
        }
        f()
    }

    fn start(net: &Arc<FakeNet>, c: Config) -> Arc<Registry> {
        Arc::new(Registry::start(Box::new(net.transport()), c))
    }

    #[test]
    fn listed_services_come_up_and_an_unlisted_one_is_unavailable_until_announced() {
        let net = FakeNet::new();
        for (svc, port) in &PORTS[..4] {
            net.add_server(*svc, 0, *port);
        }
        echo(&net);
        let reg = start(&net, cfg());
        assert_eq!(reg.state(SVC_NAS), Some(SvcState::Up));
        assert_eq!(reg.state(SVC_DSD), Some(SvcState::Unavailable));
        assert_eq!(reg.request(SVC_DSD, 0x0024, &[]).unwrap_err(), QmiError::Unavailable);
        let m = reg.request(SVC_NAS, 0x0024, &[]).unwrap();
        assert_eq!((m.kind, m.id, m.tlv(0x10)), (KIND_RESP, 0x0024, Some(&[SVC_NAS as u8][..])));
        // The name server announces DSD later: no SSR, just up.
        net.add_server(SVC_DSD, 0, 0x44);
        assert!(wait_until(|| reg.state(SVC_DSD) == Some(SvcState::Up)));
        assert!(reg.request(SVC_DSD, 0x0024, &[]).is_ok());
        assert_eq!(reg.ssr_count(), 0);
        assert_eq!(reg.last_ssr_mono_ms(), None);
    }

    #[test]
    fn concurrent_requests_answered_out_of_order_each_get_their_own_reply() {
        let net = net_all_up();
        let reg = start(&net, cfg());
        let spawn = |msg_id: u16| {
            let r = reg.clone();
            thread::spawn(move || r.request(SVC_NAS, msg_id, &[]))
        };
        let a = spawn(0x0024);
        let b = spawn(0x0043);
        let sent = net.wait_sent(2, Duration::from_secs(1));
        assert_eq!(sent.len(), 2);
        assert_ne!(sent[0].msg.txn, sent[1].msg.txn);
        let tag = |m: &Msg| encode(KIND_RESP, m.txn, m.id, &[result_tlv(None), Tlv::new(0x10, &m.id.to_le_bytes())]);
        net.reply(SVC_NAS, tag(&sent[1].msg));
        net.reply(SVC_NAS, tag(&sent[0].msg));
        let ra = a.join().unwrap().unwrap();
        let rb = b.join().unwrap().unwrap();
        assert_eq!((ra.id, ra.tlv(0x10)), (0x0024, Some(&0x0024u16.to_le_bytes()[..])));
        assert_eq!((rb.id, rb.tlv(0x10)), (0x0043, Some(&0x0043u16.to_le_bytes()[..])));
    }

    #[test]
    fn an_indication_goes_to_subscribers_not_to_a_waiter() {
        let net = net_all_up();
        let reg = start(&net, cfg());
        let sub = reg.subscribe(SVC_NAS).unwrap();
        let r = reg.clone();
        let t = thread::spawn(move || r.request(SVC_NAS, 0x004F, &[]));
        let sent = net.wait_sent(1, Duration::from_secs(1));
        let req = &sent[0].msg;
        // Same txn and even the same id, but kind=indication.
        net.reply(SVC_NAS, encode(KIND_IND, req.txn, req.id, &[Tlv::new(0x11, &[7])]));
        net.reply(SVC_NAS, encode(KIND_IND, 0, 0x0051, &[Tlv::new(0x11, &[8])]));
        let ind = sub.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!((ind.kind, ind.tlv(0x11)), (KIND_IND, Some(&[7u8][..])));
        assert_eq!(sub.recv_timeout(Duration::from_secs(1)).unwrap().id, 0x0051);
        net.reply(SVC_NAS, ok_reply(SVC_NAS, req));
        let m = t.join().unwrap().unwrap();
        assert_eq!((m.kind, m.id), (KIND_RESP, 0x004F));
        // A subscriber of another service sees nothing.
        let other = reg.subscribe(SVC_DMS).unwrap();
        net.reply(SVC_NAS, encode(KIND_IND, 0, 0x0051, &[]));
        assert!(sub.recv_timeout(Duration::from_secs(1)).is_ok());
        assert!(other.try_recv().is_err());
    }

    #[test]
    fn a_silent_service_times_out_and_a_late_reply_is_dropped() {
        let net = net_all_up();
        let mut c = cfg();
        c.request_timeout = Duration::from_millis(50);
        let reg = start(&net, c);
        let t0 = Instant::now();
        assert_eq!(reg.request(SVC_DMS, 0x0025, &[]).unwrap_err(), QmiError::Timeout);
        let el = t0.elapsed();
        assert!(el >= Duration::from_millis(50) && el < Duration::from_millis(500), "{el:?}");
        let late = net.sent()[0].msg.clone();
        assert!(lock(&reg.shared.services[1].inner).link.as_ref().unwrap().pending.lock().unwrap().is_empty());
        net.reply(SVC_DMS, ok_reply(SVC_DMS, &late));
        echo(&net);
        let m = reg.request(SVC_DMS, 0x0025, &[]).unwrap();
        assert_ne!(m.txn, late.txn);
        assert_eq!(reg.state(SVC_DMS), Some(SvcState::Up));
    }

    #[test]
    fn a_reset_marks_down_fails_fast_and_a_backoff_relookup_rebuilds() {
        let net = net_all_up();
        let answer = Arc::new(AtomicBool::new(false));
        let a = answer.clone();
        net.set_responder(move |svc, m| if a.load(SeqCst) { Some(ok_reply(svc, m)) } else { None });
        let mut c = cfg();
        c.request_timeout = Duration::from_secs(2);
        let reg = start(&net, c);
        assert_eq!(net.open_sockets(), 6); // five clients and the name-server watch
        let r = reg.clone();
        let inflight = thread::spawn(move || {
            let t0 = Instant::now();
            (r.request(SVC_NAS, 0x0024, &[]), t0.elapsed())
        });
        net.wait_sent(1, Duration::from_secs(1));
        // The live SSR: ECONNRESET, and the service is gone from the name server.
        net.remove_server_silently(SVC_NAS);
        net.reset_clients(SVC_NAS);
        let (res, el) = inflight.join().unwrap();
        assert_eq!(res.unwrap_err(), QmiError::ModemNotReady(None));
        assert!(el < Duration::from_millis(500), "in-flight request hung {el:?}");
        assert_eq!(reg.state(SVC_NAS), Some(SvcState::Down));
        assert_eq!(reg.ssr_count(), 1);
        assert!(reg.last_ssr_mono_ms().is_some());
        let t0 = Instant::now();
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::ModemNotReady(None));
        assert!(t0.elapsed() < Duration::from_millis(50));
        // Other services are untouched.
        answer.store(true, SeqCst);
        assert!(reg.request(SVC_DMS, 0x0025, &[]).is_ok());
        // Back after a while at a new port; only the backoff lookup finds it.
        thread::sleep(Duration::from_millis(30));
        assert_eq!(reg.state(SVC_NAS), Some(SvcState::Down));
        net.add_server_silently(SVC_NAS, 0, 0x50);
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Up)));
        assert!(reg.request(SVC_NAS, 0x0024, &[]).is_ok());
        assert_eq!(reg.ssr_count(), 1);
        // The reset socket was closed, not leaked.
        assert!(wait_until(|| net.open_sockets() == 6), "open: {}", net.open_sockets());
    }

    #[test]
    fn del_server_marks_down_and_new_server_brings_it_back() {
        let net = net_all_up();
        echo(&net);
        let reg = start(&net, cfg());
        assert!(reg.request(SVC_UIM, 0x002F, &[]).is_ok());
        net.del_server(SVC_UIM);
        assert!(wait_until(|| reg.state(SVC_UIM) == Some(SvcState::Down)));
        let t0 = Instant::now();
        assert_eq!(reg.request(SVC_UIM, 0x002F, &[]).unwrap_err().code(), "modem_not_ready");
        assert!(t0.elapsed() < Duration::from_millis(50));
        assert_eq!(reg.ssr_count(), 1);
        net.add_server(SVC_UIM, 0, 0x52);
        assert!(wait_until(|| reg.state(SVC_UIM) == Some(SvcState::Up)));
        assert!(reg.request(SVC_UIM, 0x002F, &[]).is_ok());
        assert!(wait_until(|| net.open_sockets() == 6), "open: {}", net.open_sockets());
    }

    #[test]
    fn a_full_ssr_counts_once_and_the_watcher_resubscribes() {
        let net = net_all_up();
        echo(&net);
        let reg = start(&net, cfg());
        for (svc, _) in PORTS {
            net.remove_server_silently(svc);
        }
        net.reset_all(); // every client socket and the name-server watch
        assert!(wait_until(|| reg.states().iter().all(|(_, s)| *s == SvcState::Down)));
        assert_eq!(reg.ssr_count(), 1);
        assert_eq!(reg.request(SVC_WDS, 0x002A, &[]).unwrap_err().code(), "modem_not_ready");
        for (svc, port) in PORTS {
            net.add_server_silently(svc, 0, port + 0x10);
        }
        assert!(wait_until(|| reg.states().iter().all(|(_, s)| *s == SvcState::Up)));
        assert!(reg.request(SVC_WDS, 0x002A, &[]).is_ok());
        assert!(wait_until(|| net.open_sockets() == 6), "open: {}", net.open_sockets());
        // The re-opened watch socket still receives DEL_SERVER.
        net.del_server(SVC_DMS);
        assert!(wait_until(|| reg.state(SVC_DMS) == Some(SvcState::Down)));
        assert_eq!(reg.ssr_count(), 2);
    }

    #[test]
    fn losses_inside_the_merge_window_are_one_ssr() {
        let net = net_all_up();
        let mut c = cfg();
        c.ssr_merge = Duration::from_secs(10);
        let reg = start(&net, c);
        net.del_server(SVC_NAS);
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Down)));
        net.add_server(SVC_NAS, 0, 0x60);
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Up)));
        net.del_server(SVC_NAS); // flaps again within the window
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Down)));
        assert_eq!(reg.ssr_count(), 1);
    }

    #[test]
    fn refused_and_oversized_requests_never_reach_the_socket() {
        let net = net_all_up();
        echo(&net);
        let reg = start(&net, cfg());
        for (svc, m) in [(SVC_NAS, 0x006Cu16), (SVC_WDS, 0x0024), (SVC_WDS, 0x002D), (SVC_NAS, 0x0003), (SVC_DMS, 0x002E)] {
            assert_eq!(reg.request(svc, m, &[]).unwrap_err(), QmiError::Refused { svc, msg: m });
        }
        let big = Tlv { t: 0x10, v: vec![0; MAX_REQUEST_BODY] };
        assert_eq!(reg.request(SVC_NAS, 0x005A, &[big]).unwrap_err(), QmiError::BadArgs(None));
        assert!(net.sent().is_empty());
    }

    #[test]
    fn failing_result_tlvs_map_to_typed_errors() {
        let net = net_all_up();
        net.set_responder(|svc, m| {
            let tlvs = match (svc, m.id) {
                (SVC_NAS, 0x0024) => vec![result_tlv(Some(0x004A))],
                (SVC_NAS, 0x005A) => vec![result_tlv(Some(0x005E))],
                (SVC_DMS, 0x0025) => vec![result_tlv(Some(0x0003))],
                (SVC_NAS, 0x0043) => vec![Tlv::new(0x10, &[1])],
                _ => vec![result_tlv(None)],
            };
            Some(encode(KIND_RESP, m.txn, m.id, &tlvs))
        });
        let reg = start(&net, cfg());
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::ModemNotReady(Some(0x004A)));
        let e = reg.request(SVC_NAS, 0x005A, &[Tlv::new(0x01, &[0x08])]).unwrap_err();
        assert_eq!((e.code(), e.qmi_code()), ("not_supported", Some(0x005E)));
        assert_eq!(reg.request(SVC_DMS, 0x0025, &[]).unwrap_err(), QmiError::CommandFailed(Some(0x0003)));
        assert_eq!(reg.request(SVC_NAS, 0x0043, &[]).unwrap_err(), QmiError::CommandFailed(None));
        assert!(reg.request(SVC_NAS, 0x004F, &[]).is_ok());
        // A QMI-level error is not an SSR.
        assert_eq!(reg.state(SVC_NAS), Some(SvcState::Up));
        assert_eq!(reg.ssr_count(), 0);
    }

    #[test]
    fn without_qrtr_everything_is_unavailable() {
        let net = FakeNet::new();
        net.set_fail_open(true);
        let reg = start(&net, cfg());
        assert!(reg.states().iter().all(|(_, s)| *s == SvcState::Unavailable));
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err().code(), "qmi_unavailable");
        // QRTR appears later (module loaded): the watcher subscribes and connects.
        net.set_fail_open(false);
        net.add_server_silently(SVC_NAS, 0, 0x40);
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Up)));
    }

    #[test]
    fn indication_registration_is_internal_and_replayed_after_a_rebuild() {
        let net = net_all_up();
        echo(&net);
        let reg = start(&net, cfg());
        let tlvs = [Tlv::new(0x13, &[1]), Tlv::new(0x19, &[1])];
        assert_eq!(reg.request(SVC_NAS, 0x0003, &tlvs).unwrap_err(), QmiError::Refused { svc: SVC_NAS, msg: 0x0003 });
        assert_eq!(reg.register_indications(SVC_DMS, &tlvs).unwrap_err(), QmiError::Refused { svc: SVC_DMS, msg: 0x0003 });
        reg.register_indications(SVC_NAS, &tlvs).unwrap();
        net.del_server(SVC_NAS);
        assert!(wait_until(|| reg.state(SVC_NAS) == Some(SvcState::Down)));
        net.add_server(SVC_NAS, 0, 0x70);
        let regs = || net.sent().into_iter().filter(|s| s.svc == SVC_NAS && s.msg.id == 0x0003).collect::<Vec<_>>();
        assert!(wait_until(|| regs().len() == 2));
        let r = regs();
        assert_ne!(r[0].sock, r[1].sock);
        assert_eq!(r[1].msg.tlvs, tlvs.to_vec());
    }

    #[test]
    fn the_circuit_opens_after_two_timeouts_probes_and_closes_on_a_response() {
        let net = net_all_up();
        let answer = Arc::new(AtomicBool::new(false));
        let a = answer.clone();
        net.set_responder(move |svc, m| if a.load(SeqCst) { Some(ok_reply(svc, m)) } else { None });
        let mut c = cfg();
        c.request_timeout = Duration::from_millis(50);
        c.probe_every = Duration::from_millis(300);
        let reg = start(&net, c);
        let nas_sent = || net.sent().iter().filter(|s| s.svc == SVC_NAS).count();
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::Timeout);
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::Timeout);
        // Open: fails at once, nothing sent.
        let t0 = Instant::now();
        for _ in 0..5 {
            assert_eq!(reg.request(SVC_NAS, 0x0043, &[]).unwrap_err(), QmiError::ModemNotReady(None));
        }
        assert!(t0.elapsed() < Duration::from_millis(40), "{:?}", t0.elapsed());
        assert_eq!(nas_sent(), 2);
        // Other services are not affected.
        answer.store(true, SeqCst);
        assert!(reg.request(SVC_DMS, 0x0025, &[]).is_ok());
        answer.store(false, SeqCst);
        // Half-open: one probe after the period; it times out, the circuit
        // stays open for another full period.
        thread::sleep(Duration::from_millis(320));
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::Timeout);
        assert_eq!(nas_sent(), 3);
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::ModemNotReady(None));
        assert_eq!(nas_sent(), 3);
        // The service recovers: the next probe gets a response and closes it.
        answer.store(true, SeqCst);
        thread::sleep(Duration::from_millis(320));
        assert!(reg.request(SVC_NAS, 0x0024, &[]).is_ok());
        assert!(reg.request(SVC_NAS, 0x0043, &[]).is_ok());
        assert!(reg.request(SVC_NAS, 0x0031, &[]).is_ok());
        assert_eq!(nas_sent(), 6);
    }

    #[test]
    fn a_qmi_error_response_closes_the_circuit_too() {
        let net = net_all_up();
        let answer = Arc::new(AtomicBool::new(false));
        let a = answer.clone();
        net.set_responder(move |_, m| a.load(SeqCst).then(|| encode(KIND_RESP, m.txn, m.id, &[result_tlv(Some(0x0003))])));
        let mut c = cfg();
        c.request_timeout = Duration::from_millis(30);
        c.probe_every = Duration::from_millis(50);
        let reg = start(&net, c);
        reg.request(SVC_NAS, 0x0024, &[]).unwrap_err();
        reg.request(SVC_NAS, 0x0024, &[]).unwrap_err();
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::ModemNotReady(None));
        answer.store(true, SeqCst);
        thread::sleep(Duration::from_millis(70));
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::CommandFailed(Some(0x0003)));
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::CommandFailed(Some(0x0003)));
    }

    #[test]
    fn a_link_rebuild_closes_an_open_circuit() {
        let net = net_all_up();
        let answer = Arc::new(AtomicBool::new(false));
        let a = answer.clone();
        net.set_responder(move |svc, m| if a.load(SeqCst) { Some(ok_reply(svc, m)) } else { None });
        let mut c = cfg();
        c.request_timeout = Duration::from_millis(30);
        c.probe_every = Duration::from_secs(60);
        let reg = start(&net, c);
        reg.request(SVC_NAS, 0x0024, &[]).unwrap_err();
        reg.request(SVC_NAS, 0x0024, &[]).unwrap_err();
        answer.store(true, SeqCst);
        assert_eq!(reg.request(SVC_NAS, 0x0024, &[]).unwrap_err(), QmiError::ModemNotReady(None));
        // NEW_SERVER at a new port (the post-SSR rebuild): closed at once.
        net.add_server(SVC_NAS, 0, 0x61);
        assert!(wait_until(|| reg.request(SVC_NAS, 0x0024, &[]).is_ok()));
    }

    #[test]
    fn a_deadline_cuts_the_wait_and_fails_later_requests_unsent() {
        let net = net_all_up();
        let mut c = cfg();
        c.request_timeout = Duration::from_secs(2);
        c.circuit_after = 0;
        let reg = start(&net, c);
        let t0 = Instant::now();
        let dl = Some(t0 + Duration::from_millis(80));
        assert_eq!(reg.request_by(SVC_NAS, 0x0024, &[], dl).unwrap_err(), QmiError::Timeout);
        let el = t0.elapsed();
        assert!(el >= Duration::from_millis(75) && el < Duration::from_millis(500), "{el:?}");
        assert_eq!(reg.request_by(SVC_NAS, 0x0024, &[], dl).unwrap_err(), QmiError::ModemNotReady(None));
        assert_eq!(net.sent().len(), 1);
        // A cut-short wait is not counted as a timeout by the circuit.
        let mut c = cfg();
        c.request_timeout = Duration::from_millis(500);
        let net = net_all_up();
        let reg = start(&net, c);
        for _ in 0..3 {
            let dl = Some(Instant::now() + Duration::from_millis(10));
            assert_eq!(reg.request_by(SVC_NAS, 0x0024, &[], dl).unwrap_err(), QmiError::Timeout);
        }
        assert_eq!(net.sent().len(), 3);
    }

    #[test]
    fn shutdown_closes_every_socket_and_fails_new_requests() {
        let net = net_all_up();
        echo(&net);
        let reg = start(&net, cfg());
        assert!(reg.request(SVC_NAS, 0x0024, &[]).is_ok());
        reg.shutdown();
        assert!(wait_until(|| net.open_sockets() == 0), "open: {}", net.open_sockets());
        assert!(reg.request(SVC_NAS, 0x0024, &[]).is_err());
        reg.shutdown();
    }
}
