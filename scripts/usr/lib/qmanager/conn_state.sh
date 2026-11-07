#!/bin/sh
# =============================================================================
# conn_state.sh — the one reader of the ping daemon's cache + cadence resolver
# =============================================================================
# Sourced (never executed) by qmanager_poller, qmanager_watchcat, qmanager_ping
# and the ping_profile / watchdog CGIs. POSIX sh / BusyBox ash safe; jq is used
# without regex (the device jq has no Oniguruma).
#
#   conn_state_read     one jq read of /tmp/qmanager_ping.json into CQ_* vars,
#                       with the single staleness rule. Fail-closed: any
#                       problem leaves CQ_STALE=1 and CQ_REACHABLE="null"
#                       (unknown — never treated as down or as up).
#   conn_state_why      reason for the last stale/failed read (for logs)
#   conn_state_is_up    fresh read with reachable=true
#   conn_state_resolve  sensitivity name -> cadence table (pure, no config read)
#   conn_state_cadence  same, reading connection_quality from the config store
#   conn_state_tables_json  the contract tables object (generated from resolve)
#   cq_ring_stats       history ring -> min/avg/max/jitter/loss + <=60 points
#   cq_alert_after_min  (moved to qm_platform_cqwd.sh, still reachable here:
#                       this file sources the platform adapter)
#
# All helper state is global and prefixed _cq_ (no `local`, so it can be
# called from any scope).
# =============================================================================

[ -n "${_CONN_STATE_LOADED:-}" ] && return 0
_CONN_STATE_LOADED=1

# Platform adapter (cfg_get, PF_RUN_DIR, cq_alert_after_min). Idempotent.
[ -f /usr/lib/qmanager/qm_platform_cqwd.sh ] && . /usr/lib/qmanager/qm_platform_cqwd.sh

CQ_PING_CACHE="${CQ_PING_CACHE:-/tmp/qmanager_ping.json}"
_CQ_TAB=$(printf '\t')

# Neutral values for a stale / missing / unreadable cache.
_cq_reset() {
    CQ_STALE=1
    CQ_STALE_REASON=""
    CQ_AGE_SEC=""
    CQ_STALE_THRESHOLD=15
    CQ_TIMESTAMP=""
    CQ_MONO=""
    CQ_REACHABLE="null"
    CQ_RTT_MS="null"
    CQ_STREAK_SUCCESS=0
    CQ_STREAK_FAIL=0
    CQ_FAIL_ELAPSED=0
    CQ_DURING_RECOVERY="false"
    CQ_INTERVAL_SEC=5
    CQ_SENSITIVITY=""
    CQ_LAST_FAMILY=""
    CQ_TARGET=""
    CQ_FAIL_SECS=""
    CQ_RECOVER_SECS=""
    CQ_LAST_LEG=0
    CQ_CYCLE_MS=""
}
_cq_reset

