#!/bin/sh
# =============================================================================
# cqwd_migrate.sh - Connection Quality x Watchdog settings migration (RM551E)
# =============================================================================
# Old -> new key conversion (spec docs/plans/
# 2026-11-07-cq-watchdog-unified-architecture.md section 3.3), shared by
# install.sh seed_uci_defaults (tarball, OTA and ipk --configure; all run after
# the lib dir is copied) and the Config Backup restore (config_backup_sections.sh),
# so the formulas cannot drift between the two.
#
# Not a neutral file: RM551E only (the RM520N has its own installer migration).
# Sourced (never executed), guarded: [ -f FILE ] && . FILE. BusyBox ash, no jq.
#
# Old facts (development-home):
#   probe interval per profile: sensitive 1, regular 2, relaxed 5, quiet 10 s
#     (conn_state.sh conn_state_resolve); interval_override 1-60 replaced the
#     cadence only, and fail_threshold counted failed PROBES at that cadence.
#   hidden second IPv4 target: 1.1.1.1 when target_ipv4 is 8.8.8.8, 8.8.4.4 or
#     dns.google, else 8.8.8.8 (qmanager_ping _set_alternates).
# =============================================================================

[ -n "${_CQWD_MIGRATE_LOADED:-}" ] && return 0
_CQWD_MIGRATE_LOADED=1

CQM_DEF_T1="1.1.1.1"
CQM_DEF_T2="8.8.8.8"
CQM_DEF_T3="2606:4700:4700::1111"
CQM_DEF_T4="cloudflare.com"

# _cqm_int <v>: CQM_INT = v as a plain decimal (leading zeros stripped, so "08"
# is 8 and never bad octal). Capped at 9999 so every product below stays far
# inside 32-bit arithmetic. rc 1 when v is empty or not all digits.
_cqm_int() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    CQM_INT="$1"
    while [ "${#CQM_INT}" -gt 1 ] && [ "${CQM_INT#0}" != "$CQM_INT" ]; do
        CQM_INT="${CQM_INT#0}"
    done
    [ "${#CQM_INT}" -gt 4 ] && CQM_INT=9999
    return 0
}

# _cqm_clamp <n> <lo> <hi>: CQM_VAL = n clamped (n already a plain decimal).
_cqm_clamp() {
    CQM_VAL="$1"
    [ "$CQM_VAL" -lt "$2" ] && CQM_VAL="$2"
    [ "$CQM_VAL" -gt "$3" ] && CQM_VAL="$3"
    return 0
}

# cqm_range <v> <lo> <hi>: CQM_VAL = v clamped. rc 1 when v is not a number.
cqm_range() {
    _cqm_int "$1" || return 1
    _cqm_clamp "$CQM_INT" "$2" "$3"
}

# cqm_in_range <v> <lo> <hi>: CQM_VAL = v normalised. rc 1 when v is not a
# number or lies outside lo-hi (restore validation: no silent clamp).
cqm_in_range() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    CQM_VAL="$1"
    while [ "${#CQM_VAL}" -gt 1 ] && [ "${CQM_VAL#0}" != "$CQM_VAL" ]; do
        CQM_VAL="${CQM_VAL#0}"
    done
    [ "${#CQM_VAL}" -gt 5 ] && return 1
    [ "$CQM_VAL" -ge "$2" ] && [ "$CQM_VAL" -le "$3" ]
}

# cqm_bool <v>: CQM_VAL = 0|1. Accepts 0, 1, false, true. rc 1 otherwise.
cqm_bool() {
    case "$1" in
        1|true) CQM_VAL=1 ;;
        0|false) CQM_VAL=0 ;;
        *) return 1 ;;
    esac
    return 0
}

cqm_sens_ok() {
    case "$1" in sensitive|regular|relaxed|quiet) return 0 ;; esac
    return 1
}

# Target rule (same as qmanager_ping _target_ok): IPv4/IPv6 literal or hostname,
# 1-128 chars of [0-9A-Za-z.:%-], no leading '-'.
cqm_target_ok() {
    case "$1" in ''|-*|*[!0-9A-Za-z.:%-]*) return 1 ;; esac
    [ "${#1}" -le 128 ]
}

# cqm_effective_interval <sensitivity> <interval_override>: CQM_IV = the probe
# interval the OLD daemon ran: a valid override (1-60), else the profile's own.
cqm_effective_interval() {
    case "$1" in
        sensitive) CQM_IV=1 ;;
        regular) CQM_IV=2 ;;
        quiet) CQM_IV=10 ;;
        *) CQM_IV=5 ;;
    esac
    if _cqm_int "$2" && [ "$CQM_INT" -ge 1 ] && [ "$CQM_INT" -le 60 ]; then
        CQM_IV="$CQM_INT"
    fi
    return 0
}

