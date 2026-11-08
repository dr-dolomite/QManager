#!/bin/sh
# run.sh - off-device tests for the Connection Quality x Watchdog settings
# migration (scripts/usr/lib/qmanager/cqwd_migrate.sh, called by install.sh
# seed_uci_defaults) and the Config Backup translate/apply
# (config_backup_sections.sh: cfg_backup_normalize, connection_quality,
# watchdog). Dev-only, never installed.
#
#   sh tools/cq-wd-migrate/run.sh        (jq on PATH; run under each BusyBox:
#                                         busybox sh tools/cq-wd-migrate/run.sh)
#
# A file-backed uci stub stands in for the real one: "key=value" per option or
# section, "key+=item" per list item. Like the real uci, get/delete of a missing
# entry and set on a missing section return 1, so the set -e install path is
# exercised for real. Exit 0 = every case passed.

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
LIB="$REPO/scripts/usr/lib/qmanager"
WORK=$(mktemp -d 2>/dev/null || echo "/tmp/cqwdm.$$")
mkdir -p "$WORK"
DB="$WORK/uci.db"
WARN_LOG="$WORK/warn.log"
PASS=0
FAIL=0
CASE=""

trap 'rm -rf "$WORK"' EXIT INT TERM

# --- uci stub ----------------------------------------------------------------
_u_del() { # key: drop key=, key+= and key.* lines; rc 1 when nothing matched
    _u_hit=1
    : > "$DB.new"
    while IFS= read -r _u_l; do
        case "$_u_l" in
            "$1="*|"$1+="*|"$1."*) _u_hit=0 ;;
            *) printf '%s\n' "$_u_l" >> "$DB.new" ;;
        esac
    done < "$DB"
    mv "$DB.new" "$DB"
    return "$_u_hit"
}

# _u_sec_ok key: a 3-part key (pkg.sec.opt) needs its pkg.sec line
_u_sec_ok() {
    _u_rest="${1#*.}"
    case "$_u_rest" in
        *.*) ;;
        *) return 0 ;;
    esac
    grep -q "^${1%.*}=" "$DB"
}

uci() {
    [ "$1" = "-q" ] && shift
    case "$1" in
        get)
            _u_out=""
            _u_any=1
            while IFS= read -r _u_l; do
                case "$_u_l" in
                    "$2="*) printf '%s\n' "${_u_l#*=}"; return 0 ;;
                    "$2+="*) _u_out="${_u_out:+$_u_out }${_u_l#*+=}"; _u_any=0 ;;
                esac
            done < "$DB"
            [ "$_u_any" = "0" ] || return 1
            printf '%s\n' "$_u_out"
            return 0
            ;;
        set)
            _u_sec_ok "${2%%=*}" || return 1
            _u_del "${2%%=*}" || true
            printf '%s\n' "$2" >> "$DB"
            ;;
        add_list)
            _u_sec_ok "${2%%=*}" || return 1
            printf '%s+=%s\n' "${2%%=*}" "${2#*=}" >> "$DB"
            ;;
        delete) _u_del "$2" ;;
        commit|revert) return 0 ;;
        *) return 1 ;;
    esac
}