# conn_state_read: returns 0 when the cache is fresh, 1 when it is stale,
# missing or unreadable (verdict vars are then the neutral values above).
# Stale = age > max(3 * interval_sec, 15); interval_sec outside 1-300 is
# clamped to 5. Age comes from the cache `mono` against /proc/uptime; the wall
# clock (date +%s - timestamp) is used only when mono is absent or 0, because
# NITZ/NTP steps the wall clock. mono ahead of uptime cannot come from this
# boot's daemon (/tmp is tmpfs), so it is treated as garbage = stale.
conn_state_read() {
    _cq_reset
    if [ ! -f "$CQ_PING_CACHE" ]; then
        CQ_STALE_REASON="missing"
        return 1
    fi

    # "-" stands in for empty/null: IFS whitespace (tab) collapses empty fields.
    _cq_row=$(jq -r 'def s: if . == null or . == "" then "-" else tostring end;
        [(.timestamp|s), (.mono|s), (.reachable|s), (.last_rtt_ms|s),
         (.streak_success|s), (.streak_fail|s), (.fail_elapsed_sec|s), (.during_recovery|s),
         (.interval_sec|s), (.fail_secs|s), (.recover_secs|s), (.sensitivity|s),
         (.last_family|s), ((.targets // [])[0]|s), (.last_leg|s),
         (.cycle_ms|s)] | @tsv' \
        "$CQ_PING_CACHE" 2>/dev/null </dev/null)
    if [ -z "$_cq_row" ]; then
        CQ_STALE_REASON="unreadable"
        return 1
    fi

    IFS="$_CQ_TAB" read -r _cq_ts _cq_mono _cq_reach _cq_rtt _cq_ss _cq_sf _cq_fe _cq_dr \
        _cq_iv _cq_fs _cq_rs _cq_sens _cq_fam _cq_tgt _cq_leg _cq_cyc <<EOF
$_cq_row
EOF

    case "$_cq_ts" in
        ''|*[!0-9]*)
            CQ_STALE_REASON="no timestamp"
            return 1
            ;;
    esac

    case "$_cq_iv" in ''|*[!0-9]*) _cq_iv=5 ;; esac
    if [ "$_cq_iv" -lt 1 ] || [ "$_cq_iv" -gt 300 ]; then
        _cq_iv=5
    fi
    CQ_INTERVAL_SEC="$_cq_iv"
    CQ_STALE_THRESHOLD=$((3 * _cq_iv))
    [ "$CQ_STALE_THRESHOLD" -lt 15 ] && CQ_STALE_THRESHOLD=15

    _cq_age=""
    case "$_cq_mono" in
        ''|*[!0-9]*|0) ;;
        *)
            _cq_up=""
            { read -r _cq_up _cq_idle < /proc/uptime; } 2>/dev/null
            _cq_up="${_cq_up%%.*}"
            case "$_cq_up" in
                ''|*[!0-9]*) ;;
                *)
                    CQ_MONO="$_cq_mono"
                    _cq_age=$((_cq_up - _cq_mono))
                    if [ "$_cq_age" -lt 0 ]; then
                        CQ_AGE_SEC="$_cq_age"
                        CQ_STALE_REASON="mono ahead of uptime"
                        return 1
                    fi
                    ;;
            esac
            ;;
    esac
    [ -z "$_cq_age" ] && _cq_age=$(( $(date +%s) - _cq_ts ))
    CQ_AGE_SEC="$_cq_age"
    if [ "$_cq_age" -gt "$CQ_STALE_THRESHOLD" ]; then
        CQ_STALE_REASON="age ${_cq_age}s > ${CQ_STALE_THRESHOLD}s"
        return 1
    fi

    CQ_STALE=0
    CQ_TIMESTAMP="$_cq_ts"
    case "$_cq_reach" in true|false) CQ_REACHABLE="$_cq_reach" ;; esac
    case "$_cq_rtt" in ''|-|*[!0-9.]*) ;; *) CQ_RTT_MS="$_cq_rtt" ;; esac
    case "$_cq_ss" in ''|*[!0-9]*) ;; *) CQ_STREAK_SUCCESS="$_cq_ss" ;; esac
    case "$_cq_sf" in ''|*[!0-9]*) ;; *) CQ_STREAK_FAIL="$_cq_sf" ;; esac
    case "$_cq_fe" in ''|*[!0-9]*) ;; *) CQ_FAIL_ELAPSED="$_cq_fe" ;; esac
    [ "$_cq_dr" = "true" ] && CQ_DURING_RECOVERY="true"
    case "$_cq_fs" in ''|*[!0-9]*) ;; *) CQ_FAIL_SECS="$_cq_fs" ;; esac
    case "$_cq_rs" in ''|*[!0-9]*) ;; *) CQ_RECOVER_SECS="$_cq_rs" ;; esac
    [ "$_cq_sens" != "-" ] && CQ_SENSITIVITY="$_cq_sens"
    [ "$_cq_fam" != "-" ] && CQ_LAST_FAMILY="$_cq_fam"
    [ "$_cq_tgt" != "-" ] && CQ_TARGET="$_cq_tgt"
    case "$_cq_leg" in [0-4]) CQ_LAST_LEG="$_cq_leg" ;; esac
    case "$_cq_cyc" in ''|*[!0-9]*) ;; *) CQ_CYCLE_MS="$_cq_cyc" ;; esac
    return 0
}

