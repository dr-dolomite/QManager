# R9a: a leftover config-restore PID file whose process is gone (or whose
# content is not a PID) does not lock: the outage runs Tier 1 as usual.
SC_PASSES=8
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
    ( : ) &
    wait "$!"
    echo "$!" > "$H_ROOT/var/run/qmanager_config_restore.pid"
}
sc_pass_2() { mset reachable false; }
sc_pass_5() { echo "garbage" > "$H_ROOT/var/run/qmanager_config_restore.pid"; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
