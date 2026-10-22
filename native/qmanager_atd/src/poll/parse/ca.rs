//! `parse_ca_info` (AT+QCAINFO): the BusyBox awk pass plus its shell tail,
//! and the number helpers that reproduce BusyBox awk on musl and jq.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

use super::{contains, del_all, State, Var};

const DMAXS: &str = "1.7976931348623157e+308";

/// jq-style JSON string escaping (\" \\ \b \f \n \r \t, other controls and DEL
/// as \u00XX, UTF-8 verbatim, invalid UTF-8 as U+FFFD), quotes included.
pub fn jq_string(s: &[u8]) -> String {
    let t = String::from_utf8_lossy(s);
    let mut o = String::with_capacity(t.len() + 2);
    o.push('"');
    for c in t.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            '\u{08}' => o.push_str("\\b"),
            '\u{0c}' => o.push_str("\\f"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                o.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// The awk `js()`: byte-wise, controls 1..31 and 127 as \u00xx, \\ and \".
fn awk_js(s: &[u8]) -> Vec<u8> {
    let mut o = vec![b'"'];
    for &c in s {
        match c {
            b'\\' => o.extend_from_slice(b"\\\\"),
            b'"' => o.extend_from_slice(b"\\\""),
            1..=31 | 127 => o.extend_from_slice(format!("\\u{:04x}", c).as_bytes()),
            _ => o.push(c),
        }
    }
    o.push(b'"');
    o
}

/// Shortest round-trip decimal digits and exponent of a finite, non-zero |v|
/// (== the awk loop over sprintf("%.pe") until it parses back to v).
fn shortest(v: f64) -> (Vec<u8>, i64) {
    let s = format!("{:e}", v.abs());
    let (m, e) = s.split_once('e').unwrap_or((s.as_str(), "0"));
    let e: i64 = e.parse().unwrap_or(0);
    let mut d: Vec<u8> = m.bytes().filter(|c| c.is_ascii_digit()).collect();
    while d.len() > 1 && d.last() == Some(&b'0') {
        d.pop();
    }
    (d, e)
}

/// jq's dtoa layout of a finite non-zero number (the awk `num()` tail).
fn jq_layout(v: f64) -> String {
    let (d, e) = shortest(v);
    let nd = d.len() as i64;
    let dp = e + 1;
    let ds = String::from_utf8_lossy(&d).into_owned();
    let mut out = String::new();
    if dp <= -4 || dp > nd + 15 {
        out.push_str(ds.get(..1).unwrap_or("0"));
        if nd > 1 {
            out.push('.');
            out.push_str(ds.get(1..).unwrap_or(""));
        }
        let ae = e.abs();
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        if ae < 10 {
            out.push('0');
        }
        out.push_str(&ae.to_string());
    } else if dp <= 0 {
        out.push_str("0.");
        for _ in 0..(-dp) {
            out.push('0');
        }
        out.push_str(&ds);
    } else if dp >= nd {
        out.push_str(&ds);
        for _ in nd..dp {
            out.push('0');
        }
    } else {
        let k = usize::try_from(dp).unwrap_or(0);
        out.push_str(ds.get(..k).unwrap_or(""));
        out.push('.');
        out.push_str(ds.get(k..).unwrap_or(""));
    }
    if v < 0.0 {
        format!("-{out}")
    } else {
        out
    }
}

/// Decimal text (already validated: digits [. digits] [e[+-]digits]) to f64.
fn dec_to_f64(sg_neg: bool, int: &[u8], frac: &[u8], exp_neg: bool, exp: &[u8]) -> f64 {
    let mut s = String::new();
    if sg_neg {
        s.push('-');
    }
    s.push_str(if int.is_empty() { "0" } else { std::str::from_utf8(int).unwrap_or("0") });
    s.push('.');
    s.push_str(if frac.is_empty() { "0" } else { std::str::from_utf8(frac).unwrap_or("0") });
    // Clamp the exponent text: past +-99999 the result is 0 or inf anyway.
    let mut ev: i64 = 0;
    for &c in exp {
        ev = (ev * 10 + i64::from(c - b'0')).min(99_999);
    }
    if exp_neg {
        ev = -ev;
    }
    s.push('e');
    s.push_str(&ev.to_string());
    s.parse::<f64>().unwrap_or(0.0)
}

/// The awk `num()`: jq `tonumber` on a string rendered like `jq -c`.
/// None = jq would fail (the whole components array becomes "").
pub fn jq_tonumber(s: &[u8]) -> Option<String> {
    let c = *s.first()?;
    if matches!(c, b't' | b'f' | b'n') {
        return None;
    }
    let (neg, b) = match c {
        b'+' => (false, s.get(1..).unwrap_or_default()),
        b'-' => (true, s.get(1..).unwrap_or_default()),
        _ => (false, s),
    };
    let sg = if neg { "-" } else { "" };
    let lc = b.to_ascii_lowercase();
    if lc == b"inf" || lc == b"infinity" {
        return Some(format!("{sg}{DMAXS}"));
    }
    if lc == b"nan" {
        return Some("null".into());
    }
    let mut i = 0usize;
    let mut nd = 0usize;
    let isd = |k: usize| b.get(k).is_some_and(|x| x.is_ascii_digit());
    let int_start = i;
    while isd(i) {
        i += 1;
        nd += 1;
    }
    let int = b.get(int_start..i).unwrap_or_default();
    let mut frac: &[u8] = b"";
    if b.get(i) == Some(&b'.') {
        i += 1;
        let fs = i;
        while isd(i) {
            i += 1;
            nd += 1;
        }
        frac = b.get(fs..i).unwrap_or_default();
    }
    if nd == 0 {
        return None;
    }
    let mut exp_neg = false;
    let mut exp: &[u8] = b"";
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            exp_neg = b.get(i) == Some(&b'-');
            i += 1;
        }
        let es = i;
        while isd(i) {
            i += 1;
        }
        if i == es {
            return None;
        }
        exp = b.get(es..i).unwrap_or_default();
    }
    if i < b.len() {
        return None;
    }
    let v = dec_to_f64(neg, int, frac, exp_neg, exp);
    if v == 0.0 {
        return Some(if neg { "-0".into() } else { "0".into() });
    }
    if !v.is_finite() || v.abs() > f64::MAX {
        return Some(format!("{sg}{DMAXS}"));
    }
    Some(jq_layout(v))
}

