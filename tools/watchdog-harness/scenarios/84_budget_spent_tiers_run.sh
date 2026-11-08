# R3: the hourly reboot budget is spent (3 tier4_escalation rows in the hour).
# The outage ladder runs Tier 1 and Tier 2 as usual, Tier 4 rests (skipped like
# a disabled tier: "reboot limit reached (3 per hour)" once, then the outage
# pause). The pause is cut to 60 s, and the second ladder of the same episode
# skips Tier 4 again without a second event. Never enabled=0, no disabled
# flag, no retire (calls.log has no uci set / watchcat_init).
SC_PASSES=30
sc_setup() {
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_2() { mset reachable false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
