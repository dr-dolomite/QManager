//! The spool: what writers append (one tab-separated record per line) and
//! how logd reads it back in bounded chunks.
//!
//! ```text
//! L<TAB><mono><TAB><LEVEL><TAB><component><TAB><pid><TAB><message>
//! E<TAB><mono><TAB><type><TAB><severity><TAB><code><TAB><fields><TAB><message>
//! ```
//! The message is always the last field, so tabs inside it are kept.

use super::record::{parse_mono, Sev};
use crate::common::log::Level;
use std::io::Read;

/// Longest spool line kept; the rest is cut and marked.
pub const LINE_CAP: usize = 4096;
pub const TRUNC_MARK: &str = "…[truncated]";

#[derive(Debug, PartialEq)]
pub enum Rec {
    Log { mono: Option<u64>, lv: Level, c: String, p: u32, msg: String },
    Ev { mono: Option<u64>, ty: String, sev: Sev, code: String, f: Vec<(String, String)>, msg: String },
}

/// Strips CR and control characters below 0x20 except tab.
fn clean(s: &str) -> String {
    s.chars().filter(|&c| c == '\t' || c as u32 >= 0x20).collect()
}

/// A field that is not the message: no tabs or controls, bounded.
fn clean_short(s: &str, max: usize) -> String {
    let mut out: String = s.chars().filter(|&c| c as u32 >= 0x20).collect();
    if out.len() > max {
        let mut cut = max;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
    }
    out
}

