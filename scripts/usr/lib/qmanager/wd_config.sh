#!/bin/sh
# =============================================================================
# wd_config.sh - qmanager_watchcat: configuration (cfg_get) and fixed constants
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns (declared and initialised here, see docs/plans watchdog-modular-lean 2.1):
#   every CFG_* global, BOOT_SETTLE,
#   MODEM_WAIT_TIMEOUT, SIM_SETTLE_SECS, HOLDOFF_OUTAGE_SECS,
#   HOLDOFF_QUALITY_SECS_0/1/2, HOLDOFF_QUALITY_RESET_SECS
# Functions: read_config, resolve_quality_thresholds
#
# Libraries hold function definitions and global initialisers only: no top-level
# commands and no sourcing of other libs. The last line sets WD_CONFIG_LOADED so
# the daemon can refuse to start on a half-loaded library set.
# =============================================================================

# --- Configuration (defaults, overridden by the config store) ----------------
CFG_ENABLED=0
CFG_CHECK_INTERVAL=10
# Seconds of outage age (wd_detect.sh wd_outage_update) before recovery starts;
# the effective value is max(act_after_sec, the ping daemon's fail_secs).
CFG_ACT_AFTER_SEC=30
# Seconds a tier gets to work before its verdict (step_wait_sec, 10-300, default
# 60); the effective wait is max(step_wait_sec, the ping daemon's recover_secs
# + 20), at least SIM_SETTLE_SECS for Tier 3 and the SIM settles (wd_tiers.sh).
CFG_STEP_WAIT_SEC=60
CFG_TIER1_ENABLED=1
CFG_TIER2_ENABLED=1
CFG_TIER3_ENABLED=0
CFG_TIER4_ENABLED=1
CFG_BACKUP_SIM_SLOT=""
CFG_MAX_REBOOTS_PER_HOUR=3
CFG_QUALITY_ENABLED=0
# Shared degraded thresholds resolved from connection_quality latency/loss
# (NOT watchcat.* — the retired latency_ceiling_ms/loss_ceiling_pct keys). These
# are recomputed by resolve_quality_thresholds() on each config load/reload,
# then raised to the watchdog floors (spec section 5.2): a quality ladder never
# acts on a latency limit below 50 ms or a loss limit below 10 %.
CFG_LATENCY_THRESHOLD_MS=250
CFG_LOSS_THRESHOLD_PCT=30
QUALITY_LATENCY_FLOOR_MS=50
QUALITY_LOSS_FLOOR_PCT=10
# Seconds a quality breach must persist on the monotonic clock before the
# quality ladder starts (quality_after_sec, 30-1800, default 120).
CFG_QUALITY_AFTER_SEC=120
CFG_SSR_AWARE=1
CFG_SSR_GRACE=45
# Auto-failback to the primary SIM after a Tier-3 failover. The inactive primary
# slot CANNOT be passively health-checked (single hard SIM mux), so failback is a
# BLIND periodic swap-back-to-primary + retest — each attempt is a real outage.
# OPT-IN, default OFF. Interval is in MINUTES (a seconds cadence would be ruinous).
CFG_PRIMARY_RECHECK_ENABLED=0
CFG_PRIMARY_RECHECK_INTERVAL=30
BOOT_SETTLE=30
# Ping-cache staleness is conn_state_read's rule: max(3 * interval_sec, 15) s.
MODEM_WAIT_TIMEOUT=60
# A physical SIM swap needs ~90s to reach stable connectivity.
# Any Tier-3 (SIM-failover) recovery — and the reverse revert swap — must hold
# this floor before the first success/connectivity evaluation, otherwise the
# generic cooldown fires the success ping while the modem is still attaching and
# false-fails a swap that was actually fine. FIXED floor by design (not config).
SIM_SETTLE_SECS=90
# Pauses after every enabled tier has been tried without restoring the link
# (fixed, not config; spec section 5.5), one per recovery reason: the start gate
# returns "holdoff" for that reason only. An outage pause lasts 15 minutes. A
# quality pause lasts 15, 30, then 60 minutes on consecutive quality pauses
# (level 0/1/2); the level drops back to 0 after an hour with no quality pause.
HOLDOFF_OUTAGE_SECS=900
HOLDOFF_QUALITY_SECS_0=900
HOLDOFF_QUALITY_SECS_1=1800
HOLDOFF_QUALITY_SECS_2=3600
HOLDOFF_QUALITY_RESET_SECS=3600

# =============================================================================
# CONFIGURATION
# =============================================================================

