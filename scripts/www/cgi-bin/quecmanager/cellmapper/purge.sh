#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# purge.sh — CGI Endpoint: Clear Pending Buffer (POST only)
# =============================================================================
# Empties the pending measurement queue, discarding all measurements that have
# not yet been uploaded.  This is a destructive, irreversible action.
#
# Does NOT touch the archive (upload history) table — use clear-log.sh for
# that.  After deleting all rows, VACUUM is run to reclaim disk space.
#
# POST body: none required
#
# Response on success:
#   {"success":true,"purged_count":342}
# Response when DB unavailable:
#   {"success":true,"purged_count":0}  (nothing to purge)
#
# Endpoint: POST /cgi-bin/quecmanager/cellmapper/purge.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/purge.sh
# =============================================================================

qlog_init "cgi_cellmapper_purge"
cgi_headers
cgi_handle_options

CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- Enforce POST only -------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

qlog_info "Buffer purge requested"

# --- Check dependencies ------------------------------------------------------
if ! command -v sqlite3 >/dev/null 2>&1; then
    qlog_warn "sqlite3 not available, nothing to purge"
    jq -n '{"success":true,"purged_count":0}'
    exit 0
fi

# --- Ensure DB is initialised ------------------------------------------------
. /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null
cm_db_init >/dev/null 2>&1

if [ ! -f "$CM_DB_PATH" ]; then
    qlog_info "Database not yet created, nothing to purge"
    jq -n '{"success":true,"purged_count":0}'
    exit 0
fi

# --- Count before purge ------------------------------------------------------
count_before=$(cm_db_count_pending 2>/dev/null)
[ -z "$count_before" ] && count_before=0

qlog_info "Purging $count_before pending measurements"

# --- Delete all pending rows and reclaim space -------------------------------
sqlite3 "$CM_DB_PATH" "DELETE FROM pending; VACUUM;" 2>/dev/null

qlog_info "Buffer purged: $count_before rows removed"

jq -n --argjson count "$count_before" '{"success":true,"purged_count":$count}'
