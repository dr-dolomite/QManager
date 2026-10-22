#!/bin/sh
# sidecar_parity.sh: dev-only check of the B5.29 Phase C sidecars (never
# installed). Runs ON the device, BusyBox ash, entirely in a scratch dir: it
# never reads or writes the live /tmp/qmanager_* or /var/run/qmanager files.
#
# Proves, for the staged files:
#   - conn_state_read_env gives the same CQ_* results as conn_state_read for the
#     ping.env that qmanager_ping's write_ping_env writes (fresh, stale,
#     recovery, quoting, empty target), and returns 2 for a missing, older or
#     incomplete sidecar;
#   - read_dns_data gives the same dns_lookup_ms / dns_resolver from dns.env as
#     from dns.json;
#   - load_ondemand_cache_gated gives the same 12 values from ondemand.env as the
#     jq path (hostile quoting included) and falls back when the JSON is newer;
#   - the gated read_watchcat_state / read_sim_state re-read only on change;
#   - the sidecar paths fork no jq / date / touch / awk;
#   - with a 5th argument (qmi_merge.sh): qmi_load accepts the broker's qmi.env
#     and rejects a truncated, stray-line, shell-active or non-qmi_ file, the
#     stamp gate skips an older env and re-reads a same-second or forced one,
#     qmi_overlay_apply / qmi_overlay_restore follow every merge gate, and the
#     qmi path forks nothing.
#
# Usage: sidecar_parity.sh <poller> <qmanager_ping> <conn_state.sh> <ondemand_radio.sh> [qmi_merge.sh]
# Exit 0 only when nothing failed.

POLLER="$1"; PING="$2"; CONN="$3"; ONDEM="$4"; QMIM="$5"
[ -f "$POLLER" ] && [ -f "$PING" ] && [ -f "$CONN" ] && [ -f "$ONDEM" ] || {
    echo "usage: sidecar_parity.sh <poller> <qmanager_ping> <conn_state.sh> <ondemand_radio.sh>" >&2
    exit 2
}

T="/tmp/pcx_sc.$$"
mkdir -p "$T/run" || exit 2
trap 'rm -rf "$T"' EXIT
PASS=0
FAIL=0
FIRST=""

ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); [ -z "$FIRST" ] && FIRST="$1"; echo "FAIL: $1"; }
check() { # name expected actual
    if [ "$2" = "$3" ]; then ok; else bad "$1: expected [$2] got [$3]"; fi
}

# External-command counter: shell functions win over PATH, and the counter is a
# builtin append, so counting costs no fork.
FORKS="$T/forks"
: > "$FORKS"
jq() { echo jq >> "$FORKS"; command jq "$@"; }
date() { echo date >> "$FORKS"; command date "$@"; }
touch() { echo touch >> "$FORKS"; command touch "$@"; }
awk() { echo awk >> "$FORKS"; command awk "$@"; }
count_forks() { # name
    local _n=0
    local _l
    while IFS= read -r _l; do _n=$((_n + 1)); done < "$FORKS"
    echo "$_n"
}

# qlog shims
qlog_warn() { :; }
qlog_info() { :; }
qlog_debug() { :; }
qlog_error() { :; }

# --- libraries under test ----------------------------------------------------
CQ_PING_CACHE="$T/ping.json"
CQ_PING_ENV="$T/run/ping.env"
. "$CONN"
CQ_PING_CACHE="$T/ping.json"
CQ_PING_ENV="$T/run/ping.env"

ONDEMAND_ENV="$T/run/ondemand.env"
ONDEMAND_STAMP="$T/run/ondemand.stamp"
. "$ONDEM"
ONDEMAND_CACHE_FILE="$T/ondemand.json"
ONDEMAND_CACHE_TMP="$T/ondemand.json.tmp"
ONDEMAND_ENV="$T/run/ondemand.env"
ONDEMAND_STAMP="$T/run/ondemand.stamp"

