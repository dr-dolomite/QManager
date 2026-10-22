//! B5.29 Phase D poll parsers + env writer; wired to `qcmd --poll` /
//! `--parse-only` by the orchestrator. Parked: built only with the `poll`
//! cargo feature.

#[allow(dead_code)]
pub mod envout;
#[allow(dead_code)]
pub mod parse;
