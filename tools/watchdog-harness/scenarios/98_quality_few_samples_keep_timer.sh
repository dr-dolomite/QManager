# R4: a window with fewer than 10 samples is no signal and keeps the breach
# timer. quality_after_sec 60. The loss breaches from pass 6; at pass 8 the
# window is restarted (wd_quality_mark, as after any event that voids older
# samples) without an outage, so passes 8-12 have too few samples. The timer
# set at pass 6 survives them, and the first full window (pass 13, breach
# 70 s old) starts Tier 1 at once.
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 60
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset q_loss 50
}
sc_pass_8() { wd_quality_mark; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    if read_quality; then _t_w="loss=$q_packet_loss avg=$q_avg_latency"; else _t_w="no signal"; fi
    echo "q_since=$quality_breach_since window: $_t_w"
}
