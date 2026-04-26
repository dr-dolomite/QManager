#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# settings.sh — CGI Endpoint: CellMapper Settings (GET + POST)
# =============================================================================
# GET:  Returns all CellMapper UCI configuration options as a JSON object.
#       Calls ensure_cellmapper_config to guarantee defaults exist.
# POST: Validates and saves CellMapper settings from a JSON body. Only fields
#       present in the POST body are updated (partial update semantics).
#       Touches /tmp/qmanager_cellmapper_reload to signal the collector daemon.
#
# POST body (JSON):
#   {
#     "enabled":          true|false,
#     "gps_source":       "modem"|"gpsd_local"|"gpsd_remote"|"nmea"|"http",
#     "gpsd_host":        "string",
#     "gpsd_port":        number (1-65535),
#     "nmea_device":      "string",
#     "nmea_baud":        number,
#     "http_gps_url":     "string",
#     "http_gps_auth":    "string",
#     "interval_moving":  2|5|10,
#     "interval_stopped": 30|60|300,
#     "neighbor_interval":0|30|60,
#     "speed_threshold":  number (0-200),
#     "upload_target":    "cellmapper"|"custom",
#     "custom_url":       "string",
#     "custom_auth":      "string",
#     "custom_format":    "string",
#     "custom_gzip":      true|false,
#     "batch_size":       number (5-500),
#     "upload_interval":  number (10-600),
#     "retry_enabled":    true|false,
#     "upload_policy":    "always"|"lan_only"|"scheduled",
#     "buffer_size_mb":   number (5-500),
#     "buffer_age_days":  number (1-30),
#     "consent_accepted": true|false,
#     "consent_endpoint": "string",
#     "log_level":        "DEBUG"|"INFO"|"WARN"|"ERROR"
#   }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellmapper/settings.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/settings.sh
# =============================================================================

qlog_init "cgi_cellmapper_settings"
cgi_headers
cgi_handle_options

CM_RELOAD_FLAG="/tmp/qmanager_cellmapper_reload"

# --- Load UCI library --------------------------------------------------------
. /usr/lib/qmanager/cellmapper_uci.sh 2>/dev/null

# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

