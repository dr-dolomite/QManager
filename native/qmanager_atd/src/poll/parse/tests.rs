//! Parity (device-generated expectations), eval-safety, allowlist and
//! robustness tests for the poll parsers and the env writer.

use super::*;
use crate::poll::envout::{allowlist, is_allowed, render_failure, render_steps, sh_assign, write_env};
use std::collections::BTreeMap;

const EXPECTED: &str = include_str!("../../../tests/parity/expected.txt");

/// Every global rx_expect.sh dumps (its RX_NAMES), all set to a sentinel.
const DUMP_NAMES: &str = "lte_state lte_band lte_earfcn lte_bandwidth lte_pci lte_rsrp lte_rsrq lte_sinr lte_rssi lte_cell_id lte_enodeb_id lte_sector_id lte_tac lte_ta nr_state nr_band nr_arfcn nr_cell_id nr_enodeb_id nr_sector_id nr_tac nr_pci nr_rsrp nr_rsrq nr_sinr nr_scs nr_ta t1_temperature t1_cfun t2_carrier t2_sim_status t2_sim_slot t2_ca_active t2_ca_count t2_nr_ca_active t2_nr_ca_count t2_total_bandwidth_mhz t2_bandwidth_details t2_carrier_components sig_lte_rsrp sig_lte_rsrq sig_lte_sinr sig_nr_rsrp sig_nr_rsrq sig_nr_sinr network_type service_status boot_phone_number boot_imsi boot_iccid errors";

fn unesc(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut o = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            if b[i + 1] == b'\\' {
                o.push(b'\\');
                i += 2;
                continue;
            }
            if b[i + 1] == b'x' && i + 3 < b.len() {
                let h = std::str::from_utf8(&b[i + 2..i + 4]).unwrap();
                o.push(u8::from_str_radix(h, 16).unwrap());
                i += 4;
                continue;
            }
        }
        o.push(b[i]);
        i += 1;
    }
    o
}

struct Case {
    id: String,
    vals: Vec<(String, Vec<u8>)>,
}

struct Corpus {
    fixtures: BTreeMap<String, Vec<u8>>,
    sidecars: BTreeMap<String, Vec<u8>>,
    cases: Vec<Case>,
}

fn corpus() -> Corpus {
    let mut c = Corpus {
        fixtures: BTreeMap::new(),
        sidecars: BTreeMap::new(),
        cases: Vec::new(),
    };
    for line in EXPECTED.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let (tag, rest) = line.split_at(2);
        match tag {
            "F " | "E " | "V " => {
                let (k, v) = rest.split_once(' ').unwrap_or((rest, ""));
                let v = unesc(v);
                match tag {
                    "F " => {
                        c.fixtures.insert(k.to_string(), v);
                    }
                    "E " => {
                        c.sidecars.insert(k.to_string(), v);
                    }
                    _ => c.cases.last_mut().unwrap().vals.push((k.to_string(), v)),
                }
            }
            "C " => c.cases.push(Case {
                id: rest.to_string(),
                vals: Vec::new(),
            }),
            _ => panic!("bad line {line}"),
        }
    }
    c
}

/// Parses `name='v'` lines exactly as POSIX sh reads this writer's output.
fn parse_env(env: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < env.len() {
        let eq = env[i..].iter().position(|&c| c == b'=').unwrap() + i;
        let name = std::str::from_utf8(&env[i..eq]).unwrap().to_string();
        assert!(
            name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'),
            "bad name {name:?}"
        );
        i = eq + 1;
        assert_eq!(env[i], b'\'', "value of {name} not quoted");
        i += 1;
        let mut v = Vec::new();
        loop {
            let c = env[i];
            i += 1;
            if c == b'\'' {
                if env[i..].starts_with(b"\\''") {
                    v.push(b'\'');
                    i += 3;
                    continue;
                }
                break;
            }
            v.push(c);
        }
        assert_eq!(env[i], b'\n');
        i += 1;
        out.push((name, v));
    }
    out
}

