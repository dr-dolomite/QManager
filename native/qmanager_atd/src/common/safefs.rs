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

/// Replaces `path` with `contents` atomically: written to `<path>.new`
/// (O_EXCL + O_NOFOLLOW, mode 0644), then renamed over `path`. A leftover or
/// planted `.new` is unlinked first (unlink acts on a symlink itself), and
/// rename replaces a symlink at `path` rather than following it. Readers see
/// the old file or the whole new one, never a partial write; a failure removes
/// the temp file.
pub fn write_atomic(path: &str, contents: &[u8]) -> io::Result<()> {
    let tmp = format!("{path}.new");
    let _ = std::fs::remove_file(&tmp);
    if let Err(e) = open_nofollow(&tmp, true).and_then(|mut f| f.write_all(contents)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })
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
    fn write_atomic_replaces_whole_and_leaves_no_temp() {
        let p = tmp("atomic");
        write_atomic(&p, b"one\n").unwrap();
        write_atomic(&p, b"two\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // A planted link at the target is replaced, not written through; a
        // planted link at the temp name is unlinked, not followed.
        let victim = tmp("atomic-victim");
        std::fs::write(&victim, b"SECRET").unwrap();
        std::fs::remove_file(&p).unwrap();
        symlink(&victim, &p).unwrap();
        symlink(&victim, format!("{p}.new")).unwrap();
        write_atomic(&p, b"three\n").unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET");
        assert!(std::fs::symlink_metadata(&p).unwrap().file_type().is_file());
        assert_eq!(std::fs::read(&p).unwrap(), b"three\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // An unwritable directory fails cleanly and leaves nothing behind.
        assert!(write_atomic("/nonexistent-dir-qatd/x", b"x").is_err());
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&victim);
    }

    #[test]
    fn one_line_strips_crlf() {
        assert_eq!(one_line("AT+X\r\nrm -rf /\n"), "AT+Xrm -rf /");
    }
}
