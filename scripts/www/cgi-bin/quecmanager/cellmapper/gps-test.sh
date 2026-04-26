#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# gps-test.sh — CGI Endpoint: CellMapper GPS Source Test (GET only)
# =============================================================================
# Tests the configured GPS source and returns the current fix data or a
# structured error. Accepts query parameters to override the UCI default
# source and its connection parameters.
#
# Query parameters (all optional):
#   source  — Override UCI gps_source (modem|gpsd_local|gpsd_remote|nmea|http)
#   host    — gpsd_remote host
#   port    — gpsd_remote port
#   device  — NMEA serial device path
#   url     — HTTP GPS endpoint URL
#
# Response (fix available):
#   { "success":true, "source":"modem", "fix":{ ... } }
# Response (no fix):
#   { "success":true, "source":"modem", "fix":null, "error":"no_fix" }
# Response (source unavailable):
#   { "success":false, "error":"source_unavailable", "detail":"..." }
#
# Endpoint: GET|POST /cgi-bin/quecmanager/cellmapper/gps-test.sh
# Install location: /www/cgi-bin/quecmanager/cellmapper/gps-test.sh
# =============================================================================

qlog_init "cgi_cellmapper_gps_test"
cgi_headers
cgi_handle_options

CM_UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 CM Android/5.6.5"

# --- Enforce GET or POST -----------------------------------------------------
if [ "$REQUEST_METHOD" != "GET" ] && [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use GET or POST"
    exit 0
fi

# --- Load UCI config ---------------------------------------------------------
. /usr/lib/qmanager/cellmapper_uci.sh 2>/dev/null

# --- Parse query string -------------------------------------------------------
# Helper: extract a named field from QUERY_STRING
qs_get() {
    printf '%s' "${QUERY_STRING}" | tr '&' '\n' | grep "^${1}=" | head -1 | cut -d= -f2- | \
        sed 's/+/ /g; s/%/\\x/g' | xargs -0 printf '%b' 2>/dev/null
}

QS_SOURCE=$(qs_get source)
QS_HOST=$(qs_get host)
QS_PORT=$(qs_get port)
QS_DEVICE=$(qs_get device)
QS_URL=$(qs_get url)

# --- Resolve effective GPS source and params ---------------------------------
if [ -n "$QS_SOURCE" ]; then
    GPS_SOURCE="$QS_SOURCE"
else
    GPS_SOURCE=$(cm_uci_get gps_source "modem")
fi

# gpsd host/port — query param → UCI fallback
GPSD_HOST="${QS_HOST:-$(cm_uci_get gpsd_host "127.0.0.1")}"
GPSD_PORT="${QS_PORT:-$(cm_uci_get gpsd_port "2947")}"

# NMEA device — query param → UCI fallback
NMEA_DEV="${QS_DEVICE:-$(cm_uci_get nmea_device "")}"

# HTTP URL — query param → UCI fallback
HTTP_URL="${QS_URL:-$(cm_uci_get http_gps_url "")}"

qlog_info "GPS test: source=$GPS_SOURCE"

# =============================================================================
# Source: modem (AT+QGPSLOC=2)
# =============================================================================
gps_test_modem() {
    # Use qcmd if available, otherwise fall back to direct AT
    if command -v qcmd >/dev/null 2>&1; then
        MODEM_RESP=$(qcmd 'AT+QGPSLOC=2' 2>/dev/null)
    else
        jq -n '{"success":false,"error":"source_unavailable","detail":"qcmd not found"}'
        return
    fi

    # Success response: +QGPSLOC: <UTC>,<lat>,<N/S>,<lon>,<E/W>,<hdop>,<alt>,<fix>,<cog>,<spkm>,<spkn>,<date>,<nsat>
    # Error: +CME ERROR: 516 (GPS not fixed) or similar
    case "$MODEM_RESP" in
        *"+QGPSLOC:"*)
            # Strip leading "+QGPSLOC: " prefix
            data=$(printf '%s' "$MODEM_RESP" | grep "+QGPSLOC:" | sed 's/.*+QGPSLOC: //')

            # Parse comma-separated fields
            # Fields: utc,lat,N/S,lon,E/W,hdop,alt,fix_type,cog,spkm,spkn,date,nsat
            utc_val=$(   printf '%s' "$data" | cut -d, -f1)
            lat_val=$(   printf '%s' "$data" | cut -d, -f2)
            ns_val=$(    printf '%s' "$data" | cut -d, -f3)
            lon_val=$(   printf '%s' "$data" | cut -d, -f4)
            ew_val=$(    printf '%s' "$data" | cut -d, -f5)
            hdop_val=$(  printf '%s' "$data" | cut -d, -f6)
            alt_val=$(   printf '%s' "$data" | cut -d, -f7)
            fix_val=$(   printf '%s' "$data" | cut -d, -f8)
            spkm_val=$(  printf '%s' "$data" | cut -d, -f10)
            date_val=$(  printf '%s' "$data" | cut -d, -f12)
            nsat_val=$(  printf '%s' "$data" | cut -d, -f13)

            # Apply N/S E/W sign conventions
            [ "$ns_val" = "S" ] && lat_val="-${lat_val}"
            [ "$ew_val" = "W" ] && lon_val="-${lon_val}"

            # Translate numeric fix type (2=2D, 3=3D)
            case "$fix_val" in
                2) fix_type="2D" ;;
                3) fix_type="3D" ;;
                *) fix_type="none" ;;
            esac

            # Build ISO8601 timestamp from HHMMSS.s + DDMMYY
            # utc_val = "123519.0", date_val = "230122"
            h=$(printf '%s' "$utc_val"  | cut -c1-2)
            m=$(printf '%s' "$utc_val"  | cut -c3-4)
            s=$(printf '%s' "$utc_val"  | cut -c5-6)
            dd=$(printf '%s' "$date_val" | cut -c1-2)
            mm=$(printf '%s' "$date_val" | cut -c3-4)
            yy=$(printf '%s' "$date_val" | cut -c5-6)
            iso_time="20${yy}-${mm}-${dd}T${h}:${m}:${s}Z"

            jq -n \
                --arg  source   "modem" \
                --arg  lat      "$lat_val" \
                --arg  lon      "$lon_val" \
                --arg  alt      "$alt_val" \
                --arg  nsat     "$nsat_val" \
                --arg  fix_type "$fix_type" \
                --arg  hdop     "$hdop_val" \
                --arg  speed    "$spkm_val" \
                --arg  ts       "$iso_time" \
                '{
                    success: true,
                    source: $source,
                    fix: {
                        latitude:   ($lat  | tonumber),
                        longitude:  ($lon  | tonumber),
                        altitude:   ($alt  | tonumber),
                        satellites: ($nsat | tonumber),
                        fix_type:   $fix_type,
                        hdop:       ($hdop | tonumber),
                        speed_kmh:  ($speed | tonumber),
                        time:       $ts
                    }
                }'
            ;;
        *"CME ERROR"*|*"ERROR"*)
            jq -n '{"success":true,"source":"modem","fix":null,"error":"no_fix"}'
            ;;
        *)
            jq -n '{"success":false,"error":"source_unavailable","detail":"Unexpected modem response"}'
            ;;
    esac
}

