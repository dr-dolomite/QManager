//! The QMI snapshot engine: a sampler thread in the QMI lane that reads the
//! bundle (serving + cell + CA + RF: four requests, about 1.5 ms) and
//! publishes it for the poller and the CGIs, so they get LTE identity, signal
//! and CA at most 2 s old in every poller tier, with no AT and no fork.
//!
//! Two files, written atomically (`<path>.new`, O_EXCL + O_NOFOLLOW, rename),
//! JSON first and env right after it so the env is never older than the JSON
//! it mirrors:
//!
//! - `/var/run/qmanager/qmi.env` (root-only dir, made 0700 and verified before
//!   each write; the poller sources it) follows the sidecar contract of `ping.env` and
//!   `ondemand.env` (`cq_env_source`): every line a single-quoted assignment,
//!   the last line `qm_sidecar_end='1'`, names from the compiled `NAMES` list
//!   (all `qmi_`-prefixed, never the poller's `lte_*` / `t2_*`), every value
//!   an integer or empty, except `qmi_state` (the token `up|down|unavailable`;
//!   the contract allows any single-quoted text, the poller compares it with
//!   `case`). Never a float, never `N/A`.
//! - `/tmp/qmanager_qmi.json`: the same data for CGIs, plus the full bundle.
//!
//! Semantics.
//! - `qmi_mono` is the CLOCK_BOOTTIME second (the same clock as
//!   `/proc/uptime`, which the poller compares it with) of the last read that
//!   succeeded, so a reader sees the data's age, not the sampler's heartbeat
//!   (the file's mtime is that). Empty until the first success.
//! - `qmi_state` is `up` when this cycle's read succeeded, `down` when it
//!   failed (an SSR window, the modem not ready), `unavailable` when QRTR or
//!   the NAS service does not exist. On `down` / `unavailable` the previous
//!   values are kept and republished, `qmi_ssr_count` keeps counting; the
//!   files are never deleted, so a reader never sees a missing file.
//! - `qmi_registered` is `1` / `0` from NAS serving system, empty when
//!   serving could not be read. Signal values (rsrp / rsrq / rssi, whole dBm
//!   or dB) are empty unless registered: the model's registration gate, which
//!   avoids the RSRP-while-searching trap.
//! - CA is the PCC plus up to four SCCs, 5 fields each; the contract is flat
//!   names, so the list is fixed. A fifth SCC is not published.
//!
//! Cadence. Every 2 s, or faster while the live channel (`live.rs`) holds a
//! lease: 1 s for the `watch` tier, 200 ms for `aim` (the 5 Hz floor). Both
//! files are still written on every sample. The sampler re-checks the lease
//! stamps every `min(period, 250 ms)`. (Phase 1's world-writable
//! `/tmp/qmanager_qmi_live` mtime lease is retired; the broker ignores it.)

use crate::common::json::J;
use crate::common::log::Logger;
use crate::common::safefs;
use crate::qmi::error::QmiError;
use crate::qmi::model::{self, Bundle, Registration};
use crate::qmi::registry::{Registry, SvcState, THREAD_STACK};
use crate::qmi::SVC_NAS;
use super::live::{self, Live, LivePaths, Tier};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The sourced sidecar lives in the root-only run dir (a world-writable /tmp
/// path could be planted before the first write and then sourced by the
/// poller). Same dir as ping.env / ondemand.env.
pub const RUN_DIR: &str = "/var/run/qmanager";
pub const ENV_PATH: &str = "/var/run/qmanager/qmi.env";
pub const JSON_PATH: &str = "/tmp/qmanager_qmi.json";

pub struct Paths {
    /// Made root-only (0700, own, not a link) before each env write; None
    /// skips it (tests on a plain temp dir).
    pub run_dir: Option<String>,
    pub env: String,
    pub json: String,
    pub live: LivePaths,
}

impl Paths {
    pub fn production() -> Paths {
        Paths { run_dir: Some(RUN_DIR.into()), env: ENV_PATH.into(), json: JSON_PATH.into(), live: LivePaths::production() }
    }
}

/// Carriers published beyond the PCC.
const SCCS: usize = 4;

/// The compiled allow-list: every name the env file may contain, in file
/// order. `values()` returns one value per name, in this order.
pub const NAMES: &[&str] = &[
    "qmi_mono",
    "qmi_state",
    "qmi_ssr_count",
    "qmi_registered",
    "qmi_lte_pci",
    "qmi_lte_earfcn",
    "qmi_lte_tac",
    "qmi_lte_cell_id",
    "qmi_lte_band",
    "qmi_lte_bw_mhz",
    "qmi_lte_rsrp",
    "qmi_lte_rsrq",
    "qmi_lte_rssi",
    "qmi_ca_count",
    "qmi_pcc_pci",
    "qmi_pcc_earfcn",
    "qmi_pcc_band",
    "qmi_pcc_bw_mhz",
    "qmi_scc1_pci",
    "qmi_scc1_earfcn",
    "qmi_scc1_band",
    "qmi_scc1_bw_mhz",
    "qmi_scc1_active",
    "qmi_scc2_pci",
    "qmi_scc2_earfcn",
    "qmi_scc2_band",
    "qmi_scc2_bw_mhz",
    "qmi_scc2_active",
    "qmi_scc3_pci",
    "qmi_scc3_earfcn",
    "qmi_scc3_band",
    "qmi_scc3_bw_mhz",
    "qmi_scc3_active",
    "qmi_scc4_pci",
    "qmi_scc4_earfcn",
    "qmi_scc4_band",
    "qmi_scc4_bw_mhz",
    "qmi_scc4_active",
];

/// What one publication shows.
pub struct View<'a> {
    /// CLOCK_BOOTTIME seconds of the last successful read.
    pub mono_s: Option<u64>,
    pub state: &'static str,
    pub ssr_count: u64,
    pub bundle: Option<&'a Bundle>,
}

