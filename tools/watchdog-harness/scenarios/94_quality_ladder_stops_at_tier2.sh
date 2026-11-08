# R4 (D5): the quality ladder stops after Tier 2. Tier 3 is armed with a backup
# slot and Tier 4 is enabled, yet a loss that never clears runs Tier 1, then
# Tier 2, then the 15 minute quality pause: no AT+QUIMSLOT, no reboot, no
# crash.log row. The link stays reachable throughout.
SC_PASSES=32
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.tier4_enabled 1
    mset slot 1
}
sc_pass_2() { mset q_loss 50; }
sc_snap_extra() {
    echo "tier=$current_tier reason=$recovery_reason q_left=$(wd_holdoff_left quality) q_since=$quality_breach_since"
}
