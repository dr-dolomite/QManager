//! The default data call, for the WDS packet-statistics bind (broker 0.6.0).
//!
//! - **Mux id.** The default call's netdev is the `rmnet_data<N>` interface
//!   holding the IPv4 default route (Destination `00000000`, RTF_UP) in
//!   `/proc/net/route`; its mux id is N + 1 (verified on the RM551E,
//!   2026-10-23: rmnet_data0..5 -> mux 1..6, rmnet_data15 -> 16). Several
//!   default routes: the lowest metric wins. No such route: no call, so
//!   nothing is bound and the sidecar's WDS values stay empty. A v6-only call
//!   (no IPv4 default route) is not detected.
//! - **Endpoint.** Qualcomm's `ds_get_epid` maps the netdev family to the
//!   data endpoint: `rmnet_ipa*` -> (4, 1) (embedded / IPA). On this platform
//!   the data netdevs are children of `rmnet_ipa0`, so the bind uses (4, 1)
//!   only while `/sys/class/net/rmnet_ipa0` exists; otherwise nothing is
//!   bound (fail closed).
//!
//! Re-read every sidecar cycle (a small procfs read), so a new call or a
//! moved mux is picked up within one cycle.

use crate::qmi::codec::wds::{Endpoint, EP_IPA};
use std::path::Path;

pub const ROUTE_PATH: &str = "/proc/net/route";
pub const IPA_DEV_PATH: &str = "/sys/class/net/rmnet_ipa0";

const RTF_UP: u32 = 0x0001;

/// The mux id of the default IPv4 route's `rmnet_data<N>` netdev.
pub fn default_mux(route: &str) -> Option<u8> {
    let mut best: Option<(u32, u8)> = None;
    for line in route.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        let (iface, dest, flags, metric) = match (f.first(), f.get(1), f.get(3), f.get(6)) {
            (Some(i), Some(d), Some(fl), Some(m)) => (*i, *d, *fl, *m),
            _ => continue,
        };
        if dest != "00000000" {
            continue;
        }
        match u32::from_str_radix(flags, 16) {
            Ok(fl) if fl & RTF_UP != 0 => {}
            _ => continue,
        }
        let mux = match iface.strip_prefix("rmnet_data").and_then(|n| n.parse::<u8>().ok()).and_then(|n| n.checked_add(1)) {
            Some(m) => m,
            None => continue,
        };
        let metric = metric.parse::<u32>().unwrap_or(u32::MAX);
        if best.map_or(true, |(bm, _)| metric < bm) {
            best = Some((metric, mux));
        }
    }
    best.map(|(_, m)| m)
}

/// What the sampler binds to this cycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Call {
    /// The default call's mux id; None = no call.
    pub mux: Option<u8>,
    /// The bind endpoint; None = unknown platform, do not bind.
    pub ep: Option<Endpoint>,
}

pub fn discover(route_path: &str, ipa_dev: &str) -> Call {
    let mux = std::fs::read_to_string(route_path).ok().and_then(|r| default_mux(&r));
    let ep = Path::new(ipa_dev).exists().then_some(EP_IPA);
    Call { mux, ep }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HDR: &str = "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n";

    fn route(rows: &[&str]) -> String {
        let mut s = HDR.to_string();
        for r in rows {
            s.push_str(r);
            s.push('\n');
        }
        s
    }

    #[test]
    fn the_default_rmnet_data_route_gives_n_plus_one() {
        // RM551E shape: default via rmnet_data0, a LAN bridge and a /29 on it.
        let r = route(&[
            "rmnet_data0\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data0\t0000000A\t00000000\t0001\t0\t0\t0\tF8FFFFFF\t0\t0\t0",
            "br-lan\t0001A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0",
        ]);
        assert_eq!(default_mux(&r), Some(1));
        for (n, want) in [(5u8, 6u8), (15, 16)] {
            let r = route(&[&format!("rmnet_data{n}\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0")]);
            assert_eq!(default_mux(&r), Some(want));
        }
    }

    #[test]
    fn no_call_or_odd_routes_give_none() {
        assert_eq!(default_mux(""), None);
        assert_eq!(default_mux(HDR), None);
        // Default via something else, not a data netdev.
        assert_eq!(default_mux(&route(&["br-lan\t00000000\t0101A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0"])), None);
        // A non-default route on rmnet_data only.
        assert_eq!(default_mux(&route(&["rmnet_data2\t0000000A\t00000000\t0001\t0\t0\t0\tF8FFFFFF\t0\t0\t0"])), None);
        // Down route, bad names, mux id overflow, short line.
        for row in [
            "rmnet_data0\t00000000\t00000000\t0000\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_datax\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data255\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data-1\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0",
            "rmnet_data0\t00000000\t00000000",
        ] {
            assert_eq!(default_mux(&route(&[row])), None, "{row}");
        }
    }

    #[test]
    fn the_lowest_metric_default_route_wins() {
        let r = route(&[
            "rmnet_data3\t00000000\t00000000\t0001\t0\t0\t20\t00000000\t0\t0\t0",
            "rmnet_data1\t00000000\t00000000\t0001\t0\t0\t10\t00000000\t0\t0\t0",
        ]);
        assert_eq!(default_mux(&r), Some(2));
    }

    #[test]
    fn discover_fails_closed_without_rmnet_ipa0() {
        let d = std::env::temp_dir().join(format!("qatd-call-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let rp = d.join("route");
        std::fs::write(&rp, route(&["rmnet_data4\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0"])).unwrap();
        let ipa = d.join("rmnet_ipa0");
        let c = discover(rp.to_str().unwrap(), ipa.to_str().unwrap());
        assert_eq!(c, Call { mux: Some(5), ep: None });
        std::fs::create_dir(&ipa).unwrap();
        assert_eq!(discover(rp.to_str().unwrap(), ipa.to_str().unwrap()), Call { mux: Some(5), ep: Some(EP_IPA) });
        assert_eq!(discover(d.join("nope").to_str().unwrap(), ipa.to_str().unwrap()).mux, None);
        let _ = std::fs::remove_dir_all(&d);
    }
}
