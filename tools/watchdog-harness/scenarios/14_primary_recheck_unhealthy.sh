# (Passes shifted +3: the failover record is resumed after the 30 s boot settle,
# so the recheck timeline starts 30 s later than before the item 9 call move.)
# Primary recheck, but slot 1 still has no link: after the settle the daemon
# returns to the backup slot, rewrites the failover record and holds the
# post-recheck settle; a second recheck comes due later.
SC_PASSES=37
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
