# R4: with Tier 1 and Tier 2 disabled the quality start gate is "none" even
# though Tier 3 (slot armed) and Tier 4 are enabled: a persistent breach runs
# no ladder, sends no AT and logs no event. The breach timer keeps running
# (quality_breach_secs grows in the state file).
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.tier4_enabled 1
    mset q_loss 50
}
sc_snap_extra() {
    echo "gate=$(wd_start_gate quality) q_since=$quality_breach_since"
}
