#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# clear-log.sh — CGI Endpoint: Clear Upload History (POST only)
# =============================================================================
# Deletes all rows from the archive (upload history) table, permanently
# clearing the record of past upload batches.
#
# This does NOT touch the pending measurement buffer — use purge.sh for that.
#
# POST body: none required
#
# Response on success:
#   {"success":true,"cleared_count":142}
# Response when DB unavailable:
#   {"success":true,"cleared_count":0}  (nothing to clear)
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/clear-log.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/clear-log.sh
# =============================================================================

qlog_init "cgi_cellmapper_clear_log"
cgi_headers
cgi_handle_options

CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- Enforce POST only -------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

qlog_info "Upload history clear requested"

# --- Check dependencies ------------------------------------------------------
if ! command -v sqlite3 >/dev/null 2>&1; then
    qlog_warn "sqlite3 not available, nothing to clear"
    jq -n '{"success":true,"cleared_count":0}'
    exit 0
fi

# --- Ensure DB is initialised ------------------------------------------------
. /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null
cm_db_init >/dev/null 2>&1

if [ ! -f "$CM_DB_PATH" ]; then
    qlog_info "Database not yet created, nothing to clear"
    jq -n '{"success":true,"cleared_count":0}'
    exit 0
fi

# --- Count before clearing ---------------------------------------------------
count_before=$(sqlite3 "$CM_DB_PATH" "SELECT COUNT(*) FROM archive;" 2>/dev/null)
[ -z "$count_before" ] && count_before=0

qlog_info "Clearing $count_before upload history entries"

# --- Delete all archive rows -------------------------------------------------
sqlite3 "$CM_DB_PATH" "DELETE FROM archive;" 2>/dev/null

qlog_info "Upload history cleared: $count_before rows removed"

jq -n --argjson count "$count_before" '{"success":true,"cleared_count":$count}'
