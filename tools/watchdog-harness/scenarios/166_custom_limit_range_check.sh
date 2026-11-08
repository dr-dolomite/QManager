# W1: a stored custom latency/loss limit outside the CGI's range (latency 1-10000,
# loss 1-100) reads as the tolerant default (250 ms / 30 %) in the daemon, like
# the CQ CGI reads it; a plain in-range value is kept with leading zeros stripped.
# Inputs: 0, 00, 00250, 10001, 101, 99999999999999999999, empty, non-numeric,
# 1, 100, 10000. The preset is custom for both. One pass: the table is the output.
SC_PASSES=1
sc_snap_extra() {
    uci_set quecmanager.quality_thresholds.latency_preset custom
    uci_set quecmanager.quality_thresholds.loss_preset custom
    for _t_v in 0 00 00250 10001 101 99999999999999999999 "" abc 12x 1 100 10000 007; do
        uci_set quecmanager.quality_thresholds.latency_custom_ms "$_t_v"
        uci_set quecmanager.quality_thresholds.loss_custom_pct "$_t_v"
        resolve_quality_thresholds
        echo "custom='$_t_v' -> latency=${CFG_LATENCY_THRESHOLD_MS}ms loss=${CFG_LOSS_THRESHOLD_PCT}%"
    done
    uci_del quecmanager.quality_thresholds.latency_custom_ms
    uci_del quecmanager.quality_thresholds.loss_custom_pct
    resolve_quality_thresholds
    echo "custom absent -> latency=${CFG_LATENCY_THRESHOLD_MS}ms loss=${CFG_LOSS_THRESHOLD_PCT}%"
}
