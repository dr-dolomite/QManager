//! The one execution path shared by the daemon and the in-process fallback.
//! Mirrors legacy qcmd: long-flag gate, warm-up for long commands, lock budgets,
//! error-code mapping. Output framing is produced by the caller from `Outcome`.

use crate::at::channel::{AtError, Channel, Device};
use crate::at::classify;
use crate::common::lock::LockFile;
use crate::common::log::Logger;
use crate::at::output::Code;
use crate::common::safefs::{one_line, write_nofollow};
use std::time::{Duration, Instant};

pub const LONG_FLAG: &str = "/tmp/qmanager_long_running";

pub const SHORT_DEADLINE: Duration = Duration::from_secs(20);
pub const LONG_DEADLINE: Duration = Duration::from_secs(300);
pub const SLOW_DEADLINE: Duration = Duration::from_secs(60);
pub const LOCK_WAIT_SHORT: Duration = Duration::from_secs(5);
const LOCK_WAIT_LONG: Duration = Duration::from_secs(10);

pub enum Outcome {
    /// Raw bytes exactly as atcli printed them (echo + body + terminator).
    Ok(Vec<u8>),
    Err(Code),
}

pub struct Executor<'a, D: Device> {
    pub ch: &'a mut Channel<D>,
    pub lock: &'a LockFile,
    pub log: &'a Logger,
}

fn deadline_for(cmd: &str, long: bool) -> Instant {
    let d = if long {
        LONG_DEADLINE
    } else if classify::is_slow(cmd) {
        SLOW_DEADLINE
    } else {
        SHORT_DEADLINE
    };
    Instant::now() + d
}

/// Margin before a lock-free flag is treated as abandoned: a flag younger than
/// this may belong to a caller that has only just started a long command (the
/// retired shell qcmd also wrote it before waiting up to LOCK_WAIT_LONG).
const STALE_FLAG_AGE: Duration = Duration::from_secs(15);

/// True while a long command holds the modem (the scan_in_progress gate).
pub fn long_running() -> bool {
    long_flag_trusted(LONG_FLAG)
}

/// The one rule for "the long flag is up", shared by every client and the
/// live sampler: lstat (never a link's target) shows a regular file with one
/// link, owned by root or by us. /tmp is 1777, so anything else at the path
/// is a plant that would otherwise force scan_in_progress on every short
/// command. Root because the broker writes the flag and runs as root on the
/// device; our own uid so a client sees a flag its same-user broker wrote
/// (tests, dev runs). A non-root plant can never be uid 0.
pub fn long_flag_trusted(path: &str) -> bool {
    use std::os::unix::fs::MetadataExt;
    let euid = unsafe { libc::geteuid() };
    std::fs::symlink_metadata(path)
        .map_or(false, |m| m.file_type().is_file() && m.nlink() == 1 && (m.uid() == 0 || m.uid() == euid))
}

/// Removes a long flag left by a holder that died mid-command (killed broker,
/// broker restart during a scan). Without this every short command answers
/// scan_in_progress until the main service restarts. Safe only when nobody
/// holds the modem lock and the flag is older than STALE_FLAG_AGE. A planted
/// entry (not a trusted flag) is removed at once, whatever its age; a planted
/// directory is not removed recursively, only logged and left.
pub fn clear_stale_long_flag(lock: &LockFile, log: &Logger) {
    clear_long_flag_at(LONG_FLAG, lock, log)
}

fn clear_long_flag_at(path: &str, lock: &LockFile, log: &Logger) {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };
    if !long_flag_trusted(path) {
        match std::fs::remove_file(path) {
            Ok(()) => log.warn(&format!("Removed untrusted entry at long-command flag {path}")),
            Err(e) => log.warn(&format!("Untrusted entry at long-command flag {path} left in place ({e})")),
        }
        return;
    }
    let age = match meta.modified() {
        Ok(t) => t.elapsed().unwrap_or(Duration::ZERO),
        Err(_) => return,
    };
    if age < STALE_FLAG_AGE {
        return;
    }
    if let Some(_held) = lock.acquire(Duration::ZERO) {
        if std::fs::remove_file(path).is_ok() {
            log.warn(&format!("Removed stale long-command flag (age {}s, modem lock free)", age.as_secs()));
        }
    }
}

