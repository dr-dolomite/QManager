#!/bin/sh
# history-test.sh — dev test for the history collector + reader.
# Run on the device (BusyBox): sh history-test.sh <dir-with-libs-and-cgis>
#   <dir> holds history.sh, history_series_cellular.sh, history_read.sh,
#   series.sh, events.sh (flat). Uses a scratch dir under /tmp; touches no
#   live state. CGIs run with _SKIP_AUTH=1 and HIST_* overrides.

SRC="${1:?usage: history-test.sh <dir>}"
T=/tmp/qm_hist_test.$$
rm -rf "$T"
mkdir -p "$T/store" "$T/run"
printf 'boot-A\n' > "$T/boot"

export HIST_LIB_DIR="$SRC" HIST_STORE="$T/store" HIST_RUN="$T/run" \
    HIST_BOOT_ID_FILE="$T/boot" HIST_SYNC=true HIST_UPTIME_FILE="$T/uptime"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
check() { if eval "$1"; then ok; else bad "$2 [$1]"; fi; }

load() {
    unset _QM_HISTORY_LOADED
    . "$SRC/history.sh"
}

# Poller globals (5G NSA, healthy).
t1_cfun=1; modem_reachable=true; service_status=optimal
lte_state=connected; nr_state=connected
lte_rsrp=-99; lte_rsrq=-10; lte_sinr=22; lte_rssi=-69
nr_rsrp=-84; nr_rsrq=-11; nr_sinr=24.5
W0=1794187800          # a bucket boundary (multiple of 1800)

# cycles N: advance N poller cycles of 2 s; wall = mono + WOFF (0 = 1970).
MONO=0
WOFF=0
cycles() {
    local _i
    _i=0
    while [ "$_i" -lt "$1" ]; do
        MONO=$((MONO + 2))
        _MONO_TOP=$MONO
        _NOW=$((MONO + WOFF))
        hist_tick
        _i=$((_i + 1))
    done
    printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
}

load
_NOW=5; _MONO_TOP=0
hist_init
check '[ "$_hist_ready" = 1 ]' "init ready"
check '[ "$HIST_SERIES" = " cellular" ]' "registry"

# 1. Untrusted boot clock (1970): samples wait in pending, nothing queued.
cycles 50
check '[ -s "$T/run/cellular.pending" ]' "pending written before trust"
check '[ ! -s "$T/run/cellular.queue" ]' "nothing queued before trust"
check '[ "$_hist_trusted" = 0 ]' "untrusted at 1970"
hist_event band_change "LTE band settled on B3 (was B1)" info
check 'grep -q "^e|" "$T/run/cellular.pending"' "pre-trust event pending"

# 2. NITZ step to real time at mono 100 (< settle, but a step was seen).
WOFF=$((W0 - 40))
cycles 5
check '[ "$_hist_trusted" = 1 ]' "trusted after step"
check '[ "$_hist_off" = "$WOFF" ]' "offset = wall - mono"
check '[ ! -f "$T/run/cellular.pending" ]' "pending consumed"
check 'grep -q "\"t\":$((W0 - 1800))," "$T/run/cellular.queue" || grep -q "\"t\":$((W0 - 1800))," "$T/store/cellular/"*.jsonl' "back-dated row before W0"
check 'cat "$T/run/cellular.queue" "$T/store/cellular/"*.jsonl 2>/dev/null | grep -q "^{\"k\":\"e\",\"t\":$((W0 + 60)),\"type\":\"band_change\""' "back-dated event at its real time"
check 'grep -q "\"radio\":\"lte\"" "$T/store/cellular/"*.jsonl "$T/run/cellular.queue" 2>/dev/null' "event radio lte"

# 3. Run two buckets; closes flush to flash. W0+1800 is accumulated whole.
cycles 1800
W1=$((W0 + 1800))
DAYF="$T/store/cellular/d$((W1 / 86400)).jsonl"
check '[ -s "$DAYF" ]' "day file written"
check 'grep -q "^{\"k\":\"b\",\"t\":$W1,\"st\":{\"nr\":1800,\"lte\":0,\"down\":0,\"off\":0},\"x\":0,\"m\":{\"lte_rsrp\":\[180,-17820,-99,-99\]" "$DAYF"' "full bucket row exact"
check 'grep -q "\"nr_sinr\":\[180,4320,24,24\]" "$DAYF"' "float truncated"
check '[ -s "$T/run/cellular.open" ]' "open mirror"

# 4. Outage of 60 s, then back.
modem_reachable=false
cycles 30
check 'grep -q "^run_state=.down" "$T/run/cellular.run"' "run is down"
modem_reachable=true
cycles 10
check '[ -s "$T/store/cellular/last_fault" ]' "last_fault written"
read -r LF_S LF_E < "$T/store/cellular/last_fault"
check '[ $((LF_E - LF_S)) -eq 60 ]' "outage 60 s (got $((LF_E - LF_S)))"

