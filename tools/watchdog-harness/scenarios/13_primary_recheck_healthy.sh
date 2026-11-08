# (Passes shifted +3: the failover record is resumed after the 30 s boot settle,
# so the recheck timeline starts 30 s later than before the item 9 call move.)
# Auto-failback enabled (1 min interval) with a resumed failover: the blind
# primary recheck swaps back to slot 1, the primary is healthy after the settle
# -> failback (record removed, profile applied, tower failover restarted).
SC_PASSES=25
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    failover_write true 1 2
}
