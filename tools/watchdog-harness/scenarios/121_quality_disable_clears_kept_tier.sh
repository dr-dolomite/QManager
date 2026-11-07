# R5 follow-up: a quality cooldown with no data ends inconclusive and keeps
# Tier 1 (quality episode). Quality is then disabled: the kept quality tier
# and tiers_tried are cleared at once instead of lingering while it is off.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_21() { mset ping_stale 0; uci_set quecmanager.watchcat.quality_enabled 0; h_touch qmanager_watchcat_reload; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier tried=[$tiers_tried] reason=$recovery_reason quality=$CFG_QUALITY_ENABLED"
}
