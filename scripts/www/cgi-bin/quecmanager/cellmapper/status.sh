#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# status.sh — CGI Endpoint: CellMapper Service Status (GET only)
# =============================================================================
# Returns a comprehensive snapshot of the CellMapper integration state,
# including service health, account linkage, GPS source, buffer stats,
# adapter detection, and recent errors.
#
# Reads from:
#   - UCI quecmanager.cellmapper.* (config)
#   - /overlay/cellmapper/hash (account linkage)
#   - /tmp/qmanager_cellmapper.json (runtime state from collector daemon)
#   - /overlay/cellmapper/queue.db (SQLite buffer stats, via cellmapper_db.sh)
#
# Response: See JSON structure in source below.
#
# Endpoint: GET /cgi-bin/quecmanager/cellmapper/status.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/status.sh
# =============================================================================

qlog_init "cgi_cellmapper_status"
cgi_headers
cgi_handle_options

CM_HASH_FILE="/overlay/cellmapper/hash"
CM_STATE_FILE="/tmp/qmanager_cellmapper.json"
CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- Enforce GET only --------------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_error "method_not_allowed" "Use GET"
    exit 0
fi

qlog_info "CellMapper status requested"

# --- Load UCI config library and ensure defaults exist ----------------------
. /usr/lib/qmanager/cellmapper_uci.sh 2>/dev/null
ensure_cellmapper_config

# --- Read UCI values ---------------------------------------------------------
cm_enabled=$(cm_uci_get enabled 0)
cm_gps_source=$(cm_uci_get gps_source modem)
cm_username=$(cm_uci_get username "")
cm_linked_at=$(cm_uci_get linked_at "")

# Convert numeric 0/1 enabled to boolean string for jq
if [ "$cm_enabled" = "1" ]; then
    svc_enabled="true"
else
    svc_enabled="false"
fi

# --- Check account linkage ---------------------------------------------------
cm_linked="false"
if [ -f "$CM_HASH_FILE" ] && [ -s "$CM_HASH_FILE" ]; then
    cm_linked="true"
fi

# --- Read runtime state from collector daemon --------------------------------
CM_UPLOADER_STATE_FILE="/tmp/qmanager_cm_uploader.json"

# Defaults if state files are absent or malformed
collector_state="stopped"
uploader_state="idle"
consecutive_failures=0
uploader_needs_reauth="false"
last_measurement="null"
last_upload="null"
gps_fix="null"
errors_json="[]"

