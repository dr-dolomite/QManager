# Amendment 3: a quality ladder restored by Tier 1 records reason quality. The
# trigger is the moment the quality ladder was picked (pass 9), the verdict ends the
# 60 s quality cooldown.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s ep_start=$wd_ep_start mono=$(mono_now)"
}
