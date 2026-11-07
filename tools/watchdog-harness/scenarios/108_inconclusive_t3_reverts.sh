# R5: an inconclusive Tier 3 cooldown (the ping cache goes stale during the
# settle) swaps the unconfirmed backup SIM back to slot 1 through the existing
# revert path and keeps Tier 3. The cache returns with the link down: the next
# trigger resumes at Tier 4 (reboot), not Tier 1.
SC_PASSES=30
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 false
}
sc_pass_2() { mset link_slot_1 false; }
sc_pass_10() { mset ping_stale 1; }
sc_pass_24() { mset ping_stale 0; }
sc_snap_extra() {
    echo "tier=$current_tier tried=[$tiers_tried] until=$step_wait_until left=$cooldown_remaining slot=$current_sim_slot orig=$original_sim_slot"
}
