#!/bin/sh
# journal-test.sh — History on top of qmanager_logd's event journal (Phase 3,
# docs/features/history.md §2 and §6): the writer switch (hist_event,
# append_event, radio=), the clock_stepped / storage_low events and the
# events CGI's journal reader (merge, de-duplication, windows, fallback).
# Run: sh journal-test.sh <flat dir> (the history-test flat dir, with
# events_lib.sh). Uses logd-stub.sh next to this script; HIST_TEST_MODE is
# ignored (the cases set up both stores themselves).

SRC="${1:?usage: journal-test.sh <dir>}"
T="${TMPDIR:-/tmp}/qm_hist_jtest.$$"
rm -rf "$T"
mkdir -p "$T/store" "$T/run"
printf 'boot-A\n' > "$T/boot"
export HIST_LIB_DIR="$SRC" HIST_STORE="$T/store" HIST_RUN="$T/run" \
    HIST_BOOT_ID_FILE="$T/boot" HIST_SYNC=true HIST_UPTIME_FILE="$T/uptime" \
    HIST_SYS_CRASH_LOG="$T/crash.log"
. "$(dirname "$0")/logd-stub.sh"
HIST_EVQ_PAGE=7
jsetup "$T/j"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
check() { if eval "$1"; then ok; else bad "$2 [$1]"; fi; }
command -v _jstr >/dev/null 2>&1 || _jstr() { _JV="\"$1\""; }
DF_FREE=99000
df() {
    [ "$2" = "/real_rootfs" ] && return 0
    printf 'Filesystem 1K-blocks Used Available Use%% Mounted on\nx 100000 1000 %s 1%% /usrdata\n' "$DF_FREE"
}
dmesg() { :; }

t1_cfun=1; modem_reachable=true; service_status=optimal
lte_state=connected; nr_state=connected
lte_rsrp=-99; lte_rsrq=-10; lte_sinr=22; lte_rssi=-69
nr_rsrp=-84; nr_rsrq=-11; nr_sinr=24
conn_internet_available=true; conn_latency=40
cpu_usage=10; memory_used_mb=100; memory_total_mb=1000; thermal_throttling=0
W0=1794187800
MONO=400
WOFF=$W0
cycles() {
    local _i
    _i=0
    while [ "$_i" -lt "$1" ]; do
        MONO=$((MONO + 2)); _MONO_TOP=$MONO; _NOW=$((MONO + WOFF))
        hist_tick
        _i=$((_i + 1))
    done
    printf '%s.00 0.00\n' "$MONO" > "$T/uptime"
}
# A stand-in for events.sh append_event (history.sh calls it when loaded).
AE="$T/ae.log"
append_event() { printf '%s|%s|%s|%s|%s\n' "$1" "$2" "${3:-info}" "${4:-}" "${5:-}" >> "$AE"; }
spool() { cat "$QLOGD_RUN_DIR/spool" 2>/dev/null; }
queued() { cat "$T/run/"*.queue "$T/store/"*/d*.jsonl 2>/dev/null | grep '^{"k":"e"'; }

unset _QM_HISTORY_LOADED
. "$SRC/history.sh"
_NOW=$((MONO + WOFF)); _MONO_TOP=$MONO
hist_init
cycles 5
check '[ "$_hist_trusted" = 1 ]' "trusted"

# 1. hist_event while logd is alive: one spool line at the event's own mono,
#    radio from the provider rule, nothing in the day files.
hist_event band_change "LTE band B3 -> B7" info
hist_event signal_restored "Signal restored" info 377
hist_event device_reboot "cause=user off=12" info 0 "cause=user;off=12"
hist_event not_a_history_type "x" info
check 'spool | grep -qx "E	$MONO	band_change	info		radio=lte	LTE band B3 -> B7"' "band_change spooled with radio: $(spool | head -n 1)"
check 'spool | grep -qx "E	377	signal_restored	info		radio=nr	Signal restored"' "signal_restored radio from the live state, own mono"
check 'spool | grep -qx "E	0	device_reboot	info		cause=user;off=12	cause=user off=12"' "device_reboot at mono 0 with fields"
check '! spool | grep -q not_a_history_type' "foreign type not spooled"
check '[ -z "$(queued)" ]' "no k:e rows in the day files while logd is alive"
jingest "$WOFF"
check 'grep -q "^{\"k\":\"e\",\"t\":$WOFF,\"type\":\"device_reboot\"" "$J/rows"' "mono 0 maps to the boot moment"

