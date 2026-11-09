//! Answers to the query verbs, rendered straight from the ring and the flash
//! day files.
//!
//! - `STAT`: counters.
//! - `LOGQ`: today's `system/logs.sh` JSON (entries, total, stats,
//!   available_components) plus `seq`/`t` per entry, `counts`,
//!   `latest_problem`, `boot`, `this_boot`, `head_seq`, `has_more`, `boots`.
//!   Events appear as the legacy `EVENT [type] message` INFO lines of
//!   component `events`, as qlog_info wrote them.
//! - `EVQ`: the legacy `NetworkEvent` array plus `seq`, `cat`, `f`, `boot`,
//!   `t`; or with `fmt=hist` History's `k:"e"` rows, one per line.
//!
//! Both return the newest `limit` matches, oldest first. Rows below the
//! ring's lowest `s` come from flash; the ring holds every row above it. For
//! the current boot LOGQ reads flash only when the ring cannot fill the page,
//! so its `counts` and `available_components` then cover the ring.

use super::core::{Engine, Now};
use super::journal::{epochday, Kind};
use super::record::{fac_name, fmt_mono, kern_level, quick_sbt, render_fields, Body, Names, RKind, Row, PRI_NAMES};
use super::registry;
use super::server::Answer;
use crate::common::json::{json_escape, J};
use crate::common::log::{format_local, Level};

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
        let mut kmsg = J::obj();
        kmsg.boolean("open", self.kmsg_open)
            .num("read", self.stats.kmsg_read)
            .num("kept", self.stats.kernel)
            .num("overruns", self.stats.kmsg_overruns)
            .num("seq", self.kmsg_hw)
            .num("ssr_this_boot", self.kmsg_ssr);
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
            .opt_str("last_flush_mono", self.stats.last_flush_ms.map(|ms| fmt_mono(ms / 10)).as_deref())
            .raw("clock", &clock.done())
            .boolean("debug_lease", self.lease_live(now))
            .opt_num("debug_lease_expiry", self.lease)
            .str("level", self.cfg.level.name())
            .str("persist_level", self.cfg.persist_level.name())
            .boolean("forward_syslog", self.cfg.forward_syslog)
            .num("syslog_forwarded", self.stats.syslog)
            .num("boots", self.index.len())
            .raw("kmsg", &kmsg.done());
        j.done()
    }

    /// The query verbs other than STAT; None for an unknown verb.
    pub fn query(&mut self, verb: &str, params: &[(String, String)], now: &Now) -> Option<Answer> {
        let r = match verb {
            "LOGQ" => self.logq(params, now),
            "EVQ" => self.evq(params, now),
            _ => return None,
        };
        Some(match r {
            Ok(j) => Answer::Res(true, j),
            Err(detail) => {
                let mut j = J::obj();
                j.boolean("success", false).str("error", "invalid_param").str("detail", &detail);
                Answer::Res(false, j.done())
            }
        })
    }

    /// A row's wall time for display: its own, else (this boot only) the
    /// current wall clock minus the mono distance, like the legacy writers'
    /// `date`.
    fn shown_wall(&self, r: &Row, now: &Now) -> Option<i64> {
        r.t.or_else(|| (r.b == self.boot).then(|| now.wall - (now.mono_s() - (r.m / 100) as i64)))
    }

    /// The flash rows below `below_s` of the given kind that pass `want`
    /// (checked on `s`, `b`, `t` before the full parse), over the day range.
    /// Rows are interned into a scratch table handed to `f` with them.
    fn flash_rows(
        &self,
        kind: Kind,
        days: Option<(i64, i64)>,
        below_s: u64,
        mut want: impl FnMut(u64, u32, Option<i64>) -> bool,
        mut f: impl FnMut(Row, &Names),
    ) {
        let mut names = Names::default();
        for (day, _) in self.journal.days(kind) {
            if let Some((lo, hi)) = days {
                if day < lo || day > hi {
                    continue;
                }
            }
            self.journal.for_each_line(kind, day, |l| {
                if let Some((s, b, t)) = quick_sbt(l) {
                    if s < below_s && want(s, b, t) {
                        if let Some(r) = Row::from_line(l, &mut names) {
                            f(r, &names);
                        }
                    }
                }
            });
        }
    }

    pub fn logq(&mut self, p: &[(String, String)], now: &Now) -> Result<String, String> {
        self.clock_tick(now);
        let min = match param(p, "min_level").or_else(|| param(p, "level")) {
            None | Some("") => None,
            Some(v) => Some(match v {
                "DEBUG" | "INFO" | "WARN" | "ERROR" => Level::parse(v),
                _ => return Err("min_level must be DEBUG, INFO, WARN or ERROR".into()),
            }),
        };
        // Which kinds: logs and events (the transcript) by default; `kind=K`
        // or `source=kernel` is the kept kernel history.
        let kinds: Vec<RKind> = match (param(p, "kind"), param(p, "source")) {
            (Some(k), _) if !k.is_empty() => {
                let mut v = Vec::new();
                for x in k.split(',') {
                    v.push(match x {
                        "L" => RKind::L,
                        "E" => RKind::E,
                        "K" => RKind::K,
                        _ => return Err("kind must be L, E or K".into()),
                    });
                }
                v
            }
            (_, Some("kernel")) => vec![RKind::K],
            (_, None | Some("") | Some("journal")) => vec![RKind::L, RKind::E],
            (_, Some(_)) => return Err("source must be journal or kernel".into()),
        };
        let tag = param(p, "tag").filter(|t| !t.is_empty()).map(str::to_string);
        let comp = param(p, "component").filter(|c| !c.is_empty() && *c != "all").map(str::to_string);
        let search: Vec<u8> = json_escape(param(p, "search").unwrap_or("").trim()).bytes().map(|b| b.to_ascii_lowercase()).collect();
        let boot = match param(p, "boot") {
            None | Some("") | Some("this") => self.boot,
            Some("prev") => self.index.0.iter().rev().map(|e| e.0).find(|&b| b < self.boot).unwrap_or(0),
            Some(n) => n.parse::<u32>().map_err(|_| "boot must be this, prev or a number".to_string())?,
        };
        let after = num_param(p, "after")?.unwrap_or(0);
        let before = num_param(p, "before")?.unwrap_or(u64::MAX);
        let limit = match num_param(p, "limit")?.or(num_param(p, "lines")?) {
            None => 200,
            Some(n) if (1..=500).contains(&n) => n as usize,
            Some(_) => return Err("limit must be 1..500".into()),
        };
        let mono_only = match param(p, "fmt") {
            None | Some("") | Some("json") => false,
            Some("mono") => true,
            Some(_) => return Err("fmt must be json or mono".into()),
        };

        let mut acc = LogAcc { limit, ..Default::default() };
        let base = |r: &Row, names: &Names| -> bool {
            if r.b != boot || r.s <= after || r.s >= before || !kinds.contains(&r.kind) {
                return false;
            }
            if let Some(want) = &comp {
                if names.name(r.comp) != want {
                    return false;
                }
            }
            if let Some(tg) = &tag {
                if !r.tag_is(tg) {
                    return false;
                }
            }
            search.is_empty() || contains_ci(r.msg_escaped(), &search) || (r.kind == RKind::E && contains_ci(names.name(r.ty), &search))
        };
        let in_view = |r: &Row| r.b == boot && kinds.contains(&r.kind);
        let ring_min = self.ring.min_s().unwrap_or(self.seq + 1);
        // Ring first (newest first): the newest picks are always here.
        for r in self.ring.iter().rev() {
            if in_view(r) {
                acc.component(self.names.name(r.comp));
            }
            if base(r, &self.names) {
                acc.offer(r, min, true);
            }
        }
        let flash_has_older = match self.index.get(boot) {
            Some(i) => i.flash_min_s.map_or(false, |m| m < ring_min) && i.days.is_some(),
            None => false,
        };
        // This boot: flash only when the ring could not fill the page (the
        // 30 ms budget). Counts and components then cover the ring, and
        // has_more says older rows exist. Other boots: always flash.
        let read_flash = flash_has_older && (boot != self.boot || acc.picked.len() < limit);
        if read_flash {
            let days = self.index.get(boot).and_then(|i| i.days);
            let mut older: Vec<Row> = Vec::new();
            // Kernel rows sit in the log day files.
            let fkinds: &[Kind] = if kinds.iter().all(|&k| k == RKind::E) { &[Kind::Ev] } else if kinds.contains(&RKind::E) { &[Kind::Log, Kind::Ev] } else { &[Kind::Log] };
            for &kind in fkinds {
                self.flash_rows(kind, days, ring_min, |_, b, _| b == boot, |r, names| {
                    if in_view(&r) {
                        acc.component(names.name(r.comp));
                    }
                    if base(&r, names) && acc.offer(&r, min, false) {
                        older.push(r);
                        if older.len() > 2 * limit + 64 {
                            trim_newest(&mut older, limit);
                        }
                    }
                });
            }
            trim_newest(&mut older, limit.saturating_sub(acc.picked.len()));
            acc.picked.extend(older);
        }
        acc.picked.sort_unstable_by_key(|r| r.s);

        if mono_only {
            // One line per entry: its kernel/uptime stamp in whole seconds
            // (what the History system series reads instead of `dmesg`).
            let mut out = String::new();
            for (i, r) in acc.picked.iter().enumerate() {
                if i > 0 {
                    out.push('\n');
                }
                out.push_str(&(r.m / 100).to_string());
            }
            return Ok(out);
        }

        let mut out = String::with_capacity(256 + acc.picked.len() * 160);
        out.push_str("{\"success\":true,\"entries\":[");
        for (i, r) in acc.picked.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            self.entry_json(r, now, &mut out);
        }
        out.push_str("],\"total\":");
        out.push_str(&acc.picked.len().to_string());
        out.push_str(",\"stats\":");
        out.push_str(&self.mirror_stats());
        out.push_str(",\"available_components\":[");
        acc.comps.sort_unstable();
        for (i, c) in acc.comps.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&json_escape(c));
            out.push('"');
        }
        out.push_str("],\"counts\":{\"DEBUG\":");
        for (i, k) in ["DEBUG", "INFO", "WARN", "ERROR"].iter().enumerate() {
            if i > 0 {
                out.push_str(",\"");
                out.push_str(k);
                out.push_str("\":");
            }
            out.push_str(&acc.counts[i].to_string());
        }
        out.push_str("},\"latest_problem\":");
        match &acc.problem {
            Some(r) => self.entry_json(r, now, &mut out),
            None => out.push_str("null"),
        }
        let mut tail = J::obj();
        tail.num("boot", boot)
            .num("this_boot", self.boot)
            .num("head_seq", self.seq)
            .boolean("has_more", acc.matched > acc.picked.len() as u64 || (flash_has_older && !read_flash))
            .raw("boots", &self.boots_json());
        let tail = tail.done();
        out.push(',');
        out.push_str(&tail[1..]);
        Ok(out)
    }

    fn entry_json(&self, r: &Row, now: &Now, out: &mut String) {
        out.push_str("{\"timestamp\":\"");
        if let Some(t) = self.shown_wall(r, now) {
            out.push_str(&format_local(t));
        }
        match r.decode() {
            Body::Log { lv, c, p, msg } => {
                out.push_str("\",\"level\":\"");
                out.push_str(lv.name());
                out.push_str("\",\"component\":\"");
                out.push_str(&json_escape(&c));
                out.push_str("\",\"pid\":\"");
                if p != 0 {
                    out.push_str(&p.to_string());
                }
                out.push_str("\",\"message\":\"");
                out.push_str(&json_escape(&msg));
            }
            Body::Ev { ty, msg, .. } => {
                out.push_str("\",\"level\":\"INFO\",\"component\":\"events\",\"pid\":\"\",\"message\":\"EVENT [");
                out.push_str(&json_escape(&ty));
                out.push_str("] ");
                out.push_str(&json_escape(&msg));
                out.push_str("\",\"event_type\":\"");
                out.push_str(&json_escape(&ty));
            }
            Body::Kern { pri, fac, kseq, tag, msg } => {
                out.push_str("\",\"level\":\"");
                out.push_str(kern_level(pri).name());
                out.push_str("\",\"component\":\"kernel\",\"pid\":\"\",\"message\":\"");
                out.push_str(&json_escape(&msg));
                out.push_str("\",\"facility\":\"");
                out.push_str(fac_name(fac));
                out.push_str("\",\"priority\":\"");
                out.push_str(PRI_NAMES[(pri & 7) as usize]);
                out.push_str("\",\"up\":");
                out.push_str(&fmt_mono(r.m));
                out.push_str(",\"kseq\":");
                out.push_str(&kseq.to_string());
                out.push_str(",\"tag\":\"");
                out.push_str(&json_escape(&tag));
            }
        }
        out.push_str("\",\"seq\":");
        out.push_str(&r.s.to_string());
        out.push_str(",\"t\":");
        match r.t {
            Some(t) => out.push_str(&t.to_string()),
            None => out.push_str("null"),
        }
        out.push('}');
    }

    /// `stats` as logs.sh reports it (the text file), plus the ring and flash.
    fn mirror_stats(&self) -> String {
        let path = &self.cfg.text_log;
        let (mut size, mut lines) = (0u64, 0u64);
        if let Ok(m) = std::fs::symlink_metadata(path) {
            if m.file_type().is_file() {
                size = m.len();
                if let Ok(mut f) = std::fs::File::open(path) {
                    use std::io::Read;
                    let mut buf = vec![0u8; 32 * 1024];
                    while let Ok(n) = f.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        lines += buf[..n].iter().filter(|&&b| b == b'\n').count() as u64;
                    }
                }
            }
        }
        let rotated = (1..=2).filter(|i| std::fs::symlink_metadata(format!("{path}.{i}")).is_ok()).count();
        let flash: u64 = [Kind::Log, Kind::Ev].iter().flat_map(|&k| self.journal.days(k)).map(|d| d.1).sum();
        let mut j = J::obj();
        j.num("current_size_kb", size / 1024)
            .num("current_lines", lines)
            .num("rotated_files", rotated)
            .num("ring_rows", self.ring.len())
            .num("ring_kb", self.ring.bytes() / 1024)
            .num("journal_kb", flash / 1024);
        j.done()
    }

    fn boots_json(&self) -> String {
        let mut out = String::from("[");
        for (b, info) in self.index.0.iter() {
            if info.last_s == 0 {
                continue;
            }
            if out.len() > 1 {
                out.push(',');
            }
            let mut j = J::obj();
            j.num("boot", *b)
                .num("first_seq", info.first_s)
                .num("last_seq", info.last_s)
                .opt_num("first", info.first_t)
                .opt_num("last", info.last_t);
            out.push_str(&j.done());
        }
        out.push(']');
        out
    }

    pub fn evq(&mut self, p: &[(String, String)], now: &Now) -> Result<String, String> {
        self.clock_tick(now);
        let types: Vec<&str> = match param(p, "types") {
            None | Some("") => Vec::new(),
            Some(v) => v.split(',').filter(|t| !t.is_empty()).collect(),
        };
        if types.iter().any(|t| t.len() > 48 || !t.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')) {
            return Err("types must be event types".into());
        }
        let cat = match param(p, "cat") {
            None | Some("") => None,
            Some(c) if registry::CATEGORIES.contains(&c) => Some(c),
            Some(_) => return Err("cat must be cellular, connection, system, config, security, lan, alerts or other".into()),
        };
        let after = num_param(p, "after")?.unwrap_or(0);
        let before = num_param(p, "before")?.unwrap_or(u64::MAX);
        let since = int_param(p, "since")?;
        let until = int_param(p, "until")?;
        let hist = match param(p, "fmt") {
            None | Some("") | Some("json") => false,
            Some("hist") => true,
            Some(_) => return Err("fmt must be json or hist".into()),
        };
        let limit = match num_param(p, "limit")? {
            None => 50,
            Some(n) if (1..=2000).contains(&n) => n as usize,
            Some(_) => return Err("limit must be 1..2000".into()),
        };
        let ok_sbt = |s: u64, t: Option<i64>| -> bool {
            if s <= after || s >= before {
                return false;
            }
            if (since.is_some() || until.is_some() || hist) && t.is_none() {
                return false;
            }
            since.map_or(true, |x| t.map_or(false, |t| t >= x)) && until.map_or(true, |x| t.map_or(false, |t| t <= x))
        };
        let ok = |r: &Row, names: &Names| -> bool {
            if r.kind != RKind::E || !ok_sbt(r.s, r.t) {
                return false;
            }
            let ty = names.name(r.ty);
            (types.is_empty() || types.contains(&ty)) && cat.map_or(true, |x| x == registry::category(ty))
        };
        let mut picked: Vec<Row> = Vec::new();
        for r in self.ring.iter().rev() {
            if picked.len() >= limit {
                break;
            }
            if ok(r, &self.names) {
                picked.push(r.clone());
            }
        }
        if picked.len() < limit {
            let ring_min = self.ring.min_s().unwrap_or(self.seq + 1);
            let days = match (since, until) {
                (None, None) => None,
                (s, u) => Some((s.map_or(i64::MIN, |x| epochday(x) - 1), u.map_or(i64::MAX, |x| epochday(x) + 1))),
            };
            let need = limit - picked.len();
            let mut older: Vec<Row> = Vec::new();
            self.flash_rows(Kind::Ev, days, ring_min, |s, _, t| ok_sbt(s, t), |r, names| {
                if ok(&r, names) {
                    older.push(r);
                    if older.len() > 2 * need + 64 {
                        trim_newest(&mut older, need);
                    }
                }
            });
            trim_newest(&mut older, need);
            picked.extend(older);
        }
        picked.sort_unstable_by_key(|r| r.s);
        let mut out = String::with_capacity(16 + picked.len() * 200);
        if hist {
            for (i, r) in picked.iter().enumerate() {
                if i > 0 {
                    out.push('\n');
                }
                hist_row(r, &mut out);
            }
            return Ok(out);
        }
        out.push('[');
        for (i, r) in picked.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            self.event_item(r, now, &mut out);
        }
        out.push(']');
        Ok(out)
    }

    fn event_item(&self, r: &Row, now: &Now, out: &mut String) {
        if let Body::Ev { ty, sev, cat, code, f, msg } = r.decode() {
            out.push_str("{\"timestamp\":");
            out.push_str(&self.shown_wall(r, now).unwrap_or(0).to_string());
            out.push_str(",\"type\":\"");
            out.push_str(&json_escape(&ty));
            out.push_str("\",\"message\":\"");
            out.push_str(&json_escape(&msg));
            out.push_str("\",\"severity\":\"");
            out.push_str(sev.name());
            out.push('"');
            if !code.is_empty() {
                out.push_str(",\"code\":\"");
                out.push_str(&json_escape(&code));
                out.push('"');
            }
            out.push_str(",\"seq\":");
            out.push_str(&r.s.to_string());
            out.push_str(",\"cat\":\"");
            out.push_str(cat);
            out.push_str("\",\"f\":");
            render_fields(out, &f);
            out.push_str(",\"boot\":");
            out.push_str(&r.b.to_string());
            out.push_str(",\"t\":");
            match r.t {
                Some(t) => out.push_str(&t.to_string()),
                None => out.push_str("null"),
            }
            out.push('}');
        }
    }
}

