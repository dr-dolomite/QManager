#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms_forwarding.sh — CGI Endpoint: SMS Forwarding Settings (GET + POST)
# =============================================================================
# GET:  Returns current forwarding settings + recent send-failure records.
# POST: action=save_settings  -> persist enabled/target_phone, toggle service
#       action=clear_failures  -> drop the failures file
#       action=send_test       -> one-off test SMS to the CONFIGURED target
#
# Settings live in UCI (quecmanager.sms_forwarding.*). The daemon
# (qmanager_sms_forward) reads them and forwards inbound SMS. A reload flag plus
# init.d enable/start (or stop/disable) keeps the running daemon in sync.
#
# Config:  quecmanager.sms_forwarding.enabled ('0'/'1'), .target_phone
# Reload:  /tmp/qmanager_sms_forward_reload
# Output:  /tmp/qmanager_sms_forward_failures.json (written by the daemon)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh
# Install location: /www/cgi-bin/quecmanager/cellular/sms_forwarding.sh
# =============================================================================

qlog_init "cgi_sms_forwarding"
cgi_headers
cgi_handle_options

RELOAD_FLAG="/tmp/qmanager_sms_forward_reload"
FAILURES_FILE="/tmp/qmanager_sms_forward_failures.json"
INITD="/etc/init.d/qmanager_sms_forward"

# Shared AT lock (serializes sms_tool against qcmd/atcli_smd11 and other SMS).
_SF_LOCK_FILE="/var/lock/qmanager.lock"
_SF_LOCK_WAIT=10
_SF_SMS_TOOL="/usr/bin/sms_tool"
_SF_AT_DEVICE="/dev/smd11"

# Validation: E.164-ish — optional +, first digit 1-9, total 7-15 digits.
# Reused verbatim from monitoring/sms_alerts.sh.
_validate_phone() {
    _vp=$(printf '%s' "$1" | sed 's/^+//')
    case "$_vp" in
        ''|*[!0-9]*) return 1 ;;
    esac
    _vp_len=${#_vp}
    [ "$_vp_len" -lt 7 ] || [ "$_vp_len" -gt 15 ] && return 1
    _vp_first=$(printf '%s' "$_vp" | cut -c1)
    [ "$_vp_first" = "0" ] && return 1
    return 0
}

# BusyBox-compatible flock with timeout (polling loop).
_sf_flock_wait() {
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

# Run sms_tool under the shared lock. stderr -> temp file (never 2>&1) so noise
# can't land mid-output. On success returns stdout; on failure returns
# noise-stripped stderr.
_sf_sms_run() {
    [ -e "$_SF_LOCK_FILE" ] || : > "$_SF_LOCK_FILE" 2>/dev/null
    _sf_err="/tmp/qmanager_sms_fwd_cgi_err.$$"
    (
        _sf_flock_wait 9 "$_SF_LOCK_WAIT" || exit 2
        _sf_out=$("$_SF_SMS_TOOL" -d "$_SF_AT_DEVICE" "$@" 2>"$_sf_err")
        _sf_rc=$?
        if [ "$_sf_rc" -eq 0 ]; then
            printf '%s' "$_sf_out"
        else
            _sf_err_clean=$(grep -v -e '^tcgetattr(' -e '^tcsetattr(' -e 'Inappropriate ioctl for device$' < "$_sf_err" 2>/dev/null)
            if [ -n "$_sf_err_clean" ]; then
                printf '%s' "$_sf_err_clean"
            else
                printf '%s' "$_sf_out"
            fi
        fi
        rm -f "$_sf_err"
        exit "$_sf_rc"
    ) 9<"$_SF_LOCK_FILE"
}

# =============================================================================
# GET — Fetch settings + failures
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS forwarding settings"

    enabled_raw=$(uci -q get quecmanager.sms_forwarding.enabled 2>/dev/null)
    target_phone=$(uci -q get quecmanager.sms_forwarding.target_phone 2>/dev/null)
    [ "$enabled_raw" = "1" ] && enabled_json="true" || enabled_json="false"
    [ -z "$target_phone" ] && target_phone=""

    if [ -f "$FAILURES_FILE" ] && [ -s "$FAILURES_FILE" ]; then
        failures=$(jq -c 'if type == "array" then . else [] end' "$FAILURES_FILE" 2>/dev/null)
    fi
    [ -z "$failures" ] && failures="[]"
    printf '%s' "$failures" | jq empty 2>/dev/null || failures="[]"

    jq -n \
        --argjson enabled "$enabled_json" \
        --arg target_phone "$target_phone" \
        --argjson failures "$failures" \
        '{
            success: true,
            settings: {
                enabled: $enabled,
                target_phone: $target_phone
            },
            failures: $failures,
            failure_count: ($failures | length)
        }'
    exit 0
