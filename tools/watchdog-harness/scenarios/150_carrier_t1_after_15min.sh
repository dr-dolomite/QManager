# R11b: the default carrier_after_min (15). Two carriers at passes 1-2 arm the
# trigger; one carrier from pass 3 starts the run, and Tier 1 starts once it is
# 900 s old (pass 93, event "stuck on one carrier for 15 min"). AT+COPS=0 brings
# the second carrier back: the cooldown verdict is a success ("carrier
# aggregation restored") and last_success records tier 1, reason carrier.
SC_PASSES=98
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    mset cc_src qmi
    mset cc 2
}
sc_pass_3() { mset cc 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset cc 2; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "cc=$carrier_cc armed=$carrier_armed since=$carrier_single_since tier=$current_tier reason=$recovery_reason"
    echo "last_success: time=$last_success_time tier=$last_success_tier reason=${last_success_reason:-none} took_s=$last_success_took_s"
}
