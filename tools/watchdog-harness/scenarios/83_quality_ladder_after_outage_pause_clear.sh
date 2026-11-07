# R2: a reachable read ends the outage pause, so the quality ladder runs at
# once. An outage pause and a quality evaluation cannot overlap by
# construction: a reachable read ends the outage pause.
# An outage ladder (Tier 1 only, link down) is exhausted (15 minute outage
# pause). The link returns lossy at pass 12: the reachable read ends the outage
# pause and the quality ladder starts after the breaches; exhausted, it starts
# its own 15 minute quality pause.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { mset reachable true; mset q_loss 50; }
sc_snap_extra() {
    echo "out_left=$(wd_holdoff_left outage) q_left=$(wd_holdoff_left quality) q_level=$wd_hold_q_level q_end=$wd_hold_q_end"
}
