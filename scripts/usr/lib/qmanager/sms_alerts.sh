#!/bin/sh
# =============================================================================
# sms_alerts.sh - SMS Alert Library for QManager
# =============================================================================
# Sourced by qmanager_poller and CGI scripts. Detects prolonged internet
# downtime and sends SMS notifications via sms_tool on the modem AT channel.
#
# Behavior summary:
# - When downtime exceeds threshold, attempt a "Connection down" SMS.
# - On recovery:
#   - if downtime SMS was sent, send a separate "Connection recovered" SMS.
#   - if downtime SMS was never sent/failed, send one dedup combined SMS.
# - Registration guard is enforced for runtime sends.
#
# Config:  /etc/qmanager/sms_alerts.json
# Log:     /tmp/qmanager_sms_log.json (NDJSON, max 100 entries)
# Reload:  /tmp/qmanager_sms_reload
# Lock:    /var/lock/qmanager.lock (shared with qcmd/atcli_smd11)
# =============================================================================

[ -n "$_SMS_ALERTS_LOADED" ] && return 0
_SMS_ALERTS_LOADED=1

# --- Constants ---------------------------------------------------------------
_SA_CONFIG="/etc/qmanager/sms_alerts.json"
_SA_LOG_FILE="/tmp/qmanager_sms_log.json"
_SA_RELOAD_FLAG="/tmp/qmanager_sms_reload"
# Shared with qcmd/atcli_smd11 so sms_tool send/recv/delete/status
# serializes against every other process touching /dev/smd11.
_SA_LOCK_FILE="/var/lock/qmanager.lock"
_SA_SMS_TOOL="/usr/bin/sms_tool"
_SA_AT_DEVICE="/dev/smd11"
_SA_MAX_LOG=100

# =============================================================================
# _sa_strip_noise - Filter tcgetattr/tcsetattr diagnostic lines from sms_tool
# =============================================================================
# sms_tool prints these to stdout/stderr whenever /dev/smd11 is a char device
# rather than a real TTY. They are harmless but pollute JSON parsing and
# user-visible output. Always apply to any sms_tool output before use.
_sa_strip_noise() {
    grep -v -e '^tcgetattr(' -e '^tcsetattr(' -e 'Inappropriate ioctl for device$'
}

# --- State (populated by sms_alerts_init / _sa_read_config) ------------------
# Downtime tracking now lives in alert_engine.sh; this lib only owns the
# channel transport config + send/log helpers. The engine reads _sa_enabled
# and _sa_threshold_minutes to gate + threshold the SMS channel.
_sa_enabled="false"
_sa_recipient=""
_sa_threshold_minutes=5

# =============================================================================
# _sa_flock_wait - BusyBox-compatible flock with timeout (polling loop)
# =============================================================================
# Usage: _sa_flock_wait <fd> <timeout_seconds>
# Returns: 0 = lock acquired, non-zero = timed out
_sa_flock_wait() {
    _fd="$1"
    _wait="$2"
    _elapsed=0

    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done

    flock -x -n "$_fd" 2>/dev/null
}

# =============================================================================
# _sa_sms_locked - Run sms_tool under shared AT lock
# =============================================================================
# Always targets /dev/smd11.
#
# NOTE: stderr is captured to a temp file, NOT merged with stdout via 2>&1.
# Merging is unsafe because sms_tool's cleanup `failed tcsetattr(...):
# Inappropriate ioctl for device` error can land mid-stdout when the payload
# exceeds the ~4 KB block buffer (typical for `recv -j`), gluing itself onto
# a JSON chunk and defeating line-based noise filtering. On success we
# return pure stdout; on failure we return stderr with known noise stripped.
_sa_sms_locked() {
    [ -e "$_SA_LOCK_FILE" ] || : > "$_SA_LOCK_FILE"
    _sa_err="/tmp/qmanager_sa_err.$$"

    (
        _sa_flock_wait 9 10 || exit 2
        _sa_out=$("$_SA_SMS_TOOL" -d "$_SA_AT_DEVICE" "$@" 2>"$_sa_err")
        _sa_rc=$?
        if [ "$_sa_rc" -eq 0 ]; then
            printf '%s' "$_sa_out"
        else
            _sa_err_clean=$(_sa_strip_noise < "$_sa_err" 2>/dev/null)
            if [ -n "$_sa_err_clean" ]; then
                printf '%s' "$_sa_err_clean"
            else
                printf '%s' "$_sa_out"
            fi
        fi
        rm -f "$_sa_err"
        exit "$_sa_rc"
    ) 9<"$_SA_LOCK_FILE"
}

