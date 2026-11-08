# R11b: an unknown count at the verdict extends the cooldown 3 times, then the
# verdict is inconclusive and Tier 1 is kept (the reachable link does not clear a
# kept carrier tier). One carrier again from pass 40 starts a new run, and the
# ladder resumes at Tier 2 300 s later; AT+CFUN=1 brings two carriers back
# (success, tier 2).
SC_PASSES=75
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_40() { mset cc 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset cc ""; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cc 2; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} since=$carrier_single_since tier=$current_tier tried=$tiers_tried reason=$recovery_reason last_success=${last_success_tier}/${last_success_reason:-none}"
}
