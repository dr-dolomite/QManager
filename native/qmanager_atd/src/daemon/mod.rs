//! The broker: bind the socket, accept one request per connection and serve
//! it (AT or SMS), serialised by the modem lock.

use crate::at::exec::{self, Executor, Outcome};
use crate::at::new_channel;
use crate::at::channel::Channel;
use crate::at::output::Code;
use crate::common::lock::{self, LockFile};
use crate::common::log::Logger;
use crate::common::proto;
use crate::sms;
use std::io::{Read, Write};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::time::Duration;

pub(crate) fn run_daemon() -> i32 {
    let log = Logger::new("qmanager_atd");
    let lock = match LockFile::open(lock::LOCK_FILE) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot open lock file: {e}"));
            return 1;
        }
    };
    // Never take over a live broker: unlinking its socket would leave it
    // serving nobody while every client fell back to in-process. A stale
    // socket (no listener) refuses the connect and is replaced as before.
    if UnixStream::connect(proto::SOCKET_PATH).is_ok() {
        log.error(&format!("another broker is listening on {}; not starting", proto::SOCKET_PATH));
        return 1;
    }
    let _ = std::fs::remove_file(proto::SOCKET_PATH);
    // Root-only from the instant it exists: /dev/smd11 is crw------- root, and
    // uhttpd runs CGIs as root, so no legitimate caller needs more. Setting the
    // umask before bind (not chmod after) leaves no window where the socket is
    // reachable by other users. /var/run is root:root 0755.
    let old_mask = unsafe { libc::umask(0o177) };
    let bound = UnixListener::bind(proto::SOCKET_PATH);
    unsafe { libc::umask(old_mask) };
    let listener = match bound {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot bind {}: {e}", proto::SOCKET_PATH));
            return 1;
        }
    };
    log.info(&format!("broker up, listening on {}", proto::SOCKET_PATH));
    // After the bind: the file promises a broker that is already reachable.
    if let Err(e) = proto::write_proto_file(proto::PROTO_PATH) {
        log.warn(&format!("cannot write {}: {e}", proto::PROTO_PATH));
    }
    exec::clear_stale_long_flag(&lock, &log);

    let mut ch = new_channel();
    for conn in listener.incoming() {
        match conn {
            Ok(stream) => serve(stream, &mut ch, &lock, &log),
            Err(e) => {
                // e.g. EMFILE: back off instead of spinning on the log.
                log.warn(&format!("accept failed: {e}"));
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
    0
}

/// Largest AT request accepted. An AT command is well under 1 KB.
const MAX_REQUEST: usize = 8192;
/// Largest SMS request: 255 parts of 67 UTF-16 units is ~51 KB of UTF-8.
const MAX_SMS_REQUEST: usize = 64 * 1024;

/// True once the client closed its end completely (not just its write half),
/// i.e. nobody is waiting for this reply any more: the caller was killed while
/// queued (CGI timeout, `timeout` wrapper). Legacy qcmd, killed while waiting
/// for the lock, never ran the command either.
pub(crate) fn peer_gone(stream: &UnixStream) -> bool {
    let mut pfd = libc::pollfd { fd: stream.as_raw_fd(), events: 0, revents: 0 };
    let r = unsafe { libc::poll(&mut pfd, 1, 0) };
    r > 0 && pfd.revents & (libc::POLLHUP | libc::POLLERR) != 0
}

fn refuse(stream: &mut UnixStream, log: &Logger, why: &str) {
    log.warn(&format!("refused request: {why}"));
    let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Err(Code::CommandFailed)));
}

/// The connecting peer's uid, from the kernel (cannot be spoofed by the peer).
fn peer_uid(stream: &UnixStream) -> Option<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let r = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut libc::ucred as *mut libc::c_void,
            &mut len,
        )
    };
    (r == 0).then_some(cred.uid)
}

fn serve(mut stream: UnixStream, ch: &mut Channel<std::fs::File>, lock: &LockFile, log: &Logger) {
    // Defense in depth behind the 0600 socket: only root may drive the modem,
    // the same boundary /dev/smd11 itself enforces.
    match peer_uid(&stream) {
        Some(0) => {}
        other => {
            log.warn(&format!("rejected AT request from non-root peer (uid {other:?})"));
            let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Err(Code::CommandFailed)));
            return;
        }
    }
    // The client writes its whole request at once and half-closes, so a live
    // client is done in microseconds. A short timeout bounds how long a stuck
    // peer can hold up everyone queued behind it.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // Read the whole request to EOF. Anything that doesn't end cleanly (read
    // error, timeout, oversize) is refused: a partial command must never run.
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) => return refuse(&mut stream, log, &format!("incomplete read ({e})")),
        }
        // The kind is known from the first bytes; an AT request keeps its cap.
        let cap = if buf.starts_with(b"SMS ") { MAX_SMS_REQUEST } else { MAX_REQUEST };
        if buf.len() > cap {
            return refuse(&mut stream, log, "oversize");
        }
    }
    if buf.starts_with(b"SMS ") {
        return serve_sms(stream, &buf, ch, lock, log);
    }
    let (cmd, sent_ms) = match proto::decode_request(&buf) {
        Some(r) if !r.cmd.is_empty() => (r.cmd.to_string(), r.sent_ms),
        _ => return refuse(&mut stream, log, "malformed or truncated"),
    };
    if peer_gone(&stream) {
        log.warn(&format!("caller gone before its turn, not run: {cmd}"));
        return;
    }
    let waited = Duration::from_millis(proto::mono_ms().saturating_sub(sent_ms));
    let reply = match (Executor { ch, lock, log }).run_after(&cmd, waited) {
        Outcome::Ok(raw) => proto::Reply::Ok(raw),
        Outcome::Err(code) => proto::Reply::Err(code),
    };
    let _ = stream.write_all(&proto::encode_reply(&reply));
}

fn serve_sms(mut stream: UnixStream, buf: &[u8], ch: &mut Channel<std::fs::File>, lock: &LockFile, log: &Logger) {
    let req = match proto::decode_sms_request(buf) {
        Some(r) => r,
        None => return refuse(&mut stream, log, "malformed or truncated SMS request"),
    };
    // Re-validated here: the socket is the trust boundary, not the client.
    let op = match sms::parse_args(&req.args) {
        Ok(op) => op,
        Err(e) => {
            let body = sms::error_json("bad_args", Some(&e)).into_bytes();
            let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Res(false, body)));
            return;
        }
    };
    if peer_gone(&stream) {
        log.warn(&format!("caller gone before its turn, not run: {}", op.label()));
        return;
    }
    let waited = Duration::from_millis(proto::mono_ms().saturating_sub(req.sent_ms));
    let (ok, json) = sms::run(&mut Executor { ch, lock, log }, &op, waited);
    let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Res(ok, json.into_bytes())));
}
