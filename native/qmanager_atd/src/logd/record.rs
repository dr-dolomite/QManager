//! Journal rows: the one record shape held in the RAM ring and appended to
//! the flash day files (JSONL), plus a small parser for reading them back.
//!
//! Row (contract): `{"s":1842,"b":7,"m":12345.67,"t":1794199490,"k":"L",
//! "lv":"WARN","c":"poller","p":7600,"msg":"…"}` and for events `"k":"E",
//! "type":…,"sev":…,"cat":…[,"code":…][,"f":{…}],"msg":…`. `t` is null while
//! the clock is untrusted. Readers drop torn lines: a row must start with
//! `{"s":` and end with `}`.

use crate::common::json::json_escape;
use crate::common::log::Level;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sev {
    Info,
    Warning,
    Error,
}

impl Sev {
    pub fn parse(s: &str) -> Sev {
        match s {
            "warning" => Sev::Warning,
            "error" => Sev::Error,
            _ => Sev::Info,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Sev::Info => "info",
            Sev::Warning => "warning",
            Sev::Error => "error",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Body {
    Log { lv: Level, c: String, p: u32, msg: String },
    Ev { ty: String, sev: Sev, cat: &'static str, code: String, f: Vec<(String, String)>, msg: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// Global sequence number, monotonic across restarts and reboots.
    pub s: u64,
    /// Boot index.
    pub b: u32,
    /// Monotonic time in centiseconds (`/proc/uptime` × 100).
    pub m: u64,
    /// Wall epoch seconds, None while the clock is untrusted.
    pub t: Option<i64>,
    pub body: Body,
}

impl Row {
    pub fn is_event(&self) -> bool {
        matches!(self.body, Body::Ev { .. })
    }

    pub fn level(&self) -> Option<Level> {
        match &self.body {
            Body::Log { lv, .. } => Some(*lv),
            Body::Ev { .. } => None,
        }
    }

    pub fn msg(&self) -> &str {
        match &self.body {
            Body::Log { msg, .. } | Body::Ev { msg, .. } => msg,
        }
    }

    /// What the ring charges for this row (heap strings plus a fixed overhead).
    pub fn cost(&self) -> usize {
        96 + match &self.body {
            Body::Log { c, msg, .. } => c.len() + msg.len(),
            Body::Ev { ty, code, f, msg, .. } => {
                ty.len() + code.len() + msg.len() + f.iter().map(|(k, v)| k.len() + v.len() + 48).sum::<usize>()
            }
        }
    }

    /// One JSONL line, without the trailing LF.
    pub fn render(&self, out: &mut String) {
        out.push_str("{\"s\":");
        push_num(out, self.s);
        out.push_str(",\"b\":");
        push_num(out, self.b);
        out.push_str(",\"m\":");
        out.push_str(&fmt_mono(self.m));
        out.push_str(",\"t\":");
        match self.t {
            Some(t) => push_num(out, t),
            None => out.push_str("null"),
        }
        match &self.body {
            Body::Log { lv, c, p, msg } => {
                out.push_str(",\"k\":\"L\",\"lv\":\"");
                out.push_str(lv.name());
                out.push_str("\",\"c\":\"");
                out.push_str(&json_escape(c));
                out.push_str("\",\"p\":");
                push_num(out, *p);
                out.push_str(",\"msg\":\"");
                out.push_str(&json_escape(msg));
                out.push_str("\"}");
            }
            Body::Ev { ty, sev, cat, code, f, msg } => {
                out.push_str(",\"k\":\"E\",\"type\":\"");
                out.push_str(&json_escape(ty));
                out.push_str("\",\"sev\":\"");
                out.push_str(sev.name());
                out.push_str("\",\"cat\":\"");
                out.push_str(cat);
                out.push('"');
                if !code.is_empty() {
                    out.push_str(",\"code\":\"");
                    out.push_str(&json_escape(code));
                    out.push('"');
                }
                if !f.is_empty() {
                    out.push_str(",\"f\":");
                    render_fields(out, f);
                }
                out.push_str(",\"msg\":\"");
                out.push_str(&json_escape(msg));
                out.push_str("\"}");
            }
        }
    }

    pub fn to_line(&self) -> String {
        let mut s = String::with_capacity(128 + self.msg().len());
        self.render(&mut s);
        s
    }
}

pub fn render_fields(out: &mut String, f: &[(String, String)]) {
    out.push('{');
    for (i, (k, v)) in f.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        out.push_str(&json_escape(k));
        out.push_str("\":\"");
        out.push_str(&json_escape(v));
        out.push('"');
    }
    out.push('}');
}

pub fn push_num<T: std::fmt::Display>(out: &mut String, v: T) {
    use std::fmt::Write;
    let _ = write!(out, "{v}");
}

/// Centiseconds as `12345.67`.
pub fn fmt_mono(cs: u64) -> String {
    format!("{}.{:02}", cs / 100, cs % 100)
}

/// `/proc/uptime`'s first field (`12345.67`, `12345`, `12345.6`) as
/// centiseconds; None when it is not a plain non-negative decimal.
pub fn parse_mono(s: &str) -> Option<u64> {
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    if int.is_empty() || int.len() > 12 || !int.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut cs: u64 = int.parse::<u64>().ok()? * 100;
    let fb = frac.as_bytes();
    if !fb.is_empty() {
        cs += (fb[0] - b'0') as u64 * 10;
    }
    if fb.len() > 1 {
        cs += (fb[1] - b'0') as u64;
    }
    Some(cs)
}

// --- Reading rows back --------------------------------------------------------

#[derive(Debug, PartialEq)]
enum Val {
    Num(String),
    Str(String),
    Null,
    Bool,
    Obj(Vec<(String, String)>),
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t') {
            self.i += 1;
        }
    }
    fn eat(&mut self, c: u8) -> Option<()> {
        self.ws();
        (self.b.get(self.i) == Some(&c)).then(|| self.i += 1)
    }
    fn string(&mut self) -> Option<String> {
        self.eat(b'"')?;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = *self.b.get(self.i)?;
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = *self.b.get(self.i)?;
                    self.i += 1;
                    match e {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xD800..0xDC00).contains(&cp)
                                && self.b.get(self.i) == Some(&b'\\')
                                && self.b.get(self.i + 1) == Some(&b'u')
                            {
                                self.i += 2;
                                let lo = self.hex4()?;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            let ch = char::from_u32(cp).unwrap_or('\u{fffd}');
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => return None,
                    }
                }
                c => out.push(c),
            }
        }
        Some(String::from_utf8_lossy(&out).into_owned())
    }
    fn hex4(&mut self) -> Option<u32> {
        let h = self.b.get(self.i..self.i + 4)?;
        self.i += 4;
        u32::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok()
    }
    fn value(&mut self) -> Option<Val> {
        self.ws();
        match *self.b.get(self.i)? {
            b'"' => Some(Val::Str(self.string()?)),
            b'n' => self.word(b"null").map(|_| Val::Null),
            b't' => self.word(b"true").map(|_| Val::Bool),
            b'f' => self.word(b"false").map(|_| Val::Bool),
            b'{' => {
                self.i += 1;
                let mut kv = Vec::new();
                if self.eat(b'}').is_some() {
                    return Some(Val::Obj(kv));
                }
                loop {
                    let k = self.string()?;
                    self.eat(b':')?;
                    let v = match self.value()? {
                        Val::Str(s) | Val::Num(s) => s,
                        _ => String::new(),
                    };
                    kv.push((k, v));
                    if self.eat(b',').is_some() {
                        continue;
                    }
                    self.eat(b'}')?;
                    return Some(Val::Obj(kv));
                }
            }
            _ => {
                let st = self.i;
                while self.i < self.b.len() && matches!(self.b[self.i], b'0'..=b'9' | b'-' | b'.' | b'e' | b'E' | b'+') {
                    self.i += 1;
                }
                (self.i > st).then(|| Val::Num(String::from_utf8_lossy(&self.b[st..self.i]).into_owned()))
            }
        }
    }
    fn word(&mut self, w: &[u8]) -> Option<()> {
        (self.b.get(self.i..self.i + w.len()) == Some(w)).then(|| self.i += w.len())
    }
}