fn valid_type(t: &str) -> bool {
    (1..=48).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn valid_key(k: &str) -> bool {
    (1..=32).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// `k=v;k=v`; a malformed pair is skipped.
pub fn parse_fields(s: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for pair in s.split(';') {
        if let Some((k, v)) = pair.split_once('=') {
            if valid_key(k) && !v.contains(['\t', '\n']) && out.len() < 32 {
                out.push((k.to_string(), clean_short(v, 256)));
            }
        }
    }
    out
}

/// Parses one spool line (no LF). `truncated` appends the cut marker to the
/// message. None means a bad line (counted by the caller).
pub fn parse_line(raw: &[u8], truncated: bool) -> Option<Rec> {
    let text = String::from_utf8_lossy(raw);
    let line = text.strip_suffix('\r').unwrap_or(&text);
    let msg_tail = |m: &str| {
        let mut m = clean(m);
        if truncated {
            m.push_str(TRUNC_MARK);
        }
        m
    };
    match line.as_bytes().first()? {
        b'L' => {
            let mut it = line.splitn(6, '\t');
            if it.next()? != "L" {
                return None;
            }
            let mono = parse_mono(it.next()?);
            let lv = Level::parse(it.next()?);
            let c = clean_short(it.next()?, 64);
            let p = it.next()?.trim().parse::<u32>().unwrap_or(0);
            let msg = msg_tail(it.next()?);
            let c = if c.is_empty() { "unknown".to_string() } else { c };
            Some(Rec::Log { mono, lv, c, p, msg })
        }
        b'E' => {
            let mut it = line.splitn(7, '\t');
            if it.next()? != "E" {
                return None;
            }
            let mono = parse_mono(it.next()?);
            let ty = it.next()?;
            if !valid_type(ty) {
                return None;
            }
            let sev = Sev::parse(it.next()?);
            let code = clean_short(it.next()?, 64);
            let f = parse_fields(it.next()?);
            let msg = msg_tail(it.next()?);
            Some(Rec::Ev { mono, ty: ty.to_string(), sev, code, f, msg })
        }
        _ => None,
    }
}

/// Splits a stream into lines in 64 KB chunks, never holding more than one
/// chunk plus one capped line. A line longer than `LINE_CAP` is cut (the
/// rest up to its LF is skipped) and reported as truncated. A last line
/// without LF is still handed out.
pub fn for_each_line<R: Read>(mut r: R, mut f: impl FnMut(&[u8], bool)) -> std::io::Result<()> {
    let mut chunk = vec![0u8; 64 * 1024];
    let mut cur: Vec<u8> = Vec::with_capacity(512);
    let mut trunc = false;
    loop {
        let n = match r.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        let mut rest = &chunk[..n];
        while !rest.is_empty() {
            match rest.iter().position(|&b| b == b'\n') {
                Some(i) => {
                    take(&mut cur, &mut trunc, &rest[..i]);
                    f(&cut_utf8(&cur), trunc);
                    cur.clear();
                    trunc = false;
                    rest = &rest[i + 1..];
                }
                None => {
                    take(&mut cur, &mut trunc, rest);
                    rest = &[];
                }
            }
        }
    }
    if !cur.is_empty() {
        f(&cut_utf8(&cur), trunc);
    }
    Ok(())
}

fn take(cur: &mut Vec<u8>, trunc: &mut bool, part: &[u8]) {
    let room = LINE_CAP.saturating_sub(cur.len());
    if part.len() > room {
        cur.extend_from_slice(&part[..room]);
        *trunc = true;
    } else {
        cur.extend_from_slice(part);
    }
}

/// Drops a UTF-8 sequence split by the cap (so the cut never turns into U+FFFD).
fn cut_utf8(b: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if b.len() < LINE_CAP {
        return std::borrow::Cow::Borrowed(b);
    }
    let mut end = b.len();
    let mut back = 0;
    while end > 0 && back < 4 && (b[end - 1] & 0xC0) == 0x80 {
        end -= 1;
        back += 1;
    }
    if end > 0 && b[end - 1] >= 0xC0 {
        let lead = b[end - 1];
        let need = if lead >= 0xF0 { 4 } else if lead >= 0xE0 { 3 } else { 2 };
        if back + 1 < need {
            return std::borrow::Cow::Borrowed(&b[..end - 1]);
        }
    }
    std::borrow::Cow::Borrowed(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_log_line_keeps_tabs_in_its_message() {
        let r = parse_line(b"L\t12345.67\tWARN\tpoller\t7600\tPing\tdata stale\x01 (age=90s)\r", false).unwrap();
        assert_eq!(
            r,
            Rec::Log {
                mono: Some(1234567),
                lv: Level::Warn,
                c: "poller".into(),
                p: 7600,
                msg: "Ping\tdata stale (age=90s)".into()
            }
        );
        // Unknown level → INFO, bad pid → 0, unparsable mono → None.
        match parse_line(b"L\tnope\tLOUD\tx\tpid\tm", false).unwrap() {
            Rec::Log { mono, lv, p, .. } => assert_eq!((mono, lv, p), (None, Level::Info, 0)),
            _ => panic!(),
        }
    }

    #[test]
    fn an_event_line_parses_fields_and_drops_bad_types() {
        let r = parse_line(b"E\t10.5\tband_change\twarning\t\tfrom=B3;to=B7;Bad=x;nov;radio=lte\tLTE band\tB7", false).unwrap();
        assert_eq!(
            r,
            Rec::Ev {
                mono: Some(1050),
                ty: "band_change".into(),
                sev: Sev::Warning,
                code: String::new(),
                f: vec![("from".into(), "B3".into()), ("to".into(), "B7".into()), ("radio".into(), "lte".into())],
                msg: "LTE band\tB7".into()
            }
        );
        match parse_line(b"E\t1\tx\tbogus\twd_tier_start\t\tm", false).unwrap() {
            Rec::Ev { sev, code, .. } => assert_eq!((sev, code.as_str()), (Sev::Info, "wd_tier_start")),
            _ => panic!(),
        }
        for bad in [&b"E\t1\tBand\tinfo\t\t\tm"[..], b"E\t1\t\tinfo\t\t\tm", b"E\t1\tband-x\tinfo\t\t\tm", b"E\t1\tok\tinfo\t\t"] {
            assert!(parse_line(bad, false).is_none(), "{bad:?}");
        }
        let long = format!("E\t1\t{}\tinfo\t\t\tm", "a".repeat(49));
        assert!(parse_line(long.as_bytes(), false).is_none());
    }

    #[test]
    fn bad_kinds_and_short_lines_are_refused() {
        for bad in [&b""[..], b"X\t1\tINFO\tc\t1\tm", b"L\t1\tINFO\tc\t1", b"Lx\t1\tINFO\tc\t1\tm", b"L"] {
            assert!(parse_line(bad, false).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn lines_split_with_a_torn_last_line_and_a_cap() {
        let mut data = b"L\t1\tINFO\ta\t1\tone\nL\t2\tINFO\ta\t1\ttwo\n".to_vec();
        data.extend_from_slice(b"L\t3\tINFO\tab\t1\t");
        data.extend_from_slice("é".repeat(5000).as_bytes());
        data.extend_from_slice(b"\nL\t4\tINFO\ta\t1\ttorn");
        let mut got = Vec::new();
        for_each_line(&data[..], |l, t| got.push((parse_line(l, t), l.len()))).unwrap();
        assert_eq!(got.len(), 4);
        match &got[2].0 {
            Some(Rec::Log { msg, .. }) => {
                assert!(msg.ends_with(TRUNC_MARK));
                assert!(!msg.contains('\u{fffd}'), "cut on a char boundary");
            }
            other => panic!("{other:?}"),
        }
        assert!(got[2].1 <= LINE_CAP);
        assert!(matches!(&got[3].0, Some(Rec::Log { msg, .. }) if msg == "torn"));
        // Chunk boundaries do not split records.
        let many: Vec<u8> = (0..20000).flat_map(|i| format!("L\t{i}\tINFO\tc\t1\tline {i}\n").into_bytes()).collect();
        let mut n = 0;
        for_each_line(&many[..], |l, _| {
            assert!(parse_line(l, false).is_some());
            n += 1
        })
        .unwrap();
        assert_eq!(n, 20000);
    }
}