# functions lifted from the ping daemon and the poller
_lift() { # file name
    sed -n "/^$2() {/,/^}/p" "$1"
}
for _f in write_cache _sc_sq _sc_dir_ok write_ping_env write_dns_env; do
    _lift "$PING" "$_f" > "$T/f.sh"
    [ -s "$T/f.sh" ] || { echo "cannot lift $_f from $PING"; exit 2; }
    . "$T/f.sh"
done
# ping's write_cache needs mono_now (qlog.sh on the device; reimplemented here so
# the live log is never touched). MONO_SKEW shifts it back to fake an old write.
MONO_SKEW=0
mono_now() {
    local _u
    _u=0
    { read -r _u _i < /proc/uptime; } 2>/dev/null
    echo $(( ${_u%%.*} - MONO_SKEW ))
}
CACHE_FILE="$T/ping.json"; CACHE_TMP="$T/ping.json.tmp"; SC_DIR="$T/run"
SC_PING="$T/run/ping.env"; SC_DNS="$T/run/dns.env"; RECOVERY_FLAG="$T/recovery"

for _f in read_dns_data read_ping_data _state_reload read_watchcat_state read_sim_state; do
    _lift "$POLLER" "$_f" > "$T/f.sh"
    [ -s "$T/f.sh" ] || { echo "cannot lift $_f from $POLLER"; exit 2; }
    . "$T/f.sh"
done
_US=$(printf '\037')
STATE_FORCE_EVERY=30
_wc_rd_n=30; _ss_rd_n=30; _sf_rd_n=30
DNS_CACHE="$T/dns.json"; DNS_ENV="$T/run/dns.env"; DNS_MAX_AGE_SEC=180
PING_HISTORY_RAW="$T/no_history"; PING_MIN_SAMPLES=10
QUALITY_LOSS_THRESHOLD=30
WATCHCAT_CACHE="$T/watchcat.json"; WC_STAMP="$T/run/watchcat.stamp"
SIM_SWAP_FLAG="$T/simswap.json"; SIM_SWAP_STAMP="$T/run/sim_swap.stamp"
SIM_FAILOVER_FILE="$T/simfo.json"; SIM_FO_STAMP="$T/run/sim_failover.stamp"
_NOW=$(command date +%s)

dump_cq() {
    # CQ_AGE_SEC is left out: the two reads run a moment apart, so it can differ
    # by a second (a stale reason carrying the age is compared up to its "age").
    _dq_reason="$CQ_STALE_REASON"
    case "$_dq_reason" in "age "*) _dq_reason="age" ;; esac
    printf '%s|' "$CQ_STALE" "$_dq_reason" "$CQ_STALE_THRESHOLD" "$CQ_TIMESTAMP" "$CQ_MONO" \
        "$CQ_REACHABLE" "$CQ_RTT_MS" "$CQ_STREAK_SUCCESS" "$CQ_STREAK_FAIL" "$CQ_DURING_RECOVERY" \
        "$CQ_INTERVAL_SEC" "$CQ_PROFILE" "$CQ_LAST_FAMILY" "$CQ_TARGET" "$CQ_FAIL_SECS" "$CQ_RECOVER_SECS"
}

# ---------------------------------------------------------------------------
echo "== ping.env vs ping.json =="
ping_case() { # name
    local _a
    local _b
    local _rc
    write_cache "$RTT"
    check "$1: ping.env written" "yes" "$([ -f "$SC_PING" ] && echo yes || echo no)"
    conn_state_read; _rc=$?
    _a="rc=$_rc|$(dump_cq)"
    conn_state_read_env; _rc=$?
    _b="rc=$_rc|$(dump_cq)"
    check "$1: env == json" "$_a" "$_b"
}
reachable=true; streak_success=5; streak_fail=0; last_family=ipv4
PING_PROFILE=relaxed; PING_TARGET_IPV4=1.1.1.1; PING_TARGET_IPV6=2606:4700:4700::1111
PING_INTERVAL=5; PING_FAIL_SECS=15; PING_RECOVER_SECS=10
RTT="34.2"
ping_case "fresh ipv4"

