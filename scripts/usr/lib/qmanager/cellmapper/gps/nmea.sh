#!/bin/sh
# =============================================================================
# nmea.sh — NMEA Serial Device GPS Provider
# =============================================================================
# CellMapper GPS provider that reads NMEA 0183 sentences from a serial device
# (e.g. /dev/ttyUSB1, /dev/ttyACM0) and extracts a GPS fix.
#
# NMEA sentences parsed:
#   $GPRMC / $GNRMC — Recommended Minimum Navigation Data
#     Field layout: time,status,lat,N/S,lon,E/W,speed_knots,cog,date,...
#     status: A=active (valid), V=void (invalid)
#
#   $GPGGA / $GNGGA — Global Positioning System Fix Data
#     Field layout: time,lat,N/S,lon,E/W,quality,sats,hdop,alt,M,...
#     quality: 0=no fix, 1=GPS, 2=DGPS
#
# NMEA coordinate format: ddmm.mmmm → decimal degrees.
# Speed is in knots from RMC; converted to km/h (1 knot = 1.852 km/h).
#
# Device and baud rate are read from UCI:
#   uci get quecmanager.cellmapper.nmea_device   (e.g. /dev/ttyUSB1)
#   uci get quecmanager.cellmapper.nmea_baud     (default: 9600)
#
# Install location: /usr/lib/qmanager/cellmapper/gps/nmea.sh
# Dependencies:     stty, head, jq, awk, sed
#                   /usr/lib/qmanager/cellmapper_uci.sh (for UCI reads)
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# Ensure UCI helper is available for device/baud reads.
command -v cm_uci_get >/dev/null 2>&1 || \
    cm_uci_get() { printf '%s' "${2:-}"; }

# ---------------------------------------------------------------------------
# cm_gps_nmea_available
# Returns 0 if a NMEA device is configured and the device node exists.
# ---------------------------------------------------------------------------
cm_gps_nmea_available() {
    local device
    device=$(cm_uci_get "nmea_device" "")
    [ -n "$device" ] && [ -c "$device" ]
}

# ---------------------------------------------------------------------------
# _cm_nmea_ddmm_to_decimal <ddmm.mmmm> <hemisphere>
# Convert NMEA ddmm.mmmm to decimal degrees.
# hemisphere: N/S for latitude, E/W for longitude.
# ---------------------------------------------------------------------------
_cm_nmea_ddmm_to_decimal() {
    local raw="$1"
    local hemi="$2"

    local int_part dec_part
    int_part=$(printf '%s' "$raw" | cut -d'.' -f1)
    dec_part=$(printf '%s' "$raw" | cut -d'.' -f2)

    local deg min_str
    if [ "${#int_part}" -ge 4 ]; then
        # Longitude: dddmm → degrees = first (len-2) chars
        deg=$(printf '%s' "$int_part" | sed 's/..$//')
        min_str=$(printf '%s' "$int_part" | sed 's/.*\(..\)$/\1/')
    else
        # Latitude: ddmm → degrees = first (len-2) chars
        deg=$(printf '%s' "$int_part" | sed 's/..$//; s/^$/0/')
        min_str=$(printf '%s' "$int_part" | sed 's/.*\(..\)$/\1/')
    fi

    local decimal
    decimal=$(awk -v d="$deg" -v m="${min_str}.${dec_part}" \
        'BEGIN{printf "%.6f", d + m/60}')

    case "$hemi" in
        S|W) decimal=$(awk -v v="$decimal" 'BEGIN{printf "%.6f", -v}') ;;
    esac

    printf '%s' "$decimal"
}

