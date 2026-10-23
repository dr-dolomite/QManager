#!/bin/sh
# data-used-test.sh — dev-only test of scripts/usr/lib/qmanager/data_used.sh
# under the device's BusyBox sh. Fakes sysfs, boot_id and the state dirs in a
# scratch dir; never touches the live poller's files.
#   usage: sh data-used-test.sh /path/to/data_used.sh
LIB="${1:?path to data_used.sh}"
T="${TMPDIR:-/tmp}/du_test.$$"
rm -rf "$T"
mkdir -p "$T/sys/rmnet_ipa0/statistics" "$T/run" "$T/state"
trap 'rm -rf "$T"' EXIT

qlog_info() { :; }
qlog_warn() { :; }
DU_SYS_DIR="$T/sys"
DU_BOOT_ID_FILE="$T/boot_id"
DU_STATE_DIR="$T/state"
DU_RUN_DIR="$T/run"
DU_QMI_ENV="$T/run/qmi.env"
DU_UPTIME_FILE="$T/uptime"
DU_SAMPLE_EVERY=1
DU_FLUSH_EVERY=1
_NOW=1792420000

fails=0
setc() { echo "$1" > "$T/sys/rmnet_ipa0/statistics/rx_bytes"; echo "$2" > "$T/sys/rmnet_ipa0/statistics/tx_bytes"; }
val() { jq -r ".$1" "$T/$2/data_used.json"; }
echo "1000.42 1800.00" > "$T/uptime"
# wds <state> <ok> <rx> <tx> <mono> [noend]: write a broker qmi.env.
wds() {
    {
        echo "qmi_mono='$5'"
        echo "qmi_state='$1'"
        echo "qmi_ssr_count='0'"
        echo "qmi_registered='1'"
        echo "qmi_lte_rsrp='-95'"
        echo "qmi_wds_ok='$2'"
        echo "qmi_wds_rx_bytes='$3'"
        echo "qmi_wds_tx_bytes='$4'"
        echo "qmi_wds_mux='1'"
        [ "$6" = "noend" ] || echo "qm_sidecar_end='1'"
    } > "$T/run/qmi.env"
}
check() { # name expected actual
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: want $2 got $3"; fails=$((fails + 1)); fi
}
# Run a fresh poller "process": a subshell that loads the lib, inits, ticks N.
run() { # ticks
    (
        unset _QM_DATA_USED_LOADED
        . "$LIB"
        du_init
        i=0
        while [ "$i" -lt "$1" ]; do du_tick; i=$((i + 1)); done
        du_flush
    )
}

echo "b-1" > "$T/boot_id"
# 1. fresh install: baseline only
setc 5000 700
run 0
check "fresh baseline rx" 0 "$(val rx_bytes state)"
check "fresh since" 1792420000 "$(val since state)"
# 2. normal deltas within the same boot (poller restart)
setc 6000 900
run 1
check "delta rx" 1000 "$(val rx_bytes state)"
check "delta tx" 200 "$(val tx_bytes state)"
check "mirror rx" 1000 "$(val rx_bytes run)"
# 3. netdev restarted (PDN drop): counter below prev -> add cur
setc 300 50
run 1
check "restart rx" 1300 "$(val rx_bytes state)"
check "restart tx" 250 "$(val tx_bytes state)"
check "restart count" 1 "$(val iface_resets state)"
# 4. reboot: new boot_id, counter (since boot) above prev -> still add cur
echo "b-2" > "$T/boot_id"
setc 9000 1000
run 0
check "reboot rx" 10300 "$(val rx_bytes state)"
check "reboot tx" 1250 "$(val tx_bytes state)"
# 5. netdev absent: state kept, iface_present false
rm -f "$T/sys/rmnet_ipa0/statistics/rx_bytes"
run 1
check "absent rx kept" 10300 "$(val rx_bytes state)"
check "absent flag" false "$(val iface_present run)"
# 6. garbage read: skipped
echo "abc" > "$T/sys/rmnet_ipa0/statistics/rx_bytes"
run 1
check "garbage rx kept" 10300 "$(val rx_bytes state)"
# 7. back with growth
setc 9500 1100
run 1
check "back rx" 10800 "$(val rx_bytes state)"
# 8. user reset: zero, re-baseline, flag consumed
: > "$T/run/data_used_reset"
setc 9600 1200
_NOW=1792430000
run 1
check "reset rx" 0 "$(val rx_bytes state)"
check "reset since" 1792430000 "$(val since state)"
check "reset flag gone" no "$([ -e "$T/run/data_used_reset" ] && echo yes || echo no)"
setc 9700 1250
run 1
check "post-reset rx" 100 "$(val rx_bytes state)"
check "post-reset tx" 50 "$(val tx_bytes state)"
# 9. 1970 clock: since stored as 0 on reset
: > "$T/run/data_used_reset"
_NOW=5
run 1
check "1970 since" 0 "$(val since state)"
# 10. corrupt state file: start from zero
echo '{"schema":1,"rx_bytes":"x"}' > "$T/state/data_used.json"
_NOW=1792440000
setc 10000 2000
run 0
check "corrupt rx" 0 "$(val rx_bytes state)"
check "corrupt baseline" 10000 "$(val prev_rx state)"
# 11. large values (64-bit)
setc 9000000000000 2000
run 1
check "64-bit rx" 8999999990000 "$(val rx_bytes state)"
# 12. flush cadence: sample every 1, flush every 3 -> file lags the mirror
DU_FLUSH_EVERY=3
setc 9000000000100 2000
( unset _QM_DATA_USED_LOADED; . "$LIB"; du_init; setc 9000000000200 2000; du_tick; \
  echo "$(jq -r .rx_bytes "$T/run/data_used.json") $(jq -r .rx_bytes "$T/state/data_used.json")" > "$T/r" )
