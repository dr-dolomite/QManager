//! File writes that never follow symlinks. /tmp and /var/lock are both 1777 on
//! the device, so any local process can pre-plant a symlink at a well-known
//! path (/tmp/qmanager_long_running, /var/lock/qmanager.lock). A root process
//! writing through it would clobber an arbitrary file. Legacy qcmd's
//! `echo … > "$LONG_FLAG"` had this flaw; the broker must not.
//!
//! A symlink is not the only plant. A FIFO blocks a plain open forever (the
//! AT lane would freeze holding the modem lock), and a hardlink or someone
//! else's file would be truncated or handed to us. So every state file is
//! opened O_NONBLOCK, fstat-checked, and healed (unlinked, recreated O_EXCL)
//! when it is not ours. The `fs.protected_fifos/regular=2` sysctl shipped by
//! the installer is defence in depth only: it misses root-owned plants, the
//! boot window before sysctl runs, post-uninstall and kernels before 4.19.

use std::fs::{File, Metadata, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

/// Open flags shared by every QManager state file the broker touches.
pub const NOFOLLOW: i32 = libc::O_NOFOLLOW | libc::O_CLOEXEC;

/// NOFOLLOW plus O_NONBLOCK: a planted FIFO fails the open (ENXIO, write-only
/// with no reader) or opens without waiting (O_RDWR) instead of blocking. A
/// regular file ignores O_NONBLOCK.
const STATE_FLAGS: i32 = NOFOLLOW | libc::O_NONBLOCK;

fn euid() -> u32 {
    unsafe { libc::geteuid() }
}

/// A state file we may write or lock: a regular file owned by the effective
/// user with exactly one link (nlink > 1 means a hardlink to some other file).
pub fn is_own_file(m: &Metadata) -> bool {
    m.file_type().is_file() && m.uid() == euid() && m.nlink() == 1
}

/// Open errors that mean something hostile sits at the path and can be healed
/// by unlinking it: ELOOP (symlink, O_NOFOLLOW), ENXIO (FIFO with no reader,
/// or a socket / device node), EISDIR (a directory: the heal refuses it),
/// EACCES (protected_fifos/regular refusing someone else's entry in a sticky
/// dir). A genuine EACCES on the directory itself fails again at the unlink
/// or the O_EXCL create, so it still surfaces as an error.
fn is_plant(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(libc::ELOOP | libc::ENXIO | libc::EISDIR | libc::EACCES))
}

/// Opens (creating if absent) a state file that is guaranteed to be our own
/// regular file, without ever blocking or following a link. Anything else at
/// the path is unlinked once and the file recreated O_CREAT|O_EXCL, so a
/// racing re-plant fails the create instead of being trusted. A directory is
/// never removed: Err, left in place. No retry loop: one heal, then Err.
pub(crate) fn open_own(path: &str, read: bool, mode: u32) -> io::Result<File> {
    let open = |create_new: bool| {
        let mut o = OpenOptions::new();
        o.read(read).write(true).mode(mode).custom_flags(STATE_FLAGS);
        if create_new {
            o.create_new(true);
        } else {
            o.create(true);
        }
        o.open(path)
    };
    match open(false) {
        Ok(f) if f.metadata().map_or(false, |m| is_own_file(&m)) => return Ok(f),
        Ok(_) => {}
        Err(e) if is_plant(&e) => {}
        Err(e) => return Err(e),
    }
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_dir() => {
            return Err(io::Error::from_raw_os_error(libc::EISDIR));
        }
        Ok(_) => std::fs::remove_file(path)?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let f = open(true)?;
    if f.metadata().map_or(false, |m| is_own_file(&m)) {
        Ok(f)
    } else {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "state file not trustworthy"))
    }
}

/// Writes `contents` to `path` as our own regular file (see `open_own`): a
/// planted symlink, FIFO, hardlink or foreign file is replaced, never written
/// through or truncated. Truncation happens only after the fstat check.
pub fn write_nofollow(path: &str, contents: &[u8]) -> io::Result<()> {
    let mut f = open_own(path, false, 0o644)?;
    f.set_len(0)?;
    f.write_all(contents)
}

