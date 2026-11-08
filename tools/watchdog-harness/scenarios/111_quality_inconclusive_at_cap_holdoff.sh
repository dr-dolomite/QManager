# R5: Tier 1 is off, so the quality ladder runs Tier 2; its cooldown gets no
# data (stale cache) and goes inconclusive with Tier 2 kept. When the breach
# triggers again, the quality cap leaves no tier after Tier 2: the trigger ends
# the episode in the 15 minute quality pause without running anything.
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_21() { mset ping_stale 0; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=1) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "tier=$current_tier reason=$recovery_reason tried=[$tiers_tried] q_left=$(wd_holdoff_left quality)"
}
