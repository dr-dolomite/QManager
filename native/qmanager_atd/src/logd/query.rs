//! Answers to the query verbs, rendered straight from the ring and the flash
//! day files.

use super::core::{Engine, Now};
use super::journal::epochday;
use crate::common::json::J;

impl Engine {
    /// `STAT`: what logd has done since it started.
    pub fn stat(&self, now: &Now) -> String {
        let mut counts = J::obj();
        counts
            .num("DEBUG", self.stats.logs[0])
            .num("INFO", self.stats.logs[1])
            .num("WARN", self.stats.logs[2])
            .num("ERROR", self.stats.logs[3])
            .num("events", self.stats.events);
        let mut ring = J::obj();
        ring.num("rows", self.ring.len()).num("bytes", self.ring.bytes()).opt_num("oldest_seq", self.ring.min_s());
        let mut drops = J::obj();
        drops
            .num("rate", self.rate.dropped)
            .num("collapse", self.collapse.suppressed)
            .num("bad_lines", self.stats.bad_lines)
            .num("level", self.stats.level_drops)
            .num("cap", self.stats.cap_drops);
        let mut clock = J::obj();
        clock.boolean("trusted", self.clock.trusted).opt_num("offset", self.clock.trusted.then_some(self.clock.off));
        let today = self.clock.trusted.then(|| epochday(now.wall));
        let bytes_today = if today == Some(self.stats.bytes_day.0) { self.stats.bytes_day.1 } else { 0 };
        let mut j = J::obj();
        j.boolean("success", true)
            .str("version", env!("CARGO_PKG_VERSION"))
            .num("proto", super::PROTO)
            .num("pid", self.pid)
            .num("boot", self.boot)
            .num("head_seq", self.head())
            .raw("counts", &counts.done())
            .raw("ring", &ring.done())
            .raw("drops", &drops.done())
            .num("flushes", self.stats.flushes)
            .num("fsyncs", self.stats.fsyncs)
            .num("flush_skips", self.stats.flush_skips)
            .num("flush_errors", self.stats.flush_errors)
            .num("rows_flushed", self.stats.rows_flushed)
            .num("bytes_written_today", bytes_today)
            .opt_str("last_flush_mono", self.stats.last_flush_ms.map(|ms| super::record::fmt_mono(ms / 10)).as_deref())
            .raw("clock", &clock.done())
            .boolean("debug_lease", self.lease_live(now))
            .opt_num("debug_lease_expiry", self.lease)
            .str("level", self.cfg.level.name())
            .str("persist_level", self.cfg.persist_level.name())
            .boolean("forward_syslog", self.cfg.forward_syslog)
            .num("syslog_forwarded", self.stats.syslog)
            .num("boots", self.index.len());
        j.done()
    }
}

impl Engine {
    /// The query verbs other than STAT; None for an unknown verb.
    pub fn query(&mut self, verb: &str, _params: &[(String, String)], _now: &Now) -> Option<super::server::Answer> {
        match verb {
            _ => None,
        }
    }
}