read_config() {
    CFG_ENABLED=$(cfg_get watchdog enabled)
    [ -z "$CFG_ENABLED" ] && CFG_ENABLED=0

    local val
    # check_interval feeds cooldown arithmetic: digits only, leading zeros
    # stripped (ash reads "08" as a bad octal), 0 or garbage keeps the default.
    val=$(cfg_get watchdog check_interval)
    case "$val" in
        ''|*[!0-9]*) ;;
        *)
            while [ "${#val}" -gt 1 ] && [ "${val#0}" != "$val" ]; do val="${val#0}"; done
            [ "${#val}" -le 4 ] && [ "$val" -ge 1 ] && CFG_CHECK_INTERVAL="$val"
            ;;
    esac

    # act_after_sec: 15-600, default 30 (absent or non-numeric).
    val=$(cfg_get watchdog act_after_sec)
    case "$val" in
        ''|*[!0-9]*) CFG_ACT_AFTER_SEC=30 ;;
        *)
            CFG_ACT_AFTER_SEC="$val"
            [ "$CFG_ACT_AFTER_SEC" -lt 15 ] && CFG_ACT_AFTER_SEC=15
            [ "$CFG_ACT_AFTER_SEC" -gt 600 ] && CFG_ACT_AFTER_SEC=600
            ;;
    esac

    # step_wait_sec: 10-300, default 60 (absent or non-numeric).
    val=$(cfg_get watchdog step_wait_sec)
    case "$val" in
        ''|*[!0-9]*) CFG_STEP_WAIT_SEC=60 ;;
        *)
            # Leading zeros first ("0090" is 90, never octal), then the length.
            while [ "${#val}" -gt 1 ] && [ "${val#0}" != "$val" ]; do
                val="${val#0}"
            done
            [ "${#val}" -gt 3 ] && val=300
            CFG_STEP_WAIT_SEC="$val"
            [ "$CFG_STEP_WAIT_SEC" -lt 10 ] && CFG_STEP_WAIT_SEC=10
            [ "$CFG_STEP_WAIT_SEC" -gt 300 ] && CFG_STEP_WAIT_SEC=300
            ;;
    esac

    val=$(cfg_get watchdog tier1_enabled)
    [ -n "$val" ] && CFG_TIER1_ENABLED="$val"

    val=$(cfg_get watchdog tier2_enabled)
    [ -n "$val" ] && CFG_TIER2_ENABLED="$val"

    val=$(cfg_get watchdog tier3_enabled)
    [ -n "$val" ] && CFG_TIER3_ENABLED="$val"

    val=$(cfg_get watchdog tier4_enabled)
    [ -n "$val" ] && CFG_TIER4_ENABLED="$val"

    val=$(cfg_get watchdog backup_sim_slot)
    CFG_BACKUP_SIM_SLOT="$val"

    val=$(cfg_get watchdog max_reboots_per_hour)
    # max_reboots_per_hour: 1-10, default 3 (absent or non-numeric).
    case "$val" in
        ''|*[!0-9]*) CFG_MAX_REBOOTS_PER_HOUR=3 ;;
        *)
            # Leading zeros first ("0000001" is 1), then the length (test
            # overflows on huge values), so the value stays a plain decimal.
            while [ "${#val}" -gt 1 ] && [ "${val#0}" != "$val" ]; do
                val="${val#0}"
            done
            [ "${#val}" -gt 2 ] && val=10
            CFG_MAX_REBOOTS_PER_HOUR="$val"
            [ "$CFG_MAX_REBOOTS_PER_HOUR" -lt 1 ] && CFG_MAX_REBOOTS_PER_HOUR=1
            [ "$CFG_MAX_REBOOTS_PER_HOUR" -gt 10 ] && CFG_MAX_REBOOTS_PER_HOUR=10
            ;;
    esac

    CFG_QUALITY_ENABLED=$(cfg_get watchdog quality_enabled)
    [ -z "$CFG_QUALITY_ENABLED" ] && CFG_QUALITY_ENABLED=0

    # Degraded thresholds are now SHARED with the poller: read from
    # connection_quality latency/loss (latency_ceiling_ms / loss_ceiling_pct on
    # watchcat.* are retired and intentionally NOT read here).
    resolve_quality_thresholds

    # quality_after_sec: 30-1800, default 120 (absent or non-numeric).
    val=$(cfg_get watchdog quality_after_sec)
    case "$val" in
        ''|*[!0-9]*) CFG_QUALITY_AFTER_SEC=120 ;;
        *)
            # Leading zeros first ("0090" is 90, never octal), then the length.
            while [ "${#val}" -gt 1 ] && [ "${val#0}" != "$val" ]; do
                val="${val#0}"
            done
            [ "${#val}" -gt 4 ] && val=1800
            CFG_QUALITY_AFTER_SEC="$val"
            [ "$CFG_QUALITY_AFTER_SEC" -lt 30 ] && CFG_QUALITY_AFTER_SEC=30
            [ "$CFG_QUALITY_AFTER_SEC" -gt 1800 ] && CFG_QUALITY_AFTER_SEC=1800
            ;;
    esac

    CFG_SSR_AWARE=$(cfg_get watchdog ssr_aware)
    [ -z "$CFG_SSR_AWARE" ] && CFG_SSR_AWARE=1

    val=$(cfg_get watchdog ssr_grace_sec)
    # ssr_grace_sec: 10-120, default 45 (absent or non-numeric).
    case "$val" in
        ''|*[!0-9]*) CFG_SSR_GRACE=45 ;;
        *)
            CFG_SSR_GRACE="$val"
            [ "$CFG_SSR_GRACE" -lt 10 ] && CFG_SSR_GRACE=10
            [ "$CFG_SSR_GRACE" -gt 120 ] && CFG_SSR_GRACE=120
            ;;
    esac

    CFG_PRIMARY_RECHECK_ENABLED=$(cfg_get watchdog primary_recheck_enabled)
    [ -z "$CFG_PRIMARY_RECHECK_ENABLED" ] && CFG_PRIMARY_RECHECK_ENABLED=0

    # interval is in MINUTES; non-numeric/empty falls back to 30.
    val=$(cfg_get watchdog primary_recheck_interval)
    case "$val" in ''|*[!0-9]*) CFG_PRIMARY_RECHECK_INTERVAL=30 ;; *) CFG_PRIMARY_RECHECK_INTERVAL="$val" ;; esac

    qlog_info "Config loaded: interval=${CFG_CHECK_INTERVAL}s act_after=${CFG_ACT_AFTER_SEC}s step_wait=${CFG_STEP_WAIT_SEC}s"
    qlog_info "  Tiers: T1=${CFG_TIER1_ENABLED} T2=${CFG_TIER2_ENABLED} T3=${CFG_TIER3_ENABLED} T4=${CFG_TIER4_ENABLED} backup_sim=${CFG_BACKUP_SIM_SLOT:-none}"
    qlog_info "  Quality: enabled=${CFG_QUALITY_ENABLED} latency=${CFG_LATENCY_THRESHOLD_MS}ms loss=${CFG_LOSS_THRESHOLD_PCT}% after=${CFG_QUALITY_AFTER_SEC}s (shared thresholds, floors applied)"
    qlog_info "  SSR-aware: enabled=${CFG_SSR_AWARE} grace=${CFG_SSR_GRACE}s"
    qlog_info "  Primary-recheck (auto-failback): enabled=${CFG_PRIMARY_RECHECK_ENABLED} interval=${CFG_PRIMARY_RECHECK_INTERVAL}min"
}

