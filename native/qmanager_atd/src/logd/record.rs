//! Journal rows. A row is stored compactly: the few fields queries index on
//! (seq, boot, mono, wall, kind, level, interned component / type) plus the
//! rendered JSON tail of the row, which is what flash gets. `Body` is the
//! decoded form, used to build a row and to render answers from it.
//!
//! Row (contract): `{"s":1842,"b":7,"m":12345.67,"t":1794199490,"k":"L",
//! "lv":"WARN","c":"poller","p":7600,"msg":"…"}`; events `"k":"E","type":…,
//! "sev":…,"cat":…[,"code":…][,"f":{…}],"msg":…`; kernel `"k":"K","pri":3,
//! "fac":0,"kseq":…,"tag":…,"msg":…`. `t` is null while the clock is
//! untrusted. The message is always the last key, so the tail's escaped
//! message is a slice. Readers drop torn lines: a row must start with
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RKind {
    L,
    E,
    K,
}

/// The decoded fields of a row.
#[derive(Clone, Debug, PartialEq)]
pub enum Body {
    Log { lv: Level, c: String, p: u32, msg: String },
    Ev { ty: String, sev: Sev, cat: &'static str, code: String, f: Vec<(String, String)>, msg: String },
    /// A kept `/dev/kmsg` record: priority level, facility, kernel seq, filter tag.
    Kern { pri: u8, fac: u8, kseq: u64, tag: String, msg: String },
}

impl Body {
    pub fn msg(&self) -> &str {
        match self {
            Body::Log { msg, .. } | Body::Ev { msg, .. } | Body::Kern { msg, .. } => msg,
        }
    }
}

/// syslog level of a kmsg priority → the journal's level (0-3 ERROR, 4 WARN,
/// 5-6 INFO, 7 DEBUG).
pub fn kern_level(pri: u8) -> Level {
    match pri {
        0..=3 => Level::Error,
        4 => Level::Warn,
        5 | 6 => Level::Info,
        _ => Level::Debug,
    }
}

pub const PRI_NAMES: [&str; 8] = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"];

pub fn fac_name(fac: u8) -> &'static str {
    const F: [&str; 12] = ["kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron", "authpriv", "ftp"];
    const L: [&str; 8] = ["local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7"];
    match fac {
        0..=11 => F[fac as usize],
        16..=23 => L[(fac - 16) as usize],
        _ => "kern",
    }
}

/// Interned component and event-type names (a few dozen in practice).
#[derive(Default, Debug)]
pub struct Names {
    v: Vec<Box<str>>,
}

pub const NO_NAME: u16 = u16::MAX;
const MAX_NAMES: usize = 4096;

impl Names {
    pub fn id(&mut self, s: &str) -> u16 {
        if let Some(i) = self.find(s) {
            return i;
        }
        if self.v.len() >= MAX_NAMES {
            return NO_NAME;
        }
        self.v.push(s.into());
        (self.v.len() - 1) as u16
    }
    pub fn find(&self, s: &str) -> Option<u16> {
        self.v.iter().position(|x| &**x == s).map(|i| i as u16)
    }
    pub fn name(&self, id: u16) -> &str {
        self.v.get(id as usize).map_or("", |b| &**b)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    /// Global sequence number, monotonic across restarts and reboots.
    pub s: u64,
    /// Monotonic time in centiseconds (`/proc/uptime` × 100).
    pub m: u64,
    /// Wall epoch seconds, None while the clock is untrusted.
    pub t: Option<i64>,
    /// Boot index.
    pub b: u32,
    /// Where the escaped message starts in `tail`.
    msg_at: u32,
    /// L: component, E: `events`, K: `kernel` (interned).
    pub comp: u16,
    /// E: event type (interned), else NO_NAME.
    pub ty: u16,
    pub kind: RKind,
    /// L: its level, E: INFO, K: from the kmsg priority.
    pub lv: Level,
    /// E: severity (Info elsewhere).
    pub sev: Sev,
    /// The JSON after `"t":…,`, ending in `}`.
    tail: Box<str>,
}

impl Row {
    pub fn build(s: u64, b: u32, m: u64, t: Option<i64>, body: &Body, names: &mut Names) -> Row {
        let mut tail = String::with_capacity(64 + body.msg().len());
        let (kind, lv, sev, comp, ty);
        match body {
            Body::Log { lv: l, c, p, .. } => {
                tail.push_str("\"k\":\"L\",\"lv\":\"");
                tail.push_str(l.name());
                tail.push_str("\",\"c\":\"");
                tail.push_str(&json_escape(c));
                tail.push_str("\",\"p\":");
                push_num(&mut tail, *p);
                tail.push(',');
                kind = RKind::L;
                lv = *l;
                sev = Sev::Info;
                comp = names.id(c);
                ty = NO_NAME;
            }
            Body::Ev { ty: t_, sev: sv, cat, code, f, .. } => {
                tail.push_str("\"k\":\"E\",\"type\":\"");
                tail.push_str(&json_escape(t_));
                tail.push_str("\",\"sev\":\"");
                tail.push_str(sv.name());
                tail.push_str("\",\"cat\":\"");
                tail.push_str(cat);
                tail.push('"');
                if !code.is_empty() {
                    tail.push_str(",\"code\":\"");
                    tail.push_str(&json_escape(code));
                    tail.push('"');
                }
                if !f.is_empty() {
                    tail.push_str(",\"f\":");
                    render_fields(&mut tail, f);
                }
                tail.push(',');
                kind = RKind::E;
                lv = Level::Info;
                sev = *sv;
                comp = names.id("events");
                ty = names.id(t_);
            }
            Body::Kern { pri, fac, kseq, tag, .. } => {
                tail.push_str("\"k\":\"K\",\"pri\":");
                push_num(&mut tail, *pri);
                tail.push_str(",\"fac\":");
                push_num(&mut tail, *fac);
                tail.push_str(",\"kseq\":");
                push_num(&mut tail, *kseq);
                tail.push_str(",\"tag\":\"");
                tail.push_str(&json_escape(tag));
                tail.push_str("\",");
                kind = RKind::K;
                lv = kern_level(*pri);
                sev = Sev::Info;
                comp = names.id("kernel");
                ty = NO_NAME;
            }
        }
        tail.push_str("\"msg\":\"");
        let msg_at = tail.len() as u32;
        tail.push_str(&json_escape(body.msg()));
        tail.push_str("\"}");
        Row { s, m, t, b, msg_at, comp, ty, kind, lv, sev, tail: tail.into_boxed_str() }
    }

