#!/bin/sh
# history-test.sh — dev test for the history collector + reader.
# Run on the device (BusyBox): sh history-test.sh <dir-with-libs-and-cgis>
#   <dir> holds history.sh, history_series_cellular.sh, history_read.sh,
#   series.sh, events.sh (flat), plus optionally events_lib.sh (the lib
#   events.sh renamed, for the spool writer cases). Uses a scratch dir under /tmp; touches no
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
check '_hist_in cellular "$HIST_SERIES"' "registry"

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
E4=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E4" | jq -e '[.events[]|has("end")]|any|not' >/dev/null 2>&1 && ok || bad "unpaired types carry no end: $E4"

# 12. External spool (watchcat/CGI writers) + onset/recovery pairing.
load
hist_init
cycles 5
EM1=$((MONO - 30)); EM2=$((MONO - 20))
printf '%s|signal_lost|warning|Signal lost (ext)\n%s|signal_restored|info|Signal restored | ext\nbad|x|y|z\n' \
    "$EM1" "$EM2" > "$T/run/ext.spool"
cycles 5
check '[ -f "$T/run/ext.spool.work" ] && [ ! -f "$T/run/ext.spool" ]' "spool renamed on a sample tick"
cycles 5
check '[ ! -f "$T/run/ext.spool.work" ]' "spool drained"
check 'cat "$T/run/cellular.queue" "$T/store/cellular/"*.jsonl 2>/dev/null | grep -q "^{\"k\":\"e\",\"t\":$((EM1 + WOFF)),\"type\":\"signal_lost\""' "spooled event at its own mono"
check 'cat "$T/run/cellular.queue" "$T/store/cellular/"*.jsonl 2>/dev/null | grep -q "\"message\":\"Signal restored | ext\""' "message keeps a pipe"
if [ -f "$SRC/events_lib.sh" ]; then
    (
        unset -f hist_event
        EVENTS_FILE="$T/ev.ndjson"; MAX_EVENTS=50
        qlog_info() { :; }
        _EVENTS_LOADED=""
        . "$SRC/events_lib.sh"
        append_event watchcat_recovery "Recovery step 1" warning
    )
    check 'grep -qx "$MONO|watchcat_recovery|warning|Recovery step 1" "$T/run/ext.spool"' "events.sh writes the spool"
    rm -f "$T/run/ext.spool"
    rm -rf "$T/run_absent"
    (
        unset -f hist_event
        HIST_RUN="$T/run_absent"; EVENTS_FILE="$T/ev.ndjson"; MAX_EVENTS=50
        qlog_info() { :; }
        _EVENTS_LOADED=""
        . "$SRC/events_lib.sh"
        append_event watchcat_recovery "x" warning
    )
    check '[ ! -d "$T/run_absent" ]' "writer never creates the run dir"
else
    echo "skip: events_lib.sh not in $SRC (lib events.sh renamed)"
fi
cycles 10
hist_event signal_lost "Signal lost (ongoing)" warning
cycles 5
hist_flush
printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
E5=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&types=signal_lost" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E5" | jq -e '.total==2 and .events[0].end==null and .events[1].end=='"$((EM2 + WOFF))"' and .counts.signal_restored==1' >/dev/null 2>&1 && ok || bad "pairing: $E5"
E6=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&types=signal_lost&limit=1&offset=1" sh "$SRC/events.sh" | sed -n '/^{/,$p')
echo "$E6" | jq -e '(.events|length)==1 and .events[0].end=='"$((EM2 + WOFF))"' and .events[0].timestamp=='"$((EM1 + WOFF))"'' >/dev/null 2>&1 && ok || bad "pairing survives paging: $E6"

# 14. Planned reboot early in a bucket: the TERM flush writes last_wall, and
#     the next boot trusts the clock at the settle, not at that bucket's end.
while [ $(( (MONO + WOFF) % 1800 )) -lt 60 ] || [ $(( (MONO + WOFF) % 1800 )) -gt 300 ]; do
    cycles 5
