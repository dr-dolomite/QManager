#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# alerts.sh — CGI Endpoint: Centralized Connection Alerts (GET + POST)
# =============================================================================
# Unified replacement for the four retired endpoints:
#   monitoring/sms_alerts.sh, monitoring/email_alerts.sh,
#   monitoring/sms_alert_log.sh, monitoring/email_alert_log.sh
#
# GET  → channels (sms + email) + routing matrix + capability matrix.
# POST (dispatch on .action):
#   save_settings   — persist sms + email + routing (3 files, atomic), regen
#                     msmtprc, signal poller reload. Clamps connection_lost.email
#                     to false server-side (email is incapable during an outage).
#   send_test       — {channel:"sms"|"email"} → send a test message.
#   install         — install msmtp via opkg (background).
#   install_status  — poll msmtp install progress.
#   uninstall       — remove msmtp (refused while email alerts still enabled).
#   get_log         — merged sms + email NDJSON logs, channel-tagged, newest 100.
#
# On-disk shapes are UNCHANGED for backward compat:
#   /etc/qmanager/sms_alerts.json    {enabled, recipient_phone, threshold_minutes}
#   /etc/qmanager/email_alerts.json  {enabled, sender_email, recipient_email,
#                                     app_password, threshold_minutes}
#   /etc/qmanager/alert_routing.json {version, events:{...}}  (NEW, additive)
#
# Install location: /www/cgi-bin/quecmanager/monitoring/alerts.sh
# =============================================================================

qlog_init "cgi_alerts"
cgi_headers
cgi_handle_options

SMS_CONFIG="/etc/qmanager/sms_alerts.json"
EMAIL_CONFIG="/etc/qmanager/email_alerts.json"
MSMTP_CONFIG="/etc/qmanager/msmtprc"
SMS_LOG="/tmp/qmanager_sms_log.json"
EMAIL_LOG="/tmp/qmanager_email_log.json"
MSMTP_INSTALL_RESULT="/tmp/qmanager_msmtp_install.json"
MSMTP_INSTALL_PID="/tmp/qmanager_msmtp_install.pid"

# Routing + capability library — the authority for the matrix the UI renders.
. /usr/lib/qmanager/alert_routing.sh 2>/dev/null || {
    _ar_cl_sms="true"
    _ar_cl_email="false"
    _ar_cr_sms="true"
    _ar_cr_email="true"
    alert_routing_load() { :; }
    alert_capabilities_json() {
        printf '%s' '{"connection_lost":{"sms":true,"email":false,"email_reason":"email_needs_internet"},"connection_restored":{"sms":true,"email":true}}'
    }
}

# --- Validators (jq has NO regex on-device — validate in shell) --------------

# E.164-ish: optional +, first digit 1-9, 7-15 digits total.
_validate_phone() {
    _vp=$(printf '%s' "$1" | sed 's/^+//')
    case "$_vp" in
        ''|*[!0-9]*) return 1 ;;
        0*)          return 1 ;;
    esac
    _vp_len=${#_vp}
    [ "$_vp_len" -ge 7 ] && [ "$_vp_len" -le 15 ]
}

# Basic email shape check via grep -E (BusyBox grep supports ERE; jq does not).
_validate_email() {
    printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z]+$'
}

# Atomic JSON write: content on stdin → validate → mv into place.
_write_json_atomic() {
    _wja_target="$1"
    _wja_tmp="${_wja_target}.tmp.$$"
    cat > "$_wja_tmp"
    if ! jq -e . "$_wja_tmp" >/dev/null 2>&1; then
        rm -f "$_wja_tmp"
        return 1
    fi
    mv "$_wja_tmp" "$_wja_target"
}

