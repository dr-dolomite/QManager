# R11b: two carriers end the carrier pause early (holdoff_until null at pass 12)
# and keep its level. One carrier again from pass 13: the next exhausted ladder
# within the hour pauses 30 minutes (level 1).
SC_PASSES=22
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_12() { mset cc 2; }
sc_pass_13() { mset cc 1; }
sc_snap_extra() {
    echo "cc=$carrier_cc since=$carrier_single_since tier=$current_tier c_left=$(wd_holdoff_left carrier) c_level=$wd_hold_c_level c_end=$wd_hold_c_end"
}
