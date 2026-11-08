# R11b: a stale qmi.env is unknown. One carrier from pass 2; qmi.env stops being
# rewritten at pass 5 and reads unknown once qmi_mono is more than 10 s old
# (pass 6). The run keeps counting but cannot fire on an unknown read; the file
# is fresh again at pass 41 and that first fresh one-carrier read starts Tier 1
# at once (the run is 390 s old).
SC_PASSES=43
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_5() { mset cc_stale 1; }
sc_pass_41() { mset cc_stale 0; }
sc_snap_extra() {
    plat_cc_count
    echo "cc=${carrier_cc:-unknown} plat=${PLAT_CC:-unknown}/${PLAT_CC_RAT:-none} since=$carrier_single_since tier=$current_tier"
}