# =============================================================================
# GET — channels + routing + capabilities
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching centralized alert settings"

    # --- SMS channel ---
    sms_enabled="false"
    sms_phone=""
    sms_thr="5"
    sms_configured="false"
    if [ -f "$SMS_CONFIG" ]; then
        sms_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$SMS_CONFIG" 2>/dev/null)
        sms_phone=$(jq -r '.recipient_phone // ""' "$SMS_CONFIG" 2>/dev/null)
        sms_thr=$(jq -r '.threshold_minutes // 5' "$SMS_CONFIG" 2>/dev/null)
        [ -n "$sms_phone" ] && sms_configured="true"
    fi
    case "$sms_enabled" in true|false) ;; *) sms_enabled="false" ;; esac
    case "$sms_thr" in ''|*[!0-9]*) sms_thr="5" ;; esac

    # --- Email channel ---
    email_enabled="false"
    email_sender=""
    email_recipient=""
    email_pw_set="false"
    email_thr="5"
    email_configured="false"
    if [ -f "$EMAIL_CONFIG" ]; then
        email_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$EMAIL_CONFIG" 2>/dev/null)
        email_sender=$(jq -r '.sender_email // ""' "$EMAIL_CONFIG" 2>/dev/null)
        email_recipient=$(jq -r '.recipient_email // ""' "$EMAIL_CONFIG" 2>/dev/null)
        email_thr=$(jq -r '.threshold_minutes // 5' "$EMAIL_CONFIG" 2>/dev/null)
        _pw=$(jq -r '.app_password // ""' "$EMAIL_CONFIG" 2>/dev/null)
        [ -n "$_pw" ] && email_pw_set="true"
        [ -n "$email_sender" ] && [ -n "$email_recipient" ] && [ -n "$_pw" ] && email_configured="true"
    fi
    case "$email_enabled" in true|false) ;; *) email_enabled="false" ;; esac
    case "$email_thr" in ''|*[!0-9]*) email_thr="5" ;; esac

    if command -v msmtp >/dev/null 2>&1; then
        msmtp_installed="true"
    else
        msmtp_installed="false"
    fi

    # --- Routing (fail-closed to defaults) + capabilities ---
    alert_routing_load

    jq -n \
        --argjson sms_enabled "$sms_enabled" \
        --arg    sms_phone "$sms_phone" \
        --argjson sms_thr "$sms_thr" \
        --argjson sms_configured "$sms_configured" \
        --argjson email_enabled "$email_enabled" \
        --arg    email_sender "$email_sender" \
        --arg    email_recipient "$email_recipient" \
        --argjson email_pw_set "$email_pw_set" \
        --argjson email_thr "$email_thr" \
        --argjson msmtp_installed "$msmtp_installed" \
        --argjson email_configured "$email_configured" \
        --argjson cl_sms "$_ar_cl_sms" \
        --argjson cl_email "$_ar_cl_email" \
        --argjson cr_sms "$_ar_cr_sms" \
        --argjson cr_email "$_ar_cr_email" \
        --argjson capabilities "$(alert_capabilities_json)" \
        '{
            success: true,
            channels: {
                sms: {
                    enabled: $sms_enabled,
                    recipient_phone: $sms_phone,
                    threshold_minutes: $sms_thr,
                    configured: $sms_configured
                },
                email: {
                    enabled: $email_enabled,
                    sender_email: $email_sender,
                    recipient_email: $email_recipient,
                    app_password_set: $email_pw_set,
                    threshold_minutes: $email_thr,
                    msmtp_installed: $msmtp_installed,
                    configured: $email_configured
                }
            },
            routing: {
                events: {
                    connection_lost:     { sms: $cl_sms, email: $cl_email },
                    connection_restored: { sms: $cr_sms, email: $cr_email }
                }
            },
            capabilities: $capabilities
        }'
    exit 0
fi

