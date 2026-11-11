//! The journal engine: everything logd decides, with time passed in, so the
//! policy (seq, clock, collapse, mirrors, flush, lease) is testable without a
//! running daemon. The event loop (`server.rs`) only moves bytes and wakes it.

use super::clock::{Change, Clock, SETTLE};
use super::collapse::{Collapser, RateLimit};
use super::journal::{epochday, BootIndex, BootInfo, FlushStats, Journal, Kind, State, MIN_FREE};
use super::mirror::{EventsMirror, TextMirror};
use super::record::{Body, Names, Row, Sev};
use super::registry;
use super::ring::Ring;
use super::spool::{self, Rec};
use crate::common::log::Level;
use std::io::Read;

/// Flush within this of an urgent row (ERROR, or a warning/error event)...
pub const URGENT_MS: u64 = 2_000;
/// ...but at most one urgent flush per this, so an urgent row is on flash
/// within 120 s at worst (it is in the RAM ring, and queryable, at once).
pub const URGENT_GAP_MS: u64 = 120_000;
/// Otherwise, pending rows are flushed this long after the first arrived.
pub const REGULAR_MS: u64 = 300_000;
/// Default debug lease when the file's expiry cannot be read.
pub const LEASE_DEFAULT_S: i64 = 1800;
/// Retention runs at most this often (and at start).
const RETAIN_GAP_MS: u64 = 3_600_000;
/// Sequence gap after an unclean stop: rows assigned after the last flush were
/// lost, but a client may have seen their numbers.
pub const UNCLEAN_SEQ_GAP: u64 = 10_000;
pub const SELF_COMPONENT: &str = "qmanager_logd";

#[derive(Clone, Debug)]
pub struct Config {
    pub run_dir: String,
    pub journal_dir: String,
    pub sock: String,
    pub proto: String,
    pub text_log: String,
    pub events_mirror: String,
    pub uptime: String,
    pub boot_id: String,
    /// The kernel log device (`QLOGD_KMSG`; empty disables kernel capture).
    pub kmsg: String,
    pub level: Level,
    pub persist_level: Level,
    pub forward_syslog: bool,
}

impl Config {
    pub fn from_env() -> Config {
        let v = |k: &str, d: &str| std::env::var(k).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| d.to_string());
        Config {
            run_dir: v("QLOGD_RUN_DIR", crate::common::log::JOURNAL_RUN_DIR),
            journal_dir: v("QLOGD_JOURNAL_DIR", "/usrdata/qmanager/journal"),
            sock: v("QLOGD_SOCK", "/var/run/qmanager_logd.sock"),
            proto: v("QLOGD_PROTO", "/var/run/qmanager_logd.proto"),
            text_log: v("QLOG_FILE", "/tmp/qmanager.log"),
            events_mirror: v("QLOGD_EVENTS_MIRROR", "/tmp/qmanager_events.json"),
            uptime: v("QLOGD_UPTIME", "/proc/uptime"),
            boot_id: v("QLOGD_BOOT_ID", "/proc/sys/kernel/random/boot_id"),
            kmsg: std::env::var("QLOGD_KMSG").unwrap_or_else(|_| "/dev/kmsg".into()),
            level: Level::parse(&v("QLOGD_LEVEL", "INFO")),
            persist_level: Level::parse(&v("QLOGD_PERSIST_LEVEL", "INFO")),
            forward_syslog: v("QLOGD_FORWARD_SYSLOG", "0") == "1",
        }
    }
}

/// One instant on both clocks: `mono_cs` is `/proc/uptime` in centiseconds
/// (also the timer clock, in ms via `ms()`), `wall` epoch seconds.
#[derive(Clone, Copy, Debug)]
pub struct Now {
    pub mono_cs: u64,
    pub wall: i64,
}

impl Now {
    pub fn ms(&self) -> u64 {
        self.mono_cs * 10
    }
    pub fn mono_s(&self) -> i64 {
        (self.mono_cs / 100) as i64
    }
    #[cfg(test)]
    pub fn at(mono_s: f64, wall: i64) -> Now {
        Now { mono_cs: (mono_s * 100.0).round() as u64, wall }
    }
}

#[derive(Default, Debug, Clone)]
pub struct Stats {
    pub logs: [u64; 4],
    pub events: u64,
    pub bad_lines: u64,
    pub level_drops: u64,
    pub flushes: u64,
    pub fsyncs: u64,
    pub flush_skips: u64,
    pub flush_errors: u64,
    pub cap_drops: u64,
    pub rows_flushed: u64,
    pub bytes_day: (i64, u64),
    pub last_flush_ms: Option<u64>,
    pub syslog: u64,
    pub kernel: u64,
    pub kmsg_read: u64,
    pub kmsg_overruns: u64,
}