# ---------------------------------------------------------------------------
# Sidecar reader (B5.29 Phase C). qmanager_ping also writes the 16 raw fields
# conn_state_read extracts with jq to PF_RUN_DIR/ping.env (shell
# assignments, tmp + mv, written after ping.json). The poller reads that with
# builtins instead of forking jq every cycle. conn_state_read above is
# unchanged and stays the watchcat's reader.
# ---------------------------------------------------------------------------
CQ_PING_ENV="${CQ_PING_ENV:-${PF_RUN_DIR:-/var/run/qmanager}/ping.env}"

# cq_env_source <file>: source a sidecar only if it is complete and plain.
# Every line must be a single-quoted assignment and the last must be the end
# marker. A BusyBox syntax error in a dot-sourced file aborts the whole script,
# so anything else returns 1 without sourcing.
cq_env_source() {
    _ces_last=""
    _ces_bad=0
    [ -f "$1" ] || return 1
    {
        while IFS= read -r _ces_l; do
            case "$_ces_l" in
                [A-Za-z_]*=\'*\') ;;
                *) _ces_bad=1 ;;
            esac
            _ces_last="$_ces_l"
        done < "$1"
    } 2>/dev/null
    [ "$_ces_bad" = "0" ] || return 1
    [ "$_ces_last" = "qm_sidecar_end='1'" ] || return 1
    . "$1"
}

# conn_state_read_env: conn_state_read from the sidecar. Same contract and same
# CQ_* results; returns 2 (nothing read, nothing changed) when the sidecar is
# absent, older than ping.json (upgrade window, daemon not restarted, failed
# write) or incomplete, so the caller falls back to conn_state_read. The
# evaluation below must stay in lockstep with conn_state_read.
conn_state_read_env() {
    [ -f "$CQ_PING_CACHE" ] || return 2
    [ -f "$CQ_PING_ENV" ] || return 2
    [ "$CQ_PING_CACHE" -nt "$CQ_PING_ENV" ] && return 2
    _cq_ts=""; _cq_mono=""; _cq_reach=""; _cq_rtt=""; _cq_ss=""; _cq_sf=""; _cq_fe=""
    _cq_dr=""; _cq_iv=""; _cq_fs=""; _cq_rs=""; _cq_sens=""; _cq_fam=""; _cq_tgt=""
    _cq_leg=""; _cq_cyc=""
    cq_env_source "$CQ_PING_ENV" || return 2
    _cq_reset

    case "$_cq_ts" in
        ''|*[!0-9]*)
            CQ_STALE_REASON="no timestamp"
            return 1
            ;;
    esac

    case "$_cq_iv" in ''|*[!0-9]*) _cq_iv=5 ;; esac
    if [ "$_cq_iv" -lt 1 ] || [ "$_cq_iv" -gt 300 ]; then
        _cq_iv=5
    fi
    CQ_INTERVAL_SEC="$_cq_iv"
    CQ_STALE_THRESHOLD=$((3 * _cq_iv))
    [ "$CQ_STALE_THRESHOLD" -lt 15 ] && CQ_STALE_THRESHOLD=15

    _cq_age=""
    case "$_cq_mono" in
        ''|*[!0-9]*|0) ;;
        *)
            _cq_up=""
            { read -r _cq_up _cq_idle < /proc/uptime; } 2>/dev/null
            _cq_up="${_cq_up%%.*}"
            case "$_cq_up" in
                ''|*[!0-9]*) ;;
                *)
                    CQ_MONO="$_cq_mono"
                    _cq_age=$((_cq_up - _cq_mono))
                    if [ "$_cq_age" -lt 0 ]; then
                        CQ_AGE_SEC="$_cq_age"
                        CQ_STALE_REASON="mono ahead of uptime"
                        return 1
                    fi
                    ;;
            esac
            ;;
    esac
    [ -z "$_cq_age" ] && _cq_age=$(( $(date +%s) - _cq_ts ))
    CQ_AGE_SEC="$_cq_age"
    if [ "$_cq_age" -gt "$CQ_STALE_THRESHOLD" ]; then
        CQ_STALE_REASON="age ${_cq_age}s > ${CQ_STALE_THRESHOLD}s"
        return 1
    fi

    CQ_STALE=0
    CQ_TIMESTAMP="$_cq_ts"
    case "$_cq_reach" in true|false) CQ_REACHABLE="$_cq_reach" ;; esac
    case "$_cq_rtt" in ''|-|*[!0-9.]*) ;; *) CQ_RTT_MS="$_cq_rtt" ;; esac
    case "$_cq_ss" in ''|*[!0-9]*) ;; *) CQ_STREAK_SUCCESS="$_cq_ss" ;; esac
    case "$_cq_sf" in ''|*[!0-9]*) ;; *) CQ_STREAK_FAIL="$_cq_sf" ;; esac
    case "$_cq_fe" in ''|*[!0-9]*) ;; *) CQ_FAIL_ELAPSED="$_cq_fe" ;; esac
    [ "$_cq_dr" = "true" ] && CQ_DURING_RECOVERY="true"
    case "$_cq_fs" in ''|*[!0-9]*) ;; *) CQ_FAIL_SECS="$_cq_fs" ;; esac
    case "$_cq_rs" in ''|*[!0-9]*) ;; *) CQ_RECOVER_SECS="$_cq_rs" ;; esac
    [ "$_cq_sens" != "-" ] && CQ_SENSITIVITY="$_cq_sens"
    [ "$_cq_fam" != "-" ] && CQ_LAST_FAMILY="$_cq_fam"
    [ "$_cq_tgt" != "-" ] && CQ_TARGET="$_cq_tgt"
    case "$_cq_leg" in [0-4]) CQ_LAST_LEG="$_cq_leg" ;; esac
    case "$_cq_cyc" in ''|*[!0-9]*) ;; *) CQ_CYCLE_MS="$_cq_cyc" ;; esac
    return 0
}

