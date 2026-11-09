//! Kernel capture (plan §2.8, Phase 4): `/dev/kmsg` records, a filter that
//! keeps the few that explain a crash, reboot or link change as `k:"K"` rows,
//! and the events derived from them.
//!
//! A record is `pri,seq,usec,flags[,…];message` (continuation lines start
//! with a space and are ignored). `pri` is `facility << 3 | level`.
//!
//! Kept (tag):
//! - `ssr`: a modem subsystem crash: `remoteproc` with `fatal error` or
//!   `crash detected`, or `subsys-restart` / `subsystem restart`.
//! - `remoteproc`: other remoteproc state lines (`is now up`, `is now off`,
//!   `stopped`, `recover…`, `Booting fw`, `powering up`).
//! - `oom`: `invoked oom-killer`, `Out of memory`, `oom-kill:`.
//! - `thermal`: `thermal` with `trip`, `critical`, `emergency`, `shutdown`
//!   or `overheat`.
//! - `panic`: `Kernel panic`.
//! - `watchdog`: `watchdog` with `bark`, `bite` or `lockup`.
//! - `bug`: `BUG:`, `Oops`, `Internal error:`, `Unable to handle kernel`.
//! - `eth`: `link is up|down` / `link up|down` from `eth*`, `stmmac`, `r8125`,
//!   `r8169`.
//!
//! Events: `oom_kill` (warning, f proc, pid) from `Killed process <pid>
//! (<name>)`; `eth_link_up` (info, f iface, speed, duplex) and
//! `eth_link_down` (warning, f iface). An SSR is a K row only: History's
//! `modem_crash` comes from the QMI state.

use super::record::Sev;

#[derive(Debug, PartialEq)]
pub struct KRec {
    pub pri: u8,
    pub fac: u8,
    pub seq: u64,
    /// Microseconds since boot.
    pub usec: u64,
    pub msg: String,
}

/// Parses one record line (no LF). None for continuation and foreign lines.
pub fn parse_record(line: &[u8]) -> Option<KRec> {
    let line = std::str::from_utf8(line).ok()?;
    let (head, msg) = line.split_once(';')?;
    let mut it = head.split(',');
    let p: u32 = it.next()?.parse().ok()?;
    let seq: u64 = it.next()?.parse().ok()?;
    let usec: u64 = it.next()?.parse().ok()?;
    let msg: String = msg.chars().filter(|&c| c as u32 >= 0x20).collect();
    Some(KRec { pri: (p & 7) as u8, fac: ((p >> 3) & 0xff) as u8, seq, usec, msg })
}

fn has_ci(hay: &str, needle: &str) -> bool {
    let (h, n) = (hay.as_bytes(), needle.as_bytes());
    n.len() <= h.len() && h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
}

fn any_ci(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| has_ci(hay, n))
}

/// The filter tag of a kernel message, None when it is not kept.
pub fn classify(msg: &str) -> Option<&'static str> {
    if has_ci(msg, "remoteproc") && any_ci(msg, &["fatal error", "crash detected"]) || any_ci(msg, &["subsys-restart", "subsystem restart"]) {
        return Some("ssr");
    }
    if has_ci(msg, "remoteproc") && any_ci(msg, &["is now up", "is now off", "stopped", "recover", "booting fw", "powering up"]) {
        return Some("remoteproc");
    }
    if any_ci(msg, &["invoked oom-killer", "out of memory", "oom-kill:"]) {
        return Some("oom");
    }
    if has_ci(msg, "thermal") && any_ci(msg, &["trip", "critical", "emergency", "shutdown", "overheat"]) {
        return Some("thermal");
    }
    if msg.contains("Kernel panic") {
        return Some("panic");
    }
    if has_ci(msg, "watchdog") && any_ci(msg, &["bark", "bite", "lockup"]) {
        return Some("watchdog");
    }
    if msg.contains("BUG:") || msg.contains("Oops") || msg.contains("Internal error:") || msg.contains("Unable to handle kernel") {
        return Some("bug");
    }
    if any_ci(msg, &["link is up", "link is down", "link up", "link down"]) && (iface(msg).is_some() || any_ci(msg, &["stmmac", "r8125", "r8169"])) {
        return Some("eth");
    }
    None
}

