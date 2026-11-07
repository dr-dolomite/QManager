# Item 6 / R4: fewer than 10 samples since the window mark is "no signal", even
# when every sample is lost. The mark is set after the boot settle, so passes 1-5
# (0-8 samples at a 5 s ping interval) report no signal and start no timer; at
# pass 6 the window has 10 samples and the breach timer starts. A quality_after_sec
# of 1800 keeps recovery out of the picture.
SC_PASSES=6
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 1800
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset q_loss 100
}
sc_snap_extra() {
    echo "quality_since=$quality_since breach=$quality_breach_since"
    if read_quality; then
        echo "window: loss=$q_packet_loss avg=$q_avg_latency"
    else
        echo "window: no signal"
    fi
}