conn_state_why() {
    printf '%s' "${CQ_STALE_REASON:-unknown}"
}

conn_state_is_up() {
    [ "$CQ_STALE" = "0" ] && [ "$CQ_REACHABLE" = "true" ]
}

# conn_state_resolve <sensitivity>
# The ONE sensitivity table (seconds); there is no other copy. Unknown or empty
# -> relaxed. Pure: no config read, no override argument.
#
#   sensitivity  interval  fail  recover  window  qdeb  qdeb_vt
#   sensitive        1       8      3       300     12      8
#   regular          2      12      6       300     12      8
#   relaxed          5      20     10       300     15     10
#   quiet           10      40     20       600     30     20
#
# Ring size = ceil(window / interval).
# Sets: CQ_CFG_SENSITIVITY CQ_CFG_INTERVAL_SEC CQ_CFG_FAIL_SECS
#       CQ_CFG_RECOVER_SECS CQ_CFG_WINDOW_SEC CQ_CFG_RING_SIZE CQ_CFG_QDEB_SEC
#       CQ_CFG_QDEB_VT_SEC. CQ_CFG_PROFILE and CQ_CFG_PROFILE_INTERVAL_SEC are
#       transitional aliases (sensitivity, interval) for the CGIs that still
#       carry the old names until their rewrite.
conn_state_resolve() {
    CQ_CFG_SENSITIVITY="$1"
    case "$CQ_CFG_SENSITIVITY" in
        sensitive)
            CQ_CFG_INTERVAL_SEC=1;  CQ_CFG_FAIL_SECS=8;  CQ_CFG_RECOVER_SECS=3
            CQ_CFG_WINDOW_SEC=300;  CQ_CFG_QDEB_SEC=12;  CQ_CFG_QDEB_VT_SEC=8
            ;;
        regular)
            CQ_CFG_INTERVAL_SEC=2;  CQ_CFG_FAIL_SECS=12; CQ_CFG_RECOVER_SECS=6
            CQ_CFG_WINDOW_SEC=300;  CQ_CFG_QDEB_SEC=12;  CQ_CFG_QDEB_VT_SEC=8
            ;;
        quiet)
            CQ_CFG_INTERVAL_SEC=10; CQ_CFG_FAIL_SECS=40; CQ_CFG_RECOVER_SECS=20
            CQ_CFG_WINDOW_SEC=600;  CQ_CFG_QDEB_SEC=30;  CQ_CFG_QDEB_VT_SEC=20
            ;;
        *)
            CQ_CFG_SENSITIVITY="relaxed"
            CQ_CFG_INTERVAL_SEC=5;  CQ_CFG_FAIL_SECS=20; CQ_CFG_RECOVER_SECS=10
            CQ_CFG_WINDOW_SEC=300;  CQ_CFG_QDEB_SEC=15;  CQ_CFG_QDEB_VT_SEC=10
            ;;
    esac
    CQ_CFG_RING_SIZE=$(( (CQ_CFG_WINDOW_SEC + CQ_CFG_INTERVAL_SEC - 1) / CQ_CFG_INTERVAL_SEC ))
    CQ_CFG_PROFILE="$CQ_CFG_SENSITIVITY"
    CQ_CFG_PROFILE_INTERVAL_SEC="$CQ_CFG_INTERVAL_SEC"
    return 0
}

