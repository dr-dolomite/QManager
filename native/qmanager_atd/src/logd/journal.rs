//! The flash journal (`/usrdata/qmanager/journal/`): per-day JSONL files
//! (`log-<epochday>.jsonl`, `ev-<epochday>.jsonl`), the `state` file, the
//! retention rules and the boot index built from what is on flash.
//!
//! Writes append to the day file and `fdatasync` that file only, never a
//! global sync. Each file is opened O_APPEND|O_CREAT|O_NOFOLLOW and must be
//! our own regular file with one link.

use super::record::{quick_sbt, Row};
use super::registry;
use crate::common::safefs;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;

pub const LOG_DAYS: i64 = 7;
pub const LOG_BYTES: u64 = 1024 * 1024;
pub const EV_DAYS: i64 = 31;
pub const EV_BYTES: u64 = 2 * 1024 * 1024;
pub const EV_DAY_CAP: u64 = 2000;
pub const MIN_FREE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Log,
    Ev,
}

impl Kind {
    fn prefix(self) -> &'static str {
        match self {
            Kind::Log => "log-",
            Kind::Ev => "ev-",
        }
    }
    fn of(row: &Row) -> Kind {
        if row.is_event() {
            Kind::Ev
        } else {
            Kind::Log
        }
    }
}

pub fn epochday(t: i64) -> i64 {
    t.div_euclid(86400)
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct State {
    pub seq: u64,
    pub boot: u32,
    pub boot_id: String,
    pub last_wall: i64,
    /// The previous run stopped through the TERM path (all rows flushed).
    pub clean: bool,
}

impl State {
    pub fn parse(text: &str) -> State {
        let mut s = State::default();
        for line in text.lines() {
            match line.split_once('=') {
                Some(("seq", v)) => s.seq = v.trim().parse().unwrap_or(0),
                Some(("boot", v)) => s.boot = v.trim().parse().unwrap_or(0),
                Some(("boot_id", v)) => s.boot_id = v.trim().to_string(),
                Some(("last_wall", v)) => s.last_wall = v.trim().parse().unwrap_or(0),
                Some(("clean", v)) => s.clean = v.trim() == "1",
                _ => {}
            }
        }
        s
    }
    pub fn render(&self) -> String {
        format!(
            "seq={}\nboot={}\nboot_id={}\nlast_wall={}\nclean={}\n",
            self.seq,
            self.boot,
            safefs::one_line(&self.boot_id),
            self.last_wall,
            if self.clean { 1 } else { 0 }
        )
    }
}

/// `write_atomic` plus `fdatasync` of the file and `fsync` of its directory,
/// so the rename itself survives a power cut.
pub fn write_durable(dir: &str, path: &str, contents: &[u8]) -> std::io::Result<()> {
    let tmp = format!("{path}.new");
    let _ = fs::remove_file(&tmp);
    let res = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o644)
            .custom_flags(safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(&tmp)?;
        f.write_all(contents)?;
        unsafe { libc::fdatasync(f.as_raw_fd()) };
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
        return res;
    }
    if let Ok(d) = File::open(dir) {
        unsafe { libc::fsync(d.as_raw_fd()) };
    }
    Ok(())
}

/// Per-boot facts for queries: which rows and day files hold it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BootInfo {
    pub first_s: u64,
    pub last_s: u64,
    pub first_t: Option<i64>,
    pub last_t: Option<i64>,
    /// Day files (by name) that hold rows of this boot: (oldest, newest).
    pub days: Option<(i64, i64)>,
    /// Lowest `s` of this boot that is on flash.
    pub flash_min_s: Option<u64>,
}

