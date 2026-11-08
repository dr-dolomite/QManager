# Item 6: a past outage does not leak into the quality window. A 60 s outage
# (12 null samples) with a high act_after_sec stays in suspect; once the link is
# back the window restarts at the last failing pass, so the good samples that
# follow show no breach and no quality recovery fires (no AT command at all).
# Without the mark the 24-sample window would still hold the 12 nulls (about 40%
# loss against the 15% "standard" ceiling) and trigger Tier 1.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.act_after_sec 120
    uci_set quecmanager.quality_thresholds.loss_preset standard
}
sc_pass_2() { mset reachable false; }
sc_pass_8() { mset reachable true; }
sc_snap_extra() {
    echo "quality_since=$quality_since breach=$quality_breach_since"
    if read_quality; then
        echo "window: loss=$q_packet_loss avg=$q_avg_latency"
    else
        echo "window: no signal"
    fi
}
