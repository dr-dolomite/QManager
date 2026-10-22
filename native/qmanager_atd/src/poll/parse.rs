//! Poll-step parsers (B5.29 Phase D): the Rust port of the poller's AT reply
//! handling, bug-for-bug with `parse_at.sh` and the poller's inline blocks.
//!
//! Input of every step is what the shell sees: the bytes `qcmd '<cmd>'`
//! printed in raw mode, captured with `$(...)` (NUL bytes dropped, trailing
//! newlines stripped), plus qcmd's exit code. Output is a set of shell globals
//! (see `Var`), applied over the poller's current state.
//!
//! Shell definitions replicated (do not "fix" anything here; quirks are pinned
//! by `tools/poller-parity/QUIRKS.md` and the fixture corpus):
//! - `qeng`  : `qcmd_exec_g` strip + rc, then `parse_serving_cell`; the
//!   failure branch of `poll_serving_cell` (lte/nr state unknown, errors).
//! - `ca`    : `qcmd_exec_g`, `parse_ca_info` on rc 0 and non-empty, else the
//!   reset block of `poll_cycle`.
//! - `cfun`  : the inline CFUN block of `poll_cycle`.
//! - `sig`   : `parse_qrsrp` / `parse_qrsrq` / `parse_qsinr` when non-empty.
//! - `ident` : `poll_tier2` after its tier gate (COPS, QUIMSLOT, CNUM, CPIN).
//! - `simid` : `refresh_sim_identity`.
//!
//! Everything here is panic-free on arbitrary bytes.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

pub mod ca;

use crate::poll::envout::PollMeta;

/// The closed step table (design 5.1). Read-only queries only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Qeng,
    Ca,
    Cfun,
    Sig,
    Ident,
    Simid,
}

impl Step {
    pub const ALL: [Step; 6] = [
        Step::Qeng,
        Step::Ca,
        Step::Cfun,
        Step::Sig,
        Step::Ident,
        Step::Simid,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Step::Qeng => "qeng",
            Step::Ca => "ca",
            Step::Cfun => "cfun",
            Step::Sig => "sig",
            Step::Ident => "ident",
            Step::Simid => "simid",
        }
    }

    pub fn from_name(s: &str) -> Option<Step> {
        Step::ALL.iter().copied().find(|st| st.name() == s)
    }

    /// The exact AT string the poller sends for this step.
    pub fn at_command(self) -> &'static str {
        match self {
            Step::Qeng => "AT+QENG=\"servingcell\"",
            Step::Ca => "AT+QCAINFO",
            Step::Cfun => "AT+CFUN?",
            Step::Sig => "AT+QRSRP;+QRSRQ;+QSINR",
            Step::Ident => "AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?",
            Step::Simid => "AT+CIMI;+QCCID",
        }
    }
}

/// Outcome of one step in a POLL batch (design 5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepStatus {
    Ok,
    Timeout,
    NotReady,
    Failed,
    Skipped,
}

impl StepStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            StepStatus::Ok => "ok",
            StepStatus::Timeout => "timeout",
            StepStatus::NotReady => "not_ready",
            StepStatus::Failed => "failed",
            StepStatus::Skipped => "skipped",
        }
    }
}

/// Every shell global a step can set. The env writer can emit nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Var {
    LteState,
    LteBand,
    LteEarfcn,
    LteBandwidth,
    LtePci,
    LteRsrp,
    LteRsrq,
    LteSinr,
    LteRssi,
    LteCellId,
    LteEnodebId,
    LteSectorId,
    LteTac,
    NrState,
    NrBand,
    NrArfcn,
    NrCellId,
    NrEnodebId,
    NrSectorId,
    NrTac,
    NrPci,
    NrRsrp,
    NrRsrq,
    NrSinr,
    NrScs,
    T1Cfun,
    T2Carrier,
    T2SimStatus,
    T2SimSlot,
    T2CaActive,
    T2CaCount,
    T2NrCaActive,
    T2NrCaCount,
    T2TotalBandwidthMhz,
    T2BandwidthDetails,
    T2CarrierComponents,
    SigLteRsrp,
    SigLteRsrq,
    SigLteSinr,
    SigNrRsrp,
    SigNrRsrq,
    SigNrSinr,
    NetworkType,
    ServiceStatus,
    BootPhoneNumber,
    BootImsi,
    BootIccid,
    Errors,
}