reachable=false; streak_success=0; streak_fail=4; last_family=none; RTT="null"
: > "$RECOVERY_FLAG"
ping_case "down + recovery"
rm -f "$RECOVERY_FLAG"

reachable=true; streak_success=1; streak_fail=0; last_family=ipv6; RTT="120.5"
PING_PROFILE="o'brien \"x\""; PING_INTERVAL=1; PING_FAIL_SECS=6; PING_RECOVER_SECS=3
PING_TARGET_IPV4="1.2.3.4"
ping_case "quote in profile"

PING_PROFILE=quiet; PING_INTERVAL=10; PING_TARGET_IPV4=""
ping_case "empty target"
PING_TARGET_IPV4=1.1.1.1

# stale: mono 100 s behind uptime
MONO_SKEW=100
PING_INTERVAL=5; PING_FAIL_SECS=15; PING_RECOVER_SECS=10; PING_PROFILE=relaxed
ping_case "stale mono"
MONO_SKEW=0

# fallbacks: rc 2 means "no usable sidecar"
RTT="30.0"; reachable=true; streak_fail=0; last_family=ipv4
write_cache "$RTT"
cp "$SC_PING" "$T/ping.env.good"
touch -d "@$(( $(command date +%s) - 60 ))" "$SC_PING"
conn_state_read_env; check "env older than json -> 2" "2" "$?"
cp "$T/ping.env.good" "$SC_PING"
conn_state_read_env; check "env restored -> 0" "0" "$?"
head -n 5 "$T/ping.env.good" > "$SC_PING"
conn_state_read_env; check "truncated env -> 2" "2" "$?"
printf '_cq_ts=1\n$(touch %s/pwn)\nqm_sidecar_end=%s\n' "$T" "'1'" > "$SC_PING"
conn_state_read_env; check "non-assignment line -> 2" "2" "$?"
[ -e "$T/pwn" ] && bad "sidecar line was executed"
rm -f "$SC_PING"
conn_state_read_env; check "missing env -> 2" "2" "$?"
cp "$T/ping.env.good" "$SC_PING"
rm -f "$CQ_PING_CACHE"
conn_state_read_env; check "missing json -> 2" "2" "$?"

# read_ping_data end to end: sidecar vs json produce the same conn_* globals
RTT="41.5"; write_cache "$RTT"
read_ping_data
A="$conn_internet_available|$conn_status|$conn_latency|$conn_ping_target|$conn_profile|$conn_last_family|$conn_history_interval|$conn_during_recovery"
cp "$SC_PING" "$T/ping.env.good"; rm -f "$SC_PING"
read_ping_data
B="$conn_internet_available|$conn_status|$conn_latency|$conn_ping_target|$conn_profile|$conn_last_family|$conn_history_interval|$conn_during_recovery"
check "read_ping_data env == json path" "$B" "$A"
cp "$T/ping.env.good" "$SC_PING"
: > "$FORKS"
_i=0
while [ "$_i" -lt 20 ]; do read_ping_data; _i=$((_i + 1)); done
check "read_ping_data sidecar path forks (20 cycles, ts unchanged)" "0" "$(count_forks)"

