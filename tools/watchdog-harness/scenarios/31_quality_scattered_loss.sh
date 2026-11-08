# Item 6: 25% scattered packet loss (every 4th sample null) on a reachable link
# breaches the 15% "standard" ceiling in the windowed read. A breach that lasts
# quality_after_sec (30 s) starts a quality-triggered Tier 1; its COPS=0 clears
# the loss and the quality cooldown succeeds.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.quality_thresholds.loss_preset standard
}
sc_pass_2() { mset q_loss 25; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "quality_since=$quality_since breach=$quality_breach_since"
    if read_quality; then
        echo "window: loss=$q_packet_loss avg=$q_avg_latency"
    else
        echo "window: no signal"
    fi
}
