#!/bin/sh
# =============================================================================
# normalize.sh — CellMapper Measurement Normalization Library
# =============================================================================
# Sourceable POSIX shell helpers for converting raw modem AT-response values
# into the units and types CellMapper (and other upload backends) expect.
#
# Adapters under /usr/lib/qmanager/cellmapper/adapters/ should source this
# module rather than reimplementing the conversions inline. Behaviour MUST
# remain identical across adapters so downstream payloads are consistent.
#
# Public API:
#   cm_norm_hex_to_dec <hex>             Generic hex (no prefix) -> decimal
#   cm_norm_lte_cid <hex>                LTE 28-bit ECI hex      -> decimal
#   cm_norm_lte_cid_to_enbid_cid <cid>   Decimal ECI             -> "enbid cellid"
#   cm_norm_nr_cid <hex>                 NR 36-bit NCI hex       -> decimal
#   cm_norm_lte_bandwidth_mhz <index>    LTE BW index (0-5)      -> MHz string
#   cm_norm_nr_bandwidth_mhz <index>     NR  BW index            -> MHz string
#   cm_norm_tac <hex_or_dec>             TAC (hex or decimal)    -> decimal
#   cm_norm_sinr <value>                 RM551-style SINR fix    -> dB
#
# Install location: /usr/lib/qmanager/cellmapper/normalize.sh
# Dependencies:     awk, sed, printf (BusyBox)
# =============================================================================

[ -n "$_CM_NORMALIZE_LOADED" ] && return 0
_CM_NORMALIZE_LOADED=1

# ---------------------------------------------------------------------------
# cm_norm_hex_to_dec <hex>
# Convert a hexadecimal string (with or without "0x" prefix) to decimal.
# Returns "0" on parse failure so downstream JSON builders never see empty.
# ---------------------------------------------------------------------------
cm_norm_hex_to_dec() {
    local h="${1#0x}"
    h="${h#0X}"
    [ -z "$h" ] && { printf '0'; return; }
    printf '%d' "0x$h" 2>/dev/null || printf '0'
}

# ---------------------------------------------------------------------------
# cm_norm_lte_cid <hex>
# Convert an LTE 28-bit E-UTRAN Cell Identifier (ECI) from hex to decimal.
# Thin wrapper over cm_norm_hex_to_dec — kept as a separate name so callers
# document intent and so future LTE-specific masking can be added in one
# place if the modem ever returns non-canonical values.
# ---------------------------------------------------------------------------
cm_norm_lte_cid() {
    cm_norm_hex_to_dec "$1"
}

# ---------------------------------------------------------------------------
# cm_norm_lte_cid_to_enbid_cid <decimal_eci>
# Split a 28-bit decimal ECI into (eNB ID, Cell ID).
#   eNB ID = upper 20 bits  = ECI >> 8
#   CellID = lower  8 bits  = ECI & 0xFF
# Output: "<enbid> <cellid>" — two integers separated by a space, suitable
# for `read enbid cellid <<EOF` in callers.
# Returns "0 0" on bad input.
# ---------------------------------------------------------------------------
cm_norm_lte_cid_to_enbid_cid() {
    local eci="$1"
    case "$eci" in
        ''|*[!0-9]*) printf '0 0'; return ;;
    esac
    printf '%d %d' "$((eci >> 8))" "$((eci & 255))"
}

# ---------------------------------------------------------------------------
# cm_norm_nr_cid <hex>
# Convert an NR 36-bit NR Cell Identity (NCI) from hex to decimal.
# Thin wrapper over cm_norm_hex_to_dec — exists so callers can express
# "this is an NR NCI, not just any hex value" and so future NR-specific
# masking lives in one place.
# ---------------------------------------------------------------------------
cm_norm_nr_cid() {
    cm_norm_hex_to_dec "$1"
}

# ---------------------------------------------------------------------------
# cm_norm_lte_bandwidth_mhz <index>
# Convert an LTE bandwidth index to its MHz string.
#   0=1.4  1=3  2=5  3=10  4=15  5=20
# Unknown indices return "0".
# ---------------------------------------------------------------------------
cm_norm_lte_bandwidth_mhz() {
    case "$1" in
        0) printf '1.4' ;;
        1) printf '3'   ;;
        2) printf '5'   ;;
        3) printf '10'  ;;
        4) printf '15'  ;;
        5) printf '20'  ;;
        *) printf '0'   ;;
    esac
}

# ---------------------------------------------------------------------------
# cm_norm_nr_bandwidth_mhz <index>
# Convert an NR bandwidth index reported by Quectel AT+QENG="servingcell"
# (NR5G-NSA, NR5G-SA) to its MHz string.
#
# Per Quectel RM5xx series AT command manual the NR DL bandwidth field is
# encoded as a small integer index. The mapping for FR1 SCS-15/30 kHz:
#   0=5  1=10  2=15  3=20  4=25  5=30  6=40  7=50  8=60  9=80  10=90  11=100
#
# This list covers the indices observed in the wild on AT&T n66/n77 EN-DC.
# Unknown indices return "0".
# ---------------------------------------------------------------------------
cm_norm_nr_bandwidth_mhz() {
    case "$1" in
        0)  printf '5'   ;;
        1)  printf '10'  ;;
        2)  printf '15'  ;;
        3)  printf '20'  ;;
        4)  printf '25'  ;;
        5)  printf '30'  ;;
        6)  printf '40'  ;;
        7)  printf '50'  ;;
        8)  printf '60'  ;;
        9)  printf '80'  ;;
        10) printf '90'  ;;
        11) printf '100' ;;
        *)  printf '0'   ;;
    esac
}

# ---------------------------------------------------------------------------
# cm_norm_tac <hex>
# Parse a Tracking Area Code reported by the modem in hexadecimal form
# (Quectel AT+QENG="servingcell" reports TAC as hex per the RM5xx AT manual).
# Returns decimal.  Empty / "-" inputs return "0".
# ---------------------------------------------------------------------------
cm_norm_tac() {
    local v="$1"
    case "$v" in
        ''|'-') printf '0'; return ;;
    esac
    cm_norm_hex_to_dec "$v"
}

# ---------------------------------------------------------------------------
# cm_norm_sinr <value>
# Quectel RM551 reports SINR magnitudes greater than 41 as tenths of a dB.
# This helper rescales such values to canonical dB. Negative values keep
# their sign. Pass-through on parse failure.
# ---------------------------------------------------------------------------
cm_norm_sinr() {
    local sinr="$1"
    [ -z "$sinr" ] && { printf '0'; return; }

    # Strip any leading minus to test magnitude.
    local abs
    abs=$(printf '%s' "$sinr" | sed 's/^-//')
    if [ "$abs" -gt 41 ] 2>/dev/null; then
        printf '%s' "$sinr" | awk '{printf "%g", $1/10}'
    else
        printf '%s' "$sinr"
    fi
}
