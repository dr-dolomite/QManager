#!/bin/sh
# =============================================================================
# rm551.sh — Quectel RM551E-GL CellMapper Adapter
# =============================================================================
# Implements the CellMapper adapter contract for the Quectel RM551E-GL modem.
# Tested against AT&T EN-DC (LTE B66 + NR B77) deployments.
#
# Supported measurement types:
#   - LTE serving cell (AT+QENG="servingcell", FDD/TDD)
#   - NR5G-NSA secondary cell (EN-DC)
#   - LTE intra- and inter-frequency neighbours (AT+QENG="neighbourcell")
#   - Carrier Aggregation SCCs (from /tmp/qmanager_status.json)
#
# AT command parsing notes:
#   - Cell IDs and TAC values are reported in hexadecimal — converted to
#     decimal before output.
#   - Bandwidth is reported as an index (0-5) — converted to MHz.
#   - SINR > 41 is reported as tenths of a dB — divided by 10.
#   - US EARFCN values in certain ranges are offset by 65536 (see CellMapper
#     community reports for band 66 / band 71 discrepancies).
#
# Install location: /usr/lib/qmanager/cellmapper/adapters/rm551.sh
# Dependencies:     qcmd, jq, awk, sed
# Contract:         /usr/lib/qmanager/cellmapper/adapters/README.md
# =============================================================================

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist if logging library has not been sourced yet.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# ---------------------------------------------------------------------------
# Source the shared normalization helpers (hex<->dec, bandwidth index<->MHz,
# SINR scaling, TAC parsing). Adapters should never reimplement these inline.
# ---------------------------------------------------------------------------
if [ -f /usr/lib/qmanager/cellmapper/normalize.sh ]; then
    # shellcheck disable=SC1091
    . /usr/lib/qmanager/cellmapper/normalize.sh
fi

# ---------------------------------------------------------------------------
# Adapter identity
# ---------------------------------------------------------------------------

cm_adapter_detect() {
    local model
    model=$(qcmd "AT+CGMM" 2>/dev/null)
    case "$model" in
        *RM551E*) return 0 ;;
    esac
    return 1
}

cm_adapter_id()   { printf 'quectel_rm551'; }
cm_adapter_name() { printf 'Quectel RM551E-GL'; }

# ---------------------------------------------------------------------------
# Local thin wrappers around the shared normalize.sh helpers.  These keep
# the existing call-sites in this file unchanged while delegating the actual
# math to the shared module.  Removing them would just be churn.
# ---------------------------------------------------------------------------
_cm_bw_index_to_mhz() { cm_norm_lte_bandwidth_mhz "$1"; }
_cm_fix_sinr()        { cm_norm_sinr "$1"; }

# ---------------------------------------------------------------------------
# _cm_fix_earfcn <earfcn> <mcc>
# Apply US EARFCN correction for bands 66 and 71 (and adjacent).
# CellMapper expects the extended EARFCN (+65536) for certain US EARFCN ranges.
# Applies when MCC is 310-316 (US carriers).
# ---------------------------------------------------------------------------
_cm_fix_earfcn() {
    local earfcn="$1"
    local mcc="$2"
    # Only apply to US MCCs.
    if [ "$mcc" -ge 310 ] 2>/dev/null && [ "$mcc" -le 316 ] 2>/dev/null; then
        # Range 1200-1949: Band 66 UL overlap correction.
        # Range 2750-3449: Band 71 DL.
        if { [ "$earfcn" -ge 1200 ] && [ "$earfcn" -le 1949 ]; } 2>/dev/null ||
           { [ "$earfcn" -ge 2750 ] && [ "$earfcn" -le 3449 ]; } 2>/dev/null; then
            printf '%d' "$((earfcn + 65536))"
            return
        fi
    fi
    printf '%s' "$earfcn"
}

# ---------------------------------------------------------------------------
# Local thin wrapper around cm_norm_hex_to_dec.
# ---------------------------------------------------------------------------
_cm_hex_to_dec() { cm_norm_hex_to_dec "$1"; }