/// History's `k:"e"` row for a journal event (history.sh `hist_event`):
/// `{"k":"e","t":T,"type":…,"severity":…,"radio":…,"message":…}`. The radio
/// rule is `hist_cellular_radio` for the cellular series' types (writer field
/// `radio`, then the message prefix, then `nr_anchor`), null for the rest.
pub fn hist_row(r: &Row, out: &mut String) {
    let t = match r.t {
        Some(t) => t,
        None => return,
    };
    if let Body::Ev { ty, sev, f, msg, .. } = r.decode() {
        // The writer's `radio` field wins for any type; the cellular series'
        // types fall back to the message prefix, then `nr_anchor`.
        let radio = match f.iter().find(|(k, _)| k == "radio").map(|(_, v)| v.as_str()) {
            Some("lte") => Some("lte"),
            Some("nr") => Some("nr"),
            _ if !registry::hist_cellular(&ty) => None,
            _ if msg.starts_with("LTE") => Some("lte"),
            _ if msg.starts_with("NR") || msg.starts_with("5G") => Some("nr"),
            _ if ty == "nr_anchor" => Some("nr"),
            _ => None,
        };
        out.push_str("{\"k\":\"e\",\"t\":");
        out.push_str(&t.to_string());
        out.push_str(",\"type\":\"");
        out.push_str(&ty);
        out.push_str("\",\"severity\":\"");
        out.push_str(sev.name());
        out.push_str("\",\"radio\":");
        match radio {
            Some(x) => {
                out.push('"');
                out.push_str(x);
                out.push('"');
            }
            None => out.push_str("null"),
        }
        out.push_str(",\"message\":\"");
        out.push_str(&json_escape(&msg));
        out.push_str("\"}");
    }
}