fn num<T: std::fmt::Display>(v: Option<T>) -> String {
    v.map_or(String::new(), |v| v.to_string())
}

/// "B41" -> 41. Only an LTE band label; anything else is empty.
fn band_num(label: Option<&str>) -> Option<u32> {
    label?.strip_prefix('B')?.parse().ok()
}

fn registered(b: &Bundle) -> Option<bool> {
    match b.signal.registration {
        Registration::Registered => Some(true),
        Registration::Unknown => None,
        _ => Some(false),
    }
}

/// One value per `NAMES` entry. Integer text or empty (`qmi_state` aside).
fn values(v: &View) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(NAMES.len());
    out.push(num(v.mono_s));
    out.push(v.state.to_string());
    out.push(v.ssr_count.to_string());
    let b = v.bundle;
    out.push(num(b.and_then(registered).map(|r| r as u8)));

    let lte = b.and_then(|b| b.cell.as_ref()).and_then(|c| c.lte.as_ref());
    out.push(num(lte.map(|l| l.pci)));
    out.push(num(lte.map(|l| l.earfcn)));
    out.push(num(lte.map(|l| l.tac)));
    out.push(num(lte.map(|l| l.cell_id)));
    let (band, bw) = b.map_or((None, None), |b| b.lte_band());
    out.push(num(band_num(band.as_deref())));
    out.push(num(bw));
    // Signal: already None unless registered; the explicit gate is for the
    // day the model changes.
    let sig = b.filter(|b| b.registered()).and_then(|b| b.signal.lte);
    out.push(num(sig.and_then(|s| s.rsrp).map(|r| r.whole())));
    out.push(num(sig.and_then(|s| s.rsrq).map(|r| r.whole())));
    out.push(num(sig.and_then(|s| s.rssi).map(|r| r.whole())));

    let ca = b.and_then(|b| b.ca.as_ref());
    out.push(num(ca.map(|c| c.count())));
    let pcc = ca.and_then(|c| c.pcc());
    out.push(num(pcc.map(|c| c.pci)));
    out.push(num(pcc.map(|c| c.earfcn)));
    out.push(num(pcc.and_then(|c| band_num(c.band.as_deref()))));
    out.push(num(pcc.and_then(|c| c.bandwidth_mhz)));
    let sccs: Vec<_> = ca.map_or(Vec::new(), |c| c.carriers.iter().filter(|c| c.kind == "SCC").collect());
    for i in 0..SCCS {
        let s = sccs.get(i);
        out.push(num(s.map(|c| c.pci)));
        out.push(num(s.map(|c| c.earfcn)));
        out.push(num(s.and_then(|c| band_num(c.band.as_deref()))));
        out.push(num(s.and_then(|c| c.bandwidth_mhz)));
        out.push(num(s.map(|c| c.active as u8)));
    }
    debug_assert_eq!(out.len(), NAMES.len());
    out
}

/// The env file: `name='value'` per line, then the terminator.
pub fn render_env(v: &View) -> String {
    let mut s = String::with_capacity(1024);
    for (name, val) in NAMES.iter().zip(values(v)) {
        // Values are digits, a minus sign or the state token: nothing a
        // single-quoted shell string needs escaping for.
        s.push_str(name);
        s.push_str("='");
        s.push_str(&val);
        s.push_str("'\n");
    }
    s.push_str("qm_sidecar_end='1'\n");
    s
}

