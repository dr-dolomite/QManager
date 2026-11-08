#!/bin/sh
# =============================================================================
# qm_platform_cqwd.sh - Connection Quality x Watchdog platform adapter (RM551E)
# =============================================================================
# The only intended difference between the RM551E and RM520N copies of the
# connection-quality and watchdog code (spec docs/plans/
# 2026-11-07-cq-watchdog-unified-architecture.md section 7). The neutral files
# (qmanager_ping, qmanager_watchcat, conn_state.sh, wd_*.sh) reach the config
# store, init system, kernel log, reboot and every platform path through this
# file only.
#
# Sourced (never executed), guarded: [ -f FILE ] && . FILE. Function
# definitions and initialisers only; idempotent (QM_PLATFORM_CQWD_LOADED).
# BusyBox ash / POSIX sh, no jq regex.
#
# RM551E bindings:
#   config store   UCI package quecmanager (/etc/config/quecmanager)
#   services       /etc/init.d/<svc> (procd)
#   SSR            dmesg "4080000.remoteproc-mss: fatal error received"
# =============================================================================

[ -n "${QM_PLATFORM_CQWD_LOADED:-}" ] && return 0

# --- Config store ------------------------------------------------------------
# Logical (section, key) -> UCI section in _pf_sec. rc 1 = unknown pair.
# Old and new key names both route (the migration leaves old keys in place).
_pf_route() {
    case "$2" in ''|*[!A-Za-z0-9_]*) return 1 ;; esac
    case "$1" in
        watchdog) _pf_sec=watchcat ;;
        connection_quality)
            case "$2" in
                sensitivity|targets|profile|target_ipv4|target_ipv6|interval_override)
                    _pf_sec=ping_profile ;;
                latency_preset|latency_custom_ms|loss_preset|loss_custom_pct|alert_after_min)
                    _pf_sec=quality_thresholds ;;
                *) return 1 ;;
            esac
            ;;
        *) return 1 ;;
    esac
    return 0
}

# cfg_get <sec> <key>: prints the value. rc 0 value, 1 absent, 2 store
# unavailable (no uci, or no /etc/config/quecmanager). The read is tried first
# and the file test only decides between 1 and 2 on a miss, so a store that
# answers is never reported unavailable.
cfg_get() {
    _pf_route "$1" "$2" || return 1
    command -v uci >/dev/null 2>&1 || return 2
    uci -q get "quecmanager.$_pf_sec.$2" 2>/dev/null && return 0
    [ -f /etc/config/quecmanager ] || return 2
    return 1
}

# cfg_get_list <sec> <key>: one item per line. `uci get` joins list items with
# spaces (ambiguous for an item holding a space), so this parses `uci show`,
# whose values are shell-quoted ('a' 'b c', an embedded quote as '\'').
cfg_get_list() {
    _pf_route "$1" "$2" || return 1
    command -v uci >/dev/null 2>&1 || return 2
    _pf_show=$(uci -q show "quecmanager.$_pf_sec.$2" 2>/dev/null)
    if [ -z "$_pf_show" ]; then
        [ -f /etc/config/quecmanager ] || return 2
        return 1
    fi
    printf '%s\n' "${_pf_show#*=}" | awk '
        {
            s = $0; item = ""; have = 0; q = 0
            for (i = 1; i <= length(s); i++) {
                c = substr(s, i, 1)
                if (q) {
                    if (c == "\047") q = 0; else item = item c
                } else if (c == "\047") {
                    q = 1; have = 1
                } else if (c == "\\") {
                    i++; item = item substr(s, i, 1); have = 1
                } else if (c == " ") {
                    if (have) print item
                    item = ""; have = 0
                } else {
                    item = item c; have = 1
                }
            }
            if (have) print item
        }'
    return 0
}

# cfg_set <sec> <key> <val>: stage one value (argv: uci set quecmanager.<s>.<k>=<v>).
cfg_set() {
    _pf_route "$1" "$2" || return 1
    uci set "quecmanager.$_pf_sec.$2=$3"
}

# cfg_set_list <sec> <key> <item>...: stage a whole list (replaces it).
cfg_set_list() {
    _pf_route "$1" "$2" || return 1
    _pf_k="quecmanager.$_pf_sec.$2"
    shift 2
    uci -q delete "$_pf_k"
    for _pf_i in "$@"; do
        uci add_list "$_pf_k=$_pf_i" || return 1
    done
    return 0
}

# cfg_del <sec> <key>: stage a removal (absent is not an error).
cfg_del() {
    _pf_route "$1" "$2" || return 1
    uci -q delete "quecmanager.$_pf_sec.$2"
    return 0
}

