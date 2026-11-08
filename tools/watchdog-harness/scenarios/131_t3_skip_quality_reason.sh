# R9c: a quality ladder never reaches Tier 3. Tier 1 runs, the loss does not
# clear, and the enabled Tier 3 (backup slot set) is skipped with a log line
# naming the reason; no AT+QUIMSLOT. The quality pause starts.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.backup_sim_slot 2
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset slot 1
}
sc_pass_2() { mset q_loss 50; }
sc_snap_extra() { echo "slot=$(mget slot 1) tier=$current_tier reason=$recovery_reason q_left=$(wd_holdoff_left quality)"; }