# --- assertions --------------------------------------------------------------
ok() { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL [$CASE] $1"; }

eq() { # key expected
    _a_v=$(uci -q get "quecmanager.$1") || _a_v="<absent>"
    if [ "$_a_v" = "$2" ]; then ok; else bad "$1 = '$_a_v', want '$2'"; fi
}
absent() {
    if uci -q get "quecmanager.$1" >/dev/null 2>&1; then
        bad "$1 should be absent (is '$(uci -q get "quecmanager.$1")')"
    else
        ok
    fi
}
warned() { # substring
    if grep -q "$1" "$WARN_LOG" 2>/dev/null; then ok; else bad "no warning containing '$1'"; fi
}

# db <lines...>: start a case with this store
db() {
    CASE="$1"
    shift
    : > "$DB"
    : > "$WARN_LOG"
    for _d_l in "$@"; do printf '%s\n' "$_d_l" >> "$DB"; done
}

# migrate: run the install migration the way seed_uci_defaults does (set -e)
migrate() {
    # Not inside an if/&&/|| (that would switch set -e off): an abort shows as
    # a missing rc line.
    : > "$WORK/mig.rc"
    ( set -e; . "$LIB/cqwd_migrate.sh"; cqm_migrate_uci; echo "rc0 $CQM_CHANGED" > "$WORK/mig.rc" ) \
        >/dev/null 2>&1
    if grep -q '^rc0' "$WORK/mig.rc"; then ok; else bad "migration aborted under set -e"; fi
}

DEF_TARGETS="1.1.1.1 8.8.8.8 2606:4700:4700::1111 cloudflare.com"
OLD_WC="quecmanager.watchcat=watchcat
quecmanager.watchcat.enabled=0
quecmanager.watchcat.check_interval=10
quecmanager.watchcat.cooldown=60
quecmanager.watchcat.tier1_enabled=1
quecmanager.watchcat.tier2_enabled=1
quecmanager.watchcat.tier3_enabled=0
quecmanager.watchcat.tier4_enabled=1
quecmanager.watchcat.max_reboots_per_hour=3
quecmanager.watchcat.quality_enabled=0
quecmanager.watchcat.quality_consecutive=5
quecmanager.watchcat.ssr_aware=1
quecmanager.watchcat.ssr_grace=45
quecmanager.watchcat.primary_recheck_enabled=0
quecmanager.watchcat.primary_recheck_interval=30"

# old_store <profile> <fail_threshold> [extra lines...]: a real pre-upgrade store
old_store() {
    _o_case="$1"
    _o_prof="$2"
    _o_ft="$3"
    shift 3
    db "$_o_case" "quecmanager.ping_profile=ping_profile" \
        "quecmanager.ping_profile.profile=$_o_prof" \
        "quecmanager.ping_profile.target_ipv4=1.1.1.1" \
        "quecmanager.ping_profile.target_ipv6=2606:4700:4700::1111"
    printf '%s\n' "$OLD_WC" >> "$DB"
    [ -n "$_o_ft" ] && printf 'quecmanager.watchcat.fail_threshold=%s\n' "$_o_ft" >> "$DB"
    for _o_l in "$@"; do
        # a line "key=" without value removes that key first
        _u_del "${_o_l%%=*}" || true
        case "$_o_l" in *=) ;; *) printf '%s\n' "$_o_l" >> "$DB" ;; esac
    done
}

# ============================================================================
# Install migration
# ============================================================================

db fresh
migrate
eq ping_profile.sensitivity relaxed
eq ping_profile.targets "$DEF_TARGETS"
eq watchcat.enabled 0
eq watchcat.act_after_sec 30
eq watchcat.step_wait_sec 60
eq watchcat.tier1_enabled 1
eq watchcat.tier2_enabled 1
eq watchcat.tier3_enabled 0
eq watchcat.tier4_enabled 1
eq watchcat.max_reboots_per_hour 3
eq watchcat.quality_enabled 0
eq watchcat.quality_after_sec 120
eq watchcat.ssr_aware 1
eq watchcat.ssr_grace_sec 45
eq watchcat.failback_enabled 0
eq watchcat.failback_every_min 30
eq watchcat.carrier_enabled 0
eq watchcat.carrier_after_min 15
absent watchcat.backup_sim_slot
for k in ping_profile.profile ping_profile.target_ipv4 ping_profile.target_ipv6 \
         ping_profile.interval_override watchcat.fail_threshold watchcat.check_interval \
         watchcat.cooldown watchcat.quality_consecutive watchcat.ssr_grace \
         watchcat.primary_recheck_enabled watchcat.primary_recheck_interval; do
    absent "$k"
done
cp "$DB" "$WORK/run1"
migrate
if cmp -s "$DB" "$WORK/run1"; then ok; else bad "fresh rerun changed the store"; fi
if grep -q '^rc0 0' "$WORK/mig.rc"; then ok; else bad "fresh rerun reported a change"; fi

