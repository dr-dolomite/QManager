#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# control.sh — CGI Endpoint: CellMapper Collector Control (POST only)
# =============================================================================
# Handles pause/resume/restart actions for the CellMapper collector daemon.
#
# POST body (JSON):
#   { "action": "pause" }    — Pause collection (writes flag file)
#   { "action": "resume" }   — Resume collection (removes flag file)
#   { "action": "restart" }  — Restart the collector service
#
# Response: { "success": true, "action": "<action>", "message": "..." }
# Error:    { "success": false, "error": "<code>", "detail": "..." }
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/control.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/control.sh
# =============================================================================

qlog_init "cgi_cellmapper_control"
cgi_headers
cgi_handle_options

CM_PAUSE_FLAG="/tmp/qmanager_cellmapper_pause"

# --- Enforce POST only --------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read and parse JSON body -------------------------------------------------
POST_DATA=$(cat)
if [ -z "$POST_DATA" ]; then
    cgi_error "bad_request" "Missing JSON body"
    exit 0
fi

ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)

if [ -z "$ACTION" ]; then
    cgi_error "bad_request" "Missing required field: action"
    exit 0
fi

# --- Dispatch action ----------------------------------------------------------
case "$ACTION" in
    pause)
        if [ -f "$CM_PAUSE_FLAG" ]; then
            jq -n '{"success":true,"action":"pause","message":"Collection is already paused"}'
        else
            touch "$CM_PAUSE_FLAG" 2>/dev/null
            if [ -f "$CM_PAUSE_FLAG" ]; then
                qlog_info "control: collection paused by user"
                jq -n '{"success":true,"action":"pause","message":"Collection paused"}'
            else
                cgi_error "internal_error" "Failed to write pause flag"
            fi
        fi
        ;;

    resume)
        if [ ! -f "$CM_PAUSE_FLAG" ]; then
            jq -n '{"success":true,"action":"resume","message":"Collection is already running"}'
        else
            rm -f "$CM_PAUSE_FLAG" 2>/dev/null
            if [ ! -f "$CM_PAUSE_FLAG" ]; then
                qlog_info "control: collection resumed by user"
                jq -n '{"success":true,"action":"resume","message":"Collection resumed"}'
            else
                cgi_error "internal_error" "Failed to remove pause flag"
            fi
        fi
        ;;

    restart)
        qlog_info "control: collector restart requested by user"
        # Remove pause flag on restart so the collector starts in running state
        rm -f "$CM_PAUSE_FLAG" 2>/dev/null
        # Restart the service in background so the CGI response returns immediately
        /etc/init.d/qmanager_cellmapper restart >/dev/null 2>&1 &
        jq -n '{"success":true,"action":"restart","message":"Collector restarting"}'
        ;;

    *)
        cgi_error "bad_request" "Unknown action: $ACTION. Valid actions: pause, resume, restart"
        ;;
esac