# =============================================================================
# _sa_read_config - Read settings from config JSON
# =============================================================================
_sa_read_config() {
    if [ ! -f "$_SA_CONFIG" ]; then
        _sa_enabled="false"
        return 1
    fi

    _sa_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$_SA_CONFIG" 2>/dev/null)
    _sa_recipient=$(jq -r '.recipient_phone // ""' "$_SA_CONFIG" 2>/dev/null)
    _sa_threshold_minutes=$(jq -r '.threshold_minutes // 5' "$_SA_CONFIG" 2>/dev/null)

    if [ "$_sa_enabled" != "true" ]; then
        _sa_enabled="false"
        return 0
    fi
    if [ -z "$_sa_recipient" ]; then
        _sa_enabled="false"
        return 1
    fi

    return 0
}

# =============================================================================
# _sa_is_registered - Is modem currently able to send SMS?
# =============================================================================
# If the ping daemon reports the internet reachable, the modem is by
# definition registered and attached to a PDN — trust that over the
# serving-cell fields, which are populated by poll_serving_cell AFTER the
# alert engine's local block runs and are therefore stale by one cycle. Without
# this shortcut, the recovery-path SMS gets skipped whenever ping recovers
# before the next serving-cell poll refreshes lte_state/nr_state.
_sa_is_registered() {
    [ "$conn_internet_available" = "true" ] && return 0

    [ "$modem_reachable" = "true" ] || return 1

    if [ "$lte_state" = "connected" ] || [ "$nr_state" = "connected" ]; then
        return 0
    fi

    return 1
}

# =============================================================================
# sms_alerts_init - Called once at poller startup
# =============================================================================
sms_alerts_init() {
    _sa_read_config
    # One-time in-memory migration: strip a legacy leading + from the stored
    # recipient. New saves go through the CGI's normalize step, but existing
    # installs may still have "+14155551234" in sms_alerts.json from before
    # the migration. No silent file rewrite — it gets re-saved next time the
    # user touches the settings form.
    case "$_sa_recipient" in
        +*) _sa_recipient="${_sa_recipient#+}" ;;
    esac
    if [ "$_sa_enabled" = "true" ]; then
        qlog_info "SMS alerts enabled: recipient=$_sa_recipient threshold=${_sa_threshold_minutes}m"
    else
        qlog_info "SMS alerts disabled or not configured"
    fi
}

# =============================================================================
# sms_alert_emit <event> <secs> — engine-driven send + log (one message)
# =============================================================================
# Called by alert_engine.sh once the centralized state machine decides a
# message is warranted. The engine owns downtime tracking, thresholds, routing
# and suppression; this function only builds the body and sends it.
#
# Returns:
#   0 = message sent
#   1 = attempted but failed (terminal — engine will not retry)
#   2 = not ready to attempt, retry next cycle (SMS modem not yet registered)
#
# The connection_lost registration gate reproduces the old pending-path outer
# guard: when the modem is not registered we return 2 WITHOUT calling
# _sa_do_send, so its 3x retry sleeps never block the poller's local block.
sms_alert_emit() {
    local _sae_event="$1"
    local _sae_secs="$2"
    local _sae_cause="$3"
    local _sae_count="$4"
    local _sae_dur
    local _sae_body
    local _sae_trigger
    local _sae_phrase

    _sae_dur=$(_sa_format_duration "$_sae_secs")

    case "$_sae_event" in
        connection_lost)
            if ! _sa_is_registered; then
                qlog_debug "SMS alerts: connection_lost deferred — modem not registered"
                return 2
            fi
            _sae_body="[QManager] Connection down for ${_sae_dur}"
            _sae_trigger="Connection down for ${_sae_dur}"
            ;;
        connection_restored)
            _sae_body="[QManager] Connection recovered after ${_sae_dur}"
            _sae_trigger="Connection recovered after ${_sae_dur}"
            ;;
        reboot)
            # Reboot alerts are delivered post-recovery (userspace was dead at
            # the reboot instant), so the same registration gate the outage-start
            # arm uses applies — return 2 to retry until the modem re-registers.
            if ! _sa_is_registered; then
                qlog_debug "SMS alerts: reboot deferred — modem not registered"
                return 2
            fi
            if [ "$_sae_cause" = "storm" ]; then
                _sae_body="[QManager] Modem is reboot-looping (${_sae_count} reboots in the last hour). Check power/firmware."
                _sae_trigger="Reboot loop (${_sae_count}/hr)"
            else
                case "$_sae_cause" in
                    watchdog) _sae_phrase="watchdog recovered the connection" ;;
                    user)     _sae_phrase="planned reboot" ;;
                    *)        _sae_phrase="unexpected - power or firmware" ;;
                esac
                _sae_body="[QManager] Modem rebooted ~${_sae_dur} ago (${_sae_phrase}) - now back online."
                _sae_trigger="Reboot (${_sae_cause}) ~${_sae_dur} ago"
            fi
            ;;
        *)
            qlog_warn "SMS alerts: unknown event '$_sae_event'"
            return 1
            ;;
    esac

    if _sa_do_send "$_sae_body"; then
        _sa_log_event "$_sae_trigger" "sent" "$_sa_recipient"
        return 0
    fi
    _sa_log_event "$_sae_trigger" "failed" "$_sa_recipient"
    return 1
}