# validate_int: returns 0 (valid) if $1 is an integer in [$2, $3]
validate_int() {
    local val="$1" min="$2" max="$3"
    case "$val" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# reject_field: emit structured error JSON and exit (matches watchdog.sh pattern)
reject_field() {
    local field="$1" reason="$2"
    jq -n --arg field "$field" --arg reason "$reason" \
        '{success:false, error:"invalid_field", field:$field, reason:$reason}'
    exit 0
}

# validate_enum: returns 0 if $1 is one of the remaining args
validate_enum() {
    local val="$1"; shift
    for allowed; do
        [ "$val" = "$allowed" ] && return 0
    done
    return 1
}

# =============================================================================
# GET — Return current settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching CellMapper settings"

    # Ensure all defaults are present before reading
    ensure_cellmapper_config

    # Read every known UCI option and emit as JSON
    # Boolean UCI values are stored as 0/1; convert to JSON booleans.
    _enabled=$(         cm_uci_get enabled          0)
    _gps_source=$(      cm_uci_get gps_source       modem)
    _gpsd_host=$(       cm_uci_get gpsd_host        "127.0.0.1")
    _gpsd_port=$(       cm_uci_get gpsd_port        2947)
    _nmea_device=$(     cm_uci_get nmea_device      "")
    _nmea_baud=$(       cm_uci_get nmea_baud        9600)
    _http_gps_url=$(    cm_uci_get http_gps_url     "")
    _http_gps_auth=$(   cm_uci_get http_gps_auth    "")
    _nmea_udp_port=$(   cm_uci_get nmea_udp_port    29998)
    _interval_moving=$( cm_uci_get interval_moving  5)
    _interval_stopped=$(cm_uci_get interval_stopped 60)
    _neighbor_interval=$(cm_uci_get neighbor_interval 30)
    _speed_threshold=$( cm_uci_get speed_threshold  5)
    _upload_target=$(   cm_uci_get upload_target    cellmapper)
    _custom_url=$(      cm_uci_get custom_url       "")
    _custom_auth=$(     cm_uci_get custom_auth      "")
    _custom_format=$(   cm_uci_get custom_format    cellmapper_json)
    _custom_gzip=$(     cm_uci_get custom_gzip      1)
    _batch_size=$(      cm_uci_get batch_size       50)
    _upload_interval=$( cm_uci_get upload_interval  60)
    _retry_enabled=$(   cm_uci_get retry_enabled    1)
    _upload_policy=$(   cm_uci_get upload_policy    always)
    _buffer_size_mb=$(  cm_uci_get buffer_size_mb   50)
    _buffer_age_days=$( cm_uci_get buffer_age_days  7)
    _consent_accepted=$(cm_uci_get consent_accepted 0)
    _consent_endpoint=$(cm_uci_get consent_endpoint "")
    _log_level=$(       cm_uci_get log_level        WARN)

    # UCI username / linked_at (set by signin, read-only here)
    _username=$(        cm_uci_get username "")
    _linked_at=$(       cm_uci_get linked_at "")

    # Convert 0/1 booleans to JSON booleans
    bool_enabled="false";         [ "$_enabled"          = "1" ] && bool_enabled="true"
    bool_custom_gzip="false";     [ "$_custom_gzip"      = "1" ] && bool_custom_gzip="true"
    bool_retry_enabled="false";   [ "$_retry_enabled"    = "1" ] && bool_retry_enabled="true"
    bool_consent_accepted="false";[ "$_consent_accepted" = "1" ] && bool_consent_accepted="true"

    # Null-safe optional string fields
    _linked_at_json="null"
    [ -n "$_linked_at" ] && _linked_at_json="$_linked_at"

    jq -n \
        --argjson enabled           "$bool_enabled" \
        --arg     gps_source        "$_gps_source" \
        --arg     gpsd_host         "$_gpsd_host" \
        --argjson gpsd_port         "$_gpsd_port" \
        --arg     nmea_device       "$_nmea_device" \
        --argjson nmea_baud         "$_nmea_baud" \
        --arg     http_gps_url      "$_http_gps_url" \
        --arg     http_gps_auth     "$_http_gps_auth" \
        --argjson nmea_udp_port     "$_nmea_udp_port" \
        --argjson interval_moving   "$_interval_moving" \
        --argjson interval_stopped  "$_interval_stopped" \
        --argjson neighbor_interval "$_neighbor_interval" \
        --argjson speed_threshold   "$_speed_threshold" \
        --arg     upload_target     "$_upload_target" \
        --arg     custom_url        "$_custom_url" \
        --arg     custom_auth       "$_custom_auth" \
        --arg     custom_format     "$_custom_format" \
        --argjson custom_gzip       "$bool_custom_gzip" \
        --argjson batch_size        "$_batch_size" \
        --argjson upload_interval   "$_upload_interval" \
        --argjson retry_enabled     "$bool_retry_enabled" \
        --arg     upload_policy     "$_upload_policy" \
        --argjson buffer_size_mb    "$_buffer_size_mb" \
        --argjson buffer_age_days   "$_buffer_age_days" \
        --argjson consent_accepted  "$bool_consent_accepted" \
        --arg     consent_endpoint  "$_consent_endpoint" \
        --arg     log_level         "$_log_level" \
        --arg     username          "$_username" \
        --argjson linked_at         "$_linked_at_json" \
        '{
            success:           true,
            enabled:           $enabled,
            gps_source:        $gps_source,
            gpsd_host:         $gpsd_host,
            gpsd_port:         $gpsd_port,
            nmea_device:       $nmea_device,
            nmea_baud:         $nmea_baud,
            http_gps_url:      $http_gps_url,
            http_gps_auth:     $http_gps_auth,
            nmea_udp_port:     $nmea_udp_port,
            interval_moving:   $interval_moving,
            interval_stopped:  $interval_stopped,
            neighbor_interval: $neighbor_interval,
            speed_threshold:   $speed_threshold,
            upload_target:     $upload_target,
            custom_url:        $custom_url,
            custom_auth:       $custom_auth,
            custom_format:     $custom_format,
            custom_gzip:       $custom_gzip,
            batch_size:        $batch_size,
            upload_interval:   $upload_interval,
            retry_enabled:     $retry_enabled,
            upload_policy:     $upload_policy,
            buffer_size_mb:    $buffer_size_mb,
            buffer_age_days:   $buffer_age_days,
            consent_accepted:  $consent_accepted,
            consent_endpoint:  $consent_endpoint,
            log_level:         $log_level,
            username:          (if $username == "" then null else $username end),
            linked_at:         $linked_at
        }'
    exit 0
