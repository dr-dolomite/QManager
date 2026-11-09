#!/bin/sh
# history_series_cellular.sh — Cellular History series (docs/features/history.md).
#
# Dot-sourced by history.sh inside the poller. Reads the poller's globals as
# status.json reports them this cycle (hist_tick runs inside the QMI overlay
# window), builtins only: no forks, no AT.

HIST_SERIES="$HIST_SERIES cellular"
HIST_cellular_STATES="nr lte down off"
HIST_cellular_FAULT="down"
HIST_cellular_METRICS="lte_rsrp lte_rsrq lte_sinr lte_rssi nr_rsrp nr_rsrq nr_sinr"
HIST_cellular_EVENTS="signal_lost signal_restored nr_anchor pci_change scc_pci_change band_change ca_change"
HIST_cellular_EVENTS_KEEP="signal_lost signal_restored"
HIST_cellular_PAIRS="signal_lost:signal_restored"
# Max age (s) of a QMI read that may mark the series down (SSR window).
HIST_CL_QMI_MAX_AGE="${HIST_CL_QMI_MAX_AGE:-10}"

# _hcl_v VALUE LO HI -> _HI = integer within LO..HI, else empty (no reading).
_hcl_v() {
    _hist_int "$1"
    [ -n "$_HI" ] || return 0
    if [ "$_HI" -lt "$2" ] || [ "$_HI" -gt "$3" ]; then
        _HI=""
    fi
}

hist_cellular_sample() {
    _HV_lte_rsrp=""
    _HV_lte_rsrq=""
    _HV_lte_sinr=""
    _HV_lte_rssi=""
    _HV_nr_rsrp=""
    _HV_nr_rsrq=""
    _HV_nr_sinr=""
    case "$t1_cfun" in
        0|4) _HS="off"; return 0 ;;
    esac
    # QMI lane says the baseband is down (SSR window). The AT state lags up to
    # 60 s in Deep, so a 15 s SSR would never show. Only a fresh read (<= 10 s
    # on the uptime clock) counts: a dead broker leaves its last sidecar behind.
    if [ "${_QMI_OK:-0}" = "1" ] && [ "$_QMI_STATE" = "down" ]; then
        case "${_MONO_TOP:-x}/${_QMI_READ_MONO:-x}" in
            *[!0-9/]*) ;;
            *)
                if [ "$_MONO_TOP" -ge "$_QMI_READ_MONO" ] \
                    && [ $((_MONO_TOP - _QMI_READ_MONO)) -le "$HIST_CL_QMI_MAX_AGE" ]; then
                    _HS="down"
                    return 0
                fi
                ;;
        esac
    fi
    if [ "$modem_reachable" != "true" ]; then
        _HS="down"
        return 0
    fi
    case "$service_status" in
        ''|unknown|sim_error|no_service|searching) _HS="down"; return 0 ;;
    esac
    if [ "$nr_state" = "connected" ]; then
        _HS="nr"
    elif [ "$lte_state" = "connected" ]; then
        _HS="lte"
    else
        _HS="down"
        return 0
    fi
    if [ "$lte_state" = "connected" ]; then
        _hcl_v "$lte_rsrp" -150 0;  _HV_lte_rsrp="$_HI"
        _hcl_v "$lte_rsrq" -40 0;   _HV_lte_rsrq="$_HI"
        _hcl_v "$lte_sinr" -30 50;  _HV_lte_sinr="$_HI"
        _hcl_v "$lte_rssi" -130 0;  _HV_lte_rssi="$_HI"
    fi
    if [ "$nr_state" = "connected" ]; then
        _hcl_v "$nr_rsrp" -150 0;   _HV_nr_rsrp="$_HI"
        _hcl_v "$nr_rsrq" -40 0;    _HV_nr_rsrq="$_HI"
        _hcl_v "$nr_sinr" -30 50;   _HV_nr_sinr="$_HI"
    fi
    return 0
}

# hist_cellular_radio TYPE MESSAGE -> _HR = lte | nr | empty.
hist_cellular_radio() {
    _HR=""
    case "$2" in
        LTE*) _HR="lte"; return 0 ;;
        NR*|5G*) _HR="nr"; return 0 ;;
    esac
    case "$1" in
        nr_anchor) _HR="nr" ;;
        signal_restored)
            if [ "$nr_state" = "connected" ]; then
                _HR="nr"
            elif [ "$lte_state" = "connected" ]; then
                _HR="lte"
            fi
            ;;
    esac
    return 0
}
