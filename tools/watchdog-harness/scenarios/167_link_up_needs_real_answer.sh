# R3 / spec 5.6: a reachable=true read with streak_success=0 is not a link-up.
# The ping daemon starts every run reachable=true (streak_success 0) while the
# failures accumulate. Budget spent (3 rows, newer than the link-up stamp):
#  - passes 1-3: reachable=true, streak_success=0, streak_fail 1..3 (a link that
#    never came up after the reboot): no stamp;
#  - pass 4: outage; Tier 1 fails, the resting Tier 4 raises the budget event
#    (ev=1);
#  - passes 9-11: the daemon is reachable=true again with streak_success=0 and a
#    growing streak_fail: no stamp, the episode stays open (ev=1);
#  - pass 12: a real answer (streak_success 2): the stamp is written once and
#    the episode ends (ev=0).
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
    mset streak_success 0
    mset streak_fail 1
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_2() { mset streak_fail 2; }
sc_pass_3() { mset streak_fail 3; }
sc_pass_4() { mset reachable false; mset streak_success ""; mset streak_fail ""; }
sc_pass_9() { mset reachable true; mset streak_success 0; mset streak_fail 1; }
sc_pass_10() { mset streak_fail 2; }
sc_pass_11() { mset streak_fail 3; }
sc_pass_12() { mset streak_success 2; mset streak_fail ""; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