/// The O_EXCL temp file for `write_atomic`.
fn create_temp(path: &str) -> io::Result<File> {
    OpenOptions::new().write(true).create_new(true).mode(0o644).custom_flags(STATE_FLAGS).open(path)
}

/// Replaces `path` with `contents` atomically: written to `<path>.new`
/// (O_EXCL + O_NOFOLLOW, mode 0644), then renamed over `path`. A leftover or
/// planted `.new` is unlinked first (unlink acts on a symlink itself; a
/// planted directory is removed with its contents, never followed), and
/// rename replaces a symlink at `path` rather than following it. A directory
/// planted at `path` itself is refused (rename cannot replace it) and left
/// alone. Readers see the old file or the whole new one, never a partial
/// write; a failure removes the temp file.
pub fn write_atomic(path: &str, contents: &[u8]) -> io::Result<()> {
    let tmp = format!("{path}.new");
    clear_temp(&tmp);
    if let Err(e) = create_temp(&tmp).and_then(|mut f| f.write_all(contents)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })
}

/// Removes whatever sits at a temp path: a file or link is unlinked, a real
/// directory (lstat, so never a link's target) removed recursively;
/// `remove_dir_all` does not follow symlinks inside it.
fn clear_temp(tmp: &str) {
    match std::fs::symlink_metadata(tmp) {
        Ok(m) if m.file_type().is_dir() => {
            let _ = std::fs::remove_dir_all(tmp);
        }
        Ok(_) => {
            let _ = std::fs::remove_file(tmp);
        }
        Err(_) => {}
    }
}

/// Makes `dir` a real directory owned by the effective user with `mode`, as
/// `qm_root_dir` does for the shell side: a symlink, file or someone else's
/// directory at `dir` is removed first (unlink never follows a link). Err if
/// it cannot be made trustworthy; the caller must then not write into it.
/// Called before every publish, so the steady state is one lstat: an own
/// directory is only chmodded when its mode is wrong.
pub fn ensure_own_dir(dir: &str, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let euid = euid();
    if let Ok(m) = std::fs::symlink_metadata(dir) {
        if m.file_type().is_dir() && m.uid() == euid {
            if m.mode() & 0o7777 == mode {
                return Ok(());
            }
            return std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode));
        }
        if m.file_type().is_dir() {
            std::fs::remove_dir_all(dir)?;
        } else {
            std::fs::remove_file(dir)?;
        }
    }
    std::fs::create_dir(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode))?;
    let m = std::fs::symlink_metadata(dir)?;
    if m.file_type().is_dir() && m.uid() == euid {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "run dir not trustworthy"))
    }
}

/// Command text for a state file: one line, no CR/LF injection.
pub fn one_line(s: &str) -> String {
    s.chars().filter(|&c| c != '\n' && c != '\r').collect()
}

#[cfg(test)]
pub(crate) mod tests {
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

    pub(crate) fn mkfifo(p: &str) {
        let c = std::ffi::CString::new(p).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
    }

