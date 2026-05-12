#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# buffer.sh — CGI Endpoint: Pending Measurements (GET only, paginated)
# =============================================================================
# Returns queued measurements in the pending table that are awaiting upload.
# Each entry includes a summary of key fields extracted from the stored payload
# JSON (type, MCC, MNC, CID, signal, latitude, longitude).
#
# Also returns aggregate stats: total pending count, total buffer size, and
# the timestamps of the oldest and newest queued measurements.
#
# Query parameters:
#   page  (int, default 1)   — 1-based page number
#   limit (int, default 20, max 100) — records per page
#
# Response:
#   {
#     "success": true,
#     "pagination": { "page": 1, "limit": 20, "total": 342, "pages": 18 },
#     "stats": {
#       "total_pending": 342,
#       "total_size_bytes": 171000,
#       "oldest_ts": 1777088000,
#       "newest_ts": 1777090510
#     },
#     "entries": [
#       {
#         "id": 1,
#         "captured_at": 1777090510,
#         "size_bytes": 500,
#         "summary": {
#           "type": "LTE", "MCC": 310, "MNC": 410,
#           "CID": 46957498, "signal": -112,
#           "latitude": 32.158, "longitude": -95.281
#         }
#       }
#     ]
#   }
#
# Endpoint: GET /cgi-bin/quecmanager/cellmapper/buffer.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/buffer.sh
# =============================================================================

qlog_init "cgi_cellmapper_buffer"
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

[ "$page" -lt 1 ] 2>/dev/null && page=1

offset=$(( (page - 1) * limit ))

qlog_info "Buffer requested: page=$page limit=$limit offset=$offset"

# --- Helper: emit empty response with zero stats ----------------------------
emit_empty() {
    jq -n \
        --argjson page  "$page" \
        --argjson limit "$limit" \
        '{
            success:    true,
            pagination: { page: $page, limit: $limit, total: 0, pages: 0 },
            stats: {
                total_pending:    0,
                total_size_bytes: 0,
                oldest_ts:        null,
                newest_ts:        null
            },
            entries: []
        }'
}

# --- Check dependencies ------------------------------------------------------
if ! command -v sqlite3 >/dev/null 2>&1; then
    qlog_warn "sqlite3 not available, returning empty buffer"
    emit_empty
    exit 0
fi

# --- Ensure DB is initialised ------------------------------------------------
. /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null
cm_db_init >/dev/null 2>&1

if [ ! -f "$CM_DB_PATH" ]; then
    qlog_info "Database not yet created, returning empty buffer"
    emit_empty
    exit 0
fi

# --- Aggregate stats (total count, size, oldest/newest) ---------------------
total=$(cm_db_count_pending 2>/dev/null)
[ -z "$total" ] && total=0

total_size=$(cm_db_size_pending 2>/dev/null)
[ -z "$total_size" ] && total_size=0

# oldest / newest captured_at — handle empty table gracefully
oldest_raw=$(sqlite3 "$CM_DB_PATH" "SELECT MIN(captured_at) FROM pending;" 2>/dev/null)
newest_raw=$(sqlite3 "$CM_DB_PATH" "SELECT MAX(captured_at) FROM pending;" 2>/dev/null)

# Normalise empty/"" / "NULL" → JSON null literal; numbers pass through
case "$oldest_raw" in
    ''|NULL) oldest_ts="null" ;;
    *)       oldest_ts="$oldest_raw" ;;
esac
case "$newest_raw" in
    ''|NULL) newest_ts="null" ;;
    *)       newest_ts="$newest_raw" ;;
esac

# --- Calculate pagination ----------------------------------------------------
if [ "$total" -eq 0 ] || [ "$limit" -eq 0 ]; then
    pages=0
else
    pages=$(( (total + limit - 1) / limit ))
fi

# --- Query pending rows for current page ------------------------------------
# sqlite3 -json returns a JSON array; each row has id, captured_at, size_bytes,
# payload.  We post-process with jq to extract a summary from payload.
raw_rows=$(sqlite3 -json "$CM_DB_PATH" \
    "SELECT id, captured_at, size_bytes, payload
     FROM pending
     ORDER BY captured_at DESC
     LIMIT $limit OFFSET $offset;" 2>/dev/null)

[ -z "$raw_rows" ] && raw_rows="[]"

# --- Build entries: extract summary fields from payload JSON ----------------
# payload is stored as a JSON string; jq parses it inside the map.
# Fields are best-effort; null is used for any that are missing.
entries_json=$(printf '%s' "$raw_rows" | jq 'map({
    id:          .id,
    captured_at: .captured_at,
    size_bytes:  .size_bytes,
    summary: (
        (.payload | if type == "string" then fromjson? // {} else . end) as $p |
        {
            type:      ($p.type      // null),
            MCC:       ($p.MCC       // null),
            MNC:       ($p.MNC       // null),
            CID:       ($p.CID       // null),
            signal:    ($p.signal    // null),
            latitude:  ($p.latitude  // null),
            longitude: ($p.longitude // null)
        }
    )
})' 2>/dev/null)
[ -z "$entries_json" ] && entries_json="[]"

qlog_info "Buffer: total=$total size=$total_size pages=$pages"

# --- Build final response ---------------------------------------------------
jq -n \
    --argjson page       "$page" \
    --argjson limit      "$limit" \
    --argjson total      "$total" \
    --argjson pages      "$pages" \
    --argjson tot_size   "$total_size" \
    --argjson oldest     "$oldest_ts" \
    --argjson newest     "$newest_ts" \
    --argjson entries    "$entries_json" \
    '{
        success:    true,
        pagination: {
            page:  $page,
            limit: $limit,
            total: $total,
            pages: $pages
        },
        stats: {
            total_pending:    $total,
            total_size_bytes: $tot_size,
            oldest_ts:        $oldest,
            newest_ts:        $newest
        },
        entries: $entries
    }'
