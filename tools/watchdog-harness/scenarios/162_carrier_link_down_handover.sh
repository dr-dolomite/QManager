# R11b: the link is down at the carrier verdict (Tier 1 dropped it and it did
# not come back): no carrier verdict, the episode ends and the outage trigger
# takes over on its own rules (suspect, then its own Tier 1 once the outage age
# is due). The second AT+COPS=0 restores the link.
SC_PASSES=45
sc_setup() {
    uci_set quecmanager.watchcat.carrier_enabled 1
    uci_set quecmanager.watchcat.carrier_after_min 5
    mset cc_src qmi
    mset cc 2
}
sc_pass_2() { mset cc 1; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0)
            _sc_n=$(mget cops0 0)
            _sc_n=$((_sc_n + 1))
            mset cops0 "$_sc_n"
            if [ "$_sc_n" -eq 1 ]; then
                mset reachable false
            else
                mset reachable true
                mset cc 2
            fi
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "cc=${carrier_cc:-unknown} since=$carrier_single_since tier=$current_tier reason=$recovery_reason last_success=${last_success_tier}/${last_success_reason:-none}"
}