pub struct Engine {
    pub(super) cfg: Config,
    pub(super) pid: u32,
    pub(super) boot: u32,
    boot_id: String,
    pub(super) seq: u64,
    pub(super) clock: Clock,
    pub(super) ring: Ring,
    pub(super) collapse: Collapser,
    pub(super) rate: RateLimit,
    pub(super) text: TextMirror,
    pub(super) events: EventsMirror,
    pub(super) journal: Journal,
    pub(super) index: BootIndex,
    /// Interned component and event-type names of every row held.
    pub(super) names: Names,
    /// Rows with `s` at or below this are on flash (or were skipped).
    pub(super) flushed_s: u64,
    first_pending_ms: Option<u64>,
    urgent_at: Option<u64>,
    last_urgent_ms: Option<u64>,
    /// Lowest `s` in the ring still without a wall time.
    null_from: Option<u64>,
    /// Debug lease expiry, mono seconds.
    pub(super) lease: Option<i64>,
    last_retain_ms: Option<u64>,
    pub(super) stats: Stats,
    syslog_sock: Option<std::os::unix::net::UnixDatagram>,
    /// Flash flushes are skipped below this much free space.
    pub(super) min_free: u64,
    /// Highest kmsg seq read this boot (persisted per boot_id).
    pub(super) kmsg_hw: u64,
    /// Kernel SSR records this boot.
    pub(super) kmsg_ssr: u64,
    /// The kmsg reader is open.
    pub(super) kmsg_open: bool,
}

/// Reads the first field of an uptime file as centiseconds.
pub fn read_uptime(path: &str) -> Option<u64> {
    let s = std::fs::read_to_string(path).ok()?;
    super::record::parse_mono(s.split_whitespace().next()?)
}

impl Engine {
    /// Opens the journal: state, boot index, seq high-water, events seed.
    pub fn open(cfg: Config, now: &Now) -> std::io::Result<Engine> {
        let journal = Journal::new(cfg.journal_dir.clone());
        journal.ensure_dir()?;
        let st = journal.load_state();
        let boot_id = std::fs::read_to_string(&cfg.boot_id).map(|s| s.trim().to_string()).unwrap_or_default();
        let (flash_max, index) = journal.scan();
        let prev = st.clone().unwrap_or_default();
        let boot = match &st {
            None => index.last_boot().map_or(1, |b| b + 1),
            Some(s) if s.boot_id == boot_id && !boot_id.is_empty() => s.boot.max(1),
            Some(s) => s.boot.max(index.last_boot().unwrap_or(0)) + 1,
        };
        let same_boot = st.as_ref().map_or(false, |s| s.boot_id == boot_id && !boot_id.is_empty());
        let mut seq = prev.seq.max(flash_max);
        if st.is_some() && !prev.clean {
            seq += UNCLEAN_SEQ_GAP;
        }
        let mut names = Names::default();
        let mut events = EventsMirror::new(cfg.events_mirror.clone());
        for r in journal.newest_events(super::mirror::EVENTS_KEEP, &mut names) {
            events.add(&r);
        }
        events.dirty = false;
        let mut e = Engine {
            pid: std::process::id(),
            boot,
            boot_id,
            seq,
            clock: Clock::new(prev.last_wall),
            ring: Ring::new(),
            collapse: Collapser::default(),
            rate: RateLimit::default(),
            text: TextMirror::new(cfg.text_log.clone()),
            events,
            journal,
            index,
            names,
            flushed_s: seq,
            first_pending_ms: None,
            urgent_at: None,
            last_urgent_ms: None,
            null_from: None,
            lease: None,
            last_retain_ms: None,
            stats: Stats::default(),
            syslog_sock: None,
            min_free: MIN_FREE,
            kmsg_hw: if same_boot { prev.kmsg_seq } else { 0 },
            kmsg_ssr: if same_boot { prev.kmsg_ssr } else { 0 },
            kmsg_open: false,
            cfg,
        };
        e.index.entry(boot);
        e.clock_tick(now);
        e.save_state(now, false, true);
        e.retain(now);
        Ok(e)
    }

    pub fn head(&self) -> u64 {
        self.seq
    }

    pub fn lease_live(&self, now: &Now) -> bool {
        self.lease.map_or(false, |x| now.mono_s() < x)
    }

    fn min_level(&self, now: &Now) -> Level {
        if self.lease_live(now) {
            Level::Debug
        } else {
            self.cfg.level
        }
    }

    // --- Ingest --------------------------------------------------------------

    /// Reads a spool (file or bytes) and stores every record in it.
    pub fn ingest_reader<R: Read>(&mut self, r: R, now: &Now) {
        self.clock_tick(now);
        let _ = spool::for_each_line(r, |line, trunc| {
            if line.is_empty() {
                return;
            }
            match spool::parse_line(line, trunc) {
                Some(rec) => self.ingest_rec(rec, now),
                None => self.stats.bad_lines += 1,
            }
        });
    }

    fn mono_of(m: Option<u64>, now: &Now) -> u64 {
        match m {
            Some(m) if m <= now.mono_cs + 500 => m,
            _ => now.mono_cs,
        }
    }

