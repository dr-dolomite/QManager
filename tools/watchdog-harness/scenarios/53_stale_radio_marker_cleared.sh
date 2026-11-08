# Wave-2 M4: Tier 2 sends AT+CFUN=0 and both AT+CFUN=1 are swallowed, so the
# radio-down marker sticks (radio_down=1) and the ladder is exhausted. The modem
# later turns the radio back on by itself. When the pause ends the start gate
# reads AT+CFUN? 1 and clears the marker; the user's airplane mode (CFUN=4) set
# during the second ladder's Tier 1 is then honoured at the escalation gate
# (radio_off, no Tier 2 toggle over it). Before the fix the marker stayed set, the
# gate ignored the airplane mode and Tier 2 cycled the radio.
# Check interval 30 keeps the pause short.
SC_PASSES=48
sc_post_source() { CFG_CHECK_INTERVAL=30; }
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_12() { mset cfun 1; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1)
            _t_n=$(( $(mget cfun1_n 0) + 1 ))
            mset cfun1_n "$_t_n"
            [ "$_t_n" -gt 2 ] && mset cfun 1
            printf 'OK\r\n'
            return 0
            ;;
        AT+COPS=0)
            _t_n=$(( $(mget cops_n 0) + 1 ))
            mset cops_n "$_t_n"
            [ "$_t_n" -eq 2 ] && mset cfun 4
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "radio_down=$wd_radio_down cfun=$(mget cfun 1)"
}