# 2. logd not alive: the legacy row, as before.
rm -f "$QLOGD_RUN_DIR/alive"
hist_event band_change "LTE band B7 -> B3" info
check 'queued | grep -q "\"type\":\"band_change\",\"severity\":\"info\",\"radio\":\"lte\",\"message\":\"LTE band B7 -> B3\""' "legacy row when logd is down"
check '! spool | grep -q "B7 -> B3"' "nothing spooled when logd is down"
: > "$QLOGD_RUN_DIR/alive"

# 3. append_event (events.sh): alive = one spool line with radio=, no tap.
TAP="$T/tap.log"
(
    hist_event() { echo "$*" >> "$TAP"; }
    unset -f append_event
    EVENTS_FILE="$T/ev.ndjson"; MAX_EVENTS=50
    qlog_info() { :; }
    _EVENTS_LOADED=""
    . "$SRC/events_lib.sh"
    : > "$QLOGD_RUN_DIR/spool"
    append_event pci_change "LTE PCI 12 -> 40" info
    append_event signal_restored "Signal restored" info
    append_event ca_change "NR carriers 2 -> 1" info "" "from=2;to=1"
    append_event band_change "Band B3" info "" "radio=nr"
    append_event internet_lost "Internet lost" warning wd_tier_start
    nr_state=idle; lte_state=connected
    append_event signal_restored "Signal restored" info
)
check 'spool | grep -q "	pci_change	info		radio=lte	LTE PCI 12 -> 40$"' "append_event radio from the prefix"
check 'spool | grep -q "	signal_restored	info		radio=nr	Signal restored$"' "append_event radio from the live state"
check 'spool | grep -q "	ca_change	info		from=2;to=1;radio=nr	NR carriers"' "radio appended to the writer fields"
check 'spool | grep -q "	band_change	info		radio=nr	Band B3$"' "writer radio kept"
check 'spool | grep -q "	internet_lost	warning	wd_tier_start		Internet lost$"' "non-cellular type: no radio"
check 'spool | grep -q "	signal_restored	info		radio=lte	Signal restored$"' "live state lte"
check '[ ! -s "$TAP" ] && [ ! -f "$T/run/ext.spool" ]' "no history tap while logd is alive"
rm -f "$QLOGD_RUN_DIR/alive"
(
    hist_event() { echo "$*" >> "$TAP"; }
    unset -f append_event
    EVENTS_FILE="$T/ev.ndjson"; MAX_EVENTS=50
    qlog_info() { :; }
    _EVENTS_LOADED=""
    . "$SRC/events_lib.sh"
    append_event internet_lost "Internet lost (legacy)" warning
)
check 'grep -q "internet_lost warning Internet lost (legacy)\|internet_lost Internet lost (legacy) warning" "$TAP"' "tap on the legacy path: $(cat "$TAP" 2>/dev/null)"
: > "$QLOGD_RUN_DIR/alive"
: > "$QLOGD_RUN_DIR/spool"

# 4. clock_stepped (signed) and storage_low (first transition only).
: > "$AE"
WOFF=$((WOFF + 7200)); cycles 5
check 'grep -qx "clock_stepped|Clock stepped by 7200s|info||step_s=7200" "$AE"' "forward step: $(cat "$AE")"
: > "$AE"
WOFF=$((WOFF - 86400)); cycles 5
check 'grep -q "^clock_stepped|Clock stepped by -86400s|info||step_s=-86400$" "$AE"' "backward step signed: $(cat "$AE")"
WOFF=$((WOFF + 86400)); cycles 400
: > "$AE"
DF_FREE=4000
_hist_closed=1; hist_flush_queues
_hist_closed=1; hist_flush_queues
check '[ "$(grep -c "^storage_low|" "$AE")" = 1 ] && grep -qx "storage_low|Storage low (4000 KB free)|warning||free_kb=4000;min_kb=8192" "$AE"' "storage_low once: $(cat "$AE")"
DF_FREE=99000
_hist_closed=1; hist_flush_queues
DF_FREE=10
_hist_closed=1; hist_flush_queues
check '[ "$(grep -c "^storage_low|" "$AE")" = 2 ]' "storage_low again after recovery"
DF_FREE=99000
_hist_closed=1; hist_flush_queues

# 5. Reader. Build a store with events in the day files (legacy), then serve
#    the same rows from the journal: every answer must be byte-identical.
NOW=$((MONO + WOFF))
cev() { _SKIP_AUTH=1 REQUEST_METHOD=GET QUERY_STRING="$1" sh "$SRC/events.sh" | sed -n '/^{/,$p'; }
D="$T/store/connection"
mkdir -p "$D" "$T/store/system"
DF="$D/d$((NOW / 86400)).jsonl"
: > "$DF"
row() { printf '{"k":"e","t":%s,"type":"%s","severity":"%s","radio":null,"message":"%s"}\n' "$1" "$2" "$3" "$4"; }
i=0
while [ "$i" -lt 40 ]; do
    tb=$((NOW - 80000 + i * 1500))
    row "$tb" internet_lost warning "Internet lost $i" >> "$DF"
    row $((tb + 300)) internet_restored info "Internet back $i" >> "$DF"
    i=$((i + 1))