/// The JSON file: the freshness fields and the full bundle.
pub fn render_json(v: &View) -> String {
    let mut j = J::obj();
    j.num("v", 1)
        .opt_num("qmi_mono", v.mono_s)
        .str("qmi_state", v.state)
        .num("qmi_ssr_count", v.ssr_count)
        .opt_bool("registered", v.bundle.and_then(registered));
    match v.bundle {
        Some(b) => j.raw("data", &b.json()),
        None => j.null("data"),
    };
    let mut s = j.done();
    s.push('\n');
    s
}

/// CLOCK_BOOTTIME seconds: `/proc/uptime`'s clock.
pub fn boot_secs() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut ts) };
    ts.tv_sec as u64
}

/// Holds what the last good read said, and publishes after every read.
pub struct Sampler {
    paths: Paths,
    last: Option<Bundle>,
    last_mono: Option<u64>,
    write_failed: bool,
    log: Arc<Logger>,
    live: Live,
}

impl Sampler {
    pub fn new(mut paths: Paths, log: Arc<Logger>) -> Sampler {
        let lp = std::mem::replace(&mut paths.live, LivePaths::production());
        let live = Live::new(lp, log.clone());
        Sampler { paths, last: None, last_mono: None, write_failed: false, log, live }
    }

    /// One read and one publication, at the tier the stamps say now.
    pub fn sample(&mut self, reg: &Registry) {
        let tier = self.live.tier(boot_secs());
        self.sample_at(reg, tier);
    }

    /// One read and one publication. Never fails: a failed read republishes
    /// the last values with a `down` / `unavailable` state.
    pub fn sample_at(&mut self, reg: &Registry, tier: Tier) {
        let fetch = |svc: u32, id: u16| reg.request(svc, id, &[]);
        let mut fresh = false;
        let state = match model::bundle(&fetch) {
            Ok(b) => {
                self.last = Some(b);
                self.last_mono = Some(boot_secs());
                fresh = true;
                "up"
            }
            Err(QmiError::Unavailable) => "unavailable",
            // NAS gone for good looks the same as a reset until its state says so.
            Err(_) if reg.state(SVC_NAS) == Some(SvcState::Unavailable) => "unavailable",
            Err(_) => "down",
        };
        let v = View { mono_s: self.last_mono, state, ssr_count: reg.ssr_count(), bundle: self.last.as_ref() };
        let json = render_json(&v);
        let env = render_env(&v);
        // JSON first, then env, each on its own: a path planted in /tmp can
        // cost the CGI json, never the poller's root-only sidecar.
        let rj = safefs::write_atomic(&self.paths.json, json.as_bytes());
        let re = match &self.paths.run_dir {
            Some(d) => safefs::ensure_own_dir(d, 0o700),
            None => Ok(()),
        }
        .and_then(|_| safefs::write_atomic(&self.paths.env, env.as_bytes()));
        let r = match (rj, re) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(e), Ok(())) => Err(format!("{}: {e}", self.paths.json)),
            (Ok(()), Err(e)) => Err(format!("{}: {e}", self.paths.env)),
            (Err(a), Err(b)) => Err(format!("{}: {a}; {}: {b}", self.paths.json, self.paths.env)),
        };
        match (r, self.write_failed) {
            (Err(e), false) => {
                self.log.warn(&format!("cannot publish the qmi snapshot: {e}"));
                self.write_failed = true;
            }
            (Ok(()), true) => {
                self.log.info("qmi snapshot publishing again");
                self.write_failed = false;
            }
            _ => {}
        }
        let fresh_bundle = if fresh { self.last.as_ref() } else { None };
        self.live.on_sample(tier, state, reg.ssr_count(), fresh_bundle);
    }
}

/// Starts the sampler thread (128 KiB stack).
pub fn spawn(reg: Arc<Registry>, paths: Paths, log: Arc<Logger>) -> std::io::Result<()> {
    std::thread::Builder::new().name("qmi-sampler".into()).stack_size(THREAD_STACK).spawn(move || run(&reg, paths, log))?;
    Ok(())
}