/// How the `<name>_j` companion is rendered (envout).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Free text: `_j` is a JSON string (after the composer's `${x:-default}`).
    Str(&'static str),
    /// `--argjson "${x:-default}"`: `_j` is jq's rendering of a strict JSON
    /// number, the default when empty, or '' (not provably valid: fall back).
    Num(&'static str),
    /// A JSON array of numbers/null: `_j` re-rendered like jq, or ''.
    NumArray,
    /// The CA components array: `_j` is the jq-escaped twin, or ''.
    Components,
    /// Always a bare JSON literal already (true/false, digits): no `_j`.
    Plain,
}

pub const VAR_COUNT: usize = 48;

impl Var {
    pub const ALL: [Var; VAR_COUNT] = [
        Var::LteState,
        Var::LteBand,
        Var::LteEarfcn,
        Var::LteBandwidth,
        Var::LtePci,
        Var::LteRsrp,
        Var::LteRsrq,
        Var::LteSinr,
        Var::LteRssi,
        Var::LteCellId,
        Var::LteEnodebId,
        Var::LteSectorId,
        Var::LteTac,
        Var::NrState,
        Var::NrBand,
        Var::NrArfcn,
        Var::NrCellId,
        Var::NrEnodebId,
        Var::NrSectorId,
        Var::NrTac,
        Var::NrPci,
        Var::NrRsrp,
        Var::NrRsrq,
        Var::NrSinr,
        Var::NrScs,
        Var::T1Cfun,
        Var::T2Carrier,
        Var::T2SimStatus,
        Var::T2SimSlot,
        Var::T2CaActive,
        Var::T2CaCount,
        Var::T2NrCaActive,
        Var::T2NrCaCount,
        Var::T2TotalBandwidthMhz,
        Var::T2BandwidthDetails,
        Var::T2CarrierComponents,
        Var::SigLteRsrp,
        Var::SigLteRsrq,
        Var::SigLteSinr,
        Var::SigNrRsrp,
        Var::SigNrRsrq,
        Var::SigNrSinr,
        Var::NetworkType,
        Var::ServiceStatus,
        Var::BootPhoneNumber,
        Var::BootImsi,
        Var::BootIccid,
        Var::Errors,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Var::LteState => "lte_state",
            Var::LteBand => "lte_band",
            Var::LteEarfcn => "lte_earfcn",
            Var::LteBandwidth => "lte_bandwidth",
            Var::LtePci => "lte_pci",
            Var::LteRsrp => "lte_rsrp",
            Var::LteRsrq => "lte_rsrq",
            Var::LteSinr => "lte_sinr",
            Var::LteRssi => "lte_rssi",
            Var::LteCellId => "lte_cell_id",
            Var::LteEnodebId => "lte_enodeb_id",
            Var::LteSectorId => "lte_sector_id",
            Var::LteTac => "lte_tac",
            Var::NrState => "nr_state",
            Var::NrBand => "nr_band",
            Var::NrArfcn => "nr_arfcn",
            Var::NrCellId => "nr_cell_id",
            Var::NrEnodebId => "nr_enodeb_id",
            Var::NrSectorId => "nr_sector_id",
            Var::NrTac => "nr_tac",
            Var::NrPci => "nr_pci",
            Var::NrRsrp => "nr_rsrp",
            Var::NrRsrq => "nr_rsrq",
            Var::NrSinr => "nr_sinr",
            Var::NrScs => "nr_scs",
            Var::T1Cfun => "t1_cfun",
            Var::T2Carrier => "t2_carrier",
            Var::T2SimStatus => "t2_sim_status",
            Var::T2SimSlot => "t2_sim_slot",
            Var::T2CaActive => "t2_ca_active",
            Var::T2CaCount => "t2_ca_count",
            Var::T2NrCaActive => "t2_nr_ca_active",
            Var::T2NrCaCount => "t2_nr_ca_count",
            Var::T2TotalBandwidthMhz => "t2_total_bandwidth_mhz",
            Var::T2BandwidthDetails => "t2_bandwidth_details",
            Var::T2CarrierComponents => "t2_carrier_components",
            Var::SigLteRsrp => "sig_lte_rsrp",
            Var::SigLteRsrq => "sig_lte_rsrq",
            Var::SigLteSinr => "sig_lte_sinr",
            Var::SigNrRsrp => "sig_nr_rsrp",
            Var::SigNrRsrq => "sig_nr_rsrq",
            Var::SigNrSinr => "sig_nr_sinr",
            Var::NetworkType => "network_type",
            Var::ServiceStatus => "service_status",
            Var::BootPhoneNumber => "boot_phone_number",
            Var::BootImsi => "boot_imsi",
            Var::BootIccid => "boot_iccid",
            Var::Errors => "errors",
        }
    }

    /// `_j` rendering, following write_cache's `--arg` / `--argjson` and its
    /// `${x:-default}` for each name.
    pub fn kind(self) -> Kind {
        match self {
            Var::NetworkType => Kind::Str("LTE"),
            Var::LteState
            | Var::LteBand
            | Var::NrState
            | Var::NrBand
            | Var::T2Carrier
            | Var::T2SimStatus
            | Var::T2BandwidthDetails
            | Var::ServiceStatus
            | Var::BootPhoneNumber
            | Var::BootImsi
            | Var::BootIccid
            | Var::Errors => Kind::Str(""),
            Var::T1Cfun | Var::T2SimSlot => Kind::Num("1"),
            Var::LteEarfcn
            | Var::LteBandwidth
            | Var::LtePci
            | Var::LteRsrp
            | Var::LteRsrq
            | Var::LteSinr
            | Var::LteRssi
            | Var::LteCellId
            | Var::LteEnodebId
            | Var::LteSectorId
            | Var::LteTac
            | Var::NrArfcn
            | Var::NrCellId
            | Var::NrEnodebId
            | Var::NrSectorId
            | Var::NrTac
            | Var::NrPci
            | Var::NrRsrp
            | Var::NrRsrq
            | Var::NrSinr
            | Var::NrScs => Kind::Num("null"),
            Var::SigLteRsrp
            | Var::SigLteRsrq
            | Var::SigLteSinr
            | Var::SigNrRsrp
            | Var::SigNrRsrq
            | Var::SigNrSinr => Kind::NumArray,
            Var::T2CarrierComponents => Kind::Components,
            Var::T2CaActive
            | Var::T2CaCount
            | Var::T2NrCaActive
            | Var::T2NrCaCount
            | Var::T2TotalBandwidthMhz => Kind::Plain,
        }
    }

    fn idx(self) -> usize {
        self as usize
    }
}

