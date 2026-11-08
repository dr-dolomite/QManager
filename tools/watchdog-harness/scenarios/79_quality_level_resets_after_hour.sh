# R2: the quality level drops back to 0 after an hour without a quality pause.
# As in 80, the first quality pause (15 min) is ended by a clean window and the
# second exhausted ladder pauses 30 minutes (level 1). That pause runs out at
# pass 45 with the loss still there, so a third ladder runs at once and pauses
# 60 minutes (level 2). The loss clears at pass 47: the clean window ends that
# pause (q_end stamped) and the link stays clean; an hour later (pass 107) the
# level is back to 0 and q_end is cleared. When the loss returns at pass 108
# the next exhausted ladder pauses 15 minutes, not 60.
SC_PASSES=115
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_8() { mset q_loss 0; }
sc_pass_11() { mset q_loss 50; }
sc_pass_47() { mset q_loss 0; }
sc_pass_108() { mset q_loss 50; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
