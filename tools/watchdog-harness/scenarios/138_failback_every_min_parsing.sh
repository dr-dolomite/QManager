# R9c: failback_every_min parsing on reload (floor 5, cap 1440, default 30):
# 99999 -> 1440, 0045 (leading zeros) -> 45, abc -> 30, 7 -> 7, 0 -> 5. The
# value shows in the config log line and in failback_next_at; no try is due.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.failback_enabled 1
    uci_set quecmanager.watchcat.failback_every_min 1440
    mset slot 2
    failover_write true 1 2
}
sc_post_source() { WD_FAILBACK_EVERY_MIN_LO=5; }
sc_pass_3() { uci_set quecmanager.watchcat.failback_every_min 99999; h_touch qmanager_watchcat_reload; }
sc_pass_5() { uci_set quecmanager.watchcat.failback_every_min 0045; h_touch qmanager_watchcat_reload; }
sc_pass_7() { uci_set quecmanager.watchcat.failback_every_min abc; h_touch qmanager_watchcat_reload; }
sc_pass_9() { uci_set quecmanager.watchcat.failback_every_min 7; h_touch qmanager_watchcat_reload; }
sc_pass_11() { uci_set quecmanager.watchcat.failback_every_min 0; h_touch qmanager_watchcat_reload; }
sc_snap_extra() { echo "every=$CFG_FAILBACK_EVERY_MIN"; }
