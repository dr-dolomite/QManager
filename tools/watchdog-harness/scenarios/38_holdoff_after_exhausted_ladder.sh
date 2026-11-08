# Item 10: only Tier 1 is enabled and its first run does not restore the link.
# The cooldown fails, the ladder is exhausted and holdoff_until is set 900 s
# ahead: the pause shows as no AT command at all (state stays suspect) until the
# pass at which the 900 s have elapsed (holdoff_left reads 0). The new ladder's
# Tier 1 restores the link on its second COPS=0.
# Check interval 30 keeps the run short.
SC_PASSES=40
sc_post_source() { CFG_CHECK_INTERVAL=30; }
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0)
            _t_n=$(( $(mget cops_n 0) + 1 ))
            mset cops_n "$_t_n"
            [ "$_t_n" -ge 2 ] && mset reachable true
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() {
    _t_left=$(( holdoff_until - $(mono_now) ))
    [ "$_t_left" -lt 0 ] && _t_left=0
    echo "holdoff_until=$holdoff_until holdoff_left=$_t_left"
}
