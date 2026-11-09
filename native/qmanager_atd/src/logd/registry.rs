//! Event type → category (`cat`). Seeded from every `append_event "<type>"`
//! in `scripts/`, the frontend's `NetworkEventType`, the History-only types
//! and the plan §2.8 catalogue. Unknown types are kept as `other`.

pub const CATEGORIES: [&str; 8] = ["cellular", "connection", "system", "config", "security", "lan", "alerts", "other"];

const TABLE: &[(&str, &str)] = &[
    // Cellular (radio, SIM, registration).
    ("network_mode", "cellular"),
    ("band_change", "cellular"),
    ("pci_change", "cellular"),
    ("scc_pci_change", "cellular"),
    ("ca_change", "cellular"),
    ("nr_anchor", "cellular"),
    ("signal_lost", "cellular"),
    ("signal_restored", "cellular"),
    ("airplane_mode", "cellular"),
    ("sim_swap_detected", "cellular"),
    ("apn_reapplied", "cellular"),
    ("apn_reapply_failed", "cellular"),
    ("verizon_mpdn_applied", "cellular"),
    ("verizon_mpdn_reverted", "cellular"),
    ("apn_changed", "cellular"),
    ("band_lock_changed", "cellular"),
    ("tower_lock_changed", "cellular"),
    ("band_failover", "cellular"),
    ("tower_failover", "cellular"),
    ("sim_switched", "cellular"),
    ("registration_changed", "cellular"),
    ("imei_changed", "cellular"),
    ("rat_priority_changed", "cellular"),
    ("fplmn_cleared", "cellular"),
    ("scenario_switched", "cellular"),
    // Connection (data path and reachability).
    ("internet_lost", "connection"),
    ("internet_restored", "connection"),
    ("high_latency", "connection"),
    ("latency_recovered", "connection"),
    ("high_packet_loss", "connection"),
    ("packet_loss_recovered", "connection"),
    ("watchcat_recovery", "connection"),
    ("sim_failover", "connection"),
    ("wan_address_changed", "connection"),
    ("data_call_dropped", "connection"),
    ("data_call_restored", "connection"),
    ("data_cid_changed", "connection"),
    ("dns_changed", "connection"),
    ("ttl_mtu_changed", "connection"),
    ("dns_failing", "connection"),
    ("dns_recovered", "connection"),
    ("site_down", "connection"),
    ("site_up", "connection"),
    ("vpn_up", "connection"),
    ("vpn_down", "connection"),
    ("speedtest_completed", "connection"),
    // LAN.
    ("lan_address_changed", "lan"),
    ("eth_link_up", "lan"),
    ("eth_link_down", "lan"),
    // System health.
    ("thermal_throttled", "system"),
    ("thermal_recovered", "system"),
    ("device_reboot", "system"),
    ("modem_crash", "system"),
    ("modem_recovered", "system"),
    ("broker_restarted", "system"),
    ("qmi_lane_down", "system"),
    ("qmi_lane_up", "system"),
    ("daemon_restarted", "system"),
    ("oom_kill", "system"),
    ("storage_low", "system"),
    ("software_updated", "system"),
    ("clock_synced", "system"),
    ("clock_stepped", "system"),
    ("watchdog_auto_disabled", "system"),
    // Configuration (profiles, backup / restore).
    ("profile_applied", "config"),
    ("profile_failed", "config"),
    ("profile_deactivated", "config"),
    ("config_backup_collected", "config"),
    // Security.
    ("login_failed", "security"),
    ("login_locked", "security"),
    ("password_changed", "security"),
    // Alerts.
    ("alert_send_failed", "alerts"),
];

/// The category of an event type; `other` when unknown.
pub fn category(ty: &str) -> &'static str {
    if let Some((_, c)) = TABLE.iter().find(|(t, _)| *t == ty) {
        return c;
    }
    if ty.starts_with("config_restore_") {
        return "config";
    }
    "other"
}

/// Types kept past the event day cap (History's keep-list rule), besides
/// every `error` severity event.
pub fn kept_past_cap(ty: &str) -> bool {
    matches!(
        ty,
        "signal_lost"
            | "signal_restored"
            | "internet_lost"
            | "internet_restored"
            | "sim_failover"
            | "data_call_dropped"
            | "data_call_restored"
            | "device_reboot"
            | "modem_crash"
            | "modem_recovered"
            | "thermal_throttled"
            | "thermal_recovered"
    )
}

/// History's cellular series event types: the ones whose `k:"e"` radio is
/// derived from the message prefix and `nr_anchor` (`hist_cellular_radio`)
/// when the writer gave no `radio` field.
pub fn hist_cellular(ty: &str) -> bool {
    matches!(
        ty,
        "signal_lost"
            | "signal_restored"
            | "nr_anchor"
            | "pci_change"
            | "scc_pci_change"
            | "band_change"
            | "ca_change"
            | "band_lock_changed"
            | "tower_lock_changed"
            | "band_failover"
            | "tower_failover"
            | "sim_switched"
            | "registration_changed"
            | "apn_changed"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shell_type_has_a_category_and_unknown_is_other() {
        // Every `append_event "<type>"` in scripts/ as of 2026-11-10.
        for t in [
            "airplane_mode", "apn_reapplied", "apn_reapply_failed", "band_change", "ca_change",
            "config_backup_collected", "config_restore_completed", "config_restore_section_failed",
            "config_restore_section_skipped", "config_restore_section_success", "config_restore_started",
            "high_latency", "high_packet_loss", "internet_lost", "internet_restored", "lan_address_changed",
            "latency_recovered", "network_mode", "nr_anchor", "packet_loss_recovered", "pci_change",
            "profile_applied", "profile_deactivated", "profile_failed", "scc_pci_change", "signal_lost",
            "signal_restored", "sim_failover", "sim_swap_detected", "thermal_recovered", "thermal_throttled",
            "verizon_mpdn_reverted", "watchcat_recovery",
        ] {
            assert_ne!(category(t), "other", "{t}");
        }
        assert_eq!(category("band_change"), "cellular");
        assert_eq!(category("internet_lost"), "connection");
        assert_eq!(category("login_locked"), "security");
        assert_eq!(category("lan_address_changed"), "lan");
        assert_eq!(category("config_restore_whatever"), "config");
        assert_eq!(category("brand_new"), "other");
        for t in ["signal_lost", "signal_restored", "internet_lost", "internet_restored", "sim_failover", "data_call_dropped", "data_call_restored", "device_reboot", "modem_crash", "modem_recovered", "thermal_throttled", "thermal_recovered"] {
            assert!(kept_past_cap(t), "{t}");
        }
        assert!(!kept_past_cap("band_change") && !kept_past_cap("pci_change"));
        assert!(hist_cellular("apn_changed") && hist_cellular("tower_failover") && !hist_cellular("internet_lost"));
        for (_, c) in TABLE {
            assert!(CATEGORIES.contains(c));
        }
    }
}
