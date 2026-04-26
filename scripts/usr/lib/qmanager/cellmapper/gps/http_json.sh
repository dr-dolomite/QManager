#!/bin/sh
# =============================================================================
# http_json.sh — HTTP/JSON GPS Provider
# =============================================================================
# CellMapper GPS provider that fetches a GPS fix from an HTTP endpoint that
# returns a JSON response. Designed to integrate with local services such as
# Home Assistant, OwnTracks, or custom GPS-to-HTTP bridges.
#
# Configuration (UCI options under quecmanager.cellmapper.*):
#   http_gps_url   — Full URL of the GPS JSON endpoint (required)
#   http_gps_auth  — Optional Authorization header value
#                    e.g. "Bearer eyJhbGci..." or "Basic dXNlcjpwYXNz"
#
# Response field name detection (tried in order):
#   latitude  | lat    → latitude in decimal degrees
#   longitude | lon | lng  → longitude in decimal degrees
#   altitude  | alt    → altitude in metres (optional)
#   speed     | speed_kmh → speed (in m/s if field is "speed", km/h if "speed_kmh")
#   accuracy  | hdop   → horizontal accuracy / HDOP
#   satellites | sats  → satellite count (optional)
#   time | timestamp | datetime → ISO 8601 timestamp (optional)
#
# Install location: /usr/lib/qmanager/cellmapper/gps/http_json.sh
# Dependencies:     curl, jq
#                   /usr/lib/qmanager/cellmapper_uci.sh (for UCI reads)
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# Ensure UCI helper is available.
command -v cm_uci_get >/dev/null 2>&1 || \
    cm_uci_get() { printf '%s' "${2:-}"; }

# ---------------------------------------------------------------------------
# cm_gps_http_json_available
# Returns 0 if curl is available and a URL is configured.
# ---------------------------------------------------------------------------
cm_gps_http_json_available() {
    command -v curl >/dev/null 2>&1 || return 1
    local url
    url=$(cm_uci_get "http_gps_url" "")
    [ -n "$url" ]
}

# ---------------------------------------------------------------------------
# cm_gps_http_json_get_fix
# Fetch GPS fix from the configured HTTP endpoint.
#
# Outputs: JSON fix object on stdout.
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_gps_http_json_get_fix() {
    local url auth
    url=$(cm_uci_get "http_gps_url"  "")
    auth=$(cm_uci_get "http_gps_auth" "")

    if [ -z "$url" ]; then
        qlog_error "cm_gps_http_json: no URL configured (http_gps_url)"
        return 1
    fi

    # Build the curl command with optional auth header.
    local response
    if [ -n "$auth" ]; then
        response=$(curl -s --connect-timeout 5 \
            -H "Authorization: $auth" \
            "$url" 2>/dev/null)
    else
        response=$(curl -s --connect-timeout 5 "$url" 2>/dev/null)
    fi

    if [ -z "$response" ]; then
        qlog_warn "cm_gps_http_json: no response from $url"
        return 1
    fi

    # Validate that the response is parseable JSON.
    if ! printf '%s' "$response" | jq -e . >/dev/null 2>&1; then
        qlog_warn "cm_gps_http_json: response is not valid JSON"
        return 1
    fi

    # ---------------------------------------------------------------------------
    # Field extraction with multi-name fallback using jq.
    # Each field tries several common names; falls back to a default.
    # ---------------------------------------------------------------------------

    local lat lon alt speed_raw speed_kmh hdop sats iso_time fix_str

    # Latitude.
    lat=$(printf '%s' "$response" | \
        jq -r '.lat // .latitude // null')
    if [ -z "$lat" ] || [ "$lat" = "null" ]; then
        qlog_warn "cm_gps_http_json: could not find latitude field in response"
        return 1
    fi

    # Longitude.
    lon=$(printf '%s' "$response" | \
        jq -r '.lon // .longitude // .lng // null')
    if [ -z "$lon" ] || [ "$lon" = "null" ]; then
        qlog_warn "cm_gps_http_json: could not find longitude field in response"
        return 1
    fi

    # Altitude (optional; default 0).
    alt=$(printf '%s' "$response" | \
        jq -r '.alt // .altitude // 0')
    [ "$alt" = "null" ] && alt="0"

    # Speed.
    # If the field is named "speed" it may be in m/s (standard SI) — convert.
    # If "speed_kmh" it's already in km/h.
    local raw_speed_ms raw_speed_kmh
    raw_speed_ms=$(printf '%s' "$response" | jq -r '.speed // null')
    raw_speed_kmh=$(printf '%s' "$response" | jq -r '.speed_kmh // null')

    if [ -n "$raw_speed_kmh" ] && [ "$raw_speed_kmh" != "null" ]; then
        speed_kmh="$raw_speed_kmh"
    elif [ -n "$raw_speed_ms" ] && [ "$raw_speed_ms" != "null" ]; then
        speed_kmh=$(awk -v s="$raw_speed_ms" 'BEGIN{printf "%.1f", s * 3.6}')
    else
        speed_kmh="0"
    fi

    # HDOP / accuracy.
    hdop=$(printf '%s' "$response" | \
        jq -r '.hdop // .accuracy // 99.9')
    [ "$hdop" = "null" ] && hdop="99.9"

    # Satellite count.
    sats=$(printf '%s' "$response" | \
        jq -r '.sats // .satellites // .numSatellites // 0')
    [ "$sats" = "null" ] && sats="0"

    # Timestamp.
    iso_time=$(printf '%s' "$response" | \
        jq -r '.time // .timestamp // .datetime // null')
    if [ -z "$iso_time" ] || [ "$iso_time" = "null" ]; then
        iso_time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    fi

    # Fix type — infer from satellite count if not provided.
    local fix_field
    fix_field=$(printf '%s' "$response" | jq -r '.fix_type // null')
    if [ -n "$fix_field" ] && [ "$fix_field" != "null" ]; then
        fix_str="$fix_field"
    elif [ "$sats" -ge 4 ] 2>/dev/null; then
        fix_str="3D"
    elif [ "$sats" -ge 3 ] 2>/dev/null; then
        fix_str="2D"
    else
        fix_str="none"
    fi

    # Sanity check: lat and lon must be non-zero numbers.
    local lat_check lon_check
    lat_check=$(awk -v v="$lat" 'BEGIN{if(v+0 == 0) print "zero"; else print "ok"}')
    lon_check=$(awk -v v="$lon" 'BEGIN{if(v+0 == 0) print "zero"; else print "ok"}')
    if [ "$lat_check" = "zero" ] && [ "$lon_check" = "zero" ]; then
        qlog_warn "cm_gps_http_json: lat/lon are both 0 — likely no fix"
        return 1
    fi

    jq -cn \
        --argjson lat "$lat" \
        --argjson lon "$lon" \
        --argjson alt "$alt" \
        --argjson sats "$sats" \
        --arg fix_type "$fix_str" \
        --argjson hdop "$hdop" \
        --argjson speed_kmh "$speed_kmh" \
        --arg time "$iso_time" \
        '{lat:$lat,lon:$lon,alt:$alt,sats:$sats,fix_type:$fix_type,hdop:$hdop,speed_kmh:$speed_kmh,time:$time}'
}