# Resolve the SHARED degraded thresholds from connection_quality latency/loss
# into CFG_LATENCY_THRESHOLD_MS / CFG_LOSS_THRESHOLD_PCT. This is the watchdog's
# local mirror of the poller's resolver (kept in-daemon rather than a new lib —
# only two consumers, and the watchdog must not depend on poller globals). The
# section's ABSENCE means "default" -> tolerant/tolerant (250ms / 30%), matching
# the poller. `custom` reads the latency_custom_ms / loss_custom_pct keys; a
# non-numeric/empty custom value falls back to the tolerant default so a
# half-written config never yields an empty comparison value.
resolve_quality_thresholds() {
    local _lat_preset
    local _loss_preset
    local _lat_custom
    local _loss_custom

    _lat_preset=$(cfg_get connection_quality latency_preset)
    _loss_preset=$(cfg_get connection_quality loss_preset)

    case "$_lat_preset" in
        standard)      CFG_LATENCY_THRESHOLD_MS=150 ;;
        very-tolerant) CFG_LATENCY_THRESHOLD_MS=500 ;;
        custom)
            _lat_custom=$(cfg_get connection_quality latency_custom_ms)
            case "$_lat_custom" in
                ''|*[!0-9]*) CFG_LATENCY_THRESHOLD_MS=250 ;;
                *)           CFG_LATENCY_THRESHOLD_MS="$_lat_custom" ;;
            esac
            ;;
        tolerant|*)    CFG_LATENCY_THRESHOLD_MS=250 ;;
    esac

    case "$_loss_preset" in
        standard)      CFG_LOSS_THRESHOLD_PCT=15 ;;
        very-tolerant) CFG_LOSS_THRESHOLD_PCT=50 ;;
        custom)
            _loss_custom=$(cfg_get connection_quality loss_custom_pct)
            case "$_loss_custom" in
                ''|*[!0-9]*) CFG_LOSS_THRESHOLD_PCT=30 ;;
                *)           CFG_LOSS_THRESHOLD_PCT="$_loss_custom" ;;
            esac
            ;;
        tolerant|*)    CFG_LOSS_THRESHOLD_PCT=30 ;;
    esac

    # Watchdog floors (contracts section 1): max(latency, 50) ms, max(loss, 10) %.
    # Custom values are digits only here, so a length check keeps test in range.
    [ "${#CFG_LATENCY_THRESHOLD_MS}" -gt 6 ] && CFG_LATENCY_THRESHOLD_MS=10000
    [ "${#CFG_LOSS_THRESHOLD_PCT}" -gt 3 ] && CFG_LOSS_THRESHOLD_PCT=100
    [ "$CFG_LATENCY_THRESHOLD_MS" -lt "$QUALITY_LATENCY_FLOOR_MS" ] && CFG_LATENCY_THRESHOLD_MS="$QUALITY_LATENCY_FLOOR_MS"
    [ "$CFG_LOSS_THRESHOLD_PCT" -lt "$QUALITY_LOSS_FLOOR_PCT" ] && CFG_LOSS_THRESHOLD_PCT="$QUALITY_LOSS_FLOOR_PCT"
    return 0
}

WD_CONFIG_LOADED=1
