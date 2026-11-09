//! The legacy views logd keeps while it runs: the text log (`/tmp/qmanager.log`
//! in qlog.sh's exact format and rotation) and the events NDJSON file (the
//! newest 50 events in `append_event`'s row shape).

use super::record::{Body, Row};
use crate::common::json::json_escape;
use crate::common::log::format_local;
use crate::common::safefs;
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

pub const ROTATE_BYTES: u64 = 256 * 1024;
const MAX_FILES: u32 = 2;
pub const BATCH_MS: u64 = 1000;
pub const EVENTS_KEEP: usize = 50;
pub const EVENTS_MIN_GAP_MS: u64 = 1000;

/// The text line of a row: `[ts] LEVEL [component:pid] message`. An event is
/// `EVENT [type] message` at INFO from component `events`.
pub fn text_line(row: &Row, wall_now: i64, logd_pid: u32, out: &mut String) {
    text_line_cached(row, wall_now, logd_pid, out, &mut (i64::MIN, String::new()));
}

/// `text_line` with the last formatted second cached: a storm stamps many
/// lines with the same second, and localtime_r re-reads the zone each call.
fn text_line_cached(row: &Row, wall_now: i64, logd_pid: u32, out: &mut String, cache: &mut (i64, String)) {
    let t = row.t.unwrap_or(wall_now);
    if cache.0 != t {
        *cache = (t, format_local(t));
    }
    out.push('[');
    out.push_str(&cache.1);
    out.push_str("] ");
    match &row.body {
        Body::Log { lv, c, p, msg } => {
            out.push_str(lv.padded());
            out.push_str(" [");
            out.push_str(c);
            out.push(':');
            out.push_str(&p.to_string());
            out.push_str("] ");
            out.push_str(msg);
        }
        Body::Ev { ty, msg, .. } => {
            out.push_str("INFO  [events:");
            out.push_str(&logd_pid.to_string());
            out.push_str("] EVENT [");
            out.push_str(ty);
            out.push_str("] ");
            out.push_str(msg);
        }
    }
    out.push('\n');
}

pub struct TextMirror {
    pub path: String,
    buf: String,
    pub first_ms: Option<u64>,
    pub writes: u64,
    ts: (i64, String),
}

impl TextMirror {
    pub fn new(path: String) -> TextMirror {
        TextMirror { path, buf: String::new(), first_ms: None, writes: 0, ts: (i64::MIN, String::new()) }
    }

    pub fn add(&mut self, row: &Row, wall_now: i64, pid: u32, now_ms: u64) {
        text_line_cached(row, wall_now, pid, &mut self.buf, &mut self.ts);
        self.first_ms.get_or_insert(now_ms);
        // A storm must not grow the batch without bound.
        if self.buf.len() > 64 * 1024 {
            self.flush();
        }
    }

    pub fn deadline(&self) -> Option<u64> {
        self.first_ms.map(|t| t + BATCH_MS)
    }

    fn rotate(&self) {
        let size = fs::symlink_metadata(&self.path)
            .map(|m| if m.file_type().is_file() { m.len() } else { 0 })
            .unwrap_or(0);
        if size < ROTATE_BYTES {
            return;
        }
        for i in (2..=MAX_FILES).rev() {
            let _ = fs::rename(format!("{}.{}", self.path, i - 1), format!("{}.{}", self.path, i));
        }
        let _ = fs::rename(&self.path, format!("{}.1", self.path));
    }

    /// Writes the batch (own regular file only, never through a link, never
    /// blocking on a planted FIFO), rotating first like log.rs does.
    pub fn flush(&mut self) {
        self.first_ms = None;
        if self.buf.is_empty() {
            return;
        }
        self.rotate();
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o644)
            .custom_flags(safefs::NOFOLLOW | libc::O_NONBLOCK)
            .open(&self.path)
        {
            let euid = unsafe { libc::geteuid() };
            if f.metadata().map_or(false, |m| m.file_type().is_file() && m.uid() == euid) {
                let _ = f.write_all(self.buf.as_bytes());
                self.writes += 1;
            }
        }
        self.buf.clear();
    }
}

/// One legacy events row: `{"timestamp":…,"type":…,"message":…,"severity":…[,"code":…]}`.
pub fn event_json(row: &Row, wall_now: i64, out: &mut String) {
    if let Body::Ev { ty, sev, code, msg, .. } = &row.body {
        out.push_str("{\"timestamp\":");
        out.push_str(&row.t.unwrap_or(wall_now).to_string());
        out.push_str(",\"type\":\"");
        out.push_str(&json_escape(ty));
        out.push_str("\",\"message\":\"");
        out.push_str(&json_escape(msg));
        out.push_str("\",\"severity\":\"");
        out.push_str(sev.name());
        out.push('"');
        if !code.is_empty() {
            out.push_str(",\"code\":\"");
            out.push_str(&json_escape(code));
            out.push('"');
        }
        out.push('}');
    }
}

