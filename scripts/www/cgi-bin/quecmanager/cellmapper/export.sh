#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# export.sh — CGI Endpoint: CSV Export (GET only)
# =============================================================================
# Exports the pending buffer or upload history as a CSV file download.
# The response Content-Type is text/csv with a Content-Disposition header
# that prompts the browser to save the file.
#
# IMPORTANT: cgi_headers is NOT called at startup (it would emit
# application/json headers).  Headers are set manually based on the target.
# cgi_headers IS called before JSON error responses in validation failures.
#
# Query parameters:
#   target  "buffer" | "log"  (required)
#
# CSV columns:
#   buffer: id, captured_at, type, MCC, MNC, CID, signal, latitude,
#           longitude, altitude, ARFCN, provider
#   log:    id, uploaded_at, batch_id, point_count, endpoint, size_bytes,
#           latency_ms, status, error_msg
#
# Endpoint: GET /cgi-bin/quecmanager/cellmapper/export.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/export.sh
# =============================================================================

qlog_init "cgi_cellmapper_export"
# NOTE: cgi_headers intentionally omitted here — CSV headers are set below.
cgi_handle_options

CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- Helper: emit a JSON error (call cgi_headers first for correct MIME type)
json_error() {
    local code="$1" msg="$2"
    cgi_headers
    jq -n --arg code "$code" --arg msg "$msg" \
        '{"success":false,"error":$code,"message":$msg}'
}

# --- Enforce GET only --------------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ]; then
    json_error "method_not_allowed" "Use GET"
    exit 0
fi

# --- Parse and validate target ----------------------------------------------
target=$(echo "$QUERY_STRING" | sed -n 's/.*target=\([a-z_A-Z]*\).*/\1/p')

case "$target" in
    buffer|log) ;;
    *)
        json_error "invalid_param" "target must be 'buffer' or 'log'"
        exit 0
        ;;
esac

qlog_info "CSV export requested: target=$target"

# --- Check dependencies ------------------------------------------------------
if ! command -v sqlite3 >/dev/null 2>&1; then
    qlog_warn "sqlite3 not available"
    json_error "service_unavailable" "sqlite3 not available on this system"
    exit 0
fi

# --- Ensure DB is initialised ------------------------------------------------
. /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null
cm_db_init >/dev/null 2>&1

if [ ! -f "$CM_DB_PATH" ]; then
    qlog_info "Database not yet created, exporting empty CSV"
    # Fall through — we will emit headers + just the column row
fi

# --- Build filename with timestamp ------------------------------------------
timestamp=$(date +%Y%m%d_%H%M%S)
filename="cellmapper_${target}_${timestamp}.csv"

# --- Emit CSV headers --------------------------------------------------------
printf 'Content-Type: text/csv\r\n'
printf 'Content-Disposition: attachment; filename="%s"\r\n' "$filename"
printf 'Cache-Control: no-cache\r\n'
printf '\r\n'

# =============================================================================
# Export: buffer (pending table)
# =============================================================================
if [ "$target" = "buffer" ]; then
    printf 'id,captured_at,type,MCC,MNC,CID,signal,latitude,longitude,altitude,ARFCN,provider\n'

    if [ ! -f "$CM_DB_PATH" ]; then
        exit 0
    fi

    # Query all pending rows, then extract payload fields via jq
    sqlite3 -json "$CM_DB_PATH" \
        "SELECT id, captured_at, payload FROM pending ORDER BY captured_at ASC;" \
        2>/dev/null | \
    jq -r '.[] |
        (.payload | if type == "string" then fromjson? // {} else . end) as $p |
        [
            .id,
            .captured_at,
            ($p.type      // ""),
            ($p.MCC       // ""),
            ($p.MNC       // ""),
            ($p.CID       // ""),
            ($p.signal    // ""),
            ($p.latitude  // ""),
            ($p.longitude // ""),
            ($p.altitude  // ""),
            ($p.ARFCN     // ""),
            ($p.provider  // "")
        ] | @csv
    ' 2>/dev/null

    qlog_info "Buffer CSV export complete"
    exit 0
fi

# =============================================================================
# Export: log (archive table)
# =============================================================================
if [ "$target" = "log" ]; then
    printf 'id,uploaded_at,batch_id,point_count,endpoint,size_bytes,latency_ms,status,error_msg\n'

    if [ ! -f "$CM_DB_PATH" ]; then
        exit 0
    fi

    # Query archive rows; use jq @csv so error_msg commas/quotes are handled
    sqlite3 -json "$CM_DB_PATH" \
        "SELECT id, uploaded_at, batch_id, point_count, endpoint, size_bytes,
                latency_ms, status, error_msg
         FROM archive
         ORDER BY uploaded_at ASC;" \
        2>/dev/null | \
    jq -r '.[] |
        [
            .id,
            .uploaded_at,
            (.batch_id    // ""),
            (.point_count // ""),
            (.endpoint    // ""),
            (.size_bytes  // ""),
            (.latency_ms  // ""),
            (.status      // ""),
            (.error_msg   // "")
        ] | @csv
    ' 2>/dev/null

    qlog_info "Log CSV export complete"
    exit 0
fi
