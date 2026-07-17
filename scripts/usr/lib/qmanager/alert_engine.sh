#!/bin/sh
# =============================================================================
# alert_engine.sh — Centralized Connection-Alert Engine for QManager
# =============================================================================
# ONE downtime state machine + dispatcher, replacing the two duplicated state
# machines that used to live in sms_alerts.sh::check_sms_alert and
# email_alerts.sh::check_email_alert. Sourced into qmanager_poller and invoked
# once per cycle from the always-every-cycle local block (before any AT work),
# so alert detection keeps running at the 2s base cadence regardless of the
# adaptive-polling tier.
#
# This library sources NOTHING itself — the poller sources, in order:
#   qlog.sh (mono_now, qlog_*) -> events.sh -> email_alerts.sh -> sms_alerts.sh
#   -> alert_routing.sh -> alert_engine.sh
# The engine reads globals owned by those libs at call time:
#   conn_internet_available / conn_during_recovery  (poller, from ping.json)
#   _sa_enabled / _sa_threshold_minutes             (sms_alerts.sh)
#   _ea_enabled / _ea_threshold_minutes             (email_alerts.sh)
#   alert_route_enabled / alert_routing_load        (alert_routing.sh)
#   sms_alert_emit / email_alert_emit               (channel libs)
#
# Signal source [guardrail 1]: ICMP reachability (conn_internet_available)
#   ONLY — never service_status / registration state.
# Debounce [guardrail 2]: wall-clock downtime threshold, but elapsed time is
#   measured with the MONOTONIC clock (mono_now, the same clock ping.json's
#   .mono uses), NOT wall-clock epoch. A NITZ clock-step during an SSR-driven
#   outage therefore cannot corrupt the timer — mirrors the watchdog's
#   clock-step hardening.
# Suppression [guardrail 3]: bails on low-power OR watchdog recovery churn,
#   for BOTH channels (email used to miss the conn_during_recovery gate).
# =============================================================================

[ -n "$_ALERT_ENGINE_LOADED" ] && return 0
_ALERT_ENGINE_LOADED=1

# --- Reload flags + suppression sentinels (literal paths — the engine does not
# --- depend on the channel libs having been sourced to evaluate these) -------
_AE_SMS_RELOAD="/tmp/qmanager_sms_reload"
_AE_EMAIL_RELOAD="/tmp/qmanager_email_reload"
_AE_ROUTING_RELOAD="/tmp/qmanager_alert_routing_reload"
_AE_LOW_POWER="/tmp/qmanager_low_power_active"

# --- State (poller-process memory, module scope) -----------------------------
# _ae_outage_active     : "0" idle / "1" outage in progress
# _ae_outage_start_mono : mono_now at outage start (monotonic seconds)
# _ae_<ch>_armed        : outage exceeded THIS channel's threshold (warrants a
#                         restored message even if the lost message never sent)
# _ae_<ch>_lost_sent    : the connection_lost message attempt for THIS channel
#                         is done (sent or terminally failed) — don't re-attempt
_ae_outage_active="0"
_ae_outage_start_mono=0
_ae_sms_armed="0"
_ae_email_armed="0"
_ae_sms_lost_sent="0"
_ae_email_lost_sent="0"

# =============================================================================
# alert_engine_init — reset state to idle + prime routing cache
# =============================================================================
alert_engine_init() {
    _ae_outage_active="0"
    _ae_outage_start_mono=0
    _ae_sms_armed="0"
    _ae_email_armed="0"
    _ae_sms_lost_sent="0"
    _ae_email_lost_sent="0"
    alert_routing_load
    qlog_info "Alert engine initialized"
}

# --- Per-channel accessors (2 channels only; case dispatch avoids eval) -------
# Master-enable, read from the channel libs' cached config globals.
_ae_channel_enabled() {
    case "$1" in
        sms)   [ "$_sa_enabled" = "true" ] ;;
        email) [ "$_ea_enabled" = "true" ] ;;
        *)     return 1 ;;
    esac
}

# Threshold in SECONDS (minutes * 60), guarded against non-numeric config.
_ae_channel_threshold_secs() {
    _ae_thr=5
    case "$1" in
        sms)   _ae_thr="$_sa_threshold_minutes" ;;
        email) _ae_thr="$_ea_threshold_minutes" ;;
    esac
    case "$_ae_thr" in
        ''|*[!0-9]*) _ae_thr=5 ;;
    esac
    echo $(( _ae_thr * 60 ))
}

# Marker get/set. Getters run in $(...) subshells (read-only, safe). Setters
# must be called in the main shell (not a subshell) so the assignment persists.
_ae_get_armed()     { case "$1" in sms) echo "$_ae_sms_armed" ;; email) echo "$_ae_email_armed" ;; esac; }
_ae_set_armed()     { case "$1" in sms) _ae_sms_armed="$2" ;;   email) _ae_email_armed="$2" ;;   esac; }
_ae_get_lost_sent() { case "$1" in sms) echo "$_ae_sms_lost_sent" ;; email) echo "$_ae_email_lost_sent" ;; esac; }
_ae_set_lost_sent() { case "$1" in sms) _ae_sms_lost_sent="$2" ;;   email) _ae_email_lost_sent="$2" ;;   esac; }

# Dispatch a send to the right channel lib. Returns the emit's rc:
#   0 = sent, 1 = attempted but failed (terminal), 2 = not ready (retry later).
_ae_channel_emit() {
    case "$1" in
        sms)   sms_alert_emit "$2" "$3" ;;
        email) email_alert_emit "$2" "$3" ;;
        *)     return 1 ;;
    esac
}