fn sidecar_assigns(s: &[u8]) -> Vec<(String, Vec<u8>)> {
    let t = String::from_utf8_lossy(s);
    let mut v = Vec::new();
    for part in t.split([';', '\n']) {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let (k, val) = p.split_once('=').unwrap();
        v.push((k.to_string(), val.trim_matches('"').as_bytes().to_vec()));
    }
    v
}

/// Runs one case through the Rust path; returns (final globals, env bytes).
fn run_case(c: &Corpus, id: &str) -> (BTreeMap<String, Vec<u8>>, Vec<u8>) {
    let parts: Vec<&str> = id.split('|').collect();
    let steps: Vec<Step> = parts[0].split(',').map(|s| Step::from_name(s).unwrap()).collect();
    let rcs: Vec<i32> = parts[1].split(',').map(|s| s.parse().unwrap()).collect();
    let fx: Vec<&str> = parts[2].split(',').collect();
    let mut m = base_map(c, &fx);
    let prior = Prior {
        network_type: m["network_type"].clone(),
        lte_state: m["lte_state"].clone(),
        nr_state: m["nr_state"].clone(),
    };
    let mut st = State::new(prior);
    let mut done = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let raw = &c.fixtures[fx[i]];
        let src = run_step(&mut st, *step, rcs[i], &shell_capture(raw));
        let status = if rcs[i] == 0 { StepStatus::Ok } else { StepStatus::Failed };
        done.push((*step, status, src));
    }
    let mut env = Vec::new();
    write_env(&PollMeta { rc: "ok", ms: 7 }, &done, &st, &mut env).unwrap();
    for (k, v) in parse_env(&env) {
        assert!(is_allowed(&k), "{id}: emitted {k}");
        if k.starts_with("qm_") || k.ends_with("_j") {
            continue;
        }
        assert!(m.contains_key(&k), "{id}: {k} is not a dumped global");
        m.insert(k, v);
    }
    (m, env)
}

fn base_map(c: &Corpus, fx: &[&str]) -> BTreeMap<String, Vec<u8>> {
    let mut m = BTreeMap::new();
    for n in DUMP_NAMES.split(' ') {
        m.insert(n.to_string(), format!("SENT_{n}").into_bytes());
    }
    for f in fx {
        if let Some(s) = c.sidecars.get(*f) {
            for (k, v) in sidecar_assigns(s) {
                m.insert(k, v);
            }
        }
    }
    m
}

fn show(v: &[u8]) -> String {
    v.iter()
        .map(|&b| {
            if (0x20..0x7f).contains(&b) {
                (b as char).to_string()
            } else {
                format!("\\x{b:02x}")
            }
        })
        .collect()
}

#[test]
fn parity_with_device_shell() {
    let c = corpus();
    assert!(c.cases.len() >= 2000, "corpus too small: {}", c.cases.len());
    let mut diffs = Vec::new();
    let mut per_step: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for case in &c.cases {
        let fx: Vec<&str> = case.id.split('|').nth(2).unwrap().split(',').collect();
        let mut want = base_map(&c, &fx);
        for (k, v) in &case.vals {
            want.insert(k.clone(), v.clone());
        }
        let (got, _) = run_case(&c, &case.id);
        let key = case.id.split('|').next().unwrap().to_string();
        let e = per_step.entry(key).or_default();
        e.0 += 1;
        if got != want {
            e.1 += 1;
            for (k, w) in &want {
                let g = &got[k];
                if g != w {
                    diffs.push(format!("{}: {k}: want [{}] got [{}]", case.id, show(w), show(g)));
                }
            }
        }
    }
    for (k, (n, d)) in &per_step {
        eprintln!("parity {k}: {n} cases, {d} with diffs");
    }
    if !diffs.is_empty() {
        let n = diffs.len();
        diffs.truncate(60);
        panic!("{n} diffs:\n{}", diffs.join("\n"));
    }
}