# conn_state_cadence: the cadence qmanager_ping runs from the config store
# (connection_quality sensitivity, falling back to the pre-rename `profile`
# key). Correct even while the daemon is down, so CGIs use this rather than
# the cache.
conn_state_cadence() {
    _cq_cfg_sens=$(cfg_get connection_quality sensitivity)
    [ -z "$_cq_cfg_sens" ] && _cq_cfg_sens=$(cfg_get connection_quality profile)
    conn_state_resolve "$_cq_cfg_sens"
}

# conn_state_tables_json: the `tables` object of the connection_quality CGI
# (contract 5.1), generated from conn_state_resolve so the CGI never carries a
# second copy of the table. It walks all four names through conn_state_resolve,
# so it restores the caller's CQ_CFG_* (re-resolving the name that was set on
# entry) before returning; a caller that had resolved nothing keeps the last
# walked name.
conn_state_tables_json() {
    _cq_tj_keep="$CQ_CFG_SENSITIVITY"
    _cq_tj=""
    for _cq_tn in sensitive regular relaxed quiet; do
        conn_state_resolve "$_cq_tn"
        [ -n "$_cq_tj" ] && _cq_tj="$_cq_tj,"
        _cq_tj="$_cq_tj\"$_cq_tn\":{\"interval_sec\":$CQ_CFG_INTERVAL_SEC,\"fail_secs\":$CQ_CFG_FAIL_SECS,\"recover_secs\":$CQ_CFG_RECOVER_SECS,\"window_sec\":$CQ_CFG_WINDOW_SEC,\"quality_debounce_sec\":$CQ_CFG_QDEB_SEC,\"quality_debounce_vt_sec\":$CQ_CFG_QDEB_VT_SEC}"
    done
    [ -n "$_cq_tj_keep" ] && conn_state_resolve "$_cq_tj_keep"
    printf '{"sensitivity":{%s},"presets":{"latency":{"standard":150,"tolerant":250,"very-tolerant":500},"loss":{"standard":15,"tolerant":30,"very-tolerant":50},"custom_range":{"latency_ms":[1,10000],"loss_pct":[1,100]}}}' "$_cq_tj"
}

