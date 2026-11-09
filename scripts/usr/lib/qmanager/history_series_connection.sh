#!/bin/sh
# history_series_connection.sh — Connection History series (docs/features/history.md).
#
# Dot-sourced by history.sh inside the poller. Reads the Connection Quality
# globals the poller already holds (read_ping_data / read_dns_data run every
# cycle), builtins only: no forks, no probes, no AT.
#
# States: up / down from the ping daemon's reachability; off while the radio
# is off (CFUN 0/4, not an outage). Ping data missing or stale (reachability
# "null") takes no sample, so that time reads as no data.
# "Slow or lossy" is not stored: the page derives it per bucket from the
# current limits, so a changed limit recolours past buckets too.

HIST_SERIES="$HIST_SERIES connection"
HIST_connection_STATES="up down off"
HIST_connection_FAULT="down"
HIST_connection_METRICS="lat_ms jit_ms loss_pct dns_ms"
HIST_connection_EVENTS="internet_lost internet_restored high_latency latency_recovered high_packet_loss packet_loss_recovered watchcat_recovery sim_failover"
HIST_connection_EVENTS_KEEP="internet_lost internet_restored sim_failover"
HIST_connection_PAIRS="internet_lost:internet_restored high_latency:latency_recovered high_packet_loss:packet_loss_recovered"

# _hcn_v VALUE HI -> _HI = VALUE rounded to a whole number within 0..HI,
# else empty (no reading). Accepts "62", "62.4", "62.50".
_hcn_v() {
    local _w
    local _f
    _HI=""
    case "$1" in
        ''|null|.*|*.*.*|*[!0-9.]*) return 0 ;;
    esac
    _w="${1%%.*}"
    _f=""
    case "$1" in *.*) _f="${1#*.}" ;; esac
    _w="${_w#"${_w%%[!0]*}"}"
    [ -n "$_w" ] || _w=0
    [ "${#_w}" -le 6 ] || return 0
    case "$_f" in [5-9]*) _w=$((_w + 1)) ;; esac
    [ "$_w" -le "$2" ] || return 0
    _HI="$_w"
}

hist_connection_sample() {
    _HV_lat_ms=""
    _HV_jit_ms=""
    _HV_loss_pct=""
    _HV_dns_ms=""
    case "$t1_cfun" in
        0|4) _HS="off"; return 0 ;;
    esac
    case "$conn_internet_available" in
        true) _HS="up" ;;
        false) _HS="down"; return 0 ;;
        *) _HS=""; return 0 ;;
    esac
    _hcn_v "$conn_latency" 60000;     _HV_lat_ms="$_HI"
    _hcn_v "$conn_jitter" 60000;      _HV_jit_ms="$_HI"
    _hcn_v "$conn_packet_loss" 100;   _HV_loss_pct="$_HI"
    _hcn_v "$dns_lookup_ms" 60000;    _HV_dns_ms="$_HI"
    return 0
}
