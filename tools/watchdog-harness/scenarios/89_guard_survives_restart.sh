# R3 long-run guard: a guard engaged before this start (seeded file, 2 h ago)
# and no reboot in the last two hours. It is read at start and Tier 4 rests
# with long_outage although the hourly budget is free; the link is down
# from the start, so it is not released.
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    mset reachable false
    crash_log_add 9000 tier4_escalation
    printf '%s\n' "$(( $(h_now) - 7200 ))" > "$H_ROOT/etc/qmanager/wd_reboot_guard"
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
