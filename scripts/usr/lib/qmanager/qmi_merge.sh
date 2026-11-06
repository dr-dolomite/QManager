# shellcheck shell=sh
# =============================================================================
# qmi_merge.sh — QMI gap-fill for the poller (QMI Phase 2, step 1)
# =============================================================================
# Sourced by qmanager_poller (guarded `[ -f ] && .`; missing lib = AT only).
#
# The broker's sampler publishes /var/run/qmanager/qmi.env every 2 s (contract:
# docs/features/qmi-lane.md). On cycles where AT did not read the serving cell
# (idle/deep tiers between AT touches, a busy QENG), the LTE serving signal in
# status.json is filled from it, under identity, registration and freshness
# gates. The fill is an overlay: qmi_overlay_apply runs right before the final
# write_cache and qmi_overlay_restore right after it, so every AT consumer
# (events.sh, signal history, busy logic, the parity dumps) only ever sees AT
# samples. The scan / SIM-switch early-return write_cache never overlays.
#
# Hot path: builtins only, zero forks (the stamp is written with a redirect).
# =============================================================================

QMI_ENV="${QMI_ENV:-/var/run/qmanager/qmi.env}"
QMI_STAMP="${QMI_STAMP:-/var/run/qmanager/qmi.stamp}"
QMI_FORCE_EVERY="${QMI_FORCE_EVERY:-15}"
QMI_MAX_AGE="${QMI_MAX_AGE:-5}"
QMI_SCAN_FLAG="${QMI_SCAN_FLAG:-/tmp/qmanager_long_running}"
QMI_SIMSW_FLAG="${QMI_SIMSW_FLAG:-/tmp/qmanager_sim_switch_active}"

_qmi_calls=0
# 1 while the last load found a complete, valid sidecar.
_QMI_OK=0
# Published as device.qmi_read_mono / qmi_state / qmi_ssr_count (sanitised).
_QMI_READ_MONO=0
_QMI_STATE=""
_QMI_SSR=0
# Published as lte.source.
lte_source="at"
# Overlay save slots.
_QMO_ACTIVE=0
_qmo_rsrp=""
_qmo_rsrq=""
_qmo_rssi=""

# _qmi_env_source: source QMI_ENV only if every line is a single-quoted qmi_*
# assignment whose value has no shell-active character, and the last line is
# the end marker. Stricter than cq_env_source: a sourced line can only ever
# assign a qmi_* variable, never a poller global. Returns 1 without sourcing.
# Evaluates the lines it validated rather than re-opening the file: a broker
# stop deletes qmi.env, and `.` on a missing file aborts the poller.
_qmi_env_source() {
    _qes_last=""
    _qes_buf=""
    _qes_bad=0
    {
        while IFS= read -r _qes_l; do
            case "$_qes_l" in
                *[!A-Za-z0-9_=\'-]*) _qes_bad=1; break ;;
                qmi_*=\'*\'|qm_sidecar_end=\'1\') ;;
                *) _qes_bad=1; break ;;
            esac
            _qes_last="$_qes_l"
            _qes_buf="$_qes_buf$_qes_l
"
        done < "$QMI_ENV"
    } 2>/dev/null
    [ "$_qes_bad" = "0" ] || return 1
    [ "$_qes_last" = "qm_sidecar_end='1'" ] || return 1
    eval "$_qes_buf"
}

# _qmi_int <value>: true when the value is a plain integer (optional minus,
# no leading zero).
_qmi_int() {
    case "$1" in
        ''|-|*[!0-9-]*|?*-*|0?*|-0*) return 1 ;;
    esac
    return 0
}

