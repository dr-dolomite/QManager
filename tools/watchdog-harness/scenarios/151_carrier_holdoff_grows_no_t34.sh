# R11b: one carrier that no tier fixes. Tier 3 is armed with a backup slot and
# Tier 4 is enabled, yet the carrier ladder runs Tier 1, Tier 2, then the 15
# minute carrier pause (level 0): no AT+QUIMSLOT, no reboot. The run keeps
# counting under the pause, so the ladder starts again when it ends, and the
# second exhausted ladder within the hour pauses 30 minutes (level 1).
SC_PASSES=30
sc_post_source() { CFG_CHECK_INTERVAL=60; }
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.tier4_enabled 1
    mset slot 1
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_snap_extra() {
    echo "cc=$carrier_cc since=$carrier_single_since tier=$current_tier reason=$recovery_reason c_left=$(wd_holdoff_left carrier) c_level=$wd_hold_c_level c_end=$wd_hold_c_end"
}
