#!/bin/sh
# =============================================================================
# modem.sh — Modem GNSS GPS Provider
# =============================================================================
# CellMapper GPS provider that acquires a fix via the modem's built-in GNSS
# engine using Quectel's AT+QGPSLOC command.
#
# AT command protocol:
#   AT+QGPS?        — Check if GNSS engine is running (response: +QGPS: 1)
#   AT+QGPS=1       — Enable GNSS engine if not already running
#   AT+QGPSLOC=2    — Get location in decimal degrees format
#
# AT+QGPSLOC=2 response format:
#   +QGPSLOC: <UTC>,<lat>,<N/S>,<lon>,<E/W>,<hdop>,<alt>,<fix_type>,
#              <cog>,<spkm>,<spkn>,<date>,<nsat>
#
#   UTC:      hhmmss.ss
#   lat:      ddmm.mmmm  (degrees + decimal minutes)
#   N/S:      N or S
#   lon:      dddmm.mmmm
#   E/W:      E or W
#   hdop:     float
#   alt:      float (metres)
#   fix_type: 1=no fix, 2=2D fix, 3=3D fix
#   cog:      course over ground (degrees)
#   spkm:     speed in km/h
#   spkn:     speed in knots
#   date:     ddmmyy
#   nsat:     number of satellites
#
# Install location: /usr/lib/qmanager/cellmapper/gps/modem.sh
# Dependencies:     qcmd
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# ---------------------------------------------------------------------------
# cm_gps_modem_available
# Returns 0 if qcmd is available (modem GNSS is always potentially usable).
# ---------------------------------------------------------------------------
cm_gps_modem_available() {
    command -v qcmd >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# _cm_gps_ddmm_to_decimal <ddmm.mmmm> <hemisphere>
# Convert NMEA-style ddmm.mmmm (or dddmm.mmmm) to decimal degrees.
# hemisphere: N/S for latitude, E/W for longitude.
# ---------------------------------------------------------------------------
_cm_gps_ddmm_to_decimal() {
    local raw="$1"
    local hemi="$2"

    # Split at decimal point to isolate the integer part.
    local int_part dec_part
    int_part=$(printf '%s' "$raw" | cut -d'.' -f1)
    dec_part=$(printf '%s' "$raw" | cut -d'.' -f2)

    # The last two digits of the integer part are minutes; everything before
    # is degrees.
    local deg min_int
    if [ "${#int_part}" -ge 4 ]; then
        # Longitude: dddmm
        deg=$(printf '%s' "$int_part" | sed 's/..$//')
        min_int=$(printf '%s' "$int_part" | sed 's/.*\(..\)$/\1/')
    else
        # Latitude: ddmm
        deg=$(printf '%s' "$int_part" | sed 's/.$//')
        min_int=$(printf '%s' "$int_part" | sed 's/.*\(.\)$/\1/')
    fi

    # Reconstruct full minutes with decimal part.
    local minutes_full
    minutes_full="${min_int}.${dec_part}"

    # decimal = degrees + minutes/60
    local decimal
    decimal=$(awk -v d="$deg" -v m="$minutes_full" 'BEGIN{printf "%.6f", d + m/60}')

    # Apply hemisphere sign.
    case "$hemi" in
        S|W) decimal=$(awk -v v="$decimal" 'BEGIN{printf "%.6f", -v}') ;;
    esac

    printf '%s' "$decimal"
}

# ---------------------------------------------------------------------------
# _cm_gps_build_iso_time <hhmmss.ss> <ddmmyy>
# Construct an ISO 8601 UTC timestamp from the QGPSLOC time and date fields.
# ---------------------------------------------------------------------------
_cm_gps_build_iso_time() {
    local utc_time="$1"
    local utc_date="$2"

    local hh mm ss dd mo yy
    hh=$(printf '%s' "$utc_time" | cut -c1-2)
    mm=$(printf '%s' "$utc_time" | cut -c3-4)
    ss=$(printf '%s' "$utc_time" | cut -c5-6)
    dd=$(printf '%s' "$utc_date" | cut -c1-2)
    mo=$(printf '%s' "$utc_date" | cut -c3-4)
    yy=$(printf '%s' "$utc_date" | cut -c5-6)

    printf '20%s-%s-%sT%s:%s:%sZ' "$yy" "$mo" "$dd" "$hh" "$mm" "$ss"
}

