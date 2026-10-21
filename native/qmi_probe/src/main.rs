//! qmi_probe: Phase 0 read-only QMI probe for the RM551E (see
//! docs/plans/2026-10-22-qmi-offload-revisit.md).
//!
//! Sends only whitelisted *Get* messages. The one stateful call is NAS
//! Indication Register in `watch`, which is per-client and released when
//! the socket closes; it changes no modem configuration.
//!
//!   qmi_probe json [sig cell rf ca serving sysinfo ...]   one JSON line
//!   qmi_probe get <svc>:<msg>                             hex dump (whitelisted)
//!   qmi_probe bench <cmd> <n> [hz]                        latency / rate / CPU
//!   qmi_probe watch <secs>                                NAS indications

mod decode;
mod qrtr;

use decode::{arr, J};
use qrtr::{Client, Msg, Tlv};
use std::collections::HashMap;
use std::process::exit;
use std::time::{Duration, Instant};

const SVC_WDS: u32 = 1;
const SVC_DMS: u32 = 2;
const SVC_NAS: u32 = 3;
const SVC_UIM: u32 = 11;
const SVC_DSD: u32 = 42;

/// (service, message) pairs the probe may send. All are Get/query messages.
const WHITELIST: &[(u32, u16)] = &[
    (SVC_NAS, 0x0020), // Get Signal Strength
    (SVC_NAS, 0x0024), // Get Serving System
    (SVC_NAS, 0x0031), // Get RF Band Info
    (SVC_NAS, 0x0034), // Get System Selection Preference
    (SVC_NAS, 0x0043), // Get Cell Location Info
    (SVC_NAS, 0x004D), // Get Sys Info
    (SVC_NAS, 0x004F), // Get Signal Info
    (SVC_NAS, 0x005A), // Get Tx Rx Info
    (SVC_NAS, 0x00AC), // Get LTE CPHY CA Info
    (SVC_DMS, 0x0022), // Get Model
    (SVC_DMS, 0x0023), // Get Revision
    (SVC_DMS, 0x0025), // Get IDs
    (SVC_DMS, 0x002D), // Get Operating Mode
    (SVC_DMS, 0x002F), // Get Time
    (SVC_UIM, 0x002F), // Get Card Status
    (SVC_UIM, 0x0047), // Get Slots Status
    (SVC_WDS, 0x0024), // Get Packet Statistics
    (SVC_WDS, 0x002A), // Get Profile List
    (SVC_WDS, 0x002D), // Get Current Settings
    (SVC_DSD, 0x0024), // Get System Status
];

struct Svc {
    clients: HashMap<u32, Client>,
}

impl Svc {
    fn get(&mut self, svc: u32) -> &mut Client {
        if !self.clients.contains_key(&svc) {
            let (node, port) = match qrtr::lookup(svc, Duration::from_millis(500)) {
                Ok(Some(x)) => x,
                Ok(None) => die(&format!("service {} not found", svc)),
                Err(e) => die(&format!("qrtr unavailable: {}", e)),
            };
            let c = Client::connect(node, port, Duration::from_secs(3))
                .unwrap_or_else(|e| die(&format!("socket: {}", e)));
            self.clients.insert(svc, c);
        }
        self.clients.get_mut(&svc).unwrap()
    }

    fn call(&mut self, svc: u32, id: u16, tlvs: &[Tlv]) -> Result<(Msg, Duration), String> {
        if !WHITELIST.contains(&(svc, id)) {
            return Err(format!("refused {}:{:#06x} (not whitelisted)", svc, id));
        }
        self.get(svc).request(id, tlvs).map_err(|e| e.to_string())
    }
}

fn die(msg: &str) -> ! {
    eprintln!("qmi_probe: {}", msg);
    exit(1)
}

fn tlv(t: u8, v: &[u8]) -> Tlv {
    Tlv { t, v: v.to_vec() }
}