    pub fn ingest_rec(&mut self, rec: Rec, now: &Now) {
        match rec {
            Rec::Log { mono, lv, c, p, msg } => {
                if lv < self.min_level(now) {
                    self.stats.level_drops += 1;
                    return;
                }
                let (keep, sum) = self.collapse.offer(&c, lv, p, &msg, now.ms());
                if let Some((sc, slv, sp, smsg)) = sum {
                    self.store(Body::Log { lv: slv, c: sc, p: sp, msg: smsg }, now.mono_cs, now);
                }
                if !keep {
                    return;
                }
                match self.rate.take(&c, p, now.ms()) {
                    Err(()) => return,
                    Ok(Some(r)) => self.store_rate(vec![r], now),
                    Ok(None) => {}
                }
                self.store(Body::Log { lv, c, p, msg }, Self::mono_of(mono, now), now);
            }
            Rec::Ev { mono, ty, sev, code, f, msg } => {
                let cat = registry::category(&ty);
                self.store(Body::Ev { ty, sev, cat, code, f, msg }, Self::mono_of(mono, now), now);
            }
        }
    }

    /// One `/dev/kmsg` record: skipped when already read this boot, kept as a
    /// `K` row when the filter tags it, plus the event it implies.
    pub fn ingest_kmsg(&mut self, line: &[u8], now: &Now) {
        let rec = match super::kmsg::parse_record(line) {
            Some(r) => r,
            None => return,
        };
        if rec.seq <= self.kmsg_hw && self.kmsg_hw > 0 {
            return;
        }
        self.kmsg_hw = rec.seq;
        self.stats.kmsg_read += 1;
        let tag = match super::kmsg::classify(&rec.msg) {
            Some(t) => t,
            None => return,
        };
        let m = Self::mono_of(Some(rec.usec / 10_000), now);
        if tag == "ssr" {
            self.kmsg_ssr += 1;
        }
        let ev = super::kmsg::event_of(tag, &rec.msg);
        self.store(Body::Kern { pri: rec.pri, fac: rec.fac, kseq: rec.seq, tag: tag.into(), msg: rec.msg }, m, now);
        if let Some((ty, sev, f, msg)) = ev {
            let cat = registry::category(ty);
            self.store(Body::Ev { ty: ty.into(), sev, cat, code: String::new(), f, msg }, m, now);
        }
    }

    /// Drop reports of the rate limit, as WARN rows of the component.
    fn store_rate(&mut self, v: Vec<super::collapse::RateReport>, now: &Now) {
        for (c, p, msg) in v {
            self.store(Body::Log { lv: Level::Warn, c, p, msg }, now.mono_cs, now);
        }
    }

    /// A row logd writes about itself (no collapse, no rate limit).
    pub fn self_log(&mut self, lv: Level, msg: &str, now: &Now) {
        if lv < self.min_level(now) {
            return;
        }
        let body = Body::Log { lv, c: SELF_COMPONENT.into(), p: self.pid, msg: msg.to_string() };
        self.store(body, now.mono_cs, now);
    }

    fn persistable(&self, r: &Row) -> bool {
        r.log_level().map_or(true, |lv| lv >= self.cfg.persist_level)
    }

    fn store(&mut self, body: Body, m: u64, now: &Now) {
        self.seq += 1;
        let t = self.clock.wall_of((m / 100) as i64);
        if let Some(t) = t {
            self.clock.note(t);
        } else if self.null_from.is_none() {
            self.null_from = Some(self.seq);
        }
        let row = Row::build(self.seq, self.boot, m, t, &body, &mut self.names);
        let urgent = match &body {
            Body::Log { lv, c, msg, .. } => {
                self.stats.logs[*lv as usize] += 1;
                if *lv == Level::Error && self.cfg.forward_syslog {
                    self.syslog(c, msg);
                }
                *lv == Level::Error
            }
            Body::Ev { sev, .. } => {
                self.stats.events += 1;
                *sev != Sev::Info
            }
            Body::Kern { pri, .. } => {
                self.stats.kernel += 1;
                super::record::kern_level(*pri) == Level::Error
            }
        };
        self.text.add(&body, t, now.wall, self.pid, now.ms());
        if row.is_event() {
            self.events.add(&row);
        }
        self.index.entry(self.boot).note(row.s, row.t, None);
        if self.persistable(&row) {
            self.first_pending_ms.get_or_insert(now.ms());
            if urgent && self.urgent_at.is_none() {
                let at = now.ms() + URGENT_MS;
                self.urgent_at = Some(self.last_urgent_ms.map_or(at, |l| at.max(l + URGENT_GAP_MS)));
            }
        }
        // Never evict a row flash has not seen: flush first.
        if self.ring.would_evict(row.cost()) && self.ring.front().map_or(false, |f| f.s > self.flushed_s) {
            self.flush(now, false);
        }
        self.ring.push(row);
        if let (Some(nf), Some(min)) = (self.null_from, self.ring.min_s()) {
            if nf < min {
                self.null_from = self.ring.iter().find(|r| r.t.is_none()).map(|r| r.s);
            }
        }
    }

