//! Writes /tmp/qmanager.log in qlog.sh's exact line format and rotation:
//! `[YYYY-MM-DD HH:MM:SS] LEVEL [component:pid] message`, 256 KB, 2 files.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;

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
    fn padded(self) -> &'static str {
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
}

const MAX_BYTES: u64 = 256 * 1024;
const MAX_FILES: u32 = 2;

/// OpenWrt keeps the POSIX TZ string in /etc/TZ (e.g. "PHT-8") and BusyBox
/// reads it; a static musl binary only honours $TZ. Without this, broker log
/// lines are stamped UTC while qlog.sh lines are local time.
fn init_tz() {
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
        }
    }

    fn rotate(&self) {
        let size = fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
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
        // a symlink planted there.
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o644)
            .custom_flags(crate::common::safefs::NOFOLLOW)
            .open(&self.path)
        {
            let _ = f.write_all(line.as_bytes());
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
    unsafe {
        let now = libc::time(std::ptr::null_mut());
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
        let l = Logger { component: "atd", min: Level::Debug, path: p.to_str().unwrap().into() };
        l.info("hello");
        l.at_cmd("AT", "AT\r\r\nOK\r", true);
        let s = std::fs::read_to_string(&p).unwrap();
        let first = s.lines().next().unwrap();
        assert!(first.starts_with('['));
        assert!(first.contains("] INFO  [atd:"), "{first}");
        assert!(s.contains("AT_CMD: AT → AT OK"), "{s}");
        let _ = std::fs::remove_file(p);
    }
}
