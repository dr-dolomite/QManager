#!/bin/sh
# system-test.sh — dev test for the System Health provider
# (history_series_system.sh) on top of the history core.
# Run (BusyBox on the device, or any POSIX sh): sh system-test.sh <dir>
#   <dir> holds history.sh and history_series_system.sh (flat), plus
#   optionally parse_at.sh for the t1_temperature_max case. Only those files
#   are copied into a scratch dir, so other providers are not loaded. df and
#   dmesg are shell-function stubs; touches no live state.
#   HIST_TEST_MODE=logd: the provider's events go to the journal stand-in
#   (logd-stub.sh next to this script) and the checks read them back there.

SRC="${1:?usage: system-test.sh <dir>}"
T="${TMPDIR:-/tmp}/qm_hist_sys_test.$$"
rm -rf "$T"
mkdir -p "$T/lib" "$T/store" "$T/run"
cp "$SRC/history.sh" "$SRC/history_series_system.sh" "$T/lib/" || exit 1
printf 'boot-A\n' > "$T/boot"

export HIST_LIB_DIR="$T/lib" HIST_STORE="$T/store" HIST_RUN="$T/run" \
    HIST_BOOT_ID_FILE="$T/boot" HIST_SYNC=true \
    HIST_SYS_CRASH_LOG="$T/crash.log"

MODE="${HIST_TEST_MODE:-legacy}"
. "$(dirname "$0")/logd-stub.sh"
if [ "$MODE" = logd ]; then
    jsetup "$T/j"
else
    jnone "$T"
fi

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
check() { if eval "$1"; then ok; else bad "$2 [$1]"; fi; }

# hist_event falls back to jq without the JSON helper; keep the test jq-free.
command -v _jstr >/dev/null 2>&1 || _jstr() { _JV="\"$1\""; }

# df stub: the provider's area query (counted) and the core's free-space query.
DFN=0
DF_MODE=normal
df() {
    if [ "$2" = "/real_rootfs" ]; then
        DFN=$((DFN + 1))
        printf 'Filesystem           1K-blocks      Used Available Use%% Mounted on\n'
        [ "$DF_MODE" = "nosys" ] || printf 'ubi0:rootfs              80000     60000     20000  75%% /real_rootfs\n'
        printf '/dev/ubi0_usrdata_very_long_name\n                        300000    120000    180000  40%% /usrdata\n'
        printf 'tmpfs                   200000      4000    196000   2%% /tmp\n'
        return 0
    fi
    printf 'Filesystem 1K-blocks Used Available Use%% Mounted on\nx 100000 1000 99000 1%% /usrdata\n'
}
DMESG_TS=""
dmesg() {
    [ -n "$DMESG_TS" ] && printf '[%6s.123456] remoteproc remoteproc0: 4080000.remoteproc-mss: fatal error received: err_qdi.c\n' "$DMESG_TS"
    return 0
}

load() {
    unset _QM_HISTORY_LOADED
    . "$T/lib/history.sh"
}

# Poller globals.
cpu_usage=12; memory_used_mb=300; memory_total_mb=1200
t1_temperature_max=47; thermal_throttling=0
_QMI_OK=1; _QMI_SSR=2; _QMI_STATE=up
W0=1794187800

MONO=400
WOFF=$W0
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
    [ "$MODE" = logd ] && jingest "$WOFF"
    return 0
}
# samples N: N provider samples (5 poller cycles each).
samples() { cycles $(($1 * 5)); }
evs() {
    if [ "$MODE" = logd ]; then
        jingest "$WOFF"
        cat "$J/rows"
    else
        cat "$T/run/system.queue" "$T/store/system/"d*.jsonl 2>/dev/null | grep '^{"k":"e"'
    fi
}
evn() { evs | grep -c "$1"; }

# newboot ID GAP: the device was down GAP s after the last sample, then booted.
newboot() {
    printf '%s\n' "$1" > "$T/boot"
    BE=$((MONO + WOFF + $2))
    MONO=398
    WOFF=$BE
    load
    _NOW=$((MONO + WOFF)); _MONO_TOP=$MONO
    hist_init
    # A partial bucket flushed before the reboot holds trust until its end
    # (core rule: wall >= newest stored bucket end - 120 s).
    _nb=0
    while [ "$_nb" -lt 200 ]; do
        samples 1
        [ "$_hist_trusted" = 1 ] && break
        _nb=$((_nb + 1))
    done
}

load
_NOW=$((MONO + WOFF)); _MONO_TOP=$MONO
hist_init
check '[ "$_hist_ready" = 1 ]' "init ready"
check '_hist_in system "$HIST_SERIES"' "registry"