check "flush lag" "8999999990200 8999999990100" "$(cat "$T/r")"

# --- WDS source (broker qmi.env) ---
DU_FLUSH_EVERY=1
# 13. reset onto the netdev, then a fresh WDS sample: switch re-baselines
: > "$T/run/data_used_reset"
run 1
check "pre-wds reset rx" 0 "$(val rx_bytes state)"
check "pre-wds source" netdev "$(val source state)"
wds up 1 5000 600 995
run 1
check "switch to wds source" wds "$(val source run)"
check "switch to wds no delta rx" 0 "$(val rx_bytes state)"
check "switch to wds no delta tx" 0 "$(val tx_bytes state)"
check "switch to wds prev" 5000 "$(val prev_rx state)"
check "switch is no reset" 0 "$(val iface_resets state)"
check "wds present" true "$(val iface_present run)"
# 14. WDS delta while the netdev moves too: only WDS counts
wds up 1 7000 700 998
setc 9000000099999 9999
run 1
check "wds delta rx" 2000 "$(val rx_bytes state)"
check "wds delta tx" 100 "$(val tx_bytes state)"
# 15. stale sidecar (age 100 s > 30): netdev fallback, re-baseline
wds up 1 7500 750 900
run 1
check "stale -> netdev" netdev "$(val source state)"
check "stale no delta rx" 2000 "$(val rx_bytes state)"
check "stale prev = netdev" 9000000099999 "$(val prev_rx state)"
# 16. netdev -> wds again: re-baseline, then deltas resume
wds up 1 8000 800 1000
run 1
check "back to wds" wds "$(val source state)"
check "back to wds no delta" 2000 "$(val rx_bytes state)"
wds up 1 8500 820 1000
run 1
check "wds delta again rx" 2500 "$(val rx_bytes state)"
check "wds delta again tx" 120 "$(val tx_bytes state)"
# 17. qmi_wds_ok=0 -> netdev
wds up 0 '' '' 1000
run 1
check "wds_ok=0 -> netdev" netdev "$(val source state)"
check "wds_ok=0 no delta" 2500 "$(val rx_bytes state)"
# 18. other unusable sidecars stay on the netdev (prev is netdev: no switch)
setc 9000000100099 10009
wds up 1 9000 900 1000 noend
run 1
check "no end marker -> netdev" netdev "$(val source state)"
check "netdev delta counts" 2600 "$(val rx_bytes state)"
wds up 1 '' 900 1000
run 1
check "empty rx -> netdev" netdev "$(val source state)"
wds down 1 9000 900 1000
run 1
check "state down -> netdev" netdev "$(val source state)"
wds up 1 9000 900 1001
run 1
check "future mono -> netdev" netdev "$(val source state)"
wds up 1 09000 900 1000
run 1
check "leading zero -> netdev" netdev "$(val source state)"
wds up 1 9000 900 1000
echo "qmi_x='a b'" >> "$T/run/qmi.env"
run 1
check "bad line -> netdev" netdev "$(val source state)"
rm -f "$T/uptime"
wds up 1 9000 900 1000
run 1
check "no uptime -> netdev" netdev "$(val source state)"
echo "1000.42 1800.00" > "$T/uptime"
rm -f "$T/run/qmi.env"
run 1
check "no sidecar -> netdev" netdev "$(val source state)"
check "fallbacks rx kept" 2600 "$(val rx_bytes state)"
# 19. WDS counter drop (new data call / SSR): the cur < prev path
wds up 1 8000 800 1000
run 1
check "wds again" wds "$(val source state)"
wds up 1 8400 850 1000
run 1
check "wds pre-drop rx" 3000 "$(val rx_bytes state)"
wds up 1 300 10 1000
run 1
check "wds drop rx" 3300 "$(val rx_bytes state)"
check "wds drop tx" 190 "$(val tx_bytes state)"
check "wds drop resets" 1 "$(val iface_resets state)"
check "wds drop source" wds "$(val source state)"
# 20. reboot on WDS: new boot_id adds cur (bytes of the new call)
echo "b-3" > "$T/boot_id"
wds up 1 4000 400 20
echo "25.10 40.00" > "$T/uptime"
run 0
check "wds reboot rx" 7300 "$(val rx_bytes state)"
check "wds reboot tx" 590 "$(val tx_bytes state)"
echo "1000.42 1800.00" > "$T/uptime"
# 21. old state without "source" loads as netdev
OLD='{"schema":1,"rx_bytes":500,"tx_bytes":50,"since":1792420000,"updated":1792420000,"iface":"rmnet_ipa0","iface_present":true,"iface_resets":0,"boot_id":"b-3","prev_rx":1000,"prev_tx":100}'
echo "$OLD" > "$T/state/data_used.json"
rm -f "$T/run/qmi.env"
setc 1200 130
run 0
check "old state loads rx" 700 "$(val rx_bytes state)"
check "old state loads tx" 80 "$(val tx_bytes state)"
check "old state source" netdev "$(val source state)"
echo "$OLD" > "$T/state/data_used.json"
wds up 1 999999 99999 1000
run 0
check "old state + wds no delta" 500 "$(val rx_bytes state)"
check "old state + wds source" wds "$(val source state)"
check "cgi source expr" wds "$(jq -r 'if .source == "wds" then "wds" else "netdev" end' "$T/run/data_used.json")"
check "cgi source default" netdev "$(echo "$OLD" | jq -r 'if .source == "wds" then "wds" else "netdev" end')"

echo "fails=$fails"
[ "$fails" -eq 0 ]