/// True for a line that looks like a whole row (torn lines are skipped).
pub fn looks_whole(line: &str) -> bool {
    let l = line.trim_end_matches(['\r', '\n']);
    l.starts_with("{\"s\":") && l.ends_with('}')
}

/// Parses one journal line. None for torn, foreign or malformed lines.
pub fn parse_row(line: &str) -> Option<Row> {
    let line = line.trim_end_matches(['\r', '\n']);
    if !looks_whole(line) {
        return None;
    }
    let mut p = P { b: line.as_bytes(), i: 0 };
    p.eat(b'{')?;
    let (mut s, mut b, mut m, mut t) = (None, None, None, None);
    let (mut k, mut lv, mut c, mut pid, mut msg) = (None, None, None, 0u32, None);
    let (mut ty, mut sev, mut code, mut f) = (None, None, String::new(), Vec::new());
    loop {
        let key = p.string()?;
        p.eat(b':')?;
        let v = p.value()?;
        match (key.as_str(), v) {
            ("s", Val::Num(n)) => s = n.parse::<u64>().ok(),
            ("b", Val::Num(n)) => b = n.parse::<u32>().ok(),
            ("m", Val::Num(n)) => m = parse_mono(&n),
            ("t", Val::Num(n)) => t = n.parse::<i64>().ok(),
            ("t", Val::Null) => {}
            ("k", Val::Str(x)) => k = Some(x),
            ("lv", Val::Str(x)) => lv = Some(Level::parse(&x)),
            ("c", Val::Str(x)) => c = Some(x),
            ("p", Val::Num(n)) => pid = n.parse().unwrap_or(0),
            ("msg", Val::Str(x)) => msg = Some(x),
            ("type", Val::Str(x)) => ty = Some(x),
            ("sev", Val::Str(x)) => sev = Some(Sev::parse(&x)),
            ("code", Val::Str(x)) => code = x,
            ("f", Val::Obj(kv)) => f = kv,
            _ => {}
        }
        if p.eat(b',').is_some() {
            continue;
        }
        p.eat(b'}')?;
        break;
    }
    let body = match k.as_deref()? {
        "L" => Body::Log { lv: lv.unwrap_or(Level::Info), c: c.unwrap_or_default(), p: pid, msg: msg? },
        "E" => {
            let ty = ty?;
            Body::Ev { cat: super::registry::category(&ty), ty, sev: sev.unwrap_or(Sev::Info), code, f, msg: msg? }
        }
        _ => return None,
    };
    Some(Row { s: s?, b: b?, m: m.unwrap_or(0), t, body })
}

