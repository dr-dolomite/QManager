# Tier 1 runs, then the ping cache goes stale during the cooldown: 3 stale
# retries (+10 s each), then the verdict is inconclusive (R5): back to monitor
# with Tier 1 kept; the cache stays stale, so nothing else runs.
SC_PASSES=26
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset ping_stale 0; mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
