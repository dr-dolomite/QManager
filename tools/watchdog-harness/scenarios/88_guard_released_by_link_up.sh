# R3 long-run guard: engaged 600 s ago (seeded file), the newest watchdog
# reboot is 700 s old. The first reachable read writes the link-up stamp once
# and releases the guard (file removed). The budget is still spent, so the
# outage at pass 4 finds Tier 4 resting as hourly (no eligible tier: gate none,
# no event), and the guard does not re-engage (the link-up is newer than the
# previous-hour rows).
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_add 4500 tier4_escalation
    crash_log_add 4200 tier4_escalation
    crash_log_add 3900 tier4_escalation
    crash_log_add 900 tier4_escalation
    crash_log_add 800 tier4_escalation
    crash_log_add 700 tier4_escalation
    printf '%s\n' "$(( $(h_now) - 600 ))" > "$H_ROOT/etc/qmanager/wd_reboot_guard"
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_4() { mset reachable false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
