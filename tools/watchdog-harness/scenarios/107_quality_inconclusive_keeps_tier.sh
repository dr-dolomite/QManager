# R5: a quality Tier 1 cooldown gets no data (the ping cache goes stale): three
# extensions, then inconclusive, current_tier 1 kept. The cache comes back with
# the loss unchanged; once the breach has lasted quality_after_sec again the
# next quality ladder resumes at Tier 2, which fails, and the quality cap (Tier
# 2) ends the episode in the 15 minute quality pause.
SC_PASSES=40
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_21() { mset ping_stale 0; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier reason=$recovery_reason tried=[$tiers_tried] until=$step_wait_until left=$cooldown_remaining q_left=$(wd_holdoff_left quality)"
}
