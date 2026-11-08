# R9c: failback_every_min is clamped to 5-1440 minutes (the harness floor is
# restored to 5): a configured 2 reads as 5, so the first try is 300 s after
# the failover is resumed, not 120 s.
SC_PASSES=40
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 2
    mset slot 2
    failover_write true 1 2
}
sc_post_source() { WD_FAILBACK_EVERY_MIN_LO=5; }
sc_snap_extra() { echo "slot=$(mget slot 1) primary_recheck_active=$primary_recheck_active"; }