    /// The decoded message.
    pub fn msg(&self) -> String {
        self.decode().msg().to_string()
    }

    /// True for a kernel row with this filter tag.
    pub fn tag_is(&self, tag: &str) -> bool {
        self.kind == RKind::K && self.tail.contains(&format!("\"tag\":\"{tag}\""))
    }

    pub fn is_event(&self) -> bool {
        self.kind == RKind::E
    }

    /// The level of a log line (None for events and kernel rows, which are
    /// always persisted).
    pub fn log_level(&self) -> Option<Level> {
        (self.kind == RKind::L).then_some(self.lv)
    }

    /// The message as it sits in the JSON (escaped).
    pub fn msg_escaped(&self) -> &str {
        &self.tail[self.msg_at as usize..self.tail.len() - 2]
    }

    /// What the ring charges for this row: its rendered length.
    pub fn cost(&self) -> usize {
        self.tail.len() + 48
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
        out.push(',');
        out.push_str(&self.tail);
    }

    pub fn to_line(&self) -> String {
        let mut s = String::with_capacity(48 + self.tail.len());
        self.render(&mut s);
        s
    }

    /// The decoded fields (parses the tail).
    pub fn decode(&self) -> Body {
        let mut line = String::with_capacity(self.tail.len() + 1);
        line.push('{');
        line.push_str(&self.tail);
        decode_obj(&line).map(|d| d.4).unwrap_or(Body::Log { lv: self.lv, c: String::new(), p: 0, msg: String::new() })
    }

