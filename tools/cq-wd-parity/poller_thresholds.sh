#!/bin/sh
# poller_thresholds.sh - dev-only check of the poller's custom latency/loss
# limit resolver (W1). Extracts _qt_custom_or and resolve_quality_thresholds
# from scripts/usr/bin/qmanager_poller, stubs `uci`, and checks that a stored
# custom value outside latency 1-10000 / loss 1-100 reads as the tolerant
# default (250 ms / 30 %), like the CQ CGI and the watchdog read it.
#
#   busybox sh tools/cq-wd-parity/poller_thresholds.sh
#
# Exit 0 only when every row matches. Never installed. POSIX sh, LF only.

HERE=$(cd "$(dirname "$0")" && pwd)
POLLER="$HERE/../../scripts/usr/bin/qmanager_poller"

SRC=$(awk '
    /^_qt_custom_or\(\) \{/ || /^resolve_quality_thresholds\(\) \{/ { on = 1 }
    on { print }
    on && /^\}/ { on = 0 }' "$POLLER")
[ -n "$SRC" ] || { echo "poller_thresholds: functions not found" >&2; exit 2; }
eval "$SRC"

LAT_PRESET=custom
LOSS_PRESET=custom
LAT_RAW=""
LOSS_RAW=""
uci() {
    [ "$1" = "-q" ] && shift
    case "$2" in
        quecmanager.quality_thresholds.latency_preset) printf '%s\n' "$LAT_PRESET" ;;
        quecmanager.quality_thresholds.loss_preset) printf '%s\n' "$LOSS_PRESET" ;;
        quecmanager.quality_thresholds.latency_custom_ms) printf '%s\n' "$LAT_RAW" ;;
        quecmanager.quality_thresholds.loss_custom_pct) printf '%s\n' "$LOSS_RAW" ;;
    esac
}

PASS=0
FAIL=0
# row <raw> <latency> <loss>
row() {
    LAT_RAW="$1"
    LOSS_RAW="$1"
    resolve_quality_thresholds
    if [ "$QUALITY_LAT_THRESHOLD" = "$2" ] && [ "$QUALITY_LOSS_THRESHOLD" = "$3" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        echo "FAIL custom='$1': latency=$QUALITY_LAT_THRESHOLD (want $2) loss=$QUALITY_LOSS_THRESHOLD (want $3)"
    fi
}

row 0 250 30
row 00 250 30
row 00250 250 30
row 10001 250 30
row 101 101 30
row 99999999999999999999 250 30
row "" 250 30
row abc 250 30
row 12x 250 30
row 1 1 1
row 100 100 100
row 10000 10000 30
row 007 7 7

# A named preset ignores a bad custom value.
LAT_PRESET=standard
LOSS_PRESET=very-tolerant
row 0 150 50

echo "poller_thresholds: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
