# R5 (contract Amendment 2): on a quiet ping (interval 10 s) a quality cooldown
# waits max(step_wait_eff, 10 x 10 + 10) = 110 s, so its window holds 10 samples
# and the verdict is reached without an extension: Tier 1 clears the loss and
# the cooldown succeeds at once.
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset ping_interval 10
}
sc_pass_2() { mset q_loss 50; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier until=$step_wait_until left=$cooldown_remaining retries=$cooldown_stale_retries tried=[$tiers_tried] iv=$wd_ping_interval"
}