    /// ERROR → syslog as `<27>qmanager[pid]: [component] message` (daemon.err)
    /// on `/dev/log`, one datagram, never blocking and never forking.
    fn syslog(&mut self, c: &str, msg: &str) {
        if self.syslog_sock.is_none() {
            self.syslog_sock = std::os::unix::net::UnixDatagram::unbound().ok();
            if let Some(s) = &self.syslog_sock {
                let _ = s.set_nonblocking(true);
            }
        }
        if let Some(s) = &self.syslog_sock {
            let line = format!("<27>qmanager[{}]: [{c}] {msg}", self.pid);
            if s.send_to(line.as_bytes(), "/dev/log").is_ok() {
                self.stats.syslog += 1;
            }
        }
    }

    // --- Clock ---------------------------------------------------------------

    pub fn clock_tick(&mut self, now: &Now) {
        if self.clock.tick(now.wall, now.mono_s()) == Change::Trusted {
            self.backdate();
        }
    }

    /// Gives every untrusted row in RAM its wall time once trust arrives.
    fn backdate(&mut self) {
        let from = match self.null_from.take() {
            Some(s) => s,
            None => return,
        };
        let off = self.clock.off;
        let i = self.ring.index_after(from.saturating_sub(1));
        let mut newest = None;
        let boot = self.boot;
        let info = self.index.entry(boot);
        for r in self.ring.iter_mut_from(i) {
            if r.t.is_none() {
                let t = (r.m / 100) as i64 + off;
                r.t = Some(t);
                info.note(r.s, r.t, None);
                newest = newest.max(Some(t));
            }
        }
        if let Some(t) = newest {
            self.clock.note(t);
        }
        for r in self.events.rows.iter_mut() {
            if r.t.is_none() && r.b == boot {
                r.t = Some((r.m / 100) as i64 + off);
                self.events.dirty = true;
            }
        }
    }

    // --- Debug lease ---------------------------------------------------------

    fn lease_path(&self) -> String {
        format!("{}/debug", self.cfg.run_dir)
    }

