# R11b: 5G SA. qmi.env is not registered on LTE, so the count comes from the
# poller's ca.env (ca_rat=sa, ca_nr_cc). Two NR carriers at pass 1, one from pass
# 2: Tier 1 at pass 32, AT+COPS=0 brings the second back and the verdict is a
# success. ca.env stops being rewritten at pass 40 and reads unknown once
# ca_mono is more than 90 s old (pass 49); qmi.env gives no LTE count either.
SC_PASSES=52
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src sa
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_40() { mset cc_stale 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset cc 2; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    plat_cc_count
    echo "cc=${carrier_cc:-unknown} plat=${PLAT_CC:-unknown}/${PLAT_CC_RAT:-none} since=$carrier_single_since tier=$current_tier last_success=${last_success_reason:-none}"
}