#[derive(Default)]
struct LogAcc {
    limit: usize,
    picked: Vec<Row>,
    matched: u64,
    counts: [u64; 4],
    comps: Vec<String>,
    problem: Option<Row>,
}

impl LogAcc {
    fn component(&mut self, c: &str) {
        if !self.comps.iter().any(|x| x == c) {
            self.comps.push(c.to_string());
        }
    }

    /// Counts a row that passed every filter but the level; picks it (ring:
    /// newest first while under the limit). For flash rows returns whether
    /// the caller should keep it as a candidate.
    fn offer(&mut self, r: &Row, min: Option<Level>, ring: bool) -> bool {
        let lv = r.lv;
        self.counts[lv as usize] += 1;
        if lv >= Level::Warn && self.problem.as_ref().map_or(true, |p| r.s > p.s) {
            self.problem = Some(r.clone());
        }
        if min.map_or(false, |m| lv < m) {
            return false;
        }
        self.matched += 1;
        if ring {
            if self.picked.len() < self.limit {
                self.picked.push(r.clone());
            }
            return false;
        }
        self.picked.len() < self.limit
    }
}

/// Keeps the `n` rows with the highest `s`.
fn trim_newest(v: &mut Vec<Row>, n: usize) {
    if v.len() > n {
        v.sort_unstable_by(|a, b| b.s.cmp(&a.s));
        v.truncate(n);
    }
}