cfg_commit() { uci commit quecmanager; }
cfg_revert() { uci -q revert quecmanager; }

# --- Services ----------------------------------------------------------------
# No redirects here: callers keep the redirects of the original call sites.
svc_enable() { "/etc/init.d/$1" enable; }
svc_disable() { "/etc/init.d/$1" disable; }
svc_start() { "/etc/init.d/$1" start; }
svc_stop() { "/etc/init.d/$1" stop; }
svc_running() { "/etc/init.d/$1" running >/dev/null 2>&1; }

# plat_flag_raise <path>: create a flag another process (maybe another uid) consumes.
plat_flag_raise() { touch "$1"; }

# --- Paths -------------------------------------------------------------------
plat_paths() {
    PF_PING_RELOAD="/tmp/qmanager_ping_reload"
    PF_QUALITY_RELOAD="/tmp/qmanager_quality_reload"
    PF_WD_RELOAD="/tmp/qmanager_watchcat_reload"
    PF_MAINT_LOCK="/tmp/qmanager_watchcat.lock"
    PF_PROFILE_APPLY_PID="/tmp/qmanager_profile_apply.pid"
    PF_RESTORE_PID="/var/run/qmanager_config_restore.pid"
    PF_SIM_SWITCH_FLAG="/tmp/qmanager_sim_switch_active"
    PF_LONG_RUNNING="/tmp/qmanager_long_running"
    PF_STATE_DIR="/etc/qmanager"
    PF_FAILOVER_RECORD="/etc/qmanager/sim_failover.json"
    PF_FAILOVER_MIRROR="/tmp/qmanager_sim_failover"
    PF_CRASH_LOG="/etc/qmanager/crash.log"
    PF_RUN_DIR="/var/run/qmanager"
    PF_DUAL_SIM_CACHE="/var/run/qmanager/dual_sim"
    PF_EVENTS_FILE="/tmp/qmanager_events.json"
    PF_TOWER_LOCK_CONFIG="/etc/qmanager/tower_lock.json"
    PF_FORCE_TIER2_FLAG="/tmp/qmanager_force_tier2"
    PF_REFRESH_POLICY_FLAG="/tmp/qmanager_refresh_policy_band"
    # Init service owning the ping daemon (procd instance "ping"). `start` on a
    # running procd service only starts instances that are not running; the
    # poller instance is left alone.
    PF_PING_SVC="qmanager"
    # Raised by the watchdog CGI (POST retry_failback), consumed by the daemon
    # on its next pass; honoured only when root-owned (qm_trusted_file).
    PF_FAILBACK_RETRY_FLAG="/tmp/qmanager_watchcat_retry_failback"
    # Carrier-count sources for plat_cc_count (contracts, Adapter addition
    # R11b): the broker's QMI sidecar (rewritten every 2 s) and the poller's
    # gated AT carrier sidecar (written only while carrier_enabled=1).
    PF_QMI_ENV="/var/run/qmanager/qmi.env"
    PF_CA_ENV="/var/run/qmanager/ca.env"
}

# --- Platform probes and actions ---------------------------------------------

# rc 0 while a trusted (root-owned) long-running AT operation flag is up.
plat_long_running() { qm_trusted_file "$PF_LONG_RUNNING"; }

# rc 0 while a trusted (root-owned) manual SIM-switch flag is up. The watchdog's
# own Tier 3 swap raises the same flag; the caller tells the two apart.
plat_manual_sim_switch() { qm_trusted_file "$PF_SIM_SWITCH_FLAG"; }

# rc 0 if an LTE or NR-SA tower lock is enabled (Tier 2 must be skipped).
plat_tower_locked() {
    [ ! -f "$PF_TOWER_LOCK_CONFIG" ] && return 1
    local lte_locked
    local nr_locked
    lte_locked=$(jq -r '(.lte.enabled) | if . == null then "false" else tostring end' \
        "$PF_TOWER_LOCK_CONFIG" 2>/dev/null)
    nr_locked=$(jq -r '(.nr_sa.enabled) | if . == null then "false" else tostring end' \
        "$PF_TOWER_LOCK_CONFIG" 2>/dev/null)
    if [ "$lte_locked" = "true" ] || [ "$nr_locked" = "true" ]; then
        return 0
    fi
    return 1
}

# plat_tower_failover pause|resume (the tower-failover init service stop|start)
plat_tower_failover() {
    case "$1" in
        pause)  /etc/init.d/qmanager_tower_failover stop 2>/dev/null ;;
        resume) /etc/init.d/qmanager_tower_failover start 2>/dev/null ;;
        *)      return 2 ;;
    esac
}

