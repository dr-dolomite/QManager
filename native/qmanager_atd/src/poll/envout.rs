//! Eval-safe shell env writer for `qcmd --poll` (design 5.5).
//!
//! The file is dot-sourced by the poller, so this is the trust boundary
//! between modem text and the shell:
//! - names come from a closed allowlist (`is_allowed`); a write of any other
//!   name is refused with an error before anything for it is written;
//! - every value is single-quoted, `'` becomes `'\''`, NUL is dropped:
//!   nothing inside single quotes expands in POSIX sh;
//! - free-text values also get `<name>_j`, a ready JSON literal, so the shell
//!   composer never escapes modem text (see `parse::Kind`).
//!
//! Layout: `qm_poll_v`, `qm_poll_rc`, `qm_poll_ms`, then per requested step
//! `qm_step_<step>` (status) and `qm_step_<step>_rc` (the poller's
//! qcmd_exec rc: 0 ok, 1 failed/empty, 2 ERROR), then the globals the steps
//! set (final values), then `qm_poll_end='1'`.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

use crate::poll::parse::{
    ca::{is_strict_json_number, jq_string, jq_tonumber},
    qcmd_stdout_capture, run_step, Kind, Prior, State, Step, StepStatus, Var,
};
use std::io::{self, Write};

pub const ENV_VERSION: &str = "1";

const META: [&str; 4] = ["qm_poll_v", "qm_poll_rc", "qm_poll_ms", "qm_poll_end"];

/// Batch-level fields the caller knows (rc: ok, modem_busy, scan_in_progress,
/// command_failed; ms: batch time).
#[derive(Debug, Clone, Copy)]
pub struct PollMeta<'a> {
    pub rc: &'a str,
    pub ms: u64,
}

/// True only for names this writer may emit.
pub fn is_allowed(name: &str) -> bool {
    if META.contains(&name) {
        return true;
    }
    if let Some(rest) = name.strip_prefix("qm_step_") {
        let base = rest.strip_suffix("_rc").unwrap_or(rest);
        return Step::from_name(base).is_some();
    }
    for v in Var::ALL {
        if name == v.name() {
            return true;
        }
        if v.kind() != Kind::Plain {
            if let Some(b) = name.strip_suffix("_j") {
                if b == v.name() {
                    return true;
                }
            }
        }
    }
    false
}

/// The full allowlist, for tests and docs.
pub fn allowlist() -> Vec<String> {
    let mut v: Vec<String> = META.iter().map(|s| s.to_string()).collect();
    for s in Step::ALL {
        v.push(format!("qm_step_{}", s.name()));
        v.push(format!("qm_step_{}_rc", s.name()));
    }
    for x in Var::ALL {
        v.push(x.name().to_string());
        if x.kind() != Kind::Plain {
            v.push(format!("{}_j", x.name()));
        }
    }
    v
}

/// `name='value'` with POSIX single-quote escaping; NUL dropped.
pub fn sh_assign(name: &str, val: &[u8]) -> Vec<u8> {
    let mut o = Vec::with_capacity(name.len() + val.len() + 4);
    o.extend_from_slice(name.as_bytes());
    o.extend_from_slice(b"='");
    for &c in val {
        match c {
            0 => {}
            b'\'' => o.extend_from_slice(b"'\\''"),
            c => o.push(c),
        }
    }
    o.extend_from_slice(b"'\n");
    o
}

fn put(buf: &mut Vec<u8>, name: &str, val: &[u8]) -> io::Result<()> {
    if !is_allowed(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("env name not allowed: {name}"),
        ));
    }
    buf.extend_from_slice(&sh_assign(name, val));
    Ok(())
}

/// jq's rendering of a flat array of strict numbers / null, else None.
fn num_array_j(v: &[u8]) -> Option<String> {
    let inner = v.strip_prefix(b"[")?.strip_suffix(b"]")?;
    if inner.is_empty() {
        return Some("[]".into());
    }
    let mut out = String::from("[");
    for (i, e) in inner.split(|&b| b == b',').enumerate() {
        if i > 0 {
            out.push(',');
        }
        if e == b"null" {
            out.push_str("null");
        } else if is_strict_json_number(e) {
            out.push_str(&jq_tonumber(e)?);
        } else {
            return None;
        }
    }
    out.push(']');
    Some(out)
}

