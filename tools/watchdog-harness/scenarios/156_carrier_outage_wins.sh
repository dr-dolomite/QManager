# R11b: an outage during a carrier run wins. One carrier from pass 2; the link
# drops at pass 15: the run ends (suspect), the outage ladder runs Tier 1 and
# AT+COPS=0 restores the link with two carriers (the run stays 0). One carrier
# again from pass 25 starts a new run, and the carrier Tier 1 starts 300 s
# later.
SC_PASSES=60
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_pass_15() { mset reachable false; }
sc_pass_25() { mset cc 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; mset cc 2; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} since=$carrier_single_since tier=$current_tier reason=$recovery_reason"
}