old_store "sensitive ft5" sensitive 5
migrate
eq ping_profile.sensitivity sensitive
eq ping_profile.targets "$DEF_TARGETS"
eq watchcat.act_after_sec 25
eq watchcat.quality_after_sec 50
eq watchcat.step_wait_sec 60
eq watchcat.ssr_grace_sec 45
eq watchcat.failback_enabled 0
eq watchcat.failback_every_min 30
eq watchcat.carrier_enabled 0
eq watchcat.carrier_after_min 15
# old keys left in place for a rollback
eq ping_profile.profile sensitive
eq ping_profile.target_ipv4 1.1.1.1
eq watchcat.fail_threshold 5
eq watchcat.check_interval 10
eq watchcat.cooldown 60
eq watchcat.quality_consecutive 5
cp "$DB" "$WORK/run1"
migrate
if cmp -s "$DB" "$WORK/run1"; then ok; else bad "upgrade rerun changed the store"; fi
if grep -q '^rc0 0' "$WORK/mig.rc"; then ok; else bad "upgrade rerun reported a change"; fi

old_store "quiet ft5" quiet 5
migrate
eq watchcat.act_after_sec 50
old_store "regular ft20" regular 20
migrate
eq watchcat.act_after_sec 100
old_store "relaxed ft200 clamps" relaxed 200
migrate
eq watchcat.act_after_sec 600
old_store "relaxed ft1 clamps" relaxed 1
migrate
eq watchcat.act_after_sec 15

old_store "interval_override 20" relaxed 5 "quecmanager.ping_profile.interval_override=20"
migrate
eq watchcat.act_after_sec 100
absent ping_profile.interval_override
eq ping_profile.sensitivity relaxed
old_store "interval_override 2 on quiet" quiet 5 "quecmanager.ping_profile.interval_override=2"
migrate
eq watchcat.act_after_sec 25
absent ping_profile.interval_override
eq ping_profile.sensitivity quiet
old_store "interval_override out of range" relaxed 5 "quecmanager.ping_profile.interval_override=99"
migrate
eq watchcat.act_after_sec 25
absent ping_profile.interval_override

old_store "google targets" relaxed 5 "quecmanager.ping_profile.target_ipv4=8.8.8.8" \
    "quecmanager.ping_profile.target_ipv6=2001:4860:4860::8888"
migrate
eq ping_profile.targets "8.8.8.8 1.1.1.1 2001:4860:4860::8888 cloudflare.com"
old_store "dns.google target" relaxed 5 "quecmanager.ping_profile.target_ipv4=dns.google"
migrate
eq ping_profile.targets "dns.google 1.1.1.1 2606:4700:4700::1111 cloudflare.com"
old_store "8.8.4.4 target" relaxed 5 "quecmanager.ping_profile.target_ipv4=8.8.4.4"
migrate
eq ping_profile.targets "8.8.4.4 1.1.1.1 2606:4700:4700::1111 cloudflare.com"
old_store "other target" relaxed 5 "quecmanager.ping_profile.target_ipv4=9.9.9.9"
migrate
eq ping_profile.targets "9.9.9.9 8.8.8.8 2606:4700:4700::1111 cloudflare.com"
old_store "custom v6 only" relaxed 5 "quecmanager.ping_profile.target_ipv4=" \
    "quecmanager.ping_profile.target_ipv6=2620:fe::fe"
migrate
eq ping_profile.targets "1.1.1.1 8.8.8.8 2620:fe::fe cloudflare.com"
old_store "invalid v4 reads as default" relaxed 5 "quecmanager.ping_profile.target_ipv4=-bad;rm"
migrate
eq ping_profile.targets "$DEF_TARGETS"

old_store "quality 5x10" relaxed 5
migrate
eq watchcat.quality_after_sec 50
old_store "quality ci absent" relaxed 5 "quecmanager.watchcat.check_interval=" \
    "quecmanager.watchcat.quality_consecutive=7"
migrate
eq watchcat.quality_after_sec 70
old_store "quality clamps low" relaxed 5 "quecmanager.watchcat.quality_consecutive=1"
migrate
eq watchcat.quality_after_sec 30
old_store "quality clamps high" relaxed 5 "quecmanager.watchcat.quality_consecutive=500"
migrate
eq watchcat.quality_after_sec 1800
old_store "quality ci zero" relaxed 5 "quecmanager.watchcat.check_interval=0"
migrate
eq watchcat.quality_after_sec 50

