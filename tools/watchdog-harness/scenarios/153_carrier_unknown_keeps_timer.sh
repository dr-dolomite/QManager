# R11b: an unknown count keeps the run. One carrier from pass 2; passes 10-20
# read an empty qmi_ca_count (unknown: carrier_cc null, the run keeps counting);
# one carrier again from pass 21, and Tier 1 starts 300 s after pass 2 (pass 32).
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_10() { mset cc ""; }
sc_pass_21() { mset cc 1; }
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} since=$carrier_single_since tier=$current_tier"
}