# qmi_load: refresh the qmi_* globals from the sidecar. The sidecar is re-read
# when it is not older than the stamp (same second counts as newer, which is
# what backdating the stamp by one second gives), plus a forced re-read every
# QMI_FORCE_EVERY calls. The stamp is written before the read with a builtin
# redirect. Returns 0 when a valid sidecar is loaded.
qmi_load() {
    if [ ! -f "$QMI_ENV" ]; then
        _QMI_OK=0
        _QMI_READ_MONO=0
        _QMI_STATE=""
        _QMI_SSR=0
        return 1
    fi
    _qmi_calls=$((_qmi_calls + 1))
    if [ "$_QMI_OK" = "1" ] && [ "$_qmi_calls" -lt "$QMI_FORCE_EVERY" ] \
        && [ "$QMI_STAMP" -nt "$QMI_ENV" ]; then
        return 0
    fi
    _qmi_calls=0
    # `true`, not `:`: a redirect error on a special builtin exits the shell.
    true 2>/dev/null > "$QMI_STAMP"
    qmi_mono=""
    qmi_state=""
    qmi_ssr_count=""
    qmi_registered=""
    qmi_lte_pci=""
    qmi_lte_earfcn=""
    qmi_lte_rsrp=""
    qmi_lte_rsrq=""
    qmi_lte_rssi=""
    # Broker 0.7.0 names. Unset (not blanked): "set after sourcing" is how
    # qmi_ca_build tells a 0.7.0 sidecar from an older one, and a value left
    # over from a previous load must not leak into a sidecar that lacks them.
    unset qmi_pcc_rsrp qmi_pcc_rsrq qmi_pcc_rssi qmi_pcc_sinr
    unset qmi_scc1_rsrp qmi_scc1_rsrq qmi_scc1_rssi
    unset qmi_scc2_rsrp qmi_scc2_rsrq qmi_scc2_rssi
    unset qmi_scc3_rsrp qmi_scc3_rsrq qmi_scc3_rssi
    unset qmi_scc4_rsrp qmi_scc4_rsrq qmi_scc4_rssi
    unset qmi_nr_pci qmi_nr_arfcn qmi_nr_endc
    if ! _qmi_env_source; then
        _QMI_OK=0
        _QMI_READ_MONO=0
        _QMI_STATE=""
        _QMI_SSR=0
        return 1
    fi
    _QMI_OK=1
    # Digits only, no leading zero (ash reads 08 as bad octal), <= 10 digits.
    case "$qmi_mono" in
        ''|*[!0-9]*|0?*|???????????*) _QMI_READ_MONO=0 ;;
        *) _QMI_READ_MONO="$qmi_mono" ;;
    esac
    case "$qmi_state" in
        up|down|unavailable) _QMI_STATE="$qmi_state" ;;
        *) _QMI_STATE="" ;;
    esac
    case "$qmi_ssr_count" in
        ''|*[!0-9]*|0?*|???????????*) _QMI_SSR=0 ;;
        *) _QMI_SSR="$qmi_ssr_count" ;;
    esac
    return 0
}

# qmi_overlay_apply: fill lte_rsrp / lte_rsrq / lte_rssi from QMI for the next
# write_cache when every gate holds; sets lte_source to qmi or at.
#   - AT did not parse a serving-cell reply this cycle (_QENG_PARSED != 1);
#   - no scan or SIM switch is flagged, and system_state is not still
#     scan_in_progress from one (D2);
#   - a valid sidecar, qmi_state=up, registered;
#   - read age (uptime clock) 0..QMI_MAX_AGE s;
#   - QMI LTE PCI and EARFCN equal the AT ones, or AT knows no serving cell
#     (no LTE and no NR PCI), so a handover between AT reads is never merged;
#   - all three QMI values are integers.
qmi_overlay_apply() {
    lte_source="at"
    _QMO_ACTIVE=0
    [ "${_QENG_PARSED:-0}" = "1" ] && return 1
    [ "$_QMI_OK" = "1" ] || return 1
    [ "$_QMI_STATE" = "up" ] || return 1
    [ "$qmi_registered" = "1" ] || return 1
    qm_trusted_file "$QMI_SCAN_FLAG" && return 1
    [ -f "$QMI_SIMSW_FLAG" ] && return 1
    # After a scan the deep/idle tier keeps reporting scan_in_progress until its
    # next AT read; stay AT-only until then so the snapshot stays coherent.
    [ "$system_state" = "scan_in_progress" ] && return 1
    case "${_MONO_TOP:-0}" in ''|0|*[!0-9]*) return 1 ;; esac
    [ "$_QMI_READ_MONO" -gt 0 ] || return 1
    [ "$_MONO_TOP" -ge "$_QMI_READ_MONO" ] || return 1
    [ $((_MONO_TOP - _QMI_READ_MONO)) -le "$QMI_MAX_AGE" ] || return 1
    _qmi_int "$qmi_lte_pci" || return 1
    _qmi_int "$qmi_lte_earfcn" || return 1
    if [ -n "$lte_pci" ] || [ -n "$lte_earfcn" ]; then
        [ "$qmi_lte_pci" = "$lte_pci" ] || return 1
        [ "$qmi_lte_earfcn" = "$lte_earfcn" ] || return 1
    elif [ -n "$nr_pci" ]; then
        return 1
    fi
    _qmi_int "$qmi_lte_rsrp" || return 1
    _qmi_int "$qmi_lte_rsrq" || return 1
    _qmi_int "$qmi_lte_rssi" || return 1
    _qmo_rsrp="$lte_rsrp"
    _qmo_rsrq="$lte_rsrq"
    _qmo_rssi="$lte_rssi"
    _QMO_ACTIVE=1
    lte_rsrp="$qmi_lte_rsrp"
    lte_rsrq="$qmi_lte_rsrq"
    lte_rssi="$qmi_lte_rssi"
    lte_source="qmi"
    return 0
}