# ---------------------------------------------------------------------------
# _cm_get_provider
# Read the carrier name from AT+COPS? and return it.
# Returns empty string on failure.
# ---------------------------------------------------------------------------
_cm_get_provider() {
    local cops_raw
    cops_raw=$(qcmd "AT+COPS?" 2>/dev/null)
    # +COPS: 0,0,"AT&T",13  → extract the quoted name
    printf '%s' "$cops_raw" | sed -n 's/.*+COPS: [0-9]*,[0-9]*,"\([^"]*\)".*/\1/p'
}

# ---------------------------------------------------------------------------
# _cm_timestamp
# Output current UTC time in "YYYY-MM-DD HH:MM:SS" format.
# ---------------------------------------------------------------------------
_cm_timestamp() {
    date -u '+%Y-%m-%d %H:%M:%S'
}

# ---------------------------------------------------------------------------
# cm_adapter_collect_serving
# Parse AT+QENG="servingcell" and return a JSON array of measurement objects.
# Handles LTE (with optional NR5G-NSA secondary component).
# ---------------------------------------------------------------------------
cm_adapter_collect_serving() {
    local raw
    raw=$(qcmd 'AT+QENG="servingcell"' 2>/dev/null)
    if [ -z "$raw" ]; then
        qlog_warn "rm551: AT+QENG=servingcell returned empty response"
        printf '[]'
        return 1
    fi

    local provider
    provider=$(_cm_get_provider)
    local ts
    ts=$(_cm_timestamp)

    # -------------------------------------------------------------------------
    # Parse the LTE line.
    # Format: +QENG: "servingcell","NOCONN"
    #         +QENG: "LTE","FDD",<MCC>,<MNC>,<cellID_hex>,<PCID>,<EARFCN>,
    #                <band>,<ul_bw>,<dl_bw>,<TAC_hex>,<RSRP>,<RSRQ>,<RSSI>,
    #                <SINR>,<CQI>,<tx_power>,<srxlev>
    # -------------------------------------------------------------------------
    local lte_line
    # Two response formats exist depending on modem firmware:
    #   Two-line:  +QENG: "servingcell","NOCONN"\n+QENG: "LTE","FDD",...
    #   One-line:  +QENG: "servingcell","NOCONN","LTE","FDD",...
    # Normalize both to '+QENG: "LTE",...' so field offsets are consistent.
    lte_line=$(printf '%s' "$raw" | grep '+QENG: "LTE"' | head -1)
    if [ -z "$lte_line" ]; then
        # Try single-line format: extract from '"LTE"' onward
        lte_line=$(printf '%s' "$raw" | grep '"LTE"' | head -1 | sed 's/.*"LTE"/+QENG: "LTE"/')
    fi
    if [ -z "$lte_line" ]; then
        qlog_warn "rm551: no LTE serving cell line found"
        printf '[]'
        return 1
    fi

    # Strip the prefix and split by comma using awk.
    # Field positions after stripping +QENG: "LTE","FDD", (2 leading fields):
    #   f1=MCC, f2=MNC, f3=cellID_hex, f4=PCID, f5=EARFCN, f6=band,
    #   f7=ul_bw, f8=dl_bw, f9=TAC_hex, f10=RSRP, f11=RSRQ, f12=RSSI,
    #   f13=SINR, f14=CQI, f15=tx_power, f16=srxlev
    local lte_mcc lte_mnc lte_cid_hex lte_pcid lte_earfcn lte_band
    local lte_ul_bw lte_dl_bw lte_tac_hex lte_rsrp lte_rsrq lte_rssi
    local lte_sinr

    lte_mcc=$(    printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9A-Fa-f]/,"",$3); print $3}')
    lte_mnc=$(    printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9A-Fa-f]/,"",$4); print $4}')
    lte_cid_hex=$(printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9A-Fa-f]/,"",$5); print $5}')
    lte_pcid=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$6); print $6}')
    lte_earfcn=$( printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$7); print $7}')
    lte_band=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$8); print $8}')
    lte_ul_bw=$(  printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$9); print $9}')
    lte_dl_bw=$(  printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$10); print $10}')
    lte_tac_hex=$(printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9A-Fa-f]/,"",$11); print $11}')
    lte_rsrp=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9-]/,"",$12); print $12}')
    lte_rsrq=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9-]/,"",$13); print $13}')
    lte_rssi=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9-]/,"",$14); print $14}')
    lte_sinr=$(   printf '%s' "$lte_line" | awk -F',' '{gsub(/[^0-9-]/,"",$15); print $15}')

    # Convert hex → decimal.
    local lte_cid lte_tac
    lte_cid=$(_cm_hex_to_dec "$lte_cid_hex")
    lte_tac=$(_cm_hex_to_dec "$lte_tac_hex")

    # Bandwidth index → MHz.
    local lte_dl_bw_mhz
    lte_dl_bw_mhz=$(_cm_bw_index_to_mhz "$lte_dl_bw")

    # SINR correction.
    lte_sinr=$(_cm_fix_sinr "$lte_sinr")

    # US EARFCN correction.
    lte_earfcn=$(_cm_fix_earfcn "$lte_earfcn" "$lte_mcc")

    # Build the LTE measurement JSON object.
    local lte_obj
    lte_obj=$(jq -cn \
        --argjson radio 0 \
        --argjson mcc "$lte_mcc" \
        --argjson mnc "$lte_mnc" \
        --argjson lac "$lte_tac" \
        --argjson cid "$lte_cid" \
        --argjson signal "$lte_rsrp" \
        --arg type "LTE" \
        --arg subType "LTE" \
        --argjson connected true \
        --argjson isNeighbour false \
        --arg version "5.6.5" \
        --arg currentAppVersion "5.6.5" \
        --arg phone "Quectel|RM551E-GL|OpenWRT|QManager" \
        --arg arfcn "$lte_earfcn" \
        --arg lte_rsrp "$lte_rsrp" \
        --arg lte_rsrq "$lte_rsrq" \
        --arg lte_ss "$lte_rssi" \
        --arg lte_snr "$lte_sinr" \
        --arg lte_pci "$lte_pcid" \
        --arg lte_dl_bw "$lte_dl_bw_mhz" \
        --arg lte_band "$lte_band" \
        --arg lte_tac "$lte_tac" \
        --argjson latitude 0 \
        --argjson longitude 0 \
        --arg provider "$provider" \
        --arg timestamp "$ts" \
        '{
            radio: $radio,
            MCC: $mcc,
            MNC: $mnc,
            LAC: $lac,
            CID: $cid,
            signal: $signal,
            type: $type,
            subType: $subType,
            connected: $connected,
            isNeighbour: $isNeighbour,
            version: $version,
            currentAppVersion: $currentAppVersion,
            phone: $phone,
            latitude: $latitude,
            longitude: $longitude,
            ARFCN: $arfcn,
            LTE_RSRP: $lte_rsrp,
            LTE_RSRQ: $lte_rsrq,
            LTE_SS: $lte_ss,
            LTE_SNR: $lte_snr,
            LTE_PCI: $lte_pci,
            LTE_DL_BW: $lte_dl_bw,
            LTE_BAND: $lte_band,
            LTE_TAC: $lte_tac,
            provider: $provider,
            timestamp: $timestamp
        }')

    if [ -z "$lte_obj" ]; then
        qlog_error "rm551: failed to build LTE JSON object"
        printf '[]'
        return 1
    fi

    # -------------------------------------------------------------------------
    # Parse the NR5G-NSA line (optional — present only in EN-DC).
    # Format: +QENG: "NR5G-NSA",<MCC>,<MNC>,<PCID>,<RSRP>,<SINR>,<RSRQ>,
    #                <ARFCN>,<Band>,<NR_DL_BW>,<NCI>,<nTAC>
    # Note: NCI and nTAC may or may not be present depending on firmware.
    # -------------------------------------------------------------------------
    local nr_line
    nr_line=$(printf '%s' "$raw" | grep '+QENG: "NR5G-NSA"')

    if [ -n "$nr_line" ]; then
        local nr_mcc nr_mnc nr_pcid nr_rsrp nr_sinr nr_rsrq
        local nr_arfcn nr_band nr_dl_bw

        nr_mcc=$(  printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9]/,"",$2); print $2}')
        nr_mnc=$(  printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9]/,"",$3); print $3}')
        nr_pcid=$( printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9-]/,"",$4); print $4}')
        nr_rsrp=$( printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9-]/,"",$5); print $5}')
        nr_sinr=$( printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9-]/,"",$6); print $6}')
        nr_rsrq=$( printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9-]/,"",$7); print $7}')
        nr_arfcn=$(printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9]/,"",$8); print $8}')
        nr_band=$( printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9]/,"",$9); print $9}')
        nr_dl_bw=$(printf '%s' "$nr_line" | awk -F',' '{gsub(/[^0-9]/,"",$10); print $10}')

        nr_sinr=$(_cm_fix_sinr "$nr_sinr")

        # NR measurement uses the LTE anchor cell's LAC/CID (EN-DC requirement).
        local nr_obj
        nr_obj=$(jq -cn \
            --argjson radio 1 \
            --argjson mcc "$nr_mcc" \
            --argjson mnc "$nr_mnc" \
            --argjson lac "$lte_tac" \
            --argjson cid "$lte_cid" \
            --argjson signal "$nr_rsrp" \
            --arg type "NR" \
            --arg subType "NSA" \
            --argjson connected true \
            --argjson isNeighbour false \
            --arg version "5.6.5" \
            --arg currentAppVersion "5.6.5" \
            --arg phone "Quectel|RM551E-GL|OpenWRT|QManager" \
            --arg nr_rsrp "$nr_rsrp" \
            --arg nr_sinr "$nr_sinr" \
            --arg nr_rsrq "$nr_rsrq" \
            --arg nr_pci "$nr_pcid" \
            --arg nr_arfcn "$nr_arfcn" \
            --arg nr_band "$nr_band" \
            --arg nr_endc "true" \
            --argjson latitude 0 \
            --argjson longitude 0 \
            --arg provider "$provider" \
            --arg timestamp "$ts" \
            '{
                radio: $radio,
                MCC: $mcc,
                MNC: $mnc,
                LAC: $lac,
                CID: $cid,
                signal: $signal,
                type: $type,
                subType: $subType,
                connected: $connected,
                isNeighbour: $isNeighbour,
                version: $version,
                currentAppVersion: $currentAppVersion,
                phone: $phone,
                latitude: $latitude,
                longitude: $longitude,
                NR_SS_RSRP: $nr_rsrp,
                NR_SS_SINR: $nr_sinr,
                NR_SS_RSRQ: $nr_rsrq,
                NR_PCI: $nr_pci,
                NR_ARFCN: $nr_arfcn,
                NR_BAND: $nr_band,
                NR_ENDC_CONNECTED: $nr_endc,
                provider: $provider,
                timestamp: $timestamp
            }')

        if [ -n "$nr_obj" ]; then
            # Return array with both LTE and NR objects.
            jq -cn --argjson lte "$lte_obj" --argjson nr "$nr_obj" '[$lte, $nr]'
            return 0
        fi
    fi

    # No NR component — return array with only the LTE object.
    jq -cn --argjson lte "$lte_obj" '[$lte]'
}