/// The poller's current values of the globals a step READS (not only sets):
/// `parse_ca_info` reads network_type (NSA NR-CA count, reconcile) and
/// lte_state / nr_state (reconcile). Inside a batch, values set by an
/// earlier step (qeng) win over these.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Prior {
    pub network_type: Vec<u8>,
    pub lte_state: Vec<u8>,
    pub nr_state: Vec<u8>,
}

impl Prior {
    /// Read from the environment: `QM_IN_network_type`, `QM_IN_lte_state`,
    /// `QM_IN_nr_state` (unset = empty, as an unset shell variable reads).
    pub fn from_env() -> Prior {
        use std::os::unix::ffi::OsStringExt;
        let get = |k: &str| {
            std::env::var_os(k)
                .map(|v| v.into_vec())
                .unwrap_or_default()
        };
        Prior {
            network_type: get("QM_IN_network_type"),
            lte_state: get("QM_IN_lte_state"),
            nr_state: get("QM_IN_nr_state"),
        }
    }
}

/// Globals set so far in one batch, over a `Prior`.
#[derive(Debug, Clone)]
pub struct State {
    set: Vec<Option<Vec<u8>>>,
    prior: Prior,
    /// jq-escaped twin of t2_carrier_components (None when it is "").
    components_jq: Option<String>,
}

impl State {
    pub fn new(prior: Prior) -> State {
        State {
            set: vec![None; VAR_COUNT],
            prior,
            components_jq: None,
        }
    }

    pub fn put(&mut self, v: Var, val: impl Into<Vec<u8>>) {
        if let Some(slot) = self.set.get_mut(v.idx()) {
            *slot = Some(val.into());
        }
    }

    fn put_components(&mut self, shell: Vec<u8>, jq: Option<String>) {
        self.put(Var::T2CarrierComponents, shell);
        self.components_jq = jq;
    }

    /// The `_j` twin of t2_carrier_components, when it is valid JSON.
    pub fn components_jq(&self) -> Option<&str> {
        self.components_jq.as_deref()
    }

    /// Value set in this batch, if any.
    pub fn get_set(&self, v: Var) -> Option<&[u8]> {
        self.set.get(v.idx()).and_then(|o| o.as_deref())
    }

    /// Current value as the shell would read it (set, else prior, else "").
    pub fn read(&self, v: Var) -> &[u8] {
        if let Some(x) = self.get_set(v) {
            return x;
        }
        match v {
            Var::NetworkType => &self.prior.network_type,
            Var::LteState => &self.prior.lte_state,
            Var::NrState => &self.prior.nr_state,
            _ => b"",
        }
    }

    /// (var, value) for every var set in this batch, in `Var::ALL` order.
    pub fn assigned(&self) -> impl Iterator<Item = (Var, &[u8])> + '_ {
        Var::ALL
            .iter()
            .filter_map(move |&v| self.get_set(v).map(|x| (v, x)))
    }
}

// ---------------------------------------------------------------------------
// Shell primitives
// ---------------------------------------------------------------------------

/// `x=$(cmd)`: NUL bytes are dropped (BusyBox ash), then every trailing
/// newline is stripped.
pub fn shell_capture(raw: &[u8]) -> Vec<u8> {
    let mut v: Vec<u8> = raw.iter().copied().filter(|&b| b != 0).collect();
    while v.last() == Some(&b'\n') {
        v.pop();
    }
    v
}