fn param<'a>(p: &'a [(String, String)], k: &str) -> Option<&'a str> {
    p.iter().rev().find(|(x, _)| x == k).map(|(_, v)| v.as_str())
}

fn num_param(p: &[(String, String)], k: &str) -> Result<Option<u64>, String> {
    match param(p, k) {
        None | Some("") => Ok(None),
        Some(v) => v.parse::<u64>().map(Some).map_err(|_| format!("{k} must be a number")),
    }
}

fn int_param(p: &[(String, String)], k: &str) -> Result<Option<i64>, String> {
    match param(p, k) {
        None | Some("") => Ok(None),
        Some(v) => v.parse::<i64>().map(Some).map_err(|_| format!("{k} must be a number")),
    }
}

/// ASCII case-insensitive substring; `needle` is already lowercase.
fn contains_ci(hay: &str, needle: &[u8]) -> bool {
    let h = hay.as_bytes();
    if needle.is_empty() {
        return true;
    }
    if needle.len() > h.len() {
        return false;
    }
    h.windows(needle.len()).any(|w| w.iter().zip(needle).all(|(a, b)| a.to_ascii_lowercase() == *b))
}

#[cfg(test)]
mod tests {
    use super::super::core::tests::{cfg, feed, W};
    use super::super::core::{Engine, Now};
    use super::*;

