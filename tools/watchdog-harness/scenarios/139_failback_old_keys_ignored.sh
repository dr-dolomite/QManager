# R9c: the retired primary_recheck_enabled / primary_recheck_interval keys are
# not read: with them set to 1 / 1 and failback_enabled 0, an active failover
# never starts a recheck.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.primary_recheck_enabled 1
    uci_set quecmanager.watchcat.primary_recheck_interval 1
    mset slot 2
    failover_write true 1 2
}
sc_snap_extra() { echo "slot=$(mget slot 1) primary_recheck_active=$primary_recheck_active"; }