impl BootInfo {
    pub fn note(&mut self, s: u64, t: Option<i64>, day: Option<i64>) {
        if self.first_s == 0 || s < self.first_s {
            self.first_s = s;
        }
        if s > self.last_s {
            self.last_s = s;
        }
        if let Some(t) = t {
            if self.first_t.map_or(true, |f| t < f) {
                self.first_t = Some(t);
            }
            if self.last_t.map_or(true, |l| t > l) {
                self.last_t = Some(t);
            }
        }
        if let Some(d) = day {
            if self.flash_min_s.map_or(true, |m| s < m) {
                self.flash_min_s = Some(s);
            }
            self.days = Some(match self.days {
                Some((lo, hi)) => (lo.min(d), hi.max(d)),
                None => (d, d),
            });
        }
    }
}

#[derive(Default, Debug, Clone)]
pub struct FlushStats {
    pub rows: u64,
    pub bytes: u64,
    pub fsyncs: u64,
    pub cap_drops: u64,
    pub errors: u64,
}

pub struct Journal {
    pub dir: String,
    /// Event count of one day file (lazily counted from the file).
    ev_day: Option<(i64, u64)>,
}

impl Journal {
    pub fn new(dir: String) -> Journal {
        Journal { dir, ev_day: None }
    }

    pub fn state_path(&self) -> String {
        format!("{}/state", self.dir)
    }

    pub fn path(&self, kind: Kind, day: i64) -> String {
        format!("{}/{}{}.jsonl", self.dir, kind.prefix(), day)
    }

