# R9c: two failback tries fail (failback_failures 2), the primary recovers, the
# third try succeeds: failed back to the primary, failback_failures back to 0,
# no give-up event.
SC_PASSES=62
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
sc_pass_40() { mset link_slot_1 true; }
sc_snap_extra() { echo "slot=$(mget slot 1) failback_failures=$failback_failures sim_failover_active=$sim_failover_active"; }
