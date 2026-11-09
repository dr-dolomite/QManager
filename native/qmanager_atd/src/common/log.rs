//! Writes /tmp/qmanager.log in qlog.sh's exact line format and rotation:
//! `[YYYY-MM-DD HH:MM:SS] LEVEL [component:pid] message`, 256 KB, 2 files.
//!
//! While the journal daemon runs (`journal/` is a directory and
//! `journal/alive` exists, see docs/plans/2026-11-10-logd-contract.md), a line
//! is appended to `journal/spool` as one `L` record instead, and logd writes
//! the text file. Same lock, same non-blocking open rules, no rotation.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl Level {
    pub fn parse(s: &str) -> Level {
        match s.trim() {
            "DEBUG" => Level::Debug,
            "WARN" => Level::Warn,
            "ERROR" => Level::Error,
            _ => Level::Info,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Level::Debug => "DEBUG",
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
    pub fn padded(self) -> &'static str {
        match self {
            Level::Debug => "DEBUG",
            Level::Info => "INFO ",
            Level::Warn => "WARN ",
            Level::Error => "ERROR",
        }
    }
}

pub struct Logger {
    pub component: &'static str,
    pub min: Level,
    pub path: String,
    /// The journal run dir (`QLOGD_RUN_DIR`), checked on every line.
    pub journal: String,
}

/// Where logd's spool lives unless `QLOGD_RUN_DIR` says otherwise.
pub const JOURNAL_RUN_DIR: &str = "/var/run/qmanager/journal";

const MAX_BYTES: u64 = 256 * 1024;
const MAX_FILES: u32 = 2;

/// Serialises rotate + write across every thread of the process (the broker's
/// acceptor, readers and AT lane all log). Without it two threads could both
/// see the file over the cap and rotate twice, losing `.1`, or interleave a
/// write with the rename. One process-wide lock, not one per `Logger`, because
/// every logger in the process shares the same file.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// OpenWrt keeps the POSIX TZ string in /etc/TZ (e.g. "PHT-8") and BusyBox
/// reads it; a static musl binary only honours $TZ. Without this, broker log
/// lines are stamped UTC while qlog.sh lines are local time.
pub fn init_tz() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if std::env::var_os("TZ").is_none() {
            if let Ok(tz) = fs::read_to_string("/etc/TZ") {
                let tz = tz.trim();
                if !tz.is_empty() {
                    std::env::set_var("TZ", tz);
                }
            }
        }
        unsafe { tzset() };
    });
}

extern "C" {
    fn tzset();
}

impl Logger {
    /// Level comes from $QLOG_LEVEL, else /etc/qmanager/log_level, else INFO.
    pub fn new(component: &'static str) -> Logger {
        init_tz();
        let lvl = std::env::var("QLOG_LEVEL")
            .ok()
            .or_else(|| fs::read_to_string("/etc/qmanager/log_level").ok())
            .map(|s| Level::parse(&s))
            .unwrap_or(Level::Info);
        Logger {
            component,
            min: lvl,
            path: std::env::var("QLOG_FILE").unwrap_or_else(|_| "/tmp/qmanager.log".into()),
            journal: std::env::var("QLOGD_RUN_DIR").unwrap_or_else(|_| JOURNAL_RUN_DIR.into()),
        }
    }

    fn rotate(&self) {
        // lstat: only our regular log rotates, never a planted link's target.
        let size = fs::symlink_metadata(&self.path)
            .map(|m| if m.file_type().is_file() { m.len() } else { 0 })
            .unwrap_or(0);
        if size < MAX_BYTES {
            return;
        }
        for i in (2..=MAX_FILES).rev() {
            let _ = fs::rename(format!("{}.{}", self.path, i - 1), format!("{}.{}", self.path, i));
        }
        let _ = fs::rename(&self.path, format!("{}.1", self.path));
    }

    pub fn log(&self, level: Level, msg: &str) {
        if level < self.min {
            return;
        }
        // A panic while holding it (tests only: release aborts) must not
        // silence every later line.
        let _w = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if self.spool(level, msg) {
            return;
        }
        self.rotate();
        let line = format!(
            "[{}] {} [{}:{}] {}\n",
            timestamp(),
            level.padded(),
            self.component,
            std::process::id(),
            msg
        );
        // /tmp is 1777 and rotation briefly leaves the path absent: never follow
        // a symlink planted there. This runs under the process-wide lock every
        // thread (the AT lane included) logs through, so it must never block:
        // O_NONBLOCK makes a planted FIFO fail the open (ENXIO, no reader) or
        // open without waiting, and anything but a regular file is refused,
        // dropping the line, as is a file someone else owns (a planted file
        // must not collect our log). A regular file ignores O_NONBLOCK.
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o644)
            .custom_flags(crate::common::safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(&self.path)
        {
            let euid = unsafe { libc::geteuid() };
            if f.metadata().map_or(false, |m| m.file_type().is_file() && m.uid() == euid) {
                let _ = f.write_all(line.as_bytes());
            }
        }
    }

