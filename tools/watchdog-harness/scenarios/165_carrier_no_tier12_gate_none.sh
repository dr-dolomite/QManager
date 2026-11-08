# R11b: with Tier 1 and Tier 2 disabled the carrier start gate is "none" even
# though Tier 3 (backup slot armed) and Tier 4 are enabled: the carrier ladder
# is Tier 1-2 only, so one carrier for the whole window runs nothing. Two
# carriers at pass 1 arm the trigger, one carrier from pass 2; the run is far
# past carrier_after_min (5 min) by pass 60, yet there is no AT command, no
# AT+QUIMSLOT, no reboot and no event, the state stays monitor, and the run
# keeps growing (carrier_single_secs in the state file).
SC_PASSES=60
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.tier4_enabled 1
    mset slot 1
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} armed=$carrier_armed since=$carrier_single_since tier=$current_tier gate=$(wd_start_gate carrier)"
}
