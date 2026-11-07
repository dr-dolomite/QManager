# Config reload that changes thresholds, quality presets (incl. a bad custom
# value that must fall back) and tier set; then an outage is handled with the
# new act_after_sec of 30 (was fail_threshold 5).
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() {
    uci_set quecmanager.watchcat.act_after_sec 30
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.primary_recheck_interval 5
    uci_set quecmanager.quality_thresholds.latency_preset custom
    uci_set quecmanager.quality_thresholds.latency_custom_ms abc
    uci_set quecmanager.quality_thresholds.loss_preset standard
    h_touch qmanager_watchcat_reload
}
sc_pass_4() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