    fn kv(a: &[(&str, &str)]) -> Vec<(String, String)> {
        a.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn entries(j: &str) -> Vec<String> {
        let a = j.split("\"entries\":[").nth(1).unwrap().split("],\"total\"").next().unwrap();
        if a.is_empty() {
            return vec![];
        }
        a.split("},{").map(str::to_string).collect()
    }

    #[test]
    fn logq_answers_the_logs_sh_shape_with_filters() {
        let c = cfg("logq");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(
            &mut e,
            &now,
            "L\t500\tINFO\tpoller\t7600\tcycle ok\nL\t500\tWARN\tping\t12\tTarget SLOW\nL\t500\tERROR\tpoller\t7600\tparse failed\nE\t500\tband_change\tinfo\t\t\tLTE band B3\n",
        );
        let j = e.logq(&[], &now).unwrap();
        assert!(j.starts_with("{\"success\":true,\"entries\":[{\"timestamp\":\""), "{j}");
        for k in ["\"total\":4,", "\"stats\":{\"current_size_kb\":", "\"current_lines\":", "\"rotated_files\":0", "\"available_components\":[\"events\",\"ping\",\"poller\"]", "\"counts\":{\"DEBUG\":0,\"INFO\":2,\"WARN\":1,\"ERROR\":1}", "\"boot\":1,", "\"head_seq\":4", "\"has_more\":false", "\"boots\":[{\"boot\":1,\"first_seq\":1,\"last_seq\":4,"] {
            assert!(j.contains(k), "{k} in {j}");
        }
        let en = entries(&j);
        assert!(en[0].contains("\"level\":\"INFO\",\"component\":\"poller\",\"pid\":\"7600\",\"message\":\"cycle ok\",\"seq\":1,\"t\":"), "{}", en[0]);
        assert!(en[3].contains("\"component\":\"events\",\"pid\":\"\",\"message\":\"EVENT [band_change] LTE band B3\""), "{}", en[3]);
        assert!(j.contains("\"latest_problem\":{\"timestamp\":") && j.contains("parse failed\",\"seq\":3"));
        // min_level, component, search (case-insensitive), after/before, limit.
        assert_eq!(entries(&e.logq(&kv(&[("min_level", "WARN")]), &now).unwrap()).len(), 2);
        assert_eq!(entries(&e.logq(&kv(&[("component", "poller")]), &now).unwrap()).len(), 2);
        let s = e.logq(&kv(&[("search", "slow")]), &now).unwrap();
        assert!(entries(&s).len() == 1 && s.contains("Target SLOW"));
        assert_eq!(entries(&e.logq(&kv(&[("after", "2"), ("before", "4")]), &now).unwrap()).len(), 1);
        let l = e.logq(&kv(&[("limit", "2")]), &now).unwrap();
        let en = entries(&l);
        assert!(en.len() == 2 && en[1].contains("\"seq\":4") && l.contains("\"has_more\":true"));
        assert!(e.logq(&kv(&[("min_level", "LOUD")]), &now).is_err());
        assert!(e.logq(&kv(&[("limit", "501")]), &now).is_err());
        assert!(e.logq(&kv(&[("after", "x")]), &now).is_err());
        // Nothing new after the head: an empty page, same shape.
        let none = e.logq(&kv(&[("after", "4")]), &now).unwrap();
        assert!(none.contains("\"entries\":[],\"total\":0,"));
    }

    #[test]
    fn logq_reads_earlier_boots_and_evicted_rows_from_flash() {
        let c = cfg("logq-boots");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(&mut e, &now, "L\t500\tINFO\ta\t1\tboot one line\nL\t500\tWARN\ta\t1\tbefore the crash\n");
        e.shutdown(&now);
        drop(e);
        std::fs::write(&c.boot_id, "boot-B\n").unwrap();
        let now2 = Now::at(400.0, W + 1000);
        let mut e = Engine::open(c.clone(), &now2).unwrap();
        feed(&mut e, &now2, "L\t400\tINFO\tb\t2\tboot two\n");
        let this = e.logq(&[], &now2).unwrap();
        assert!(this.contains("boot two") && !this.contains("boot one line"), "{this}");
        assert!(this.contains("\"boot\":2,\"this_boot\":2"));
        let prev = e.logq(&kv(&[("boot", "prev")]), &now2).unwrap();
        assert!(prev.contains("boot one line") && prev.contains("before the crash") && !prev.contains("boot two"), "{prev}");
        assert!(prev.contains("\"available_components\":[\"a\",\"qmanager_logd\"]"), "{prev}");
        assert!(prev.contains("\"boots\":[{\"boot\":1,") && prev.contains("{\"boot\":2,"), "{prev}");
        assert_eq!(e.logq(&kv(&[("boot", "1")]), &now2).unwrap(), prev);
        // Rows of this boot that left the ring come back from flash.
        e.ring.max_rows = 5;
        for i in 0..20 {
            let w: String = format!("{i:02}").bytes().map(|b| (b - b'0' + b'a') as char).collect();
            feed(&mut e, &now2, &format!("L\t400\tINFO\tb\t2\tline {w}\n"));
        }
        e.flush(&now2, false);
        let all = e.logq(&kv(&[("limit", "500")]), &now2).unwrap();
        assert!(all.contains("boot two") && all.contains("line aa") && all.contains("line bj"), "{all}");
        assert_eq!(entries(&all).len(), 21);
        let seqs: Vec<u64> = entries(&all).iter().map(|x| x.split("\"seq\":").nth(1).unwrap().split(',').next().unwrap().parse().unwrap()).collect();
        assert!(seqs.windows(2).all(|w| w[0] < w[1]), "{seqs:?}");
    }

    #[test]
    fn evq_answers_network_events_and_history_rows() {
        let c = cfg("evq");
        let now = Now::at(500.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        feed(
            &mut e,
            &now,
            "E\t490\tband_change\tinfo\t\tfrom=B3;to=B7\tLTE band B3 -> B7\nE\t495\tinternet_lost\twarning\twd_tier_start\t\tInternet lost\nE\t499\tsignal_restored\tinfo\t\tradio=nr\tSignal back\nL\t500\tINFO\tx\t1\tnot an event\n",
        );
        let j = e.evq(&[], &now).unwrap();
        assert!(j.starts_with("[{\"timestamp\":"), "{j}");
        assert!(j.contains(&format!("{{\"timestamp\":{},\"type\":\"band_change\",\"message\":\"LTE band B3 -> B7\",\"severity\":\"info\",\"seq\":1,\"cat\":\"cellular\",\"f\":{{\"from\":\"B3\",\"to\":\"B7\"}},\"boot\":1,\"t\":{}}}", W - 10, W - 10)), "{j}");
        assert!(j.contains("\"severity\":\"warning\",\"code\":\"wd_tier_start\",\"seq\":2,\"cat\":\"connection\""));
        assert!(!j.contains("not an event"));
        assert_eq!(e.evq(&kv(&[("types", "internet_lost,signal_restored")]), &now).unwrap().matches("\"seq\"").count(), 2);
        assert_eq!(e.evq(&kv(&[("cat", "cellular")]), &now).unwrap().matches("\"seq\"").count(), 2);
        assert_eq!(e.evq(&kv(&[("since", &(W - 5).to_string())]), &now).unwrap().matches("\"seq\"").count(), 2);
        assert_eq!(e.evq(&kv(&[("until", &(W - 5).to_string())]), &now).unwrap().matches("\"seq\"").count(), 2);
        assert_eq!(e.evq(&kv(&[("after", "1"), ("before", "3")]), &now).unwrap().matches("\"seq\"").count(), 1);
        let one = e.evq(&kv(&[("limit", "1")]), &now).unwrap();
        assert!(one.contains("\"seq\":3") && !one.contains("\"seq\":2"));
        assert!(e.evq(&kv(&[("cat", "nope")]), &now).is_err());
        assert!(e.evq(&kv(&[("types", "Bad-Type")]), &now).is_err());
        assert!(e.evq(&kv(&[("limit", "2001")]), &now).is_err());
        let h = e.evq(&kv(&[("fmt", "hist")]), &now).unwrap();
        let lines: Vec<&str> = h.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], format!("{{\"k\":\"e\",\"t\":{},\"type\":\"band_change\",\"severity\":\"info\",\"radio\":\"lte\",\"message\":\"LTE band B3 -> B7\"}}", W - 10));
        assert!(lines[1].contains("\"type\":\"internet_lost\",\"severity\":\"warning\",\"radio\":null,"));
        assert!(lines[2].contains("\"radio\":\"nr\""), "writer field wins");
        // The writer's radio for any type; the prefix rule for all 14 cellular types.
        let mut e3 = Engine::open(cfg("evq-radio"), &now).unwrap();
        feed(
            &mut e3,
            &now,
            "E\t490\tinternet_lost\twarning\t\tradio=lte\tInternet lost\nE\t491\tapn_changed\tinfo\t\t\tNR APN set\nE\t492\ttower_failover\tinfo\t\t\tLTE tower back\nE\t493\tsite_down\twarning\t\t\tLTE site\nE\t494\tnr_anchor\twarning\t\t\tanchor lost\nE\t495\tsim_switched\tinfo\t\tradio=bogus\tSIM 2\n",
        );
        let h3 = e3.evq(&kv(&[("fmt", "hist")]), &now).unwrap();
        let radios: Vec<&str> = h3.lines().map(|l| l.split("\"radio\":").nth(1).unwrap().split(',').next().unwrap()).collect();
        assert_eq!(radios, ["\"lte\"", "\"nr\"", "\"lte\"", "null", "\"nr\"", "null"], "{h3}");
        // Older events come from flash once the ring no longer holds them.
        e.shutdown(&now);
        drop(e);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        let j = e.evq(&[], &now).unwrap();
        assert_eq!(j.matches("\"seq\"").count(), 3, "{j}");
        // hist skips untrusted rows.
        let mut e2 = Engine::open(cfg("evq-untrusted"), &Now::at(10.0, 10)).unwrap();
        feed(&mut e2, &Now::at(10.0, 10), "E\t9\tband_change\tinfo\t\t\tB1\n");
        assert_eq!(e2.evq(&kv(&[("fmt", "hist")]), &Now::at(10.0, 10)).unwrap(), "");
        assert!(e2.evq(&[], &Now::at(10.0, 10)).unwrap().contains("\"t\":null"));
        let _ = &mut e;
    }