    /// Parses one journal line. None for torn, foreign or malformed lines.
    pub fn from_line(line: &str, names: &mut Names) -> Option<Row> {
        let line = line.trim_end_matches(['\r', '\n']);
        if !looks_whole(line) {
            return None;
        }
        let (s, b, m, t, body) = decode_obj(line)?;
        Some(Row::build(s?, b?, m.unwrap_or(0), t, &body, names))
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

type Decoded = (Option<u64>, Option<u32>, Option<u64>, Option<i64>, Body);

/// Parses a row object (or a `{` + tail) into its header fields and body.
fn decode_obj(line: &str) -> Option<Decoded> {
    let mut p = P { b: line.as_bytes(), i: 0 };
    p.eat(b'{')?;
    let (mut s, mut b, mut m, mut t) = (None, None, None, None);
    let (mut k, mut lv, mut c, mut pid, mut msg) = (None, None, None, 0u32, None);
    let (mut ty, mut sev, mut code, mut f) = (None, None, String::new(), Vec::new());
    let (mut pri, mut fac, mut kseq, mut tag) = (6u8, 0u8, 0u64, String::new());
    loop {
        let key = p.string()?;
        p.eat(b':')?;
        let v = p.value()?;
        match (key.as_str(), v) {
            ("s", Val::Num(n)) => s = n.parse::<u64>().ok(),
            ("b", Val::Num(n)) => b = n.parse::<u32>().ok(),
            ("m", Val::Num(n)) => m = parse_mono(&n),
            ("t", Val::Num(n)) => t = n.parse::<i64>().ok(),
            ("k", Val::Str(x)) => k = Some(x),
            ("lv", Val::Str(x)) => lv = Some(Level::parse(&x)),
            ("c", Val::Str(x)) => c = Some(x),
            ("p", Val::Num(n)) => pid = n.parse().unwrap_or(0),
            ("msg", Val::Str(x)) => msg = Some(x),
            ("type", Val::Str(x)) => ty = Some(x),
            ("sev", Val::Str(x)) => sev = Some(Sev::parse(&x)),
            ("code", Val::Str(x)) => code = x,
            ("f", Val::Obj(kv)) => f = kv,
            ("pri", Val::Num(n)) => pri = n.parse::<u8>().unwrap_or(6).min(7),
            ("fac", Val::Num(n)) => fac = n.parse().unwrap_or(0),
            ("kseq", Val::Num(n)) => kseq = n.parse().unwrap_or(0),
            ("tag", Val::Str(x)) => tag = x,
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
        "K" => Body::Kern { pri, fac, kseq, tag, msg: msg? },
        _ => return None,
    };
    Some((s, b, m, t, body))
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

    fn ev_body() -> Body {
        Body::Ev {
            ty: "band_change".into(),
            sev: Sev::Info,
            cat: "cellular",
            code: String::new(),
            f: vec![("from".into(), "B3".into()), ("to".into(), "B7".into())],
            msg: "LTE band changed: B3 → B7 \"q\"\t".into(),
        }
    }

    #[test]
    fn rows_render_in_the_contract_shape_and_parse_back() {
        let mut n = Names::default();
        let lb = Body::Log { lv: Level::Warn, c: "poller".into(), p: 7600, msg: "x".into() };
        let l = Row::build(1842, 7, 1234567, Some(1794199490), &lb, &mut n);
        assert_eq!(
            l.to_line(),
            "{\"s\":1842,\"b\":7,\"m\":12345.67,\"t\":1794199490,\"k\":\"L\",\"lv\":\"WARN\",\"c\":\"poller\",\"p\":7600,\"msg\":\"x\"}"
        );
        assert_eq!(Row::from_line(&l.to_line(), &mut n).unwrap(), l);
        assert_eq!(l.decode(), lb);
        assert_eq!((l.kind, l.lv, n.name(l.comp)), (RKind::L, Level::Warn, "poller"));
        let e = Row::build(1843, 7, 1235002, Some(1794199494), &ev_body(), &mut n);
        assert_eq!(
            e.to_line(),
            "{\"s\":1843,\"b\":7,\"m\":12350.02,\"t\":1794199494,\"k\":\"E\",\"type\":\"band_change\",\"sev\":\"info\",\"cat\":\"cellular\",\"f\":{\"from\":\"B3\",\"to\":\"B7\"},\"msg\":\"LTE band changed: B3 → B7 \\\"q\\\"\\t\"}"
        );
        assert_eq!(e.msg_escaped(), "LTE band changed: B3 → B7 \\\"q\\\"\\t");
        assert_eq!(Row::from_line(&e.to_line(), &mut n).unwrap(), e);
        assert_eq!(e.decode(), ev_body());
        assert_eq!((n.name(e.ty), n.name(e.comp)), ("band_change", "events"));
        let mut u = e.clone();
        u.t = None;
        assert!(u.to_line().contains("\"t\":null,"));
        assert_eq!(Row::from_line(&u.to_line(), &mut n).unwrap(), u);
        assert_eq!(quick_sbt(&u.to_line()), Some((1843, 7, None)));
        assert_eq!(quick_sbt(&l.to_line()), Some((1842, 7, Some(1794199490))));
        let kb = Body::Kern { pri: 3, fac: 0, kseq: 991, tag: "ssr".into(), msg: "remoteproc-mss: fatal error".into() };
        let k = Row::build(1844, 7, 1235110, None, &kb, &mut n);
        assert_eq!(
            k.to_line(),
            "{\"s\":1844,\"b\":7,\"m\":12351.10,\"t\":null,\"k\":\"K\",\"pri\":3,\"fac\":0,\"kseq\":991,\"tag\":\"ssr\",\"msg\":\"remoteproc-mss: fatal error\"}"
        );
        assert_eq!((k.lv, k.log_level()), (Level::Error, None));
        assert_eq!(Row::from_line(&k.to_line(), &mut n).unwrap(), k);
        assert_eq!(k.decode(), kb);
    }

    #[test]
    fn torn_and_foreign_lines_are_refused() {
        let mut n = Names::default();
        let line = Row::build(1, 1, 0, None, &ev_body(), &mut n).to_line();
        assert!(Row::from_line(&line[..line.len() - 1], &mut n).is_none());
        assert!(Row::from_line(&line[10..], &mut n).is_none());
        assert!(Row::from_line("{\"k\":\"e\",\"t\":1}", &mut n).is_none());
        assert!(Row::from_line("", &mut n).is_none());
        assert!(Row::from_line("{\"s\":1,\"b\":1,\"m\":1,\"t\":null,\"k\":\"X\",\"msg\":\"a\"}", &mut n).is_none());
        let r = Row::from_line("{\"s\":1,\"b\":1,\"m\":1,\"t\":null,\"k\":\"L\",\"msg\":\"\\ud83d\\ude00 \\u00e9\"}", &mut n).unwrap();
        assert_eq!(r.decode().msg(), "😀 é");
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

    #[test]
    fn a_row_is_small() {
        assert!(std::mem::size_of::<Row>() <= 64, "{}", std::mem::size_of::<Row>());
    }
}
