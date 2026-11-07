# R2: a clean quality window ends the quality pause early. A quality ladder
# (Tier 1 only) is exhausted at pass 5 (15 minute pause). The loss clears at
# pass 8: the next evaluated window is clean and the pause ends (state monitor,
# q_end stamped). The loss is back at pass 11 and the new ladder runs at once;
# exhausted again within the hour, it pauses 30 minutes (level 1).
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.check_interval 60
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_8() { mset q_loss 0; }
sc_pass_11() { mset q_loss 50; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
