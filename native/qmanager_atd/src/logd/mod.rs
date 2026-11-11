//! `qmanager_logd`: the journal daemon, an argv0 role of this binary.
//!
//! Writers (qlog.sh, events.sh, the broker's log.rs) append one tab-separated
//! record per line to `journal/spool` while `journal/alive` exists. logd wakes
//! on inotify, renames the spool, reads it after a grace, assigns a global
//! sequence number, maps mono to wall time (History's trust rules), collapses
//! repeats, keeps a RAM ring, writes the legacy text and events files and
//! appends to per-day flash files with per-file `fdatasync`. It answers
//! `STAT` (and the query verbs) on its own socket for the `qlog` client.
//!
//! Contract: docs/plans/2026-11-10-logd-contract.md. Plan:
//! docs/plans/2026-11-10-qmanager-logd-journal.md.
//!
//! It is a separate process from the AT broker and shares nothing with it but
//! code: nothing here can stall the AT lane.

pub mod clock;
pub mod collapse;
pub mod core;
pub mod journal;
pub mod kmsg;
pub mod mirror;
pub mod query;
pub mod record;
pub mod registry;
pub mod ring;
pub mod server;
pub mod spool;

/// logd's socket protocol (`STAT`, `LOGQ`, `EVQ`, `LCLR`; framing in server.rs).
pub const PROTO: u32 = 1;

pub fn version_line() -> String {
    format!("qmanager_logd {} proto={}", env!("CARGO_PKG_VERSION"), PROTO)
}

/// The capability file, written after the socket is bound.
pub fn capability_body(kmsg: bool) -> String {
    let k = if kmsg { "kmsg=1\n" } else { "" };
    format!("proto={}\nversion={}\nlogq=1\nevq=1\nlclr=1\n{k}", PROTO, env!("CARGO_PKG_VERSION"))
}

#[derive(Debug, PartialEq)]
pub enum LogdMode {
    Daemon,
    Version,
    Usage,
}

/// Like the atd name: the daemon starts only with no arguments or `-d` /
/// `--daemon`; `--version` alone answers; anything else is refused.
pub fn logd_mode(rest: &[String]) -> LogdMode {
    match rest {
        [] => LogdMode::Daemon,
        [a] if a == "-d" || a == "--daemon" => LogdMode::Daemon,
        [a] if a == "--version" => LogdMode::Version,
        _ => LogdMode::Usage,
    }
}

