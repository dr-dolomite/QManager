# R9c: the primary SIM stays down. Three failback tries each end back on the
# backup slot; the third one stops the tries: one sim_failback_giveup event,
# failback_failures 3, failback_next_at null, and no fourth swap-back.
SC_PASSES=80
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
sc_snap_extra() { echo "slot=$(mget slot 1) failback_failures=$failback_failures sim_failover_active=$sim_failover_active"; }