# ---------------------------------------------------------------------------
# cm_adapter_collect_neighbors
# Parse AT+QENG="neighbourcell" and return a JSON array of measurements.
# ---------------------------------------------------------------------------
cm_adapter_collect_neighbors() {
    local raw
    raw=$(qcmd 'AT+QENG="neighbourcell"' 2>/dev/null)
    if [ -z "$raw" ]; then
        qlog_warn "rm551: AT+QENG=neighbourcell returned empty response"
        printf '[]'
        return 1
    fi

    # Obtain serving cell MCC/MNC so neighbours can inherit them.
    local serve_raw
    serve_raw=$(qcmd 'AT+QENG="servingcell"' 2>/dev/null)
    local serving_mcc serving_mnc
    local _nb_lte_line
    _nb_lte_line=$(printf '%s' "$serve_raw" | grep '+QENG: "LTE"' | head -1)
    if [ -z "$_nb_lte_line" ]; then
        _nb_lte_line=$(printf '%s' "$serve_raw" | grep '"LTE"' | head -1 | sed 's/.*"LTE"/+QENG: "LTE"/')
    fi
    serving_mcc=$(printf '%s' "$_nb_lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$3); print $3}')
    serving_mnc=$(printf '%s' "$_nb_lte_line" | awk -F',' '{gsub(/[^0-9]/,"",$4); print $4}')
    # Defaults if serving cell unavailable.
    serving_mcc="${serving_mcc:-0}"
    serving_mnc="${serving_mnc:-0}"

    local provider
    provider=$(_cm_get_provider)
    local ts
    ts=$(_cm_timestamp)

    # We build a JSON array incrementally via a temp file fed to jq.
    local tmpfile
    tmpfile="/tmp/qmanager_nb_$$"
    printf '' > "$tmpfile"

    # Process each neighbourcell line.
    printf '%s\n' "$raw" | grep '+QENG: "neighbourcell' | while IFS= read -r nb_line; do
        # Determine intra vs inter (both have same field layout for LTE).
        # Format (intra): +QENG: "neighbourcell intra","LTE",<EARFCN>,<PCID>,
        #                         <RSRQ>,<RSRP>,<RSSI>,<SINR>,...
        # Format (inter): +QENG: "neighbourcell inter","LTE",<EARFCN>,<PCID>,
        #                         <RSRQ>,<RSRP>,<RSSI>,<SINR>,...
        # Fields 1-2 are the type strings; real data starts at field 3.
        local nb_earfcn nb_pcid nb_rsrq nb_rsrp nb_rssi nb_sinr
        nb_earfcn=$(printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9]/,"",$3); print $3}')
        nb_pcid=$(  printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9]/,"",$4); print $4}')
        nb_rsrq=$(  printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9-]/,"",$5); print $5}')
        nb_rsrp=$(  printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9-]/,"",$6); print $6}')
        nb_rssi=$(  printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9-]/,"",$7); print $7}')
        nb_sinr=$(  printf '%s' "$nb_line" | awk -F',' '{gsub(/[^0-9-]/,"",$8); print $8}')

        # Skip if EARFCN or PCID are missing/unavailable.
        [ -z "$nb_earfcn" ] || [ "$nb_earfcn" = "-" ] && continue
        [ -z "$nb_pcid" ]   || [ "$nb_pcid"   = "-" ] && continue

        nb_earfcn=$(_cm_fix_earfcn "$nb_earfcn" "$serving_mcc")
        [ -n "$nb_sinr" ] && [ "$nb_sinr" != "-" ] && nb_sinr=$(_cm_fix_sinr "$nb_sinr")

        # Build the object; omit signal fields that are "-" or empty.
        # We use jq's `if` to exclude absent fields cleanly.
        local obj
        obj=$(jq -cn \
            --argjson radio 0 \
            --argjson mcc "$serving_mcc" \
            --argjson mnc "$serving_mnc" \
            --argjson lac 0 \
            --argjson cid 0 \
            --argjson signal "${nb_rsrp:--999}" \
            --arg type "LTE" \
            --arg subType "LTE" \
            --argjson connected false \
            --argjson isNeighbour true \
            --arg version "5.6.5" \
            --arg currentAppVersion "5.6.5" \
            --arg phone "Quectel|RM551E-GL|OpenWRT|QManager" \
            --arg arfcn "$nb_earfcn" \
            --arg lte_pci "$nb_pcid" \
            --arg lte_rsrp "$nb_rsrp" \
            --arg lte_rsrq "$nb_rsrq" \
            --arg lte_ss "$nb_rssi" \
            --arg lte_snr "$nb_sinr" \
            --argjson latitude 0 \
            --argjson longitude 0 \
            --arg provider "$provider" \
            --arg timestamp "$ts" \
            '{
                radio: $radio,
                MCC: $mcc,
                MNC: $mnc,
                LAC: $lac,
                CID: $cid,
                signal: $signal,
                type: $type,
                subType: $subType,
                connected: $connected,
                isNeighbour: $isNeighbour,
                version: $version,
                currentAppVersion: $currentAppVersion,
                phone: $phone,
                latitude: $latitude,
                longitude: $longitude,
                ARFCN: $arfcn,
                LTE_PCI: $lte_pci
            }
            | if ($lte_rsrp != "" and $lte_rsrp != "-") then . + {LTE_RSRP: $lte_rsrp} else . end
            | if ($lte_rsrq != "" and $lte_rsrq != "-") then . + {LTE_RSRQ: $lte_rsrq} else . end
            | if ($lte_ss   != "" and $lte_ss   != "-") then . + {LTE_SS: $lte_ss}     else . end
            | if ($lte_snr  != "" and $lte_snr  != "-") then . + {LTE_SNR: $lte_snr}   else . end
            | . + {provider: $provider, timestamp: $timestamp}
            ')

        [ -n "$obj" ] && printf '%s\n' "$obj" >> "$tmpfile"
    done

    # Wrap all neighbour objects into a JSON array.
    local result
    if [ -s "$tmpfile" ]; then
        result=$(jq -cs '.' "$tmpfile")
    else
        result='[]'
    fi
    rm -f "$tmpfile"
    printf '%s' "${result:-[]}"
}