old_store "leading zeros" relaxed 08 "quecmanager.watchcat.cooldown=0090" \
    "quecmanager.watchcat.quality_consecutive=09" "quecmanager.watchcat.check_interval=010" \
    "quecmanager.watchcat.ssr_grace=030" "quecmanager.watchcat.primary_recheck_interval=0045"
migrate
eq watchcat.act_after_sec 40
eq watchcat.step_wait_sec 90
eq watchcat.quality_after_sec 90
eq watchcat.ssr_grace_sec 30
eq watchcat.failback_every_min 45
old_store "garbage" relaxed x "quecmanager.watchcat.cooldown=abc" \
    "quecmanager.watchcat.quality_consecutive=5x" "quecmanager.watchcat.ssr_grace=-3" \
    "quecmanager.watchcat.primary_recheck_interval=2" \
    "quecmanager.watchcat.primary_recheck_enabled=yes" \
    "quecmanager.ping_profile.profile=turbo"
migrate
eq watchcat.act_after_sec 30
eq watchcat.step_wait_sec 60
eq watchcat.quality_after_sec 120
eq watchcat.ssr_grace_sec 45
eq watchcat.failback_every_min 5
eq watchcat.failback_enabled 0
eq ping_profile.sensitivity relaxed
eq ping_profile.profile turbo
old_store "huge values" relaxed 99999999999999999999 \
    "quecmanager.watchcat.cooldown=99999999999999999999"
migrate
eq watchcat.act_after_sec 600
eq watchcat.step_wait_sec 300

old_store "max_failures only" relaxed "" "quecmanager.watchcat.max_failures=4"
migrate
eq watchcat.act_after_sec 20
old_store "failback renamed" relaxed 5 "quecmanager.watchcat.primary_recheck_enabled=1" \
    "quecmanager.watchcat.primary_recheck_interval=120" "quecmanager.watchcat.backup_sim_slot=2" \
    "quecmanager.watchcat.tier3_enabled=1" "quecmanager.watchcat.enabled=1"
migrate
eq watchcat.failback_enabled 1
eq watchcat.failback_every_min 120
eq watchcat.backup_sim_slot 2
eq watchcat.tier3_enabled 1
eq watchcat.enabled 1

old_store "new key exists, untouched" sensitive 5 "quecmanager.watchcat.act_after_sec=77" \
    "quecmanager.ping_profile.sensitivity=quiet" "quecmanager.ping_profile.targets+=9.9.9.9"
migrate
eq watchcat.act_after_sec 77
eq ping_profile.sensitivity quiet
eq ping_profile.targets 9.9.9.9

old_store "no sections at all" relaxed 5
_u_del quecmanager.watchcat || true
_u_del quecmanager.ping_profile || true
migrate
eq watchcat.act_after_sec 30
eq ping_profile.sensitivity relaxed

# ============================================================================
# Config Backup
# ============================================================================
. "$LIB/cqwd_migrate.sh"
. "$LIB/config_backup_sections.sh"
qlog_warn() { printf '%s\n' "$*" >> "$WARN_LOG"; }
qlog_error() { printf 'ERROR %s\n' "$*" >> "$WARN_LOG"; }
qlog_info() { :; }
touch() { :; }

# apply <section> <json>: rc in $AP_RC
apply() {
    printf '%s' "$2" | cfg_backup_apply "$1" >/dev/null 2>&1
    AP_RC=$?
}
section() { # payload key: the normalized section JSON
    printf '%s' "$1" | cfg_backup_normalize | jq -c --arg k "$2" '.sections[$k]'
}

CASE="known sections"
if cfg_backup_is_known_section connection_quality; then ok; else bad "connection_quality unknown"; fi
if cfg_backup_is_known_section quality_thresholds; then bad "quality_thresholds still known"; else ok; fi
case " $CFG_BACKUP_APPLY_ORDER " in
    *" connection_quality "*" watchdog "*) ok ;;
    *) bad "connection_quality not ahead of watchdog" ;;