# qmi_overlay_restore: put the AT values back after write_cache.
qmi_overlay_restore() {
    if [ "$_QMO_ACTIVE" = "1" ]; then
        lte_rsrp="$_qmo_rsrp"
        lte_rsrq="$_qmo_rsrq"
        lte_rssi="$_qmo_rssi"
        _QMO_ACTIVE=0
    fi
    lte_source="at"
}

# =============================================================================
# Carrier list from QMI (broker 0.7.0)
# =============================================================================
# The poller calls qmi_ca_build at its AT+QCAINFO point (AT-due, non-deep
# cycles only). It returns 0 after filling the t2_* carrier globals from the
# sidecar, and 1 when AT+QCAINFO must run: the poller then takes today's path
# unchanged. The build replaces the QCAINFO sample at the same cadence, so
# events.sh (ca_change debounce, SCC signature, PCI state) sees a sample per
# AT-due cycle exactly as before; it is not an overlay and is never restored.
#
# QMI cannot supply NR bandwidth or NR carrier signal, so in NSA the NR row is
# the one from the last successful AT+QCAINFO parse, kept in the _QMC_* cache
# and appended to the QMI LTE rows while QENG still shows the same NR leg.
#
# Build conditions (any failure returns 1):
#   - AT owns this cycle's serving cell (_QENG_PARSED=1), so the QENG globals
#     below are fresh; no scan or SIM switch; sidecar valid, up, registered,
#     read age 0..QMI_MAX_AGE s, and a 0.7.0 sidecar (qmi_pcc_rsrp is set);
#   - network_type is LTE, or 5G-NSA with QENG showing the NR leg. SA, NR-CA
#     and an NR PCC always read AT+QCAINFO;
#   - QENG has a LTE PCI/EARFCN and QMI's PCC equals both;
#   - the last AT parse had at most one NR row, as an SCC (_QMC_AT_ONLY=0);
#   - with an NR leg: a cache of exactly that one NR row (same ARFCN and PCI as
#     QENG's) not older than QMI_CA_NR_MAX_AGE s, else AT+QCAINFO refreshes it;
#   - every populated carrier slot is complete and numeric, the PCC has its
#     three signal values, and the SCC slot count equals qmi_ca_count - 1 (a
#     dropped fifth SCC would otherwise look like a smaller aggregation).
# An SCC whose signal is empty (unmatched in the broker) publishes null rather
# than a neighbour's value; SCC SINR is always null (AT reports 0 here).
#
# Published: t2_* (same shapes parse_ca_info writes), ca_source (qmi | mixed),
# _CA_READ_MONO = the sidecar read time. In a mixed list the NR row is up to
# QMI_CA_NR_MAX_AGE s older than that; ca_read_mono labels the LTE data.

