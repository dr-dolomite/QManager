# R9c: the retry flag with no failover active is just removed: no swap-back, no
# failure count change. A later flag with failback disabled is removed too.
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1
    mset slot 1
}
sc_pass_3() { h_touch qmanager_watchcat_retry_failback; }
sc_pass_6() {
    uci_set quecmanager.watchcat.failback_enabled 0
    h_touch qmanager_watchcat_reload
}
sc_pass_8() { h_touch qmanager_watchcat_retry_failback; }
sc_snap_extra() { echo "slot=$(mget slot 1) failback_failures=$failback_failures"; }