fi

# =============================================================================
# POST — save_settings / clear_failures / send_test
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: save_settings ----------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        # enabled may arrive as bool true/false or "0"/"1"; normalize to 0/1.
        ENABLED_RAW=$(printf '%s' "$POST_DATA" | jq -r 'if .enabled == null then empty else (.enabled | tostring) end')
        case "$ENABLED_RAW" in
            true|1) ENABLED=1 ;;
            false|0) ENABLED=0 ;;
            *) ENABLED=0 ;;
        esac

        TARGET=$(printf '%s' "$POST_DATA" | jq -r 'if .target_phone == null then "" else .target_phone end')

        # When enabling, the target must be valid. When disabling, an empty or
        # bad number is tolerated (the daemon idles regardless).
        if [ "$ENABLED" = "1" ]; then
            if ! _validate_phone "$TARGET"; then
                cgi_error "invalid_phone" "target_phone is not a valid phone number"
                exit 0
            fi
        fi

        uci set quecmanager.sms_forwarding.enabled="$ENABLED"
        uci set quecmanager.sms_forwarding.target_phone="$TARGET"
        uci commit quecmanager 2>/dev/null

        # Signal the running daemon to re-read config within one cycle.
        touch "$RELOAD_FLAG" 2>/dev/null

        # Reflect enabled state in the init.d service.
        if [ "$ENABLED" = "1" ]; then
            "$INITD" enable 2>/dev/null
            ( "$INITD" restart >/dev/null 2>&1 & )
            qlog_info "SMS forwarding enabled, daemon enabled and started"
        else
            "$INITD" stop >/dev/null 2>&1
            "$INITD" disable 2>/dev/null
            qlog_info "SMS forwarding disabled, daemon stopped and disabled"
        fi

        [ "$ENABLED" = "1" ] && enabled_json="true" || enabled_json="false"
        jq -n \
            --argjson enabled "$enabled_json" \
            --arg target_phone "$TARGET" \
            '{
                success: true,
                settings: {
                    enabled: $enabled,
                    target_phone: $target_phone
                }
            }'
        exit 0
    fi

    # --- action: clear_failures ---------------------------------------------
    if [ "$ACTION" = "clear_failures" ]; then
        rm -f "$FAILURES_FILE"
        qlog_info "SMS forwarding failures cleared"
        cgi_success
        exit 0
    fi

    # --- action: send_test --------------------------------------------------
    # Tests the REAL configured target (never a number from the request body),
    # so the UI can verify the forwarding send path end-to-end. Single attempt.
    if [ "$ACTION" = "send_test" ]; then
        TARGET=$(uci -q get quecmanager.sms_forwarding.target_phone 2>/dev/null)
        if ! _validate_phone "$TARGET"; then
            cgi_error "invalid_phone" "no valid target_phone configured"
            exit 0
        fi

        PHONE=$(printf '%s' "$TARGET" | sed 's/^+//')
        BODY="From QManager: SMS forwarding test"

        qlog_info "SMS forwarding test send to $PHONE"
        result=$(_sf_sms_run send "$PHONE" "$BODY")
        rc=$?

        if [ "$rc" -ne 0 ]; then
            qlog_error "SMS forwarding test send failed (rc=$rc): $result"
            cgi_error "send_failed" "$result"
            exit 0
        fi

        qlog_info "SMS forwarding test send succeeded to $PHONE"
        cgi_success
        exit 0
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be save_settings, clear_failures, or send_test"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed
