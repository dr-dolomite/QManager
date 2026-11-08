# R4: watchdog floors and the trigger's eligibility. The CQ thresholds are custom
# 30 ms / 5 %, below the floors, so the limits are 50 ms / 10 % (pass 1 extra:
# quality_breached on 45 ms / 8 %, 55 ms / 8 % and 45 ms / 10 %). A 45 ms average
# (above CQ, below the floor) never breaches (passes 1-9). From pass 10 the
# latency is 60 ms (breach) but the ping daemon reports streak_fail=1 on the
# still reachable link from pass 10 to 15: the state moves to suspect and the
# trigger is blocked (timer 0, window restarted). From pass 16 the streak is 0
# again; once the window has 10 samples the 30 s breach starts Tier 1.
SC_PASSES=30
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.act_after_sec 600
    uci_set quecmanager.quality_thresholds.latency_preset custom
    uci_set quecmanager.quality_thresholds.latency_custom_ms 30
    uci_set quecmanager.quality_thresholds.loss_preset custom
    uci_set quecmanager.quality_thresholds.loss_custom_pct 5
    mset q_latency 45.0
}
sc_pass_10() { mset q_latency 60.0; mset streak_fail 1; }
sc_pass_16() { mset streak_fail ""; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_latency 24.5; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    if [ "$1" = "1" ]; then
        for _t_c in "45.0 8" "55.0 8" "45.0 10"; do
            q_avg_latency="${_t_c% *}"; q_packet_loss="${_t_c#* }"
            if quality_breached; then _t_b=breach; else _t_b=clean; fi
            echo "floors: avg=$q_avg_latency loss=$q_packet_loss -> $_t_b"
        done
    fi
    if read_quality; then _t_w="loss=$q_packet_loss avg=$q_avg_latency"; else _t_w="no signal"; fi
    echo "limits=${CFG_LATENCY_THRESHOLD_MS}ms/${CFG_LOSS_THRESHOLD_PCT}% q_since=$quality_breach_since window: $_t_w"
}