/// Strict JSON number grammar (all JSON parsers agree on these).
pub fn is_strict_json_number(s: &[u8]) -> bool {
    let mut i = 0usize;
    let at = |k: usize| s.get(k).copied();
    if at(i) == Some(b'-') {
        i += 1;
    }
    match at(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            while at(i).is_some_and(|c| c.is_ascii_digit()) {
                i += 1;
            }
        }
        _ => return false,
    }
    if at(i) == Some(b'.') {
        i += 1;
        let st = i;
        while at(i).is_some_and(|c| c.is_ascii_digit()) {
            i += 1;
        }
        if i == st {
            return false;
        }
    }
    if matches!(at(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(at(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let st = i;
        while at(i).is_some_and(|c| c.is_ascii_digit()) {
            i += 1;
        }
        if i == st {
            return false;
        }
    }
    i == s.len()
}

fn hexval(c: u8) -> Option<u32> {
    (c as char).to_digit(16)
}

/// musl `strtod` that must consume the whole token, as BusyBox awk on this
/// device decides "numeric string": decimal or hex float, finite only
/// (inf / nan / overflow are not numeric). No octal path.
fn awk_strtod_full(s: &[u8]) -> Option<f64> {
    let (neg, b) = match s.first() {
        Some(b'+') => (false, s.get(1..).unwrap_or_default()),
        Some(b'-') => (true, s.get(1..).unwrap_or_default()),
        _ => (false, s),
    };
    let v = if b.len() >= 2
        && b.first() == Some(&b'0')
        && matches!(b.get(1), Some(b'x' | b'X'))
    {
        let h = b.get(2..).unwrap_or_default();
        let mut i = 0usize;
        let mut mant: u128 = 0;
        let mut shift: i64 = 0;
        let mut nd = 0usize;
        let mut sticky = false;
        let mut push = |d: u32, frac: bool, mant: &mut u128, shift: &mut i64| {
            if *mant >> 120 == 0 {
                *mant = (*mant << 4) | u128::from(d);
                if frac {
                    *shift -= 4;
                }
            } else {
                if d != 0 {
                    sticky = true;
                }
                if !frac {
                    *shift += 4;
                }
            }
        };
        while let Some(d) = h.get(i).copied().and_then(hexval) {
            push(d, false, &mut mant, &mut shift);
            i += 1;
            nd += 1;
        }
        if h.get(i) == Some(&b'.') {
            i += 1;
            while let Some(d) = h.get(i).copied().and_then(hexval) {
                push(d, true, &mut mant, &mut shift);
                i += 1;
                nd += 1;
            }
        }
        if nd == 0 {
            // strtod reads "0" and stops at 'x': not the whole token.
            return None;
        }
        if matches!(h.get(i), Some(b'p' | b'P')) {
            let mut j = i + 1;
            let mut eneg = false;
            if matches!(h.get(j), Some(b'+' | b'-')) {
                eneg = h.get(j) == Some(&b'-');
                j += 1;
            }
            let st = j;
            let mut ev: i64 = 0;
            while let Some(c) = h.get(j).copied().filter(u8::is_ascii_digit) {
                ev = (ev * 10 + i64::from(c - b'0')).min(99_999);
                j += 1;
            }
            if j > st {
                shift += if eneg { -ev } else { ev };
                i = j;
            }
        }
        if i != h.len() {
            return None;
        }
        let _ = sticky;
        let mut v = mant as f64;
        // Scale by 2^shift in steps that stay exact.
        let mut sh = shift.clamp(-4000, 4000);
        while sh > 0 {
            let k = sh.min(1000);
            v *= 2f64.powi(i32::try_from(k).unwrap_or(0));
            sh -= k;
        }
        while sh < 0 {
            let k = (-sh).min(1000);
            v /= 2f64.powi(i32::try_from(k).unwrap_or(0));
            sh += k;
        }
        v
    } else {
        let mut i = 0usize;
        let isd = |k: usize| b.get(k).is_some_and(|x| x.is_ascii_digit());
        let mut nd = 0usize;
        while isd(i) {
            i += 1;
            nd += 1;
        }
        let int = b.get(..i).unwrap_or_default();
        let mut frac: &[u8] = b"";
        if b.get(i) == Some(&b'.') {
            i += 1;
            let fs = i;
            while isd(i) {
                i += 1;
                nd += 1;
            }
            frac = b.get(fs..i).unwrap_or_default();
        }
        if nd == 0 {
            return None;
        }
        let mut exp_neg = false;
        let mut exp: &[u8] = b"";
        if matches!(b.get(i), Some(b'e' | b'E')) {
            let mut j = i + 1;
            let mut en = false;
            if matches!(b.get(j), Some(b'+' | b'-')) {
                en = b.get(j) == Some(&b'-');
                j += 1;
            }
            let st = j;
            while isd(j) {
                j += 1;
            }
            if j > st {
                exp_neg = en;
                exp = b.get(st..j).unwrap_or_default();
                i = j;
            }
        }
        if i != b.len() {
            return None;
        }
        dec_to_f64(false, int, frac, exp_neg, exp)
    };
    let v = if neg { -v } else { v };
    if v.is_finite() {
        Some(v)
    } else {
        None
    }
}

/// The awk `nrsnr()`.
fn nrsnr(r: &[u8]) -> Vec<u8> {
    if r == b"-32768" {
        return b"null".to_vec();
    }
    if r.is_empty() {
        return Vec::new();
    }
    let first = r
        .split(|c| matches!(c, b' ' | b'\t' | b'\n'))
        .find(|f| !f.is_empty());
    let Some(f1) = first else {
        return b"0.0".to_vec();
    };
    match awk_strtod_full(f1) {
        Some(v) => format!("{:.1}", v / 100.0).into_bytes(),
        None => b"null".to_vec(),
    }
}

/// The awk `sane()`.
fn sane(s: &[u8]) -> Vec<u8> {
    if s.is_empty() || s == b"-" {
        return b"null".to_vec();
    }
    if s.iter().all(|c| c.is_ascii_digit() || *c == b'-') {
        s.to_vec()
    } else {
        b"null".to_vec()
    }
}

fn lte_rb(bw: &[u8]) -> u32 {
    match bw {
        b"6" => 1,
        b"15" => 3,
        b"25" => 5,
        b"50" => 10,
        b"75" => 15,
        b"100" => 20,
        _ => 0,
    }
}

fn nr_bw(bw: &[u8]) -> u32 {
    match bw {
        b"0" => 5,
        b"1" => 10,
        b"2" => 15,
        b"3" => 20,
        b"4" => 25,
        b"5" => 30,
        b"6" => 40,
        b"7" => 50,
        b"8" => 60,
        b"9" => 70,
        b"10" => 80,
        b"11" => 90,
        b"12" => 100,
        b"13" => 200,
        b"14" => 400,
        b"15" => 35,
        b"16" => 45,
        _ => 0,
    }
}

fn sub_first(s: &[u8], pat: &[u8]) -> Vec<u8> {
    super::del_first(s, pat)
}

struct Comp {
    shell: Vec<u8>,
    jq: String,
}

/// Builds one component object in both renderings. Returns None for the
/// numbers jq `tonumber` rejects (sets the batch-wide `bad`).
fn component(cc: &[&[u8]], bad: &mut bool) -> Comp {
    let g = |i: usize| -> &[u8] { cc.get(i).copied().unwrap_or_default() };
    let mut num = |s: &[u8]| -> String {
        match jq_tonumber(s) {
            Some(v) => v,
            None => {
                *bad = true;
                String::new()
            }
        }
    };
    let strs = [g(0), g(1), g(2)];
    let mut nums: Vec<String> = Vec::with_capacity(7);
    for (i, k) in [3usize, 4, 5, 6, 7, 8, 9].iter().enumerate() {
        let s = g(*k);
        // earfcn and the four signal fields go through nn(); bandwidth num().
        if i != 1 && s == b"null" {
            nums.push("null".into());
        } else {
            nums.push(num(s));
        }
    }
    let keys = ["earfcn", "bandwidth_mhz", "pci", "rsrp", "rsrq", "rssi", "sinr"];
    let mut sh: Vec<u8> = Vec::new();
    let mut jq = String::new();
    for (i, k) in ["type", "technology", "band"].iter().enumerate() {
        let s = strs.get(i).copied().unwrap_or_default();
        sh.extend_from_slice(if i == 0 { b"{\"" } else { b",\"" });
        sh.extend_from_slice(k.as_bytes());
        sh.extend_from_slice(b"\":");
        sh.extend_from_slice(&awk_js(s));
        jq.push_str(if i == 0 { "{\"" } else { ",\"" });
        jq.push_str(k);
        jq.push_str("\":");
        jq.push_str(&jq_string(s));
    }
    for (k, v) in keys.iter().zip(nums.iter()) {
        sh.extend_from_slice(b",\"");
        sh.extend_from_slice(k.as_bytes());
        sh.extend_from_slice(b"\":");
        sh.extend_from_slice(v.as_bytes());
        jq.push_str(",\"");
        jq.push_str(k);
        jq.push_str("\":");
        jq.push_str(v);
    }
    sh.push(b'}');
    jq.push('}');
    Comp { shell: sh, jq }
}

/// What the awk pass prints, already split into its lines.
struct AwkOut {
    lsc: u64,
    nsc: u64,
    /// None = "E" (no ^+QCAINFO: line); Some(nr_pcc_seen).
    state: Option<bool>,
    total: u64,
    details: Vec<u8>,
    /// None when jq tonumber would have failed (printed as "").
    comps: Option<(Vec<u8>, String)>,
}

fn awk_pass(qr: &[u8]) -> AwkOut {
    let mut lsc = 0u64;
    let mut nsc = 0u64;
    let mut seen = false;
    let mut pcc = false;
    let mut tot = 0u64;
    let mut det: Vec<u8> = Vec::new();
    let mut arr_sh: Vec<u8> = Vec::new();
    let mut arr_jq = String::new();
    let mut bad = false;
    let mut n_comps = 0usize;
    for ln in qr.split(|&b| b == b'\n') {
        if contains(ln, b"+QCAINFO: \"SCC\"") {
            if contains(ln, b"LTE BAND") {
                lsc += 1;
            }
            if contains(ln, b"NR") {
                nsc += 1;
            }
        }
        if !ln.starts_with(b"+QCAINFO:") {
            continue;
        }
        seen = true;
        let csv = del_all(ln, b"+QCAINFO: ");
        let csv = del_all(&csv, b"\"");
        let csv = del_all(&csv, b" ");
        let csv = del_all(&csv, b"\r");
        let (nf, f): (usize, Vec<&[u8]>) = if csv.contains(&b',') {
            let parts: Vec<&[u8]> = csv.split(|&b| b == b',').collect();
            (parts.len(), parts)
        } else {
            (1, vec![csv.as_slice(); 12])
        };
        let fi = |i: usize| -> &[u8] { f.get(i.wrapping_sub(1)).copied().unwrap_or_default() };
        let typ = fi(1);
        let frq = fi(2);
        let bw = fi(3);
        let bs = fi(4);
        let pci: Vec<u8>;
        let mut rsrp: Vec<u8> = b"null".to_vec();
        let mut rsrq: Vec<u8> = b"null".to_vec();
        let mut rssi: Vec<u8> = b"null".to_vec();
        let mut snr: Vec<u8> = b"null".to_vec();
        let tech: &[u8];
        let mhz: u32;
        let band: Vec<u8>;
        if bs.starts_with(b"LTEBAND") {
            tech = b"LTE";
            mhz = lte_rb(bw);
            band = [b"B".as_slice(), &sub_first(bs, b"LTEBAND")].concat();
            pci = fi(6).to_vec();
            rsrp = fi(7).to_vec();
            rsrq = fi(8).to_vec();
            rssi = fi(9).to_vec();
            snr = fi(10).to_vec();
        } else if bs.starts_with(b"NR5GBAND") || bs.starts_with(b"NRDCBAND") {
            tech = b"NR";
            mhz = nr_bw(bw);
            let n = sub_first(&sub_first(bs, b"NR5GBAND"), b"NRDCBAND");
            band = [b"N".as_slice(), &n].concat();
            if nf >= 9 {
                pci = fi(6).to_vec();
                if nf >= 10 {
                    rsrp = fi(10).to_vec();
                }
                if nf >= 11 {
                    rsrq = fi(11).to_vec();
                }
                if nf >= 12 {
                    snr = nrsnr(fi(12));
                }
            } else {
                pci = fi(5).to_vec();
                if nf >= 6 {
                    rsrp = fi(6).to_vec();
                }
                if nf >= 7 {
                    rsrq = fi(7).to_vec();
                }
                if nf >= 8 {
                    snr = nrsnr(fi(8));
                }
            }
        } else {
            continue;
        }
        if mhz > 0 {
            tot += u64::from(mhz);
            if !det.is_empty() {
                det.extend_from_slice(b" + ");
            }
            det.extend_from_slice(&band);
            det.extend_from_slice(format!(": {mhz} MHz").as_bytes());
        }
        let pci = sane(&pci);
        let rsrp = sane(&rsrp);
        let rsrq = sane(&rsrq);
        let rssi = sane(&rssi);
        if snr.is_empty() || snr == b"-" {
            snr = b"null".to_vec();
        }
        if typ == b"PCC" && tech == b"NR" {
            pcc = true;
        }
        let mhz_s = mhz.to_string().into_bytes();
        let frq_s: &[u8] = if frq.is_empty() { b"null" } else { frq };
        let fields: [&[u8]; 10] = [
            typ, tech, &band, frq_s, &mhz_s, &pci, &rsrp, &rsrq, &rssi, &snr,
        ];
        let rec = fields.join(&b'\t');
        let cc: Vec<&[u8]> = rec.split(|&b| b == b'\t').collect();
        let c = component(&cc, &mut bad);
        if n_comps > 0 {
            arr_sh.push(b',');
            arr_jq.push(',');
        }
        arr_sh.extend_from_slice(&c.shell);
        arr_jq.push_str(&c.jq);
        n_comps += 1;
    }
    let mut sh = b"[".to_vec();
    sh.extend_from_slice(&arr_sh);
    sh.push(b']');
    AwkOut {
        lsc,
        nsc,
        state: if seen { Some(pcc) } else { None },
        total: tot,
        details: det,
        comps: if bad {
            None
        } else {
            Some((sh, format!("[{arr_jq}]")))
        },
    }
}

pub fn parse_ca_info(st: &mut State, qr: &[u8]) {
    let a = awk_pass(qr);
    if a.lsc > 0 {
        st.put(Var::T2CaActive, "true");
        st.put(Var::T2CaCount, a.lsc.to_string());
    } else {
        st.put(Var::T2CaActive, "false");
        st.put(Var::T2CaCount, "0");
    }
    if a.nsc > 0 {
        if st.read(Var::NetworkType) == b"5G-NSA" {
            if a.nsc > 1 {
                st.put(Var::T2NrCaActive, "true");
                st.put(Var::T2NrCaCount, (a.nsc - 1).to_string());
            } else {
                st.put(Var::T2NrCaActive, "false");
                st.put(Var::T2NrCaCount, "0");
            }
        } else {
            st.put(Var::T2NrCaActive, "true");
            st.put(Var::T2NrCaCount, a.nsc.to_string());
        }
    } else {
        st.put(Var::T2NrCaActive, "false");
        st.put(Var::T2NrCaCount, "0");
    }
    let Some(nr_pcc) = a.state else {
        st.put(Var::T2TotalBandwidthMhz, "0");
        st.put(Var::T2BandwidthDetails, "");
        st.put_components(b"[]".to_vec(), Some("[]".into()));
        return;
    };
    st.put(Var::T2TotalBandwidthMhz, a.total.to_string());
    st.put(Var::T2BandwidthDetails, a.details);
    match a.comps {
        Some((sh, jq)) => st.put_components(sh, Some(jq)),
        None => st.put_components(Vec::new(), None),
    }
    if nr_pcc {
        let nt = st.read(Var::NetworkType);
        if nt != b"5G-SA" && nt != b"5G-NSA" {
            st.put(Var::NetworkType, "5G-SA");
            let nr = st.read(Var::NrState);
            if nr == b"unknown" || nr == b"inactive" {
                st.put(Var::NrState, "connected");
            }
            if st.read(Var::LteState) == b"unknown" {
                st.put(Var::LteState, "inactive");
            }
        }
    }
}