/// What the poller's `$(qcmd ...)` holds for a reply the daemon returned:
/// qcmd raw mode prints `shell_capture(lossy UTF-8)` plus a newline
/// (output.rs), then the shell capture runs on that.
pub fn qcmd_stdout_capture(daemon_raw: &[u8]) -> Vec<u8> {
    let s = String::from_utf8_lossy(daemon_raw);
    shell_capture(s.as_bytes())
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    if n.is_empty() {
        return Some(0);
    }
    h.windows(n.len()).position(|w| w == n)
}

fn contains(h: &[u8], n: &[u8]) -> bool {
    find(h, n).is_some()
}

/// `_pat_del`: every non-overlapping occurrence of `pat`, left to right, one
/// pass (== sed s/pat//g). Removal is not repeated.
fn del_all(s: &[u8], pat: &[u8]) -> Vec<u8> {
    if pat.is_empty() {
        return s.to_vec();
    }
    let mut out = Vec::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = find(rest, pat) {
        out.extend_from_slice(rest.get(..i).unwrap_or_default());
        rest = rest.get(i + pat.len()..).unwrap_or_default();
    }
    out.extend_from_slice(rest);
    out
}

/// `while case *pat*: x=${x%%pat*}${x#*pat}`: remove the first occurrence
/// until none is left (a removal can join a new occurrence).
fn del_fixpoint(s: &[u8], pat: &[u8]) -> Vec<u8> {
    let mut v = s.to_vec();
    if pat.is_empty() {
        return v;
    }
    while let Some(i) = find(&v, pat) {
        v.drain(i..i + pat.len());
    }
    v
}

fn del_byte(s: &[u8], b: u8) -> Vec<u8> {
    s.iter().copied().filter(|&c| c != b).collect()
}

/// `${s%%pat*}${s#*pat}`: remove the first occurrence only.
fn del_first(s: &[u8], pat: &[u8]) -> Vec<u8> {
    match find(s, pat) {
        Some(i) => {
            let mut v = s.get(..i).unwrap_or_default().to_vec();
            v.extend_from_slice(s.get(i + pat.len()..).unwrap_or_default());
            v
        }
        None => s.to_vec(),
    }
}

/// `${s#*c}`: after the first `c` (whole string if none).
fn after_first(s: &[u8], pat: &[u8]) -> Vec<u8> {
    match find(s, pat) {
        Some(i) => s.get(i + pat.len()..).unwrap_or_default().to_vec(),
        None => s.to_vec(),
    }
}

/// `${s%%c*}`: up to the first `c` (whole string if none).
fn before_first(s: &[u8], pat: &[u8]) -> Vec<u8> {
    match find(s, pat) {
        Some(i) => s.get(..i).unwrap_or_default().to_vec(),
        None => s.to_vec(),
    }
}

/// Field splitting with IFS=newline: empty lines vanish.
fn nl_fields(s: &[u8]) -> impl Iterator<Item = &[u8]> {
    s.split(|&b| b == b'\n').filter(|l| !l.is_empty())
}

/// `_first_line_with` / `_pat_first_line`: first line containing `needle`.
fn first_line_with<'a>(s: &'a [u8], needle: &[u8]) -> &'a [u8] {
    nl_fields(s).find(|l| contains(l, needle)).unwrap_or_default()
}

/// `_pat_split`: `cut -d, -fN` semantics for N = 1..17.
fn pat_split(s: &[u8]) -> Vec<Vec<u8>> {
    let mut f: Vec<Vec<u8>> = Vec::with_capacity(17);
    if !s.contains(&b',') {
        for _ in 0..17 {
            f.push(s.to_vec());
        }
        return f;
    }
    let mut parts: Vec<&[u8]> = s.split(|&b| b == b',').collect();
    // IFS splitting: a trailing delimiter ends the last field, no empty field.
    if s.last() == Some(&b',') {
        parts.pop();
    }
    for i in 0..17 {
        f.push(parts.get(i).map(|p| p.to_vec()).unwrap_or_default());
    }
    f
}

fn fld(f: &[Vec<u8>], n: usize) -> &[u8] {
    f.get(n.wrapping_sub(1)).map(|v| v.as_slice()).unwrap_or_default()
}

fn cat(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut v = a.to_vec();
    v.extend_from_slice(b);
    v
}

/// `_hex_to_dec_g`: (value, ok). Empty -> ("", ok); invalid -> ("0", fail).
fn hex_to_dec(h: &[u8]) -> (Vec<u8>, bool) {
    if h.is_empty() {
        return (Vec::new(), true);
    }
    if !h.iter().all(|c| c.is_ascii_hexdigit()) {
        return (b"0".to_vec(), false);
    }
    let z = h.iter().take_while(|&&c| c == b'0').count();
    let t = h.get(z..).unwrap_or_default();
    if t.is_empty() {
        return (b"0".to_vec(), true);
    }
    if t.len() >= 17 {
        return (b"0".to_vec(), false);
    }
    if t.len() == 16 && matches!(t.first(), Some(b'8'..=b'9' | b'A'..=b'F' | b'a'..=b'f')) {
        return (b"0".to_vec(), false);
    }
    let mut n: u64 = 0;
    for &c in t {
        let d = match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => 0,
        };
        n = n.wrapping_mul(16).wrapping_add(u64::from(d));
    }
    (n.to_string().into_bytes(), true)
}