pub struct EventsMirror {
    pub path: String,
    pub rows: VecDeque<Row>,
    pub dirty: bool,
    last_ms: Option<u64>,
}

impl EventsMirror {
    pub fn new(path: String) -> EventsMirror {
        EventsMirror { path, rows: VecDeque::new(), dirty: false, last_ms: None }
    }

    pub fn add(&mut self, row: &Row) {
        self.rows.push_back(row.clone());
        while self.rows.len() > EVENTS_KEEP {
            self.rows.pop_front();
        }
        self.dirty = true;
    }

    pub fn deadline(&self) -> Option<u64> {
        if !self.dirty {
            return None;
        }
        Some(self.last_ms.map_or(0, |t| t + EVENTS_MIN_GAP_MS))
    }

    pub fn write(&mut self, wall_now: i64, now_ms: u64) {
        let mut s = String::with_capacity(self.rows.len() * 160);
        for r in &self.rows {
            event_json(r, wall_now, &mut s);
            s.push('\n');
        }
        let _ = safefs::write_atomic(&self.path, s.as_bytes());
        self.dirty = false;
        self.last_ms = Some(now_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::log::Level;
    use crate::logd::record::Sev;

    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("qlogd-mirror-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d.join("qmanager.log").to_str().unwrap().to_string()
    }

    #[test]
    fn text_lines_are_the_legacy_format_and_rotate_at_256k() {
        crate::common::log::init_tz();
        let p = tmp("text");
        let mut m = TextMirror::new(p.clone());
        let row = Row { s: 1, b: 1, m: 0, t: Some(1_794_199_490), body: Body::Log { lv: Level::Warn, c: "poller".into(), p: 77, msg: "hi\tthere".into() } };
        m.add(&row, 0, 9, 5);
        assert_eq!(m.deadline(), Some(1005));
        m.flush();
        let s = fs::read_to_string(&p).unwrap();
        assert!(s.starts_with('[') && s.ends_with("] WARN  [poller:77] hi\tthere\n"), "{s:?}");
        assert_eq!(s.len(), "[2026-11-10 00:00:00] WARN  [poller:77] hi\tthere\n".len());
        let ev = Row { s: 2, b: 1, m: 0, t: None, body: Body::Ev { ty: "band_change".into(), sev: Sev::Info, cat: "cellular", code: String::new(), f: vec![], msg: "B3".into() } };
        let mut line = String::new();
        text_line(&ev, 1_794_199_490, 9, &mut line);
        assert!(line.ends_with("] INFO  [events:9] EVENT [band_change] B3\n"), "{line}");
        // Rotation keeps .1 and .2.
        fs::write(&p, vec![b'x'; ROTATE_BYTES as usize]).unwrap();
        m.add(&row, 0, 9, 5);
        m.flush();
        assert!(fs::metadata(format!("{p}.1")).unwrap().len() >= ROTATE_BYTES);
        assert!(fs::metadata(&p).unwrap().len() < 200);
    }

    #[test]
    fn a_planted_link_is_never_written_through() {
        let p = tmp("link");
        let victim = format!("{p}.victim");
        fs::write(&victim, b"SECRET").unwrap();
        std::os::unix::fs::symlink(&victim, &p).unwrap();
        let mut m = TextMirror::new(p.clone());
        let row = Row { s: 1, b: 1, m: 0, t: Some(1), body: Body::Log { lv: Level::Info, c: "c".into(), p: 1, msg: "x".into() } };
        m.add(&row, 0, 1, 0);
        m.flush();
        assert_eq!(fs::read(&victim).unwrap(), b"SECRET");
    }

    #[test]
    fn the_events_file_keeps_the_newest_50_in_the_legacy_shape() {
        let p = tmp("ev");
        let mut e = EventsMirror::new(p.clone());
        for i in 0..60 {
            let code = if i == 59 { "wd_tier_start".to_string() } else { String::new() };
            e.add(&Row { s: i, b: 1, m: 0, t: if i == 58 { None } else { Some(1000 + i as i64) }, body: Body::Ev { ty: "watchcat_recovery".into(), sev: Sev::Warning, cat: "connection", code, f: vec![], msg: format!("step \"{i}\"") } });
        }
        assert_eq!(e.deadline(), Some(0));
        e.write(5555, 10);
        assert_eq!(e.deadline(), None);
        let s = fs::read_to_string(&p).unwrap();
        let lines: Vec<&str> = s.lines().collect();
        assert_eq!(lines.len(), 50);
        assert_eq!(lines[0], "{\"timestamp\":1010,\"type\":\"watchcat_recovery\",\"message\":\"step \\\"10\\\"\",\"severity\":\"warning\"}");
        assert!(lines[48].starts_with("{\"timestamp\":5555,"), "untrusted uses the current wall");
        assert!(lines[49].ends_with(",\"severity\":\"warning\",\"code\":\"wd_tier_start\"}"));
        e.add(&e.rows[0].clone());
        assert_eq!(e.deadline(), Some(1010), "at most once per second");
    }
}