    #[test]
    fn logq_over_a_full_ring_stays_cheap() {
        let c = cfg("logq-perf");
        let mut now = Now::at(500.0, W);
        let mut e = Engine::open(c, &now).unwrap();
        let mut text = String::new();
        for i in 0..9000 {
            let w: String = format!("{i:04}").bytes().map(|b| (b - b'0' + b'a') as char).collect();
            text.push_str(&format!("L\t500\t{}\tcomp{}\t{}\tmessage {w} with some ordinary length to it, like a poller line\n", ["INFO", "WARN", "DEBUG", "ERROR"][i % 4], i % 12, 1000 + i));
        }
        e.cfg.level = Level::Debug;
        // Spread over time so neither the rate limit nor the collapse bites.
        for chunk in text.lines().collect::<Vec<_>>().chunks(10) {
            now.mono_cs += 100;
            feed(&mut e, &now, &(chunk.join("\n") + "\n"));
        }
        assert_eq!(e.ring.len(), crate::logd::ring::MAX_ROWS);
        let mut worst = std::time::Duration::ZERO;
        for q in [vec![], kv(&[("search", "ordinary LENGTH")]), kv(&[("min_level", "WARN"), ("limit", "500")]), kv(&[("component", "comp3")])] {
            let t = std::time::Instant::now();
            let j = e.logq(&q, &now).unwrap();
            worst = worst.max(t.elapsed());
            assert!(j.len() > 100);
        }
        eprintln!("LOGQ over a full ring: worst {worst:?}");
        assert!(worst < std::time::Duration::from_millis(30), "{worst:?}");
    }

