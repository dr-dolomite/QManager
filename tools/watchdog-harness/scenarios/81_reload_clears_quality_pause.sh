# R2: a settings reload ends the quality pause and resets its growth. As in 80
# the first pause (15 min) is ended by a clean window and the second exhausted
# ladder pauses 30 minutes (level 1). A reload at pass 20 ends that pause and
# puts the level back to 0, so the next exhausted ladder pauses 15 minutes.
SC_PASSES=30
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_8() { mset q_loss 0; }
sc_pass_11() { mset q_loss 50; }
sc_pass_20() { h_touch qmanager_watchcat_reload; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