# 1. First sample: trusted, metrics, storage, first run records no reboot.
samples 1
check '[ "$_hist_trusted" = 1 ]' "trusted"
check '[ "$_HS" = normal ]' "state normal"
check '[ "$_HV_cpu" = 12 ] && [ "$_HV_mem_mb" = 300 ] && [ "$_HV_mem_pct" = 25 ] && [ "$_HV_temp_c" = 47 ]' "steady metrics"
check '[ "$DFN" = 1 ]' "storage sampled on the first tick"
check '[ "$_HV_st_sys_used" = 60000 ] && [ "$_HV_st_sys_size" = 80000 ]' "sys storage"
check '[ "$_HV_st_app_used" = 120000 ] && [ "$_HV_st_app_size" = 300000 ]' "wrapped df line (app)"
check '[ "$_HV_st_tmp_used" = 4000 ] && [ "$_HV_st_tmp_size" = 200000 ]' "tmp storage"
check '[ "$_ha_system_n_st_sys_used" = 1 ]' "storage accumulated"
check 'read -r _bm < "$T/store/system/boot" && [ "$_bm" = boot-A ]' "first run writes the boot marker"
check '[ "$(evn device_reboot)" = 0 ]' "first run records no reboot"
check 'read -r _a1 _a2 < "$T/store/system/alive" && [ "$_a2" = boot-A ] && [ "$_a1" = $((MONO + WOFF)) ]' "alive stamp"

# 2. Steady state: no storage until the 361st sample; bad values = no reading.
samples 1
check '[ -z "$_HV_st_sys_used" ] && [ "$DFN" = 1 ]' "storage empty between hourly samples"
cpu_usage=150; t1_temperature_max=-273; memory_total_mb=0
samples 1
check '[ -z "$_HV_cpu" ] && [ -z "$_HV_temp_c" ] && [ -z "$_HV_mem_pct" ] && [ "$_HV_mem_mb" = 300 ]' "out-of-range values dropped"
cpu_usage=12; t1_temperature_max=47; memory_total_mb=1200
thermal_throttling=1
samples 2
check '[ "$_HS" = throttled ]' "throttled state"
check '[ "${_ha_system_st_throttled:-0}" -ge 10 ]' "throttled seconds"
thermal_throttling=0
samples 355
check '[ "$DFN" = 1 ]' "no df through sample 360"
samples 1
check '[ "$DFN" = 2 ] && [ -n "$_HV_st_tmp_used" ]' "df again on sample 361"
DF_MODE=nosys
samples 360
check '[ "$DFN" = 3 ] && [ -z "$_HV_st_sys_used" ] && [ "$_HV_st_app_used" = 120000 ]' "missing mount = no reading"
DF_MODE=normal
check 'grep -q "\"st\":{\"normal\":[0-9]*,\"throttled\":[0-9]*},\"x\":0," "$T/store/system/"d*.jsonl' "bucket row shape, no fault entries"

# 3. SSR: count up = crash (onset refined from dmesg), up = recovered.
_QMI_SSR=3; _QMI_STATE=down; DMESG_TS=$((MONO + 10 - 4))
samples 1
check '[ "$(evn modem_crash)" = 1 ]' "modem_crash recorded"
check 'evs | grep -q "\"t\":$((MONO - 4 + WOFF)),\"type\":\"modem_crash\",\"severity\":\"error\""' "crash onset from dmesg"
samples 2
check '[ "$(evn modem_recovered)" = 0 ]' "no recovery while down"
_QMI_STATE=up
samples 1
check 'evs | grep -q "\"t\":$((MONO + WOFF)),\"type\":\"modem_recovered\",\"severity\":\"info\""' "recovered at the up sample"
samples 1
check '[ "$(evn modem_recovered)" = 1 ]' "one recovery"
# dmesg stamp older than the previous sample: onset stays at this sample.
_QMI_SSR=5; _QMI_STATE=up; DMESG_TS=$((MONO - 30))
samples 1
check '[ "$(evn modem_crash)" = 2 ]' "jump of 2 = one crash"
check 'evs | grep -q "\"t\":$((MONO + WOFF)),\"type\":\"modem_crash\""' "stale dmesg ignored"
check '[ "$(evn modem_recovered)" = 2 ]' "already up = recovered on the same sample"
# Count down (broker restart) re-baselines silently.
_QMI_SSR=0
samples 1
check '[ "$(evn modem_crash)" = 2 ] && [ "$_hsy_ssr" = 0 ]' "count down re-baselines"
# Crash open across a poller restart, then count down closes it.
_QMI_SSR=1; _QMI_STATE=down; DMESG_TS=""
samples 1
check '[ "$(evn modem_crash)" = 3 ]' "crash after re-baseline"
hist_flush
load
_NOW=$((MONO + WOFF)); _MONO_TOP=$MONO
hist_init
samples 1
check '[ "$_hsy_crash" = 1 ] && [ "$_hsy_ssr" = 1 ] && [ "$(evn modem_crash)" = 3 ]' "SSR state resumed after a poller restart"
check '[ "$(evn device_reboot)" = 0 ]' "poller restart records no reboot"
_QMI_SSR=0
samples 1
check '[ "$(evn modem_recovered)" = 3 ]' "count down closes an open crash"
_QMI_OK=0; _QMI_SSR=0
samples 1
_QMI_OK=1; _QMI_SSR=0; _QMI_STATE=up
samples 1
check '[ "$(evn modem_crash)" = 3 ]' "lane absent changes nothing"

