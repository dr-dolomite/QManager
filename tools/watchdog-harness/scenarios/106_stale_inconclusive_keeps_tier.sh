# R5: the ping cache goes stale during the Tier 1 cooldown. Three one-pass
# extensions (the deadline moves 10 s each), then the verdict is inconclusive:
# monitor with current_tier 1 and tiers_tried [1] kept. The cache comes back with
# the link still down, so the next trigger resumes at Tier 2 (not Tier 1);
# Tier 2 restores the link and the success clears tier and tiers_tried.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { mset ping_stale 0; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier tried=[$tiers_tried] until=$step_wait_until left=$cooldown_remaining retries=$cooldown_stale_retries mono=$(mono_now)"
}
