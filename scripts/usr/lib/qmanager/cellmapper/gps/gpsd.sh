#!/bin/sh
# =============================================================================
# gpsd.sh — gpsd GPS Provider
# =============================================================================
# CellMapper GPS provider that acquires a fix from a running gpsd daemon
# (local or remote). Supports both local and remote gpsd instances.
#
# Protocol:
#   Connect to gpsd on the configured host:port using socat (preferred) or
#   nc as a fallback. Send ?WATCH to enable JSON streaming. Parse the first
#   TPV (Time-Position-Velocity) class message received.
#
#   gpsd JSON protocol reference:
#     https://gpsd.gitlab.io/gpsd/gpsd_json.html
#
#   Key TPV fields used:
#     mode:   0=unknown, 1=no fix, 2=2D, 3=3D
#     lat:    decimal degrees
#     lon:    decimal degrees
#     altMSL: altitude above MSL in metres (preferred over alt)
#     alt:    altitude (fallback if altMSL absent)
#     hdop:   horizontal dilution of precision
#     speed:  speed over ground in m/s
#     time:   ISO 8601 UTC timestamp
#     satellites_used: count (from SKY message, not always in TPV)
#
# Install location: /usr/lib/qmanager/cellmapper/gps/gpsd.sh
# Dependencies:     socat or nc, jq
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# ---------------------------------------------------------------------------
# cm_gps_gpsd_available
# Returns 0 if socat or nc is available (connectivity is not verified here).
# ---------------------------------------------------------------------------
cm_gps_gpsd_available() {
    command -v socat >/dev/null 2>&1 || command -v nc >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# _cm_gpsd_read_tpv <host> <port>
# Connect to gpsd and return the raw JSON of the first TPV message.
# Uses socat with a 5-second timeout, falls back to nc.
# ---------------------------------------------------------------------------
_cm_gpsd_read_tpv() {
    local host="$1"
    local port="$2"
    local watch_cmd
    watch_cmd='?WATCH={"enable":true,"json":true}'

    local raw_json

    if command -v socat >/dev/null 2>&1; then
        # socat: -T5 sets inactivity timeout to 5 seconds.
        raw_json=$(printf '%s\n' "$watch_cmd" | \
            socat -T5 - "TCP:${host}:${port}" 2>/dev/null)
    elif command -v nc >/dev/null 2>&1; then
        # nc fallback — many OpenWRT builds include busybox nc.
        raw_json=$(printf '%s\n' "$watch_cmd" | \
            nc -w 5 "$host" "$port" 2>/dev/null)
    else
        qlog_error "cm_gps_gpsd: neither socat nor nc available"
        return 1
    fi

    if [ -z "$raw_json" ]; then
        qlog_warn "cm_gps_gpsd: no response from gpsd at ${host}:${port}"
        return 1
    fi

    # Extract the first TPV class object from the stream.
    # gpsd sends multiple JSON objects separated by newlines.
    local tpv
    tpv=$(printf '%s\n' "$raw_json" | \
        while IFS= read -r line; do
            case "$line" in
                *'"class":"TPV"'*) printf '%s' "$line"; break ;;
            esac
        done)

    if [ -z "$tpv" ]; then
        qlog_debug "cm_gps_gpsd: no TPV message received from ${host}:${port}"
        return 1
    fi

    printf '%s' "$tpv"
}

# ---------------------------------------------------------------------------
# cm_gps_gpsd_get_fix [host] [port]
# Acquire a GPS fix from gpsd.
# Arguments are optional — defaults come from UCI via the dispatcher.
# When called directly (e.g. from gps-test CGI), host and port may be passed.
#
# Outputs: JSON fix object on stdout.
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_gps_gpsd_get_fix() {
    local host="${1:-127.0.0.1}"
    local port="${2:-2947}"

    local tpv
    tpv=$(_cm_gpsd_read_tpv "$host" "$port") || return 1

    # Parse mode to determine fix quality.
    local mode
    mode=$(printf '%s' "$tpv" | jq -r '.mode // 0')
    case "$mode" in
        2|3) ;;
        *)
            qlog_debug "cm_gps_gpsd: gpsd mode=$mode — no fix"
            return 1
            ;;
    esac

    local fix_str
    case "$mode" in
        2) fix_str="2D" ;;
        3) fix_str="3D" ;;
        *) fix_str="none" ;;
    esac

    # Extract fields. Prefer altMSL over alt for MSL altitude.
    local lat lon alt hdop speed_ms speed_kmh iso_time sats

    lat=$(      printf '%s' "$tpv" | jq -r '.lat      // 0')
    lon=$(      printf '%s' "$tpv" | jq -r '.lon      // 0')
    alt=$(      printf '%s' "$tpv" | jq -r '.altMSL // .alt // 0')
    hdop=$(     printf '%s' "$tpv" | jq -r '.hdop     // 99.9')
    speed_ms=$( printf '%s' "$tpv" | jq -r '.speed    // 0')
    iso_time=$( printf '%s' "$tpv" | jq -r '.time     // ""')
    # sats is not always in TPV; 0 is acceptable.
    sats=$(     printf '%s' "$tpv" | jq -r '.satellites_used // 0')

    # Convert speed from m/s to km/h.
    speed_kmh=$(awk -v s="$speed_ms" 'BEGIN{printf "%.1f", s * 3.6}')

    # Fallback timestamp if gpsd did not provide one.
    if [ -z "$iso_time" ] || [ "$iso_time" = "null" ]; then
        iso_time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
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