/// `_lte_sinr_db_g`: AT+QENG LTE <SINR> raw X (0..25) -> dB as 2X - 20, CR
/// stripped. Anything that is not 1-2 ASCII digits in 0..25 -> "". NR5G SINR
/// is already dB and does not go through here.
fn lte_sinr_db(raw: &[u8]) -> Vec<u8> {
    let x = del_all(raw, b"\r");
    if x.is_empty() || x.len() > 2 || !x.iter().all(|c| c.is_ascii_digit()) {
        return Vec::new();
    }
    let n = x.iter().fold(0i32, |a, &c| a * 10 + i32::from(c - b'0'));
    if n > 25 {
        return Vec::new();
    }
    (n * 2 - 20).to_string().into_bytes()
}

/// `_compute_cell_parts`: (dec, enb, sec).
fn cell_parts(h: &[u8], nr: bool) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    if h.is_empty() {
        return (Vec::new(), Vec::new(), Vec::new());
    }
    let (d, ok) = hex_to_dec(h);
    if !ok {
        return (Vec::new(), Vec::new(), Vec::new());
    }
    let n: u64 = std::str::from_utf8(&d)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let div = if nr { 16384 } else { 256 };
    (
        d,
        (n / div).to_string().into_bytes(),
        (n % div).to_string().into_bytes(),
    )
}

fn scs_khz(s: &[u8]) -> &'static [u8] {
    match s {
        b"0" => b"15",
        b"1" => b"30",
        b"2" => b"60",
        b"3" => b"120",
        b"4" => b"240",
        _ => b"",
    }
}

/// BusyBox ash `echo "$1"` captured with `$(...)`: a word made only of the
/// option letters n/e/E after one '-' is taken as options (prints nothing).
fn echo_capture(v: &[u8]) -> Vec<u8> {
    if let Some((b'-', rest)) = v.split_first() {
        if !rest.is_empty() && rest.iter().all(|c| matches!(c, b'n' | b'e' | b'E')) {
            return Vec::new();
        }
    }
    v.to_vec()
}

/// `_sig_val_g`.
fn sig_val(v: &[u8]) -> Vec<u8> {
    if v.is_empty() || v == b"-32768" {
        return b"null".to_vec();
    }
    if v.iter().all(|c| c.is_ascii_digit() || *c == b'-') {
        return v.to_vec();
    }
    echo_capture(v)
}

/// `_antenna_line_to_json_g`.
fn antenna_json(line: &[u8], tag: &[u8]) -> Vec<u8> {
    if line.is_empty() {
        return b"[null,null,null,null]".to_vec();
    }
    let key = cat(b"+", &cat(tag, b":"));
    let s = del_first(line, &key);
    let s = del_all(&s, b" ");
    let s = del_all(&s, b"\r");
    let f = pat_split(&s);
    let mut o = b"[".to_vec();
    for i in 1..=4 {
        if i > 1 {
            o.push(b',');
        }
        o.extend_from_slice(&sig_val(fld(&f, i)));
    }
    o.push(b']');
    o
}

/// `_pat_antenna_lines`: first line with "+TAG:" then LTE / then NR5G.
fn antenna_lines<'a>(raw: &'a [u8], tag: &[u8]) -> (&'a [u8], &'a [u8]) {
    let key = cat(b"+", &cat(tag, b":"));
    let mut l: &[u8] = b"";
    let mut n: &[u8] = b"";
    for line in raw.split(|&b| b == b'\n') {
        if let Some(i) = find(line, &key) {
            let tail = line.get(i + key.len()..).unwrap_or_default();
            if contains(tail, b"LTE") && l.is_empty() {
                l = line;
            }
            if contains(tail, b"NR5G") && n.is_empty() {
                n = line;
            }
            if !l.is_empty() && !n.is_empty() {
                break;
            }
        }
    }
    (l, n)
}