esac

OLD_PAYLOAD='{"schema":1,"sections":{"quality_thresholds":{"latency_preset":"custom","loss_preset":"standard","latency_custom_ms":300,"loss_custom_pct":null,"alert_after_min":5},"watchdog":{"enabled":"1","fail_threshold":"5","check_interval":"10","cooldown":"90","tier1_enabled":"1","tier2_enabled":"1","tier3_enabled":"1","tier4_enabled":"0","backup_sim_slot":"","max_reboots_per_hour":"4","quality_enabled":"1","quality_consecutive":"6","ssr_aware":"0","ssr_grace":"30","primary_recheck_enabled":"1","primary_recheck_interval":"60"}}}'

db "normalize old payload"
N=$(printf '%s' "$OLD_PAYLOAD" | cfg_backup_normalize)
if printf '%s' "$N" | jq -e '.sections | has("quality_thresholds") | not' >/dev/null; then ok; else bad "quality_thresholds left in payload"; fi
if printf '%s' "$N" | jq -e '.sections.connection_quality.latency_custom_ms == 300' >/dev/null; then ok; else bad "thresholds not folded into connection_quality"; fi
if printf '%s' "$N" | jq -e '.sections.watchdog | has("_sensitivity") | not' >/dev/null; then ok; else bad "_sensitivity invented for an old backup"; fi

db "old backup restore" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.sensitivity=sensitive" \
    "quecmanager.watchcat=watchcat" "quecmanager.watchcat.backup_sim_slot=2" \
    "quecmanager.watchcat.carrier_enabled=1"
apply connection_quality "$(section "$OLD_PAYLOAD" connection_quality)"
[ "$AP_RC" = "0" ] && ok || bad "connection_quality rc $AP_RC"
eq quality_thresholds.latency_preset custom
eq quality_thresholds.loss_preset standard
eq quality_thresholds.latency_custom_ms 300
absent quality_thresholds.loss_custom_pct
eq quality_thresholds.alert_after_min 5
eq ping_profile.sensitivity sensitive
absent ping_profile.targets
apply watchdog "$(section "$OLD_PAYLOAD" watchdog)"
[ "$AP_RC" = "0" ] && ok || bad "watchdog rc $AP_RC"
eq watchcat.enabled 1
eq watchcat.act_after_sec 25
eq watchcat.step_wait_sec 90
eq watchcat.quality_after_sec 60
eq watchcat.ssr_grace_sec 30
eq watchcat.ssr_aware 0
eq watchcat.failback_enabled 1
eq watchcat.failback_every_min 60
eq watchcat.tier3_enabled 1
eq watchcat.tier4_enabled 0
eq watchcat.max_reboots_per_hour 4
absent watchcat.backup_sim_slot
eq watchcat.carrier_enabled 1
for k in fail_threshold check_interval cooldown quality_consecutive ssr_grace \
         primary_recheck_enabled primary_recheck_interval _sensitivity; do
    absent "watchcat.$k"
done

db "old backup, device has an override" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.profile=relaxed" "quecmanager.ping_profile.interval_override=12" \
    "quecmanager.watchcat=watchcat"
apply watchdog '{"fail_threshold":"5"}'
eq watchcat.act_after_sec 60

db "backup sensitivity wins" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.sensitivity=sensitive" "quecmanager.watchcat=watchcat"
P='{"schema":1,"sections":{"connection_quality":{"sensitivity":"quiet"},"watchdog":{"fail_threshold":"5"}}}'
apply watchdog "$(section "$P" watchdog)"
eq watchcat.act_after_sec 50

