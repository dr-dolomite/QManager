# R9a: a config restore whose PID is alive locks the daemon (the harness shell
# itself stands in for the restore process); removing the PID file unlocks it
# and the outage age restarts at the exit, so Tier 1 runs act_after_eff later.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; echo "$H_MAINPID" > "$H_ROOT/var/run/qmanager_config_restore.pid"; }
sc_pass_8() { rm -f "$H_ROOT/var/run/qmanager_config_restore.pid"; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
