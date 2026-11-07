# R2: an outage ladder (Tier 1 only, it never restores the link) is exhausted:
# the 15 minute outage pause starts (event "pausing 15 minutes", state holdoff,
# holdoff_reason outage, no AT while the link stays down). The link returns at
# pass 14: the first fresh reachable read ends the pause (state monitor) and the
# quality level is untouched.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_14() { mset reachable true; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