# plat_profile_apply <iccid> <reason>: SIM profile auto-apply, in a subshell so
# profile_mgr.sh's globals stay out of the caller.
plat_profile_apply() {
    ( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$1" "$2" )
}

# plat_ssr_poll: PLAT_SSR_MONO = integer seconds since boot of the newest MPSS
# fatal-error line in the kernel log, or empty (none, evicted, unparsable);
# PLAT_SSR_ID = the same value as the restart's identity. Real lines are
# double-bracketed "[ 12345.678901][ T8033] msg" (CONFIG_PRINTK_CALLER); the
# older single-bracket form also parses. sed, not awk -F: BusyBox awk 1.36.1
# rejects a bracket-class field separator ("Unknown collating element").
plat_ssr_poll() {
    local _ssr_line
    PLAT_SSR_MONO=""
    PLAT_SSR_ID=""
    _ssr_line=$(dmesg 2>/dev/null | grep "4080000.remoteproc-mss: fatal error received" | tail -n 1)
    [ -n "$_ssr_line" ] || return 0
    _ssr_line=$(printf '%s' "$_ssr_line" | sed 's/^\[[ ]*\([0-9]*\)\..*/\1/')
    case "$_ssr_line" in ''|*[!0-9]*) return 0 ;; esac
    PLAT_SSR_MONO="$_ssr_line"
    PLAT_SSR_ID="$_ssr_line"
    return 0
}

# rc 0 if the modem has two SIM slots. The boot-time AT+QUIMSLOT? answer is
# cached in PF_DUAL_SIM_CACHE ("0" = single slot); no cache = assume two.
plat_dual_sim() {
    local _ds
    [ -f "$PF_DUAL_SIM_CACHE" ] || return 0
    _ds=$(cat "$PF_DUAL_SIM_CACHE" 2>/dev/null)
    [ "$_ds" = "0" ] && return 1
    return 0
}

# plat_cc_count: PLAT_CC = component carriers in use (integer >= 1), or empty
# (unknown); PLAT_CC_RAT = sa (from ca.env) | lte (from qmi.env, LTE or the NSA
# anchor) | empty. Rule (Amendment 3 A3.3): a complete ca.env with ca_rat=sa
# (covers NR-DC) and ca_mono at most 90 s old wins (ca_nr_cc >= 1, else unknown:
# no fall-through to qmi.env); else a
# complete qmi.env with qmi_state=up, qmi_registered=1, qmi_ca_count >= 1 (PCC
# included) and qmi_mono at most 10 s old; else unknown. Both files are parsed
# line by line and never sourced (as data_used.sh does): a line outside
# [A-Za-z0-9_='-] or a missing end marker makes that file unknown. Builtins
# only; the clock is /proc/uptime (the writers' mono). Leading zeros and
# over-long numbers read as unknown.
_pf_cc_ok() {
    case "$1" in ''|*[!0-9]*|0?*|???*) return 1 ;; esac
    [ "$1" -ge 1 ]
}
_pf_mono_ok() {
    case "$1" in ''|*[!0-9]*|0?*|???????????*) return 1 ;; esac
    [ "$_pf_up" -ge "$1" ] && [ $((_pf_up - $1)) -le "$2" ]
}
plat_cc_count() {
    local _l
    local _bad
    local _last
    local _m
    local _a
    local _b
    local _c
    local _rest
    PLAT_CC=""
    PLAT_CC_RAT=""
    _pf_up=""
    { read -r _pf_up _rest < /proc/uptime; } 2>/dev/null
    _pf_up="${_pf_up%%.*}"
    case "$_pf_up" in ''|*[!0-9]*|0?*|???????????*) return 0 ;; esac

    if [ -f "$PF_CA_ENV" ]; then
        _bad=0
        _last=""
        _m=""
        _a=""
        _b=""
        {
            while IFS= read -r _l; do
                case "$_l" in
                    *[!A-Za-z0-9_=\'-]*) _bad=1; break ;;
                    ca_mono=\'*\') _m="${_l#ca_mono=\'}"; _m="${_m%\'}" ;;
                    ca_rat=\'*\') _a="${_l#ca_rat=\'}"; _a="${_a%\'}" ;;
                    ca_nr_cc=\'*\') _b="${_l#ca_nr_cc=\'}"; _b="${_b%\'}" ;;
                    ca_*=\'*\'|qm_sidecar_end=\'1\') ;;
                    *) _bad=1; break ;;
                esac
                _last="$_l"
            done < "$PF_CA_ENV"
        } 2>/dev/null
        if [ "$_bad" = "0" ] && [ "$_last" = "qm_sidecar_end='1'" ] && [ "$_a" = "sa" ] \
            && _pf_mono_ok "$_m" 90; then
            # A complete, fresh SA read is authoritative: a zero or invalid
            # count is unknown, never QMI's LTE count.
            if _pf_cc_ok "$_b"; then
                PLAT_CC="$_b"
                PLAT_CC_RAT="sa"
            fi
            return 0
        fi
    fi

    [ -f "$PF_QMI_ENV" ] || return 0
    _bad=0
    _last=""
    _m=""
    _a=""
    _b=""
    _c=""
    {
        while IFS= read -r _l; do
            case "$_l" in
                *[!A-Za-z0-9_=\'-]*) _bad=1; break ;;
                qmi_mono=\'*\') _m="${_l#qmi_mono=\'}"; _m="${_m%\'}" ;;
                qmi_state=\'*\') _a="${_l#qmi_state=\'}"; _a="${_a%\'}" ;;
                qmi_registered=\'*\') _b="${_l#qmi_registered=\'}"; _b="${_b%\'}" ;;
                qmi_ca_count=\'*\') _c="${_l#qmi_ca_count=\'}"; _c="${_c%\'}" ;;
                qmi_*=\'*\'|qm_sidecar_end=\'1\') ;;
                *) _bad=1; break ;;
            esac
            _last="$_l"
        done < "$PF_QMI_ENV"
    } 2>/dev/null
    [ "$_bad" = "0" ] || return 0
    [ "$_last" = "qm_sidecar_end='1'" ] || return 0
    [ "$_a" = "up" ] && [ "$_b" = "1" ] || return 0
    _pf_cc_ok "$_c" || return 0
    _pf_mono_ok "$_m" 10 || return 0
    PLAT_CC="$_c"
    PLAT_CC_RAT="lte"
    return 0
}

