//! /var/lock/qmanager.lock, shared with legacy qcmd (and, historically, the
//! retired sms_tool wrappers).
//! Same semantics as qcmd's flock_wait: non-blocking tries on a 100 ms grain
//! until the budget runs out, then one final try.

use std::fs::File;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::AsRawFd;
use std::thread;
use std::time::{Duration, Instant};

pub const LOCK_FILE: &str = "/var/lock/qmanager.lock";

pub struct LockFile {
    file: File,
}

pub struct Held<'a> {
    lock: &'a LockFile,
}

impl LockFile {
    pub fn open(path: &str) -> io::Result<LockFile> {
        if let Some(dir) = std::path::Path::new(path).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // /var/lock is 1777 on the device. A planted symlink, FIFO, hardlink or
        // foreign file would block the open, stop the broker starting, or let
        // its owner hold our flock; `open_own` replaces it with our own regular
        // file. The daemon's legit lock passes the check, so a fallback client
        // opening it while the daemon holds the flock never unlinks it.
        let file = crate::common::safefs::open_own(path, true, 0o600)?;
        // 0600 so no other user can open it to flock it; tightens a 0644 file
        // left by older builds. BusyBox flock in the health check runs as root.
        if file.metadata()?.permissions().mode() & 0o777 != 0o600 {
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(LockFile { file })
    }

    fn try_lock(&self) -> bool {
        unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 }
    }

    /// Waits up to `budget` for the exclusive lock.
    pub fn acquire(&self, budget: Duration) -> Option<Held<'_>> {
        let deadline = Instant::now() + budget;
        loop {
            if self.try_lock() {
                return Some(Held { lock: self });
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if self.try_lock() {
            Some(Held { lock: self })
        } else {
            None
        }
    }
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.lock.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_holder_waits_then_times_out() {
        let p = std::env::temp_dir().join(format!("qatd-lock-{}", std::process::id()));
        let p = p.to_str().unwrap();
        let a = LockFile::open(p).unwrap();
        let b = LockFile::open(p).unwrap();
        let held = a.acquire(Duration::from_millis(50)).unwrap();
        let t = Instant::now();
        assert!(b.acquire(Duration::from_millis(250)).is_none());
        assert!(t.elapsed() >= Duration::from_millis(250));
        drop(held);
        assert!(b.acquire(Duration::from_millis(50)).is_some());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn a_planted_fifo_never_blocks_the_lock_and_is_replaced() {
        use std::os::unix::fs::MetadataExt;
        let p = std::env::temp_dir().join(format!("qatd-lock-fifo-{}", std::process::id()));
        let p = p.to_str().unwrap().to_string();
        let _ = std::fs::remove_file(&p);
        crate::common::safefs::tests::mkfifo(&p);
        let q = p.clone();
        let a = crate::common::safefs::tests::within_2s(move || LockFile::open(&q)).unwrap();
        let m = std::fs::symlink_metadata(&p).unwrap();
        assert!(m.file_type().is_file(), "FIFO replaced by a regular file");
        assert_eq!(m.mode() & 0o777, 0o600);
        // The legit file is reused, not unlinked: both handles share one inode,
        // so the flock still excludes.
        let b = LockFile::open(&p).unwrap();
        assert_eq!(std::fs::symlink_metadata(&p).unwrap().ino(), m.ino());
        let held = a.acquire(Duration::ZERO).unwrap();
        assert!(b.acquire(Duration::ZERO).is_none());
        drop(held);
        assert!(b.acquire(Duration::ZERO).is_some());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_planted_hardlink_is_not_used_as_the_lock() {
        use std::os::unix::fs::MetadataExt;
        let victim = std::env::temp_dir().join(format!("qatd-lock-victim-{}", std::process::id()));
        let p = std::env::temp_dir().join(format!("qatd-lock-hl-{}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        std::fs::write(&victim, b"SECRET").unwrap();
        std::fs::hard_link(&victim, &p).unwrap();
        let _l = LockFile::open(p.to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET");
        assert_eq!(std::fs::symlink_metadata(&p).unwrap().nlink(), 1);
        assert_eq!(std::fs::symlink_metadata(&victim).unwrap().nlink(), 1);
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&victim);
    }
}