# cq_ring_stats <ring_file> <interval_sec> <ring_size> <min_samples>
# The one reducer of the history ring (the poller's stats pass, moved here).
# Reads the last <ring_size> lines ("<rtt|null> <slot|->") and sets:
#   CQ_RS_MIN CQ_RS_AVG CQ_RS_MAX   one-decimal numbers, or "null" with no answer
#   CQ_RS_JITTER                     mean |delta| between consecutive answers of
#                                    the SAME slot (a slot switch is not jitter);
#                                    "null" below <min_samples> samples
#   CQ_RS_LOSS                       integer %, "null" below <min_samples>
#                                    samples (a tiny window would read a couple
#                                    of nulls as huge loss)
#   CQ_RS_HISTORY                    JSON array, oldest first, at most 60 points:
#                                    each is the max RTT of its bucket (raw
#                                    token) or null when the whole bucket was
#                                    lost. Buckets are ceil(ring_size/60) samples
#                                    wide and newest-aligned.
#   CQ_RS_HIST_INTERVAL_SEC          interval_sec * bucket width
#   CQ_RS_HIST_SIZE                  number of points in CQ_RS_HISTORY
# An empty or missing file gives all-null stats, "[]", size 0.
cq_ring_stats() {
    CQ_RS_MIN="null"; CQ_RS_AVG="null"; CQ_RS_MAX="null"
    CQ_RS_JITTER="null"; CQ_RS_LOSS="null"
    CQ_RS_HISTORY="[]"; CQ_RS_HIST_INTERVAL_SEC="$2"; CQ_RS_HIST_SIZE=0
    case "$2" in ''|*[!0-9]*|0) return 0 ;; esac
    case "$3" in ''|*[!0-9]*|0) return 0 ;; esac
    _crs_min="$4"
    case "$_crs_min" in ''|*[!0-9]*) _crs_min=10 ;; esac
    [ -s "$1" ] || return 0
    _crs_out=$(tail -n "$3" "$1" 2>/dev/null | awk -v min_samples="$_crs_min" -v ring="$3" '
        BEGIN { n=0; lost=0; nv=0; have=0; sum=0; jsum=0; nj=0; b=int((ring+59)/60) }
        NF > 0 {
            n++; arr[n]=$1
            if ($1=="null") { lost++ }
            else {
                val=$1+0; sum+=val; nv++
                if (!have||val<min) min=val
                if (!have||val>max) max=val
                have=1
                if (nv>1 && $2==pleg) { d=val-prev; if(d<0)d=-d; jsum+=d; nj++ }
                prev=val; pleg=$2
            }
        }
        END {
            if (n == 0) { print "null|null|null|null|null|[]|" b "|0"; exit }
            mature = (n >= min_samples)
            if (nv>0) printf "%.1f|%.1f|%.1f|", min,sum/nv,max
            else printf "null|null|null|"
            if (mature && nv>0) printf "%.1f|", (nj>0?jsum/nj:0)
            else printf "null|"
            if (mature) printf "%d|", (nv>0 ? int(lost*100/n) : 100)
            else printf "null|"
            nb = int((n-1)/b) + 1
            for (j=0;j<nb;j++) { hv[j]="null" }
            for (i=1;i<=n;i++) {
                j = nb-1-int((n-i)/b)
                if (arr[i]!="null") {
                    if (hv[j]=="null" || arr[i]+0 > hv[j]+0) hv[j]=arr[i]
                }
            }
            printf "["
            for (j=0;j<nb;j++) { if (j>0) printf ","; printf "%s", hv[j] }
            printf "]|%d|%d\n", b, nb
        }' 2>/dev/null)
    [ -n "$_crs_out" ] || return 0
    CQ_RS_MIN="${_crs_out%%|*}";     _crs_out="${_crs_out#*|}"
    CQ_RS_AVG="${_crs_out%%|*}";     _crs_out="${_crs_out#*|}"
    CQ_RS_MAX="${_crs_out%%|*}";     _crs_out="${_crs_out#*|}"
    CQ_RS_JITTER="${_crs_out%%|*}";  _crs_out="${_crs_out#*|}"
    CQ_RS_LOSS="${_crs_out%%|*}";    _crs_out="${_crs_out#*|}"
    CQ_RS_HISTORY="${_crs_out%%|*}"; _crs_out="${_crs_out#*|}"
    _crs_b="${_crs_out%%|*}";         CQ_RS_HIST_SIZE="${_crs_out#*|}"
    CQ_RS_HIST_INTERVAL_SEC=$(( $2 * _crs_b ))
    return 0
}
