# R2: consecutive quality pauses grow 15 -> 30 -> 60 minutes. Quality on, Tier 1
# only, the loss never clears and the link stays reachable throughout, so the
# quality pause is never ended by reachability. Each exhausted quality ladder
# starts a longer pause (holdoff_quality_level 0, 1, 2, then capped at 2; events
# name 15, 30, 60 and 60 minutes); while a pause runs no AT is sent.
# Check interval 60 keeps the run short.
SC_PASSES=125
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
