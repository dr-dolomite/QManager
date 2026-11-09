#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# log_debug.sh — CGI Endpoint: journal debug lease (GET + POST)
# =============================================================================
# A debug lease makes qmanager_logd keep DEBUG rows and makes the shell
# writers' qlog_debug write, for 30 minutes. The lease is one file,
# /var/run/qmanager/journal/debug, holding the expiry as whole seconds of
# /proc/uptime (monotonic, so a wall-clock step cannot extend or cut it). logd
# removes the file on expiry; this CGI only writes or deletes it.
#
# Auth: enforced at source time by cgi_base.sh (require_auth).
#
# GET  -> {"success":true,"active":bool,"expires_in":<s>,"available":bool}
#         available = logd's capability file exists (/var/run/qmanager_logd.proto)
# POST {"enable":true|false}
#      -> same shape as GET, read back after the write
# Errors: invalid_body (enable missing or not a boolean) | unavailable (no
#         journal directory, or the safe-write library is missing) |
#         write_failed | method_not_allowed
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/log_debug.sh
# Install location: /www/cgi-bin/quecmanager/system/log_debug.sh
# Doc: docs/reference/logs.md
# =============================================================================

qlog_init "cgi_log_debug"
cgi_headers
cgi_handle_options

[ -f /usr/lib/qmanager/safe_tmp.sh ] && . /usr/lib/qmanager/safe_tmp.sh

JOURNAL_DIR="/var/run/qmanager/journal"
LEASE_FILE="$JOURNAL_DIR/debug"
LOGD_PROTO="/var/run/qmanager_logd.proto"
LEASE_SECS=1800

# Whole seconds of /proc/uptime (builtin read, no fork).
uptime_secs() {
    local up
    local rest
    read -r up rest < /proc/uptime 2>/dev/null
    up="${up%%.*}"
    case "$up" in
        ''|*[!0-9]*) up=0 ;;
    esac
    printf '%s' "$up"
}

emit_state() {
    local now
    local exp=""
    local active=false
    local left=0
    local avail=false

    [ -e "$LOGD_PROTO" ] && avail=true
    now=$(uptime_secs)
    { read -r exp < "$LEASE_FILE"; } 2>/dev/null
    exp="${exp%%[!0-9]*}"
    if [ -f "$LEASE_FILE" ]; then
        # An unparsable file is still a live lease: logd treats it as
        # first-seen + 1800 s.
        if [ -n "$exp" ]; then
            if [ "$exp" -gt "$now" ]; then
                active=true
                left=$((exp - now))
            fi
        else
            active=true
        fi
    fi
    jq -n --argjson active "$active" --argjson left "$left" --argjson avail "$avail" \
        '{success:true, active:$active, expires_in:$left, available:$avail}'
}

# The journal dir must be a real root-owned directory: a symlink there would
# let the rename land somewhere else.
journal_dir_ok() {
    [ -d "$JOURNAL_DIR" ] || return 1
    command -v qm_owned_by_root >/dev/null 2>&1 || return 1
    qm_owned_by_root "$JOURNAL_DIR"
}

if [ "$REQUEST_METHOD" = "GET" ]; then
    emit_state
    exit 0
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    enable=$(printf '%s' "$POST_DATA" | jq -r \
        'if (.enable | type) == "boolean" then (.enable | tostring) else "" end' 2>/dev/null)

    case "$enable" in
        true)
            if ! journal_dir_ok || ! command -v qm_atomic_write >/dev/null 2>&1; then
                cgi_error "unavailable" "Journal is not running"
                exit 0
            fi
            expiry=$(( $(uptime_secs) + LEASE_SECS ))
            if ! printf '%s\n' "$expiry" | qm_atomic_write "$LEASE_FILE" 0644; then
                qlog_error "Debug lease write failed"
                cgi_error "write_failed" "Could not write the debug lease"
                exit 0
            fi
            qlog_info "Debug logging lease enabled for ${LEASE_SECS}s"
            ;;
        false)
            if [ -e "$LEASE_FILE" ] || [ -L "$LEASE_FILE" ]; then
                rm -f "$LEASE_FILE" 2>/dev/null
                qlog_info "Debug logging lease disabled"
            fi
            ;;
        *)
            cgi_error "invalid_body" "enable must be true or false"
            exit 0
            ;;
    esac
    emit_state
    exit 0
fi

cgi_method_not_allowed