# ---------------------------------------------------------------------------
# cm_adapter_collect_ca
# Read carrier aggregation SCC data from /tmp/qmanager_status.json and
# return a JSON array of measurement objects.
# ---------------------------------------------------------------------------
cm_adapter_collect_ca() {
    local status_file="/tmp/qmanager_status.json"

    if [ ! -f "$status_file" ]; then
        qlog_debug "rm551: $status_file not found — no CA data"
        printf '[]'
        return 0
    fi

    # Extract SCC components from the status JSON.
    local sccs
    sccs=$(jq -e '[.network.carrier_components[] | select(.type == "SCC")]' \
        "$status_file" 2>/dev/null)
    if [ $? -ne 0 ] || [ "$sccs" = "null" ] || [ "$sccs" = "[]" ]; then
        printf '[]'
        return 0
    fi

    local provider
    provider=$(_cm_get_provider)
    local ts
    ts=$(_cm_timestamp)

    # Convert each SCC into a CellMapper measurement object.
    jq -c \
        --arg provider "$provider" \
        --arg ts "$ts" \
        --arg phone "Quectel|RM551E-GL|OpenWRT|QManager" \
        --arg version "5.6.5" \
        '[ .[] | {
            radio: 0,
            MCC: (.mcc // 0),
            MNC: (.mnc // 0),
            LAC: (.tac // 0),
            CID: (.cid // 0),
            signal: (.rsrp // -999),
            type: "LTE",
            subType: "LTE",
            connected: true,
            isNeighbour: false,
            version: $version,
            currentAppVersion: $version,
            phone: $phone,
            latitude: 0,
            longitude: 0,
            ARFCN: ((.earfcn // 0) | tostring),
            LTE_RSRP: ((.rsrp // "") | tostring),
            LTE_RSRQ: ((.rsrq // "") | tostring),
            LTE_SS:   ((.rssi // "") | tostring),
            LTE_BAND: ((.band // "") | tostring),
            LTE_PCI:  ((.pcid // "") | tostring),
            provider: $provider,
            timestamp: $ts
        } ]' <<EOF
$sccs
EOF
}