# new backup: collect device A, restore onto device B
db "new backup round trip" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.sensitivity=regular" \
    "quecmanager.ping_profile.targets+=9.9.9.9" "quecmanager.ping_profile.targets+=8.8.8.8" \
    "quecmanager.ping_profile.targets+=2620:fe::fe" "quecmanager.ping_profile.targets+=example.org" \
    "quecmanager.quality_thresholds=quality_thresholds" \
    "quecmanager.quality_thresholds.latency_preset=standard" \
    "quecmanager.quality_thresholds.loss_preset=custom" \
    "quecmanager.quality_thresholds.loss_custom_pct=12" \
    "quecmanager.quality_thresholds.alert_after_min=90" \
    "quecmanager.watchcat=watchcat" "quecmanager.watchcat.enabled=0" \
    "quecmanager.watchcat.act_after_sec=45" "quecmanager.watchcat.step_wait_sec=120" \
    "quecmanager.watchcat.tier1_enabled=1" "quecmanager.watchcat.tier2_enabled=0" \
    "quecmanager.watchcat.tier3_enabled=1" "quecmanager.watchcat.tier4_enabled=1" \
    "quecmanager.watchcat.backup_sim_slot=1" "quecmanager.watchcat.max_reboots_per_hour=2" \
    "quecmanager.watchcat.quality_enabled=1" "quecmanager.watchcat.quality_after_sec=300" \
    "quecmanager.watchcat.ssr_aware=1" "quecmanager.watchcat.ssr_grace_sec=60" \
    "quecmanager.watchcat.failback_enabled=1" "quecmanager.watchcat.failback_every_min=15" \
    "quecmanager.watchcat.carrier_enabled=1" "quecmanager.watchcat.carrier_after_min=30"
CQ=$(cfg_backup_collect connection_quality)
WD=$(cfg_backup_collect watchdog)
cp "$DB" "$WORK/deviceA"
get_a() { # key: the value on device A
    _g_db="$DB"
    DB="$WORK/deviceA"
    uci -q get "$1"
    DB="$_g_db"
}
P=$(jq -nc --argjson cq "$CQ" --argjson wd "$WD" '{schema:1,sections:{connection_quality:$cq,watchdog:$wd}}')
db "new backup round trip" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.sensitivity=relaxed" "quecmanager.watchcat=watchcat" \
    "quecmanager.watchcat.act_after_sec=30" "quecmanager.watchcat.fail_threshold=5"
apply connection_quality "$(section "$P" connection_quality)"
[ "$AP_RC" = "0" ] && ok || bad "connection_quality rc $AP_RC"
apply watchdog "$(section "$P" watchdog)"
[ "$AP_RC" = "0" ] && ok || bad "watchdog rc $AP_RC"
for k in ping_profile.sensitivity ping_profile.targets quality_thresholds.latency_preset \
         quality_thresholds.loss_preset quality_thresholds.loss_custom_pct \
         quality_thresholds.alert_after_min; do
    _want=$(get_a "quecmanager.$k")
    eq "$k" "$_want"
done
for k in $_WATCHCAT_KEYS; do
    _want=$(get_a "quecmanager.watchcat.$k")
    eq "watchcat.$k" "$_want"
done
absent quality_thresholds.latency_custom_ms
absent watchcat._sensitivity
eq watchcat.fail_threshold 5

db "new key wins over old" "quecmanager.watchcat=watchcat"
apply watchdog '{"act_after_sec":"45","fail_threshold":"5","step_wait_sec":"0040","cooldown":"200"}'
eq watchcat.act_after_sec 45
eq watchcat.step_wait_sec 40

db "backup_sim_slot empty clears" "quecmanager.watchcat=watchcat" "quecmanager.watchcat.backup_sim_slot=2"
apply watchdog '{"backup_sim_slot":""}'
absent watchcat.backup_sim_slot
db "backup_sim_slot null clears" "quecmanager.watchcat=watchcat" "quecmanager.watchcat.backup_sim_slot=2"
apply watchdog '{"backup_sim_slot":null}'
absent watchcat.backup_sim_slot
db "backup_sim_slot missing untouched" "quecmanager.watchcat=watchcat" "quecmanager.watchcat.backup_sim_slot=2"
apply watchdog '{"enabled":"0"}'
eq watchcat.backup_sim_slot 2
db "backup_sim_slot bad skipped" "quecmanager.watchcat=watchcat" "quecmanager.watchcat.backup_sim_slot=2"
apply watchdog '{"backup_sim_slot":"3"}'
eq watchcat.backup_sim_slot 2
warned backup_sim_slot

