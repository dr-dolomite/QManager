#!/bin/sh
# =============================================================================
# cellmapper_gps.sh — CellMapper GPS Provider Dispatcher
# =============================================================================
# Sourceable POSIX shell library that manages GPS fix acquisition for the
# CellMapper collector. Loads all provider modules from the gps/ subdirectory
# and dispatches to the one configured in UCI.
#
# GPS providers live in /usr/lib/qmanager/cellmapper/gps/*.sh. Each module
# must implement:
#   cm_gps_<type>_available  — returns 0 if the provider can be used
#   cm_gps_<type>_get_fix    — prints a JSON fix object on stdout, returns 0
#
# The main entry point is cm_gps_get_fix. It reads the UCI option
# "gps_source" (modem|gpsd|nmea|http) and dispatches to the matching
# provider. If the configured provider fails or is unavailable, it logs a
# warning and returns 1 (the collector is responsible for deciding whether
# to skip the measurement or use the last known position).
#
# Fix JSON format (all providers must output this schema):
# {
#   "lat":       <number>,    // Decimal degrees, positive=N/E
#   "lon":       <number>,
#   "alt":       <number>,    // Altitude in metres (MSL)
#   "sats":      <integer>,   // Satellites used in fix
#   "fix_type":  <string>,    // "2D" | "3D" | "none"
#   "hdop":      <number>,    // Horizontal dilution of precision
#   "speed_kmh": <number>,    // Speed over ground in km/h
#   "time":      <string>     // ISO 8601 UTC, e.g. "2026-04-24T23:15:00Z"
# }
#
# Install location: /usr/lib/qmanager/cellmapper_gps.sh
# Dependencies:     /usr/lib/qmanager/cellmapper_uci.sh
#                   /usr/lib/qmanager/cellmapper/gps/*.sh
# =============================================================================

[ -n "$_CM_GPS_LOADED" ] && return 0
_CM_GPS_LOADED=1

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist if logging library has not been sourced yet.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# ---------------------------------------------------------------------------
# Ensure UCI helper is available.
# ---------------------------------------------------------------------------
if ! command -v cm_uci_get >/dev/null 2>&1; then
    if [ -f "/usr/lib/qmanager/cellmapper_uci.sh" ]; then
        # shellcheck disable=SC1091
        . /usr/lib/qmanager/cellmapper_uci.sh
    else
        # Minimal fallback so the rest of this file doesn't hard-error.
        cm_uci_get() { printf '%s' "${2:-}"; }
    fi
fi

# ---------------------------------------------------------------------------
# Load all GPS provider modules from the gps/ subdirectory.
# ---------------------------------------------------------------------------
CM_GPS_DIR="/usr/lib/qmanager/cellmapper/gps"

if [ -d "$CM_GPS_DIR" ]; then
    for _gps_mod in "$CM_GPS_DIR"/*.sh; do
        [ -f "$_gps_mod" ] || continue
        # shellcheck disable=SC1090
        . "$_gps_mod"
        qlog_debug "cellmapper_gps: loaded provider module $_gps_mod"
    done
    unset _gps_mod
else
    qlog_warn "cellmapper_gps: GPS provider directory not found: $CM_GPS_DIR"
fi

# ---------------------------------------------------------------------------
# cm_gps_get_fix
# Acquire a GPS fix using the provider configured in UCI (gps_source).
# Dispatches to the matching provider module.
#
# Outputs: JSON fix object on stdout.
# Returns: 0 on success, 1 if no fix could be obtained.
#
# Usage:
#   fix=$(cm_gps_get_fix) || { log "no fix"; }
# ---------------------------------------------------------------------------
cm_gps_get_fix() {
    local source
    source=$(cm_uci_get "gps_source" "modem")

    qlog_debug "cm_gps_get_fix: dispatching to provider '$source'"

    case "$source" in
        modem)
            if command -v cm_gps_modem_available >/dev/null 2>&1 && \
               cm_gps_modem_available; then
                cm_gps_modem_get_fix
                return $?
            fi
            qlog_warn "cm_gps_get_fix: modem GPS provider not available"
            ;;

        gpsd)
            if command -v cm_gps_gpsd_available >/dev/null 2>&1 && \
               cm_gps_gpsd_available; then
                local gpsd_host gpsd_port
                gpsd_host=$(cm_uci_get "gpsd_host" "127.0.0.1")
                gpsd_port=$(cm_uci_get "gpsd_port" "2947")
                cm_gps_gpsd_get_fix "$gpsd_host" "$gpsd_port"
                return $?
            fi
            qlog_warn "cm_gps_get_fix: gpsd GPS provider not available"
            ;;

        gpsd_local)
            if command -v cm_gps_gpsd_available >/dev/null 2>&1 && \
               cm_gps_gpsd_available; then
                local gpsd_port_local
                gpsd_port_local=$(cm_uci_get "gpsd_port" "2947")
                cm_gps_gpsd_get_fix "127.0.0.1" "$gpsd_port_local"
                return $?
            fi
            qlog_warn "cm_gps_get_fix: gpsd (local) GPS provider not available"
            ;;

        gpsd_remote)
            if command -v cm_gps_gpsd_available >/dev/null 2>&1 && \
               cm_gps_gpsd_available; then
                local gpsd_host_remote gpsd_port_remote
                gpsd_host_remote=$(cm_uci_get "gpsd_host" "127.0.0.1")
                gpsd_port_remote=$(cm_uci_get "gpsd_port" "2947")
                cm_gps_gpsd_get_fix "$gpsd_host_remote" "$gpsd_port_remote"
                return $?
            fi
            qlog_warn "cm_gps_get_fix: gpsd (remote) GPS provider not available"
            ;;

        nmea)
            if command -v cm_gps_nmea_available >/dev/null 2>&1 && \
               cm_gps_nmea_available; then
                cm_gps_nmea_get_fix
                return $?
            fi
            qlog_warn "cm_gps_get_fix: NMEA GPS provider not available"
            ;;

        http)
            if command -v cm_gps_http_json_available >/dev/null 2>&1 && \
               cm_gps_http_json_available; then
                cm_gps_http_json_get_fix
                return $?
            fi
            qlog_warn "cm_gps_get_fix: HTTP JSON GPS provider not available"
            ;;

        nmea_udp)
            if command -v cm_gps_nmea_udp_available >/dev/null 2>&1 && \
               cm_gps_nmea_udp_available; then
                cm_gps_nmea_udp_get_fix
                return $?
            fi
            qlog_warn "cm_gps_get_fix: NMEA UDP relay provider not available"
            ;;

        *)
            qlog_error "cm_gps_get_fix: unknown gps_source '$source'"
            ;;
    esac

    return 1
}

# ---------------------------------------------------------------------------
# cm_gps_provider_list
# Print a newline-separated list of available provider names.
# Used by the CGI gps-test endpoint.
# ---------------------------------------------------------------------------
cm_gps_provider_list() {
    command -v cm_gps_modem_available    >/dev/null 2>&1 && \
        cm_gps_modem_available    && printf 'modem\n'
    command -v cm_gps_gpsd_available     >/dev/null 2>&1 && \
        cm_gps_gpsd_available     && printf 'gpsd\n'
    command -v cm_gps_nmea_available     >/dev/null 2>&1 && \
        cm_gps_nmea_available     && printf 'nmea\n'
    command -v cm_gps_http_json_available >/dev/null 2>&1 && \
        cm_gps_http_json_available && printf 'http\n'
    command -v cm_gps_nmea_udp_available >/dev/null 2>&1 && \
        cm_gps_nmea_udp_available && printf 'nmea_udp\n'
    return 0
}
