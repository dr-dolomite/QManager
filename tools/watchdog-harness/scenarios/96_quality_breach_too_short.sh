# R4: a breach shorter than quality_after_sec (120 s here) starts no ladder.
# Latency 400 ms from the start; the window breaches from pass 6 (first 10 samples). It
# clears at pass 12 and the window turns clean a few passes later (pass 16), before the
# breach reached 120 s: the timer resets to 0 and no AT is sent.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_after_sec 120
    mset q_latency 400.5
}
sc_pass_12() { mset q_latency 24.5; }
sc_snap_extra() {
    if read_quality; then _t_w="loss=$q_packet_loss avg=$q_avg_latency"; else _t_w="no signal"; fi
    echo "q_since=$quality_breach_since window: $_t_w"
}
