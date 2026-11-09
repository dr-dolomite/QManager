//! Log hygiene before a row is stored: repeat-collapse and a per-component
//! token bucket. Events never pass through here.
//!
//! Collapse key = (component, level, message with ASCII digits removed). The
//! first line of a key opens a 60 s window and is kept; repeats inside it are
//! counted and dropped; when the window ends with N > 0 dropped, one summary
//! row `<first message> … repeated N times in 60 s` is emitted.

use crate::common::log::Level;
use std::collections::HashMap;

pub const WINDOW_MS: u64 = 60_000;
/// Keys tracked at once; past this the expired ones are dropped first.
const MAX_KEYS: usize = 512;

pub const RATE_PER_SEC: f64 = 20.0;
pub const RATE_BURST: f64 = 200.0;
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
    wins: HashMap<String, Win>,
    /// Lines suppressed so far (STAT).
    pub suppressed: u64,
}

fn key(c: &str, lv: Level, msg: &str) -> String {
    let mut k = String::with_capacity(c.len() + msg.len() + 8);
    k.push_str(c);
    k.push('\0');
    k.push_str(lv.name());
    k.push('\0');
    k.extend(msg.chars().filter(|ch| !ch.is_ascii_digit()));
    k
}

fn summary_of(w: &Win) -> Summary {
    let mut first: String = w.first.chars().take(200).collect();
    if w.first.chars().count() > 200 {
        first.push('…');
    }
    (w.c.clone(), w.lv, w.p, format!("{first} … repeated {} times in 60 s", w.n))
}

impl Collapser {
    /// Decides one line. Returns whether to keep it, plus a summary that must
    /// be stored *before* it (a run of this key ended).
    pub fn offer(&mut self, c: &str, lv: Level, p: u32, msg: &str, now_ms: u64) -> (bool, Option<Summary>) {
        let k = key(c, lv, msg);
        if let Some(w) = self.wins.get_mut(&k) {
            if now_ms < w.start_ms + WINDOW_MS {
                w.n += 1;
                w.p = p;
                self.suppressed += 1;
                return (false, None);
            }
            let sum = (w.n > 0).then(|| summary_of(w));
            *w = Win { start_ms: now_ms, n: 0, c: c.to_string(), lv, p, first: msg.to_string() };
            return (true, sum);
        }
        if self.wins.len() >= MAX_KEYS {
            self.wins.retain(|_, w| w.n > 0 || now_ms < w.start_ms + WINDOW_MS);
            if self.wins.len() >= MAX_KEYS {
                // Every key is live: forget the quiet ones (their summary is 0).
                self.wins.retain(|_, w| w.n > 0);
            }
        }
        if self.wins.len() < MAX_KEYS {
            self.wins.insert(k, Win { start_ms: now_ms, n: 0, c: c.to_string(), lv, p, first: msg.to_string() });
        }
        (true, None)
    }

    /// Summaries of every window that has ended; quiet ended windows are
    /// forgotten.
    pub fn expire(&mut self, now_ms: u64) -> Vec<Summary> {
        let mut out = Vec::new();
        self.wins.retain(|_, w| {
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
        let out = self.wins.values().filter(|w| w.n > 0).map(summary_of).collect();
        self.wins.clear();
        out
    }

    /// When the next summary is due (only windows that suppressed something).
    pub fn deadline(&self) -> Option<u64> {
        self.wins.values().filter(|w| w.n > 0).map(|w| w.start_ms + WINDOW_MS).min()
    }
}

struct Bucket {
    tokens: f64,
    last_ms: u64,
    dropped: u64,
}

#[derive(Default)]
pub struct RateLimit {
    buckets: HashMap<String, Bucket>,
    pub dropped: u64,
}

impl RateLimit {
    /// Takes a token for `c`. `Ok(Some(n))`: allowed, and n lines of this
    /// component were dropped since its last allowed line.
    pub fn take(&mut self, c: &str, now_ms: u64) -> Result<Option<u64>, ()> {
        if !self.buckets.contains_key(c) && self.buckets.len() >= MAX_BUCKETS {
            self.buckets.retain(|_, b| b.dropped > 0);
        }
        let b = self
            .buckets
            .entry(c.to_string())
            .or_insert(Bucket { tokens: RATE_BURST, last_ms: now_ms, dropped: 0 });
        let dt = now_ms.saturating_sub(b.last_ms) as f64 / 1000.0;
        b.tokens = (b.tokens + dt * RATE_PER_SEC).min(RATE_BURST);
        b.last_ms = now_ms;
        if b.tokens < 1.0 {
            b.dropped += 1;
            self.dropped += 1;
            return Err(());
        }
        b.tokens -= 1.0;
        let d = std::mem::take(&mut b.dropped);
        Ok((d > 0).then_some(d))
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
    fn the_token_bucket_bursts_then_drops_and_reports() {
        let mut r = RateLimit::default();
        for _ in 0..200 {
            assert_eq!(r.take("sites", 0), Ok(None));
        }
        assert_eq!(r.take("sites", 0), Err(()));
        assert_eq!(r.take("sites", 10), Err(()));
        // Another component has its own bucket.
        assert_eq!(r.take("poller", 10), Ok(None));
        // 100 ms refills 2 tokens; the first allowed line reports the drops.
        assert_eq!(r.take("sites", 110), Ok(Some(2)));
        assert_eq!(r.take("sites", 110), Ok(None));
        assert_eq!(r.take("sites", 110), Err(()));
        assert_eq!(r.dropped, 3);
    }
}
