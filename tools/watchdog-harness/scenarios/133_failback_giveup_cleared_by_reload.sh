# R9c: after the give-up (as 132) a settings reload clears it: failback_failures
# is 0 again, the next try is one full interval after the reload (not at once),
# and the 4th try runs and fails as try 1 of 3.
SC_PASSES=90
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
sc_pass_62() { h_touch qmanager_watchcat_reload; }
sc_snap_extra() { echo "slot=$(mget slot 1) failback_failures=$failback_failures sim_failover_active=$sim_failover_active"; }