/// Named command → (service, message, request TLVs, decoder).
fn named(cmd: &str) -> Option<(u32, u16, Vec<Tlv>, fn(&Msg) -> String)> {
    Some(match cmd {
        "sig" => (SVC_NAS, 0x004F, vec![], decode::sig),
        "cell" => (SVC_NAS, 0x0043, vec![], decode::cell),
        "rf" => (SVC_NAS, 0x0031, vec![], decode::rf),
        "ca" => (SVC_NAS, 0x00AC, vec![], decode::ca),
        "serving" => (SVC_NAS, 0x0024, vec![], decode::serving),
        "sysinfo" => (SVC_NAS, 0x004D, vec![], decode::dump),
        "syssel" => (SVC_NAS, 0x0034, vec![], decode::dump),
        "txrx-lte" => (SVC_NAS, 0x005A, vec![tlv(0x01, &[0x08])], decode::dump),
        "txrx-nr" => (SVC_NAS, 0x005A, vec![tlv(0x01, &[0x0c])], decode::dump),
        "ids" => (SVC_DMS, 0x0025, vec![], decode::strings),
        "rev" => (SVC_DMS, 0x0023, vec![], decode::strings),
        "model" => (SVC_DMS, 0x0022, vec![], decode::strings),
        "opmode" => (SVC_DMS, 0x002D, vec![], decode::dump),
        "time" => (SVC_DMS, 0x002F, vec![], decode::dump),
        "card" => (SVC_UIM, 0x002F, vec![], decode::card),
        "slots" => (SVC_UIM, 0x0047, vec![], decode::dump),
        // Mask: tx/rx packets, errors, drops, bytes (bits 0-7).
        "wds-stats" => (SVC_WDS, 0x0024, vec![tlv(0x01, &0x0000_00ffu32.to_le_bytes())], decode::dump),
        "wds-profiles" => (SVC_WDS, 0x002A, vec![tlv(0x10, &[0x00])], decode::dump),
        // Mask: profile, APN, IP family, DNS, address, gateway, MTU.
        "wds-current" => (SVC_WDS, 0x002D, vec![tlv(0x10, &0x0000_ffffu32.to_le_bytes())], decode::dump),
        "dsd-status" => (SVC_DSD, 0x0024, vec![], decode::dump),
        _ => return None,
    })
}

fn mono_ms() -> u128 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u128 * 1000 + ts.tv_nsec as u128 / 1_000_000
}

fn ms(d: Duration) -> f64 {
    d.as_micros() as f64 / 1000.0
}

/// utime+stime of this process in ms (USER_HZ = 100 on this kernel).
fn cpu_ms() -> u64 {
    let s = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    let rest = s.rsplit(") ").next().unwrap_or("");
    let f: Vec<&str> = rest.split_whitespace().collect();
    let t = |i: usize| f.get(i).and_then(|x| x.parse::<u64>().ok()).unwrap_or(0);
    (t(11) + t(12)) * 10
}

fn run_one(s: &mut Svc, cmd: &str) -> String {
    let (svc, id, tlvs, dec) = match named(cmd) {
        Some(x) => x,
        None => return format!("{{\"error\":\"unknown command {}\"}}", cmd),
    };
    match s.call(svc, id, &tlvs) {
        Err(e) => {
            let mut j = J::obj();
            j.str("error", &e);
            j.done()
        }
        Ok((m, rtt)) => {
            let body = dec(&m);
            let mut j = J::obj();
            j.f1("rtt_ms", ms(rtt));
            match m.result() {
                Ok(()) => j.str("result", "ok"),
                Err(ec) => j.str("result", &format!("err_{:#06x}", ec)),
            };
            j.raw("data", &body);
            j.done()
        }
    }
}

fn cmd_json(s: &mut Svc, cmds: &[String]) {
    let defaults = ["serving", "sig", "cell", "rf", "ca"];
    let list: Vec<String> = if cmds.is_empty() {
        defaults.iter().map(|x| x.to_string()).collect()
    } else {
        cmds.to_vec()
    };
    let t0 = Instant::now();
    let mut j = J::obj();
    j.num("mono_ms", mono_ms());
    for c in &list {
        let r = run_one(s, c);
        j.raw(c, &r);
    }
    j.f1("total_ms", ms(t0.elapsed()));
    println!("{}", j.done());
}

fn parse_svcmsg(a: &str) -> Option<(u32, u16)> {
    let (sv, mg) = a.split_once(':')?;
    let svc = sv.parse().ok()?;
    let msg = u16::from_str_radix(mg.trim_start_matches("0x"), 16).ok()?;
    Some((svc, msg))
}