# =============================================================================
# _sa_do_send - Send SMS with retries, re-checking registration each attempt
# =============================================================================
_sa_do_send() {
    body="$1"
    attempt=0
    max_attempts=3
    retry_delay=5
    _last_err=""

    if [ ! -x "$_SA_SMS_TOOL" ]; then
        qlog_error "SMS alerts: sms_tool not found at $_SA_SMS_TOOL"
        return 1
    fi

    while [ "$attempt" -lt "$max_attempts" ]; do
        attempt=$((attempt + 1))

        if [ "$attempt" -gt 1 ]; then
            sleep "$retry_delay"
        fi

        # In CGI test-send context, this is overridden to always pass.
        if ! _sa_is_registered; then
            qlog_warn "SMS alerts: attempt $attempt/$max_attempts skipped (not registered) — modem_reachable=$modem_reachable lte_state=$lte_state nr_state=$nr_state conn=$conn_internet_available"
            continue
        fi

        # $_sa_recipient is already normalized (no leading +) by the CGI
        # save_settings handler and by sms_alerts_init's boot migration.
        send_out=$(_sa_sms_locked send "$_sa_recipient" "$body" 2>&1)
        rc=$?

        if [ "$rc" -eq 0 ]; then
            qlog_info "SMS alerts: sms_tool send succeeded on attempt $attempt"
            return 0
        fi

        # _sa_sms_locked already strips tcgetattr noise; just fall back to a
        # generic message if the stripped output is empty.
        [ -z "$send_out" ] && send_out="sms_tool send failed (rc=$rc)"
        _last_err="$send_out"
        qlog_warn "SMS alerts: sms_tool send failed on attempt $attempt/$max_attempts (rc=$rc) — $send_out"
    done

    qlog_error "SMS alerts: all ${max_attempts} send attempts failed for $_sa_recipient — last_err: ${_last_err:-<no output>}"
    return 1
}

# =============================================================================
# _sa_send_test_sms - Called by CGI to send a test SMS
# =============================================================================
_sa_send_test_sms() {
    body="[QManager] Test SMS from your modem"

    if _sa_do_send "$body"; then
        _sa_log_event "Test SMS" "sent" "$_sa_recipient"
        return 0
    fi

    _sa_log_event "Test SMS" "failed" "$_sa_recipient"
    return 1
}

# =============================================================================
# _sa_log_event - Append entry to NDJSON log file
# =============================================================================
_sa_log_event() {
    trigger="$1"
    status="$2"
    recipient="$3"
    ts=$(date "+%Y-%m-%d %H:%M:%S")

    jq -n -c \
        --arg ts "$ts" \
        --arg trigger "$trigger" \
        --arg status "$status" \
        --arg recipient "$recipient" \
        '{timestamp: $ts, trigger: $trigger, status: $status, recipient: $recipient}' \
        >> "$_SA_LOG_FILE"

    count=$(wc -l < "$_SA_LOG_FILE" 2>/dev/null || echo 0)
    if [ "$count" -gt "$_SA_MAX_LOG" ]; then
        tmp="${_SA_LOG_FILE}.tmp"
        if tail -n "$_SA_MAX_LOG" "$_SA_LOG_FILE" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$_SA_LOG_FILE" 2>/dev/null || rm -f "$tmp"
        else
            rm -f "$tmp"
        fi
    fi
}

# =============================================================================
# _sa_format_duration - Convert seconds to human-readable string
# =============================================================================
_sa_format_duration() {
    secs="$1"
    hours=$((secs / 3600))
    remaining=$((secs % 3600))
    mins=$((remaining / 60))
    remaining=$((remaining % 60))

    if [ "$hours" -gt 0 ]; then
        printf "%dh %dm %ds" "$hours" "$mins" "$remaining"
    elif [ "$mins" -gt 0 ]; then
        printf "%dm %ds" "$mins" "$remaining"
    else
        printf "%ds" "$remaining"
    fi
}