# cqm_act_after_sec <fail_threshold> <interval>:
# CQM_VAL = clamp(fail_threshold x max(interval, 5), 15, 600). rc 1 when
# fail_threshold is not a number (the caller seeds the default 30 or skips).
cqm_act_after_sec() {
    local _iv
    _cqm_int "$2" || return 1
    _iv="$CQM_INT"
    [ "$_iv" -lt 5 ] && _iv=5
    _cqm_int "$1" || return 1
    _cqm_clamp $(( CQM_INT * _iv )) 15 600
}

# cqm_quality_after_sec <quality_consecutive> <check_interval>:
# CQM_VAL = clamp(quality_consecutive x check_interval, 30, 1800); a missing,
# non-numeric or zero check_interval is the old default 10. rc 1 when
# quality_consecutive is not a number.
cqm_quality_after_sec() {
    local _ci
    _ci=10
    if _cqm_int "$2" && [ "$CQM_INT" -ge 1 ]; then
        _ci="$CQM_INT"
    fi
    _cqm_int "$1" || return 1
    _cqm_clamp $(( CQM_INT * _ci )) 30 1800
}

# cqm_targets_from_old <target_ipv4> <target_ipv6>: CQM_T1..CQM_T4 =
# [target_ipv4, hidden alt v4, target_ipv6, cloudflare.com]. A missing or
# invalid old target reads as its old default (what the old daemon ran), so
# two old defaults give exactly the new default list.
cqm_targets_from_old() {
    CQM_T1="$1"
    cqm_target_ok "$CQM_T1" || CQM_T1="$CQM_DEF_T1"
    CQM_T3="$2"
    cqm_target_ok "$CQM_T3" || CQM_T3="$CQM_DEF_T3"
    case "$CQM_T1" in
        8.8.8.8|8.8.4.4|dns.google) CQM_T2="1.1.1.1" ;;
        *) CQM_T2="8.8.8.8" ;;
    esac
    CQM_T4="$CQM_DEF_T4"
    return 0
}

# --- Install migration --------------------------------------------------------
_cqm_log() { "${CQM_LOG_FN:-:}" "$1"; }
# rc always 0: install.sh runs under set -e, where a failing $(...) in an
# assignment would abort the install.
_cqm_get() { uci -q get "quecmanager.$1" 2>/dev/null || true; }
_cqm_has() { uci -q get "quecmanager.$1" >/dev/null 2>&1; }
_cqm_set() {
    uci set "quecmanager.$1=$2"
    CQM_CHANGED=1
}

# _cqm_rename_range <new> <old> <lo> <hi> <default>: watchcat.<new> from
# watchcat.<old> clamped, else the default. No-op when <new> exists.
_cqm_rename_range() {
    local _ov
    _cqm_has "watchcat.$1" && return 0
    _ov=$(_cqm_get "watchcat.$2")
    if cqm_range "$_ov" "$3" "$4"; then
        _cqm_set "watchcat.$1" "$CQM_VAL"
        _cqm_log "Migrated watchcat.$2=$_ov -> watchcat.$1=$CQM_VAL"
    else
        _cqm_set "watchcat.$1" "$5"
        if [ -n "$_ov" ]; then
            _cqm_log "watchcat.$2=$_ov is not a number -> watchcat.$1=$5 (default)"
        else
            _cqm_log "Seeded quecmanager.watchcat.$1=$5"
        fi
    fi
}