if [ -f "$CM_STATE_FILE" ] && [ -s "$CM_STATE_FILE" ]; then
    # Extract fields with safe fallbacks — field names match collector daemon output
    collector_state=$(jq -r '.state // "stopped"' "$CM_STATE_FILE" 2>/dev/null)
    [ -z "$collector_state" ] && collector_state="stopped"

    # last_measurement — read directly from collector state file.
    # The collector writes this field with {type, provider, band, signal, timestamp}.
    last_measurement=$(jq -c '.last_measurement // null' "$CM_STATE_FILE" 2>/dev/null)
    [ -z "$last_measurement" ] && last_measurement="null"

    # GPS fix from collector state — transform to frontend schema (includes type + hdop)
    gps_fix=$(jq -c '
        .last_gps_fix // null |
        if . then
            {type: (.type // "none"), lat: .lat, lon: .lon, alt: .alt,
             sats: .sats, speed_kmh: .speed_kmh, hdop: (.hdop // 99)}
        else null end
    ' "$CM_STATE_FILE" 2>/dev/null)
    [ -z "$gps_fix" ] && gps_fix="null"

    # errors — last 20 entries
    errors_json=$(jq -c '[.errors // [] | .[-20:] | .[]]' "$CM_STATE_FILE" 2>/dev/null)
    [ -z "$errors_json" ] && errors_json="[]"

    qlog_debug "State file read: collector=$collector_state"
else
    qlog_debug "No collector state file found, using defaults"
fi

# --- Read uploader state from uploader daemon state file --------------------
if [ -f "$CM_UPLOADER_STATE_FILE" ] && [ -s "$CM_UPLOADER_STATE_FILE" ]; then
    uploader_state=$(jq -r '.state // "idle"' "$CM_UPLOADER_STATE_FILE" 2>/dev/null)
    [ -z "$uploader_state" ] && uploader_state="idle"

    consecutive_failures=$(jq -r '.consecutive_failures // 0' "$CM_UPLOADER_STATE_FILE" 2>/dev/null)
    [ -z "$consecutive_failures" ] && consecutive_failures=0
    uploader_needs_reauth=$(jq -r 'if .needs_reauth == true then "true" else "false" end' "$CM_UPLOADER_STATE_FILE" 2>/dev/null)
    [ -z "$uploader_needs_reauth" ] && uploader_needs_reauth="false"

    # Build last_upload object from uploader state fields.
    # Frontend expects: {timestamp, batch_size, status} — map from daemon's schema.
    last_upload=$(jq -c '
        if .last_upload_ts > 0 then
            {timestamp: .last_upload_ts, batch_size: .last_batch_size,
             status: .last_upload_result, latency_ms: .last_latency_ms}
        else null end
    ' "$CM_UPLOADER_STATE_FILE" 2>/dev/null)
    [ -z "$last_upload" ] && last_upload="null"

    qlog_debug "Uploader state file read: uploader=$uploader_state"
else
    qlog_debug "No uploader state file found, using defaults"
fi

# Sanitize collector_state to allowed values
case "$collector_state" in
    running|paused|stopped|error|starting) ;;
    *) collector_state="stopped" ;;
esac

# Sanitize uploader_state to allowed values
case "$uploader_state" in
    running|idle|error|needs_reauth|backoff) ;;
    *) uploader_state="idle" ;;
esac

# --- Read buffer stats from SQLite ------------------------------------------
pending_count=0
pending_size=0
oldest_age="null"

if [ -f "$CM_DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
    . /usr/lib/qmanager/cellmapper_db.sh 2>/dev/null

    pending_count=$(cm_db_count_pending 2>/dev/null)
    [ -z "$pending_count" ] && pending_count=0

    pending_size=$(cm_db_size_pending 2>/dev/null)
    [ -z "$pending_size" ] && pending_size=0

    oldest_ts=$(cm_db_oldest_pending 2>/dev/null)
    if [ -n "$oldest_ts" ] && [ "$oldest_ts" != "NULL" ]; then
        now=$(date +%s)
        oldest_age=$(( now - oldest_ts ))
    fi

    qlog_debug "Buffer: count=$pending_count size=$pending_size oldest_age=$oldest_age"
else
    qlog_debug "SQLite not available or DB not yet created, buffer stats zeroed"
fi

# --- Detect Quectel adapter --------------------------------------------------
adapter_detected="false"
adapter_name="null"

# Check for known Quectel USB vendor IDs (2c7c) via /sys or lsusb fallback
if ls /sys/bus/usb/devices/*/idVendor 2>/dev/null | xargs grep -l "2c7c" 2>/dev/null | head -1 | grep -q .; then
    adapter_detected="true"
    # Try to read product name from sysfs
    _prd=$(ls /sys/bus/usb/devices/*/idVendor 2>/dev/null | \
        while read vf; do
            if grep -q "2c7c" "$vf" 2>/dev/null; then
                dir=$(dirname "$vf")
                cat "$dir/product" 2>/dev/null
                break
            fi
        done)
    if [ -n "$_prd" ]; then
        adapter_name="$_prd"
    else
        adapter_name="Quectel Modem"
    fi
elif command -v lsusb >/dev/null 2>&1 && lsusb 2>/dev/null | grep -qi "2c7c"; then
    adapter_detected="true"
    adapter_name=$(lsusb 2>/dev/null | grep -i "2c7c" | head -1 | sed 's/.*2c7c:[^ ]* //' | tr -d '\n')
    [ -z "$adapter_name" ] && adapter_name="Quectel Modem"
fi

# Fallback: read adapter info from collector state file if USB detection failed
if [ "$adapter_detected" = "false" ] && [ -f "$CM_STATE_FILE" ] && [ -s "$CM_STATE_FILE" ]; then
    _state_adapter_id=$(jq -r '.adapter.id // empty' "$CM_STATE_FILE" 2>/dev/null)
    if [ -n "$_state_adapter_id" ] && [ "$_state_adapter_id" != "unknown" ]; then
        adapter_detected="true"
        adapter_name=$(jq -r '.adapter.name // "Unknown Modem"' "$CM_STATE_FILE" 2>/dev/null)
    fi
fi

# Ensure adapter_name is proper JSON string or null
if [ "$adapter_detected" = "true" ] && [ -n "$adapter_name" ]; then
    adapter_name_json=$(jq -n --arg n "$adapter_name" '$n')
else
    adapter_name_json="null"
fi

# --- Encode nullable string fields for jq ------------------------------------
# account.username
if [ -n "$cm_username" ]; then
    username_json=$(jq -n --arg u "$cm_username" '$u')
else
    username_json="null"
fi

# account.linked_at
if [ -n "$cm_linked_at" ]; then
    linked_at_json="$cm_linked_at"
else
    linked_at_json="null"
fi

# --- Build final JSON response -----------------------------------------------
jq -n \
    --argjson enabled        "$svc_enabled" \
    --arg     col_state      "$collector_state" \
    --arg     upl_state      "$uploader_state" \
    --argjson upl_failures   "$consecutive_failures" \
    --argjson upl_reauth     "$uploader_needs_reauth" \
    --argjson last_meas      "$last_measurement" \
    --argjson last_up        "$last_upload" \
    --argjson linked         "$cm_linked" \
    --argjson username       "$username_json" \
    --argjson linked_at      "$linked_at_json" \
    --arg     gps_source     "$cm_gps_source" \
    --argjson gps_fix        "$gps_fix" \
    --argjson pend_count     "$pending_count" \
    --argjson pend_size      "$pending_size" \
    --argjson oldest_age     "$oldest_age" \
    --argjson adapter_det    "$adapter_detected" \
    --argjson adapter_name   "$adapter_name_json" \
    --argjson errors         "$errors_json" \
    '{
        success: true,
        service: {
            enabled:         $enabled,
            collector_state: $col_state,
            uploader_state:  $upl_state,
            uploader_failures: $upl_failures,
            uploader_needs_reauth: $upl_reauth,
            last_measurement: $last_meas,
            last_upload:     $last_up
        },
        account: {
            linked:     $linked,
            username:   $username,
            linked_at:  $linked_at
        },
        gps: {
            source: $gps_source,
            fix:    $gps_fix
        },
        buffer: {
            pending_count:      $pend_count,
            pending_size_bytes: $pend_size,
            oldest_age_sec:     $oldest_age
        },
        adapter: {
            detected: $adapter_det,
            name:     $adapter_name
        },
        errors: $errors
    }'