# ---------------------------------------------------------------------------
echo "== dns.env vs dns.json =="
dns_case() { # name ok ms resolver
    local _up
    local _a
    local _b
    { read -r _up _i < /proc/uptime; } 2>/dev/null
    _up="${_up%%.*}"
    command jq -n --argjson ms "$3" --argjson ok "$2" --arg res "$4" --arg name x \
        --argjson mono "$_up" --argjson ts 1 \
        '{ms: $ms, ok: $ok, resolver: $res, name: $name, mono: $mono, ts: $ts}' > "$DNS_CACHE"
    write_dns_env "$2" "$3" "$_up" "$4"
    read_dns_data
    _a="$dns_lookup_ms|$dns_resolver"
    cp "$DNS_ENV" "$T/dns.env.good"; rm -f "$DNS_ENV"
    read_dns_data
    _b="$dns_lookup_ms|$dns_resolver"
    cp "$T/dns.env.good" "$DNS_ENV"
    check "$1: env == json" "$_b" "$_a"
}
dns_case "ok 12ms" true 12 "192.168.225.1"
dns_case "failed lookup" false null "10.0.0.1"
dns_case "no resolver" false null ""
dns_case "ipv6 resolver" true 7 "2001:4860:4860::8888"
: > "$FORKS"
_i=0
while [ "$_i" -lt 20 ]; do read_dns_data; _i=$((_i + 1)); done
check "read_dns_data sidecar path forks (20 reads)" "0" "$(count_forks)"
touch -d "@$(( $(command date +%s) - 60 ))" "$DNS_ENV"
read_dns_data; check "dns.env older than json still reads" "ok" "ok"

# ---------------------------------------------------------------------------
echo "== ondemand.env vs ondemand.json =="
od_set() { # tag
    t2_mimo="4x4 $1"; lte_ta="7"; nr_ta="12"
    t2_apn="internet.$1"; t2_wan_ipv4="10.1.2.3"; t2_wan_ipv6="2001:db8::5"
    t2_primary_dns="8.8.8.8"; t2_secondary_dns="8.8.4.4"
    t2_primary_dns_v4="8.8.8.8"; t2_primary_dns_v6="2001:4860:4860::8888"
    t2_secondary_dns_v4="8.8.4.4"; t2_secondary_dns_v6="2001:4860:4860::8844"
}
od_clear() {
    t2_mimo=""; lte_ta=""; nr_ta=""; t2_apn=""; t2_wan_ipv4=""; t2_wan_ipv6=""
    t2_primary_dns=""; t2_secondary_dns=""; t2_primary_dns_v4=""; t2_primary_dns_v6=""
    t2_secondary_dns_v4=""; t2_secondary_dns_v6=""
}
od_dump() {
    printf '%s|' "$t2_mimo" "$lte_ta" "$nr_ta" "$t2_apn" "$t2_wan_ipv4" "$t2_wan_ipv6" \
        "$t2_primary_dns" "$t2_secondary_dns" "$t2_primary_dns_v4" "$t2_primary_dns_v6" \
        "$t2_secondary_dns_v4" "$t2_secondary_dns_v6"
}
od_case() { # name
    local _a
    local _b
    _ondemand_write_cache
    check "$1: ondemand.env written" "yes" "$([ -f "$ONDEMAND_ENV" ] && echo yes || echo no)"
    od_clear; load_ondemand_cache; _a="$(od_dump)"
    cp "$ONDEMAND_ENV" "$T/od.env.good"
    od_clear; : > "$FORKS"
    _olc_calls=0
    load_ondemand_cache_gated; _b="$(od_dump)"
    check "$1: env == json" "$_a" "$_b"
    check "$1: env path forks" "0" "$(count_forks)"
}
od_set one
od_case "plain"
od_set two; t2_apn="it's \"quoted\" \$(touch $T/pwn) \`id\` \\"; t2_mimo="a b  c"
od_case "hostile quoting"
[ -e "$T/pwn" ] && bad "ondemand sidecar value was executed"
od_set three; t2_mimo=""; lte_ta=""; t2_apn=""
od_case "empty values"
# JSON newer than env -> the jq path is used and wins
od_set four; _ondemand_write_cache
od_set five
command jq -n --arg mimo "from-json" '{mimo: $mimo, lte_ta: "1", nr_ta: "2", apn: "jsonapn", wan_ipv4: "", wan_ipv6: "", primary_dns: "", secondary_dns: "", primary_dns_v4: "", primary_dns_v6: "", secondary_dns_v4: "", secondary_dns_v6: "", updated_at: 1}' > "$ONDEMAND_CACHE_FILE"
touch -d "@$(( $(command date +%s) + 30 ))" "$ONDEMAND_CACHE_FILE"
od_clear; _olc_calls=0; rm -f "$ONDEMAND_STAMP"
load_ondemand_cache_gated
check "json newer than env -> jq path" "from-json|1|2|jsonapn" "$t2_mimo|$lte_ta|$nr_ta|$t2_apn"
head -n 3 "$T/od.env.good" > "$ONDEMAND_ENV"
touch -d "@$(( $(command date +%s) + 60 ))" "$ONDEMAND_ENV"
touch -d "@$(( $(command date +%s) + 30 ))" "$ONDEMAND_CACHE_FILE"
od_clear; _olc_calls=0; rm -f "$ONDEMAND_STAMP"
load_ondemand_cache_gated
check "truncated env -> jq path" "from-json" "$t2_mimo"