pub fn run_logd(rest: &[String]) -> i32 {
    use std::io::Write;
    match logd_mode(rest) {
        LogdMode::Version => {
            let _ = writeln!(std::io::stdout(), "{}", version_line());
            0
        }
        LogdMode::Usage => {
            let _ = writeln!(std::io::stderr(), "usage: qmanager_logd [-d|--daemon] | --version (queries go through qlog)");
            2
        }
        LogdMode::Daemon => server::run(core::Config::from_env(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::core::tests::cfg;
    use super::*;
    use std::time::{Duration, Instant};

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_logd_name_starts_a_daemon_only_when_asked_plainly() {
        assert_eq!(logd_mode(&sv(&[])), LogdMode::Daemon);
        assert_eq!(logd_mode(&sv(&["-d"])), LogdMode::Daemon);
        assert_eq!(logd_mode(&sv(&["--daemon"])), LogdMode::Daemon);
        assert_eq!(logd_mode(&sv(&["--version"])), LogdMode::Version);
        for bad in [&["stat"][..], &["-d", "-d"], &["--version", "x"], &["--bogus"]] {
            assert_eq!(logd_mode(&sv(bad)), LogdMode::Usage, "{bad:?}");
        }
        assert!(version_line().starts_with("qmanager_logd ") && version_line().ends_with(" proto=1"));
        assert_eq!(capability_body(false), format!("proto=1\nversion={}\nlogq=1\nevq=1\nlclr=1\n", env!("CARGO_PKG_VERSION")));
        assert!(capability_body(true).ends_with("lclr=1\nkmsg=1\n"));
    }

    fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
        let end = Instant::now() + Duration::from_secs(5);
        while !f() {
            assert!(Instant::now() < end, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub(crate) fn start(name: &str) -> (core::Config, i32, std::thread::JoinHandle<i32>) {
        let c = cfg(name);
        let mut p = [0i32; 2];
        assert_eq!(unsafe { libc::pipe(p.as_mut_ptr()) }, 0);
        let c2 = c.clone();
        let h = std::thread::spawn(move || server::run(c2, Some(p[0])));
        let alive = format!("{}/alive", c.run_dir);
        wait_for("alive", || std::path::Path::new(&alive).exists());
        (c, p[1], h)
    }

    pub(crate) fn stop(wfd: i32, h: std::thread::JoinHandle<i32>) {
        unsafe { libc::write(wfd, b"x".as_ptr() as *const libc::c_void, 1) };
        assert_eq!(h.join().unwrap(), 0);
    }

    pub(crate) fn spool(c: &core::Config, text: &str) {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(format!("{}/spool", c.run_dir)).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn the_daemon_ingests_answers_and_stops_cleanly() {
        let (c, wfd, h) = start("daemon");
        // A second daemon refuses while the first answers.
        assert_eq!(server::run(c.clone(), Some(-1)), 1);
        assert!(std::fs::read_to_string(&c.proto).unwrap().starts_with("proto=1\n"));
        spool(&c, "L\t1.00\tWARN\tpoller\t42\tfirst line\nE\t1.00\tband_change\twarning\t\tfrom=B3;to=B7\tLTE band B3 -> B7\n");
        wait_for("text mirror", || std::fs::read_to_string(&c.text_log).map_or(false, |s| s.contains("[poller:42] first line")));
        wait_for("events mirror", || std::fs::read_to_string(&c.events_mirror).map_or(false, |s| s.contains("\"type\":\"band_change\"")));
        // A warning event is urgent: on flash within ~2 s.
        wait_for("flash", || {
            std::fs::read_dir(&c.journal_dir).unwrap().flatten().any(|e| e.file_name().to_str().unwrap().starts_with("ev-"))
        });
        let stat = crate::client::qlog::call(&c.sock, "STAT", &[]).unwrap();
        match stat {
            server::Answer::Res(true, j) => {
                assert!(j.contains("\"WARN\":1") && j.contains("\"events\":1"), "{j}");
                assert!(j.contains(&format!("\"version\":\"{}\"", env!("CARGO_PKG_VERSION"))));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(crate::client::qlog::call(&c.sock, "NOPE", &[]), Ok(server::Answer::Err("unknown_verb"))));
        match crate::client::qlog::call(&c.sock, "LOGQ", &["min_level=WARN".into()]).unwrap() {
            server::Answer::Res(true, j) => assert!(j.contains("first line") && j.contains("\"entries\":[{"), "{j}"),
            other => panic!("{other:?}"),
        }
        match crate::client::qlog::call(&c.sock, "EVQ", &["fmt=hist".into()]).unwrap() {
            server::Answer::Res(true, j) => assert!(j.starts_with("{\"k\":\"e\",\"t\":") && j.contains("\"radio\":\"lte\""), "{j}"),
            other => panic!("{other:?}"),
        }
        assert!(matches!(crate::client::qlog::call(&c.sock, "EVQ", &["limit=0".into()]), Ok(server::Answer::Res(false, _))));
        assert!(matches!(crate::client::qlog::call(&c.sock, "LOGQ", &["nokey".into()]), Ok(server::Answer::Err("bad_request"))));
        let head1 = match crate::client::qlog::call(&c.sock, "STAT", &[]).unwrap() {
            server::Answer::Res(_, j) => j.split("\"head_seq\":").nth(1).unwrap().split(',').next().unwrap().parse::<u64>().unwrap(),
            _ => panic!(),
        };
        stop(wfd, h);
        assert!(!std::path::Path::new(&format!("{}/alive", c.run_dir)).exists(), "alive removed");
        assert!(!std::path::Path::new(&c.sock).exists());
        // A restart keeps seq monotonic.
        let mut p = [0i32; 2];
        assert_eq!(unsafe { libc::pipe(p.as_mut_ptr()) }, 0);
        let c2 = c.clone();
        let h = std::thread::spawn(move || server::run(c2, Some(p[0])));
        wait_for("alive again", || std::path::Path::new(&format!("{}/alive", c.run_dir)).exists());
        let head2 = match crate::client::qlog::call(&c.sock, "STAT", &[]).unwrap() {
            server::Answer::Res(_, j) => j.split("\"head_seq\":").nth(1).unwrap().split(',').next().unwrap().parse::<u64>().unwrap(),
            _ => panic!(),
        };
        assert!(head2 > head1, "{head2} > {head1}");
        stop(p[1], h);
    }

    #[test]
    fn the_daemon_reads_a_kernel_log_once_and_advertises_it() {
        let mut c = cfg("kmsg-daemon");
        let k = format!("{}/kmsg", c.run_dir.trim_end_matches("/run"));
        std::fs::write(&k, crate::logd::kmsg::tests::FIXTURE).unwrap();
        c.kmsg = k;
        let mut p = [0i32; 2];
        assert_eq!(unsafe { libc::pipe(p.as_mut_ptr()) }, 0);
        let c2 = c.clone();
        let h = std::thread::spawn(move || server::run(c2, Some(p[0])));
        wait_for("alive", || std::path::Path::new(&format!("{}/alive", c.run_dir)).exists());
        assert!(std::fs::read_to_string(&c.proto).unwrap().ends_with("kmsg=1\n"));
        wait_for("kernel rows", || match crate::client::qlog::call(&c.sock, "STAT", &[]) {
            Ok(server::Answer::Res(true, j)) => j.contains("\"kept\":13"),
            _ => false,
        });
        match crate::client::qlog::call(&c.sock, "LOGQ", &["kind=K".into(), "tag=ssr".into(), "limit=1".into(), "fmt=mono".into()]).unwrap() {
            server::Answer::Res(true, j) => assert_eq!(j, "812"),
            other => panic!("{other:?}"),
        }
        stop(p[1], h);
    }

    #[test]
    fn a_spool_left_by_a_crash_is_drained_before_alive() {
        let c = cfg("leftover");
        std::fs::write(format!("{}/spool.work", c.run_dir), "L\t1\tINFO\ta\t1\tfrom the crash\n").unwrap();
        std::fs::write(format!("{}/spool", c.run_dir), "L\t1\tINFO\ta\t1\tqueued while down\n").unwrap();
        let mut p = [0i32; 2];
        assert_eq!(unsafe { libc::pipe(p.as_mut_ptr()) }, 0);
        let c2 = c.clone();
        let h = std::thread::spawn(move || server::run(c2, Some(p[0])));
        wait_for("alive", || std::path::Path::new(&format!("{}/alive", c.run_dir)).exists());
        assert!(!std::path::Path::new(&format!("{}/spool", c.run_dir)).exists());
        assert!(!std::path::Path::new(&format!("{}/spool.work", c.run_dir)).exists());
        stop(p[1], h);
        let text = std::fs::read_to_string(&c.text_log).unwrap();
        let a = text.find("from the crash").unwrap();
        let b = text.find("queued while down").unwrap();
        assert!(a < b);
    }
}