fn run(reg: &Registry, paths: Paths, log: Arc<Logger>) {
    let mut s = Sampler::new(paths, log);
    s.live.start();
    // None: sample at once. (Not `now - period`: Instant subtraction panics
    // if the host has been up for less than the period.)
    let mut last: Option<Instant> = None;
    loop {
        let now_s = boot_secs();
        let tier = s.live.tier(now_s);
        s.live.tick(tier, now_s);
        let period = live::period_for(tier);
        let now = Instant::now();
        let due = last.map_or(now, |l| l + period);
        if now >= due {
            s.sample_at(reg, tier);
            last = Some(Instant::now());
            continue;
        }
        std::thread::sleep((due - now).min(live::slice_for(period)).max(Duration::from_millis(5)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::fx;
    use crate::qmi::fake::{r1_net, start_registry};
    use crate::qmi::model::Inputs;
    use std::path::PathBuf;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("qatd-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn paths(d: &std::path::Path) -> Paths {
        let p = |n: &str| d.join(n).to_str().unwrap().to_string();
        let live = LivePaths {
            run_dir: None,
            aim: p("aim"),
            watch: p("watch"),
            token: p("token"),
            lock: p("lock"),
            public_dir: p("pub"),
            long_flag: p("long"),
        };
        Paths { run_dir: None, env: p("q.env"), json: p("q.json"), live }
    }

    fn log() -> Arc<Logger> {
        Arc::new(Logger::new("test"))
    }

    fn bundle(serving: &str) -> Bundle {
        let s = match serving {
            "registered" => fx!("r1_3_0x0024"),
            _ => fx!("serving_searching"),
        };
        Bundle::build(&Inputs {
            serving: Some(&s),
            cell: Some(&fx!("r1_3_0x0043")),
            ca: Some(&fx!("ca_0x15_two_scells")),
            rf: Some(&fx!("r1_3_0x0031")),
            sig_info: None,
        })
    }

    /// The env as `(name, value)` pairs, parsed the way the shell would.
    fn pairs(env: &str) -> Vec<(String, String)> {
        env.lines()
            .map(|l| {
                let (n, v) = l.split_once('=').unwrap();
                (n.to_string(), v.strip_prefix('\'').unwrap().strip_suffix('\'').unwrap().to_string())
            })
            .collect()
    }

    fn get<'a>(p: &'a [(String, String)], name: &str) -> &'a str {
        &p.iter().find(|(n, _)| n == name).unwrap().1
    }

    /// Everything the sidecar contract demands, line by line: the shell
    /// validator's pattern (`[A-Za-z_]*=\'*\'`), the terminator, our allow-list
    /// and the value alphabet. Returns the first violation.
    fn violation(env: &str) -> Option<String> {
        let lines: Vec<&str> = env.lines().collect();
        if !env.ends_with('\n') {
            return Some("no trailing newline".into());
        }
        if lines.last() != Some(&"qm_sidecar_end='1'") {
            return Some("terminator is not the last line".into());
        }
        for l in &lines {
            // [A-Za-z_]*=\'*\' : starts with a letter or _, has =', ends with '.
            let first = l.chars().next().unwrap_or(' ');
            if !(first.is_ascii_alphabetic() || first == '_') || !l.contains("='") || !l.ends_with('\'') {
                return Some(format!("shell pattern: {l}"));
            }
        }
        let body = &lines[..lines.len() - 1];
        if body.len() != NAMES.len() {
            return Some(format!("{} lines, {} names", body.len(), NAMES.len()));
        }
        for (l, name) in body.iter().zip(NAMES) {
            let (n, v) = l.split_once('=').unwrap();
            if n != *name || !n.starts_with("qmi_") {
                return Some(format!("name: {l}"));
            }
            let v = &v[1..v.len() - 1];
            let ok = if n == "qmi_state" {
                matches!(v, "up" | "down" | "unavailable")
            } else {
                v.is_empty() || (v.trim_start_matches('-').bytes().all(|b| b.is_ascii_digit()) && v != "-" && !v.starts_with("--"))
            };
            if !ok {
                return Some(format!("value: {l}"));
            }
            if v.contains('\'') || v.contains('.') || v.contains("N/A") || v.contains("NaN") || v.contains("null") {
                return Some(format!("float or sentinel: {l}"));
            }
        }
        None
    }

    #[test]
    fn names_are_unique_prefixed_and_never_the_pollers_own() {
        let mut seen = std::collections::HashSet::new();
        for n in NAMES {
            assert!(n.starts_with("qmi_"), "{n}");
            assert!(seen.insert(*n), "dup {n}");
            assert!(n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'), "{n}");
        }
        assert!(!NAMES.iter().any(|n| n.starts_with("lte_") || n.starts_with("t2_") || n.starts_with("nr_")));
        assert!(!NAMES.contains(&"qm_sidecar_end"));
    }

    #[test]
    fn a_registered_lte_bundle_fills_every_identity_and_signal_name() {
        let b = bundle("registered");
        let env = render_env(&View { mono_s: Some(4242), state: "up", ssr_count: 3, bundle: Some(&b) });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!(get(&p, "qmi_mono"), "4242");
        assert_eq!(get(&p, "qmi_state"), "up");
        assert_eq!(get(&p, "qmi_ssr_count"), "3");
        assert_eq!(get(&p, "qmi_registered"), "1");
        // r1 capture: PCI 295, EARFCN 150 (B1, 20 MHz), synthetic TAC / ECI.
        assert_eq!(get(&p, "qmi_lte_pci"), "295");
        assert_eq!(get(&p, "qmi_lte_earfcn"), "150");
        assert_eq!(get(&p, "qmi_lte_tac"), "4660");
        assert_eq!(get(&p, "qmi_lte_cell_id"), "19088641");
        assert_eq!(get(&p, "qmi_lte_band"), "1");
        assert_eq!(get(&p, "qmi_lte_bw_mhz"), "20");
        assert_eq!(get(&p, "qmi_lte_rsrp"), "-90");
        assert_eq!(get(&p, "qmi_lte_rsrq"), "-7");
        assert_eq!(get(&p, "qmi_lte_rssi"), "-63");
        // The two-SCell capture: B3 PCC, SCC B1 (inactive) and SCC B41.
        assert_eq!(get(&p, "qmi_ca_count"), "3");
        assert_eq!((get(&p, "qmi_pcc_band"), get(&p, "qmi_pcc_bw_mhz")), ("3", "15"));
        assert_eq!((get(&p, "qmi_scc1_band"), get(&p, "qmi_scc1_bw_mhz"), get(&p, "qmi_scc1_active")), ("1", "20", "0"));
        assert_eq!((get(&p, "qmi_scc2_band"), get(&p, "qmi_scc2_bw_mhz")), ("41", "15"));
        // Carriers beyond the carriers present stay empty.
        for n in ["qmi_scc3_pci", "qmi_scc3_active", "qmi_scc4_earfcn", "qmi_scc4_band"] {
            assert_eq!(get(&p, n), "", "{n}");
        }
    }

    #[test]
    fn not_registered_keeps_identity_but_empties_the_signal() {
        let b = bundle("searching");
        let env = render_env(&View { mono_s: Some(10), state: "up", ssr_count: 0, bundle: Some(&b) });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!(get(&p, "qmi_registered"), "0");
        for n in ["qmi_lte_rsrp", "qmi_lte_rsrq", "qmi_lte_rssi"] {
            assert_eq!(get(&p, n), "", "{n} must be empty while not registered");
        }
        assert_eq!(get(&p, "qmi_lte_pci"), "295", "identity is not gated");
        // Serving unreadable: registration unknown -> empty, signal empty.
        let b = Bundle::build(&Inputs { cell: Some(&fx!("r1_3_0x0043")), ..Inputs::default() });
        let env = render_env(&View { mono_s: Some(10), state: "up", ssr_count: 0, bundle: Some(&b) });
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!((get(&p, "qmi_registered"), get(&p, "qmi_lte_rsrp")), ("", ""));
    }

    #[test]
    fn nothing_read_yet_is_all_empty_but_state_and_counters() {
        let env = render_env(&View { mono_s: None, state: "unavailable", ssr_count: 0, bundle: None });
        assert_eq!(violation(&env), None, "{env}");
        let p = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        for (n, v) in &p {
            match n.as_str() {
                "qmi_state" => assert_eq!(v, "unavailable"),
                "qmi_ssr_count" => assert_eq!(v, "0"),
                _ => assert_eq!(v, "", "{n}"),
            }
        }
        let j = render_json(&View { mono_s: None, state: "unavailable", ssr_count: 0, bundle: None });
        assert_eq!(j, "{\"v\":1,\"qmi_mono\":null,\"qmi_state\":\"unavailable\",\"qmi_ssr_count\":0,\"registered\":null,\"data\":null}\n");
    }

    #[test]
    fn the_json_carries_the_freshness_fields_and_the_bundle() {
        let b = bundle("registered");
        let j = render_json(&View { mono_s: Some(7), state: "down", ssr_count: 2, bundle: Some(&b) });
        assert!(j.starts_with("{\"v\":1,\"qmi_mono\":7,\"qmi_state\":\"down\",\"qmi_ssr_count\":2,\"registered\":true,\"data\":{\"serving\":{"), "{j}");
        assert!(j.ends_with("}}\n") && j.matches('\n').count() == 1, "{j}");
        assert!(j.contains("\"rsrp\":{\"value\":-90"), "{j}");
    }

    #[test]
    fn no_value_is_ever_a_float_even_for_odd_input() {
        // Fuzz the model with truncated/mangled captures: every render must
        // still satisfy the contract.
        for base in crate::qmi::codec::testfix::all() {
            for m in crate::qmi::codec::testfix::mangled(&base) {
                let b = Bundle::build(&Inputs { serving: Some(&m), cell: Some(&m), ca: Some(&m), rf: Some(&m), sig_info: Some(&m) });
                let env = render_env(&View { mono_s: Some(1), state: "up", ssr_count: 0, bundle: Some(&b) });
                assert_eq!(violation(&env), None, "{env}");
            }
        }
    }

    #[test]
    fn the_real_shell_validator_accepts_the_files_and_rejects_a_damaged_one() {
        // Runs conn_state.sh's `cq_env_source` (the loop the poller uses for
        // ping.env, copied verbatim into qmi_load later) under the host `sh`.
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/usr/lib/qmanager/conn_state.sh");
        if !script.exists() || std::process::Command::new("sh").arg("-c").arg("true").status().is_err() {
            eprintln!("skipped: no sh or no conn_state.sh");
            return;
        }
        let d = dir("shell");
        let run = |file: &std::path::Path| {
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(r#". "$1" || exit 9; if cq_env_source "$2"; then echo "SOURCED mono=$qmi_mono state=$qmi_state reg=$qmi_registered pci=$qmi_lte_pci rsrp=$qmi_lte_rsrp ca=$qmi_ca_count scc2=$qmi_scc2_band end=$qm_sidecar_end"; else echo REJECTED; fi"#)
                .arg("sh")
                .arg(&script)
                .arg(file)
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let b = bundle("registered");
        let good = d.join("good.env");
        std::fs::write(&good, render_env(&View { mono_s: Some(99), state: "up", ssr_count: 1, bundle: Some(&b) })).unwrap();
        assert_eq!(run(&good), "SOURCED mono=99 state=up reg=1 pci=295 rsrp=-90 ca=3 scc2=41 end=1");
        // Empty values source as empty strings.
        let empty = d.join("empty.env");
        std::fs::write(&empty, render_env(&View { mono_s: None, state: "down", ssr_count: 4, bundle: None })).unwrap();
        assert_eq!(run(&empty), "SOURCED mono= state=down reg= pci= rsrp= ca= scc2= end=1");
        // A file cut short (no terminator) or with a stray line is rejected.
        let full = render_env(&View { mono_s: Some(1), state: "up", ssr_count: 0, bundle: Some(&b) });
        let cut = d.join("cut.env");
        std::fs::write(&cut, &full[..full.len() - "qm_sidecar_end='1'\n".len()]).unwrap();
        assert_eq!(run(&cut), "REJECTED");
        let stray = d.join("stray.env");
        std::fs::write(&stray, full.replace("qmi_mono='1'\n", "qmi_mono=1\n")).unwrap();
        assert_eq!(run(&stray), "REJECTED");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_sample_publishes_both_files_atomically_and_leaves_no_temp() {
        let d = dir("pub");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        let net = r1_net();
        let reg = start_registry(&net);
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None, "{env}");
        let pr = pairs(&env[..env.len() - "qm_sidecar_end='1'\n".len()]);
        assert_eq!((get(&pr, "qmi_state"), get(&pr, "qmi_registered"), get(&pr, "qmi_lte_pci")), ("up", "1", "295"));
        let mono: u64 = get(&pr, "qmi_mono").parse().unwrap();
        assert!(mono.abs_diff(boot_secs()) <= 2, "{mono} vs {}", boot_secs());
        let json = std::fs::read_to_string(&json_p).unwrap();
        assert!(json.contains("\"qmi_state\":\"up\"") && json.contains("\"pci\":295"), "{json}");
        // The env is never older than the JSON it mirrors.
        let (je, ee) = (std::fs::metadata(&json_p).unwrap().modified().unwrap(), std::fs::metadata(&env_p).unwrap().modified().unwrap());
        assert!(ee >= je);
        // Republishing replaces whole files; no .new is left behind.
        s.sample(&reg);
        let names: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        assert!(names.iter().all(|n| !n.ends_with(".new")), "{names:?}");
        assert_eq!(names.len(), 2, "{names:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_ssr_keeps_the_last_values_marks_down_and_counts_it() {
        let d = dir("ssr");
        let p = paths(&d);
        let env_p = p.env.clone();
        let net = r1_net();
        let reg = start_registry(&net);
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let before = std::fs::read_to_string(&env_p).unwrap();
        let mono_before = get(&pairs(&before[..before.len() - 19]), "qmi_mono").to_string();
        // The baseband resets: every service leaves the name server.
        for (svc, _) in reg.states() {
            net.del_server(svc);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st == SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample(&reg);
        let after = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&after), None, "{after}");
        let pr = pairs(&after[..after.len() - 19]);
        assert_eq!(get(&pr, "qmi_state"), "down");
        assert_eq!(get(&pr, "qmi_ssr_count"), "1");
        // Last values kept, and the data's age is still the last good read's.
        assert_eq!((get(&pr, "qmi_lte_pci"), get(&pr, "qmi_lte_rsrp"), get(&pr, "qmi_registered")), ("295", "-90", "1"));
        assert_eq!(get(&pr, "qmi_mono"), mono_before);
        assert!(std::fs::read_to_string(&paths(&d).json).unwrap().contains("\"qmi_state\":\"down\""));
        // And they recover on the next successful read.
        for (i, svc) in crate::qmi::SERVICES.iter().enumerate() {
            net.add_server(*svc, 0, 0x90 + i as u32);
        }
        let end = Instant::now() + Duration::from_secs(2);
        while reg.states().iter().any(|(_, st)| *st != SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        s.sample(&reg);
        let again = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(get(&pairs(&again[..again.len() - 19]), "qmi_state"), "up");
        assert_eq!(get(&pairs(&again[..again.len() - 19]), "qmi_ssr_count"), "1");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn without_qrtr_the_files_exist_and_say_unavailable() {
        let d = dir("noqrtr");
        let p = paths(&d);
        let env_p = p.env.clone();
        let net = crate::qmi::fake::FakeNet::new();
        net.set_fail_open(true);
        let reg = start_registry(&net);
        Sampler::new(p, log()).sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None);
        assert_eq!(get(&pairs(&env[..env.len() - 19]), "qmi_state"), "unavailable");
        assert!(std::path::Path::new(&paths(&d).json).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_env_goes_into_a_root_only_dir_that_is_made_trustworthy() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("rundir");
        let run = d.join("run");
        // A planted symlink where the dir should be must not receive the file.
        let victim = d.join("victim");
        std::fs::create_dir(&victim).unwrap();
        std::os::unix::fs::symlink(&victim, &run).unwrap();
        let mut p = paths(&d);
        p.run_dir = Some(run.to_str().unwrap().to_string());
        p.env = run.join("qmi.env").to_str().unwrap().to_string();
        let env_p = p.env.clone();
        let reg = start_registry(&r1_net());
        Sampler::new(p, log()).sample(&reg);
        assert!(std::fs::read_to_string(&env_p).unwrap().ends_with("qm_sidecar_end='1'\n"));
        assert_eq!(std::fs::metadata(&run).unwrap().permissions().mode() & 0o777, 0o700);
        assert!(std::fs::read_dir(&victim).unwrap().next().is_none(), "nothing written through the link");
        assert_eq!(ENV_PATH, "/var/run/qmanager/qmi.env");
        assert!(Paths::production().json.starts_with("/tmp/"));
        assert_eq!(Paths::production().live.public_dir, "/var/run/qmanager/live");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_dir_planted_at_the_json_path_never_blocks_the_env() {
        let d = dir("planted");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        // Planted at both the JSON target and its temp name.
        std::fs::create_dir_all(format!("{json_p}/x")).unwrap();
        std::fs::create_dir_all(format!("{json_p}.new/y")).unwrap();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        let env = std::fs::read_to_string(&env_p).unwrap();
        assert_eq!(violation(&env), None, "{env}");
        assert_eq!(get(&pairs(&env[..env.len() - 19]), "qmi_state"), "up");
        assert!(s.write_failed, "the json failure is still reported");
        assert!(std::fs::symlink_metadata(&json_p).unwrap().is_dir(), "the planted target is left alone");
        assert!(!std::path::Path::new(&format!("{json_p}.new")).exists(), "the planted temp dir is cleared");
        // Once the target is free again, both files publish.
        std::fs::remove_dir_all(&json_p).unwrap();
        s.sample(&reg);
        assert!(!s.write_failed);
        assert!(std::fs::read_to_string(&json_p).unwrap().contains("\"qmi_state\":\"up\""));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_unwritable_target_is_survived() {
        let d = dir("ro");
        let mut p = paths(&d);
        p.env = d.join("no/such/dir/q.env").to_str().unwrap().to_string();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.sample(&reg);
        assert!(s.write_failed);
        s.sample(&reg);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_env_contract_is_unchanged_38_names_in_order() {
        assert_eq!(NAMES.len(), 38);
        let mut want: Vec<String> = ["qmi_mono", "qmi_state", "qmi_ssr_count", "qmi_registered"].iter().map(|s| s.to_string()).collect();
        for f in ["pci", "earfcn", "tac", "cell_id", "band", "bw_mhz", "rsrp", "rsrq", "rssi"] {
            want.push(format!("qmi_lte_{f}"));
        }
        want.push("qmi_ca_count".into());
        for f in ["pci", "earfcn", "band", "bw_mhz"] {
            want.push(format!("qmi_pcc_{f}"));
        }
        for i in 1..=4 {
            for f in ["pci", "earfcn", "band", "bw_mhz", "active"] {
                want.push(format!("qmi_scc{i}_{f}"));
            }
        }
        assert_eq!(NAMES, want.iter().map(|s| s.as_str()).collect::<Vec<_>>().as_slice());
    }

    #[test]
    fn a_leased_sample_publishes_the_live_file_beside_both_sidecars() {
        let d = dir("leased");
        let p = paths(&d);
        let (env_p, json_p) = (p.env.clone(), p.json.clone());
        let tok = "ab".repeat(32);
        std::fs::write(d.join("token"), format!("{tok}\n")).unwrap();
        std::fs::write(d.join("aim"), format!("{}\n", boot_secs())).unwrap();
        let reg = start_registry(&r1_net());
        let mut s = Sampler::new(p, log());
        s.live.start();
        s.sample(&reg);
        assert_eq!(violation(&std::fs::read_to_string(&env_p).unwrap()), None);
        assert!(std::fs::read_to_string(&json_p).unwrap().contains("\"qmi_state\":\"up\""));
        let f = std::fs::read_to_string(d.join("pub").join(format!("{tok}.json"))).unwrap();
        assert!(f.contains("\"period_ms\":200,\"qmi_state\":\"up\"") && f.contains("\"pci\":295"), "{f}");
        assert_eq!(std::fs::read(d.join("pub").join("index.html")).unwrap(), b"");
        // The retired Phase 1 lease file means nothing any more.
        std::fs::remove_file(d.join("aim")).unwrap();
        std::fs::write(d.join("q_live"), b"").unwrap();
        assert_eq!(s.live.tier(boot_secs()), Tier::None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_sampler_thread_follows_the_tiers_and_expires_the_lease() {
        let d = dir("run");
        let p = paths(&d);
        let json_p = p.json.clone();
        let tok = "cd".repeat(32);
        let reg = start_registry(&r1_net());
        let r2 = reg.clone();
        std::thread::spawn(move || run(&r2, p, log()));
        let mtime = || std::fs::metadata(&json_p).and_then(|m| m.modified()).ok();
        // Distinct publications seen while polling for `ms`.
        let changes = |ms: u64| {
            let end = Instant::now() + Duration::from_millis(ms);
            let mut last = mtime();
            let mut n = 0;
            while Instant::now() < end {
                let m = mtime();
                if m != last {
                    n += 1;
                    last = m;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            n
        };
        // Idle: the first sample is immediate, the next is 2 s later.
        std::thread::sleep(Duration::from_millis(600));
        assert!(mtime().is_some(), "the first sample is not delayed");
        assert_eq!(changes(1000), 0, "idle period is 2 s");
        // watch: about 1 Hz.
        let stamp = |t: &str| std::fs::write(d.join(t), format!("{}\n", boot_secs())).unwrap();
        std::fs::write(d.join("token"), &tok).unwrap();
        stamp("watch");
        let pubf = d.join("pub").join(format!("{tok}.json"));
        let t0 = Instant::now();
        while !pubf.exists() && t0.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(t0.elapsed() < Duration::from_millis(300), "lease to file took {:?}", t0.elapsed());
        let n = changes(2100);
        assert!((1..=3).contains(&n), "watch gave {n} publications in 2.1 s");
        // aim beats watch: about 5 Hz, never faster.
        stamp("watch");
        stamp("aim");
        let n = changes(1600);
        assert!(n >= 6, "aim gave {n} publications in 1.6 s");
        assert!(n <= 9, "aim must stay at or under 5 Hz, got {n} in 1.6 s");
        // Lease gone: expiry removes the token and the file within a slice.
        std::fs::remove_file(d.join("aim")).unwrap();
        std::fs::remove_file(d.join("watch")).unwrap();
        let t0 = Instant::now();
        while (pubf.exists() || d.join("token").exists()) && t0.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!pubf.exists() && !d.join("token").exists(), "expired within {:?}", t0.elapsed());
        assert!(d.join("pub").join("index.html").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