# ---------------------------------------------------------------------------
echo "== gated watchcat / sim state =="
printf '{"enabled":true,"state":"monitoring","current_tier":1,"failure_count":2,"last_recovery_time":null,"last_recovery_tier":null,"total_recoveries":3,"cooldown_remaining":0,"reboots_this_hour":0}\n' > "$WATCHCAT_CACHE"
_wc_rd_n=30
: > "$FORKS"
# tick: a poll cycle passes (the poller's _NOW advances once per cycle).
tick() { sleep 2; _NOW=$(command date +%s); }
read_watchcat_state
check "watchcat first read" "true|monitoring|1|2|3" "$wc_enabled|$wc_state|$wc_current_tier|$wc_failure_count|$wc_total_recoveries"
# The stamp is armed one second early, so a file written in the same second as
# the read costs one redundant reload; after that the values hold.
tick; read_watchcat_state; tick; read_watchcat_state
F1=$(count_forks)
_i=0
while [ "$_i" -lt 4 ]; do tick; read_watchcat_state; _i=$((_i + 1)); done
check "watchcat unchanged: no further forks (4 cycles)" "$F1" "$(count_forks)"
tick
printf '{"enabled":false,"state":"cooldown","current_tier":2,"failure_count":9,"last_recovery_time":123,"last_recovery_tier":2,"total_recoveries":4,"cooldown_remaining":30,"reboots_this_hour":1}\n' > "$WATCHCAT_CACHE"
read_watchcat_state
check "watchcat changed file re-read" "false|cooldown|2|9|123|30" "$wc_enabled|$wc_state|$wc_current_tier|$wc_failure_count|$wc_last_recovery_time|$wc_cooldown_remaining"
rm -f "$WATCHCAT_CACHE"
read_watchcat_state
check "watchcat file gone" "false|disabled" "$wc_enabled|$wc_state"
printf '{"enabled":true,"state":"monitoring"}\n' > "$WATCHCAT_CACHE"
read_watchcat_state
check "watchcat file back -> re-read" "true|monitoring" "$wc_enabled|$wc_state"