/// Raises the long flag before a long command. The watchdog, poller and scan
/// CGIs read only a trusted flag; a long command run without one looks like
/// an idle modem and could be "recovered" mid-scan. So if the flag cannot be
/// written even after healing (a planted directory, say), the command is
/// refused as modem_busy and any partial file is removed.
fn raise_long_flag(path: &str, cmd: &str, log: &Logger) -> Result<(), Code> {
    match write_nofollow(path, format!("{}\n", one_line(cmd)).as_bytes()) {
        Ok(()) => Ok(()),
        Err(e) => {
            if std::fs::symlink_metadata(path).map_or(false, |m| m.file_type().is_file()) {
                let _ = std::fs::remove_file(path);
            }
            log.error(&format!("Cannot raise long-command flag for: {cmd} ({e})"));
            Err(Code::ModemBusy)
        }
    }
}

fn log_drained(log: &Logger, drained: &[u8], cmd: &str) {
    let d = String::from_utf8_lossy(drained);
    let d: String = d.chars().take(120).filter(|&c| c != '\r').map(|c| if c == '\n' { ' ' } else { c }).collect();
    log.debug(&format!("drained stale/URC before {cmd}: {d}"));
}

/// The one AtError -> error-code mapping, shared by AT requests and SMS ops.
fn map_error(log: &Logger, cmd: &str, e: AtError) -> Code {
    match e {
        AtError::Timeout => {
            log.error(&format!("Command killed by deadline: {cmd}"));
            Code::CommandTimeout
        }
        AtError::NotReady => {
            log.error(&format!("Channel not ready for: {cmd}"));
            Code::ModemNotReady
        }
        // The channel went away under us (SSR / glink reset): the modem is
        // restarting, the command was not at fault.
        e @ AtError::Eof => {
            log.error(&format!("Channel lost during: {cmd} ({e:?})"));
            Code::ModemNotReady
        }
        AtError::Io(e) if crate::at::channel::is_reset(&e) => {
            log.error(&format!("Channel reset during: {cmd} ({e:?})"));
            Code::ModemNotReady
        }
        e => {
            log.error(&format!("Command failed: {cmd} ({e:?})"));
            Code::CommandFailed
        }
    }
}

/// Several exchanges under one hold of the modem lock (an SMS operation).
/// Every exchange is bounded by its own timeout and by the session's end.
pub struct Session<'s, D: Device> {
    ch: &'s mut Channel<D>,
    log: &'s Logger,
    end: Instant,
}

impl<D: Device> Session<'_, D> {
    fn bound(&self, timeout: Duration) -> Option<Instant> {
        let now = Instant::now();
        (now < self.end).then(|| (now + timeout).min(self.end))
    }

    /// One AT exchange. Replies are not logged: SMS listings carry message
    /// bodies (one-time codes), which must not land in the log.
    pub fn at(&mut self, cmd: &str, timeout: Duration) -> Result<Vec<u8>, Code> {
        let Some(deadline) = self.bound(timeout) else {
            self.log.error(&format!("SMS session out of time before: {cmd}"));
            return Err(Code::CommandTimeout);
        };
        let r = self.ch.exchange(cmd, deadline);
        if !self.ch.last_drained.is_empty() {
            log_drained(self.log, &self.ch.last_drained, cmd);
        }
        r.map_err(|e| map_error(self.log, cmd, e))
    }

    /// A prompt exchange (AT+CMGS): `payload` is written after the `> ` prompt.
    pub fn at_prompt(&mut self, cmd: &str, payload: &[u8], prompt: Duration, timeout: Duration) -> Result<Vec<u8>, Code> {
        let Some(deadline) = self.bound(timeout) else {
            self.log.error(&format!("SMS session out of time before: {cmd}"));
            return Err(Code::CommandTimeout);
        };
        let r = self.ch.exchange_prompt(cmd, payload, Instant::now() + prompt, deadline);
        r.map_err(|e| map_error(self.log, cmd, e))
    }
}

/// Longest an SMS session may hold the modem. Kept under the client's 340 s
/// reply timeout so a long multipart send never looks like a frozen broker.
pub const SESSION_LIMIT: Duration = Duration::from_secs(270);