done
row $((NOW - 9000)) data_call_dropped warning "Data call dropped" >> "$DF"
row $((NOW - 8000)) data_call_restored info "Data call restored" >> "$DF"
row $((NOW - 7000)) site_down warning "Site a down" >> "$DF"
row $((NOW - 6900)) site_down warning "Site b down" >> "$DF"
row $((NOW - 6000)) site_up info "Site a up" >> "$DF"
row $((NOW - 5000)) dns_failing warning "DNS failing" >> "$DF"
row $((NOW - 4000)) internet_lost warning "Internet lost (open)" >> "$DF"
printf '{"k":"r","t":%s,"boot":1}\n' $((NOW - 50000)) >> "$DF"
row $((NOW - 3000)) device_reboot info "cause=user off=600" >> "$T/store/system/d$((NOW / 86400)).jsonl"
Q1="series=connection&range=24h&limit=100"
Q2="series=connection&range=24h&types=internet_lost&limit=7&offset=3"
Q3="series=connection&range=24h&types=site_down%2Csite_up%2Cdata_call_dropped%2Cdns_failing"
printf 'proto=1\n' > "$HIST_LOGD_PROTO"
L1=$(cev "$Q1"); L2=$(cev "$Q2"); L3=$(cev "$Q3")
check '[ ! -f "$J/calls" ]' "no evq capability: qlog never called"
echo "$L1" | jq -e '.success and .total == 87' >/dev/null 2>&1 && ok || bad "legacy answer: $(echo "$L1" | head -c 300)"
echo "$L3" | jq -e '([.events[] | select(.type == "data_call_dropped")][0].end) == '"$((NOW - 8000))"' and ([.events[] | select(.type == "dns_failing")][0].end) == '"$((NOW - 3600))"' and ([.events[] | select(.type == "site_down")] | all(has("end") | not))' >/dev/null 2>&1 && ok || bad "new pairs, site_* unpaired: $L3"
echo "$L1" | jq -e '([.events[] | select(.message == "Internet lost (open)")][0].end) == '"$((NOW - 3600))"'' >/dev/null 2>&1 && ok || bad "device_reboot break (t - off): $(echo "$L1" | jq -c '.events[0]')"
printf 'proto=1\nevq=1\n' > "$HIST_LOGD_PROTO"
# Same rows in both stores (a build that wrote both): de-duplicated.
cat "$DF" "$T/store/system/"d*.jsonl | grep '^{"k":"e"' > "$J/rows"
check '[ "$(cev "$Q1")" = "$L1" ] && [ "$(cev "$Q2")" = "$L2" ] && [ "$(cev "$Q3")" = "$L3" ]' "both stores: identical (de-duplicated)"
# Events only in the journal (Phase 3): identical, read in windows.
grep -v '^{"k":"e"' "$DF" > "$DF.tmp"; mv -f "$DF.tmp" "$DF"
rm -f "$T/store/system/"d*.jsonl "$J/calls"
R1=$(cev "$Q1")
check '[ "$R1" = "$L1" ] && [ "$(cev "$Q2")" = "$L2" ] && [ "$(cev "$Q3")" = "$L3" ]' "journal only: identical"
check '[ "$(wc -l < "$J/calls")" -gt 3 ]' "a full page splits the range (calls: $(wc -l < "$J/calls"))"
# Split: half in each store.
i=0
: > "$J/rows.b"
while IFS= read -r l; do
    if [ $((i % 2)) -eq 0 ]; then printf '%s\n' "$l" >> "$DF"; else printf '%s\n' "$l" >> "$J/rows.b"; fi
    i=$((i + 1))
done < "$J/rows"
mv -f "$J/rows.b" "$J/rows"
check '[ "$(cev "$Q1")" = "$L1" ]' "half in each store: identical"
# logd unreachable: the day files alone (the journal half is missing).
: > "$J/down"
U1=$(cev "$Q1")
echo "$U1" | jq -e '.success and .total == 44' >/dev/null 2>&1 && ok || bad "qlog exit 3 = day files only: $(echo "$U1" | head -c 200)"
rm -f "$J/down"

echo "journal-test: $PASS passed, $FAIL failed"
[ "$KEEP" = 1 ] || rm -rf "$T"
[ "$FAIL" -eq 0 ]