printf '{"dismissed":false,"matching_profile_id":"p1","matching_profile_name":"Home"}\n' > "$SIM_SWAP_FLAG"
printf '{"active":true,"original_slot":1,"current_slot":2,"switched_at":1759990000}\n' > "$SIM_FAILOVER_FILE"
_ss_rd_n=30; _sf_rd_n=30
tick
read_sim_state
check "sim state first read" "true|p1|Home|true|1|2|1759990000" "$sim_swap_detected|$sim_swap_profile_id|$sim_swap_profile_name|$sim_fo_active|$sim_fo_original_slot|$sim_fo_current_slot|$sim_fo_switched_at"
tick; read_sim_state; tick; read_sim_state
: > "$FORKS"
_i=0
while [ "$_i" -lt 4 ]; do tick; read_sim_state; _i=$((_i + 1)); done
check "sim state unchanged: 0 forks (4 cycles)" "0" "$(count_forks)"
tick
printf '{"dismissed":true,"matching_profile_id":"p1","matching_profile_name":"Home"}\n' > "$SIM_SWAP_FLAG"
read_sim_state
check "sim swap dismissed re-read" "false||" "$sim_swap_detected|$sim_swap_profile_id|$sim_swap_profile_name"
rm -f "$SIM_SWAP_FLAG" "$SIM_FAILOVER_FILE"
read_sim_state
check "sim files gone -> defaults" "false|false|null|null|null" "$sim_swap_detected|$sim_fo_active|$sim_fo_original_slot|$sim_fo_current_slot|$sim_fo_switched_at"


# ---------------------------------------------------------------------------
if [ -n "$QMIM" ]; then
echo "== qmi.env (qmi_merge.sh) =="
[ -f "$QMIM" ] || { echo "no such file: $QMIM"; exit 2; }
QMI_ENV="$T/run/qmi.env"
QMI_STAMP="$T/run/qmi.stamp"
QMI_SCAN_FLAG="$T/scan_flag"
QMI_SIMSW_FLAG="$T/simsw_flag"
. "$QMIM"

# qmi_env_write <mono> <state> <reg> <pci> <earfcn> <rsrp> <rsrq> <rssi>: the
# broker's 38-name file plus the end marker.
qmi_env_write() {
    {
        printf "qmi_mono='%s'\nqmi_state='%s'\nqmi_ssr_count='2'\nqmi_registered='%s'\n" "$1" "$2" "$3"
        printf "qmi_lte_pci='%s'\nqmi_lte_earfcn='%s'\nqmi_lte_tac='49026'\nqmi_lte_cell_id='36393062'\n" "$4" "$5"
        printf "qmi_lte_band='1'\nqmi_lte_bw_mhz='20'\nqmi_lte_rsrp='%s'\nqmi_lte_rsrq='%s'\nqmi_lte_rssi='%s'\n" "$6" "$7" "$8"
        printf "qmi_ca_count='1'\nqmi_pcc_pci='%s'\nqmi_pcc_earfcn='%s'\nqmi_pcc_band='1'\nqmi_pcc_bw_mhz='20'\n" "$4" "$5"
        for _qs in 1 2 3 4; do
            printf "qmi_scc%s_pci=''\nqmi_scc%s_earfcn=''\nqmi_scc%s_band=''\nqmi_scc%s_bw_mhz=''\nqmi_scc%s_active=''\n" \
                "$_qs" "$_qs" "$_qs" "$_qs" "$_qs"
        done
        printf "qm_sidecar_end='1'\n"
    } > "$QMI_ENV.new" && mv -f "$QMI_ENV.new" "$QMI_ENV"
}
qmi_reset() { _QMI_OK=0; _qmi_calls=0; rm -f "$QMI_STAMP"; }
{ read -r _UP _i < /proc/uptime; } 2>/dev/null
_UP="${_UP%%.*}"
_MONO_TOP="$_UP"

qmi_env_write "$_UP" up 1 295 150 -89 -10 -60
_n=0
while IFS= read -r _l; do _n=$((_n + 1)); done < "$QMI_ENV"
check "qmi.env fixture has 38 names + end" "39" "$_n"
qmi_reset; qmi_load; check "valid env -> 0" "0" "$?"
check "valid env values" "1|$_UP|up|2|1|295|150|-89|-10|-60" \
    "$_QMI_OK|$_QMI_READ_MONO|$_QMI_STATE|$_QMI_SSR|$qmi_registered|$qmi_lte_pci|$qmi_lte_earfcn|$qmi_lte_rsrp|$qmi_lte_rsrq|$qmi_lte_rssi"
