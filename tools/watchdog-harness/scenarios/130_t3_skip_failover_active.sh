# R9c: a Tier 3 failover is already active (resumed from the record: slot 1 ->
# 2) and the configured backup slot is 1, which differs from the live slot: the
# tier is still skipped because the failover is active (no second swap).
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 1
    mset slot 2
    failover_write true 1 2
}
sc_pass_4() { mset reachable false; }
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active original_sim_slot=$original_sim_slot"; }