# =============================================================================
# Source: gpsd (local or remote)
# Queries a gpsd instance via socat and waits for a TPV (time-position-velocity)
# JSON object.
# =============================================================================
gps_test_gpsd() {
    local host="$1"
    local port="$2"
    local source_label="$3"

    if ! command -v socat >/dev/null 2>&1; then
        jq -n --arg s "$source_label" \
            '{"success":false,"error":"source_unavailable","detail":"socat not installed"}'
        return
    fi

    # Send WATCH command and read response (10 seconds timeout)
    GPSD_RAW=$(printf '?WATCH={"enable":true,"json":true}\n' | \
        socat - "TCP:${host}:${port},connect-timeout=5" 2>/dev/null | \
        head -c 4096)

    if [ -z "$GPSD_RAW" ]; then
        jq -n --arg s "$source_label" --arg h "$host" --arg p "$port" \
            '{"success":false,"error":"source_unavailable","detail":("Could not connect to gpsd at " + $h + ":" + $p)}'
        return
    fi

    # gpsd sends multiple JSON objects separated by newlines.
    # Find the first TPV object.
    TPV_JSON=$(printf '%s' "$GPSD_RAW" | tr '\n' '\n' | \
        while IFS= read -r line; do
            cls=$(printf '%s' "$line" | jq -r '.class // empty' 2>/dev/null)
            if [ "$cls" = "TPV" ]; then
                printf '%s' "$line"
                break
            fi
        done)

    if [ -z "$TPV_JSON" ]; then
        jq -n --arg s "$source_label" \
            '{"success":true,"source":$s,"fix":null,"error":"no_fix"}'
        return
    fi

    # Parse TPV fields
    tp_mode=$(   printf '%s' "$TPV_JSON" | jq -r '.mode   // 0')
    tp_lat=$(    printf '%s' "$TPV_JSON" | jq -r '.lat    // "0"')
    tp_lon=$(    printf '%s' "$TPV_JSON" | jq -r '.lon    // "0"')
    tp_alt=$(    printf '%s' "$TPV_JSON" | jq -r '.alt    // "0"')
    tp_speed=$(  printf '%s' "$TPV_JSON" | jq -r '.speed  // "0"')
    tp_time=$(   printf '%s' "$TPV_JSON" | jq -r '.time   // ""')
    tp_hdop=$(   printf '%s' "$TPV_JSON" | jq -r '(.eph   // 0) | . / 5')  # eph→hdop approx
    tp_sats=$(   printf '%s' "$TPV_JSON" | jq -r '.satellites // 0')

    # mode: 0=unknown, 1=none, 2=2D, 3=3D
    case "$tp_mode" in
        3) fix_type="3D" ;;
        2) fix_type="2D" ;;
        *) fix_type="none" ;;
    esac

    if [ "$fix_type" = "none" ]; then
        jq -n --arg s "$source_label" \
            '{"success":true,"source":$s,"fix":null,"error":"no_fix"}'
        return
    fi

    # Convert speed m/s → km/h
    speed_kmh=$(printf '%s' "$tp_speed" | awk '{printf "%.2f", $1 * 3.6}')

    jq -n \
        --arg  source   "$source_label" \
        --arg  lat      "$tp_lat" \
        --arg  lon      "$tp_lon" \
        --arg  alt      "$tp_alt" \
        --argjson sats  "$tp_sats" \
        --arg  fix_type "$fix_type" \
        --arg  hdop     "$tp_hdop" \
        --arg  speed    "$speed_kmh" \
        --arg  ts       "$tp_time" \
        '{
            success: true,
            source: $source,
            fix: {
                latitude:   ($lat  | tonumber),
                longitude:  ($lon  | tonumber),
                altitude:   ($alt  | tonumber),
                satellites: $sats,
                fix_type:   $fix_type,
                hdop:       ($hdop | tonumber),
                speed_kmh:  ($speed | tonumber),
                time:       $ts
            }
        }'
}

