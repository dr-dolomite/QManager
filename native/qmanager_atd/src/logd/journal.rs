//! The flash journal (`/usrdata/qmanager/journal/`): per-day JSONL files
//! (`log-<epochday>.jsonl`, `ev-<epochday>.jsonl`), the `state` file, the
//! retention rules and the boot index built from what is on flash.
//!
//! Writes append to the day file and `fdatasync` that file only, never a
//! global sync. Each file is opened O_APPEND|O_CREAT|O_NOFOLLOW and must be
//! our own regular file with one link.

use super::record::{quick_sbt, Names, RKind, Row, Sev};
use crate::common::log::Level;
use super::registry;
use crate::common::safefs;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;

pub const LOG_DAYS: i64 = 7;
/// Per day file (logs). The total across days is `LOG_TOTAL`.
pub const LOG_BYTES: u64 = 1024 * 1024;
/// Totals across all day files of a kind: several full days, so one storm
/// day (cap plus reserve) never deletes the days before it.
pub const LOG_TOTAL: u64 = 4 * 1024 * 1024;
pub const EV_TOTAL: u64 = 8 * 1024 * 1024;
/// Past a day file's byte cap, this much more is kept for what matters:
/// WARN/ERROR and kernel lines (logs), keep-list and `error` (events).
pub const CAP_RESERVE: u64 = 256 * 1024;
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
    /// Highest `/dev/kmsg` seq read in `boot_id` (a restart skips up to it).
    pub kmsg_seq: u64,
    /// Kernel SSR records seen in `boot_id`.
    pub kmsg_ssr: u64,
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
                Some(("kmsg_seq", v)) => s.kmsg_seq = v.trim().parse().unwrap_or(0),
                Some(("kmsg_ssr", v)) => s.kmsg_ssr = v.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
        s
    }
    pub fn render(&self) -> String {
        format!(
            "seq={}\nboot={}\nboot_id={}\nlast_wall={}\nclean={}\nkmsg_seq={}\nkmsg_ssr={}\n",
            self.seq,
            self.boot,
            safefs::one_line(&self.boot_id),
            self.last_wall,
            if self.clean { 1 } else { 0 },
            self.kmsg_seq,
            self.kmsg_ssr
        )
    }
}

