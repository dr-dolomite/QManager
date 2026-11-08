# Amendment 3: the fields live in memory only. A daemon start begins at null: the
# pass-12 restart is simulated by re-sourcing wd_tiers.sh, which re-runs its global
# initialisers exactly like a new process (no file carries the fields over). The
# Tier 1 success of pass ~7 shows before it.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { . "$WD_LIB_DIR/wd_tiers.sh"; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s ep_start=$wd_ep_start mono=$(mono_now)"
}
