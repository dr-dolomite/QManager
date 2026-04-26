#!/bin/sh
# =============================================================================
# cellmapper_uci.sh — CellMapper UCI Configuration Library
# =============================================================================
# Sourceable POSIX shell library that manages the CellMapper UCI config section
# under quecmanager.*. Provides schema enforcement (ensure defaults exist) and
# a safe getter with fallback values.
#
# All CellMapper settings live in:
#   /etc/config/quecmanager   →   config cellmapper 'cellmapper'
#
# Call ensure_cellmapper_config once at startup to guarantee all expected keys
# are present before reading them. Keys that already exist are left untouched.
#
# Install location: /usr/lib/qmanager/cellmapper_uci.sh
# Dependencies:     uci (built-in on OpenWRT)
# =============================================================================

[ -n "$_CM_UCI_LOADED" ] && return 0
_CM_UCI_LOADED=1

# --- cm_uci_get ---------------------------------------------------------------
# Read a CellMapper UCI option with a fallback default.
# Usage: value=$(cm_uci_get "$key" "$default")
#   key     — UCI option name (e.g. "enabled", "gps_source")
#   default — Value to return when the key is absent or empty
cm_uci_get() {
    local key="$1"
    local default="$2"
    local value
    value=$(uci -q get "quecmanager.cellmapper.$key" 2>/dev/null)
    if [ -z "$value" ]; then
        printf '%s' "$default"
    else
        printf '%s' "$value"
    fi
}

# --- _cm_uci_set_default ------------------------------------------------------
# Internal helper: set a UCI option only if it is not already configured.
# Usage: _cm_uci_set_default "$option" "$value"
_cm_uci_set_default() {
    local option="$1"
    local value="$2"
    local existing
    existing=$(uci -q get "quecmanager.cellmapper.$option" 2>/dev/null)
    if [ -z "$existing" ]; then
        uci -q set "quecmanager.cellmapper.$option=$value"
    fi
}

# --- ensure_cellmapper_config -------------------------------------------------
# Idempotently ensures the cellmapper UCI section and all expected options
# exist with their default values. Options that already have values are NOT
# overwritten — this preserves user configuration across upgrades.
#
# After calling this function, callers must commit if any changes were staged:
#   uci commit quecmanager
#
# Usage: ensure_cellmapper_config
ensure_cellmapper_config() {
    # Ensure the section itself exists.
    local section_type
    section_type=$(uci -q get quecmanager.cellmapper 2>/dev/null)
    if [ -z "$section_type" ]; then
        uci -q set quecmanager.cellmapper=cellmapper
    fi

    # ---- Feature toggle -------------------------------------------------------
    _cm_uci_set_default enabled          '0'

    # ---- GPS source selection -------------------------------------------------
    # gps_source: modem | gpsd | nmea | http
    _cm_uci_set_default gps_source       'modem'

    # gpsd connection (used when gps_source=gpsd)
    _cm_uci_set_default gpsd_host        '127.0.0.1'
    _cm_uci_set_default gpsd_port        '2947'

    # Serial NMEA device (used when gps_source=nmea)
    _cm_uci_set_default nmea_device      ''
    _cm_uci_set_default nmea_baud        '9600'

    # HTTP GPS endpoint (used when gps_source=http)
    _cm_uci_set_default http_gps_url     ''
    _cm_uci_set_default http_gps_auth    ''

    # ---- Collection intervals (seconds) --------------------------------------
    _cm_uci_set_default interval_moving  '5'
    _cm_uci_set_default interval_stopped '60'
    _cm_uci_set_default neighbor_interval '30'

    # Speed threshold in km/h below which the device is considered stopped.
    _cm_uci_set_default speed_threshold  '5'

    # ---- Upload target --------------------------------------------------------
    # upload_target: cellmapper | custom
    _cm_uci_set_default upload_target    'cellmapper'

    # Custom endpoint (used when upload_target=custom)
    _cm_uci_set_default custom_url       ''
    _cm_uci_set_default custom_auth      ''

    # custom_format: cellmapper_json | (future formats)
    _cm_uci_set_default custom_format    'cellmapper_json'
    _cm_uci_set_default custom_gzip      '1'

    # ---- Upload tuning --------------------------------------------------------
    _cm_uci_set_default batch_size       '50'
    _cm_uci_set_default upload_interval  '60'
    _cm_uci_set_default retry_enabled    '1'

    # upload_policy: always | wifi_only | never
    _cm_uci_set_default upload_policy    'always'

    # ---- Buffer / eviction limits --------------------------------------------
    _cm_uci_set_default buffer_size_mb   '50'
    _cm_uci_set_default buffer_age_days  '7'

    # ---- Consent and legal ---------------------------------------------------
    _cm_uci_set_default consent_accepted '0'
    _cm_uci_set_default consent_endpoint ''

    # ---- Logging -------------------------------------------------------------
    # log_level: DEBUG | INFO | WARN | ERROR
    _cm_uci_set_default log_level        'WARN'

    uci commit quecmanager 2>/dev/null
}