# logd kernel capture (kmsg=1): the onset comes from `qlog logq`, not dmesg;
# an empty answer or an unreachable logd falls back to dmesg.
if [ "$MODE" = logd ]; then
    printf 'kmsg=1
' >> "$J/proto"
    printf '%s
' $((MONO + 10 - 6)) > "$J/kmsg_ts"
    DMESG_TS=$((MONO + 10 - 2))
    _QMI_SSR=1; _QMI_STATE=up
    samples 1
    check '[ "$(evn modem_crash)" = 4 ]' "crash recorded with kmsg=1"
    check 'evs | grep -q "\"t\":$((MONO - 6 + WOFF)),\"type\":\"modem_crash\""' "crash onset from logq, not dmesg"
    : > "$J/kmsg_ts"
    DMESG_TS=$((MONO + 10 - 3))
    _QMI_SSR=2
    samples 1
    check 'evs | grep -q "\"t\":$((MONO - 3 + WOFF)),\"type\":\"modem_crash\""' "empty logq answer falls back to dmesg"
    printf '%s
' $((MONO + 10 - 6)) > "$J/kmsg_ts"
    DMESG_TS=$((MONO + 10 - 1))
    touch "$J/down"
    _QMI_SSR=3
    samples 1
    rm -f "$J/down"
    check 'evs | grep -q "\"t\":$((MONO - 1 + WOFF)),\"type\":\"modem_crash\""' "logd unreachable falls back to dmesg"
    printf 'proto=1
version=stub
logq=1
evq=1
' > "$J/proto"
    : > "$J/kmsg_ts"
    DMESG_TS=""
    _QMI_SSR=0
    samples 1
fi

# 4. Reboot classification.
# The newest device_reboot row by t (queue and day files are not in t order).
rbmsg() {
    evs | grep '"type":"device_reboot"'         | awk -F'"t":' '{ split($2, a, ","); if (a[1] + 0 >= m) { m = a[1] + 0; l = $0 } } END { print l }'
}
ALIVE=$((MONO + WOFF))
printf '%s boot-A\n' "$ALIVE" > "$T/store/system/alive"
printf '%s|reboot|user\n' $((ALIVE + 20)) > "$T/crash.log"
newboot boot-B 70
check 'rbmsg | grep -q "\"t\":$BE,\"type\":\"device_reboot\",\"severity\":\"info\",\"radio\":null,\"message\":\"cause=user off=$((BE - ALIVE - 20))\""' "planned user: $(rbmsg)"
check 'read -r _bm < "$T/store/system/boot" && [ "$_bm" = boot-B ]' "marker updated"
check '[ "$(evn device_reboot)" = 1 ]' "one reboot event"
samples 3
load; _NOW=$((MONO + WOFF)); _MONO_TOP=$MONO; hist_init; samples 2
check '[ "$(evn device_reboot)" = 1 ]' "poller restart in the same boot is silent"

for CASE in scheduled:scheduled update:update tier4_escalation:watchdog; do
    ALIVE=$((MONO + WOFF))
    BID="boot-${CASE%%:*}"
    PREV=$(cat "$T/store/system/boot")
    printf '%s %s\n' "$ALIVE" "$PREV" > "$T/store/system/alive"
    printf '%s|reboot|user\n%s|reboot|%s\n%s|reboot|unplanned\n' \
        $((ALIVE - 4000)) $((ALIVE + 5)) "${CASE%%:*}" $((ALIVE + 6)) > "$T/crash.log"
    newboot "$BID" 100
    check 'rbmsg | grep -q "\"severity\":\"info\".*\"message\":\"cause=${CASE#*:} off=$((BE - ALIVE - 5))\""' "planned ${CASE#*:}: $(rbmsg)"