    /// Runs `f` on a thread; panics if it has not returned within 2 s.
    pub(crate) fn within_2s<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(std::time::Duration::from_secs(2)).expect("blocked on a planted entry")
    }

    #[test]
    fn a_planted_fifo_is_replaced_without_blocking() {
        let p = tmp("fifo");
        let _ = std::fs::remove_file(&p);
        mkfifo(&p);
        let q = p.clone();
        within_2s(move || write_nofollow(&q, b"AT+QSCAN=3,1\n")).unwrap();
        assert!(std::fs::symlink_metadata(&p).unwrap().file_type().is_file());
        assert_eq!(std::fs::read(&p).unwrap(), b"AT+QSCAN=3,1\n");
        // With a reader attached the open succeeds (no ENXIO); the fstat check
        // must still refuse to write into the FIFO.
        std::fs::remove_file(&p).unwrap();
        mkfifo(&p);
        let c = std::ffi::CString::new(p.as_str()).unwrap();
        let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDONLY | libc::O_NONBLOCK) };
        assert!(fd >= 0);
        let q = p.clone();
        within_2s(move || write_nofollow(&q, b"x")).unwrap();
        let mut buf = [0u8; 8];
        let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        assert!(n <= 0, "nothing written into the FIFO");
        unsafe { libc::close(fd) };
        assert_eq!(std::fs::read(&p).unwrap(), b"x");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_planted_hardlink_never_truncates_its_target() {
        let victim = tmp("hl-victim");
        let flag = tmp("hl-flag");
        let _ = std::fs::remove_file(&flag);
        std::fs::write(&victim, b"SECRET").unwrap();
        std::fs::hard_link(&victim, &flag).unwrap();
        write_nofollow(&flag, b"attacker text").unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"SECRET", "victim untouched");
        let m = std::fs::symlink_metadata(&flag).unwrap();
        assert!(m.file_type().is_file() && m.nlink() == 1, "its own file now");
        assert_eq!(std::fs::read(&flag).unwrap(), b"attacker text");
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_file(&flag);
    }

    #[test]
    fn a_planted_directory_is_refused_and_left_alone() {
        let d = tmp("plant-dir");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        std::fs::write(format!("{d}/keep"), b"k").unwrap();
        assert!(write_nofollow(&d, b"x").is_err());
        assert!(std::path::Path::new(&format!("{d}/keep")).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_foreign_owned_file_is_replaced() {
        // chown needs root; skipped otherwise.
        if euid() != 0 {
            return;
        }
        let p = tmp("foreign");
        std::fs::write(&p, b"theirs").unwrap();
        std::os::unix::fs::chown(&p, Some(65534), Some(65534)).unwrap();
        write_nofollow(&p, b"ours").unwrap();
        let m = std::fs::symlink_metadata(&p).unwrap();
        assert_eq!(m.uid(), 0);
        assert_eq!(std::fs::read(&p).unwrap(), b"ours");
        let _ = std::fs::remove_file(&p);
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
        // A directory planted at the temp name is removed, not written into.
        std::fs::create_dir_all(format!("{p}.new/sub")).unwrap();
        write_atomic(&p, b"four\n").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"four\n");
        assert!(!std::path::Path::new(&format!("{p}.new")).exists());
        // A directory planted at the target is refused cleanly, left alone,
        // and no temp file is left behind.
        let d = tmp("atomic-dir");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir(&d).unwrap();
        std::fs::write(format!("{d}/keep"), b"k").unwrap();
        assert!(write_atomic(&d, b"x").is_err());
        assert!(std::path::Path::new(&format!("{d}/keep")).exists());
        assert!(!std::path::Path::new(&format!("{d}.new")).exists());
        let _ = std::fs::remove_dir_all(&d);
        // An unwritable directory fails cleanly and leaves nothing behind.
        assert!(write_atomic("/nonexistent-dir-qatd/x", b"x").is_err());
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&victim);
    }

    #[test]
    fn ensure_own_dir_replaces_links_files_and_keeps_a_good_dir() {
        use std::os::unix::fs::PermissionsExt;
        let base = tmp("owndir");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir(&base).unwrap();
        let d = format!("{base}/run");
        ensure_own_dir(&d, 0o700).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::write(format!("{d}/keep"), b"x").unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::path::Path::new(&format!("{d}/keep")).exists(), "a good dir is kept");
        // A loosened mode is put back (the steady state skips the chmod).
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o777)).unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o7777, 0o700);
        // A planted symlink is replaced, its target untouched.
        let victim = format!("{base}/victim");
        std::fs::create_dir(&victim).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
        symlink(&victim, &d).unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::fs::symlink_metadata(&d).unwrap().file_type().is_dir());
        assert!(std::path::Path::new(&victim).exists());
        // A planted file is replaced.
        std::fs::remove_dir_all(&d).unwrap();
        std::fs::write(&d, b"f").unwrap();
        ensure_own_dir(&d, 0o700).unwrap();
        assert!(std::fs::symlink_metadata(&d).unwrap().file_type().is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_line_strips_crlf() {
        assert_eq!(one_line("AT+X\r\nrm -rf /\n"), "AT+Xrm -rf /");
    }
}
