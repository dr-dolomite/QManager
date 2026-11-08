# Amendment 3: an outage ladder restored by Tier 1 records the last success: tier 1,
# reason outage, the wall time of the verdict and the seconds from the trigger
# (wd_ep_start, mono) to the verdict. total_recoveries counts the tier action as before.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s ep_start=$wd_ep_start mono=$(mono_now)"
}
