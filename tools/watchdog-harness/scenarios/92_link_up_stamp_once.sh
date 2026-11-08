# R3: one watchdog reboot 100 s ago, budget free. The first reachable read
# writes the link-up stamp (one log line, one durable write); later reachable
# passes, a short outage and the link coming back do not write it again.
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
    crash_log_add 100 tier4_escalation
}
sc_pass_5() { mset reachable false; }
sc_pass_7() { mset reachable true; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