# =============================================================================
# alert_engine_check — per-cycle entry point (replaces check_*_alert)
# =============================================================================
alert_engine_check() {
    local _ae_ch

    # --- 1. Reload gate: channel libs re-read their config; routing reloads ---
    if [ -f "$_AE_SMS_RELOAD" ]; then
        rm -f "$_AE_SMS_RELOAD"
        _sa_read_config 2>/dev/null
        qlog_info "Alert engine: SMS channel config reloaded (enabled=$_sa_enabled)"
    fi
    if [ -f "$_AE_EMAIL_RELOAD" ]; then
        rm -f "$_AE_EMAIL_RELOAD"
        _ea_read_config 2>/dev/null
        qlog_info "Alert engine: email channel config reloaded (enabled=$_ea_enabled)"
    fi
    if [ -f "$_AE_ROUTING_RELOAD" ]; then
        alert_routing_load
        qlog_info "Alert engine: routing reloaded"
    fi

    # --- 2. Suppression gates [guardrail 3] — both channels, one place -------
    # Low-power mode: no radio work of any kind.
    [ -f "$_AE_LOW_POWER" ] && return 0
    # Watchdog recovery churn: stale lte/nr state during AT+COPS/AT+CFUN. Outage
    # state persists across this guard (mono timer keeps its start), so a
    # qualifying restored message still fires on the first cycle after recovery.
    [ "$conn_during_recovery" = "true" ] && return 0

    # --- 3. Signal source [guardrail 1]: ICMP reachability only --------------
    # Unknown/stale ping data → leave outage state untouched (don't start or
    # clear an outage on unknown data). The monotonic elapsed math naturally
    # catches up on the next non-null cycle.
    case "$conn_internet_available" in
        null|"") return 0 ;;
    esac

    if [ "$conn_internet_available" = "false" ]; then
        _ae_handle_down
    elif [ "$conn_internet_available" = "true" ]; then
        _ae_handle_up
    fi
    return 0
}

# =============================================================================
# _ae_handle_down — internet is DOWN this cycle
# =============================================================================
_ae_handle_down() {
    local _ae_ch
    local _ae_now
    local _ae_elapsed
    local _ae_thr
    local _ae_rc

    # Start a new outage on the leading edge.
    if [ "$_ae_outage_active" != "1" ]; then
        _ae_outage_active="1"
        _ae_outage_start_mono=$(mono_now)
        _ae_sms_armed="0"
        _ae_email_armed="0"
        _ae_sms_lost_sent="0"
        _ae_email_lost_sent="0"
        qlog_info "Alert engine: outage started (mono=$_ae_outage_start_mono)"
    fi

    # Elapsed via the MONOTONIC clock [guardrail 2] — immune to NITZ steps.
    _ae_now=$(mono_now)
    _ae_elapsed=$(( _ae_now - _ae_outage_start_mono ))
    [ "$_ae_elapsed" -lt 0 ] && _ae_elapsed=0

    for _ae_ch in sms email; do
        _ae_channel_enabled "$_ae_ch" || continue
        _ae_thr=$(_ae_channel_threshold_secs "$_ae_ch")
        [ "$_ae_elapsed" -ge "$_ae_thr" ] || continue

        # Crossed this channel's threshold → arm it. Arming is independent of
        # capability, so email arms here (warranting a recovery email) even
        # though it never sends a connection_lost message.
        _ae_set_armed "$_ae_ch" "1"

        # The connection_lost message goes out only for a routed, capable
        # channel (SMS only). Skip if not routed/capable or already attempted.
        alert_route_enabled connection_lost "$_ae_ch" || continue
        [ "$(_ae_get_lost_sent "$_ae_ch")" = "1" ] && continue

        _ae_channel_emit "$_ae_ch" connection_lost "$_ae_elapsed"
        _ae_rc=$?
        # rc 2 = "not ready" (e.g. SMS modem not yet registered) — leave the
        # marker clear so we retry next cycle without burning a send attempt.
        # rc 0 (sent) or rc 1 (registered but sms_tool failed) are both terminal.
        if [ "$_ae_rc" != "2" ]; then
            _ae_set_lost_sent "$_ae_ch" "1"
        fi
    done
}

# =============================================================================
# _ae_handle_up — internet is UP this cycle
# =============================================================================
_ae_handle_up() {
    local _ae_ch
    local _ae_now
    local _ae_total

    # Nothing to do unless we were tracking an outage.
    [ "$_ae_outage_active" = "1" ] || return 0

    _ae_now=$(mono_now)
    _ae_total=$(( _ae_now - _ae_outage_start_mono ))
    [ "$_ae_total" -lt 0 ] && _ae_total=0

    # Fire a restored message for every channel that was armed AND is routed
    # for connection_restored. SMS armed <=> its outage crossed threshold (which
    # also covers the "a down SMS was sent" case); email armed <=> the outage
    # exceeded email's threshold. Restored is fire-once — no retry semantics.
    for _ae_ch in sms email; do
        _ae_channel_enabled "$_ae_ch" || continue
        [ "$(_ae_get_armed "$_ae_ch")" = "1" ] || continue
        alert_route_enabled connection_restored "$_ae_ch" || continue
        _ae_channel_emit "$_ae_ch" connection_restored "$_ae_total"
    done

    # Reset all outage state.
    _ae_outage_active="0"
    _ae_outage_start_mono=0
    _ae_sms_armed="0"
    _ae_email_armed="0"
    _ae_sms_lost_sent="0"
    _ae_email_lost_sent="0"
    qlog_info "Alert engine: outage cleared (total=${_ae_total}s)"
}
