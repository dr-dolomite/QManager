# R3: Tier 4 only, budget spent by rows 3500/3400/3300 s old. reboot_rest_until
# is the mono at which the oldest row leaves the hour (t+101 = mono 5101). The
# first ladder rests Tier 4 and pauses 60 s; the next ladder after the row has
# aged out runs Tier 4 (crash.log row, reboot).
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_add 3500 tier4_escalation
    crash_log_add 3400 tier4_escalation
    crash_log_add 3300 tier4_escalation
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_2() { mset reachable false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