/// The `_j` companion of `v`, or None for kinds that have none.
fn json_twin(var: Var, val: &[u8], st: &State) -> Option<String> {
    match var.kind() {
        Kind::Plain => None,
        Kind::Str(def) => Some(if val.is_empty() && !def.is_empty() {
            jq_string(def.as_bytes())
        } else {
            jq_string(val)
        }),
        Kind::Num(def) => Some(if val.is_empty() {
            def.to_string()
        } else if is_strict_json_number(val) {
            jq_tonumber(val).unwrap_or_default()
        } else {
            String::new()
        }),
        Kind::NumArray => Some(num_array_j(val).unwrap_or_default()),
        Kind::Components => Some(if val.is_empty() {
            String::new()
        } else {
            st.components_jq().unwrap_or_default().to_string()
        }),
    }
}

/// Writes the whole env (built in memory first, one write call).
pub fn write_env(
    meta: &PollMeta,
    steps: &[(Step, StepStatus, i32)],
    st: &State,
    out: &mut impl Write,
) -> io::Result<()> {
    let mut b: Vec<u8> = Vec::with_capacity(4096);
    put(&mut b, "qm_poll_v", ENV_VERSION.as_bytes())?;
    put(&mut b, "qm_poll_rc", meta.rc.as_bytes())?;
    put(&mut b, "qm_poll_ms", meta.ms.to_string().as_bytes())?;
    for (step, status, rc) in steps {
        put(&mut b, &format!("qm_step_{}", step.name()), status.as_str().as_bytes())?;
        put(&mut b, &format!("qm_step_{}_rc", step.name()), rc.to_string().as_bytes())?;
    }
    for (var, val) in st.assigned() {
        put(&mut b, var.name(), val)?;
        if let Some(j) = json_twin(var, val, st) {
            put(&mut b, &format!("{}_j", var.name()), j.as_bytes())?;
        }
    }
    put(&mut b, "qm_poll_end", b"1")?;
    out.write_all(&b)?;
    out.flush()
}

/// The batch path: parse every step the daemon returned, in order, over
/// `prior` (the poller's current network_type / lte_state / nr_state), and
/// write the env. A `skipped` step never reached the modem (batch deadline,
/// peer gone, or after a step timeout or channel reset): it is the batch
/// analogue of the shell's per-cycle busy latch, so it is handled as a `qcmd`
/// that did not run (exit 3), and CA keeps its last values while qeng counts
/// toward the busy streak. Any other non-`ok` status is a failed `qcmd`
/// (exit 1, empty output). `raw` is the daemon's raw reply for the step
/// (qcmd's raw-mode transform is applied here).
pub fn render_steps(
    results: &[(Step, StepStatus, Vec<u8>)],
    meta: &PollMeta,
    prior: Prior,
    out: &mut impl Write,
) -> io::Result<()> {
    let mut st = State::new(prior);
    let mut done: Vec<(Step, StepStatus, i32)> = Vec::with_capacity(results.len());
    for (step, status, raw) in results {
        let (rc, cap) = match status {
            StepStatus::Ok => (0, qcmd_stdout_capture(raw)),
            StepStatus::Skipped => (3, Vec::new()),
            StepStatus::Timeout | StepStatus::NotReady | StepStatus::Failed => (1, Vec::new()),
        };
        let src = run_step(&mut st, *step, rc, &cap);
        done.push((*step, *status, src));
    }
    write_env(meta, &done, &st, out)
}

/// Env for a batch that never ran (scan flag, busy, refused): meta only.
pub fn render_failure(rc: &str, ms: u64, out: &mut impl Write) -> io::Result<()> {
    let st = State::new(Prior::default());
    write_env(&PollMeta { rc, ms }, &[], &st, out)
}