/// The leading `s`, `b`, `t` of a row, without parsing the rest (the boot
/// index scan at start reads every day file this way).
pub fn quick_sbt(line: &str) -> Option<(u64, u32, Option<i64>)> {
    let rest = line.strip_prefix("{\"s\":")?;
    let (s, rest) = rest.split_once(",\"b\":")?;
    let (b, rest) = rest.split_once(",\"m\":")?;
    let (_, rest) = rest.split_once(",\"t\":")?;
    let tv = &rest[..rest.find(',')?];
    let t = if tv == "null" { None } else { Some(tv.parse::<i64>().ok()?) };
    Some((s.parse().ok()?, b.parse().ok()?, t))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev() -> Row {
        Row {
            s: 1843,
            b: 7,
            m: 1235002,
            t: Some(1794199494),
            body: Body::Ev {
                ty: "band_change".into(),
                sev: Sev::Info,
                cat: "cellular",
                code: String::new(),
                f: vec![("from".into(), "B3".into()), ("to".into(), "B7".into())],
                msg: "LTE band changed: B3 → B7 \"q\"\t".into(),
            },
        }
    }

    #[test]
    fn rows_render_in_the_contract_shape_and_parse_back() {
        let l = Row {
            s: 1842,
            b: 7,
            m: 1234567,
            t: Some(1794199490),
            body: Body::Log { lv: Level::Warn, c: "poller".into(), p: 7600, msg: "x".into() },
        };
        assert_eq!(
            l.to_line(),
            "{\"s\":1842,\"b\":7,\"m\":12345.67,\"t\":1794199490,\"k\":\"L\",\"lv\":\"WARN\",\"c\":\"poller\",\"p\":7600,\"msg\":\"x\"}"
        );
        assert_eq!(parse_row(&l.to_line()).unwrap(), l);
        let e = ev();
        assert_eq!(
            e.to_line(),
            "{\"s\":1843,\"b\":7,\"m\":12350.02,\"t\":1794199494,\"k\":\"E\",\"type\":\"band_change\",\"sev\":\"info\",\"cat\":\"cellular\",\"f\":{\"from\":\"B3\",\"to\":\"B7\"},\"msg\":\"LTE band changed: B3 → B7 \\\"q\\\"\\t\"}"
        );
        assert_eq!(parse_row(&e.to_line()).unwrap(), e);
        let mut n = e.clone();
        n.t = None;
        assert!(n.to_line().contains("\"t\":null,"));
        assert_eq!(parse_row(&n.to_line()).unwrap(), n);
        assert_eq!(quick_sbt(&n.to_line()), Some((1843, 7, None)));
        assert_eq!(quick_sbt(&l.to_line()), Some((1842, 7, Some(1794199490))));
    }

    #[test]
    fn torn_and_foreign_lines_are_refused() {
        let line = ev().to_line();
        assert!(parse_row(&line[..line.len() - 1]).is_none());
        assert!(parse_row(&line[10..]).is_none());
        assert!(parse_row("{\"k\":\"e\",\"t\":1}").is_none());
        assert!(parse_row("").is_none());
        assert!(parse_row("{\"s\":1,\"b\":1,\"m\":1,\"t\":null,\"k\":\"X\",\"msg\":\"a\"}").is_none());
        assert!(parse_row("{\"s\":1,\"b\":1,\"m\":1,\"t\":null,\"k\":\"L\",\"msg\":\"\\ud83d\\ude00 \\u00e9\"}").unwrap().msg() == "😀 é");
    }

    #[test]
    fn mono_parses_like_proc_uptime() {
        assert_eq!(parse_mono("12345.67"), Some(1234567));
        assert_eq!(parse_mono("12345"), Some(1234500));
        assert_eq!(parse_mono("12345.6"), Some(1234560));
        assert_eq!(parse_mono("12345.678"), Some(1234567));
        for bad in ["", ".5", "-1", "1e3", "12a", "1.2.3", "x"] {
            assert_eq!(parse_mono(bad), None, "{bad}");
        }
        assert_eq!(fmt_mono(1234507), "12345.07");
    }
}
