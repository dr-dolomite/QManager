# R9c: the modem already runs on the configured backup slot (no failover record,
# e.g. a manual switch): Tier 3 is skipped with a log line naming the reason.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 2
}
sc_pass_2() { mset reachable false; }
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active"; }