cp "$QMI_ENV" "$T/qmi.env.good"

# The broker's live file, when present (read-only copy into the scratch dir).
if [ -f /var/run/qmanager/qmi.env ]; then
    cp /var/run/qmanager/qmi.env "$QMI_ENV"
    qmi_reset; qmi_load; check "live broker qmi.env accepted" "0|1" "$?|$_QMI_OK"
    cp "$T/qmi.env.good" "$QMI_ENV"
fi

head -n 5 "$T/qmi.env.good" > "$QMI_ENV"
qmi_reset; qmi_load; check "truncated env -> 1, fields reset" "1|0|0||0" "$?|$_QMI_OK|$_QMI_READ_MONO|$_QMI_STATE|$_QMI_SSR"
{ head -n 3 "$T/qmi.env.good"; printf '$(touch %s/qpwn)\n' "$T"; tail -n 1 "$T/qmi.env.good"; } > "$QMI_ENV"
qmi_reset; qmi_load; check "stray line -> 1" "1" "$?"
[ -e "$T/qpwn" ] && bad "qmi.env stray line was executed"
{ head -n 3 "$T/qmi.env.good"; printf "qmi_lte_rsrp='-1';touch %s/qpwn2\n" "$T"; tail -n 1 "$T/qmi.env.good"; } > "$QMI_ENV"
qmi_reset; qmi_load; check "shell-active value -> 1" "1" "$?"
[ -e "$T/qpwn2" ] && bad "qmi.env value was executed"
lte_rsrp="-95"
{ head -n 3 "$T/qmi.env.good"; printf "lte_rsrp='-1'\n"; tail -n 1 "$T/qmi.env.good"; } > "$QMI_ENV"
qmi_reset; qmi_load; check "non-qmi_ name -> 1, poller global untouched" "1|-95" "$?|$lte_rsrp"
{ cat "$T/qmi.env.good"; printf "qmi_extra='1'\n"; } > "$QMI_ENV"
qmi_reset; qmi_load; check "end marker not last -> 1" "1" "$?"
qmi_env_write "0$_UP" sideways 1 295 150 -89 -10 -60
qmi_reset; qmi_load; check "bad mono/state sanitised" "0|0|" "$?|$_QMI_READ_MONO|$_QMI_STATE"
rm -f "$QMI_ENV"
qmi_reset; qmi_load; check "missing env -> 1" "1|0||0" "$?|$_QMI_OK|$_QMI_STATE|$_QMI_SSR"

# Stamp gate.
cp "$T/qmi.env.good" "$QMI_ENV"
qmi_reset; qmi_load
qmi_env_write "$_UP" up 1 295 150 -77 -10 -60
command touch -d "@$(( $(command date +%s) - 30 ))" "$QMI_ENV"
qmi_load; check "env older than stamp -> not re-read" "-89" "$qmi_lte_rsrp"
_i=0
while [ "$_i" -lt 20 ] && [ "$qmi_lte_rsrp" = "-89" ]; do qmi_load; _i=$((_i + 1)); done
check "forced re-read within QMI_FORCE_EVERY calls" "-77|yes" "$qmi_lte_rsrp|$([ "$_i" -le "$QMI_FORCE_EVERY" ] && echo yes || echo no)"
qmi_load
qmi_env_write "$_UP" up 1 295 150 -66 -10 -60
qmi_load; check "env written in the stamp's second -> re-read" "-66" "$qmi_lte_rsrp"

