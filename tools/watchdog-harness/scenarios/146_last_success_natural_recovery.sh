# Amendment 3: the link comes back on its own before any tier ran (natural
# recovery in suspect): no verdict, so the last-success fields stay null. A
# later Tier 1 recovery (pass 12) then sets them.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_3() { mset reachable true; }
sc_pass_12() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s ep_start=$wd_ep_start mono=$(mono_now)"
}
