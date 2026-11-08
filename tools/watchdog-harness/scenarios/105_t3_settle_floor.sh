# R5: with step_wait_sec 60 Tier 1 waits 60 s but Tier 3 holds the 90 s SIM
# settle floor (max(step_wait_eff, 90)); the swap is confirmed after it.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.step_wait_sec 60
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 true
}
sc_pass_2() { mset link_slot_1 false; }
sc_snap_extra() {
    echo "tier=$current_tier until=$step_wait_until left=$cooldown_remaining mono=$(mono_now) tried=[$tiers_tried]"
}
