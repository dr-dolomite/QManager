//! The daemon: one thread, one `poll(2)` over the inotify fd (spool and debug
//! lease), the listening socket and the stop fd (signalfd for TERM/INT). The
//! poll timeout is the nearest real deadline, so an idle logd never wakes.
//!
//! Socket framing (contract): request `<VERB> <nbytes>\n` then nbytes of
//! `k=v` pairs joined by NUL (0 bytes for STAT); reply `RES <0|1> <nbytes>\n`
//! then the JSON, or `ERR <code>\n`. One request per connection, peer uid
//! must be logd's own euid (root in production), body cap 4 KB.

use super::core::{read_uptime, Config, Engine, Now};
use crate::common::log::Level;
use crate::common::safefs;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::io::{AsRawFd, RawFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::time::Duration;

pub const BODY_CAP: usize = 4096;
pub const REPLY_CAP: usize = 1024 * 1024;
const INGEST_DELAY_MS: u64 = 200;
const GRACE_MS: u64 = 100;

pub fn encode_request(verb: &str, args: &[String]) -> Vec<u8> {
    let body = args.join("\0");
    let mut v = format!("{verb} {}\n", body.len()).into_bytes();
    v.extend_from_slice(body.as_bytes());
    v
}

/// Splits a whole request. None unless the header is well formed and the
/// body is exactly the announced length and every pair is `k=v`.
pub fn decode_request(buf: &[u8]) -> Option<(String, Vec<(String, String)>)> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let mut it = header.split(' ');
    let verb = it.next()?;
    let len: usize = it.next()?.parse().ok()?;
    if it.next().is_some() || verb.is_empty() || !verb.bytes().all(|b| b.is_ascii_uppercase()) {
        return None;
    }
    let body = &buf[nl + 1..];
    if body.len() != len || len > BODY_CAP {
        return None;
    }
    let body = std::str::from_utf8(body).ok()?;
    let mut kv = Vec::new();
    if !body.is_empty() {
        for p in body.split('\0') {
            let (k, v) = p.split_once('=')?;
            kv.push((k.to_string(), v.to_string()));
        }
    }
    Some((verb.to_string(), kv))
}

#[derive(Debug, PartialEq)]
pub enum Answer {
    Res(bool, String),
    Err(&'static str),
}

pub fn encode_answer(a: &Answer) -> Vec<u8> {
    match a {
        Answer::Res(ok, json) => {
            let mut v = format!("RES {} {}\n", if *ok { 0 } else { 1 }, json.len()).into_bytes();
            v.extend_from_slice(json.as_bytes());
            v
        }
        Answer::Err(code) => format!("ERR {code}\n").into_bytes(),
    }
}

pub fn decode_answer(buf: &[u8]) -> Option<Answer> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let body = &buf[nl + 1..];
    let mut it = header.split(' ');
    match it.next()? {
        "RES" => {
            let ok = match it.next()? {
                "0" => true,
                "1" => false,
                _ => return None,
            };
            let n: usize = it.next()?.parse().ok()?;
            (body.len() == n).then(|| Answer::Res(ok, String::from_utf8_lossy(body).into_owned()))
        }
        "ERR" => {
            let code = it.next()?;
            Some(Answer::Err(match code {
                "bad_request" => "bad_request",
                "unknown_verb" => "unknown_verb",
                "too_large" => "too_large",
                _ => "error",
            }))
        }
        _ => None,
    }
}

/// Routes one decoded request to the engine.
pub fn answer(e: &mut Engine, verb: &str, params: &[(String, String)], now: &Now) -> Answer {
    let a = match verb {
        "STAT" => Answer::Res(true, e.stat(now)),
        _ => match e.query(verb, params, now) {
            Some(r) => r,
            None => Answer::Err("unknown_verb"),
        },
    };
    match a {
        Answer::Res(_, ref j) if j.len() > REPLY_CAP => Answer::Err("too_large"),
        a => a,
    }
}

/// The connecting peer's uid, from the kernel.
pub fn peer_uid(s: &UnixStream) -> Option<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let r = unsafe {
        libc::getsockopt(s.as_raw_fd(), libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut libc::c_void, &mut len)
    };
    (r == 0).then_some(cred.uid)
}

