# R3 follow-up: the guard file cannot be written (read-only state dir). The
# budget is spent in this hour and the previous one with no link-up, so the
# guard engages at start: one "could not be saved" warning, one long_outage
# event, and Tier 4 rests for the whole run from the in-memory epoch (mem).
# The per-minute recounts (t+90 .. t+210) neither re-engage nor re-announce.
# Tiers 1-3 are off and the link is down: gate none, no ladder.
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
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; chmod 555 "$H_ROOT/etc/qmanager"; }
sc_pass_24() { chmod 755 "$H_ROOT/etc/qmanager"; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev mem=$_wd_guard_mem guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