    /// Re-reads `journal/debug` (on start and whenever it changes).
    pub fn on_debug_file(&mut self, now: &Now) {
        let path = self.lease_path();
        let text = match std::fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_file() => std::fs::read_to_string(&path).ok(),
            _ => None,
        };
        let was = self.lease_live(now);
        match text {
            None => {
                if self.lease.take().is_some() && was {
                    self.self_log(Level::Info, "debug logging ended", now);
                }
            }
            Some(t) => {
                let exp = match t.trim().parse::<i64>() {
                    Ok(x) => x,
                    Err(_) => match self.lease {
                        Some(x) => x,
                        None => now.mono_s() + LEASE_DEFAULT_S,
                    },
                };
                self.lease = Some(exp);
                if exp <= now.mono_s() {
                    self.end_lease(now, was);
                } else if !was {
                    let m = format!("debug logging on for {} s", exp - now.mono_s());
                    self.self_log(Level::Info, &m, now);
                }
            }
        }
    }

    fn end_lease(&mut self, now: &Now, was_live: bool) {
        self.lease = None;
        let _ = std::fs::remove_file(self.lease_path());
        if was_live {
            self.self_log(Level::Info, "debug logging ended", now);
        }
    }

    // --- Timers --------------------------------------------------------------

    /// The nearest deadline (timer ms), None when nothing is waiting: idle
    /// logd sleeps until a writer or a client wakes it.
    pub fn next_deadline(&self, now: &Now) -> Option<u64> {
        let mut d: Option<u64> = None;
        let mut put = |x: Option<u64>| {
            if let Some(x) = x {
                d = Some(d.map_or(x, |y| y.min(x)));
            }
        };
        put(self.collapse.deadline());
        put(self.rate.deadline());
        put(self.text.deadline());
        put(self.events.deadline());
        put(self.urgent_at);
        put(self.first_pending_ms.map(|t| t + REGULAR_MS));
        put(self.lease.map(|x| (x.max(0) as u64) * 1000));
        // Rows waiting for a wall time get one look at the uptime settle.
        if !self.clock.trusted && self.null_from.is_some() && now.mono_s() < SETTLE {
            put(Some(SETTLE as u64 * 1000 + 10));
        }
        d
    }

    /// Fires every timer that is due.
    pub fn tick(&mut self, now: &Now) {
        self.clock_tick(now);
        for (c, lv, p, msg) in self.collapse.expire(now.ms()) {
            self.store(Body::Log { lv, c, p, msg }, now.mono_cs, now);
        }
        let ended = self.rate.expire(now.ms());
        self.store_rate(ended, now);
        if let Some(x) = self.lease {
            if now.mono_s() >= x {
                self.end_lease(now, true);
            }
        }
        let due = |d: Option<u64>| d.map_or(false, |d| d <= now.ms());
        let regular = due(self.first_pending_ms.map(|t| t + REGULAR_MS));
        if regular || due(self.urgent_at) {
            // A storm still dropping is reported with what reaches flash.
            let open = self.rate.drain(now.ms());
            self.store_rate(open, now);
            self.flush_as(now, false, regular);
        }
        if due(self.text.deadline()) {
            self.text.flush();
        }
        if due(self.events.deadline()) {
            self.events.write(now.wall, now.ms());
        }
    }

    // --- Flash ---------------------------------------------------------------

    fn null_day(&self) -> i64 {
        let newest = [Kind::Log, Kind::Ev].iter().filter_map(|&k| self.journal.days(k).last().map(|d| d.0)).max();
        match newest {
            Some(d) => d,
            None if self.clock.floor > 0 => epochday(self.clock.floor),
            None => 0,
        }
    }

    /// Appends every pending row to flash and writes the state file
    /// (durably only when `clean`).
    pub fn flush(&mut self, now: &Now, clean: bool) {
        self.flush_as(now, clean, clean);
    }

    /// `durable`: the state file is synced too. Urgent and eviction flushes
    /// leave it in the page cache: only a power cut or kernel crash loses it,
    /// and that is a new boot, where `open` rebuilds seq and boot from the
    /// flash rows (plus `UNCLEAN_SEQ_GAP`, state being `clean=0`).
    fn flush_as(&mut self, now: &Now, clean: bool, durable: bool) {
        self.clock_tick(now);
        // The newest row in the ring, not `seq`: a flush forced by eviction
        // runs while the row that caused it is not in the ring yet.
        let head = self.ring.iter().next_back().map_or(self.flushed_s, |r| r.s).max(self.flushed_s);
        let i = self.ring.index_after(self.flushed_s);
        let persist = self.cfg.persist_level;
        let any = self.ring.range_from(i).any(|r| r.log_level().map_or(true, |l| l >= persist));
        if any {
            let low = self.journal.free_bytes().map_or(false, |f| f < self.min_free);
            if low {
                self.stats.flush_skips += 1;
            } else {
                let null_day = self.null_day();
                let rows: Vec<&Row> = self.ring.range_from(i).filter(|r| r.log_level().map_or(true, |l| l >= persist)).collect();
                let mut fs = FlushStats::default();
                self.journal.append(&rows, null_day, &mut fs, &mut self.index, &self.names);
                self.stats.fsyncs += fs.fsyncs;
                self.stats.cap_drops += fs.cap_drops;
                self.stats.flush_errors += fs.errors;
                self.stats.rows_flushed += fs.rows;
                let today = if self.clock.trusted { epochday(now.wall) } else { -1 };
                if self.stats.bytes_day.0 != today {
                    self.stats.bytes_day = (today, 0);
                }
                self.stats.bytes_day.1 += fs.bytes;
            }
            self.stats.flushes += 1;
            self.stats.last_flush_ms = Some(now.ms());
        }
        if self.urgent_at.is_some() {
            self.last_urgent_ms = Some(now.ms());
        }
        self.urgent_at = None;
        self.first_pending_ms = None;
        self.flushed_s = head;
        if any || clean {
            self.save_state(now, clean, durable);
        }
        if self.last_retain_ms.map_or(true, |t| now.ms() >= t + RETAIN_GAP_MS) {
            self.retain(now);
        }
    }

    fn save_state(&mut self, now: &Now, clean: bool, durable: bool) {
        if self.clock.trusted {
            self.clock.note(now.wall);
        }
        let st = State {
            seq: self.seq,
            boot: self.boot,
            boot_id: self.boot_id.clone(),
            last_wall: self.clock.floor,
            clean,
            kmsg_seq: self.kmsg_hw,
            kmsg_ssr: self.kmsg_ssr,
        };
        if !durable {
            let _ = self.journal.save_state_volatile(&st);
        } else if self.journal.save_state(&st).is_ok() {
            self.stats.fsyncs += 1;
        }
    }

    fn retain(&mut self, now: &Now) {
        let today = self.clock.trusted.then(|| epochday(now.wall));
        let n = self.journal.retain(Kind::Log, today) + self.journal.retain(Kind::Ev, today);
        if n > 0 {
            // Day files went: rebuild the flash half of the boot index.
            let (_, idx) = self.journal.scan();
            let cur = self.index.remove(self.boot);
            self.index = idx;
            if let Some(c) = cur {
                let f = self.index.entry(self.boot);
                let (days, fmin) = (f.days, f.flash_min_s);
                *f = BootInfo { days, flash_min_s: fmin, ..c };
            }
        }
        self.last_retain_ms = Some(now.ms());
    }

    /// TERM: close collapse runs, write both mirrors, final flush (clean).
    pub fn shutdown(&mut self, now: &Now) {
        for (c, lv, p, msg) in self.collapse.drain() {
            self.store(Body::Log { lv, c, p, msg }, now.mono_cs, now);
        }
        let open = self.rate.drain(now.ms());
        self.store_rate(open, now);
        self.self_log(Level::Info, "journal stopping", now);
        self.text.flush();
        if self.events.dirty {
            self.events.write(now.wall, now.ms());
        }
        self.flush(now, true);
    }
}