db "bad watchdog values skip the key" "quecmanager.watchcat=watchcat" \
    "quecmanager.watchcat.act_after_sec=30" "quecmanager.watchcat.enabled=0" \
    "quecmanager.watchcat.carrier_after_min=15"
apply watchdog '{"act_after_sec":"700","enabled":"maybe","carrier_after_min":"4","step_wait_sec":"60","ssr_grace":"zz"}'
[ "$AP_RC" = "0" ] && ok || bad "watchdog rc $AP_RC"
eq watchcat.act_after_sec 30
eq watchcat.enabled 0
eq watchcat.carrier_after_min 15
eq watchcat.step_wait_sec 60
absent watchcat.ssr_grace_sec
warned act_after_sec
warned "skipping enabled"
warned carrier_after_min

db "bad sensitivity/targets skip, thresholds apply" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.sensitivity=quiet" "quecmanager.ping_profile.targets+=1.1.1.1"
apply connection_quality '{"sensitivity":"turbo","targets":["1.1.1.1","-x","a","b"],"latency_preset":"tolerant","loss_preset":"tolerant"}'
[ "$AP_RC" = "0" ] && ok || bad "connection_quality rc $AP_RC"
eq ping_profile.sensitivity quiet
eq ping_profile.targets 1.1.1.1
eq quality_thresholds.latency_preset tolerant
warned "bad sensitivity"
warned "bad targets"
db "targets: 5 items, non-string, newline" "quecmanager.ping_profile=ping_profile" \
    "quecmanager.ping_profile.targets+=1.1.1.1"
apply connection_quality '{"targets":["a","b","c","d","e"]}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":["a",5]}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":["a\nb"]}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":"1.1.1.1"}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":["8.8.8.8","9.9.9.9"]}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":["8.8.8.8","9.9.9.9","a"]}'
eq ping_profile.targets 1.1.1.1
apply connection_quality '{"targets":["8.8.8.8","9.9.9.9","2620:fe::fe","example.org"]}'
eq ping_profile.targets "8.8.8.8 9.9.9.9 2620:fe::fe example.org"

db "old loss 0 -> 1" "quecmanager.ping_profile=ping_profile"
P='{"schema":1,"sections":{"quality_thresholds":{"latency_preset":"standard","loss_preset":"custom","loss_custom_pct":0}}}'
apply connection_quality "$(section "$P" connection_quality)"
[ "$AP_RC" = "0" ] && ok || bad "connection_quality rc $AP_RC"
eq quality_thresholds.loss_custom_pct 1

db "bad threshold fails the section (existing convention)" "quecmanager.ping_profile=ping_profile"
apply connection_quality '{"latency_preset":"custom","loss_preset":"tolerant","latency_custom_ms":0,"sensitivity":"quiet"}'
[ "$AP_RC" = "1" ] && ok || bad "rc $AP_RC, want 1"
absent ping_profile.sensitivity

db "alert_after_min 1-1440" "quecmanager.ping_profile=ping_profile"
apply connection_quality '{"alert_after_min":1440}'
eq quality_thresholds.alert_after_min 1440

db "normalize: connection_quality wins over quality_thresholds"
P='{"schema":1,"sections":{"quality_thresholds":{"latency_preset":"standard","alert_after_min":5},"connection_quality":{"latency_preset":"tolerant","sensitivity":"quiet"},"watchdog":{}}}'
N=$(printf '%s' "$P" | cfg_backup_normalize)
if printf '%s' "$N" | jq -e '.sections.connection_quality == {"latency_preset":"tolerant","alert_after_min":5,"sensitivity":"quiet"}' >/dev/null; then ok; else bad "merge wrong: $N"; fi
if printf '%s' "$N" | jq -e '.sections.watchdog._sensitivity == "quiet"' >/dev/null; then ok; else bad "_sensitivity not copied"; fi
N=$(printf '%s' '{"schema":1,"sections":{"bands":{"x":1}}}' | cfg_backup_normalize)
if printf '%s' "$N" | jq -e '.sections == {"bands":{"x":1}}' >/dev/null; then ok; else bad "unrelated payload changed: $N"; fi

echo "cq-wd-migrate: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