    /// Appends one `L` record to the journal spool when logd is alive. False
    /// means the caller writes the legacy file: no daemon, or the spool could
    /// not be opened as our own regular file.
    fn spool(&self, level: Level, msg: &str) -> bool {
        if self.journal.is_empty() {
            return false;
        }
        let dir_ok = fs::symlink_metadata(&self.journal).map_or(false, |m| m.file_type().is_dir());
        if !dir_ok || fs::symlink_metadata(format!("{}/alive", self.journal)).is_err() {
            return false;
        }
        let mono = fs::read_to_string("/proc/uptime")
            .ok()
            .and_then(|s| s.split_whitespace().next().map(str::to_string))
            .unwrap_or_default();
        let clean: String = msg.chars().map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
        let line = format!("L\t{}\t{}\t{}\t{}\t{}\n", mono, level.name(), self.component, std::process::id(), clean);
        match OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .custom_flags(crate::common::safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(format!("{}/spool", self.journal))
        {
            Ok(mut f) => {
                let euid = unsafe { libc::geteuid() };
                if f.metadata().map_or(false, |m| m.file_type().is_file() && m.uid() == euid) {
                    let _ = f.write_all(line.as_bytes());
                    return true;
                }
                false
            }
            Err(_) => false,
        }
    }

    pub fn debug(&self, m: &str) {
        self.log(Level::Debug, m)
    }
    pub fn info(&self, m: &str) {
        self.log(Level::Info, m)
    }
    pub fn warn(&self, m: &str) {
        self.log(Level::Warn, m)
    }
    pub fn error(&self, m: &str) {
        self.log(Level::Error, m)
    }

    /// qlog_at_cmd: first 200 chars, newlines to spaces, CRs dropped.
    pub fn at_cmd(&self, cmd: &str, response: &str, ok: bool) {
        let mut t: String = response.chars().take(200).collect();
        if response.chars().count() > 200 {
            t.push_str("...[truncated]");
        }
        let t: String = t.chars().filter(|&c| c != '\r').map(|c| if c == '\n' { ' ' } else { c }).collect();
        if ok {
            self.debug(&format!("AT_CMD: {cmd} → {t}"));
        } else {
            self.warn(&format!("AT_CMD_FAIL: {cmd} → {t}"));
        }
    }
}

/// Local wall-clock time via localtime_r (the device's TZ comes from /etc/TZ).
fn timestamp() -> String {
    format_local(unsafe { libc::time(std::ptr::null_mut()) } as i64)
}

/// `YYYY-MM-DD HH:MM:SS` of epoch `t` in local time (call `init_tz` first).
pub fn format_local(t: i64) -> String {
    unsafe {
        let now = match t.try_into() {
            Ok(v) => v,
            Err(_) => return String::new(),
        };
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_format_matches_qlog() {
        let p = std::env::temp_dir().join(format!("qatd-log-{}", std::process::id()));
        let l = Logger { component: "atd", min: Level::Debug, path: p.to_str().unwrap().into(), journal: String::new() };
        l.info("hello");
        l.at_cmd("AT", "AT\r\r\nOK\r", true);
        let s = std::fs::read_to_string(&p).unwrap();
        let first = s.lines().next().unwrap();
        assert!(first.starts_with('['));
        assert!(first.contains("] INFO  [atd:"), "{first}");
        assert!(s.contains("AT_CMD: AT → AT OK"), "{s}");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn with_logd_alive_a_line_goes_to_the_spool_instead() {
        let d = std::env::temp_dir().join(format!("qatd-log-spool-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("journal")).unwrap();
        let file = d.join("qmanager.log");
        let l = Logger {
            component: "qmanager_atd",
            min: Level::Info,
            path: file.to_str().unwrap().into(),
            journal: d.join("journal").to_str().unwrap().into(),
        };
        l.info("no daemon yet");
        assert!(std::fs::read_to_string(&file).unwrap().contains("no daemon yet"));
        assert!(!d.join("journal/spool").exists());
        std::fs::write(d.join("journal/alive"), "1\n").unwrap();
        l.warn("AT reply\nsecond\rline");
        l.debug("below the level");
        let sp = std::fs::read_to_string(d.join("journal/spool")).unwrap();
        let f: Vec<&str> = sp.trim_end_matches('\n').split('\t').collect();
        assert_eq!(sp.lines().count(), 1, "{sp:?}");
        assert_eq!(f[0], "L");
        assert!(crate::logd::record::parse_mono(f[1]).is_some(), "{sp:?}");
        assert_eq!(&f[2..4], ["WARN", "qmanager_atd"]);
        assert_eq!(f[4], std::process::id().to_string());
        assert_eq!(f[5], "AT reply second line");
        assert!(!std::fs::read_to_string(&file).unwrap().contains("AT reply"), "not in the legacy file");
        // A spool that is not our own regular file: back to the legacy path.
        std::fs::remove_file(d.join("journal/spool")).unwrap();
        std::os::unix::fs::symlink(d.join("victim"), d.join("journal/spool")).unwrap();
        l.info("via legacy");
        assert!(std::fs::read_to_string(&file).unwrap().contains("via legacy"));
        assert!(!d.join("victim").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_planted_fifo_never_blocks_the_logger() {
        let p = std::env::temp_dir().join(format!("qatd-log-fifo-{}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        let c = std::ffi::CString::new(p.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        let l = Logger { component: "atd", min: Level::Debug, path: p.to_str().unwrap().into(), journal: String::new() };
        // No reader: a blocking open would hang here forever.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            l.info("dropped");
            let _ = tx.send(());
        });
        rx.recv_timeout(std::time::Duration::from_secs(2)).expect("logger blocked on a FIFO");
        // With a reader attached the open succeeds, but the line is refused.
        let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDONLY | libc::O_NONBLOCK) };
        assert!(fd >= 0);
        let l = Logger { component: "atd", min: Level::Debug, path: p.to_str().unwrap().into(), journal: String::new() };
        l.info("dropped too");
        let mut buf = [0u8; 64];
        let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        assert!(n <= 0, "nothing written to a non-regular file");
        unsafe { libc::close(fd) };
        let _ = std::fs::remove_file(&p);
    }
}
