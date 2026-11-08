# R4: a clean window resets the breach timer. quality_after_sec 120. Latency
# breaches from pass 6; it clears at pass 9 and the window is clean again at
# pass 13 (breach 60 s old: timer back to 0), then breaches again from pass 15;
# the window crosses the limit at pass 22. The ladder starts at pass 34, 120 s
# after the second breach began, not 120 s after the first one.
SC_PASSES=36
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 120
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset q_latency 400.5
}
sc_pass_9() { mset q_latency 24.5; }
sc_pass_15() { mset q_latency 400.5; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_latency 24.5; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    if read_quality; then _t_w="loss=$q_packet_loss avg=$q_avg_latency"; else _t_w="no signal"; fi
    echo "q_since=$quality_breach_since window: $_t_w"
}