# cqm_migrate_uci: stage the section 3.3 migration (the caller commits).
# Safe under set -e (install.sh). Idempotent: every new key is written only while absent, so a rerun changes
# nothing. Old keys stay for a rollback, except the dropped interval_override.
# Logs through $CQM_LOG_FN (unset = silent). CQM_CHANGED=1 when anything staged.
cqm_migrate_uci() {
    local _old
    local _sens
    local _ov
    local _k
    local _kv
    local _t4
    local _t6

    CQM_CHANGED=0
    _cqm_has ping_profile || uci set quecmanager.ping_profile=ping_profile
    _cqm_has watchcat || uci set quecmanager.watchcat=watchcat

    # The sensitivity the old daemon ran: profile when set (unknown = relaxed,
    # as conn_state_resolve did), else an existing sensitivity, else relaxed.
    _old=$(_cqm_get ping_profile.profile)
    if [ -n "$_old" ]; then
        _sens="$_old"
    else
        _sens=$(_cqm_get ping_profile.sensitivity)
    fi
    cqm_sens_ok "$_sens" || _sens="relaxed"

    if ! _cqm_has ping_profile.sensitivity; then
        _cqm_set ping_profile.sensitivity "$_sens"
        if [ -n "$_old" ]; then
            _cqm_log "Migrated ping_profile.profile=$_old -> ping_profile.sensitivity=$_sens"
        else
            _cqm_log "Seeded quecmanager.ping_profile.sensitivity=$_sens"
        fi
    fi

    if ! _cqm_has ping_profile.targets; then
        _t4=$(_cqm_get ping_profile.target_ipv4)
        _t6=$(_cqm_get ping_profile.target_ipv6)
        cqm_targets_from_old "$_t4" "$_t6"
        uci -q delete quecmanager.ping_profile.targets || true
        for _k in "$CQM_T1" "$CQM_T2" "$CQM_T3" "$CQM_T4"; do
            uci add_list "quecmanager.ping_profile.targets=$_k"
        done
        CQM_CHANGED=1
        if [ -n "$_t4" ] || [ -n "$_t6" ]; then
            _cqm_log "Migrated ping_profile.target_ipv4=${_t4:-unset} target_ipv6=${_t6:-unset} -> ping_profile.targets=$CQM_T1 $CQM_T2 $CQM_T3 $CQM_T4"
        else
            _cqm_log "Seeded quecmanager.ping_profile.targets=$CQM_T1 $CQM_T2 $CQM_T3 $CQM_T4"
        fi
    fi

    # Kept keys: seeded only while absent (backup_sim_slot stays absent = none).
    for _kv in enabled=0 tier1_enabled=1 tier2_enabled=1 tier3_enabled=0 \
               tier4_enabled=1 max_reboots_per_hour=3 quality_enabled=0 \
               ssr_aware=1 carrier_enabled=0 carrier_after_min=15; do
        _k="${_kv%%=*}"
        if ! _cqm_has "watchcat.$_k"; then
            _cqm_set "watchcat.$_k" "${_kv#*=}"
            _cqm_log "Seeded quecmanager.watchcat.$_kv"
        fi
    done

    # act_after_sec from the counted probes, at the cadence the old daemon ran
    # them (the override included), so the old wall-clock delay carries over.
    if ! _cqm_has watchcat.act_after_sec; then
        _k=fail_threshold
        _old=$(_cqm_get watchcat.fail_threshold)
        if [ -z "$_old" ]; then
            _k=max_failures
            _old=$(_cqm_get watchcat.max_failures)
        fi
        cqm_effective_interval "$_sens" "$(_cqm_get ping_profile.interval_override)"
        if cqm_act_after_sec "$_old" "$CQM_IV"; then
            _cqm_set watchcat.act_after_sec "$CQM_VAL"
            _cqm_log "Migrated watchcat.$_k=$_old (x ${CQM_IV}s probe interval) -> watchcat.act_after_sec=$CQM_VAL"
        else
            _cqm_set watchcat.act_after_sec 30
            if [ -n "$_old" ]; then
                _cqm_log "watchcat.$_k=$_old is not a number -> watchcat.act_after_sec=30 (default)"
            else
                _cqm_log "Seeded quecmanager.watchcat.act_after_sec=30"
            fi
        fi
    fi

    if ! _cqm_has watchcat.quality_after_sec; then
        _old=$(_cqm_get watchcat.quality_consecutive)
        _ov=$(_cqm_get watchcat.check_interval)
        if cqm_quality_after_sec "$_old" "$_ov"; then
            _cqm_set watchcat.quality_after_sec "$CQM_VAL"
            _cqm_log "Migrated watchcat.quality_consecutive=$_old (x check_interval ${_ov:-10}) -> watchcat.quality_after_sec=$CQM_VAL"
        else
            _cqm_set watchcat.quality_after_sec 120
            if [ -n "$_old" ]; then
                _cqm_log "watchcat.quality_consecutive=$_old is not a number -> watchcat.quality_after_sec=120 (default)"
            else
                _cqm_log "Seeded quecmanager.watchcat.quality_after_sec=120"
            fi
        fi
    fi

    _cqm_rename_range step_wait_sec cooldown 10 300 60
    _cqm_rename_range ssr_grace_sec ssr_grace 10 120 45
    _cqm_rename_range failback_every_min primary_recheck_interval 5 1440 30

    if ! _cqm_has watchcat.failback_enabled; then
        _old=$(_cqm_get watchcat.primary_recheck_enabled)
        if cqm_bool "$_old"; then
            _cqm_set watchcat.failback_enabled "$CQM_VAL"
            _cqm_log "Migrated watchcat.primary_recheck_enabled=$_old -> watchcat.failback_enabled=$CQM_VAL"
        else
            _cqm_set watchcat.failback_enabled 0
            _cqm_log "Seeded quecmanager.watchcat.failback_enabled=0"
        fi
    fi

    # Dropped, not remapped (the saved sensitivity stays). After act_after_sec,
    # which read it.
    _old=$(_cqm_get ping_profile.interval_override)
    if _cqm_has ping_profile.interval_override; then
        uci -q delete quecmanager.ping_profile.interval_override || true
        CQM_CHANGED=1
        _cqm_log "Removed dropped ping_profile.interval_override=$_old (sensitivity $_sens kept)"
    fi
    return 0
}