done
cycles 5
hist_flush
LW=$((MONO + _hist_off))
check 'read -r _lw < "$T/store/last_wall" && [ "$_lw" = "$LW" ]' "TERM flush writes last_wall (got $_lw, want $LW)"
LWB=$((LW / 1800 * 1800))
# 14a. A clock behind the last sample is still refused.
printf 'boot-Y\n' > "$T/boot"
MONO=0; WOFF=$((LW - 900))
load; _NOW=$WOFF; _MONO_TOP=0
hist_init
check '[ "$_hist_tfloor" = "$LW" ] && [ "$_hist_hwm" = $((LWB + 1800)) ]' "floor = last_wall, hwm = bucket end (floor $_hist_tfloor hwm $_hist_hwm)"
cycles 160
check '[ "$_hist_trusted" = 0 ]' "clock behind last_wall refused"
# 14b. Wall just past the last sample: trusted once uptime passes the settle.
printf 'boot-Z\n' > "$T/boot"
MONO=0; WOFF=$((LW + 30))
load; _NOW=$WOFF; _MONO_TOP=0
hist_init
cycles 140
check '[ "$_hist_trusted" = 0 ]' "untrusted before the settle"
cycles 20
check '[ "$_hist_trusted" = 1 ] && [ $((MONO + WOFF)) -lt $((LWB + 1800 - 120)) ]' "trusted at the settle, before the bucket end (wall $((MONO + WOFF)), end $((LWB + 1800)))"
# 14c. A marker older than the newest bucket is ignored (hwm stands).
printf '%s\n' $((LWB - 3600)) > "$T/store/last_wall"
load; _NOW=$((MONO + WOFF)); _MONO_TOP=$MONO
hist_init
check '[ "$_hist_tfloor" = "$_hist_hwm" ]' "old marker ignored (floor $_hist_tfloor hwm $_hist_hwm)"
printf '17941\n' > "$T/store/last_wall"
load; hist_init
check '[ "$_hist_tfloor" = "$_hist_hwm" ]' "torn marker ignored"
cycles 5
hist_flush
check 'cat "$T/run/cellular.queue" "$T/store/cellular/"*.jsonl 2>/dev/null | grep -q "^{\"k\":\"r\",\"t\":$LW,\"boot\":1}\$"' "new boot queues a restart row at last_wall"