QMI_CA_NR_MAX_AGE="${QMI_CA_NR_MAX_AGE:-60}"

# Published as device.ca_source (qmi | at | mixed); the poller sets "at" after
# every AT+QCAINFO parse or failure, and leaves it alone on a busy skip.
ca_source="at"

# NR cache from the last successful AT parse (qmi_ca_cache_update).
_QMC_AT_ONLY=0      # 1: last parse had an NR PCC, 2+ NR rows or was unreadable
_QMC_VALID=0        # 1: a successful parse is cached
_QMC_NR_N=0         # NR rows in that parse
_QMC_NR_ROWS=""     # ",{row}" text ready to append to the array
_QMC_NR_MHZ=0       # their bandwidth contribution to total_bandwidth_mhz
_QMC_NR_DET=""      # " + N41: 60 MHz" text for bandwidth_details
_QMC_NR_ARFCN=""
_QMC_NR_PCI=""
_QMC_NR_MONO=0

# qmi_ca_cache_reset: forget the cache.
qmi_ca_cache_reset() {
    _QMC_AT_ONLY=0
    _QMC_VALID=0
    _QMC_NR_N=0
    _QMC_NR_ROWS=""
    _QMC_NR_MHZ=0
    _QMC_NR_DET=""
    _QMC_NR_ARFCN=""
    _QMC_NR_PCI=""
    _QMC_NR_MONO=0
}