    pub fn ensure_dir(&self) -> std::io::Result<()> {
        use std::os::unix::fs::PermissionsExt;
        match fs::symlink_metadata(&self.dir) {
            Ok(m) if m.file_type().is_dir() => Ok(()),
            Ok(_) => Err(std::io::Error::new(std::io::ErrorKind::Other, "journal path is not a directory")),
            Err(_) => {
                fs::create_dir_all(&self.dir)?;
                fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o755))
            }
        }
    }

    pub fn load_state(&self) -> Option<State> {
        let m = fs::symlink_metadata(self.state_path()).ok()?;
        if !m.file_type().is_file() {
            return None;
        }
        fs::read_to_string(self.state_path()).ok().map(|t| State::parse(&t))
    }

    pub fn save_state(&self, st: &State) -> std::io::Result<()> {
        write_durable(&self.dir, &self.state_path(), st.render().as_bytes())
    }

    /// Day files of a kind, oldest first: (day, size).
    pub fn days(&self, kind: Kind) -> Vec<(i64, u64)> {
        let mut out = Vec::new();
        let rd = match fs::read_dir(&self.dir) {
            Ok(r) => r,
            Err(_) => return out,
        };
        for e in rd.flatten() {
            let name = e.file_name();
            let name = match name.to_str() {
                Some(n) => n,
                None => continue,
            };
            let day = match name.strip_prefix(kind.prefix()).and_then(|r| r.strip_suffix(".jsonl")) {
                Some(d) => match d.parse::<i64>() {
                    Ok(d) => d,
                    Err(_) => continue,
                },
                None => continue,
            };
            if let Ok(m) = fs::symlink_metadata(e.path()) {
                if m.file_type().is_file() {
                    out.push((day, m.len()));
                }
            }
        }
        out.sort();
        out
    }

    pub fn free_bytes(&self) -> Option<u64> {
        let c = std::ffi::CString::new(self.dir.as_str()).ok()?;
        let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
            return None;
        }
        Some(st.f_bavail as u64 * st.f_frsize as u64)
    }

    fn count_lines(path: &str) -> u64 {
        match File::open(path) {
            Ok(f) => BufReader::new(f).split(b'\n').count() as u64,
            Err(_) => 0,
        }
    }

    fn open_append(path: &str) -> std::io::Result<File> {
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o644)
            .custom_flags(safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        let m = f.metadata()?;
        if !safefs::is_own_file(&m) {
            return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "day file not ours"));
        }
        Ok(f)
    }

    /// Appends rows (ascending `s`) to their day files. A row with a wall time
    /// goes to `epochday(t)`; one still untrusted goes to `null_day`. Events
    /// past the day cap are kept only for the keep-list and `error`; a kind's
    /// file is no longer grown once it alone exceeds the kind's byte cap.
    pub fn append(&mut self, rows: &[&Row], null_day: i64, stats: &mut FlushStats, index: &mut BTreeMap<u32, BootInfo>) {
        // (kind, day) -> rendered lines, in order of first appearance.
        let mut groups: Vec<(Kind, i64, String, Vec<(u64, u32, Option<i64>)>)> = Vec::new();
        for r in rows {
            let kind = Kind::of(r);
            let day = r.t.map(epochday).unwrap_or(null_day);
            if kind == Kind::Ev {
                let n = match self.ev_day {
                    Some((d, n)) if d == day => n,
                    _ => Self::count_lines(&self.path(Kind::Ev, day)),
                };
                if n >= EV_DAY_CAP {
                    let keep = match &r.body {
                        super::record::Body::Ev { ty, sev, .. } => {
                            registry::kept_past_cap(ty) || *sev == super::record::Sev::Error
                        }
                        _ => true,
                    };
                    self.ev_day = Some((day, n));
                    if !keep {
                        stats.cap_drops += 1;
                        continue;
                    }
                }
                self.ev_day = Some((day, n + 1));
            }
            let g = match groups.iter().position(|g| g.0 == kind && g.1 == day) {
                Some(i) => i,
                None => {
                    groups.push((kind, day, String::new(), Vec::new()));
                    groups.len() - 1
                }
            };
            r.render(&mut groups[g].2);
            groups[g].2.push('\n');
            groups[g].3.push((r.s, r.b, r.t));
        }
        for (kind, day, text, ids) in groups {
            let path = self.path(kind, day);
            let cap = if kind == Kind::Log { LOG_BYTES } else { EV_BYTES };
            let size = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size >= cap {
                stats.cap_drops += ids.len() as u64;
                continue;
            }
            match Self::open_append(&path).and_then(|mut f| {
                f.write_all(text.as_bytes())?;
                unsafe { libc::fdatasync(f.as_raw_fd()) };
                Ok(())
            }) {
                Ok(()) => {
                    stats.rows += ids.len() as u64;
                    stats.bytes += text.len() as u64;
                    stats.fsyncs += 1;
                    for (s, b, t) in ids {
                        index.entry(b).or_default().note(s, t, Some(day));
                    }
                }
                Err(_) => stats.errors += 1,
            }
        }
    }

    /// Deletes day files past the age and size bounds of a kind, oldest
    /// first, never the newest (today's) file. `today` is the trusted
    /// epochday, else None (age is then not applied).
    pub fn retain(&self, kind: Kind, today: Option<i64>) -> u32 {
        let (max_days, max_bytes) = match kind {
            Kind::Log => (LOG_DAYS, LOG_BYTES),
            Kind::Ev => (EV_DAYS, EV_BYTES),
        };
        let mut days = self.days(kind);
        let mut removed = 0;
        let newest = match days.last() {
            Some(&(d, _)) => d,
            None => return 0,
        };
        if let Some(today) = today {
            days.retain(|&(d, _)| {
                if d != newest && d < today - (max_days - 1) {
                    if fs::remove_file(self.path(kind, d)).is_ok() {
                        removed += 1;
                    }
                    return false;
                }
                true
            });
        }
        let mut total: u64 = days.iter().map(|d| d.1).sum();
        for &(d, sz) in &days {
            if total <= max_bytes || d == newest {
                break;
            }
            if fs::remove_file(self.path(kind, d)).is_ok() {
                removed += 1;
                total -= sz;
            }
        }
        removed
    }

    /// Calls `f` for every whole line of a day file.
    pub fn for_each_line(&self, kind: Kind, day: i64, mut f: impl FnMut(&str)) {
        let path = self.path(kind, day);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_file() => {}
            _ => return,
        }
        let file = match File::open(&path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut r = BufReader::with_capacity(16 * 1024, file);
        let mut buf = Vec::with_capacity(512);
        loop {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if buf.len() > 64 * 1024 {
                        continue;
                    }
                    let s = String::from_utf8_lossy(&buf);
                    let s = s.trim_end_matches(['\n', '\r']);
                    if super::record::looks_whole(s) {
                        f(s);
                    }
                }
            }
        }
    }

    /// One pass over every day file: the highest `s` on flash and the boot
    /// index (rows' `s`/`b`/`t` only).
    pub fn scan(&self) -> (u64, BTreeMap<u32, BootInfo>) {
        let mut max_s = 0;
        let mut idx: BTreeMap<u32, BootInfo> = BTreeMap::new();
        for kind in [Kind::Log, Kind::Ev] {
            for (day, _) in self.days(kind) {
                self.for_each_line(kind, day, |l| {
                    if let Some((s, b, t)) = quick_sbt(l) {
                        max_s = max_s.max(s);
                        idx.entry(b).or_default().note(s, t, Some(day));
                    }
                });
            }
        }
        (max_s, idx)
    }

    /// The newest `n` events on flash (for seeding the events mirror).
    pub fn newest_events(&self, n: usize) -> Vec<Row> {
        let mut out: Vec<Row> = Vec::new();
        for (day, _) in self.days(Kind::Ev).into_iter().rev() {
            let mut rows = Vec::new();
            self.for_each_line(Kind::Ev, day, |l| {
                if let Some(r) = super::record::parse_row(l) {
                    rows.push(r);
                }
            });
            out.extend(rows);
            if out.len() >= n {
                break;
            }
        }
        out.sort_by_key(|r| r.s);
        let skip = out.len().saturating_sub(n);
        out.drain(..skip);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::log::Level;
    use crate::logd::record::{Body, Sev};

    pub(crate) fn tmpdir(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("qlogd-j-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.to_str().unwrap().to_string()
    }

    fn ev(s: u64, t: Option<i64>, ty: &str, sev: Sev) -> Row {
        Row { s, b: 3, m: 0, t, body: Body::Ev { ty: ty.into(), sev, cat: registry::category(ty), code: String::new(), f: vec![], msg: "m".into() } }
    }

    #[test]
    fn state_round_trips_and_is_durable() {
        let d = tmpdir("state");
        let j = Journal::new(d.clone());
        assert!(j.load_state().is_none());
        let st = State { seq: 42, boot: 7, boot_id: "abc-def".into(), last_wall: 1_794_199_490, clean: true };
        j.save_state(&st).unwrap();
        assert_eq!(j.load_state().unwrap(), st);
        assert!(!std::path::Path::new(&format!("{d}/state.new")).exists());
        assert_eq!(State::parse("seq=x\nboot=2\ngarbage\n"), State { boot: 2, ..Default::default() });
    }

    #[test]
    fn rows_go_to_their_day_and_untrusted_rows_to_the_null_day() {
        let d = tmpdir("days");
        let mut j = Journal::new(d.clone());
        let a = Row { s: 1, b: 3, m: 0, t: Some(86400 * 5 + 10), body: Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: "a".into() } };
        let b = Row { s: 2, b: 3, m: 0, t: None, body: Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: "b".into() } };
        let e = ev(3, Some(86400 * 6), "band_change", Sev::Info);
        let mut st = FlushStats::default();
        let mut idx = BTreeMap::new();
        j.append(&[&a, &b, &e], 5, &mut st, &mut idx);
        assert_eq!((st.rows, st.fsyncs), (3, 2));
        assert_eq!(fs::read_to_string(j.path(Kind::Log, 5)).unwrap().lines().count(), 2);
        assert_eq!(j.days(Kind::Ev), vec![(6, fs::metadata(j.path(Kind::Ev, 6)).unwrap().len())]);
        let (max_s, idx2) = j.scan();
        assert_eq!(max_s, 3);
        assert_eq!(idx2[&3].first_s, 1);
        assert_eq!(idx2[&3].days, Some((5, 6)));
        assert_eq!(idx, idx2);
        assert_eq!(j.newest_events(50), vec![e]);
    }

    #[test]
    fn the_event_day_cap_keeps_only_the_keep_list_and_errors() {
        let d = tmpdir("cap");
        let mut j = Journal::new(d);
        let day = 20000;
        let t = Some(day * 86400 + 5);
        let rows: Vec<Row> = (1..=EV_DAY_CAP).map(|s| ev(s, t, "band_change", Sev::Info)).collect();
        let refs: Vec<&Row> = rows.iter().collect();
        let mut st = FlushStats::default();
        j.append(&refs, 0, &mut st, &mut BTreeMap::new());
        assert_eq!(st.rows, EV_DAY_CAP);
        let more = [
            ev(5001, t, "band_change", Sev::Info),
            ev(5002, t, "signal_lost", Sev::Warning),
            ev(5003, t, "internet_restored", Sev::Info),
            ev(5004, t, "profile_failed", Sev::Error),
            ev(5005, t, "pci_change", Sev::Warning),
        ];
        // A fresh Journal counts the file from flash.
        let mut j = Journal::new(j.dir.clone());
        let mut st = FlushStats::default();
        j.append(&more.iter().collect::<Vec<_>>(), 0, &mut st, &mut BTreeMap::new());
        assert_eq!((st.rows, st.cap_drops), (3, 2));
        // The next day starts a fresh count.
        let mut st = FlushStats::default();
        j.append(&[&ev(6000, Some((day + 1) * 86400), "band_change", Sev::Info)], 0, &mut st, &mut BTreeMap::new());
        assert_eq!(st.rows, 1);
    }

    #[test]
    fn retention_by_age_and_size_never_removes_today() {
        let d = tmpdir("ret");
        let j = Journal::new(d);
        for day in [100, 101, 105, 106, 107, 108] {
            fs::write(j.path(Kind::Log, day), vec![b'x'; 300 * 1024]).unwrap();
        }
        // Age: today 108 keeps 102..108; size: 1 MB keeps the newest 3.
        assert_eq!(j.retain(Kind::Log, Some(108)), 3);
        assert_eq!(j.days(Kind::Log).iter().map(|d| d.0).collect::<Vec<_>>(), vec![106, 107, 108]);
        // Untrusted: no age rule; today's (newest) file survives even alone over the cap.
        fs::write(j.path(Kind::Log, 108), vec![b'x'; 2 * 1024 * 1024]).unwrap();
        j.retain(Kind::Log, None);
        assert_eq!(j.days(Kind::Log).iter().map(|d| d.0).collect::<Vec<_>>(), vec![108]);
        // Events: 31 days.
        for day in [69, 70, 80, 100] {
            fs::write(j.path(Kind::Ev, day), b"x").unwrap();
        }
        j.retain(Kind::Ev, Some(100));
        assert_eq!(j.days(Kind::Ev).iter().map(|d| d.0).collect::<Vec<_>>(), vec![70, 80, 100]);
    }

    #[test]
    fn a_full_day_file_is_not_grown_and_a_planted_link_is_refused() {
        let d = tmpdir("full");
        let mut j = Journal::new(d.clone());
        let row = Row { s: 1, b: 1, m: 0, t: Some(86400 * 9), body: Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: "a".into() } };
        fs::write(j.path(Kind::Log, 9), vec![b'x'; LOG_BYTES as usize]).unwrap();
        let mut st = FlushStats::default();
        j.append(&[&row], 0, &mut st, &mut BTreeMap::new());
        assert_eq!((st.rows, st.cap_drops), (0, 1));
        let victim = format!("{d}/victim");
        fs::write(&victim, b"SECRET").unwrap();
        std::os::unix::fs::symlink(&victim, j.path(Kind::Log, 10)).unwrap();
        let row = Row { t: Some(86400 * 10), ..row };
        let mut st = FlushStats::default();
        j.append(&[&row], 0, &mut st, &mut BTreeMap::new());
        assert_eq!((st.rows, st.errors), (0, 1));
        assert_eq!(fs::read(&victim).unwrap(), b"SECRET");
    }
}