plat_reboot() { sync; reboot; }
plat_crash_log_prepare() { :; }

# plat_timeout <secs> <cmd...>: BusyBox `timeout SECS` (>= 1.30), `timeout -t
# SECS` (< 1.30), else the command runs unbounded. The mode is probed once per
# shell; a call inside $(...) probes again (cheap, and only on hostname / DNS
# paths).
_PF_TMO_MODE=""
plat_timeout() {
    local _pt_s
    if [ -z "$_PF_TMO_MODE" ]; then
        if ! command -v timeout >/dev/null 2>&1; then
            _PF_TMO_MODE=none
        elif timeout 1 true >/dev/null 2>&1; then
            _PF_TMO_MODE=new
        elif timeout -t 1 true >/dev/null 2>&1; then
            _PF_TMO_MODE=old
        else
            _PF_TMO_MODE=none
        fi
    fi
    _pt_s="$1"
    shift
    case "$_PF_TMO_MODE" in
        new) timeout "$_pt_s" "$@" ;;
        old) timeout -t "$_pt_s" "$@" ;;
        *) "$@" ;;
    esac
}

# --- The single alert wait (minutes), Alerts-owned, platform storage ---------
# An outage sends nothing on any channel unless it lasted this long.
CQ_SMS_CONFIG="${CQ_SMS_CONFIG:-/etc/qmanager/sms_alerts.json}"
CQ_EMAIL_CONFIG="${CQ_EMAIL_CONFIG:-/etc/qmanager/email_alerts.json}"
CQ_ALERT_AFTER_MIN=5

# _cq_wait_ok <value>: integer 1-1440.
_cq_wait_ok() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    [ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 1440 ] 2>/dev/null
}

# _cq_wait_from_json <file>: adopts the file's threshold_minutes when it is a valid number.
_cq_wait_from_json() {
    [ -f "$1" ] || return 1
    command -v jq >/dev/null 2>&1 || return 1
    _cq_w=$(jq -r '(try .threshold_minutes catch null) | if type == "number" then tostring else "" end' \
        "$1" 2>/dev/null </dev/null)
    _cq_wait_ok "$_cq_w" || return 1
    CQ_ALERT_AFTER_MIN="$_cq_w"
}

# cq_alert_after_min: resolves CQ_ALERT_AFTER_MIN. Order: connection_quality
# alert_after_min, else the SMS then email threshold_minutes (where the wait
# lived before it moved there), else 5.
cq_alert_after_min() {
    CQ_ALERT_AFTER_MIN=5
    _cq_w=$(cfg_get connection_quality alert_after_min)
    if _cq_wait_ok "$_cq_w"; then
        CQ_ALERT_AFTER_MIN="$_cq_w"
        return 0
    fi
    _cq_wait_from_json "$CQ_SMS_CONFIG" && return 0
    _cq_wait_from_json "$CQ_EMAIL_CONFIG" && return 0
    return 0
}

plat_paths
QM_PLATFORM_CQWD_LOADED=1
