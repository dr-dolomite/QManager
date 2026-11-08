# R9a: the manual SIM-switch flag (cellular settings) locks the daemon while
# the link is down; the flag's removal unlocks it and Tier 1 runs after the
# outage age restarts.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; h_touch qmanager_sim_switch_active; }
sc_pass_6() { h_rm qmanager_sim_switch_active; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
