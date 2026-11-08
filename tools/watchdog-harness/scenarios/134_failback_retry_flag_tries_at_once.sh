# R9c (contracts Amendment 1 B): after the give-up (as 132) the retry flag
# resets failback_failures to 0 and the next try runs at once (the flag is
# consumed); that try fails as try 1 of 3.
SC_PASSES=85
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
sc_pass_62() { h_touch qmanager_watchcat_retry_failback; }
sc_snap_extra() { echo "slot=$(mget slot 1) failback_failures=$failback_failures sim_failover_active=$sim_failover_active"; }