/// One connection: authenticate, read to EOF (bounded), answer.
pub fn serve(mut s: UnixStream, e: &mut Engine, now: &Now, uid: u32) {
    let _ = s.set_nonblocking(false);
    let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
    if peer_uid(&s) != Some(uid) {
        let _ = s.write_all(&encode_answer(&Answer::Err("bad_request")));
        return;
    }
    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    loop {
        match s.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                let _ = s.write_all(&encode_answer(&Answer::Err("bad_request")));
                return;
            }
        }
        if buf.len() > BODY_CAP + 64 {
            let _ = s.write_all(&encode_answer(&Answer::Err("too_large")));
            return;
        }
    }
    let a = match decode_request(&buf) {
        Some((verb, params)) => answer(e, &verb, &params, now),
        None => Answer::Err("bad_request"),
    };
    let _ = s.write_all(&encode_answer(&a));
}

fn boottime_cs() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut ts) };
    ts.tv_sec as u64 * 100 + ts.tv_nsec as u64 / 10_000_000
}

pub fn real_now(cfg: &Config) -> Now {
    Now {
        mono_cs: read_uptime(&cfg.uptime).unwrap_or_else(boottime_cs),
        wall: unsafe { libc::time(std::ptr::null_mut()) } as i64,
    }
}

/// Opens a spool file for reading only if it is our own regular file.
fn open_spool(path: &str) -> Option<std::fs::File> {
    let f = std::fs::OpenOptions::new().read(true).custom_flags(safefs::NOFOLLOW | libc::O_NONBLOCK).open(path).ok()?;
    let m = f.metadata().ok()?;
    (m.file_type().is_file() && m.uid() == unsafe { libc::geteuid() }).then_some(f)
}

/// Reads and removes `spool.work` (a crash leftover or the renamed spool).
fn ingest_work(cfg: &Config, e: &mut Engine) {
    let work = format!("{}/spool.work", cfg.run_dir);
    if std::fs::symlink_metadata(&work).is_err() {
        return;
    }
    if let Some(f) = open_spool(&work) {
        let now = real_now(cfg);
        e.ingest_reader(f, &now);
    }
    let _ = std::fs::remove_file(&work);
}

/// Renames `spool` to `spool.work`; true when there was one.
fn take_spool(cfg: &Config, e: &mut Engine) -> bool {
    let work = format!("{}/spool.work", cfg.run_dir);
    if std::fs::symlink_metadata(&work).is_ok() {
        ingest_work(cfg, e);
    }
    std::fs::rename(format!("{}/spool", cfg.run_dir), &work).is_ok()
}

/// Drains everything queued now: leftover work file, then the spool after a
/// grace so a writer mid-`printf` lands.
fn drain_now(cfg: &Config, e: &mut Engine) {
    ingest_work(cfg, e);
    if take_spool(cfg, e) {
        std::thread::sleep(Duration::from_millis(GRACE_MS));
        ingest_work(cfg, e);
    }
}

fn watch(fd: RawFd, dir: &str) -> bool {
    let c = match std::ffi::CString::new(dir) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mask = libc::IN_MODIFY | libc::IN_CREATE | libc::IN_MOVED_TO | libc::IN_DELETE | libc::IN_CLOSE_WRITE;
    unsafe { libc::inotify_add_watch(fd, c.as_ptr(), mask) >= 0 }
}

/// What a batch of inotify events asks for.
#[derive(Default, Debug, PartialEq)]
pub struct Wakes {
    pub spool: bool,
    pub debug: bool,
    pub lost_watch: bool,
}

/// Parses a buffer of `struct inotify_event`s.
pub fn parse_inotify(buf: &[u8]) -> Wakes {
    let mut w = Wakes::default();
    let hdr = std::mem::size_of::<libc::inotify_event>();
    let mut i = 0;
    while i + hdr <= buf.len() {
        let ev: libc::inotify_event = unsafe { std::ptr::read_unaligned(buf[i..].as_ptr() as *const libc::inotify_event) };
        let len = ev.len as usize;
        let name_b = buf.get(i + hdr..i + hdr + len).unwrap_or(&[]);
        let name = name_b.split(|&b| b == 0).next().unwrap_or(&[]);
        if ev.mask & libc::IN_Q_OVERFLOW != 0 {
            w.spool = true;
            w.debug = true;
        }
        if ev.mask & (libc::IN_IGNORED | libc::IN_DELETE_SELF) != 0 {
            w.lost_watch = true;
        }
        match name {
            b"spool" => w.spool = true,
            b"debug" => w.debug = true,
            _ => {}
        }
        i += hdr + len;
    }
    w
}

fn write_alive(cfg: &Config) {
    let _ = safefs::write_atomic(&format!("{}/alive", cfg.run_dir), format!("{}\n", std::process::id()).as_bytes());
}