done

# Unexpected with a valid alive stamp: offline from the stamp.
ALIVE=$((MONO + WOFF))
printf '%s %s\n' "$ALIVE" "$(cat "$T/store/system/boot")" > "$T/store/system/alive"
printf '%s|reboot|user\n%s|reboot|unplanned\n' $((ALIVE - 4000)) $((ALIVE + 10)) > "$T/crash.log"
newboot boot-U1 200
check 'rbmsg | grep -q "\"severity\":\"error\".*\"message\":\"cause=unexpected off=200\""' "unexpected with alive: $(rbmsg)"

# Unexpected with a torn alive stamp: offline unknown.
printf '17941' > "$T/store/system/alive"
: > "$T/crash.log"
newboot boot-U2 300
check 'rbmsg | grep -q "\"severity\":\"error\".*\"message\":\"cause=unexpected off=-\""' "torn alive = unknown: $(rbmsg)"

# Alive from another boot than the marker: fallback window, offline unknown.
printf '%s boot-OTHER\n' $((MONO + WOFF)) > "$T/store/system/alive"
rm -f "$T/crash.log"
newboot boot-U3 50
check 'rbmsg | grep -q "\"message\":\"cause=unexpected off=-\""' "foreign alive = unknown: $(rbmsg)"
# ...but a planned row within 15 min of boot still classifies.
printf '%s boot-OTHER\n' $((MONO + WOFF)) > "$T/store/system/alive"
printf '%s|reboot|update\n' $((MONO + WOFF + 10)) > "$T/crash.log"
newboot boot-U4 60
check 'rbmsg | grep -q "\"message\":\"cause=update off=50\""' "fallback window planned: $(rbmsg)"

# Clock untrusted after boot: classification waits for trust.
printf '%s %s\n' $((MONO + WOFF)) "$(cat "$T/store/system/boot")" > "$T/store/system/alive"
N0=$(evn device_reboot)
printf 'boot-L\n' > "$T/boot"
BE=$((MONO + WOFF + 40)); MONO=10; WOFF=0
load; _NOW=$MONO; _MONO_TOP=$MONO; hist_init
samples 5
check '[ "$_hist_trusted" = 0 ] && [ "$(evn device_reboot)" = "$N0" ]' "nothing before trust"
WOFF=$BE
samples 1
check '[ "$(evn device_reboot)" = $((N0 + 1)) ] && rbmsg | grep -q "\"t\":$BE,.*cause=unexpected off=40"' "classified at first trust: $(rbmsg)"

# 5. t1_temperature_max (parse_temperature on a fake sysfs tree).
if [ -f "$SRC/parse_at.sh" ]; then
    Z="$T/thermal"
    mkzone() { mkdir -p "$Z/thermal_zone$1"; printf '%s\n' "$2" > "$Z/thermal_zone$1/type"; printf '%s\n' "$3" > "$Z/thermal_zone$1/temp"; }
    mkzone 0 mdmss-0 41500
    mkzone 1 cpuss-1 52500
    mkzone 2 sdr0 -273000
    mkzone 3 pa-therm 90000
    mkzone 4 xo-therm 0
    sed -n '/^parse_temperature() {/,/^}/p' "$SRC/parse_at.sh" | sed "s#/sys/class/thermal#$Z#" > "$T/pt.sh"
    _parse_temperature_legacy() { t1_temperature="legacy"; t1_temperature_max=""; }
    . "$T/pt.sh"
    parse_temperature
    check '[ "$t1_temperature" = 47 ] && [ "$t1_temperature_max" = 52 ]' "max = hottest valid zone, half-to-even (got $t1_temperature / $t1_temperature_max)"
    printf '53500\n' > "$Z/thermal_zone1/temp"
    parse_temperature
    check '[ "$t1_temperature_max" = 54 ]' "max rounds 53.5 to 54 (got $t1_temperature_max)"
    printf -- '-40960\n' > "$Z/thermal_zone0/temp"; printf -- '-273000\n' > "$Z/thermal_zone1/temp"
    parse_temperature
    check '[ -z "$t1_temperature" ] && [ -z "$t1_temperature_max" ]' "no valid zone = empty"
else
    echo "skip: parse_at.sh not in $SRC"
fi

echo "system-test ($MODE): $PASS passed, $FAIL failed"
[ "$KEEP" = 1 ] || rm -rf "$T"
[ "$FAIL" -eq 0 ]