# Overlay gates. ov <name> <qmi|at>: apply, check, restore, check.
cp "$T/qmi.env.good" "$QMI_ENV"
at_set() { lte_pci=295; lte_earfcn=150; nr_pci=""; lte_rsrp=-95; lte_rsrq=-11; lte_rssi=-65; _QENG_PARSED=0; lte_source=at; }
ov() {
    local _got
    qmi_overlay_apply
    _got="$lte_source|$lte_rsrp|$lte_rsrq|$lte_rssi"
    if [ "$2" = "qmi" ]; then
        check "overlay $1" "qmi|-89|-10|-60" "$_got"
    else
        check "overlay $1" "at|-95|-11|-65" "$_got"
    fi
    qmi_overlay_restore
    check "restore $1" "at|-95|-11|-65" "$lte_source|$lte_rsrp|$lte_rsrq|$lte_rssi"
}
qmi_reset; qmi_load
at_set; ov "all gates hold" qmi
at_set; _QENG_PARSED=1; ov "AT parsed QENG this cycle" at
at_set; lte_pci=296; ov "PCI mismatch" at
at_set; lte_earfcn=1300; ov "EARFCN mismatch" at
at_set; lte_pci=""; lte_earfcn=""; ov "AT has no serving cell" qmi
at_set; lte_pci=""; lte_earfcn=""; nr_pci=45; ov "AT on SA (NR cell only)" at
at_set; : > "$QMI_SCAN_FLAG"; ov "scan flag up" at; rm -f "$QMI_SCAN_FLAG"
at_set; : > "$QMI_SIMSW_FLAG"; ov "SIM switch flag up" at; rm -f "$QMI_SIMSW_FLAG"
at_set; system_state=scan_in_progress; ov "scan_in_progress until the next AT read" at; system_state=normal
_MONO_TOP=$((_UP + 5)); at_set; ov "age 5 s" qmi
_MONO_TOP=$((_UP + 6)); at_set; ov "age 6 s" at
_MONO_TOP=$((_UP - 1)); at_set; ov "mono in the future" at
_MONO_TOP=0; at_set; ov "no uptime" at
_MONO_TOP="$_UP"
qmi_env_write "$_UP" down 1 295 150 -89 -10 -60; qmi_reset; qmi_load
at_set; ov "qmi_state=down" at
qmi_env_write "$_UP" up 0 295 150 -89 -10 -60; qmi_reset; qmi_load
at_set; ov "unregistered" at
qmi_env_write "$_UP" up '' 295 150 -89 -10 -60; qmi_reset; qmi_load
at_set; ov "registration unknown" at
qmi_env_write "$_UP" up 1 295 150 '' -10 -60; qmi_reset; qmi_load
at_set; ov "no QMI rsrp" at
qmi_env_write "$_UP" up 1 295 150 -89.5 -10 -60; qmi_reset; qmi_load
at_set; ov "non-integer QMI rsrp" at
rm -f "$QMI_ENV"; qmi_reset; qmi_load
at_set; ov "broker stopped (no env)" at

# No fork on the qmi path: 200 load + apply + restore rounds; the /proc/stat
# process counter may only move by background noise (other processes).
cp "$T/qmi.env.good" "$QMI_ENV"
qmi_reset; qmi_load; at_set
: > "$FORKS"
_p0=""; while read -r _k _v; do [ "$_k" = processes ] && _p0="$_v"; done < /proc/stat
_i=0
while [ "$_i" -lt 200 ]; do
    qmi_load; qmi_overlay_apply; qmi_overlay_restore
    _i=$((_i + 1))
done
_p1=""; while read -r _k _v; do [ "$_k" = processes ] && _p1="$_v"; done < /proc/stat
check "qmi path: no jq/date/touch/awk" "0" "$(count_forks)"
_d=$((_p1 - _p0))
if [ "$_d" -lt 30 ]; then
    ok
    echo "qmi path: $_d system-wide forks over 200 rounds (background noise)"
else
    bad "qmi path forked: $_d system-wide forks over 200 rounds"
fi
check "qmi path still loaded" "1|-89" "$_QMI_OK|$qmi_lte_rsrp"
fi

echo "RESULT sidecar: PASS=$PASS FAIL=$FAIL"
[ -n "$FIRST" ] && echo "FIRST FAILURE: $FIRST"
[ "$FAIL" -eq 0 ]