fi

# =============================================================================
# POST — Save settings
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    qlog_info "Saving CellMapper settings"

    cgi_read_post

    # Ensure defaults exist before partial update
    ensure_cellmapper_config

    val=""

    # -------------------------------------------------------------------------
    # enabled (boolean)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "unset" end' 2>/dev/null)
    if [ "$val" != "unset" ]; then
        case "$val" in
            true)  uci -q set quecmanager.cellmapper.enabled=1 ;;
            false) uci -q set quecmanager.cellmapper.enabled=0 ;;
            *)     reject_field "enabled" "must be true or false" ;;
        esac
    fi

    # -------------------------------------------------------------------------
    # gps_source (enum)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.gps_source // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" modem gpsd_local gpsd_remote nmea nmea_udp http || \
            reject_field "gps_source" "must be one of: modem, gpsd_local, gpsd_remote, nmea, nmea_udp, http"
        uci -q set "quecmanager.cellmapper.gps_source=$val"
    fi

    # -------------------------------------------------------------------------
    # gpsd_host (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.gpsd_host // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.gpsd_host=$val"
    fi

    # -------------------------------------------------------------------------
    # gpsd_port (integer 1-65535)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.gpsd_port // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 1 65535 || reject_field "gpsd_port" "must be integer 1-65535"
        uci -q set "quecmanager.cellmapper.gpsd_port=$val"
    fi

    # -------------------------------------------------------------------------
    # nmea_device (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.nmea_device // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.nmea_device=$val"
    fi

    # -------------------------------------------------------------------------
    # nmea_baud (integer)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.nmea_baud // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 1200 921600 || reject_field "nmea_baud" "must be a valid baud rate (1200-921600)"
        uci -q set "quecmanager.cellmapper.nmea_baud=$val"
    fi

    # -------------------------------------------------------------------------
    # http_gps_url (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.http_gps_url // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.http_gps_url=$val"
    fi

    # -------------------------------------------------------------------------
    # http_gps_auth (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.http_gps_auth // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.http_gps_auth=$val"
    fi

    # -------------------------------------------------------------------------
    # nmea_udp_port (integer 1024-65535)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.nmea_udp_port // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 1024 65535 || reject_field "nmea_udp_port" "must be 1024-65535"
        uci -q set "quecmanager.cellmapper.nmea_udp_port=$val"
    fi

    # -------------------------------------------------------------------------
    # interval_moving (enum: 2|5|10)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.interval_moving // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" 2 5 10 || \
            reject_field "interval_moving" "must be one of: 2, 5, 10"
        uci -q set "quecmanager.cellmapper.interval_moving=$val"
    fi

    # -------------------------------------------------------------------------
    # interval_stopped (enum: 30|60|300)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.interval_stopped // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" 30 60 300 || \
            reject_field "interval_stopped" "must be one of: 30, 60, 300"
        uci -q set "quecmanager.cellmapper.interval_stopped=$val"
    fi

    # -------------------------------------------------------------------------
    # neighbor_interval (enum: 0|30|60) — 0 means disabled
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.neighbor_interval // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" 0 30 60 || \
            reject_field "neighbor_interval" "must be one of: 0 (off), 30, 60"
        uci -q set "quecmanager.cellmapper.neighbor_interval=$val"
    fi

    # -------------------------------------------------------------------------
    # speed_threshold (integer 0-200 km/h)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.speed_threshold // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 0 200 || reject_field "speed_threshold" "must be integer 0-200"
        uci -q set "quecmanager.cellmapper.speed_threshold=$val"
    fi

    # -------------------------------------------------------------------------
    # upload_target (enum: cellmapper|custom)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.upload_target // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" cellmapper custom || \
            reject_field "upload_target" "must be one of: cellmapper, custom"
        uci -q set "quecmanager.cellmapper.upload_target=$val"
    fi

    # -------------------------------------------------------------------------
    # custom_url (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.custom_url // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.custom_url=$val"
    fi

    # -------------------------------------------------------------------------
    # custom_auth (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.custom_auth // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.custom_auth=$val"
    fi

    # -------------------------------------------------------------------------
    # custom_format (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.custom_format // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.custom_format=$val"
    fi

    # -------------------------------------------------------------------------
    # custom_gzip (boolean)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r 'if has("custom_gzip") then (.custom_gzip | tostring) else "unset" end' 2>/dev/null)
    if [ "$val" != "unset" ]; then
        case "$val" in
            true)  uci -q set quecmanager.cellmapper.custom_gzip=1 ;;
            false) uci -q set quecmanager.cellmapper.custom_gzip=0 ;;
            *)     reject_field "custom_gzip" "must be true or false" ;;
        esac
    fi

    # -------------------------------------------------------------------------
    # batch_size (integer 5-500)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.batch_size // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 5 500 || reject_field "batch_size" "must be integer 5-500"
        uci -q set "quecmanager.cellmapper.batch_size=$val"
    fi

    # -------------------------------------------------------------------------
    # upload_interval (integer 10-600)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.upload_interval // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 10 600 || reject_field "upload_interval" "must be integer 10-600"
        uci -q set "quecmanager.cellmapper.upload_interval=$val"
    fi

    # -------------------------------------------------------------------------
    # retry_enabled (boolean)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r 'if has("retry_enabled") then (.retry_enabled | tostring) else "unset" end' 2>/dev/null)
    if [ "$val" != "unset" ]; then
        case "$val" in
            true)  uci -q set quecmanager.cellmapper.retry_enabled=1 ;;
            false) uci -q set quecmanager.cellmapper.retry_enabled=0 ;;
            *)     reject_field "retry_enabled" "must be true or false" ;;
        esac
    fi

    # -------------------------------------------------------------------------
    # upload_policy (enum: always|lan_only|scheduled)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.upload_policy // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" always lan_only scheduled || \
            reject_field "upload_policy" "must be one of: always, lan_only, scheduled"
        uci -q set "quecmanager.cellmapper.upload_policy=$val"
    fi

    # -------------------------------------------------------------------------
    # buffer_size_mb (integer 5-500)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.buffer_size_mb // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 5 500 || reject_field "buffer_size_mb" "must be integer 5-500"
        uci -q set "quecmanager.cellmapper.buffer_size_mb=$val"
    fi

    # -------------------------------------------------------------------------
    # buffer_age_days (integer 1-30)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.buffer_age_days // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_int "$val" 1 30 || reject_field "buffer_age_days" "must be integer 1-30"
        uci -q set "quecmanager.cellmapper.buffer_age_days=$val"
    fi

    # -------------------------------------------------------------------------
    # consent_accepted (boolean)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r 'if has("consent_accepted") then (.consent_accepted | tostring) else "unset" end' 2>/dev/null)
    if [ "$val" != "unset" ]; then
        case "$val" in
            true)  uci -q set quecmanager.cellmapper.consent_accepted=1 ;;
            false) uci -q set quecmanager.cellmapper.consent_accepted=0 ;;
            *)     reject_field "consent_accepted" "must be true or false" ;;
        esac
    fi

    # -------------------------------------------------------------------------
    # consent_endpoint (string)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.consent_endpoint // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        uci -q set "quecmanager.cellmapper.consent_endpoint=$val"
    fi

    # -------------------------------------------------------------------------
    # log_level (enum: DEBUG|INFO|WARN|ERROR)
    # -------------------------------------------------------------------------
    val=$(printf '%s' "$POST_DATA" | jq -r '.log_level // empty' 2>/dev/null)
    if [ -n "$val" ]; then
        validate_enum "$val" DEBUG INFO WARN ERROR || \
            reject_field "log_level" "must be one of: DEBUG, INFO, WARN, ERROR"
        uci -q set "quecmanager.cellmapper.log_level=$val"
    fi

    # --- Commit changes -------------------------------------------------------
    uci commit quecmanager 2>/dev/null

    # --- Signal collector daemon to reload config ----------------------------
    touch "$CM_RELOAD_FLAG"

    # --- Restart service to apply structural changes -------------------------
    # uci commit from CLI/CGI does NOT emit a ubus config.change event, so
    # procd's reload_trigger never fires.  Settings that affect which procd
    # instances are spawned (e.g. gps_source toggling the nmea_relay) require
    # an explicit restart so start_service() runs fresh and procd reconciles.
    if [ "$(uci -q get quecmanager.cellmapper.enabled 2>/dev/null)" = "1" ]; then
        /etc/init.d/qmanager_cellmapper restart >/dev/null 2>&1 &
    fi

    qlog_info "CellMapper settings saved"
    echo '{"success":true}'
    exit 0
fi

# --- Unsupported method ------------------------------------------------------
cgi_error "method_not_allowed" "Only GET and POST are supported"
