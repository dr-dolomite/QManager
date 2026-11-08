# R3 follow-up: an engaged guard file under an insane (1970) clock. The guard
# (seeded, engaged 2 h ago) and a link-up stamp newer than it are both on disk;
# with an insane clock the guard is neither released nor re-engaged and Tier 4
# keeps resting (long_outage, no deadline). Tiers 1-3 are off, so the resting
# Tier 4 leaves no eligible tier: gate none, no event, no hold-off. The clock
# turns sane at pass 8: the next per-minute recount (t+150) releases the guard on the
# link-up stamp, the start gate goes and Tier 4 reboots (the run ends there).
SC_PASSES=16
sc_setup() {
    QM_TEST_YEAR=1970
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    mset reachable false
    printf '%s\n' "$(( $(h_now) - 7200 ))" > "$H_ROOT/etc/qmanager/wd_reboot_guard"
    printf '%s\n' "$(( $(h_now) - 3600 ))" > "$H_ROOT/etc/qmanager/wd_link_up"
}
sc_post_source() { HOLDOFF_OUTAGE_SECS=60; }
sc_pass_8() { QM_TEST_YEAR=2026; }
sc_snap_extra() {
    echo "rest=${reboot_rest_reason:-none} until=${reboot_rest_until:-null} spent=$reboot_budget_exhausted n=$reboots_this_hour ev=$_wd_budget_ev mem=$_wd_guard_mem guard=$(cat "$H_ROOT/etc/qmanager/wd_reboot_guard" 2>/dev/null || echo -) link_up=$(cat "$H_ROOT/etc/qmanager/wd_link_up" 2>/dev/null || echo -)"
}