#[test]
fn every_emitted_name_is_allowlisted_and_list_is_closed() {
    let al = allowlist();
    // 4 meta + 12 step names + 48 globals + 43 `_j` twins.
    assert_eq!(al.len(), 4 + 12 + VAR_COUNT + 43, "{al:?}");
    for n in &al {
        assert!(is_allowed(n), "{n}");
        assert!(n.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_'));
    }
    for bad in [
        "PATH", "IFS", "PS4", "ENV", "modem_reachable", "system_state", "qm_step_foo",
        "qm_step_qeng_x", "t2_ca_active_j", "lte_state_jj", "_cid_dec", "", "qm_poll",
        "boot_imei", "t2_apn", "lte_ta", "t1_temperature",
    ] {
        assert!(!is_allowed(bad), "{bad} must not be allowed");
    }
    let c = corpus();
    for case in &c.cases {
        let (_, env) = run_case(&c, &case.id);
        for (k, _) in parse_env(&env) {
            assert!(al.contains(&k), "{k}");
        }
    }
}

#[test]
fn step_table_is_read_only() {
    for s in Step::ALL {
        let at = s.at_command();
        assert!(at.starts_with("AT+"));
        for bad in ["CGCONTRDP", "QMAP", "QNWCFG", "CPMS", "CMGF", "CFUN="] {
            assert!(!at.contains(bad), "{at} contains {bad}");
        }
        // The only '=' allowed is QENG's query selector.
        assert!(!at.contains('=') || at == "AT+QENG=\"servingcell\"", "{at}");
        assert_eq!(Step::from_name(s.name()), Some(s));
    }
    assert_eq!(Step::from_name("QENG"), None);
}

#[test]
fn quoting_is_posix_single_quote() {
    assert_eq!(sh_assign("t2_carrier", b"a'b"), b"t2_carrier='a'\\''b'\n");
    assert_eq!(sh_assign("t2_carrier", b"x\0y"), b"t2_carrier='xy'\n");
    assert_eq!(sh_assign("t2_carrier", b"$(id)`id`;\\\n"), b"t2_carrier='$(id)`id`;\\\n'\n".to_vec());
}

fn sh_available() -> bool {
    std::process::Command::new("sh").arg("-c").arg("exit 0").status().is_ok_and(|s| s.success())
}

/// Sources an env in a real POSIX sh and returns name -> value for `names`.
fn source_in_sh(env: &[u8], names: &[String]) -> BTreeMap<String, Vec<u8>> {
    use std::io::Write as _;
    let dir = std::env::temp_dir().join(format!("qm_envtest_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("poll.env");
    std::fs::File::create(&f).unwrap().write_all(env).unwrap();
    let mut script = format!(". '{}' || exit 3\n", f.display());
    for n in names {
        script.push_str(&format!("printf '%s=%s\\000' {n} \"${{{n}-<UNSET>}}\"\n"));
    }
    let o = std::process::Command::new("sh").arg("-c").arg(&script).output().unwrap();
    assert!(o.status.success(), "sh failed: {}", String::from_utf8_lossy(&o.stderr));
    let n = std::process::Command::new("sh").arg("-n").arg(&f).status().unwrap();
    assert!(n.success(), "sh -n rejected the env");
    let mut m = BTreeMap::new();
    for rec in o.stdout.split(|&b| b == 0).filter(|r| !r.is_empty()) {
        let eq = rec.iter().position(|&b| b == b'=').unwrap();
        m.insert(String::from_utf8(rec[..eq].to_vec()).unwrap(), rec[eq + 1..].to_vec());
    }
    let _ = std::fs::remove_dir_all(&dir);
    m
}

#[test]
fn hostile_envs_source_to_literal_text() {
    if !sh_available() {
        eprintln!("no sh: skipped");
        return;
    }
    let marker = std::path::Path::new("/tmp/pp_pwned");
    let _ = std::fs::remove_file(marker);
    let c = corpus();
    let mut n = 0;
    for case in &c.cases {
        let id = &case.id;
        let interesting = ["hostile", "utf8", "nul", "ctrl", "echo_words", "live", "tab"]
            .iter()
            .any(|k| id.contains(k));
        if !interesting {
            continue;
        }
        let (_, env) = run_case(&c, id);
        let parsed = parse_env(&env);
        let names: Vec<String> = parsed.iter().map(|(k, _)| k.clone()).collect();
        let got = source_in_sh(&env, &names);
        for (k, v) in &parsed {
            // A shell variable cannot hold NUL; the writer never emits one.
            assert_eq!(got.get(k), Some(v), "{id}: {k}");
        }
        n += 1;
    }
    assert!(n > 50, "only {n} hostile cases");
    assert!(!marker.exists(), "a hostile fixture executed");
}

#[test]
fn json_twins() {
    let c = corpus();
    let (_, env) = run_case(
        &c,
        "qeng,ca,cfun,sig,ident,simid|0,0,0,0,0,0|fixtures/serving_cell__live_a.txt,fixtures/ca_info__live_a.txt,fixtures_rust/cfun__1.txt,fixtures/signal__live_a.txt,fixtures/tier2__live_a.txt,fixtures_rust/simid__live.txt",
    );
    let m: BTreeMap<String, Vec<u8>> = parse_env(&env).into_iter().collect();
    let g = |k: &str| String::from_utf8(m[k].clone()).unwrap();
    assert_eq!(g("qm_poll_v"), "1");
    assert_eq!(g("qm_poll_end"), "1");
    assert_eq!(g("qm_step_qeng"), "ok");
    assert_eq!(g("qm_step_qeng_rc"), "0");
    assert_eq!(g("t2_carrier_j"), "\"TNT\"");
    assert_eq!(g("network_type_j"), "\"LTE\"");
    assert_eq!(g("lte_rsrp_j"), "-115");
    assert_eq!(g("nr_rsrp_j"), "null");
    assert_eq!(g("t1_cfun_j"), "1");
    assert_eq!(g("sig_lte_rsrp_j"), "[-116,-116,null,null]");
    assert!(g("t2_carrier_components_j").starts_with("[{\"type\":\"PCC\""));
    assert!(!m.contains_key("t2_ca_active_j"));
    // Last line is the end marker.
    assert!(env.ends_with(b"qm_poll_end='1'\n"));

    // Numeric twins: strict JSON only, jq-rendered; else '' (fallback).
    let mut st = State::new(Prior::default());
    st.put(Var::LteRsrp, "1.50");
    st.put(Var::LteRsrq, "007");
    st.put(Var::LteSinr, "1e21");
    st.put(Var::LteRssi, "-9'2");
    st.put(Var::NetworkType, "");
    st.put(Var::T2SimSlot, "");
    st.put(Var::SigNrRsrp, "[1,2.50,null,-0]");
    st.put(Var::SigNrRsrq, "[$(id),1,2,3]");
    st.put(Var::T2Carrier, "A\"b\\c\u{1}\t\u{7f}");
    let mut env = Vec::new();
    write_env(&PollMeta { rc: "ok", ms: 0 }, &[], &st, &mut env).unwrap();
    let m: BTreeMap<String, Vec<u8>> = parse_env(&env).into_iter().collect();
    let g = |k: &str| String::from_utf8(m[k].clone()).unwrap();
    assert_eq!(g("lte_rsrp_j"), "1.5");
    assert_eq!(g("lte_rsrq_j"), "");
    assert_eq!(g("lte_sinr_j"), "1e+21");
    assert_eq!(g("lte_rssi_j"), "");
    assert_eq!(g("network_type_j"), "\"LTE\"");
    assert_eq!(g("t2_sim_slot_j"), "1");
    assert_eq!(g("sig_nr_rsrp_j"), "[1,2.5,null,-0]");
    assert_eq!(g("sig_nr_rsrq_j"), "");
    assert_eq!(g("t2_carrier_j"), "\"A\\\"b\\\\c\\u0001\\t\\u007f\"");
}

#[test]
fn failure_env_and_parse_only() {
    let mut env = Vec::new();
    render_failure("scan_in_progress", 0, &mut env).unwrap();
    assert_eq!(
        env,
        b"qm_poll_v='1'\nqm_poll_rc='scan_in_progress'\nqm_poll_ms='0'\nqm_poll_end='1'\n".to_vec()
    );
    let mut o = Vec::new();
    assert_eq!(parse_only_with("nope", 0, b"", Prior::default(), &mut o), 2);
    assert!(o.is_empty());
    let mut o = Vec::new();
    assert_eq!(parse_only_with("cfun", 0, b"AT+CFUN?\r\r\n+CFUN: 1\r\n\r\nOK\r\n", Prior::default(), &mut o), 0);
    let m: BTreeMap<String, Vec<u8>> = parse_env(&o).into_iter().collect();
    assert_eq!(m["t1_cfun"], b"1");
    assert_eq!(m["qm_step_cfun"], b"ok");
    // Timeout behaves as a failed qcmd (exit 1, no output); skipped as one
    // that never ran (exit 3).
    let mut o = Vec::new();
    render_steps(
        &[
            (Step::Qeng, StepStatus::Timeout, b"+QENG: junk".to_vec()),
            (Step::Ca, StepStatus::Skipped, Vec::new()),
            (Step::Sig, StepStatus::Skipped, Vec::new()),
        ],
        &PollMeta { rc: "ok", ms: 12 },
        Prior::default(),
        &mut o,
    )
    .unwrap();
    let m: BTreeMap<String, Vec<u8>> = parse_env(&o).into_iter().collect();
    assert_eq!(m["qm_step_qeng"], b"timeout");
    assert_eq!(m["qm_step_qeng_rc"], b"1");
    assert_eq!(m["errors"], b"modem_timeout");
    // Skipped steps never ran (rc 3): CA keeps the poller's last values.
    assert_eq!(m["qm_step_ca_rc"], b"3");
    assert!(!m.contains_key("t2_carrier_components"));
    assert_eq!(m["qm_step_sig_rc"], b"3");
    assert!(!m.contains_key("sig_lte_rsrp"));
}

/// Render one step and return its env as a map.
fn render_one(step: Step, status: StepStatus) -> BTreeMap<String, Vec<u8>> {
    let mut o = Vec::new();
    render_steps(&[(step, status, Vec::new())], &PollMeta { rc: "ok", ms: 1 }, Prior::default(), &mut o)
        .unwrap();
    parse_env(&o).into_iter().collect()
}

const CA_VARS: [&str; 7] = [
    "t2_ca_active",
    "t2_ca_count",
    "t2_nr_ca_active",
    "t2_nr_ca_count",
    "t2_total_bandwidth_mhz",
    "t2_bandwidth_details",
    "t2_carrier_components",
];

#[test]
fn skipped_ca_keeps_last_values_failed_resets() {
    // _qc_read rc 3 (not run) leaves the CA globals alone; rc 1 resets them.
    let mut st = State::new(Prior::default());
    st.put(Var::T2CaActive, "true");
    st.put(Var::T2CaCount, "2");
    assert_eq!(run_step(&mut st, Step::Ca, 3, b""), 3);
    assert_eq!(st.get_set(Var::T2CaActive), Some(&b"true"[..]));
    assert_eq!(st.get_set(Var::T2CaCount), Some(&b"2"[..]));

    let m = render_one(Step::Ca, StepStatus::Skipped);
    assert_eq!(m["qm_step_ca"], b"skipped");
    assert_eq!(m["qm_step_ca_rc"], b"3");
    for v in CA_VARS {
        assert!(!m.contains_key(v), "{v} assigned on a skipped step");
    }

    for status in [StepStatus::Failed, StepStatus::Timeout, StepStatus::NotReady] {
        let m = render_one(Step::Ca, status);
        assert_eq!(m["qm_step_ca_rc"], b"1");
        assert_eq!(m["t2_ca_active"], b"false");
        assert_eq!(m["t2_ca_count"], b"0");
        assert_eq!(m["t2_nr_ca_active"], b"false");
        assert_eq!(m["t2_nr_ca_count"], b"0");
        assert_eq!(m["t2_total_bandwidth_mhz"], b"0");
        assert_eq!(m["t2_bandwidth_details"], b"");
        assert_eq!(m["t2_carrier_components"], b"[]");
    }
}

#[test]
fn skipped_qeng_is_rc3_failed_is_rc1() {
    // poll_serving_cell counts rc 3 toward sc_busy_streak, rc 1 toward
    // sc_fail_streak; the poller reads the split from qm_step_qeng_rc.
    let m = render_one(Step::Qeng, StepStatus::Skipped);
    assert_eq!(m["qm_step_qeng"], b"skipped");
    assert_eq!(m["qm_step_qeng_rc"], b"3");
    let m = render_one(Step::Qeng, StepStatus::Failed);
    assert_eq!(m["qm_step_qeng"], b"failed");
    assert_eq!(m["qm_step_qeng_rc"], b"1");
}

#[test]
fn batch_applies_qcmd_raw_transform() {
    // Invalid UTF-8 from the daemon becomes U+FFFD exactly as qcmd prints it.
    let mut o = Vec::new();
    render_steps(
        &[(
            Step::Ident,
            StepStatus::Ok,
            b"AT+COPS?\r\r\n+COPS: 0,0,\"A\xffB\",7\r\n\r\nOK\r\n\n\n".to_vec(),
        )],
        &PollMeta { rc: "ok", ms: 1 },
        Prior::default(),
        &mut o,
    )
    .unwrap();
    let m: BTreeMap<String, Vec<u8>> = parse_env(&o).into_iter().collect();
    assert_eq!(m["t2_carrier"], "A\u{fffd}B".as_bytes());
}

#[test]
fn awk_number_formatting() {
    assert_eq!(format!("{:.1}", 0.25f64), "0.2");
    assert_eq!(format!("{:.1}", 0.35f64), "0.3"); // 0.35 is below .35 in binary
    assert_eq!(format!("{:.1}", -0.0f64), "-0.0");
    assert_eq!(format!("{:.1}", -0.005f64), "-0.0");
    assert_eq!(ca::jq_tonumber(b"123456789012345678").as_deref(), Some("123456789012345680"));
    assert_eq!(ca::jq_tonumber(b"1E-5").as_deref(), Some("1e-05"));
    assert_eq!(ca::jq_tonumber(b"0.0001").as_deref(), Some("0.0001"));
    assert_eq!(ca::jq_tonumber(b"-inf").as_deref(), Some("-1.7976931348623157e+308"));
    assert_eq!(ca::jq_tonumber(b"nan"), None);
    assert_eq!(ca::jq_tonumber(b"NaN").as_deref(), Some("null"));
    assert_eq!(ca::jq_tonumber(b"-0").as_deref(), Some("-0"));
    assert_eq!(ca::jq_tonumber(b"1e99999999999999999999").as_deref(), Some("1.7976931348623157e+308"));
}

// ---------------------------------------------------------------------------
// Robustness: deterministic fuzz (no external crates)
// ---------------------------------------------------------------------------

struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const TOKENS: &[&[u8]] = &[
    b"+QENG: ", b"\"servingcell\"", b"\"NOCONN\"", b"\"LTE\"", b"\"NR5G-NSA\"", b"\"NR5G-SA\"",
    b"SEARCH", b"+QCAINFO: ", b"\"PCC\"", b"\"SCC\"", b"LTE BAND ", b"NR5G BAND ", b"NRDCBAND",
    b"+CFUN: ", b"+QRSRP: ", b"+QRSRQ:", b"+QSINR: ", b"NR5G", b"+COPS: ", b"+QUIMSLOT: ",
    b"+CNUM: ", b"+CPIN: ", b"READY", b"CME ERROR", b"ERROR", b"+QCCID: ", b"OK", b"AT", b",", b",,",
    b"\"", b"'", b"\r", b"\n", b"\r\n", b"\t", b" ", b"-32768", b"-", b"0x", b"1e400", b"nan",
    b"inf", b"FFFFFFFFFFFFFFFFF", b"7FFFFFFFFFFFFFFF", b"$(touch /tmp/pp_pwned)", b"`id`", b"\0",
    b"\xff", b"\xc3", b"-n", b"123456789012345", b"0", b"9", b"-1.5e-3", b".", b"\\",
];

fn random_input(r: &mut XorShift) -> Vec<u8> {
    let n = r.below(60);
    let mut v = Vec::new();
    for _ in 0..n {
        if r.below(3) == 0 {
            for _ in 0..r.below(8) {
                v.push((r.next() & 0xff) as u8);
            }
        } else {
            v.extend_from_slice(TOKENS[r.below(TOKENS.len())]);
        }
    }
    v
}

fn exercise(r: &mut XorShift, inputs: &[Vec<u8>]) {
    let mut res = Vec::new();
    for raw in inputs {
        let step = Step::ALL[r.below(6)];
        let status = if r.below(5) == 0 { StepStatus::Timeout } else { StepStatus::Ok };
        res.push((step, status, raw.clone()));
    }
    let prior = Prior {
        network_type: random_input(r),
        lte_state: random_input(r),
        nr_state: random_input(r),
    };
    let mut env = Vec::new();
    render_steps(&res, &PollMeta { rc: "ok", ms: 1 }, prior, &mut env).unwrap();
    assert!(env.ends_with(b"qm_poll_end='1'\n"));
    assert!(!env.contains(&0));
    for (k, _) in parse_env(&env) {
        assert!(is_allowed(&k));
    }
    for raw in inputs {
        for s in Step::ALL {
            let mut o = Vec::new();
            assert_eq!(parse_only_with(s.name(), (r.below(3) as i32) - 1, raw, Prior::default(), &mut o), 0);
            parse_env(&o);
        }
    }
}

#[test]
fn fuzz_random_bytes_never_panic() {
    let mut r = XorShift(0x9E37_79B9_7F4A_7C15);
    for _ in 0..3000 {
        let k = 1 + r.below(4);
        let inputs: Vec<Vec<u8>> = (0..k).map(|_| random_input(&mut r)).collect();
        exercise(&mut r, &inputs);
    }
}

#[test]
fn fuzz_mutated_fixtures_never_panic() {
    let c = corpus();
    let fx: Vec<&Vec<u8>> = c.fixtures.values().collect();
    let mut r = XorShift(0x0123_4567_89AB_CDEF);
    for _ in 0..3000 {
        let mut v = fx[r.below(fx.len())].clone();
        for _ in 0..1 + r.below(6) {
            match r.below(4) {
                0 if !v.is_empty() => {
                    let i = r.below(v.len());
                    v[i] = (r.next() & 0xff) as u8;
                }
                1 if !v.is_empty() => {
                    let i = r.below(v.len());
                    v.remove(i);
                }
                2 => {
                    let i = r.below(v.len() + 1);
                    let t = TOKENS[r.below(TOKENS.len())];
                    v.splice(i..i, t.iter().copied());
                }
                _ => {
                    let i = r.below(v.len() + 1);
                    v.truncate(i);
                }
            }
        }
        exercise(&mut r, &[v]);
    }
}

#[test]
fn lte_sinr_raw_to_db() {
    // AT+QENG LTE <SINR>: dB = 2X - 20 for raw X in 0..25, else not reported.
    let cases: &[(&[u8], &str)] = &[
        (b"0", "-20"),
        (b"8", "-4"),
        (b"10", "0"),
        (b"12", "4"),
        (b"20", "20"),
        (b"25", "30"),
        (b"05", "-10"),
        (b"00", "-20"),
        (b"22\r", "24"),
        (b"26", ""),
        (b"100", ""),
        (b"-32768", ""),
        (b"-5", ""),
        (b"-", ""),
        (b"", ""),
        (b"\r", ""),
        (b" 22", ""),
        (b"2a", ""),
    ];
    for &(raw, want) in cases {
        assert_eq!(lte_sinr_db(raw), want.as_bytes(), "raw {:?}", raw);
    }
}