impl<D: Device> Executor<'_, D> {
    /// Runs `f` under one acquisition of the modem lock, with the same gate and
    /// budget as a short AT command (scan_in_progress, modem_busy, queue time
    /// counted against the 5 s budget).
    pub fn session<T>(
        &mut self,
        label: &str,
        waited: Duration,
        f: impl FnOnce(&mut Session<'_, D>) -> T,
    ) -> Result<T, Code> {
        if long_running() {
            self.log.log(crate::common::log::Level::Debug, "LOCK: Blocked by long command");
            return Err(Code::ScanInProgress);
        }
        if waited > LOCK_WAIT_SHORT {
            self.log.error(&format!("Lock acquisition failed for: {label} (queued {}ms)", waited.as_millis()));
            return Err(Code::ModemBusy);
        }
        let _held = match self.lock.acquire(LOCK_WAIT_SHORT - waited) {
            Some(h) => h,
            None => {
                self.log.error(&format!("Lock acquisition failed for: {label}"));
                return Err(Code::ModemBusy);
            }
        };
        let mut s = Session { ch: &mut *self.ch, log: self.log, end: Instant::now() + SESSION_LIMIT };
        Ok(f(&mut s))
    }

    pub fn run(&mut self, cmd: &str) -> Outcome {
        self.run_after(cmd, Duration::ZERO)
    }

    /// `waited` is how long the caller already queued for this exchange (time
    /// in the broker's accept queue). It counts against the lock budget, so a
    /// request waits no longer in total than legacy qcmd waited for the lock.
    pub fn run_after(&mut self, cmd: &str, waited: Duration) -> Outcome {
        // Checked here too, not only in the client: the socket is the trust
        // boundary. Refused before the lock, so it never delays anyone.
        if !classify::is_at_command(cmd) {
            self.log.warn(&format!("Rejected non-AT command: {}", one_line(cmd)));
            return Outcome::Err(Code::InvalidCommand);
        }
        let long = classify::is_long(cmd);

        // A long command is in progress: short commands fast-reject, exactly
        // like legacy qcmd's LONG_FLAG branch.
        if !long && long_running() {
            self.log.log(crate::common::log::Level::Debug, &format!("LOCK: Blocked by long command"));
            return Outcome::Err(Code::ScanInProgress);
        }

        let budget = if long { LOCK_WAIT_LONG } else { LOCK_WAIT_SHORT };
        if waited > budget {
            self.log.error(&format!("Lock acquisition failed for: {cmd} (queued {}ms)", waited.as_millis()));
            return Outcome::Err(Code::ModemBusy);
        }
        let _held = match self.lock.acquire(budget - waited) {
            Some(h) => h,
            None => {
                self.log.error(&format!("Lock acquisition failed for: {cmd}"));
                return Outcome::Err(Code::ModemBusy);
            }
        };

        if long {
            if let Err(code) = raise_long_flag(LONG_FLAG, cmd, self.log) {
                return Outcome::Err(code);
            }
            self.log.info(&format!("Long command started: {cmd}"));
            // Warm-up flush, like qcmd:191-192. A failure here is modem_not_ready.
            if let Err(e) = self.ch.exchange("AT", Instant::now() + Duration::from_secs(3)) {
                let _ = std::fs::remove_file(LONG_FLAG);
                self.log.error(&format!("Modem warm-up failed before: {cmd} ({e:?})"));
                return Outcome::Err(Code::ModemNotReady);
            }
        }

        let outcome = match self.ch.exchange(cmd, deadline_for(cmd, long)) {
            Ok(raw) => {
                if !self.ch.last_drained.is_empty() {
                    log_drained(self.log, &self.ch.last_drained, cmd);
                }
                self.log.at_cmd(cmd, &String::from_utf8_lossy(&raw), true);
                Outcome::Ok(raw)
            }
            Err(e) => Outcome::Err(map_error(self.log, cmd, e)),
        };

        if long {
            let _ = std::fs::remove_file(LONG_FLAG);
            self.log.info(&format!("Long command completed: {cmd}"));
        }
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;

    #[test]
    fn request_queued_past_the_lock_budget_is_busy_and_never_sent() {
        let p = std::env::temp_dir().join(format!("qatd-exec-lock-{}", std::process::id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        // Opening the channel at all would mean the command reached the modem.
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &lock, log: &log };
        let out = ex.run_after("AT+CSQ", LOCK_WAIT_SHORT + Duration::from_millis(1));
        assert!(matches!(out, Outcome::Err(Code::ModemBusy)));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn non_at_input_is_refused_without_the_lock_or_the_modem() {
        let p = std::env::temp_dir().join(format!("qatd-exec-invalid-{}", std::process::id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        // Hold the lock: a refusal must not wait for it.
        let _held = lock.acquire(Duration::ZERO).unwrap();
        let other = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &other, log: &log };
        for cmd in ["--bogus", "hello", "AT\rhello"] {
            let t = Instant::now();
            assert!(matches!(ex.run(cmd), Outcome::Err(Code::InvalidCommand)), "{cmd:?}");
            assert!(t.elapsed() < Duration::from_millis(500), "{cmd:?} waited {:?}", t.elapsed());
        }
        let _ = std::fs::remove_file(p);
    }

    fn tmp(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("qatd-exec-{name}-{}", std::process::id()));
        let p = p.to_str().unwrap().to_string();
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn only_an_own_regular_file_counts_as_the_long_flag() {
        let p = tmp("flag");
        assert!(!long_flag_trusted(&p), "absent");
        std::fs::write(&p, b"AT+QSCAN=3,1\n").unwrap();
        assert!(long_flag_trusted(&p), "own regular file");
        // Hardlinked: nlink 2.
        let link = tmp("flag-hl");
        std::fs::hard_link(&p, &link).unwrap();
        assert!(!long_flag_trusted(&link));
        assert!(!long_flag_trusted(&p));
        std::fs::remove_file(&link).unwrap();
        // Symlink to a regular file: lstat, never the target.
        let sl = tmp("flag-sl");
        std::os::unix::fs::symlink(&p, &sl).unwrap();
        assert!(!long_flag_trusted(&sl));
        std::fs::remove_file(&sl).unwrap();
        std::fs::remove_file(&p).unwrap();
        crate::common::safefs::tests::mkfifo(&p);
        assert!(!long_flag_trusted(&p), "FIFO");
        std::fs::remove_file(&p).unwrap();
        std::fs::create_dir(&p).unwrap();
        assert!(!long_flag_trusted(&p), "directory");
        std::fs::remove_dir(&p).unwrap();
    }

    #[test]
    fn an_unwritable_long_flag_refuses_the_long_command() {
        let log = Logger::new("test");
        let p = tmp("raise");
        assert!(raise_long_flag(&p, "AT+QSCAN=3,1", &log).is_ok());
        assert!(long_flag_trusted(&p));
        std::fs::remove_file(&p).unwrap();
        // A planted directory cannot be healed: busy, directory untouched.
        std::fs::create_dir(&p).unwrap();
        assert!(matches!(raise_long_flag(&p, "AT+QSCAN=3,1", &log), Err(Code::ModemBusy)));
        assert!(std::fs::symlink_metadata(&p).unwrap().file_type().is_dir());
        std::fs::remove_dir(&p).unwrap();
    }

    #[test]
    fn a_planted_long_flag_is_cleared_at_start_whatever_its_age() {
        let lp = tmp("clear-lock");
        let lock = LockFile::open(&lp).unwrap();
        let log = Logger::new("test");
        let p = tmp("clear-flag");
        // A fresh trusted flag is kept (it may belong to a starting caller).
        std::fs::write(&p, b"AT+QSCAN=3,1\n").unwrap();
        clear_long_flag_at(&p, &lock, &log);
        assert!(std::path::Path::new(&p).exists());
        std::fs::remove_file(&p).unwrap();
        // A fresh FIFO is removed at once, even with the lock held elsewhere.
        let other = LockFile::open(&lp).unwrap();
        let _held = other.acquire(Duration::ZERO).unwrap();
        crate::common::safefs::tests::mkfifo(&p);
        clear_long_flag_at(&p, &lock, &log);
        assert!(std::fs::symlink_metadata(&p).is_err(), "FIFO removed");
        // A directory is left in place, not removed recursively.
        std::fs::create_dir(&p).unwrap();
        std::fs::write(format!("{p}/keep"), b"k").unwrap();
        clear_long_flag_at(&p, &lock, &log);
        assert!(std::path::Path::new(&format!("{p}/keep")).exists());
        let _ = std::fs::remove_dir_all(&p);
        let _ = std::fs::remove_file(&lp);
    }
}
