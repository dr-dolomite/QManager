#!/bin/sh
# sinr_expect.sh <parse_at.sh>
#
# Table test for _lte_sinr_db_g (AT+QENG LTE <SINR> raw X -> 2X-20 dB, raw
# 0..25 only, else empty). Run under the device's BusyBox ash. Exit 0 only if
# every row matches. The Rust port that had the same table was removed 2026-10-25.

LIB=$1
[ -f "$LIB" ] || { echo "usage: sinr_expect.sh <parse_at.sh>" >&2; exit 2; }
qlog_debug() { :; } ; qlog_info() { :; } ; qlog_warn() { :; } ; qlog_error() { :; }
. "$LIB"

CR=$(printf '\r')
pass=0
fail=0

row() { # raw expected
    _R=SENT
    _lte_sinr_db_g "$1"
    if [ "$_R" = "$2" ]; then
        pass=$((pass + 1))
    else
        printf 'FAIL raw=[%s] want=[%s] got=[%s]\n' "$(printf '%s' "$1" | tr '\r' '^')" "$2" "$_R"
        fail=$((fail + 1))
    fi
}

row 0 -20
row 8 -4
row 10 0
row 12 4
row 20 20
row 25 30
row 05 -10
row 00 -20
row "22$CR" 24
row 26 ""
row 100 ""
row -32768 ""
row -5 ""
row - ""
row "" ""
row "$CR" ""
row " 22" ""
row 2a ""

echo "sinr_expect: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
