# Quality is turned off (settings reload) while a breach timer runs: the timer
# is cleared at once (quality_breach_secs 0 while disabled), so turning it back
# on starts a fresh breach instead of firing the stale timer on the first pass.
# The breach-start line is a WARN once; the passes in between log at debug.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 0060
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 100; }
sc_pass_8() { uci_set quecmanager.watchcat.quality_enabled 0; h_touch qmanager_watchcat_reload; }
sc_pass_14() { uci_set quecmanager.watchcat.quality_enabled 1; h_touch qmanager_watchcat_reload; }
sc_snap_extra() {
    echo "enabled=$CFG_QUALITY_ENABLED after=$CFG_QUALITY_AFTER_SEC since=$quality_breach_since avg=$q_avg_latency tier=$current_tier"
}
