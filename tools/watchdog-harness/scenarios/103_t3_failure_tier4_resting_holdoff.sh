# R3 follow-up: a failed Tier 3 with a resting Tier 4 ends straight in the
# outage hold-off. The hourly budget is spent (3 rows), Tier 3 swaps to a
# backup slot whose link is down too, the cooldown fails and the swap is
# reverted; no "escalating to Tier 4" event, one "reboot limit reached"
# event, then the 15 minute outage pause.
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 false
    crash_log_add 300 tier4_escalation
    crash_log_add 200 tier4_escalation
    crash_log_add 100 tier4_escalation
}
sc_pass_2() { mset link_slot_1 false; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev mem=$_wd_guard_mem guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