#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;

    pub(crate) fn cfg(name: &str) -> Config {
        let d = std::env::temp_dir().join(format!("qlogd-core-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("run")).unwrap();
        let p = |x: &str| d.join(x).to_str().unwrap().to_string();
        fs::write(p("boot_id"), "boot-A\n").unwrap();
        Config {
            run_dir: p("run"),
            journal_dir: p("journal"),
            sock: p("logd.sock"),
            proto: p("logd.proto"),
            text_log: p("qmanager.log"),
            events_mirror: p("events.json"),
            uptime: p("uptime"),
            boot_id: p("boot_id"),
            kmsg: String::new(),
            level: Level::Info,
            persist_level: Level::Info,
            forward_syslog: false,
        }
    }

    pub(crate) const W: i64 = 1_794_199_000;

    pub(crate) fn feed(e: &mut Engine, now: &Now, text: &str) {
        e.ingest_reader(text.as_bytes(), now);
    }

    fn log_lines(c: &Config) -> Vec<String> {
        let mut v = Vec::new();
        for ent in fs::read_dir(&c.journal_dir).unwrap().flatten() {
            let n = ent.file_name().to_str().unwrap().to_string();
            if n.starts_with("log-") {
                v.extend(fs::read_to_string(ent.path()).unwrap().lines().map(str::to_string));
            }
        }
        v
    }

    fn ev_lines(c: &Config) -> Vec<String> {
        let mut v = Vec::new();
        for ent in fs::read_dir(&c.journal_dir).unwrap().flatten() {
            let n = ent.file_name().to_str().unwrap().to_string();
            if n.starts_with("ev-") {
                v.extend(fs::read_to_string(ent.path()).unwrap().lines().map(str::to_string));
            }
        }
        v
    }

    #[test]
    fn an_error_is_on_flash_within_2s_and_urgent_flushes_coalesce_to_120s() {
        let c = cfg("urgent");
        let mut now = Now::at(1000.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t1000.00\tINFO\tpoller\t1\tquiet\n");
        assert_eq!(e.next_deadline(&now), Some(1_000_000 + 1000), "mirror batch first");
        feed(&mut e, &now, "L\t1000.00\tERROR\tpoller\t1\tbroke\n");
        now = Now::at(1001.0, W + 1);
        e.tick(&now);
        assert!(log_lines(&c).is_empty(), "not yet");
        assert_eq!(e.next_deadline(&now), Some(1_002_000));
        now = Now::at(1002.0, W + 2);
        e.tick(&now);
        let l = log_lines(&c);
        assert_eq!(l.len(), 2, "{l:?}");
        assert!(l[1].contains("\"lv\":\"ERROR\"") && l[1].contains(&format!("\"t\":{}", W)), "{}", l[1]);
        let fs0 = e.stats.fsyncs;
        // A second error 5 s later waits for the 120 s gap.
        now = Now::at(1007.0, W + 7);
        feed(&mut e, &now, "L\t1007.00\tERROR\tpoller\t1\tagain\n");
        assert_eq!(e.urgent_at, Some(1_122_000));
        now = Now::at(1121.0, W + 121);
        e.tick(&now);
        assert_eq!(log_lines(&c).len(), 2);
        now = Now::at(1122.0, W + 122);
        e.tick(&now);
        assert_eq!(log_lines(&c).len(), 3);
        assert_eq!(e.stats.fsyncs, fs0 + 1, "an urgent flush syncs the day file, not the state");
        // The state file is still current (page cache) for a logd restart.
        assert_eq!(e.journal.load_state().unwrap().seq, e.head());
        // A warning event is urgent too; an info event waits for 5 min.
        now = Now::at(1200.0, W + 200);
        feed(&mut e, &now, "E\t1200\tband_change\tinfo\t\t\tB3\n");
        assert_eq!(e.first_pending_ms, Some(1_200_000));
        assert_eq!(e.urgent_at, None);
        now = Now::at(1499.0, W + 499);
        e.tick(&now);
        assert!(ev_lines(&c).is_empty());
        let fs1 = e.stats.fsyncs;
        now = Now::at(1500.0, W + 500);
        e.tick(&now);
        assert_eq!(ev_lines(&c).len(), 1);
        assert_eq!(e.stats.fsyncs, fs1 + 2, "the periodic flush syncs the state too");
        assert_eq!(e.next_deadline(&now), None, "idle: no timer at all");
        // State carries the seq head and the wall floor.
        let st = e.journal.load_state().unwrap();
        assert_eq!((st.seq, st.boot, st.boot_id.as_str(), st.clean), (e.head(), 1, "boot-A", false));
        assert_eq!(st.last_wall, W + 500);
    }

    #[test]
    fn debug_rows_are_dropped_until_a_lease_and_never_persisted_by_default() {
        let c = cfg("lease");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t500\tDEBUG\tcgi\t1\thidden\n");
        assert_eq!((e.ring.len(), e.stats.level_drops), (0, 1));
        // Unparsable lease → first-seen + 1800 s.
        fs::write(format!("{}/debug", c.run_dir), "soon").unwrap();
        e.on_debug_file(&now);
        assert_eq!(e.lease, Some(500 + LEASE_DEFAULT_S));
        assert!(e.ring.iter().any(|r| r.msg().starts_with("debug logging on")));
        feed(&mut e, &now, "L\t500\tDEBUG\tcgi\t1\tshown\n");
        assert!(e.ring.iter().any(|r| r.msg() == "shown"));
        // An explicit expiry replaces it; expiry removes the file and logs.
        fs::write(format!("{}/debug", c.run_dir), "600\n").unwrap();
        e.on_debug_file(&now);
        assert_eq!(e.lease, Some(600));
        assert!(e.next_deadline(&now).unwrap() <= 600_000);
        let later = Now::at(600.0, W + 100);
        e.tick(&later);
        assert!(!std::path::Path::new(&format!("{}/debug", c.run_dir)).exists());
        assert!(e.ring.iter().any(|r| r.msg() == "debug logging ended"));
        e.flush(&later, false);
        assert!(!log_lines(&c).iter().any(|l| l.contains("\"lv\":\"DEBUG\"")));
        // An already expired lease file is removed at once.
        fs::write(format!("{}/debug", c.run_dir), "10").unwrap();
        e.on_debug_file(&later);
        assert!(e.lease.is_none() && !std::path::Path::new(&format!("{}/debug", c.run_dir)).exists());
    }

    #[test]
    fn untrusted_rows_are_back_dated_when_trust_arrives() {
        let c = cfg("backdate");
        // 1970 boot at uptime 20.
        let now = Now::at(20.0, 20);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t15.50\tINFO\tpoller\t1\tearly\nE\t16\tsignal_lost\twarning\t\t\tlost\n");
        assert!(e.ring.iter().all(|r| r.t.is_none()));
        assert_eq!(e.next_deadline(&now).unwrap() <= SETTLE as u64 * 1000 + 10, true);
        // NITZ steps the wall clock at uptime 40.
        let now = Now::at(40.0, W + 40);
        e.tick(&now);
        let ts: Vec<Option<i64>> = e.ring.iter().map(|r| r.t).collect();
        assert_eq!(ts[0], Some(W + 15));
        assert_eq!(ts[1], Some(W + 16));
        assert_eq!(e.events.rows.back().unwrap().t, Some(W + 16));
        e.tick(&Now::at(42.0, W + 42));
        let mirror = fs::read_to_string(&c.events_mirror).unwrap();
        assert!(mirror.contains(&format!("\"timestamp\":{}", W + 16)), "{mirror}");
    }

    #[test]
    fn rows_flushed_before_trust_land_in_the_null_day() {
        let c = cfg("nullday");
        let now = Now::at(20.0, 20);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t15\tINFO\tpoller\t1\tearly\n");
        e.flush(&now, false);
        assert!(std::path::Path::new(&format!("{}/log-0.jsonl", c.journal_dir)).exists());
        assert!(log_lines(&c)[0].contains("\"t\":null"));
    }

    #[test]
    fn low_space_skips_the_flush() {
        let c = cfg("lowspace");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        assert!(e.journal.free_bytes().unwrap() > 0);
        assert_eq!(MIN_FREE, 8 * 1024 * 1024);
        // A device with less free space than the guard: nothing is written,
        // the rows stay in RAM and the pending mark moves on.
        e.min_free = u64::MAX;
        feed(&mut e, &now, "L\t500\tERROR\tx\t1\tboom\n");
        e.flush(&now, false);
        assert_eq!(e.stats.flush_skips, 1);
        assert!(log_lines(&c).is_empty());
        assert!(e.ring.iter().any(|r| r.msg() == "boom"));
        e.min_free = MIN_FREE;
        feed(&mut e, &now, "L\t500\tERROR\tx\t1\tanother failure\n");
        e.flush(&now, false);
        assert_eq!(log_lines(&c).len(), 1, "only the new row: skipped rows are not retried");
    }

    #[test]
    fn a_restart_keeps_seq_monotonic_and_a_new_boot_id_bumps_the_boot() {
        let c = cfg("restart");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t500\tINFO\ta\t1\tone\nL\t500\tINFO\ta\t1\ttwo\n");
        e.shutdown(&now);
        let head = e.head();
        drop(e);
        // Clean restart, same boot: seq continues, boot unchanged.
        let mut e = Engine::open(c.clone(), &now).unwrap();
        assert_eq!((e.head(), e.boot), (head, 1));
        feed(&mut e, &now, "L\t501\tINFO\ta\t1\tthree\n");
        assert_eq!(e.ring.iter().last().unwrap().s, head + 1);
        // Crash (no shutdown) after a flush: the gap skips unflushed numbers.
        e.flush(&now, false);
        feed(&mut e, &now, "L\t501\tINFO\ta\t1\tlost\n");
        let lost = e.head();
        drop(e);
        let e = Engine::open(c.clone(), &now).unwrap();
        assert!(e.head() >= lost + UNCLEAN_SEQ_GAP - 1, "{} vs {lost}", e.head());
        drop(e);
        // A new boot_id is the next boot index.
        fs::write(&c.boot_id, "boot-B\n").unwrap();
        let e = Engine::open(c.clone(), &now).unwrap();
        assert_eq!(e.boot, 2);
        assert!(e.index.get(1).is_some(), "the old boot is in the index");
        drop(e);
        // State lost but flash kept: seq and boot still come from the rows.
        fs::remove_file(format!("{}/state", c.journal_dir)).unwrap();
        let e = Engine::open(c.clone(), &now).unwrap();
        assert!(e.head() >= head + 1 && e.boot == 2, "{} {}", e.head(), e.boot);
    }

    #[test]
    fn repeats_collapse_and_a_storm_never_evicts_unflushed_rows() {
        let mut c = cfg("storm");
        c.level = Level::Info;
        let mut now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        for i in 0..30 {
            feed(&mut e, &now, &format!("L\t500\tWARN\tpoller\t1\tPing data stale (age={}s)\n", 90 + 2 * i));
            now.mono_cs += 200;
        }
        assert_eq!(e.ring.len(), 1);
        now = Now::at(560.0, W + 60);
        assert_eq!(e.collapse.deadline(), Some(560_000));
        e.tick(&now);
        assert!(e.ring.iter().last().unwrap().msg().ends_with("… repeated 29 times in 60 s"));
        // A storm of distinct lines past the ring bound: flash gets everything.
        e.ring.max_rows = 100;
        for i in 0..1000 {
            let word: String = format!("{i:04}").bytes().map(|b| (b - b'0' + b'a') as char).collect();
            feed(&mut e, &now, &format!("L\t560\tINFO\tc{}\t1\tline {word}\n", i % 10));
            now.mono_cs += 10;
        }
        e.flush(&now, false);
        let l = log_lines(&c);
        assert_eq!(l.len(), 1002, "every kept row reached flash");
        let seqs: Vec<u64> = l.iter().map(|x| super::super::record::quick_sbt(x).unwrap().0).collect();
        assert!(seqs.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn events_never_collapse_and_seed_the_mirror_on_restart() {
        let c = cfg("events");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        for _ in 0..3 {
            feed(&mut e, &now, "E\t500\tpci_change\tinfo\t\t\tPCI 1 -> 2\n");
        }
        assert_eq!(e.stats.events, 3);
        e.shutdown(&now);
        drop(e);
        let _ = fs::remove_file(&c.events_mirror);
        let e = Engine::open(c.clone(), &now).unwrap();
        assert_eq!(e.events.rows.len(), 3);
        assert!(e.events.rows.iter().all(|r| r.t == Some(W)));
    }

    #[test]
    fn a_rate_storm_keeps_100_per_s_and_reports_drops_once_when_it_ends() {
        let c = cfg("ratestorm");
        let mut now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        e.ring.max_rows = 100_000;
        let word = |i: u32| -> String { format!("{i:05}").bytes().map(|b| (b - b'0' + b'a') as char).collect() };
        let batch = |n: &mut u32, k: u32| -> String {
            let mut b = String::new();
            for _ in 0..k {
                b.push_str(&format!("L\t500\tINFO\tsites\t1\tline {}\n", word(*n)));
                *n += 1;
            }
            b
        };
        let mut n = 0;
        // 100 distinct lines/s for 60 s, one spool batch per second: nothing lost.
        for _ in 0..60 {
            let b = batch(&mut n, 100);
            feed(&mut e, &now, &b);
            now.mono_cs += 100;
            e.tick(&now);
        }
        assert_eq!(e.rate.dropped, 0);
        // 300/s for 10 s: drops, but no row while the storm runs.
        for _ in 0..10 {
            let b = batch(&mut n, 300);
            feed(&mut e, &now, &b);
            now.mono_cs += 100;
            e.tick(&now);
        }
        let dropped = e.rate.dropped;
        assert!(dropped > 1000, "{dropped}");
        let reports = |e: &Engine| e.ring.iter().filter(|r| r.msg().starts_with("rate limit: dropped")).count();
        assert_eq!(reports(&e), 0);
        // Quiet: one row for the whole storm, with its count and length
        // (the burst lasts 2 s, drops run from then to the last batch).
        for _ in 0..12 {
            now.mono_cs += 100;
            e.tick(&now);
        }
        assert_eq!(reports(&e), 1);
        let r = e.ring.iter().find(|r| r.msg().starts_with("rate limit: dropped")).unwrap();
        assert_eq!(r.msg(), format!("rate limit: dropped {dropped} lines in 7 s"));
        assert_eq!(r.log_level(), Some(Level::Warn));
        // A storm still running at TERM is reported then, marked ongoing.
        let b = batch(&mut n, 600);
        feed(&mut e, &now, &b);
        e.shutdown(&now);
        assert_eq!(reports(&e), 2);
        assert!(log_lines(&c).iter().any(|l| l.contains("(still dropping)")));
    }
}