/// The first `eth<N>` / `lan<N>` word.
fn iface(msg: &str) -> Option<String> {
    msg.split(|c: char| c == ' ' || c == ':' || c == ',').find_map(|w| {
        let digits = w.strip_prefix("eth").or_else(|| w.strip_prefix("lan"))?;
        (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then(|| w.to_string())
    })
}

/// An event derived from a kept record: (type, severity, fields, message).
pub type KEvent = (&'static str, Sev, Vec<(String, String)>, String);

pub fn event_of(tag: &str, msg: &str) -> Option<KEvent> {
    match tag {
        "oom" => {
            // "Out of memory: Killed process 1234 (name) total-vm:…"
            let rest = &msg[msg.find("Killed process ")? + "Killed process ".len()..];
            let (pid, rest) = rest.split_once(' ')?;
            if pid.is_empty() || !pid.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let name = rest.strip_prefix('(')?.split(')').next()?.to_string();
            let m = format!("Out of memory: killed {name} (pid {pid})");
            Some(("oom_kill", Sev::Warning, vec![("proc".into(), name), ("pid".into(), pid.to_string())], m))
        }
        "eth" => {
            let ifc = iface(msg).unwrap_or_else(|| "eth".into());
            let up = any_ci(msg, &["link is up", "link up"]);
            if !up {
                return Some(("eth_link_down", Sev::Warning, vec![("iface".into(), ifc.clone())], format!("{ifc} link down")));
            }
            let words: Vec<&str> = msg.split(|c: char| c == ' ' || c == '/' || c == ',' || c == '-').filter(|w| !w.is_empty()).collect();
            let mut speed = String::new();
            for (i, w) in words.iter().enumerate() {
                let l = w.to_ascii_lowercase();
                let num = l.trim_end_matches("bps").trim_end_matches(['g', 'm']);
                if (l.ends_with("gbps") || l.ends_with("mbps")) && !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
                    speed = w.to_string();
                    break;
                }
                // "1000 Mbps"
                if (l == "mbps" || l == "gbps") && i > 0 && words[i - 1].bytes().all(|b| b.is_ascii_digit()) {
                    speed = format!("{}{}", words[i - 1], w);
                    break;
                }
            }
            let duplex = words.iter().find_map(|w| match w.to_ascii_lowercase().as_str() {
                "full" => Some("full"),
                "half" => Some("half"),
                _ => None,
            });
            let mut f = vec![("iface".into(), ifc.clone())];
            if !speed.is_empty() {
                f.push(("speed".into(), speed.clone()));
            }
            if let Some(d) = duplex {
                f.push(("duplex".into(), d.to_string()));
            }
            let detail = match (speed.is_empty(), duplex) {
                (false, Some(d)) => format!(" ({speed}, {d} duplex)"),
                (false, None) => format!(" ({speed})"),
                _ => String::new(),
            };
            Some(("eth_link_up", Sev::Info, f, format!("{ifc} link up{detail}")))
        }
        _ => None,
    }
}

/// Splits kmsg reads into records (one per read on the device; arbitrary
/// chunks from a test file), bounded.
#[derive(Default)]
pub struct Lines {
    pending: Vec<u8>,
}

impl Lines {
    pub fn feed(&mut self, data: &[u8], mut f: impl FnMut(&[u8])) {
        let mut rest = data;
        while let Some(i) = rest.iter().position(|&b| b == b'\n') {
            if self.pending.is_empty() {
                f(&rest[..i]);
            } else {
                self.pending.extend_from_slice(&rest[..i]);
                f(&self.pending);
                self.pending.clear();
            }
            rest = &rest[i + 1..];
        }
        if self.pending.len() + rest.len() <= 16 * 1024 {
            self.pending.extend_from_slice(rest);
        } else {
            self.pending.clear();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Fixture records in /dev/kmsg's format (RM551E-style plus generic).
    pub(crate) const FIXTURE: &str = "\
6,1,0,-;Booting Linux on physical CPU 0x0000000000 [0x412fd050]
6,812,15234567,-;remoteproc remoteproc0: powering up 4080000.remoteproc-mss
3,1501,812345678,-;qcom_q6v5_pas 4080000.remoteproc-mss: fatal error received: err_qdi.c:1141:EF:mss:0x1:WLAN
 SUBSYSTEM=platform
 DEVICE=+platform:4080000.remoteproc-mss
3,1502,812345700,-;remoteproc remoteproc0: crash detected in 4080000.remoteproc-mss: type fatal error
6,1510,820000000,-;remoteproc remoteproc0: remote processor 4080000.remoteproc-mss is now up
4,1600,900000000,-;stress invoked oom-killer: gfp_mask=0x100cca(GFP_HIGHUSER_MOVABLE), order=0, oom_score_adj=0
3,1601,900000100,-;Out of memory: Killed process 4321 (stress) total-vm:812345kB, anon-rss:700000kB, file-rss:0kB
6,1700,950000000,-;r8125 0000:01:00.0 eth0: Link is Up - 1Gbps/Full - flow control rx/tx
6,1701,960000000,-;r8125 0000:01:00.0 eth0: Link is Down
6,1702,961000000,-;stmmac 23040000.ethernet eth1: Link is Up - 100Mbps/Half - flow control off
2,1800,970000000,-;thermal thermal_zone3: critical temperature reached (125 C), shutting down
0,1801,970000100,-;Kernel panic - not syncing: Fatal exception
1,1802,970000200,-;msm_watchdog: Watchdog bark! Now = 970.000200
4,1803,970000300,-;BUG: scheduling while atomic: swapper/0/0/0x00000002
6,1804,970000400,-;usb 1-1: new high-speed USB device number 2 using xhci-hcd
14,1805,970000500,-;QCMAP: user space line in the kernel ring
";

    #[test]
    fn records_parse_and_continuations_are_skipped() {
        let r = parse_record(b"3,1501,812345678,-;qcom fatal error\x01").unwrap();
        assert_eq!(r, KRec { pri: 3, fac: 0, seq: 1501, usec: 812345678, msg: "qcom fatal error".into() });
        let u = parse_record(b"14,1805,970000500,-;QCMAP: x").unwrap();
        assert_eq!((u.pri, u.fac), (6, 1));
        assert!(parse_record(b" SUBSYSTEM=platform").is_none());
        assert!(parse_record(b"garbage").is_none());
        assert!(parse_record(b"x,1,2,-;m").is_none());
    }

    #[test]
    fn the_filter_keeps_only_the_tagged_set() {
        let mut tags = Vec::new();
        let mut lines = Lines::default();
        lines.feed(FIXTURE.as_bytes(), |l| {
            if let Some(r) = parse_record(l) {
                tags.push((r.seq, classify(&r.msg)));
            }
        });
        let kept: Vec<(u64, &str)> = tags.iter().filter_map(|(s, t)| t.map(|t| (*s, t))).collect();
        assert_eq!(
            kept,
            vec![
                (812, "remoteproc"),
                (1501, "ssr"),
                (1502, "ssr"),
                (1510, "remoteproc"),
                (1600, "oom"),
                (1601, "oom"),
                (1700, "eth"),
                (1701, "eth"),
                (1702, "eth"),
                (1800, "thermal"),
                (1801, "panic"),
                (1802, "watchdog"),
                (1803, "bug"),
            ]
        );
        assert_eq!(classify("usb 1-1: new device"), None);
        assert_eq!(classify("wlan0: link up"), None, "only ethernet links");
    }

    #[test]
    fn events_carry_their_fields() {
        let e = event_of("oom", "Out of memory: Killed process 4321 (stress) total-vm:1kB").unwrap();
        assert_eq!(e.0, "oom_kill");
        assert_eq!(e.1, Sev::Warning);
        assert_eq!(e.2, vec![("proc".to_string(), "stress".to_string()), ("pid".to_string(), "4321".to_string())]);
        assert_eq!(e.3, "Out of memory: killed stress (pid 4321)");
        assert!(event_of("oom", "stress invoked oom-killer: gfp_mask=0x0").is_none());
        let up = event_of("eth", "r8125 0000:01:00.0 eth0: Link is Up - 1Gbps/Full - flow control rx/tx").unwrap();
        assert_eq!((up.0, up.1), ("eth_link_up", Sev::Info));
        assert_eq!(up.2, vec![("iface".into(), "eth0".into()), ("speed".into(), "1Gbps".into()), ("duplex".into(), "full".into())]);
        assert_eq!(up.3, "eth0 link up (1Gbps, full duplex)");
        let up2 = event_of("eth", "r8125: eth0: NIC Link is Up 1000 Mbps Full Duplex").unwrap();
        assert_eq!(up2.2[1], ("speed".into(), "1000Mbps".into()));
        let down = event_of("eth", "r8125 0000:01:00.0 eth0: Link is Down").unwrap();
        assert_eq!((down.0, down.1, down.2.clone(), down.3.as_str()), ("eth_link_down", Sev::Warning, vec![("iface".into(), "eth0".into())], "eth0 link down"));
        assert!(event_of("ssr", "remoteproc fatal error").is_none(), "an SSR is a K row only");
    }

    #[test]
    fn lines_survive_chunked_reads() {
        let mut got = Vec::new();
        let mut l = Lines::default();
        for chunk in FIXTURE.as_bytes().chunks(7) {
            l.feed(chunk, |x| got.push(x.to_vec()));
        }
        assert_eq!(got.len(), FIXTURE.lines().count());
        assert_eq!(got[2], FIXTURE.lines().nth(2).unwrap().as_bytes());
    }
}
