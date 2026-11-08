# (Passes shifted +3: the failover record is resumed after the 30 s boot settle,
# so the recheck timeline starts 30 s later than before the item 9 call move.)
# A maintenance lock lands during the primary-recheck settle: LOCKED entry marks
# the recheck interrupted; on exit the settle is re-armed and finish_cooldown
# decides failback (primary healthy).
SC_PASSES=31
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 2
    failover_write true 1 2
}
sc_pass_9() { h_touch qmanager_watchcat.lock; }
sc_pass_11() { h_rm qmanager_watchcat.lock; }
