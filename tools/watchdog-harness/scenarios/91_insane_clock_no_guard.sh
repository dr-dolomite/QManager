# R3: 1970 clock. Three clock-less boot rows spend the budget (hourly, no
# deadline: reboot_rest_until null), and the rows that would engage the guard
# on a sane clock are not evaluated: no guard, and the reachable start writes
# no link-up stamp. The clock turns sane at pass 8: the next evaluation (the
# refresh on the next due outage pass, t+100) sees both hours spent with no
# link-up and engages the guard.
SC_PASSES=14
sc_setup() {
    QM_TEST_YEAR=1970
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_epoch 400 tier4_escalation
    crash_log_epoch 500 tier4_escalation
    crash_log_epoch 600 tier4_escalation
    crash_log_add 5000 tier4_escalation
    crash_log_add 4500 tier4_escalation
    crash_log_add 4000 tier4_escalation
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_3() { mset reachable false; }
sc_pass_8() { QM_TEST_YEAR=2026; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
