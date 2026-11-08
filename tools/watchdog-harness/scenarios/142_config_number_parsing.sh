# R9d: act_after_sec (15-600) and ssr_grace_sec (10-120) strip leading zeros and
# clamp on reload: 0030 -> 30 and 045 -> 45, 99999 -> 600 and 120, 5 -> 15 and 10,
# 08 -> 15 and 10 (never read as a bad octal). The values show in the config log
# lines; the daemon stays in monitor.
SC_PASSES=12
sc_pass_3() {
    uci_set quecmanager.watchcat.act_after_sec 0030
    uci_set quecmanager.watchcat.ssr_grace_sec 045
    h_touch qmanager_watchcat_reload
}
sc_pass_5() {
    uci_set quecmanager.watchcat.act_after_sec 99999
    uci_set quecmanager.watchcat.ssr_grace_sec 99999
    h_touch qmanager_watchcat_reload
}
sc_pass_7() {
    uci_set quecmanager.watchcat.act_after_sec 5
    uci_set quecmanager.watchcat.ssr_grace_sec 5
    h_touch qmanager_watchcat_reload
}
sc_pass_9() {
    uci_set quecmanager.watchcat.act_after_sec 08
    uci_set quecmanager.watchcat.ssr_grace_sec 08
    h_touch qmanager_watchcat_reload
}
sc_snap_extra() { echo "act_after=$CFG_ACT_AFTER_SEC ssr_grace=$CFG_SSR_GRACE"; }