# ---------------------------------------------------------------------------
# cm_gps_nmea_get_fix
# Read NMEA sentences from the configured serial device and parse a fix.
# Reads up to 60 lines (enough to capture both RMC and GGA sentences).
#
# Outputs: JSON fix object on stdout.
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_gps_nmea_get_fix() {
    local device baud
    device=$(cm_uci_get "nmea_device" "")
    baud=$(  cm_uci_get "nmea_baud"   "9600")

    if [ ! -c "$device" ]; then
        qlog_warn "cm_gps_nmea: device not found or not a character device: $device"
        return 1
    fi

    # Configure the serial port.
    stty -F "$device" "$baud" raw 2>/dev/null || {
        qlog_warn "cm_gps_nmea: stty failed for $device at $baud baud"
        return 1
    }

    # Read up to 60 lines with a 10-second timeout (implemented via head + timeout).
    local nmea_lines
    # Use a subshell with head to avoid blocking indefinitely.
    nmea_lines=$(timeout 10 head -n 60 "$device" 2>/dev/null) || {
        qlog_warn "cm_gps_nmea: failed to read from $device"
        return 1
    }

    if [ -z "$nmea_lines" ]; then
        qlog_warn "cm_gps_nmea: no NMEA data from $device"
        return 1
    fi

    # -------------------------------------------------------------------------
    # Parse $GPRMC or $GNRMC for lat/lon/speed/time.
    # -------------------------------------------------------------------------
    local rmc_line
    rmc_line=$(printf '%s\n' "$nmea_lines" | \
        grep -m1 '^\$G[PNLB]RMC,')

    local rmc_lat rmc_ns rmc_lon rmc_ew rmc_speed_kn rmc_date rmc_time rmc_status
    if [ -n "$rmc_line" ]; then
        rmc_time=$(    printf '%s' "$rmc_line" | awk -F',' '{print $2}')
        rmc_status=$(  printf '%s' "$rmc_line" | awk -F',' '{print $3}')
        rmc_lat=$(     printf '%s' "$rmc_line" | awk -F',' '{print $4}')
        rmc_ns=$(      printf '%s' "$rmc_line" | awk -F',' '{print $5}')
        rmc_lon=$(     printf '%s' "$rmc_line" | awk -F',' '{print $6}')
        rmc_ew=$(      printf '%s' "$rmc_line" | awk -F',' '{print $7}')
        rmc_speed_kn=$(printf '%s' "$rmc_line" | awk -F',' '{print $8}')
        rmc_date=$(    printf '%s' "$rmc_line" | awk -F',' '{print $10}')
    fi

    # Reject void (invalid) RMC fixes.
    if [ "$rmc_status" != "A" ]; then
        qlog_debug "cm_gps_nmea: RMC status=$rmc_status (not active) — no fix"
        return 1
    fi

    # -------------------------------------------------------------------------
    # Parse $GPGGA or $GNGGA for altitude, satellite count, HDOP, fix quality.
    # -------------------------------------------------------------------------
    local gga_line
    gga_line=$(printf '%s\n' "$nmea_lines" | \
        grep -m1 '^\$G[PNLB]GGA,')

    local gga_quality gga_sats gga_hdop gga_alt
    if [ -n "$gga_line" ]; then
        gga_quality=$(printf '%s' "$gga_line" | awk -F',' '{print $7}')
        gga_sats=$(   printf '%s' "$gga_line" | awk -F',' '{print $8}')
        gga_hdop=$(   printf '%s' "$gga_line" | awk -F',' '{print $9}')
        gga_alt=$(    printf '%s' "$gga_line" | awk -F',' '{print $10}')
    fi

    # Determine fix type from GGA quality indicator.
    local fix_str
    case "$gga_quality" in
        1|2|4|5) fix_str="3D" ;;
        *)        fix_str="2D" ;;  # RMC active but no GGA — assume 2D
    esac

    # Convert coordinates.
    local lat lon
    lat=$(_cm_nmea_ddmm_to_decimal "$rmc_lat" "$rmc_ns")
    lon=$(_cm_nmea_ddmm_to_decimal "$rmc_lon" "$rmc_ew")

    # Convert speed from knots to km/h.
    local speed_kmh
    speed_kmh=$(awk -v s="${rmc_speed_kn:-0}" 'BEGIN{printf "%.1f", s * 1.852}')

    # Build ISO timestamp from RMC time (hhmmss.ss) and date (ddmmyy).
    local hh mm ss dd mo yy iso_time
    hh=$(printf '%s' "$rmc_time" | cut -c1-2)
    mm=$(printf '%s' "$rmc_time" | cut -c3-4)
    ss=$(printf '%s' "$rmc_time" | cut -c5-6)
    dd=$(printf '%s' "$rmc_date" | cut -c1-2)
    mo=$(printf '%s' "$rmc_date" | cut -c3-4)
    yy=$(printf '%s' "$rmc_date" | cut -c5-6)
    iso_time="20${yy}-${mo}-${dd}T${hh}:${mm}:${ss}Z"

    jq -cn \
        --argjson lat "$lat" \
        --argjson lon "$lon" \
        --argjson alt "${gga_alt:-0}" \
        --argjson sats "${gga_sats:-0}" \
        --arg fix_type "$fix_str" \
        --argjson hdop "${gga_hdop:-99.9}" \
        --argjson speed_kmh "$speed_kmh" \
        --arg time "$iso_time" \
        '{lat:$lat,lon:$lon,alt:$alt,sats:$sats,fix_type:$fix_type,hdop:$hdop,speed_kmh:$speed_kmh,time:$time}'
}