# =============================================================================
# Source: nmea (serial device)
# Reads NMEA sentences from a device and parses a GGA or RMC sentence.
# =============================================================================
gps_test_nmea() {
    local device="$1"

    if [ -z "$device" ]; then
        jq -n '{"success":false,"error":"source_unavailable","detail":"nmea_device not configured"}'
        return
    fi

    if [ ! -c "$device" ]; then
        jq -n --arg d "$device" \
            '{"success":false,"error":"source_unavailable","detail":("Device not found: " + $d)}'
        return
    fi

    # Read up to 20 lines (5-second timeout via head) looking for GGA
    NMEA_LINE=$(timeout 5 head -20 "$device" 2>/dev/null | grep "\$GPGGA\|\$GNGGA" | head -1)

    if [ -z "$NMEA_LINE" ]; then
        jq -n '{"success":true,"source":"nmea","fix":null,"error":"no_fix"}'
        return
    fi

    # GGA: $GPGGA,HHMMSS.ss,Lat,N/S,Lon,E/W,fix,sats,hdop,alt,M,...
    utc_val=$(printf '%s' "$NMEA_LINE" | cut -d, -f2)
    lat_raw=$(printf '%s' "$NMEA_LINE" | cut -d, -f3)
    ns_val=$( printf '%s' "$NMEA_LINE" | cut -d, -f4)
    lon_raw=$(printf '%s' "$NMEA_LINE" | cut -d, -f5)
    ew_val=$( printf '%s' "$NMEA_LINE" | cut -d, -f6)
    fix_ind=$(printf '%s' "$NMEA_LINE" | cut -d, -f7)
    sats_val=$(printf '%s' "$NMEA_LINE" | cut -d, -f8)
    hdop_val=$(printf '%s' "$NMEA_LINE" | cut -d, -f9)
    alt_val=$(printf '%s' "$NMEA_LINE" | cut -d, -f10)

    if [ "$fix_ind" = "0" ] || [ -z "$fix_ind" ]; then
        jq -n '{"success":true,"source":"nmea","fix":null,"error":"no_fix"}'
        return
    fi

    # Convert NMEA DDDMM.mmm to decimal degrees
    nmea_to_decimal() {
        local raw="$1"
        # Degrees = integer part before last 2 digits before decimal
        local deg_part min_part
        deg_part=$(printf '%s' "$raw" | awk '{printf "%d", int($1/100)}')
        min_part=$(printf '%s' "$raw" | awk -v d="$deg_part" '{printf "%.6f", ($1 - d*100) / 60}')
        awk -v d="$deg_part" -v m="$min_part" 'BEGIN{printf "%.6f", d + m}'
    }

    lat_dec=$(nmea_to_decimal "$lat_raw")
    lon_dec=$(nmea_to_decimal "$lon_raw")

    [ "$ns_val" = "S" ] && lat_dec=$(awk -v v="$lat_dec" 'BEGIN{printf "%.6f", -v}')
    [ "$ew_val" = "W" ] && lon_dec=$(awk -v v="$lon_dec" 'BEGIN{printf "%.6f", -v}')

    # Build ISO8601 time from UTC HHMMSS.ss (no date available from GGA alone)
    h=$(printf '%s' "$utc_val" | cut -c1-2)
    m=$(printf '%s' "$utc_val" | cut -c3-4)
    s=$(printf '%s' "$utc_val" | cut -c5-6)
    iso_time=$(date -u "+%Y-%m-%dT${h}:${m}:${s}Z" 2>/dev/null || printf "T%s:%s:%sZ" "$h" "$m" "$s")

    jq -n \
        --arg lat      "$lat_dec" \
        --arg lon      "$lon_dec" \
        --arg alt      "${alt_val:-0}" \
        --arg sats     "${sats_val:-0}" \
        --arg hdop     "${hdop_val:-0}" \
        --arg ts       "$iso_time" \
        '{
            success: true,
            source: "nmea",
            fix: {
                latitude:   ($lat  | tonumber),
                longitude:  ($lon  | tonumber),
                altitude:   ($alt  | tonumber),
                satellites: ($sats | tonumber),
                fix_type:   "2D",
                hdop:       ($hdop | tonumber),
                speed_kmh:  0,
                time:       $ts
            }
        }'
}

