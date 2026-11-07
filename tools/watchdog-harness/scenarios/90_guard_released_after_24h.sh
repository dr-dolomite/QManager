# R3 long-run guard: engaged 86300 s ago (seeded), the link stays down. The
# guard holds Tier 4 (long_outage, reboot_rest_until = mono 5100: no eligible
# tier, gate none); the 24 h end passes at t+100, the guard file is removed and
# Tier 4 runs on that pass (reboot).
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    printf '%s\n' "$(( $(h_now) - 86300 ))" > "$H_ROOT/etc/qmanager/wd_reboot_guard"
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_2() { mset reachable false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