/// `write_atomic` plus `fdatasync` of the file and `fsync` of its directory,
/// so the rename itself survives a power cut. Returns the syncs issued.
pub fn write_durable(dir: &str, path: &str, contents: &[u8]) -> std::io::Result<u64> {
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
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    let mut n = 1;
    if let Ok(d) = File::open(dir) {
        unsafe { libc::fsync(d.as_raw_fd()) };
        n += 1;
    }
    Ok(n)
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

/// Boot index → facts, sorted by boot (a handful of entries).
#[derive(Default, Debug, Clone, PartialEq)]
pub struct BootIndex(pub Vec<(u32, BootInfo)>);

impl BootIndex {
    pub fn entry(&mut self, b: u32) -> &mut BootInfo {
        let i = match self.0.binary_search_by_key(&b, |e| e.0) {
            Ok(i) => i,
            Err(i) => {
                self.0.insert(i, (b, BootInfo::default()));
                i
            }
        };
        &mut self.0[i].1
    }
    pub fn get(&self, b: u32) -> Option<&BootInfo> {
        self.0.binary_search_by_key(&b, |e| e.0).ok().map(|i| &self.0[i].1)
    }
    pub fn remove(&mut self, b: u32) -> Option<BootInfo> {
        self.0.binary_search_by_key(&b, |e| e.0).ok().map(|i| self.0.remove(i).1)
    }
    pub fn last_boot(&self) -> Option<u32> {
        self.0.last().map(|e| e.0)
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

#[derive(Default, Debug, Clone)]
pub struct FlushStats {
    pub rows: u64,
    pub bytes: u64,
    pub fsyncs: u64,
    pub cap_drops: u64,
    pub errors: u64,
    /// Day of the first log row dropped by the byte cap in this flush.
    pub log_cap_day: Option<i64>,
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

    /// Durable save; returns the syncs issued (file and directory).
    pub fn save_state(&self, st: &State) -> std::io::Result<u64> {
        write_durable(&self.dir, &self.state_path(), st.render().as_bytes())
    }

    /// Atomic replace without a sync: survives a logd restart, not a power cut.
    pub fn save_state_volatile(&self, st: &State) -> std::io::Result<()> {
        safefs::write_atomic(&self.state_path(), st.render().as_bytes())
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
        out.sort_unstable();
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
    /// past the day cap are kept only for the keep-list and `error`. Past a
    /// kind's byte cap a day file keeps only WARN/ERROR and kernel lines
    /// (logs) or keep-list and `error` events, up to `CAP_RESERVE` more.
    pub fn append(&mut self, rows: &[&Row], null_day: i64, stats: &mut FlushStats, index: &mut BootIndex, names: &Names) {
        // One open file per (kind, day) touched, written in 32 KB chunks so a
        // full ring never needs a second copy of itself in RAM.
        struct G {
            kind: Kind,
            day: i64,
            file: Option<File>,
            buf: String,
            wrote: bool,
            /// File size plus what this flush appended.
            size: u64,
        }
        const CHUNK: usize = 32 * 1024;
        let mut groups: Vec<G> = Vec::new();
        let write = |g: &mut G, stats: &mut FlushStats| {
            if g.buf.is_empty() {
                return;
            }
            let ok = g.file.as_mut().map_or(false, |f| f.write_all(g.buf.as_bytes()).is_ok());
            if ok {
                stats.bytes += g.buf.len() as u64;
                g.wrote = true;
            } else if g.file.take().is_some() {
                stats.errors += 1;
            }
            g.buf.clear();
        };
        for r in rows {
            let kind = Kind::of(r);
            let day = r.t.map(epochday).unwrap_or(null_day);
            if kind == Kind::Ev {
                let n = match self.ev_day {
                    Some((d, n)) if d == day => n,
                    _ => Self::count_lines(&self.path(Kind::Ev, day)),
                };
                if n >= EV_DAY_CAP {
                    let keep = registry::kept_past_cap(names.name(r.ty)) || r.sev == Sev::Error;
                    self.ev_day = Some((day, n));
                    if !keep {
                        stats.cap_drops += 1;
                        continue;
                    }
                }
                self.ev_day = Some((day, n + 1));
            }
            let gi = match groups.iter().position(|g| g.kind == kind && g.day == day) {
                Some(i) => i,
                None => {
                    let path = self.path(kind, day);
                    let cap = if kind == Kind::Log { LOG_BYTES } else { EV_BYTES };
                    let size = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let file = if size >= cap + CAP_RESERVE {
                        None
                    } else {
                        match Self::open_append(&path) {
                            Ok(f) => Some(f),
                            Err(_) => {
                                stats.errors += 1;
                                None
                            }
                        }
                    };
                    groups.push(G { kind, day, file, buf: String::new(), wrote: false, size });
                    groups.len() - 1
                }
            };
            let g = &mut groups[gi];
            let cap = if kind == Kind::Log { LOG_BYTES } else { EV_BYTES };
            let reserved = match kind {
                Kind::Log => r.kind == RKind::K || r.lv >= Level::Warn,
                Kind::Ev => registry::kept_past_cap(names.name(r.ty)) || r.sev == Sev::Error,
            };
            if g.file.is_none() || (g.size >= cap && !reserved) || g.size >= cap + CAP_RESERVE {
                stats.cap_drops += 1;
                if kind == Kind::Log && g.size >= cap {
                    stats.log_cap_day.get_or_insert(day);
                }
                continue;
            }
            let before = g.buf.len();
            r.render(&mut g.buf);
            g.buf.push('\n');
            g.size += (g.buf.len() - before) as u64;
            stats.rows += 1;
            index.entry(r.b).note(r.s, r.t, Some(day));
            if g.buf.len() >= CHUNK {
                write(g, stats);
            }
        }
        for g in groups.iter_mut() {
            write(g, stats);
            if let (true, Some(f)) = (g.wrote, g.file.as_ref()) {
                unsafe { libc::fdatasync(f.as_raw_fd()) };
                stats.fsyncs += 1;
            }
        }
    }

    /// Deletes day files past the age and size bounds of a kind, oldest
    /// first, never the newest (today's) file. `today` is the trusted
    /// epochday, else None (age is then not applied).
    pub fn retain(&self, kind: Kind, today: Option<i64>) -> u32 {
        let (max_days, max_bytes) = match kind {
            Kind::Log => (LOG_DAYS, LOG_TOTAL),
            Kind::Ev => (EV_DAYS, EV_TOTAL),
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

    /// `s` of a day file's last whole line, read from its last 8 KB (rows are
    /// appended in ascending `s`, so this is the file's highest). None when
    /// it cannot be told cheaply: the caller must read the file.
    pub fn last_s(&self, kind: Kind, day: i64) -> Option<u64> {
        use std::io::{Read, Seek, SeekFrom};
        let path = self.path(kind, day);
        let m = fs::symlink_metadata(&path).ok()?;
        if !m.file_type().is_file() {
            return None;
        }
        let mut f = File::open(&path).ok()?;
        let from = m.len().saturating_sub(8192);
        f.seek(SeekFrom::Start(from)).ok()?;
        let mut buf = Vec::with_capacity(8192);
        f.take(8192).read_to_end(&mut buf).ok()?;
        let text = String::from_utf8_lossy(&buf);
        let mut lines = text.split('\n').collect::<Vec<_>>();
        if from > 0 && !lines.is_empty() {
            lines.remove(0);
        }
        lines.iter().rev().map(|l| l.trim_end_matches('\r')).filter(|l| super::record::looks_whole(l)).find_map(|l| quick_sbt(l).map(|x| x.0))
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
    pub fn scan(&self) -> (u64, BootIndex) {
        let mut max_s = 0;
        let mut idx = BootIndex::default();
        for kind in [Kind::Log, Kind::Ev] {
            for (day, _) in self.days(kind) {
                self.for_each_line(kind, day, |l| {
                    if let Some((s, b, t)) = quick_sbt(l) {
                        max_s = max_s.max(s);
                        idx.entry(b).note(s, t, Some(day));
                    }
                });
            }
        }
        (max_s, idx)
    }

    /// The newest `n` events on flash (for seeding the events mirror).
    pub fn newest_events(&self, n: usize, names: &mut Names) -> Vec<Row> {
        let mut out: Vec<Row> = Vec::new();
        for (day, _) in self.days(Kind::Ev).into_iter().rev() {
            let mut rows = Vec::new();
            self.for_each_line(Kind::Ev, day, |l| {
                if let Some(r) = Row::from_line(l, names) {
                    rows.push(r);
                }
            });
            out.extend(rows);
            if out.len() >= n {
                break;
            }
        }
        out.sort_unstable_by_key(|r| r.s);
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
        let b = Body::Ev { ty: ty.into(), sev, cat: registry::category(ty), code: String::new(), f: vec![], msg: "m".into() };
        NAMES.with(|n| Row::build(s, 3, 0, t, &b, &mut n.borrow_mut()))
    }

    fn lg(s: u64, b: u32, t: Option<i64>, msg: &str) -> Row {
        let body = Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: msg.into() };
        NAMES.with(|n| Row::build(s, b, 0, t, &body, &mut n.borrow_mut()))
    }

    thread_local! {
        static NAMES: std::cell::RefCell<Names> = std::cell::RefCell::new(Names::default());
    }

    fn app(j: &mut Journal, rows: &[&Row], null_day: i64, st: &mut FlushStats, idx: &mut BootIndex) {
        NAMES.with(|n| j.append(rows, null_day, st, idx, &n.borrow()));
    }

    #[test]
    fn state_round_trips_and_is_durable() {
        let d = tmpdir("state");
        let j = Journal::new(d.clone());
        assert!(j.load_state().is_none());
        let st = State { seq: 42, boot: 7, boot_id: "abc-def".into(), last_wall: 1_794_199_490, clean: true, kmsg_seq: 1501, kmsg_ssr: 2 };
        assert_eq!(j.save_state(&st).unwrap(), 2, "file and directory");
        assert_eq!(j.load_state().unwrap(), st);
        assert!(!std::path::Path::new(&format!("{d}/state.new")).exists());
        assert_eq!(State::parse("seq=x\nboot=2\ngarbage\n"), State { boot: 2, ..Default::default() });
    }

    #[test]
    fn rows_go_to_their_day_and_untrusted_rows_to_the_null_day() {
        let d = tmpdir("days");
        let mut j = Journal::new(d.clone());
        let a = lg(1, 3, Some(86400 * 5 + 10), "a");
        let b = lg(2, 3, None, "b");
        let e = ev(3, Some(86400 * 6), "band_change", Sev::Info);
        let mut st = FlushStats::default();
        let mut idx = BootIndex::default();
        app(&mut j, &[&a, &b, &e], 5, &mut st, &mut idx);
        assert_eq!((st.rows, st.fsyncs), (3, 2));
        assert_eq!(fs::read_to_string(j.path(Kind::Log, 5)).unwrap().lines().count(), 2);
        assert_eq!(j.days(Kind::Ev), vec![(6, fs::metadata(j.path(Kind::Ev, 6)).unwrap().len())]);
        let (max_s, idx2) = j.scan();
        assert_eq!(max_s, 3);
        assert_eq!(idx2.get(3).unwrap().first_s, 1);
        assert_eq!(idx2.get(3).unwrap().days, Some((5, 6)));
        assert_eq!(idx, idx2);
        assert_eq!(NAMES.with(|n| j.newest_events(50, &mut n.borrow_mut())), vec![e]);
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
        app(&mut j, &refs, 0, &mut st, &mut BootIndex::default());
        assert_eq!(st.rows, EV_DAY_CAP);
        let more = [
            ev(5001, t, "band_change", Sev::Info),
            ev(5002, t, "signal_lost", Sev::Warning),
            ev(5003, t, "internet_restored", Sev::Info),
            ev(5004, t, "profile_failed", Sev::Error),
            ev(5005, t, "pci_change", Sev::Warning),
            ev(5006, t, "data_call_dropped", Sev::Info),
            ev(5007, t, "modem_crash", Sev::Info),
        ];
        // A fresh Journal counts the file from flash.
        let mut j = Journal::new(j.dir.clone());
        let mut st = FlushStats::default();
        app(&mut j, &more.iter().collect::<Vec<_>>(), 0, &mut st, &mut BootIndex::default());
        assert_eq!((st.rows, st.cap_drops), (5, 2));
        // The next day starts a fresh count.
        let mut st = FlushStats::default();
        app(&mut j, &[&ev(6000, Some((day + 1) * 86400), "band_change", Sev::Info)], 0, &mut st, &mut BootIndex::default());
        assert_eq!(st.rows, 1);
    }

    #[test]
    fn retention_by_age_and_size_never_removes_today() {
        let d = tmpdir("ret");
        let j = Journal::new(d);
        for day in [100, 101, 105, 106, 107, 108] {
            fs::write(j.path(Kind::Log, day), vec![b'x'; 1200 * 1024]).unwrap();
        }
        // Age: today 108 keeps 102..108; size: 4 MB keeps the newest 3.
        assert_eq!(j.retain(Kind::Log, Some(108)), 3);
        assert_eq!(j.days(Kind::Log).iter().map(|d| d.0).collect::<Vec<_>>(), vec![106, 107, 108]);
        // Untrusted: no age rule; today's (newest) file survives even alone over the cap.
        fs::write(j.path(Kind::Log, 108), vec![b'x'; 5 * 1024 * 1024]).unwrap();
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
        let row = lg(1, 1, Some(86400 * 9), "a");
        fs::write(j.path(Kind::Log, 9), vec![b'x'; (LOG_BYTES + CAP_RESERVE) as usize]).unwrap();
        let mut st = FlushStats::default();
        app(&mut j, &[&row], 0, &mut st, &mut BootIndex::default());
        assert_eq!((st.rows, st.cap_drops, st.log_cap_day), (0, 1, Some(9)));
        let victim = format!("{d}/victim");
        fs::write(&victim, b"SECRET").unwrap();
        std::os::unix::fs::symlink(&victim, j.path(Kind::Log, 10)).unwrap();
        let row = lg(1, 1, Some(86400 * 10), "a");
        let mut st = FlushStats::default();
        app(&mut j, &[&row], 0, &mut st, &mut BootIndex::default());
        assert_eq!((st.rows, st.errors), (0, 1));
        assert_eq!(fs::read(&victim).unwrap(), b"SECRET");
    }

    #[test]
    fn past_the_byte_cap_only_warnings_errors_and_kernel_lines_use_the_reserve() {
        let d = tmpdir("reserve");
        let mut j = Journal::new(d.clone());
        let t = Some(86400 * 9);
        fs::write(j.path(Kind::Log, 9), vec![b'x'; LOG_BYTES as usize]).unwrap();
        let names = &mut Names::default();
        let mk = |s: u64, body: Body, names: &mut Names| Row::build(s, 1, 0, t, &body, names);
        let info = mk(1, Body::Log { lv: Level::Info, c: "a".into(), p: 1, msg: "info".into() }, names);
        let warn = mk(2, Body::Log { lv: Level::Warn, c: "a".into(), p: 1, msg: "warn".into() }, names);
        let err = mk(3, Body::Log { lv: Level::Error, c: "a".into(), p: 1, msg: "err".into() }, names);
        let kern = mk(4, Body::Kern { pri: 6, fac: 0, kseq: 9, tag: "ssr".into(), msg: "k".into() }, names);
        let mut st = FlushStats::default();
        j.append(&[&info, &warn, &err, &kern], 0, &mut st, &mut BootIndex::default(), names);
        assert_eq!((st.rows, st.cap_drops, st.log_cap_day), (3, 1, Some(9)));
        let text = fs::read_to_string(j.path(Kind::Log, 9)).unwrap();
        assert!(!text.contains("\"info\"") && text.contains("\"warn\"") && text.contains("\"k\""));
        // The reserve is bounded too.
        let big = "w".repeat(3000);
        let rows: Vec<Row> = (10..200).map(|s| mk(s, Body::Log { lv: Level::Warn, c: "a".into(), p: 1, msg: big.clone() }, names)).collect();
        let refs: Vec<&Row> = rows.iter().collect();
        let mut st = FlushStats::default();
        j.append(&refs, 0, &mut st, &mut BootIndex::default(), names);
        let size = fs::metadata(j.path(Kind::Log, 9)).unwrap().len();
        assert!(size <= LOG_BYTES + CAP_RESERVE + 4096, "{size}");
        assert!(st.cap_drops > 0 && st.rows > 0);
    }

    #[test]
    fn totals_keep_several_full_days_and_last_s_reads_the_tail() {
        let d = tmpdir("totals");
        let j = Journal::new(d.clone());
        // Three storm days of cap + reserve each fit the 4 MB total.
        for day in [97, 98, 99] {
            fs::write(j.path(Kind::Log, day), vec![b'x'; (LOG_BYTES + CAP_RESERVE) as usize]).unwrap();
        }
        assert_eq!(j.retain(Kind::Log, Some(99)), 0);
        fs::write(j.path(Kind::Log, 100), vec![b'x'; (LOG_BYTES + CAP_RESERVE) as usize]).unwrap();
        assert_eq!(j.retain(Kind::Log, Some(100)), 1, "the oldest goes only past 4 MB");
        assert_eq!(j.days(Kind::Log).iter().map(|d| d.0).collect::<Vec<_>>(), vec![98, 99, 100]);
        let mut text = String::new();
        for s in 1..=500u64 {
            text.push_str(&format!("{{\"s\":{s},\"b\":1,\"m\":1.00,\"t\":5,\"k\":\"e\",\"ty\":\"x\",\"msg\":\"{}\"}}\n", "y".repeat(40)));
        }
        text.push_str("{\"s\":999,\"b\":1,\"m\":1.0");
        fs::write(j.path(Kind::Ev, 7), &text).unwrap();
        assert_eq!(j.last_s(Kind::Ev, 7), Some(500), "the torn last line is skipped");
        assert_eq!(j.last_s(Kind::Ev, 8), None);
    }
}
