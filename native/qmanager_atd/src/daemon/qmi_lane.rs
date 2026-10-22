//! The QMI lane: answers the `QMI` verb on the reader thread, straight from
//! the shared service registry.
//!
//! - **No modem lock, no AT lane, no long-flag gate.** QMI never touches
//!   smd11, so a reader answers a QMI request itself, in a millisecond or two,
//!   while an AT job holds the AT lane or a scan runs. That independence is
//!   the reason the lane exists.
//! - **The registry starts off the serving path.** `Registry::start_qrtr`
//!   does a synchronous name-server lookup bounded at 500 ms; run inline it
//!   could delay the first `accept` on a modem whose QRTR is slow to answer.
//!   So a `qmi-start` thread builds it after the AT lane is up and publishes
//!   it through a `OnceLock`. Until then (a few milliseconds on the device) a
//!   valid request answers `modem_not_ready`, and the AT path never waits.
//! - **Logging is state changes only.** The same thread then watches the
//!   registry: it logs when a service changes state and when the SSR counter
//!   moves, never per request.

use crate::common::log::Logger;
use crate::common::proto::Reply;
use crate::qmi::query;
use crate::qmi::registry::{Registry, SvcState};
use crate::qmi::service_name;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// How often the monitor looks at the registry (five mutex reads).
const MONITOR_EVERY: Duration = Duration::from_millis(500);

pub(crate) struct QmiLane {
    registry: Arc<OnceLock<Arc<Registry>>>,
}

impl QmiLane {
    /// Production: builds the real QRTR registry on a background thread.
    pub(crate) fn start(log: Arc<Logger>) -> QmiLane {
        let cell: Arc<OnceLock<Arc<Registry>>> = Arc::new(OnceLock::new());
        let c = cell.clone();
        let spawned = std::thread::Builder::new()
            .name("qmi-start".into())
            .stack_size(crate::qmi::registry::THREAD_STACK)
            .spawn(move || {
                let reg = Arc::new(Registry::start_qrtr());
                let _ = c.set(reg.clone());
                monitor(&reg, &log);
            });
        if let Err(e) = spawned {
            // Never starts: every QMI request answers modem_not_ready and the
            // client falls back to its own registry. AT is unaffected.
            Logger::new("qmanager_atd").error(&format!("cannot start the QMI lane: {e}"));
        }
        QmiLane { registry: cell }
    }

    /// A lane over an existing registry, with no background threads (tests).
    #[cfg(test)]
    pub(crate) fn with_registry(reg: Arc<Registry>) -> QmiLane {
        let cell = Arc::new(OnceLock::new());
        let _ = cell.set(reg);
        QmiLane { registry: cell }
    }

    /// A lane whose registry never arrived (tests).
    #[cfg(test)]
    pub(crate) fn starting() -> QmiLane {
        QmiLane { registry: Arc::new(OnceLock::new()) }
    }

    /// The reply to a decoded `QMI` request. The arguments are re-validated
    /// here: the socket is the trust boundary, not the client.
    pub(crate) fn answer(&self, args: &[String]) -> Reply {
        let (ok, json) = query::answer(self.registry.get().map(|r| &**r), args);
        Reply::Res(ok, json.into_bytes())
    }
}

/// Remembers the registry's last observed state and says what changed.
pub(crate) struct Monitor {
    states: Vec<(u32, SvcState)>,
    ssr: u64,
}

impl Monitor {
    pub(crate) fn new() -> Monitor {
        Monitor { states: Vec::new(), ssr: 0 }
    }

    /// Log lines (level, text) for what changed since the last call. The
    /// first call reports the starting picture.
    pub(crate) fn poll(&mut self, reg: &Registry) -> Vec<(&'static str, String)> {
        let now = reg.states();
        let ssr = reg.ssr_count();
        let mut out = Vec::new();
        if self.states.is_empty() {
            let line: Vec<String> = now.iter().map(|(s, st)| format!("{}={}", service_name(*s), st.as_str())).collect();
            out.push(("info", format!("qmi lane up: {}", line.join(" "))));
        } else {
            for ((svc, old), (_, new)) in self.states.iter().zip(now.iter()) {
                if old != new {
                    let lvl = if *new == SvcState::Down { "warn" } else { "info" };
                    out.push((lvl, format!("qmi {} {} -> {}", service_name(*svc), old.as_str(), new.as_str())));
                }
            }
            if ssr != self.ssr {
                out.push(("warn", format!("qmi ssr detected (episode {ssr})")));
            }
        }
        self.states = now;
        self.ssr = ssr;
        out
    }
}

fn monitor(reg: &Registry, log: &Logger) -> ! {
    let mut m = Monitor::new();
    loop {
        for (lvl, line) in m.poll(reg) {
            match lvl {
                "warn" => log.warn(&line),
                _ => log.info(&line),
            }
        }
        std::thread::sleep(MONITOR_EVERY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::fake::{r1_net, start_registry};
    use crate::qmi::SVC_NAS;
    use std::time::Instant;

    fn sv(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn body(r: Reply) -> (bool, String) {
        match r {
            Reply::Res(ok, b) => (ok, String::from_utf8(b).unwrap()),
            _ => panic!("expected RES"),
        }
    }

    #[test]
    fn a_lane_still_starting_refuses_politely_and_checks_args_first() {
        let lane = QmiLane::starting();
        assert_eq!(body(lane.answer(&sv(&["serving"]))), (false, query::fail_envelope("modem_not_ready")));
        assert_eq!(body(lane.answer(&sv(&["bogus"]))), (false, query::fail_envelope("bad_args")));
        assert_eq!(body(lane.answer(&[])), (false, query::fail_envelope("bad_args")));
    }

    #[test]
    fn a_lane_answers_reads_from_its_registry() {
        let lane = QmiLane::with_registry(start_registry(&r1_net()));
        let (ok, j) = body(lane.answer(&sv(&["cell"])));
        assert!(ok, "{j}");
        assert!(j.contains("\"cell\":{\"lte\":{\"pci\":295,\"earfcn\":150"), "{j}");
    }

    #[test]
    fn the_monitor_reports_state_changes_and_ssrs_once() {
        let net = r1_net();
        let reg = start_registry(&net);
        let mut m = Monitor::new();
        let first = m.poll(&reg);
        assert_eq!(first.len(), 1);
        assert!(first[0].1.starts_with("qmi lane up: nas=up dms=up uim=up wds=up dsd=up"), "{first:?}");
        assert!(m.poll(&reg).is_empty(), "no change, no log");
        net.del_server(SVC_NAS);
        let end = Instant::now() + Duration::from_secs(2);
        while reg.state(SVC_NAS) == Some(SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        let lines = m.poll(&reg);
        assert!(lines.iter().any(|(l, t)| *l == "warn" && t == "qmi nas up -> down"), "{lines:?}");
        assert!(lines.iter().any(|(_, t)| t.starts_with("qmi ssr detected")), "{lines:?}");
        assert!(m.poll(&reg).is_empty());
        net.add_server(SVC_NAS, 0, 0x77);
        let end = Instant::now() + Duration::from_secs(2);
        while reg.state(SVC_NAS) != Some(SvcState::Up) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(m.poll(&reg), vec![("info", "qmi nas down -> up".to_string())]);
    }
}
