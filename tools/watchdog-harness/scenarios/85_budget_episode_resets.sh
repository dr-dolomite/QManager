# R3: Tier 4 only, budget spent. The first outage skips Tier 4 with the
# wd_budget_spent event and pauses; the link comes back at pass 9 (episode
# over); the second outage at pass 11 fires the event again.
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_2() { mset reachable false; }
sc_pass_9() { mset reachable true; }
sc_pass_11() { mset reachable false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
