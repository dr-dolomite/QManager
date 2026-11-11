//! Log hygiene before a row is stored: repeat-collapse and a per-component
//! token bucket. Events never pass through here.
//!
//! Collapse key = (component, level, message with ASCII digits removed). The
//! first line of a key opens a 60 s window and is kept; repeats inside it are
//! counted and dropped; when the window ends with N > 0 dropped, one summary
//! row `<first message> … repeated N times in 60 s` is emitted.
//!
//! Rate limit: a token bucket per component. A run of drops is one storm,
//! reported by one WARN row `rate limit: dropped N lines in D s` once no line
//! was dropped for `RATE_QUIET_MS`; a storm still running at a timed flush or
//! TERM is reported then with ` (still dropping)`.

use crate::common::log::Level;

pub const WINDOW_MS: u64 = 60_000;
/// Keys tracked at once; past this the expired ones are dropped first.
const MAX_KEYS: usize = 256;
/// Characters of the first message kept for the summary.
const FIRST_CHARS: usize = 200;

/// Per-component refill: a component writing 100 distinct lines/s for as long
/// as it likes loses nothing.
pub const RATE_PER_SEC: f64 = 100.0;
pub const RATE_BURST: f64 = 500.0;
/// A storm (a run of drops) ends after this long without a drop; its one
/// summary row is stored then.
pub const RATE_QUIET_MS: u64 = 10_000;
const MAX_BUCKETS: usize = 256;

struct Win {
    start_ms: u64,
    n: u64,
    c: String,
    lv: Level,
    p: u32,
    first: String,
}

/// A summary to emit: (component, level, pid, message).
pub type Summary = (String, Level, u32, String);

#[derive(Default)]
pub struct Collapser {
    /// (key, window): a few dozen keys at most, so a Vec beats a map here.
    /// (key hash, window): a storm of long distinct lines costs a few bytes
    /// per key, not a copy of each line.
    wins: Vec<(u64, Win)>,
    /// Lines suppressed so far (STAT).
    pub suppressed: u64,
}

/// FNV-1a over (component, level, message without ASCII digits).
fn key(c: &str, lv: Level, msg: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |b: u8| {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    };
    c.bytes().for_each(&mut eat);
    eat(0);
    eat(lv as u8);
    eat(0);
    msg.bytes().filter(|b| !b.is_ascii_digit()).for_each(&mut eat);
    h
}

fn first_of(msg: &str) -> String {
    let mut first: String = msg.chars().take(FIRST_CHARS).collect();
    if first.len() < msg.len() {
        first.push('…');
    }
    first
}

fn summary_of(w: &Win) -> Summary {
    (w.c.clone(), w.lv, w.p, format!("{} … repeated {} times in 60 s", w.first, w.n))
}

impl Collapser {
    /// Decides one line. Returns whether to keep it, plus a summary that must
    /// be stored *before* it (a run of this key ended).
    pub fn offer(&mut self, c: &str, lv: Level, p: u32, msg: &str, now_ms: u64) -> (bool, Option<Summary>) {
        let k = key(c, lv, msg);
        if let Some((_, w)) = self.wins.iter_mut().find(|(x, _)| *x == k) {
            if now_ms < w.start_ms + WINDOW_MS {
                w.n += 1;
                w.p = p;
                self.suppressed += 1;
                return (false, None);
            }
            let sum = (w.n > 0).then(|| summary_of(w));
            *w = Win { start_ms: now_ms, n: 0, c: c.to_string(), lv, p, first: first_of(msg) };
            return (true, sum);
        }
        if self.wins.len() >= MAX_KEYS {
            self.wins.retain(|(_, w)| w.n > 0 || now_ms < w.start_ms + WINDOW_MS);
            if self.wins.len() >= MAX_KEYS {
                // Every key is live: forget the quiet ones (their summary is 0).
                self.wins.retain(|(_, w)| w.n > 0);
            }
        }
        if self.wins.len() < MAX_KEYS {
            self.wins.push((k, Win { start_ms: now_ms, n: 0, c: c.to_string(), lv, p, first: first_of(msg) }));
        }
        (true, None)
    }

    /// Summaries of every window that has ended; quiet ended windows are
    /// forgotten.
    pub fn expire(&mut self, now_ms: u64) -> Vec<Summary> {
        let mut out = Vec::new();
        self.wins.retain(|(_, w)| {
            if now_ms < w.start_ms + WINDOW_MS {
                return true;
            }
            if w.n > 0 {
                out.push(summary_of(w));
            }
            false
        });
        out
    }

