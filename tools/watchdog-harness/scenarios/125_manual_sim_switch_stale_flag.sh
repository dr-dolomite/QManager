# R9a: a manual SIM-switch flag left behind by a killed holder locks for at
# most 120 s from first sight (mono clock), with one stale warning; then the
# outage is handled although the file is still there. A new flag after the old
# one is gone locks again.
SC_PASSES=30
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; h_touch qmanager_sim_switch_active; }
sc_pass_22() { h_rm qmanager_sim_switch_active; }
sc_pass_24() { mset reachable false; h_touch qmanager_sim_switch_active; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "ssf_seen=$_wd_ssf_seen ssf_stale=$_wd_ssf_stale"
}