# =============================================================================
# POST — action dispatch
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # save_settings — persist sms + email + routing atomically
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        qlog_info "Saving centralized alert settings"

        sms_enabled=$(printf '%s' "$POST_DATA" | jq -r 'if (.sms.enabled) == null then "false" else (.sms.enabled | tostring) end')
        sms_phone=$(printf '%s' "$POST_DATA" | jq -r '.sms.recipient_phone // ""')
        sms_thr=$(printf '%s' "$POST_DATA" | jq -r '.sms.threshold_minutes // 5')

        email_enabled=$(printf '%s' "$POST_DATA" | jq -r 'if (.email.enabled) == null then "false" else (.email.enabled | tostring) end')
        email_sender=$(printf '%s' "$POST_DATA" | jq -r '.email.sender_email // ""')
        email_recipient=$(printf '%s' "$POST_DATA" | jq -r '.email.recipient_email // ""')
        email_pw=$(printf '%s' "$POST_DATA" | jq -r '.email.app_password // empty')
        email_thr=$(printf '%s' "$POST_DATA" | jq -r '.email.threshold_minutes // 5')

        # --- Validate both thresholds (non-numeric guard, then 1-60 range) ---
        for _t in "$sms_thr" "$email_thr"; do
            case "$_t" in
                ''|*[!0-9]*)
                    cgi_error "invalid_threshold" "Threshold must be a number between 1 and 60"
                    exit 0
                    ;;
            esac
            if [ "$_t" -lt 1 ] || [ "$_t" -gt 60 ]; then
                cgi_error "invalid_threshold" "Threshold must be between 1 and 60 minutes"
                exit 0
            fi
        done

        # --- Validate SMS phone only when enabling ---
        if [ "$sms_enabled" = "true" ]; then
            if [ -z "$sms_phone" ]; then
                cgi_error "missing_phone" "Recipient phone is required when SMS alerts are enabled"
                exit 0
            fi
            if ! _validate_phone "$sms_phone"; then
                cgi_error "invalid_phone" "Recipient phone must be E.164 format, e.g. +14155551234"
                exit 0
            fi
        fi
        # Strip a single leading + before storing — sms_tool rejects it, so the
        # SMS lib never has to. PRESERVE this exactly.
        sms_phone=$(printf '%s' "$sms_phone" | sed 's/^+//')

        # --- Preserve stored password when the client omits it ---
        if [ -z "$email_pw" ] && [ -f "$EMAIL_CONFIG" ]; then
            email_pw=$(jq -r '.app_password // ""' "$EMAIL_CONFIG" 2>/dev/null)
        fi

        # --- Validate email fields only when enabling ---
        if [ "$email_enabled" = "true" ]; then
            if [ -z "$email_sender" ] || [ -z "$email_recipient" ]; then
                cgi_error "missing_email" "Sender and recipient email are required when email alerts are enabled"
                exit 0
            fi
            if ! _validate_email "$email_sender"; then
                cgi_error "invalid_email" "Sender email is not a valid address"
                exit 0
            fi
            if ! _validate_email "$email_recipient"; then
                cgi_error "invalid_email" "Recipient email is not a valid address"
                exit 0
            fi
            if [ -z "$email_pw" ]; then
                cgi_error "missing_password" "App password is required when email alerts are enabled"
                exit 0
            fi
        fi

        # --- Routing cells. Never `//` on a boolean (drops false); use the
        # --- null-safe form, then coerce to a strict "true"/"false" token. ---
        r_cl_sms=$(printf '%s' "$POST_DATA" | jq -r '(.routing.events.connection_lost.sms)         | (if . == null then true else . end) | if . == true then "true" else "false" end')
        r_cr_sms=$(printf '%s' "$POST_DATA" | jq -r '(.routing.events.connection_restored.sms)     | (if . == null then true else . end) | if . == true then "true" else "false" end')
        r_cr_email=$(printf '%s' "$POST_DATA" | jq -r '(.routing.events.connection_restored.email) | (if . == null then true else . end) | if . == true then "true" else "false" end')
        # CLAMP: connection_lost.email is always false — email cannot deliver
        # during an outage (no internet/DNS). Server is authoritative.
        r_cl_email="false"

        mkdir -p /etc/qmanager

        # --- Write SMS config (shape preserved for Config Backup's strict gate) ---
        if ! printf '%s' "$POST_DATA" | jq -n \
                --argjson enabled "$sms_enabled" \
                --arg phone "$sms_phone" \
                --argjson thr "$sms_thr" \
                '{enabled: $enabled, recipient_phone: $phone, threshold_minutes: $thr}' \
                | _write_json_atomic "$SMS_CONFIG"; then
            cgi_error "write_failed" "Failed to write SMS alert config"
            exit 0
        fi

        # --- Write email config (shape preserved) ---
        if ! jq -n \
                --argjson enabled "$email_enabled" \
                --arg sender "$email_sender" \
                --arg recipient "$email_recipient" \
                --arg password "$email_pw" \
                --argjson thr "$email_thr" \
                '{enabled: $enabled, sender_email: $sender, recipient_email: $recipient, app_password: $password, threshold_minutes: $thr}' \
                | _write_json_atomic "$EMAIL_CONFIG"; then
            cgi_error "write_failed" "Failed to write email alert config"
            exit 0
        fi

        # --- Write routing config (new additive file) ---
        if ! jq -n \
                --argjson cl_sms "$r_cl_sms" \
                --argjson cl_email "$r_cl_email" \
                --argjson cr_sms "$r_cr_sms" \
                --argjson cr_email "$r_cr_email" \
                '{version: 1, events: {
                    connection_lost:     {sms: $cl_sms, email: $cl_email},
                    connection_restored: {sms: $cr_sms, email: $cr_email}
                }}' \
                | _write_json_atomic "/etc/qmanager/alert_routing.json"; then
            cgi_error "write_failed" "Failed to write alert routing config"
            exit 0
        fi

        # --- Regenerate msmtprc when email creds are present ---
        if [ -n "$email_sender" ] && [ -n "$email_pw" ]; then
            cat > "$MSMTP_CONFIG" <<MSMTPEOF
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /tmp/msmtp.log