    /// Every open window with suppressed lines, ended now (shutdown).
    pub fn drain(&mut self) -> Vec<Summary> {
        let out = self.wins.iter().map(|e| &e.1).filter(|w| w.n > 0).map(summary_of).collect();
        self.wins.clear();
        out
    }

    /// When the next summary is due (only windows that suppressed something).
    pub fn deadline(&self) -> Option<u64> {
        self.wins.iter().map(|e| &e.1).filter(|w| w.n > 0).map(|w| w.start_ms + WINDOW_MS).min()
    }
}

struct Bucket {
    tokens: f64,
    last_ms: u64,
    p: u32,
    /// Lines dropped since the last report of this storm.
    dropped: u64,
    /// First drop since the last report, and the latest drop.
    from_ms: u64,
    last_drop_ms: u64,
}

/// A drop report to store: (component, pid, message).
pub type RateReport = (String, u32, String);

fn report_of(c: &str, b: &mut Bucket, to_ms: u64, ongoing: bool) -> RateReport {
    let secs = (to_ms.saturating_sub(b.from_ms) + 999) / 1000;
    let tail = if ongoing { " (still dropping)" } else { "" };
    let m = format!("rate limit: dropped {} lines in {} s{tail}", b.dropped, secs.max(1));
    b.dropped = 0;
    (c.to_string(), b.p, m)
}

#[derive(Default)]
pub struct RateLimit {
    buckets: Vec<(String, Bucket)>,
    pub dropped: u64,
}

impl RateLimit {
    /// Takes a token for `c`. `Ok(Some(r))`: allowed, and the storm this
    /// component was in has gone quiet; store `r` before the line (the
    /// timer was missed).
    pub fn take(&mut self, c: &str, p: u32, now_ms: u64) -> Result<Option<RateReport>, ()> {
        let i = match self.buckets.iter().position(|(x, _)| x == c) {
            Some(i) => i,
            None => {
                if self.buckets.len() >= MAX_BUCKETS {
                    self.buckets.retain(|(_, b)| b.dropped > 0);
                }
                let b = Bucket { tokens: RATE_BURST, last_ms: now_ms, p, dropped: 0, from_ms: 0, last_drop_ms: 0 };
                self.buckets.push((c.to_string(), b));
                self.buckets.len() - 1
            }
        };
        let (name, b) = &mut self.buckets[i];
        let dt = now_ms.saturating_sub(b.last_ms) as f64 / 1000.0;
        b.tokens = (b.tokens + dt * RATE_PER_SEC).min(RATE_BURST);
        b.last_ms = now_ms;
        b.p = p;
        if b.tokens < 1.0 {
            if b.dropped == 0 {
                b.from_ms = now_ms;
            }
            b.dropped += 1;
            b.last_drop_ms = now_ms;
            self.dropped += 1;
            return Err(());
        }
        b.tokens -= 1.0;
        if b.dropped > 0 && now_ms >= b.last_drop_ms + RATE_QUIET_MS {
            let to = b.last_drop_ms;
            return Ok(Some(report_of(name, b, to, false)));
        }
        Ok(None)
    }

    /// Reports of every storm that has gone quiet.
    pub fn expire(&mut self, now_ms: u64) -> Vec<RateReport> {
        let mut out = Vec::new();
        for (c, b) in self.buckets.iter_mut() {
            if b.dropped > 0 && now_ms >= b.last_drop_ms + RATE_QUIET_MS {
                let to = b.last_drop_ms;
                out.push(report_of(c, b, to, false));
            }
        }
        out
    }

    /// Reports of every storm with unreported drops, ended or not (before a
    /// flush and at shutdown, so drops never go unrecorded on flash).
    pub fn drain(&mut self, now_ms: u64) -> Vec<RateReport> {
        let mut out = Vec::new();
        for (c, b) in self.buckets.iter_mut() {
            if b.dropped > 0 {
                let ongoing = now_ms < b.last_drop_ms + RATE_QUIET_MS;
                let to = if ongoing { now_ms } else { b.last_drop_ms };
                out.push(report_of(c, b, to, ongoing));
            }
        }
        out
    }