fn ensure_run_dir(cfg: &Config) -> std::io::Result<()> {
    if let Some(parent) = std::path::Path::new(&cfg.run_dir).parent() {
        if !parent.as_os_str().is_empty() && std::fs::symlink_metadata(parent).is_err() {
            std::fs::create_dir_all(parent)?;
        }
    }
    safefs::ensure_own_dir(&cfg.run_dir, 0o700)
}

/// A signalfd for TERM/INT (blocked for this thread first).
fn stop_signalfd() -> RawFd {
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        libc::signalfd(-1, &set, libc::SFD_NONBLOCK | libc::SFD_CLOEXEC)
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Phase {
    Idle,
    Wait(u64),
    Grace(u64),
}

/// Runs the daemon until the stop fd is readable (None: TERM/INT via a
/// signalfd). Returns the exit code.
pub fn run(cfg: Config, stop: Option<RawFd>) -> i32 {
    crate::common::log::init_tz();
    let err = |m: String| {
        let _ = writeln!(std::io::stderr(), "qmanager_logd: {m}");
        1
    };
    if UnixStream::connect(&cfg.sock).is_ok() {
        return err(format!("another logd is answering on {}; not starting", cfg.sock));
    }
    if let Err(e) = ensure_run_dir(&cfg) {
        return err(format!("cannot make {}: {e}", cfg.run_dir));
    }
    // Writers fall back to the legacy files until `alive` is written.
    let _ = std::fs::remove_file(format!("{}/alive", cfg.run_dir));
    let stop_fd = match stop {
        Some(fd) => fd,
        None => stop_signalfd(),
    };
    let ino = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
    if ino < 0 || !watch(ino, &cfg.run_dir) {
        return err("cannot watch the run dir".into());
    }
    let now = real_now(&cfg);
    let mut e = match Engine::open(cfg.clone(), &now) {
        Ok(e) => e,
        Err(x) => return err(format!("cannot open the journal {}: {x}", cfg.journal_dir)),
    };
    drain_now(&cfg, &mut e);
    e.on_debug_file(&real_now(&cfg));

    let _ = std::fs::remove_file(&cfg.sock);
    let old = unsafe { libc::umask(0o177) };
    let bound = UnixListener::bind(&cfg.sock);
    unsafe { libc::umask(old) };
    let listener = match bound {
        Ok(l) => l,
        Err(x) => return err(format!("cannot bind {}: {x}", cfg.sock)),
    };
    let _ = listener.set_nonblocking(true);
    let _ = safefs::write_atomic(&cfg.proto, super::capability_body().as_bytes());
    write_alive(&cfg);
    let now = real_now(&cfg);
    let up = format!("journal up (boot {}, seq {}, version {})", e.boot, e.head(), env!("CARGO_PKG_VERSION"));
    e.self_log(Level::Info, &up, &now);
    let uid = unsafe { libc::geteuid() };

    let mut phase = Phase::Idle;
    let mut again = false;
    let mut buf = vec![0u8; 4096];
    loop {
        let now = real_now(&cfg);
        e.tick(&now);
        match phase {
            Phase::Wait(t) if now.ms() >= t => {
                phase = if take_spool(&cfg, &mut e) { Phase::Grace(now.ms() + GRACE_MS) } else { Phase::Idle };
            }
            Phase::Grace(t) if now.ms() >= t => {
                ingest_work(&cfg, &mut e);
                phase = if std::mem::take(&mut again) { Phase::Wait(now.ms() + INGEST_DELAY_MS) } else { Phase::Idle };
            }
            _ => {}
        }
        let now = real_now(&cfg);
        let mut dl = e.next_deadline(&now);
        if let Phase::Wait(t) | Phase::Grace(t) = phase {
            dl = Some(dl.map_or(t, |d| d.min(t)));
        }
        let timeout: i32 = match dl {
            None => -1,
            Some(d) => (d.saturating_sub(now.ms()).min(i32::MAX as u64) as i32).max(5),
        };
        let mut fds = [
            libc::pollfd { fd: stop_fd, events: libc::POLLIN, revents: 0 },
            libc::pollfd { fd: ino, events: libc::POLLIN, revents: 0 },
            libc::pollfd { fd: listener.as_raw_fd(), events: libc::POLLIN, revents: 0 },
        ];
        let r = unsafe { libc::poll(fds.as_mut_ptr(), 3, timeout) };
        if r < 0 {
            continue;
        }
        if fds[0].revents != 0 {
            break;
        }
        if fds[1].revents & libc::POLLIN != 0 {
            let mut w = Wakes::default();
            loop {
                let n = unsafe { libc::read(ino, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                if n <= 0 {
                    break;
                }
                let x = parse_inotify(&buf[..n as usize]);
                w.spool |= x.spool;
                w.debug |= x.debug;
                w.lost_watch |= x.lost_watch;
            }
            let now = real_now(&cfg);
            if w.lost_watch && std::fs::symlink_metadata(format!("{}/alive", cfg.run_dir)).is_err() {
                // The run dir was removed under us: make it again, re-watch.
                if ensure_run_dir(&cfg).is_ok() && watch(ino, &cfg.run_dir) {
                    write_alive(&cfg);
                }
            }
            if w.debug {
                e.on_debug_file(&now);
            }
            if w.spool {
                match phase {
                    Phase::Idle => phase = Phase::Wait(now.ms() + INGEST_DELAY_MS),
                    Phase::Wait(_) => {}
                    Phase::Grace(_) => again = true,
                }
            }
        }
        if fds[2].revents & libc::POLLIN != 0 {
            while let Ok((s, _)) = listener.accept() {
                let now = real_now(&cfg);
                serve(s, &mut e, &now, uid);
            }
        }
    }

    // Stop: writers back to the legacy files first, then drain and flush.
    let _ = std::fs::remove_file(format!("{}/alive", cfg.run_dir));
    drain_now(&cfg, &mut e);
    let now = real_now(&cfg);
    e.shutdown(&now);
    let _ = std::fs::remove_file(&cfg.sock);
    let _ = std::fs::remove_file(&cfg.proto);
    unsafe { libc::close(ino) };
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_round_trip_with_exact_length() {
        let r = encode_request("LOGQ", &["min_level=WARN".into(), "search=a b=c".into()]);
        assert_eq!(
            decode_request(&r),
            Some(("LOGQ".into(), vec![("min_level".into(), "WARN".into()), ("search".into(), "a b=c".into())]))
        );
        assert_eq!(decode_request(b"STAT 0\n"), Some(("STAT".into(), vec![])));
        assert!(decode_request(&r[..r.len() - 1]).is_none());
        let mut padded = r.clone();
        padded.push(b'x');
        assert!(decode_request(&padded).is_none());
        for bad in [&b"STAT\n"[..], b"STAT 0 1\n", b"stat 0\n", b"LOGQ 3\nabc", b" 0\n"] {
            assert!(decode_request(bad).is_none(), "{bad:?}");
        }
        let big = encode_request("LOGQ", &[format!("search={}", "x".repeat(BODY_CAP))]);
        assert!(decode_request(&big).is_none());
    }

    #[test]
    fn answers_round_trip() {
        let a = Answer::Res(true, "{\"a\":1}".into());
        assert_eq!(decode_answer(&encode_answer(&a)), Some(a));
        assert_eq!(decode_answer(b"RES 1 2\n{}"), Some(Answer::Res(false, "{}".into())));
        assert_eq!(decode_answer(b"ERR unknown_verb\n"), Some(Answer::Err("unknown_verb")));
        assert!(decode_answer(b"RES 0 5\n{}").is_none());
        assert!(decode_answer(b"NOPE\n").is_none());
    }

    #[test]
    fn inotify_names_route_to_spool_and_debug() {
        let mk = |mask: u32, name: &str| {
            let hdr = std::mem::size_of::<libc::inotify_event>();
            let len = if name.is_empty() { 0 } else { (name.len() + 1 + 15) / 16 * 16 };
            let mut v = vec![0u8; hdr + len];
            let ev = libc::inotify_event { wd: 1, mask, cookie: 0, len: len as u32 };
            unsafe { std::ptr::write_unaligned(v.as_mut_ptr() as *mut libc::inotify_event, ev) };
            v[hdr..hdr + name.len()].copy_from_slice(name.as_bytes());
            v
        };
        let mut b = mk(libc::IN_MODIFY, "spool.work");
        assert_eq!(parse_inotify(&b), Wakes::default());
        b.extend(mk(libc::IN_MODIFY, "spool"));
        b.extend(mk(libc::IN_CREATE, "debug"));
        assert_eq!(parse_inotify(&b), Wakes { spool: true, debug: true, lost_watch: false });
        assert!(parse_inotify(&mk(libc::IN_IGNORED, "")).lost_watch);
        assert!(parse_inotify(&mk(libc::IN_Q_OVERFLOW, "")).spool);
    }
}