# 5. Small NITZ wobble (-80 s then back) never re-anchors.
OFF0="$_hist_off"
WOFF=$((WOFF - 80)); cycles 5; WOFF=$((WOFF + 80)); cycles 5
check '[ "$_hist_off" = "$OFF0" ]' "wobble ignored"

# 6. Event outside the series is ignored; the series' event is queued.
hist_event internet_lost "Internet connectivity lost" warning
check '! grep -q internet_lost "$T/run/cellular.queue" 2>/dev/null' "foreign event ignored"
hist_event nr_anchor "5G NR anchor lost (was N41)" warning
check 'grep -q "\"type\":\"nr_anchor\",\"severity\":\"warning\",\"radio\":\"nr\"" "$T/run/cellular.queue"' "nr_anchor queued"

# 7. Poller restart (same boot): TERM flush, re-source, resume; no double count.
hist_flush
check '[ ! -f "$T/run/cellular.open" ]' "TERM removes open"
load
hist_init
check '[ "$_hist_trusted" = 1 ] && [ "$_hist_off" = "$OFF0" ]' "anchor resumed"
check '[ "$_hist_resume" = 1 ]' "resume flag"
cycles 300

# 8. Large forward step re-anchors.
WOFF=$((WOFF + 7200)); cycles 10
check '[ "$_hist_off" = "$WOFF" ]' "forward step re-anchored"
cycles 1000

# 9. Airplane mode is "off", not an outage.
t1_cfun=4; cycles 30; t1_cfun=1; cycles 5
check 'grep -q "\"off\":[1-9]" "$T/run/cellular.open" "$T/run/cellular.queue" "$T/store/cellular/"*.jsonl 2>/dev/null' "off state recorded"

hist_flush

# 10. Reader / CGIs.
NOWW=$((MONO + WOFF))
printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
OUT=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h" sh "$SRC/series.sh" | sed -n '/^{/,$p')
echo "$OUT" | jq -e '.success and .clock_trusted and (.buckets|length)==48' >/dev/null 2>&1 && ok || bad "series 24h shape: $(echo "$OUT" | head -c 300)"
echo "$OUT" | jq -e '[.buckets[]|(.st|add) <= .len]|all' >/dev/null 2>&1 && ok || bad "st clamped to len"
echo "$OUT" | jq -e '.since == '"$((W0 - 40 + 10))"'' >/dev/null 2>&1 && ok || bad "since = first trusted sample: $(echo "$OUT" | jq -c .since)"
echo "$OUT" | jq -e '.last_fault.end - .last_fault.start == 60' >/dev/null 2>&1 && ok || bad "last_fault in CGI"
echo "$OUT" | jq -e '[.buckets[].x]|add >= 1' >/dev/null 2>&1 && ok || bad "outage count x"
echo "$OUT" | jq -e '.buckets|map(select(.t=='"$W0"'))|.[0].m.lte_rsrp.avg == -99' >/dev/null 2>&1 && ok || bad "avg merged"
for R in 7d 30d; do
    O2=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=$R" sh "$SRC/series.sh" | sed -n '/^{/,$p')
    echo "$O2" | jq -e '.success and (.buckets|length) == (if .range=="7d" then 56 else 60 end)' >/dev/null 2>&1 && ok || bad "series $R"
done
O3=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=nope&range=24h" sh "$SRC/series.sh" | sed -n '/^{/,$p')
echo "$O3" | jq -e '.error=="invalid_series"' >/dev/null 2>&1 && ok || bad "invalid_series"
O4=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=2h" sh "$SRC/series.sh" | sed -n '/^{/,$p')
echo "$O4" | jq -e '.error=="invalid_range"' >/dev/null 2>&1 && ok || bad "invalid_range"
E1=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&limit=1" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E1" | jq -e '.success and .total==2 and (.events|length)==1 and .events[0].type=="nr_anchor" and .counts.band_change==1' >/dev/null 2>&1 && ok || bad "events page: $E1"
E2=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&types=band_change%2Cca_change" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E2" | jq -e '.total==1 and .events[0].timestamp > 0 and .events[0].radio=="lte"' >/dev/null 2>&1 && ok || bad "events filter: $E2"
E3=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&types=internet_lost" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E3" | jq -e '.error=="invalid_param"' >/dev/null 2>&1 && ok || bad "events bad type"

# 11. Torn last line is ignored by the reader.
printf '{"k":"b","t":%s,"st":{"nr":5' "$((NOWW / 1800 * 1800))" >> "$T/store/cellular/d$((NOWW / 86400)).jsonl"
O5=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h" sh "$SRC/series.sh" | sed -n '/^{/,$p')
echo "$O5" | jq -e '.success' >/dev/null 2>&1 && ok || bad "torn line tolerated"

echo "history-test: $PASS passed, $FAIL failed"
[ "$KEEP" = 1 ] || rm -rf "$T"
[ "$FAIL" -eq 0 ]