# =============================================================================
# Source: http
# Calls a user-configured URL that returns a JSON GPS fix.
# =============================================================================
gps_test_http() {
    local url="$1"

    if [ -z "$url" ]; then
        jq -n '{"success":false,"error":"source_unavailable","detail":"http_gps_url not configured"}'
        return
    fi

    HTTP_RESP=$(curl -s \
        -H "User-Agent: $CM_UA" \
        --max-time 10 \
        "$url" 2>/dev/null)

    if [ -z "$HTTP_RESP" ]; then
        jq -n --arg u "$url" \
            '{"success":false,"error":"source_unavailable","detail":("No response from: " + $u)}'
        return
    fi

    # Validate it's at least parseable JSON
    if ! printf '%s' "$HTTP_RESP" | jq . >/dev/null 2>&1; then
        jq -n '{"success":false,"error":"source_unavailable","detail":"HTTP response is not valid JSON"}'
        return
    fi

    # Return the response wrapped in our envelope
    jq -n --argjson resp "$HTTP_RESP" \
        '{"success":true,"source":"http","fix":$resp}'
}

# =============================================================================
# Source: nmea_udp (NMEA UDP relay from gpsdRelay)
# Reads the state file written by the qmanager_cm_nmea_relay daemon.
# =============================================================================
gps_test_nmea_udp() {
    local state_file="/tmp/cellmapper_gps_fix.json"

    if [ ! -f "$state_file" ]; then
        jq -n '{"success":false,"error":"source_unavailable","detail":"NMEA UDP relay not running \u2014 no state file found. Ensure the relay daemon is started and receiving data."}'
        return
    fi

    local fix_json epoch now age
    fix_json=$(cat "$state_file" 2>/dev/null)
    epoch=$(printf '%s' "$fix_json" | jq -r '._epoch // 0' 2>/dev/null)
    now=$(date +%s)
    age=$(( now - epoch ))

    if [ "$age" -gt 10 ]; then
        jq -n --argjson age "$age" \
            '{"success":true,"source":"nmea_udp","fix":null,"error":"no_fix","detail":("GPS data is " + ($age|tostring) + "s old \u2014 check that gpsdRelay is sending to this device")}'
        return
    fi

    # Strip internal _epoch field and wrap in response envelope
    printf '%s' "$fix_json" | jq '{success:true, source:"nmea_udp", fix: (del(._epoch))}'
}

# =============================================================================
# Dispatch to the appropriate source handler
# =============================================================================
case "$GPS_SOURCE" in
    modem)
        gps_test_modem
        ;;
    gpsd_local)
        gps_test_gpsd "127.0.0.1" "${GPSD_PORT}" "gpsd_local"
        ;;
    gpsd_remote)
        gps_test_gpsd "$GPSD_HOST" "$GPSD_PORT" "gpsd_remote"
        ;;
    nmea)
        gps_test_nmea "$NMEA_DEV"
        ;;
    http)
        gps_test_http "$HTTP_URL"
        ;;
    nmea_udp)
        gps_test_nmea_udp
        ;;
    *)
        jq -n --arg s "$GPS_SOURCE" \
            '{"success":false,"error":"unknown_source","detail":("Unknown GPS source: " + $s)}'
        ;;
esac
