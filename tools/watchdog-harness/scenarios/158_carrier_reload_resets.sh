# R11b: a settings reload ends the carrier pause, resets its growth and re-arms
# the trigger. Tier 1, Tier 2, then the 15 minute pause (pass 9). The reload at
# pass 12 ends it; one carrier keeps reading, but the trigger waits for two
# carriers again (no run until pass 15 arms it). The run from pass 16 exhausts
# the ladder again and the pause is 15 minutes (level 0), not 30.
SC_PASSES=26
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_12() { h_touch qmanager_watchcat_reload; }
sc_pass_15() { mset cc 2; }
sc_pass_16() { mset cc 1; }
sc_snap_extra() {
    echo "cc=$carrier_cc armed=$carrier_armed since=$carrier_single_since tier=$current_tier c_left=$(wd_holdoff_left carrier) c_level=$wd_hold_c_level c_end=$wd_hold_c_end"
}
