#!/bin/sh
# =============================================================================
# wd_config.sh - qmanager_watchcat: configuration (cfg_get) and fixed constants
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns (declared and initialised here, see docs/plans watchdog-modular-lean 2.1):
#   every CFG_* global, BOOT_SETTLE,
#   MODEM_WAIT_TIMEOUT, SIM_SETTLE_SECS, HOLDOFF_SECS
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
CFG_COOLDOWN=60
CFG_TIER1_ENABLED=1
CFG_TIER2_ENABLED=1
CFG_TIER3_ENABLED=0
CFG_TIER4_ENABLED=1
CFG_BACKUP_SIM_SLOT=""
CFG_MAX_REBOOTS_PER_HOUR=3
CFG_QUALITY_ENABLED=0
# Shared degraded thresholds resolved from connection_quality latency/loss
# (NOT watchcat.* — the retired latency_ceiling_ms/loss_ceiling_pct keys). These
# are recomputed by resolve_quality_thresholds() on each config load/reload.
CFG_LATENCY_THRESHOLD_MS=250
CFG_LOSS_THRESHOLD_PCT=30
CFG_QUALITY_CONSECUTIVE=5
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
# Pause after every enabled tier has been tried without restoring connectivity
# (fixed, not config): wd_decide_start returns "holdoff" until it elapses.
HOLDOFF_SECS=900

# =============================================================================
# CONFIGURATION
# =============================================================================

read_config() {
    CFG_ENABLED=$(cfg_get watchdog enabled)
    [ -z "$CFG_ENABLED" ] && CFG_ENABLED=0

    local val
    val=$(cfg_get watchdog check_interval)
    [ -n "$val" ] && CFG_CHECK_INTERVAL="$val"

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

    val=$(cfg_get watchdog cooldown)
    [ -n "$val" ] && CFG_COOLDOWN="$val"

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
    [ -n "$val" ] && CFG_MAX_REBOOTS_PER_HOUR="$val"

    CFG_QUALITY_ENABLED=$(cfg_get watchdog quality_enabled)
    [ -z "$CFG_QUALITY_ENABLED" ] && CFG_QUALITY_ENABLED=0

    # Degraded thresholds are now SHARED with the poller: read from
    # connection_quality latency/loss (latency_ceiling_ms / loss_ceiling_pct on
    # watchcat.* are retired and intentionally NOT read here).
    resolve_quality_thresholds

    val=$(cfg_get watchdog quality_consecutive)
    [ -n "$val" ] && CFG_QUALITY_CONSECUTIVE="$val"

    CFG_SSR_AWARE=$(cfg_get watchdog ssr_aware)
    [ -z "$CFG_SSR_AWARE" ] && CFG_SSR_AWARE=1

    val=$(cfg_get watchdog ssr_grace_sec)
    case "$val" in ''|*[!0-9]*) CFG_SSR_GRACE=45 ;; *) CFG_SSR_GRACE="$val" ;; esac

    CFG_PRIMARY_RECHECK_ENABLED=$(cfg_get watchdog primary_recheck_enabled)
    [ -z "$CFG_PRIMARY_RECHECK_ENABLED" ] && CFG_PRIMARY_RECHECK_ENABLED=0

    # interval is in MINUTES; non-numeric/empty falls back to 30.
    val=$(cfg_get watchdog primary_recheck_interval)
    case "$val" in ''|*[!0-9]*) CFG_PRIMARY_RECHECK_INTERVAL=30 ;; *) CFG_PRIMARY_RECHECK_INTERVAL="$val" ;; esac

    qlog_info "Config loaded: interval=${CFG_CHECK_INTERVAL}s act_after=${CFG_ACT_AFTER_SEC}s cooldown=${CFG_COOLDOWN}s"
    qlog_info "  Tiers: T1=${CFG_TIER1_ENABLED} T2=${CFG_TIER2_ENABLED} T3=${CFG_TIER3_ENABLED} T4=${CFG_TIER4_ENABLED} backup_sim=${CFG_BACKUP_SIM_SLOT:-none}"
    qlog_info "  Quality: enabled=${CFG_QUALITY_ENABLED} latency=${CFG_LATENCY_THRESHOLD_MS}ms loss=${CFG_LOSS_THRESHOLD_PCT}% consecutive=${CFG_QUALITY_CONSECUTIVE} (shared thresholds)"
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
}

WD_CONFIG_LOADED=1
