# Amendment 3: with a 1970 wall clock the Tier 1 success still records tier,
# reason and took_s (mono clock), but last_success_time stays null.
SC_PASSES=14
sc_setup() {
    QM_TEST_YEAR=1970
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
