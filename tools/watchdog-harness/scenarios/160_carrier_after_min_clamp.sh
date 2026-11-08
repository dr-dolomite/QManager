# R11b: carrier_after_min is minutes, 5-240, default 15: "007" is 7 (no octal),
# 999 is 240, 3 is 5, "abc" is 15. carrier_enabled "true" is not "1": off. One
# reload per pass.
SC_PASSES=6
sc_setup() { uci_set quecmanager.watchcat.carrier_after_min 007; }
sc_pass_2() { uci_set quecmanager.watchcat.carrier_after_min 999; h_touch qmanager_watchcat_reload; }
sc_pass_3() { uci_set quecmanager.watchcat.carrier_after_min 3; h_touch qmanager_watchcat_reload; }
sc_pass_4() { uci_set quecmanager.watchcat.carrier_after_min abc; h_touch qmanager_watchcat_reload; }
sc_pass_5() { uci_set quecmanager.watchcat.carrier_enabled true; h_touch qmanager_watchcat_reload; }
sc_snap_extra() {
    echo "enabled=$CFG_CARRIER_ENABLED after_min=$CFG_CARRIER_AFTER_MIN"
}