    /// When the next storm may end.
    pub fn deadline(&self) -> Option<u64> {
        self.buckets.iter().map(|e| &e.1).filter(|b| b.dropped > 0).map(|b| b.last_drop_ms + RATE_QUIET_MS).min()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_inside_the_window_collapse_into_one_summary() {
        let mut c = Collapser::default();
        assert_eq!(c.offer("poller", Level::Warn, 1, "Ping data stale (age=90s)", 0), (true, None));
        for i in 1..30u64 {
            let (keep, s) = c.offer("poller", Level::Warn, 2, &format!("Ping data stale (age={}s)", 90 + i), i * 2000);
            assert!(!keep && s.is_none());
        }
        // A different level or component is its own key.
        assert!(c.offer("poller", Level::Error, 1, "Ping data stale (age=1s)", 1000).0);
        assert!(c.offer("ping", Level::Warn, 1, "Ping data stale (age=1s)", 1000).0);
        assert_eq!(c.suppressed, 29);
        assert_eq!(c.deadline(), Some(60_000));
        assert!(c.expire(59_999).is_empty());
        let s = c.expire(60_000);
        assert_eq!(s, vec![("poller".into(), Level::Warn, 2, "Ping data stale (age=90s) … repeated 29 times in 60 s".into())]);
        assert_eq!(c.deadline(), None, "quiet windows set no timer");
        // After the window, the next line is kept again and opens a new one.
        assert_eq!(c.offer("poller", Level::Warn, 1, "Ping data stale (age=200s)", 61_000), (true, None));
    }

    #[test]
    fn a_line_after_an_unexpired_run_emits_the_summary_first() {
        let mut c = Collapser::default();
        c.offer("a", Level::Info, 1, "x 1", 0);
        c.offer("a", Level::Info, 1, "x 2", 10);
        // The timer was missed: the next line still closes the run first.
        let (keep, s) = c.offer("a", Level::Info, 1, "x 3", 70_000);
        assert!(keep);
        assert_eq!(s.unwrap().3, "x 1 … repeated 1 times in 60 s");
        c.offer("a", Level::Info, 1, "x 4", 70_001);
        assert_eq!(c.drain().len(), 1);
        assert!(c.drain().is_empty());
    }

    #[test]
    fn the_token_bucket_bursts_then_drops_and_reports_once_per_storm() {
        let mut r = RateLimit::default();
        for _ in 0..500 {
            assert_eq!(r.take("sites", 1, 0), Ok(None));
        }
        assert_eq!(r.take("sites", 1, 0), Err(()));
        assert_eq!(r.take("sites", 1, 5), Err(()));
        // Another component has its own bucket.
        assert_eq!(r.take("poller", 1, 5), Ok(None));
        // 20 ms refills 2 tokens: allowed lines inside the storm report nothing.
        assert_eq!(r.take("sites", 1, 25), Ok(None));
        assert_eq!(r.take("sites", 1, 25), Ok(None));
        assert_eq!(r.take("sites", 2, 25), Err(()));
        assert_eq!(r.dropped, 3);
        assert_eq!(r.deadline(), Some(25 + RATE_QUIET_MS));
        assert!(r.expire(25 + RATE_QUIET_MS - 1).is_empty());
        let v = r.expire(25 + RATE_QUIET_MS);
        assert_eq!(v, vec![("sites".into(), 2, "rate limit: dropped 3 lines in 1 s".into())]);
        assert_eq!(r.deadline(), None);
        assert!(r.expire(u64::MAX / 2).is_empty(), "one report per storm");
    }

    #[test]
    fn a_sustained_100_per_second_storm_loses_nothing() {
        let mut r = RateLimit::default();
        for i in 0..6000u64 {
            assert_eq!(r.take("storm", 1, i * 10), Ok(None), "line {i}");
        }
        // Batched arrival (a spool read of 500 lines at once) still fits the burst.
        let mut r = RateLimit::default();
        for s in 0..60u64 {
            for _ in 0..100 {
                assert_eq!(r.take("storm", 1, s * 1000), Ok(None));
            }
        }
        assert_eq!(r.dropped, 0);
    }

    #[test]
    fn a_missed_timer_reports_on_the_next_line_and_drain_reports_ongoing_storms() {
        let mut r = RateLimit::default();
        for _ in 0..600 {
            let _ = r.take("x", 1, 0);
        }
        assert_eq!(r.dropped, 100);
        let (_, _, m) = r.take("x", 1, 20_000).unwrap().unwrap();
        assert_eq!(m, "rate limit: dropped 100 lines in 1 s");
        for _ in 0..600 {
            let _ = r.take("y", 1, 100_000);
        }
        let _ = r.take("y", 1, 103_500);
        let v = r.drain(104_000);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].2, "rate limit: dropped 100 lines in 4 s (still dropping)");
        assert!(r.drain(200_000).is_empty());
    }
}
