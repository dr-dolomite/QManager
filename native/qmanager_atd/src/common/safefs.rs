//! File writes that never follow symlinks. /tmp and /var/lock are both 1777 on
//! the device, so any local process can pre-plant a symlink at a well-known
//! path (/tmp/qmanager_long_running, /var/lock/qmanager.pid). A root process
//! writing through it would clobber an arbitrary file. Legacy qcmd's
//! `echo … > "$LONG_FLAG"` had this flaw; the broker must not.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;

/// Open flags shared by every QManager state file the broker touches.
pub const NOFOLLOW: i32 = libc::O_NOFOLLOW | libc::O_CLOEXEC;

fn open_nofollow(path: &str, create_new: bool) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.write(true).mode(0o644).custom_flags(NOFOLLOW);
    if create_new {
        o.create_new(true);
    } else {
        o.create(true).truncate(true);
    }
    o.open(path)
}

fn is_symlink_refusal(e: &io::Error) -> bool {
    // O_NOFOLLOW on a symlink fails with ELOOP.
    e.raw_os_error() == Some(libc::ELOOP)
}

/// Writes `contents` to `path` without ever following a symlink at `path`. If
/// a symlink is planted there, it is unlinked (unlink never follows) and the
/// file is recreated with O_CREAT|O_EXCL so a racing re-plant also fails.
pub fn write_nofollow(path: &str, contents: &[u8]) -> io::Result<()> {
    let mut f = match open_nofollow(path, false) {
        Ok(f) => f,
        Err(e) if is_symlink_refusal(&e) => {
            std::fs::remove_file(path)?;
            open_nofollow(path, true)?
        }
        Err(e) => return Err(e),
    };
    f.write_all(contents)
}

/// Command text for a state file: one line, no CR/LF injection.
pub fn one_line(s: &str) -> String {
    s.chars().filter(|&c| c != '\n' && c != '\r').collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp(name: &str) -> String {
        std::env::temp_dir()
            .join(format!("qatd-{name}-{}", std::process::id()))
            .to_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn writes_a_regular_file() {
        let p = tmp("reg");
        write_nofollow(&p, b"AT+QSCAN=3,1\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"AT+QSCAN=3,1\n");
        write_nofollow(&p, b"x").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"x", "truncates on rewrite");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn never_writes_through_a_planted_symlink() {
        let victim = tmp("victim");
        let flag = tmp("flag");
        std::fs::write(&victim, b"SECRET").unwrap();
        symlink(&victim, &flag).unwrap();

        write_nofollow(&flag, b"attacker text").unwrap();

        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET", "victim untouched");
        let meta = std::fs::symlink_metadata(&flag).unwrap();
        assert!(meta.file_type().is_file(), "symlink replaced by a regular file");
        assert_eq!(std::fs::read(&flag).unwrap(), b"attacker text");
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_file(&flag);
    }

    #[test]
    fn one_line_strips_crlf() {
        assert_eq!(one_line("AT+X\r\nrm -rf /\n"), "AT+Xrm -rf /");
    }
}