account        default
host           smtp.gmail.com
port           587
from           ${email_sender}
user           ${email_sender}
password       ${email_pw}
MSMTPEOF
            chmod 600 "$MSMTP_CONFIG"
            qlog_info "msmtp config regenerated at $MSMTP_CONFIG"
        fi

        # --- Signal poller: reload channel configs + routing next cycle ---
        touch /tmp/qmanager_sms_reload /tmp/qmanager_email_reload /tmp/qmanager_alert_routing_reload

        qlog_info "Alert settings saved: sms_enabled=$sms_enabled email_enabled=$email_enabled routing(cl:sms=$r_cl_sms,email=$r_cl_email cr:sms=$r_cr_sms,email=$r_cr_email)"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # send_test — {channel: "sms" | "email"}
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "send_test" ]; then
        CHANNEL=$(printf '%s' "$POST_DATA" | jq -r '.channel // empty')

        case "$CHANNEL" in
            sms)
                qlog_info "Sending test SMS"
                . /usr/lib/qmanager/sms_alerts.sh 2>/dev/null || {
                    cgi_error "library_missing" "SMS alerts library not found"
                    exit 0
                }
                _sa_read_config
                if [ "$_sa_enabled" != "true" ]; then
                    cgi_error "not_configured" "SMS alerts must be enabled and fully configured before sending a test"
                    exit 0
                fi
                # CGI has no poller registration globals; a user-initiated test
                # should always attempt delivery.
                _sa_is_registered() { return 0; }
                if _sa_send_test_sms; then
                    cgi_success
                else
                    cgi_error "send_failed" "sms_tool send failed — check logread for details"
                fi
                exit 0
                ;;
            email)
                qlog_info "Sending test email"
                . /usr/lib/qmanager/email_alerts.sh 2>/dev/null || {
                    cgi_error "library_missing" "Email alerts library not found"
                    exit 0
                }
                _ea_read_config
                if [ "$_ea_enabled" != "true" ]; then
                    cgi_error "not_configured" "Email alerts must be enabled and fully configured before sending a test"
                    exit 0
                fi
                if [ ! -f "$MSMTP_CONFIG" ]; then
                    cgi_error "msmtp_missing" "Save settings first to generate msmtp configuration"
                    exit 0
                fi
                if _ea_send_test_email; then
                    cgi_success
                else
                    cgi_error "send_failed" "Failed to send test email. Check msmtp configuration and network connectivity."
                fi
                exit 0
                ;;
            *)
                cgi_error "invalid_channel" "channel must be 'sms' or 'email'"
                exit 0
                ;;
        esac
    fi

    # -------------------------------------------------------------------------
    # install — install msmtp via opkg (background)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install" ]; then
        if [ -f "$MSMTP_INSTALL_PID" ] && kill -0 "$(cat "$MSMTP_INSTALL_PID" 2>/dev/null)" 2>/dev/null; then
            cgi_error "already_running" "Installation already in progress"
            exit 0
        fi
        if command -v msmtp >/dev/null 2>&1; then
            cgi_error "already_installed" "msmtp is already installed"
            exit 0
        fi

        qlog_info "Starting msmtp installation via opkg"

        (
            echo $$ > "$MSMTP_INSTALL_PID"
            trap 'rm -f "$MSMTP_INSTALL_PID"' EXIT

            printf '{"success":true,"status":"running","message":"Updating package lists..."}' > "$MSMTP_INSTALL_RESULT"
            if ! opkg update >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"Failed to update package lists","detail":"Check internet connection and opkg feeds"}' > "$MSMTP_INSTALL_RESULT"
                exit 1
            fi

            printf '{"success":true,"status":"running","message":"Installing msmtp..."}' > "$MSMTP_INSTALL_RESULT"
            if ! opkg install msmtp >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"opkg install failed","detail":"Package may not be available for this architecture"}' > "$MSMTP_INSTALL_RESULT"
                exit 1
            fi

            if command -v msmtp >/dev/null 2>&1; then
                printf '{"success":true,"status":"complete","message":"msmtp installed successfully"}' > "$MSMTP_INSTALL_RESULT"
            else
                printf '{"success":false,"status":"error","message":"Package installed but binary not found"}' > "$MSMTP_INSTALL_RESULT"
            fi
        ) </dev/null >/dev/null 2>&1 &

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # install_status — poll install progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        if [ -f "$MSMTP_INSTALL_RESULT" ]; then
            cat "$MSMTP_INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # uninstall — remove msmtp (refused while email alerts still enabled)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "uninstall" ]; then
        if [ -f "$EMAIL_CONFIG" ]; then
            ea_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$EMAIL_CONFIG" 2>/dev/null)
            if [ "$ea_enabled" = "true" ]; then
                cgi_error "still_enabled" "Disable email alerts before uninstalling msmtp"
                exit 0
            fi
        fi

        qlog_info "Uninstalling msmtp package"
        opkg remove msmtp 2>/dev/null
        rm -f "$MSMTP_CONFIG"

        if command -v msmtp >/dev/null 2>&1; then
            qlog_error "msmtp binary still present after opkg remove"
            cgi_error "uninstall_failed" "Failed to remove msmtp package"
            exit 0
        fi

        qlog_info "msmtp uninstalled successfully"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # get_log — merged sms + email logs, channel-tagged, newest 100
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "get_log" ]; then
        sms_arr="[]"
        if [ -f "$SMS_LOG" ] && [ -s "$SMS_LOG" ]; then
            sms_arr=$(jq -s '[ .[] | (. + {channel: "sms"}) ]' "$SMS_LOG" 2>/dev/null) || sms_arr="[]"
        fi
        [ -z "$sms_arr" ] && sms_arr="[]"

        email_arr="[]"
        if [ -f "$EMAIL_LOG" ] && [ -s "$EMAIL_LOG" ]; then
            email_arr=$(jq -s '[ .[] | (. + {channel: "email"}) ]' "$EMAIL_LOG" 2>/dev/null) || email_arr="[]"
        fi
        [ -z "$email_arr" ] && email_arr="[]"

        # timestamp is "%Y-%m-%d %H:%M:%S" — lexical sort == chronological.
        jq -n --argjson sms "$sms_arr" --argjson email "$email_arr" \
            '($sms + $email) | sort_by(.timestamp) | reverse | .[0:100] as $capped
             | {success: true, entries: $capped, total: ($capped | length)}'
        exit 0
    fi

    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

cgi_error "method_not_allowed" "Only GET and POST are supported"