    #[test]
    fn kernel_records_become_k_rows_events_and_a_kernel_logq() {
        use crate::logd::kmsg::tests::FIXTURE;
        let c = cfg("kmsg");
        let now = Now::at(1000.0, W);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        for l in FIXTURE.lines() {
            e.ingest_kmsg(l.as_bytes(), &now);
        }
        let st = e.stat(&now);
        assert!(st.contains("\"kmsg\":{\"open\":false,\"read\":16,\"kept\":13,\"overruns\":0,\"seq\":1805,\"ssr_this_boot\":2}"), "{st}");
        let k = e.logq(&kv(&[("kind", "K")]), &now).unwrap();
        let en = entries(&k);
        assert_eq!(en.len(), 13, "{k}");
        assert!(en[0].contains("\"level\":\"INFO\",\"component\":\"kernel\",\"pid\":\"\",\"message\":\"remoteproc remoteproc0: powering up 4080000.remoteproc-mss\",\"facility\":\"kern\",\"priority\":\"info\",\"up\":15.23,\"kseq\":812,\"tag\":\"remoteproc\""), "{}", en[0]);
        assert!(en[1].contains("\"level\":\"ERROR\"") && en[1].contains("\"priority\":\"err\""), "{}", en[1]);
        assert!(k.contains("\"available_components\":[\"kernel\"]"));
        assert_eq!(e.logq(&kv(&[("source", "kernel"), ("tag", "eth")]), &now).unwrap().matches("\"kseq\"").count(), 3);
        // The transcript (default) has the derived events, not the K rows.
        let d = e.logq(&[], &now).unwrap();
        assert!(d.contains("EVENT [oom_kill] Out of memory: killed stress (pid 4321)") && !d.contains("powering up"), "{d}");
        // The History system series' newest fatal-error stamp, as one call.
        let ssr = e.logq(&kv(&[("kind", "K"), ("tag", "ssr"), ("search", "4080000.remoteproc-mss: fatal error received"), ("limit", "1"), ("fmt", "mono")]), &now).unwrap();
        assert_eq!(ssr, "812");
        assert_eq!(e.logq(&kv(&[("kind", "K"), ("tag", "panic"), ("search", "nothing like it"), ("fmt", "mono")]), &now).unwrap(), "");
        let ev = e.evq(&kv(&[("types", "oom_kill,eth_link_up,eth_link_down")]), &now).unwrap();
        assert_eq!(ev.matches("\"seq\"").count(), 4, "{ev}");
        assert!(ev.contains("\"type\":\"oom_kill\",\"message\":\"Out of memory: killed stress (pid 4321)\",\"severity\":\"warning\",\"seq\":"));
        assert!(ev.contains("\"cat\":\"system\",\"f\":{\"proc\":\"stress\",\"pid\":\"4321\"}"));
        assert!(ev.contains("\"cat\":\"lan\",\"f\":{\"iface\":\"eth0\",\"speed\":\"1Gbps\",\"duplex\":\"full\"}"));
        assert!(ev.contains("\"type\":\"eth_link_down\",\"message\":\"eth0 link down\",\"severity\":\"warning\""));
        assert!(e.logq(&kv(&[("kind", "X")]), &now).is_err());
        // A restart in the same boot skips what it already read.
        e.shutdown(&now);
        drop(e);
        let mut e = Engine::open(c.clone(), &now).unwrap();
        let h = e.head();
        for l in FIXTURE.lines() {
            e.ingest_kmsg(l.as_bytes(), &now);
        }
        assert_eq!(e.head(), h, "no duplicates after a restart");
        assert!(e.stat(&now).contains("\"ssr_this_boot\":2"));
        // K rows are on flash with the logs: the next boot reads them back.
        e.shutdown(&now);
        drop(e);
        std::fs::write(&c.boot_id, "boot-B\n").unwrap();
        let mut e = Engine::open(c.clone(), &Now::at(400.0, W + 2000)).unwrap();
        let prev = e.logq(&kv(&[("kind", "K"), ("boot", "prev")]), &Now::at(400.0, W + 2000)).unwrap();
        assert_eq!(entries(&prev).len(), 13, "{prev}");
        // A new boot reads the ring from the start again.
        for l in FIXTURE.lines().take(4) {
            e.ingest_kmsg(l.as_bytes(), &Now::at(1000.0, W + 2000));
        }
        assert!(e.stat(&Now::at(1000.0, W + 2000)).contains("\"ssr_this_boot\":1"));
    }

    #[test]
    fn case_insensitive_search_is_ascii_only() {
        assert!(contains_ci("Ping data STALE", b"stale"));
        assert!(contains_ci("x", b""));
        assert!(!contains_ci("ab", b"abc"));
        assert!(contains_ci("Ünïcode Ok", b"ok"));
    }
}
