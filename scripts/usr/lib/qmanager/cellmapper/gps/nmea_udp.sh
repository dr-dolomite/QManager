#!/bin/sh
# =============================================================================
# nmea_udp.sh — NMEA UDP Relay GPS Provider
# =============================================================================
# CellMapper GPS provider that reads the latest fix from the NMEA UDP relay
# daemon's state file. The relay daemon (qmanager_cm_nmea_relay) listens for
# NMEA sentences over UDP (e.g. from gpsdRelay on Android) and writes parsed
# GPS data to /tmp/cellmapper_gps_fix.json.
#
# This provider simply reads that state file, checks for staleness, and
# outputs the fix in the standard schema.
#
# Staleness check: if the _epoch field in the state file is more than 10
# seconds old, the fix is rejected (the relay may have stopped receiving data).
#
# Install location: /usr/lib/qmanager/cellmapper/gps/nmea_udp.sh
# Dependencies:     jq, date
#                   /usr/bin/qmanager_cm_nmea_relay (writes the state file)
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# State file written by the relay daemon
_CM_NMEA_UDP_STATE="/tmp/cellmapper_gps_fix.json"

# Maximum age in seconds before a fix is considered stale
_CM_NMEA_UDP_MAX_AGE=10

# ---------------------------------------------------------------------------
# cm_gps_nmea_udp_available
# Returns 0 if socat or nc is available (the relay daemon needs one of them).
# ---------------------------------------------------------------------------
cm_gps_nmea_udp_available() {
    command -v socat >/dev/null 2>&1 || command -v nc >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# cm_gps_nmea_udp_get_fix
# Read the latest GPS fix from the relay daemon's state file.
#
# Outputs: JSON fix object on stdout (standard schema, _epoch stripped).
# Returns: 0 on success, 1 if no fresh fix is available.
# ---------------------------------------------------------------------------
cm_gps_nmea_udp_get_fix() {
    if [ ! -f "$_CM_NMEA_UDP_STATE" ]; then
        qlog_warn "cm_gps_nmea_udp: state file not found — relay daemon may not be running"
        return 1
    fi

    local fix_json epoch now age
    fix_json=$(cat "$_CM_NMEA_UDP_STATE" 2>/dev/null)

    if [ -z "$fix_json" ]; then
        qlog_warn "cm_gps_nmea_udp: state file is empty"
        return 1
    fi

    # Check staleness
    epoch=$(printf '%s' "$fix_json" | jq -r '._epoch // 0' 2>/dev/null)
    now=$(date +%s)
    age=$(( now - epoch ))

    if [ "$age" -gt "$_CM_NMEA_UDP_MAX_AGE" ]; then
        qlog_debug "cm_gps_nmea_udp: fix is ${age}s old (max ${_CM_NMEA_UDP_MAX_AGE}s) — stale"
        return 1
    fi

    # Strip the internal _epoch field and output the standard fix schema
    printf '%s' "$fix_json" | jq -c 'del(._epoch)'
}