/// `qcmd_exec_g`: (rc, stripped reply). rc 0 ok, 1 failed/empty, 2 ERROR,
/// 3 not run (qcmd exit 3, or a modem_busy / scan_in_progress /
/// invalid_command error).
fn qcmd_exec(rc: i32, out: &[u8]) -> (i32, Vec<u8>) {
    if rc == 3 {
        return (3, Vec::new());
    }
    if rc != 0 || out.is_empty() {
        let busy: [&[u8]; 3] = [
            b"ERROR: modem_busy",
            b"ERROR: scan_in_progress",
            b"ERROR: invalid_command",
        ];
        let rc = if busy.iter().any(|e| contains(out, e)) { 3 } else { 1 };
        return (rc, Vec::new());
    }
    let mut qr: Vec<u8> = Vec::new();
    for l in nl_fields(out) {
        if l.starts_with(b"AT") || l == b"OK" {
            continue;
        }
        if !qr.is_empty() {
            qr.push(b'\n');
        }
        qr.extend_from_slice(l);
    }
    if contains(&qr, b"ERROR") {
        (2, qr)
    } else {
        (0, qr)
    }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/// `_pat_qeng_csv`.
fn qeng_csv(line: &[u8], strip_cr: bool) -> Vec<u8> {
    let s = del_all(line, b"+QENG: ");
    let s = del_all(&s, b"\"");
    let s = del_all(&s, b" ");
    if strip_cr {
        del_all(&s, b"\r")
    } else {
        s
    }
}

fn parse_serving_cell(st: &mut State, qr: &[u8]) {
    use Var::*;
    st.put(LteState, "unknown");
    st.put(NrState, "unknown");
    for v in [
        LteBand, LteEarfcn, LteBandwidth, LtePci, LteRsrp, LteRsrq, LteSinr, LteRssi, LteCellId,
        LteEnodebId, LteSectorId, LteTac, NrBand, NrArfcn, NrPci, NrRsrp, NrRsrq, NrSinr, NrScs,
        NrCellId, NrEnodebId, NrSectorId, NrTac,
    ] {
        st.put(v, "");
    }

    let mut have_qeng = false;
    let mut sc_line: &[u8] = b"";
    let mut lte_line: &[u8] = b"";
    let mut nr_line: &[u8] = b"";
    let (mut has_nsa, mut has_sa, mut has_lte) = (false, false, false);
    for line in qr.split(|&b| b == b'\n') {
        if !line.starts_with(b"+QENG:") {
            continue;
        }
        have_qeng = true;
        let sc = contains(line, b"\"servingcell\"");
        if sc && sc_line.is_empty() {
            sc_line = line;
        }
        if contains(line, b"\"NR5G-NSA\"") {
            has_nsa = true;
            if nr_line.is_empty() {
                nr_line = line;
            }
        }
        if contains(line, b"\"NR5G-SA\"") {
            has_sa = true;
        }
        if contains(line, b"\"LTE\"") {
            has_lte = true;
            if !sc && lte_line.is_empty() {
                lte_line = line;
            }
        }
    }

    if !have_qeng {
        st.put(ServiceStatus, "unknown");
        return;
    }

    if contains(sc_line, b"\"NOCONN\"") {
        st.put(ServiceStatus, "idle");
    } else if contains(sc_line, b"\"LIMSRV\"") {
        st.put(ServiceStatus, "limited");
    } else if contains(sc_line, b"\"CONNECT\"") {
        st.put(ServiceStatus, "connected");
    } else if contains(sc_line, b"\"SEARCH\"") {
        st.put(ServiceStatus, "searching");
    }

    if has_nsa {
        st.put(NetworkType, "5G-NSA");
        if !lte_line.is_empty() {
            st.put(LteState, "connected");
            let f = pat_split(&qeng_csv(lte_line, false));
            let (d, e, s) = cell_parts(&del_all(fld(&f, 5), b"\r"), false);
            st.put(LteCellId, d);
            st.put(LteEnodebId, e);
            st.put(LteSectorId, s);
            st.put(LtePci, fld(&f, 6));
            st.put(LteEarfcn, fld(&f, 7));
            st.put(LteBand, cat(b"B", fld(&f, 8)));
            st.put(LteBandwidth, fld(&f, 10));
            st.put(LteTac, hex_to_dec(&del_all(fld(&f, 11), b"\r")).0);
            st.put(LteRsrp, fld(&f, 12));
            st.put(LteRsrq, fld(&f, 13));
            st.put(LteRssi, fld(&f, 14));
            st.put(LteSinr, lte_sinr_db(fld(&f, 15)));
        }
        if !nr_line.is_empty() {
            st.put(NrState, "connected");
            let f = pat_split(&qeng_csv(nr_line, true));
            st.put(NrPci, fld(&f, 4));
            st.put(NrRsrp, fld(&f, 5));
            st.put(NrSinr, fld(&f, 6));
            st.put(NrRsrq, fld(&f, 7));
            st.put(NrArfcn, fld(&f, 8));
            st.put(NrBand, cat(b"N", fld(&f, 9)));
            st.put(NrScs, scs_khz(fld(&f, 11)));
        }
    } else if has_sa {
        st.put(NetworkType, "5G-SA");
        st.put(LteState, "inactive");
        st.put(NrState, "connected");
        let f = pat_split(&qeng_csv(sc_line, false));
        let (d, e, s) = cell_parts(&del_all(fld(&f, 7), b"\r"), true);
        st.put(NrCellId, d);
        st.put(NrEnodebId, e);
        st.put(NrSectorId, s);
        st.put(NrPci, fld(&f, 8));
        st.put(NrTac, hex_to_dec(&del_all(fld(&f, 9), b"\r")).0);
        st.put(NrArfcn, fld(&f, 10));
        st.put(NrBand, cat(b"N", fld(&f, 11)));
        st.put(NrRsrp, fld(&f, 13));
        st.put(NrRsrq, fld(&f, 14));
        st.put(NrSinr, fld(&f, 15));
        st.put(NrScs, scs_khz(fld(&f, 16)));
    } else if has_lte {
        st.put(NetworkType, "LTE");
        st.put(NrState, "inactive");
        let csv = qeng_csv(sc_line, false);
        if contains(&csv, b"SEARCH") {
            st.put(LteState, "searching");
            return;
        }
        st.put(LteState, "connected");
        let f = pat_split(&csv);
        let (d, e, s) = cell_parts(&del_all(fld(&f, 7), b"\r"), false);
        st.put(LteCellId, d);
        st.put(LteEnodebId, e);
        st.put(LteSectorId, s);
        st.put(LtePci, fld(&f, 8));
        st.put(LteEarfcn, fld(&f, 9));
        st.put(LteBand, cat(b"B", fld(&f, 10)));
        st.put(LteBandwidth, fld(&f, 12));
        st.put(LteTac, hex_to_dec(&del_all(fld(&f, 13), b"\r")).0);
        st.put(LteRsrp, fld(&f, 14));
        st.put(LteRsrq, fld(&f, 15));
        st.put(LteRssi, fld(&f, 16));
        st.put(LteSinr, lte_sinr_db(fld(&f, 17)));
    } else {
        st.put(LteState, "unknown");
        st.put(NrState, "unknown");
        st.put(ServiceStatus, "unknown");
    }
}

fn step_qeng(st: &mut State, rc: i32, out: &[u8]) -> i32 {
    let (rc, qr) = qcmd_exec(rc, out);
    if rc == 0 || rc == 2 {
        parse_serving_cell(st, &qr);
    } else {
        // poll_serving_cell failure branch. modem_reachable / system_state
        // and the state-change logging stay in the poller (qm_step_qeng_rc).
        st.put(Var::LteState, "unknown");
        st.put(Var::NrState, "unknown");
        st.put(Var::Errors, "modem_timeout");
    }
    rc
}

fn ca_reset(st: &mut State) {
    st.put(Var::T2CaActive, "false");
    st.put(Var::T2CaCount, "0");
    st.put(Var::T2NrCaActive, "false");
    st.put(Var::T2NrCaCount, "0");
    st.put(Var::T2TotalBandwidthMhz, "0");
    st.put(Var::T2BandwidthDetails, "");
    st.put_components(b"[]".to_vec(), Some("[]".into()));
}

fn step_ca(st: &mut State, rc: i32, out: &[u8]) -> i32 {
    let (rc, qr) = qcmd_exec(rc, out);
    if rc == 0 && !qr.is_empty() {
        ca::parse_ca_info(st, &qr);
    } else if rc != 3 {
        // Busy (rc 3) keeps the last CA values, like the deep tier.
        ca_reset(st);
    }
    rc
}

fn step_cfun(st: &mut State, out: &[u8]) {
    if out.is_empty() {
        return;
    }
    let fl = first_line_with(out, b"+CFUN:");
    if fl.is_empty() {
        return;
    }
    let v = del_byte(fl, b'\r');
    let v = if contains(&v, b": ") {
        before_first(&after_first(&v, b": "), b": ")
    } else {
        Vec::new()
    };
    let v = del_byte(&v, b' ');
    if !v.is_empty() {
        st.put(Var::T1Cfun, v);
    }
}

fn step_sig(st: &mut State, out: &[u8]) {
    if out.is_empty() {
        return;
    }
    let tags: [(&[u8], Var, Var); 3] = [
        (b"QRSRP", Var::SigLteRsrp, Var::SigNrRsrp),
        (b"QRSRQ", Var::SigLteRsrq, Var::SigNrRsrq),
        (b"QSINR", Var::SigLteSinr, Var::SigNrSinr),
    ];
    for (tag, vl, vn) in tags {
        let (l, n) = antenna_lines(out, tag);
        st.put(vl, antenna_json(l, tag));
        st.put(vn, antenna_json(n, tag));
    }
}

fn parse_carrier(st: &mut State, raw: &[u8]) {
    let line = first_line_with(raw, b"+COPS:");
    if line.is_empty() {
        st.put(Var::T2Carrier, "");
        return;
    }
    let s = del_all(line, b"+COPS: ");
    let s = del_all(&s, b"\r");
    if s.iter().filter(|&&c| c == b',').count() < 2 {
        st.put(Var::T2Carrier, "");
        return;
    }
    let s = after_first(&s, b",");
    let s = after_first(&s, b",");
    let s = before_first(&s, b",");
    st.put(Var::T2Carrier, del_all(&s, b"\""));
}

fn parse_sim_slot(st: &mut State, raw: &[u8]) {
    let line = first_line_with(raw, b"+QUIMSLOT:");
    if !line.is_empty() {
        let s = del_all(line, b"+QUIMSLOT: ");
        let s = del_all(&s, b" ");
        st.put(Var::T2SimSlot, del_all(&s, b"\r"));
    }
}

fn parse_sim_status(st: &mut State, line: &[u8]) {
    let v: &str = if contains(line, b"READY") {
        "ready"
    } else if contains(line, b"SIM PIN") {
        "pin_required"
    } else if contains(line, b"SIM PUK") {
        "puk_required"
    } else if contains(line, b"NOT INSERTED") || contains(line, b"NOT READY") {
        "not_inserted"
    } else if contains(line, b"ERROR") {
        "error"
    } else {
        "unknown"
    };
    st.put(Var::T2SimStatus, v);
}

fn step_ident(st: &mut State, out: &[u8]) {
    if out.is_empty() {
        return;
    }
    parse_carrier(st, out);
    parse_sim_slot(st, out);
    let fl = first_line_with(out, b"+CNUM:");
    if !fl.is_empty() {
        let v = if fl.contains(&b',') {
            before_first(&after_first(fl, b","), b",")
        } else {
            fl.to_vec()
        };
        let v = del_byte(&del_byte(&v, b'"'), b'\r');
        if !v.is_empty() {
            st.put(Var::BootPhoneNumber, v);
        }
    }
    let cpin = first_line_with(out, b"+CPIN:");
    if !cpin.is_empty() {
        parse_sim_status(st, cpin);
    } else if contains(out, b"CME ERROR") {
        st.put(Var::T2SimStatus, "error");
        st.put(Var::Errors, "sim_not_inserted");
    }
}

fn step_simid(st: &mut State, out: &[u8]) {
    if out.is_empty() {
        return;
    }
    let mut imsi: Vec<u8> = Vec::new();
    let mut acc: Vec<u8> = Vec::new();
    for l in nl_fields(out) {
        if imsi.is_empty() {
            let v = del_byte(l, b'\r');
            if v.len() == 15 && v.iter().all(|c| c.is_ascii_digit()) {
                imsi = v;
            }
        }
        if contains(l, b"+QCCID:") {
            let v = del_fixpoint(l, b"+QCCID: ");
            let v = del_byte(&del_byte(&v, b'\r'), b' ');
            acc.extend_from_slice(&v);
            acc.push(b'\n');
        }
    }
    if !imsi.is_empty() {
        st.put(Var::BootImsi, imsi);
    }
    while acc.last() == Some(&b'\n') {
        acc.pop();
    }
    if !acc.is_empty() {
        st.put(Var::BootIccid, acc);
    }
}

/// Runs one step over `out` (the `$(qcmd ...)` capture) and its exit code.
/// Returns the qcmd_exec-style rc the poller logic needs: 0 ok, 1 failed or
/// empty, 2 the reply contains ERROR, 3 not run (steps that ignore rc report
/// the same classification for information only). Cfun / sig / ident / simid
/// read through the poller's `_qc_read`, which keeps the reply only on exit 0.
pub fn run_step(st: &mut State, step: Step, rc: i32, out: &[u8]) -> i32 {
    match step {
        Step::Qeng => step_qeng(st, rc, out),
        Step::Ca => step_ca(st, rc, out),
        other => {
            let reply: &[u8] = if rc == 0 { out } else { &[] };
            match other {
                Step::Cfun => step_cfun(st, reply),
                Step::Sig => step_sig(st, reply),
                Step::Ident => step_ident(st, reply),
                _ => step_simid(st, reply),
            }
            qcmd_exec(rc, out).0
        }
    }
}

/// `qcmd --parse-only <step>`: parse a captured qcmd stdout (`raw`) with its
/// exit code and print the env to `out`. The prior network_type / lte_state /
/// nr_state come from `QM_IN_*` (see `Prior::from_env`). Returns the process
/// exit code: 0 written, 2 unknown step, 1 write error.
pub fn parse_only(step: &str, rc: i32, raw: &[u8], out: &mut impl std::io::Write) -> i32 {
    parse_only_with(step, rc, raw, Prior::from_env(), out)
}

pub fn parse_only_with(
    step: &str,
    rc: i32,
    raw: &[u8],
    prior: Prior,
    out: &mut impl std::io::Write,
) -> i32 {
    let Some(st) = Step::from_name(step) else {
        return 2;
    };
    let status = if rc == 0 {
        StepStatus::Ok
    } else {
        StepStatus::Failed
    };
    let mut state = State::new(prior);
    let src = run_step(&mut state, st, rc, &shell_capture(raw));
    let meta = PollMeta { rc: "ok", ms: 0 };
    match crate::poll::envout::write_env(&meta, &[(st, status, src)], &state, out) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing, clippy::panic)]
mod tests;
