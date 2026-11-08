# R9c: Tier 3 is enabled but no backup slot is configured: the tier is skipped
# with one log line naming the reason (no AT+QUIMSLOT), and with nothing else
# enabled the ladder is exhausted and the outage pause starts.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset slot 1
}
sc_pass_2() { mset reachable false; }
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active"; }