fn cmd_bench(s: &mut Svc, cmd: &str, n: usize, hz: f64) {
    let (svc, id, tlvs, dec) = named(cmd).unwrap_or_else(|| die("unknown command"));
    let period = if hz > 0.0 { Duration::from_secs_f64(1.0 / hz) } else { Duration::ZERO };
    let mut rtts = Vec::with_capacity(n);
    let (mut fails, mut changes) = (0usize, 0usize);
    let mut last = String::new();
    let c0 = cpu_ms();
    let t0 = Instant::now();
    for i in 0..n {
        let tick = t0 + period * i as u32;
        let now = Instant::now();
        if tick > now {
            std::thread::sleep(tick - now);
        }
        match s.call(svc, id, &tlvs) {
            Ok((m, rtt)) if m.result().is_ok() => {
                rtts.push(rtt);
                let body = dec(&m);
                if body != last {
                    changes += 1;
                    last = body;
                }
            }
            _ => fails += 1,
        }
    }
    let wall = t0.elapsed();
    let cpu = cpu_ms() - c0;
    rtts.sort();
    let pct = |p: f64| rtts.get(((rtts.len() as f64 - 1.0) * p) as usize).map(|d| ms(*d)).unwrap_or(0.0);
    let mut j = J::obj();
    j.str("cmd", cmd)
        .num("n", n)
        .f1("hz", hz)
        .num("ok", rtts.len())
        .num("fail", fails)
        .num("distinct_values", changes)
        .f1("p50_ms", pct(0.5))
        .f1("p95_ms", pct(0.95))
        .f1("max_ms", pct(1.0))
        .f1("wall_ms", ms(wall))
        .num("cpu_ms", cpu)
        .f1("cpu_pct", if wall.as_millis() > 0 { cpu as f64 * 100.0 / wall.as_millis() as f64 } else { 0.0 });
    println!("{}", j.done());
    if cmd == "sig" || cmd == "cell" {
        println!("{}", last);
    }
}

fn cmd_watch(s: &mut Svc, secs: u64) {
    // NAS Indication Register: serving system (0x13), sys info (0x18),
    // signal info (0x19). Per-client; released on close.
    let req = [tlv(0x13, &[1]), tlv(0x18, &[1]), tlv(0x19, &[1])];
    let c = s.get(SVC_NAS);
    match c.request(0x0003, &req) {
        Ok((m, _)) => {
            if let Err(ec) = m.result() {
                die(&format!("indication register failed: {:#06x}", ec));
            }
        }
        Err(e) => die(&format!("indication register: {}", e)),
    }
    eprintln!("watching NAS indications for {} s", secs);
    let end = Instant::now() + Duration::from_secs(secs);
    let mut counts: HashMap<u16, usize> = HashMap::new();
    while Instant::now() < end {
        let left = end.saturating_duration_since(Instant::now());
        c.set_timeout(left.max(Duration::from_millis(10)));
        let m = match c.next_indication() {
            Ok(m) => m,
            Err(_) => break,
        };
        *counts.entry(m.id).or_default() += 1;
        let body = match m.id {
            0x0051 => decode::sig(&m),
            0x0024 => decode::serving(&m),
            _ => decode::dump(&m),
        };
        println!("{{\"mono_ms\":{},\"ind\":\"{:#06x}\",\"data\":{}}}", mono_ms(), m.id, body);
    }
    let items: Vec<String> = counts.iter().map(|(k, v)| format!("\"{:#06x}\":{}", k, v)).collect();
    println!("{{\"summary\":{{{}}}}}", items.join(","));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut s = Svc { clients: HashMap::new() };
    match args.first().map(|x| x.as_str()) {
        Some("json") => cmd_json(&mut s, &args[1..]),
        Some("get") => {
            let (svc, id) = args.get(1).and_then(|a| parse_svcmsg(a)).unwrap_or_else(|| die("usage: get <svc>:<msg>"));
            match s.call(svc, id, &[]) {
                Ok((m, rtt)) => {
                    let tl: Vec<String> = m.tlvs.iter().map(|t| format!("{{\"t\":\"{:02x}\",\"hex\":\"{}\"}}", t.t, decode::hex(&t.v))).collect();
                    println!("{{\"rtt_ms\":{:.2},\"tlvs\":{}}}", ms(rtt), arr(&tl));
                }
                Err(e) => die(&e),
            }
        }
        Some("bench") => {
            let cmd = args.get(1).map(|x| x.as_str()).unwrap_or("sig");
            let n = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(100);
            let hz = args.get(3).and_then(|x| x.parse().ok()).unwrap_or(0.0);
            cmd_bench(&mut s, cmd, n, hz);
        }
        Some("watch") => {
            let secs = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(30);
            cmd_watch(&mut s, secs);
        }
        _ => {
            eprintln!("usage: qmi_probe json [cmd..] | get <svc>:<msg> | bench <cmd> <n> [hz] | watch <secs>");
            exit(2);
        }
    }
}