# 15. Onsets close at a restart (observation stopped) or at a newer onset.
evq() { _SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h&types=signal_lost$1" sh "$SRC/events.sh" | sed -n '/^{/,$p'; }
load; hist_init
cycles 5
# 15a. Onset on a non-sample cycle, TERM, same-boot restart, later recovery.
cycles 2
hist_event signal_lost "Signal lost (cut)" warning
A15=$((MONO + WOFF))
hist_flush
load; hist_init
check 'grep -q "^{\"k\":\"r\",\"t\":$A15,\"boot\":0}\$" "$T/run/cellular.queue"' "same-boot restart row at the last cycle"
cycles 10
hist_event signal_restored "Signal restored (late)" info
C15=$((MONO + WOFF))
cycles 5
hist_flush
printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
E7=$(evq "&limit=1")
echo "$E7" | jq -e '.events[0].timestamp=='"$A15"' and .events[0].end=='"$A15"'' >/dev/null 2>&1 && ok || bad "onset cut at the restart: $E7"
E8=$(HIST_cellular_RESUME=signal_lost evq "&limit=1")
echo "$E8" | jq -e '.events[0].end=='"$C15"'' >/dev/null 2>&1 && ok || bad "RESUME type survives a same-boot restart: $E8"
E9=$(evq "")
echo "$E9" | jq -e '[.events[]|select(.end==null)]|length==0' >/dev/null 2>&1 && ok || bad "older ongoing onsets closed by the restarts: $E9"
# 15b. onset, onset, recovery: the first closes at the second.
cycles 5
hist_event signal_lost "Signal lost (1)" warning
B1=$((MONO + WOFF))
cycles 5
hist_event signal_lost "Signal lost (2)" warning
B2=$((MONO + WOFF))
cycles 5
hist_event signal_restored "Signal restored" info
B3=$((MONO + WOFF))
cycles 5
hist_flush
printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
E10=$(evq "&limit=2")
echo "$E10" | jq -e '.events[0].timestamp=='"$B2"' and .events[0].end=='"$B3"' and .events[1].timestamp=='"$B1"' and .events[1].end=='"$B2"'' >/dev/null 2>&1 && ok || bad "newer onset closes the older: $E10"
# 15c. A device_reboot row in the system store closes an onset where the
#      device went down (t - off); off "-" means at t. Never listed here.
load; hist_init
cycles 5
hist_event signal_lost "Signal lost (reboot)" warning
D15=$((MONO + WOFF))
cycles 60
hist_flush
mkdir -p "$T/store/system"
printf '{"k":"e","t":%s,"type":"device_reboot","severity":"info","radio":null,"message":"cause=user off=40"}\n' \
    $((D15 + 100)) >> "$T/store/system/d$((D15 / 86400)).jsonl"
printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
E11=$(evq "&limit=1")
echo "$E11" | jq -e '.events[0].timestamp=='"$D15"' and .events[0].end=='"$((D15 + 60))"' and .total==6' >/dev/null 2>&1 && ok || bad "device_reboot closes at t - off: $E11"
printf '{"k":"e","t":%s,"type":"device_reboot","severity":"error","radio":null,"message":"cause=unexpected off=-"}\n' \
    $((D15 + 30)) >> "$T/store/system/d$((D15 / 86400)).jsonl"
E12=$(evq "&limit=1")
echo "$E12" | jq -e '.events[0].end=='"$((D15 + 30))"'' >/dev/null 2>&1 && ok || bad "unknown off closes at t: $E12"
rm -rf "$T/store/system"
NOWW=$((MONO + WOFF))

# 11. Torn last line is ignored by the reader.
printf '{"k":"b","t":%s,"st":{"nr":5' "$((NOWW / 1800 * 1800))" >> "$T/store/cellular/d$((NOWW / 86400)).jsonl"
O5=$(_SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="series=cellular&range=24h" sh "$SRC/series.sh" | sed -n '/^{/,$p')
echo "$O5" | jq -e '.success' >/dev/null 2>&1 && ok || bad "torn line tolerated"

# 13. QMI lane SSR window: a fresh qmi_state=down is "down" even while the
#     (lagging) AT state still says connected; a stale one, or no lane, is not.
t1_cfun=1; modem_reachable=true; service_status=optimal
lte_state=connected; nr_state=connected
_MONO_TOP=5000
_QMI_OK=1; _QMI_STATE=down; _QMI_READ_MONO=4995
hist_cellular_sample
check '[ "$_HS" = down ] && [ -z "$_HV_nr_rsrp" ]' "fresh QMI down = down, no metrics (got $_HS)"
_QMI_READ_MONO=4980
hist_cellular_sample
check '[ "$_HS" = nr ]' "stale QMI down ignored (got $_HS)"
_QMI_READ_MONO=4995; _QMI_OK=0
hist_cellular_sample
check '[ "$_HS" = nr ]' "no QMI lane = AT state (got $_HS)"
_QMI_OK=1; _QMI_STATE=up
hist_cellular_sample
check '[ "$_HS" = nr ]' "QMI up = AT state (got $_HS)"
_QMI_STATE=down; _QMI_READ_MONO=5003
hist_cellular_sample
check '[ "$_HS" = nr ]' "QMI read in the future ignored (got $_HS)"
_QMI_READ_MONO=4995; t1_cfun=4
hist_cellular_sample
check '[ "$_HS" = off ]' "CFUN 4 wins over QMI down (got $_HS)"
t1_cfun=1; _QMI_OK=0; _QMI_STATE=""

echo "history-test: $PASS passed, $FAIL failed"
[ "$KEEP" = 1 ] || rm -rf "$T"
[ "$FAIL" -eq 0 ]