# ---------------------------------------------------------------------------
# cm_gps_modem_get_fix
# Attempt to get a GPS fix via AT+QGPSLOC=2.
# Enables GNSS engine if it is not already running.
#
# Outputs: JSON fix object on stdout.
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_gps_modem_get_fix() {
    # Check if GNSS engine is running.
    local gps_state
    gps_state=$(qcmd "AT+QGPS?" 2>/dev/null)

    case "$gps_state" in
        *"+QGPS: 0"*)
            qlog_info "cm_gps_modem: GNSS engine off — attempting to enable"
            qcmd "AT+QGPS=1" >/dev/null 2>&1
            # Short wait for the GNSS engine to start acquiring.
            sleep 2
            ;;
        *"+QGPS: 1"*)
            qlog_debug "cm_gps_modem: GNSS engine already running"
            ;;
        *)
            qlog_warn "cm_gps_modem: unexpected AT+QGPS? response: $gps_state"
            ;;
    esac

    # Request location.
    local loc_raw
    loc_raw=$(qcmd "AT+QGPSLOC=2" 2>/dev/null)

    # Check for error responses.
    case "$loc_raw" in
        *"CME ERROR: 516"*)
            # 516 = GNSS not fixed yet.
            qlog_debug "cm_gps_modem: no fix yet (CME ERROR 516)"
            return 1
            ;;
        *"ERROR"*)
            qlog_warn "cm_gps_modem: AT+QGPSLOC=2 error: $loc_raw"
            return 1
            ;;
    esac

    # Extract the +QGPSLOC: line.
    local loc_line
    loc_line=$(printf '%s' "$loc_raw" | grep '+QGPSLOC:')
    if [ -z "$loc_line" ]; then
        qlog_warn "cm_gps_modem: no +QGPSLOC line in response"
        return 1
    fi

    # Strip the "+QGPSLOC: " prefix and parse CSV fields.
    local csv
    csv=$(printf '%s' "$loc_line" | sed 's/.*+QGPSLOC: //')

    local f_utc f_lat f_ns f_lon f_ew f_hdop f_alt f_fix f_cog f_spkm f_spkn f_date f_nsat
    f_utc=$( printf '%s' "$csv" | awk -F',' '{print $1}')
    f_lat=$( printf '%s' "$csv" | awk -F',' '{print $2}')
    f_ns=$(  printf '%s' "$csv" | awk -F',' '{print $3}')
    f_lon=$( printf '%s' "$csv" | awk -F',' '{print $4}')
    f_ew=$(  printf '%s' "$csv" | awk -F',' '{print $5}')
    f_hdop=$(printf '%s' "$csv" | awk -F',' '{print $6}')
    f_alt=$( printf '%s' "$csv" | awk -F',' '{print $7}')
    f_fix=$( printf '%s' "$csv" | awk -F',' '{print $8}')
    f_spkm=$(printf '%s' "$csv" | awk -F',' '{print $10}')
    f_date=$(printf '%s' "$csv" | awk -F',' '{print $13}')
    f_nsat=$(printf '%s' "$csv" | awk -F',' '{print $14}' | tr -d '\r ')

    # Validate we have a usable fix (fix_type 2 or 3).
    case "$f_fix" in
        2|3) ;;
        *)
            qlog_debug "cm_gps_modem: fix_type=$f_fix — not a valid fix"
            return 1
            ;;
    esac

    # Convert coordinates.
    local lat lon
    lat=$(_cm_gps_ddmm_to_decimal "$f_lat" "$f_ns")
    lon=$(_cm_gps_ddmm_to_decimal "$f_lon" "$f_ew")

    # Fix type string.
    local fix_str
    case "$f_fix" in
        2) fix_str="2D" ;;
        3) fix_str="3D" ;;
        *) fix_str="none" ;;
    esac

    # Build ISO timestamp.
    local iso_time
    iso_time=$(_cm_gps_build_iso_time "$f_utc" "$f_date")

    # Output JSON.
    jq -cn \
        --argjson lat "$lat" \
        --argjson lon "$lon" \
        --argjson alt "${f_alt:-0}" \
        --argjson sats "${f_nsat:-0}" \
        --arg fix_type "$fix_str" \
        --argjson hdop "${f_hdop:-99.9}" \
        --argjson speed_kmh "${f_spkm:-0}" \
        --arg time "$iso_time" \
        '{lat:$lat,lon:$lon,alt:$alt,sats:$sats,fix_type:$fix_type,hdop:$hdop,speed_kmh:$speed_kmh,time:$time}'
}
