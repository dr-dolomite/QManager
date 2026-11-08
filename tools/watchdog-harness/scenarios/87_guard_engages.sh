# R3 long-run guard: the budget is spent in this hour (rows 3500/3400/3300 s
# old) and in the previous one (5000/4500/4000 s), with no link-up stamp, and
# the link is down from the start. The
# guard engages at start (wd_reboot_guard = start epoch, event "reboots paused
# until the connection comes back", reboot_rest_until = mono 5000 + 86400).
# After the hourly window frees up (t+101) Tier 4 still rests (long_outage)
# and no hourly event fires.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    mset reachable false
    crash_log_add 5000 tier4_escalation
    crash_log_add 4500 tier4_escalation
    crash_log_add 4000 tier4_escalation
    crash_log_add 3500 tier4_escalation
    crash_log_add 3400 tier4_escalation
    crash_log_add 3300 tier4_escalation
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
