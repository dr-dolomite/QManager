#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# upload.sh — CGI Endpoint: Trigger Immediate Upload Flush (POST only)
# =============================================================================
# Signals the CellMapper uploader daemon to drain the pending queue
# immediately, without waiting for the next scheduled upload interval.
# Creates a signal file at /tmp/qmanager_cm_flush that the daemon polls.
#
# This is a fire-and-forget signal — the daemon may be mid-cycle or sleeping;
# it will pick up the flag on its next iteration.
#
# POST body: none required
#
# Response on success:
#   {"success":true,"message":"Upload flush triggered"}
# Response on failure:
#   {"success":false,"error":"signal_failed","message":"..."}
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/upload.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/upload.sh
# =============================================================================

qlog_init "cgi_cellmapper_upload"
cgi_headers
cgi_handle_options

CM_FLUSH_FLAG="/tmp/qmanager_cm_flush"

# --- Enforce POST only -------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

qlog_info "Upload flush requested"

# --- Touch the flush signal file ---------------------------------------------
if ! touch "$CM_FLUSH_FLAG" 2>/dev/null; then
    qlog_warn "Failed to create flush signal file: $CM_FLUSH_FLAG"
    jq -n '{
        "success":  false,
        "error":    "signal_failed",
        "message":  "Could not create flush signal file"
    }'
    exit 0
fi

qlog_info "Flush signal created: $CM_FLUSH_FLAG"
jq -n '{"success":true,"message":"Upload flush triggered"}'
