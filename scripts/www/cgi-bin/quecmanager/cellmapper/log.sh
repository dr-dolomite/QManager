#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# log.sh — CGI Endpoint: Upload History (GET only, paginated)
# =============================================================================
# Returns a paginated list of completed upload records from the archive table.
# Each entry represents one batch that was successfully (or unsuccessfully)
# sent to the CellMapper endpoint, along with metadata: batch ID, point count,
# size, latency, status, and any error message.
#
# Query parameters:
#   page  (int, default 1)   — 1-based page number
#   limit (int, default 20, max 100) — records per page
#
# Response:
#   {
#     "success": true,
#     "pagination": { "page": 1, "limit": 20, "total": 142, "pages": 8 },
#     "entries": [
#       {
#         "id": 1,
#         "uploaded_at": 1777090510,
#         "batch_id": "abc123",
#         "point_count": 50,
#         "endpoint": "cellmapper",
#         "size_bytes": 12400,
#         "latency_ms": 150,
#         "status": "ok",
#         "error_msg": null
#       }
#     ]
#   }
#
# Endpoint: GET /cgi-bin/quecmanager/cellmapper/log.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/log.sh
# =============================================================================

qlog_init "cgi_cellmapper_log"
cgi_headers
cgi_handle_options

CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- Enforce GET only --------------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_error "method_not_allowed" "Use GET"
    exit 0
fi

# --- Parse pagination params from QUERY_STRING -------------------------------
page=$(echo "$QUERY_STRING" | sed -n 's/.*page=\([0-9]*\).*/\1/p')
[ -z "$page" ] && page=1
limit=$(echo "$QUERY_STRING" | sed -n 's/.*limit=\([0-9]*\).*/\1/p')
[ -z "$limit" ] && limit=20
[ "$limit" -gt 100 ] && limit=100

# Clamp page to at least 1
[ "$page" -lt 1 ] 2>/dev/null && page=1

offset=$(( (page - 1) * limit ))

qlog_info "Upload log requested: page=$page limit=$limit offset=$offset"

# --- Check dependencies ------------------------------------------------------
if ! command -v sqlite3 >/dev/null 2>&1; then
    qlog_warn "sqlite3 not available, returning empty log"
    jq -n \
        --argjson page  "$page" \
        --argjson limit "$limit" \
        '{
            success:    true,
            pagination: { page: $page, limit: $limit, total: 0, pages: 0 },
            entries:    []
        }'
    exit 0
fi

# --- Ensure DB is initialised (may be empty / not yet created) ---------------
. /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null
cm_db_init >/dev/null 2>&1

if [ ! -f "$CM_DB_PATH" ]; then
    qlog_info "Database not yet created, returning empty log"
    jq -n \
        --argjson page  "$page" \
        --argjson limit "$limit" \
        '{
            success:    true,
            pagination: { page: $page, limit: $limit, total: 0, pages: 0 },
            entries:    []
        }'
    exit 0
fi

# --- Count total records in archive -----------------------------------------
total=$(sqlite3 "$CM_DB_PATH" "SELECT COUNT(*) FROM archive;" 2>/dev/null)
[ -z "$total" ] && total=0

# Calculate total pages (ceiling division)
if [ "$total" -eq 0 ] || [ "$limit" -eq 0 ]; then
    pages=0
else
    pages=$(( (total + limit - 1) / limit ))
fi

# --- Query paginated archive rows -------------------------------------------
# sqlite3 -json returns [] for empty results
entries_json=$(sqlite3 -json "$CM_DB_PATH" \
    "SELECT
        id,
        uploaded_at,
        batch_id,
        point_count,
        endpoint,
        size_bytes,
        latency_ms,
        status,
        error_msg
     FROM archive
     ORDER BY uploaded_at DESC
     LIMIT $limit OFFSET $offset;" 2>/dev/null)

# Fallback to empty array on error or no results
[ -z "$entries_json" ] && entries_json="[]"

# sqlite3 -json may return NULL for error_msg; jq processes it as JSON null
# which is correct. Normalise any string "null" → JSON null in error_msg.
entries_json=$(printf '%s' "$entries_json" | jq 'map(
    if .error_msg == "" then .error_msg = null else . end
)' 2>/dev/null)
[ -z "$entries_json" ] && entries_json="[]"

qlog_info "Returning $total archive entries (page $page of $pages)"

# --- Build response ----------------------------------------------------------
jq -n \
    --argjson page    "$page" \
    --argjson limit   "$limit" \
    --argjson total   "$total" \
    --argjson pages   "$pages" \
    --argjson entries "$entries_json" \
    '{
        success:    true,
        pagination: {
            page:  $page,
            limit: $limit,
            total: $total,
            pages: $pages
        },
        entries: $entries
    }'
