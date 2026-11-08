# Amendment 3: Tier 1 does not restore the link, Tier 2 does. The success is
# recorded for Tier 2 and took_s spans both steps (the Tier 1 trigger to the Tier 2
# verdict), not only the Tier 2 cooldown.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=1) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s ep_start=$wd_ep_start mono=$(mono_now)"
}