# qmi_ca_cache_update <carrier_components JSON from parse_ca_info>: cache the
# NR rows. Builtins only. An array that is not the parser's exact shape is not
# trusted: the poller then keeps reading AT+QCAINFO.
qmi_ca_cache_update() {
    qmi_ca_cache_reset
    _qcu_b="$1"
    case "$_qcu_b" in
        '[]') _QMC_VALID=1; _QMC_NR_MONO="${_MONO_TOP:-0}"; return 0 ;;
        '[{"type":"'*'}]') ;;
        *) _QMC_AT_ONLY=1; return 0 ;;
    esac
    _QMC_VALID=1
    _QMC_NR_MONO="${_MONO_TOP:-0}"
    case "$_qcu_b" in
        *'"technology":"NR"'*) ;;
        *) return 0 ;;
    esac
    _qcu_b="${_qcu_b#\[\{}"
    _qcu_b="${_qcu_b%\}\]}"
    _qcu_last=0
    _qcu_sep="},{"
    _qcu_pb='"band":"'
    _qcu_pw='"bandwidth_mhz":'
    _qcu_pe='"earfcn":'
    _qcu_pp='"pci":'
    while [ "$_qcu_last" = "0" ]; do
        case "$_qcu_b" in
            *"$_qcu_sep"*)
                _qcu_o=${_qcu_b%%"$_qcu_sep"*}
                _qcu_b=${_qcu_b#*"$_qcu_sep"}
                ;;
            *)
                _qcu_o="$_qcu_b"
                _qcu_last=1
                ;;
        esac
        case "$_qcu_o" in
            '"type":"'*'"sinr":'*) ;;
            *) _QMC_AT_ONLY=1; return 0 ;;
        esac
        case "$_qcu_o" in
            *'"technology":"NR"'*) ;;
            *) continue ;;
        esac
        case "$_qcu_o" in
            '"type":"PCC"'*) _QMC_AT_ONLY=1 ;;
        esac
        _QMC_NR_N=$((_QMC_NR_N + 1))
        _QMC_NR_ROWS="$_QMC_NR_ROWS,{$_qcu_o}"
        _qcu_x=${_qcu_o#*"$_qcu_pb"}
        _qcu_band=${_qcu_x%%\"*}
        _qcu_x=${_qcu_o#*"$_qcu_pw"}
        _qcu_bw=${_qcu_x%%,*}
        _qcu_x=${_qcu_o#*"$_qcu_pe"}
        _QMC_NR_ARFCN=${_qcu_x%%,*}
        _qcu_x=${_qcu_o#*"$_qcu_pp"}
        _QMC_NR_PCI=${_qcu_x%%,*}
        case "$_qcu_bw" in
            ''|*[!0-9]*|0) ;;
            *)
                _QMC_NR_MHZ=$((_QMC_NR_MHZ + _qcu_bw))
                _QMC_NR_DET="$_QMC_NR_DET + $_qcu_band: $_qcu_bw MHz"
                ;;
        esac
    done
    [ "$_QMC_NR_N" -gt 1 ] && _QMC_AT_ONLY=1
    return 0
}

# _qmi_ca_slot <type> <band> <earfcn> <bw> <pci> <rsrp> <rsrq> <rssi> <sinr>:
# append one LTE carrier object (parse_ca_info's key order and number format)
# to _qmc_arr and its bandwidth to _qmc_tot / _qmc_det. Returns 1 when the slot
# is not complete and numeric. rsrp/rsrq/rssi/sinr may be empty (null).
_qmi_ca_slot() {
    _qmi_int "$2" || return 1
    [ "$2" -gt 0 ] || return 1
    _qmi_int "$3" || return 1
    _qmi_int "$5" || return 1
    case "$4" in ''|*[!0-9]*) return 1 ;; esac
    _qcs_rsrp="null"
    _qcs_rsrq="null"
    _qcs_rssi="null"
    _qcs_sinr="null"
    if [ -n "$6" ]; then _qmi_int "$6" || return 1; _qcs_rsrp="$6"; fi
    if [ -n "$7" ]; then _qmi_int "$7" || return 1; _qcs_rsrq="$7"; fi
    if [ -n "$8" ]; then _qmi_int "$8" || return 1; _qcs_rssi="$8"; fi
    if [ -n "$9" ]; then _qmi_int "$9" || return 1; _qcs_sinr="$9"; fi
    _qcs_o="{\"type\":\"$1\",\"technology\":\"LTE\",\"band\":\"B$2\",\"earfcn\":$3,\"bandwidth_mhz\":$4,\"pci\":$5,\"rsrp\":$_qcs_rsrp,\"rsrq\":$_qcs_rsrq,\"rssi\":$_qcs_rssi,\"sinr\":$_qcs_sinr}"
    _qmc_arr="${_qmc_arr:+$_qmc_arr,}$_qcs_o"
    if [ "$4" -gt 0 ]; then
        _qmc_tot=$((_qmc_tot + $4))
        _qmc_det="${_qmc_det:+$_qmc_det + }B$2: $4 MHz"
    fi
    return 0
}

# _qmi_ca_scc <pci> <earfcn> <band> <bw> <rsrp> <rsrq> <rssi>: skip an
# all-empty slot, else append it as an SCC (SINR null) and count it.
_qmi_ca_scc() {
    if [ -z "$1$2$3$4" ]; then
        return 0
    fi
    _qmi_ca_slot SCC "$3" "$2" "$4" "$1" "$5" "$6" "$7" "" || return 1
    _qmc_scc_n=$((_qmc_scc_n + 1))
    return 0
}

qmi_ca_build() {
    [ "${_QENG_PARSED:-0}" = "1" ] || return 1
    [ "$_QMI_OK" = "1" ] || return 1
    [ "$_QMI_STATE" = "up" ] || return 1
    [ "$qmi_registered" = "1" ] || return 1
    [ -n "${qmi_pcc_rsrp+x}" ] || return 1
    qm_trusted_file "$QMI_SCAN_FLAG" && return 1
    [ -f "$QMI_SIMSW_FLAG" ] && return 1
    [ "$system_state" = "scan_in_progress" ] && return 1
    case "${_MONO_TOP:-0}" in ''|0|*[!0-9]*) return 1 ;; esac
    [ "$_QMI_READ_MONO" -gt 0 ] || return 1
    [ "$_MONO_TOP" -ge "$_QMI_READ_MONO" ] || return 1
    [ $((_MONO_TOP - _QMI_READ_MONO)) -le "$QMI_MAX_AGE" ] || return 1

    [ "$_QMC_AT_ONLY" = "0" ] || return 1
    _qmi_int "$lte_pci" || return 1
    _qmi_int "$lte_earfcn" || return 1
    _qmi_int "$qmi_pcc_pci" || return 1
    _qmi_int "$qmi_pcc_earfcn" || return 1
    [ "$qmi_pcc_pci" = "$lte_pci" ] || return 1
    [ "$qmi_pcc_earfcn" = "$lte_earfcn" ] || return 1
    _qmi_int "$qmi_pcc_rsrp" || return 1
    _qmi_int "$qmi_pcc_rsrq" || return 1
    _qmi_int "$qmi_pcc_rssi" || return 1
    _qmi_int "$qmi_ca_count" || return 1

    _qmc_src="qmi"
    if [ -n "$nr_arfcn" ]; then
        [ "$network_type" = "5G-NSA" ] || return 1
        [ "$_QMC_VALID" = "1" ] || return 1
        [ "$_QMC_NR_N" = "1" ] || return 1
        [ "$nr_arfcn" = "$_QMC_NR_ARFCN" ] || return 1
        [ "$nr_pci" = "$_QMC_NR_PCI" ] || return 1
        [ "$_MONO_TOP" -ge "$_QMC_NR_MONO" ] || return 1
        [ $((_MONO_TOP - _QMC_NR_MONO)) -le "$QMI_CA_NR_MAX_AGE" ] || return 1
        _qmc_src="mixed"
    else
        [ "$network_type" = "LTE" ] || return 1
    fi

    _qmc_arr=""
    _qmc_tot=0
    _qmc_det=""
    _qmc_scc_n=0
    _qmi_ca_slot PCC "$qmi_pcc_band" "$qmi_pcc_earfcn" "$qmi_pcc_bw_mhz" "$qmi_pcc_pci" \
        "$qmi_pcc_rsrp" "$qmi_pcc_rsrq" "$qmi_pcc_rssi" "$qmi_pcc_sinr" || return 1
    _qmi_ca_scc "$qmi_scc1_pci" "$qmi_scc1_earfcn" "$qmi_scc1_band" "$qmi_scc1_bw_mhz" \
        "$qmi_scc1_rsrp" "$qmi_scc1_rsrq" "$qmi_scc1_rssi" || return 1
    _qmi_ca_scc "$qmi_scc2_pci" "$qmi_scc2_earfcn" "$qmi_scc2_band" "$qmi_scc2_bw_mhz" \
        "$qmi_scc2_rsrp" "$qmi_scc2_rsrq" "$qmi_scc2_rssi" || return 1
    _qmi_ca_scc "$qmi_scc3_pci" "$qmi_scc3_earfcn" "$qmi_scc3_band" "$qmi_scc3_bw_mhz" \
        "$qmi_scc3_rsrp" "$qmi_scc3_rsrq" "$qmi_scc3_rssi" || return 1
    _qmi_ca_scc "$qmi_scc4_pci" "$qmi_scc4_earfcn" "$qmi_scc4_band" "$qmi_scc4_bw_mhz" \
        "$qmi_scc4_rsrp" "$qmi_scc4_rsrq" "$qmi_scc4_rssi" || return 1
    [ $((qmi_ca_count - 1)) -eq "$_qmc_scc_n" ] || return 1

    if [ "$_qmc_scc_n" -gt 0 ]; then
        t2_ca_active=true
        t2_ca_count=$_qmc_scc_n
    else
        t2_ca_active=false
        t2_ca_count=0
    fi
    t2_nr_ca_active=false
    t2_nr_ca_count=0
    if [ "$_qmc_src" = "mixed" ]; then
        t2_total_bandwidth_mhz=$((_qmc_tot + _QMC_NR_MHZ))
        t2_bandwidth_details="${_qmc_det}${_QMC_NR_DET}"
        t2_carrier_components="[${_qmc_arr}${_QMC_NR_ROWS}]"
    else
        t2_total_bandwidth_mhz=$_qmc_tot
        t2_bandwidth_details="$_qmc_det"
        t2_carrier_components="[${_qmc_arr}]"
    fi
    ca_source="$_qmc_src"
    _CA_READ_MONO="$_QMI_READ_MONO"
    return 0
}
