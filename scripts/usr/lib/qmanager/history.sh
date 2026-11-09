#!/bin/sh
# history.sh — generic history collector (docs/features/history.md).
#
# Sourced by qmanager_poller. Turns values the poller already holds into
# 30-minute bucket rows on flash, with no AT command and no lock:
#   every cycle      one counter test (hist_tick)
#   every 5 cycles   one sample of every registered series (builtins only)
#   every 3 samples  the open-bucket mirror (one mv per series)
#   bucket close     one printf >> to the RAM queue, then one flash pass for
#                    every series (printf >> day files, one global sync)
#   TERM             hist_flush: the open bucket is queued as a partial row
#                    and everything is flushed (rows merge by t at read time)
# Series register through history_series_<id>.sh files in the lib dir.
#
# Clock: every sample is timed on /proc/uptime (the poller's _MONO_TOP) and
# mapped to wall time through an anchor (offset = wall - mono) taken only when
# the clock is trusted (§5). Before that, samples wait in <id>.pending with
# their mono and are back-dated once. Nothing is ever recorded into 1970.
#
# The poller is the ONLY writer of every file below.

[ -n "$_QM_HISTORY_LOADED" ] && return 0
_QM_HISTORY_LOADED=1

# Overridable for tools/history-test/history-test.sh.
: "${HIST_LIB_DIR:=/usr/lib/qmanager}"
: "${HIST_STORE:=/usrdata/qmanager/history}"
: "${HIST_RUN:=/var/run/qmanager/history}"
: "${HIST_BOOT_ID_FILE:=/proc/sys/kernel/random/boot_id}"
: "${HIST_EVERY:=5}"
: "${HIST_BUCKET:=1800}"
: "${HIST_MAX_DT:=30}"
: "${HIST_STEP_TOL:=120}"
: "${HIST_SETTLE:=300}"
: "${HIST_SANE_EPOCH:=1700000000}"
: "${HIST_RETAIN_DAYS:=31}"
: "${HIST_MAX_KB:=2048}"
: "${HIST_MIN_FREE_KB:=8192}"
: "${HIST_QUEUE_MAX:=96}"
: "${HIST_PENDING_MAX:=360}"
: "${HIST_EV_DAY_MAX:=2000}"
: "${HIST_MIRROR_EVERY:=3}"
: "${HIST_SYNC:=sync}"

HIST_CLOCK="$HIST_RUN/clock.env"

# Registry: each provider appends its id to HIST_SERIES and defines
# HIST_<id>_{STATES,FAULT,METRICS,EVENTS,EVENTS_KEEP} and hist_<id>_sample.
HIST_SERIES=""
for _hist_pf in "$HIST_LIB_DIR"/history_series_*.sh; do
    [ -f "$_hist_pf" ] && . "$_hist_pf"
done
unset _hist_pf

_hist_ready=0
_hist_c=0
_hist_boot=""
_hist_trusted=0
_hist_off=0
_hist_uoff=""
_hist_stepped=0
_hist_pm=""
_hist_hwm=0
_hist_mc=0
_hist_closed=0
_hist_wall=0
_hist_lowfree=0
_hist_resume=0
_hist_today=""

_hist_log() {
    command -v "qlog_$1" >/dev/null 2>&1 && "qlog_$1" "history: $2"
}

# _hist_int VALUE -> _HI = integer part, or empty when not a number.
_hist_int() {
    _HI="${1%%.*}"
    case "$_HI" in
        ''|-|*[!0-9-]*|?*-*) _HI="" ;;
    esac
}

# _hist_in WORD LIST -> 0 when WORD is one of LIST's words.
_hist_in() {
    case " $2 " in *" $1 "*) return 0 ;; esac
    return 1
}

_hist_save_clock() {
    printf "hist_boot='%s'\nhist_trusted='%s'\nhist_offset='%s'\nhist_mono='%s'\n" \
        "$_hist_boot" "$_hist_trusted" "$_hist_off" "$_hist_pm" > "$HIST_CLOCK.tmp" 2>/dev/null \
        && mv -f "$HIST_CLOCK.tmp" "$HIST_CLOCK" 2>/dev/null
}

# _hist_acc_reset ID: clear the open accumulator of one series.
_hist_acc_reset() {
    local _st
    local _mt
    eval "_ha_${1}_t=''; _ha_${1}_x=0; _ha_${1}_any=0"
    eval "_st=\$HIST_${1}_STATES"
    for _mt in $_st; do eval "_ha_${1}_st_${_mt}=0"; done
    eval "_st=\$HIST_${1}_METRICS"
    for _mt in $_st; do eval "_ha_${1}_n_${_mt}=0; _ha_${1}_s_${_mt}=0; _ha_${1}_lo_${_mt}=''; _ha_${1}_hi_${_mt}=''"; done
}

# _hist_row ID -> _HROW = the open accumulator as a bucket row.
_hist_row() {
    local _l
    local _w
    local _v
    local _sep
    local _n
    eval "_HROW=\"{\\\"k\\\":\\\"b\\\",\\\"t\\\":\$_ha_${1}_t,\\\"st\\\":{\""
    eval "_l=\$HIST_${1}_STATES"
    _sep=""
    for _w in $_l; do
        eval "_v=\$_ha_${1}_st_${_w}"
        _HROW="${_HROW}${_sep}\"${_w}\":${_v}"
        _sep=","
    done
    eval "_v=\$_ha_${1}_x"
    _HROW="${_HROW}},\"x\":${_v},\"m\":{"
    eval "_l=\$HIST_${1}_METRICS"
    _sep=""
    for _w in $_l; do
        eval "_n=\$_ha_${1}_n_${_w}"
        [ "$_n" -gt 0 ] 2>/dev/null || continue
        eval "_v=\"\$_n,\$_ha_${1}_s_${_w},\$_ha_${1}_lo_${_w},\$_ha_${1}_hi_${_w}\""
        _HROW="${_HROW}${_sep}\"${_w}\":[${_v}]"
        _sep=","
    done
    _HROW="${_HROW}}}"
}

# _hist_queue_line ID LINE: append to the RAM queue, capped at HIST_QUEUE_MAX.
_hist_queue_line() {
    local _q
    local _n
    _q="$HIST_RUN/$1.queue"
    printf '%s\n' "$2" >> "$_q" 2>/dev/null
    eval "_n=\$((\${_hq_${1}:-0} + 1)); _hq_${1}=\$_n"
    if [ "$_n" -gt $((HIST_QUEUE_MAX * 2)) ]; then
        # A flush that keeps failing (no space): keep the newest rows only.
        tail -n "$HIST_QUEUE_MAX" "$_q" > "$_q.tmp" 2>/dev/null && mv -f "$_q.tmp" "$_q" 2>/dev/null
        eval "_hq_${1}=$HIST_QUEUE_MAX"
        _hist_log warn "$1 queue over cap, oldest rows dropped"
    fi
}

# _hist_close ID: queue the open bucket (if it holds anything) and reset it.
_hist_close() {
    local _t
    local _any
    eval "_t=\$_ha_${1}_t; _any=\$_ha_${1}_any"
    if [ -n "$_t" ] && [ "$_any" = "1" ]; then
        _hist_row "$1"
        _hist_queue_line "$1" "$_HROW"
        _hist_closed=1
        [ $((_t + HIST_BUCKET)) -gt "$_hist_hwm" ] && _hist_hwm=$((_t + HIST_BUCKET))
    fi
    _hist_acc_reset "$1"
}

_hist_close_all() {
    local _s
    for _s in $HIST_SERIES; do _hist_close "$_s"; done
}

# _hist_last_t FILE -> _HT = t of the newest bucket row in FILE (empty if none).
_hist_last_t() {
    local _ln
    _HT=""
    _ln=$(tail -n 64 "$1" 2>/dev/null | grep '^{"k":"b","t":[0-9]*,' | tail -n 1)
    _ln="${_ln#*\"t\":}"
    _ln="${_ln%%,*}"
    case "$_ln" in ''|*[!0-9]*) return 0 ;; esac
    _HT="$_ln"
}

# _hist_backdate ID: turn pre-trust samples and events into rows (one awk).
_hist_backdate() {
    local _p
    local _st
    local _mt
    local _q
    _p="$HIST_RUN/$1.pending"
    [ -s "$_p" ] || { rm -f "$_p"; return 0; }
    # Collecting began at the oldest pending sample (when there is no marker).
    if [ ! -s "$HIST_STORE/$1/since" ]; then
        while IFS='|' read -r _st _mt _q; do
            [ "$_st" = "p" ] || continue
            case "$_mt" in ''|*[!0-9]*) continue ;; esac
            [ $((_mt + _hist_off)) -ge $((_hist_hwm - HIST_BUCKET)) ] || continue
            _hist_write_since "$1" $((_mt + _hist_off))
            break
        done < "$_p"
    fi
    eval "_st=\$HIST_${1}_STATES; _mt=\$HIST_${1}_METRICS"
    _q="$HIST_RUN/$1.queue"
    awk -F'|' -v off="$_hist_off" -v B="$HIST_BUCKET" -v hwm="$_hist_hwm" \
        -v states="$_st" -v metrics="$_mt" '
    BEGIN { ns = split(states, S, " "); nm = split(metrics, M, " ") }
    $1 == "e" {
        t = $2 + off
        if (t < hwm - B) { drop++; next }
        rest = substr($0, length($1) + length($2) + 3)
        printf "{\"k\":\"e\",\"t\":%d,%s\n", t, rest
        next
    }
    $1 == "p" {
        t = $2 + off; k = int(t / B) * B
        if (k < hwm - B) { drop++; next }
        K[k] = 1; ST[k, $4] += $3; X[k] += $5
        for (i = 1; i <= nm; i++) {
            v = $(5 + i); if (v == "") continue
            v += 0; N[k, i]++; SU[k, i] += v
            if (!((k, i) in LO) || v < LO[k, i]) LO[k, i] = v
            if (!((k, i) in HI) || v > HI[k, i]) HI[k, i] = v
        }
    }
    END {
        for (k in K) {
            line = "{\"k\":\"b\",\"t\":" k ",\"st\":{"
            for (j = 1; j <= ns; j++) line = line (j > 1 ? "," : "") "\"" S[j] "\":" (ST[k, S[j]] + 0)
            line = line "},\"x\":" (X[k] + 0) ",\"m\":{"
            sep = ""
            for (i = 1; i <= nm; i++) if (N[k, i] > 0) {
                line = line sep "\"" M[i] "\":[" N[k, i] "," SU[k, i] "," LO[k, i] "," HI[k, i] "]"; sep = ","
            }
            print line "}}"
        }
        if (drop) printf "dropped %d\n", drop > "/dev/stderr"
    }' "$_p" >> "$_q" 2>/dev/null
    rm -f "$_p"
    _hist_closed=1
    _hist_log info "$1 pre-clock samples back-dated (offset $_hist_off)"
}

# _hist_clock WALL MONO: maintain the anchor; closes buckets on a step.
_hist_clock() {
    local _w
    local _m
    local _d
    local _uo
    local _s
    _w="$1"
    _m="$2"
    if [ "$_hist_trusted" = "1" ]; then
        [ "$_w" -ge "$HIST_SANE_EPOCH" ] || return 0
        _d=$((_w - _m - _hist_off))
        [ "$_d" -lt 0 ] && _d=$((0 - _d))
        [ "$_d" -le "$HIST_STEP_TOL" ] && return 0
        _hist_close_all
        _hist_stepped=1
        if [ "$_w" -lt $((_hist_hwm - HIST_STEP_TOL)) ]; then
            _hist_trusted=0
            _hist_uoff=$((_w - _m))
            _hist_log warn "clock stepped behind the newest record (wall $_w), holding samples"
        else
            _hist_log info "clock step of ${_d}s, re-anchored"
            _hist_off=$((_w - _m))
        fi
        _hist_save_clock
        return 0
    fi
    _uo=$((_w - _m))
    if [ -n "$_hist_uoff" ]; then
        _d=$((_uo - _hist_uoff))
        [ "$_d" -lt 0 ] && _d=$((0 - _d))
        [ "$_d" -gt "$HIST_STEP_TOL" ] && _hist_stepped=1
    fi
    _hist_uoff="$_uo"
    [ "$_w" -ge "$HIST_SANE_EPOCH" ] || return 0
    [ "$_w" -ge $((_hist_hwm - HIST_STEP_TOL)) ] || return 0
    [ "$_m" -ge "$HIST_SETTLE" ] || [ "$_hist_stepped" = "1" ] || return 0
    _hist_trusted=1
    _hist_off="$_uo"
    _hist_save_clock
    _hist_log info "clock trusted (offset $_hist_off)"
    for _s in $HIST_SERIES; do _hist_backdate "$_s"; done
}

# _hist_add ID MONO DT GAP: fold this tick's sample (_HS, _HV_*) into ID.
_hist_add() {
    local _s
    local _m
    local _dt
    local _prev
    local _x
    local _ft
    local _w
    local _l
    local _k
    local _v
    local _o
    local _pl
    local _fs
    _s="$1"
    _m="$2"
    _dt="$3"
    eval "_prev=\$_hr_${_s}_st; _ft=\$HIST_${_s}_FAULT"
    _x=0
    # Current run (mono): a gap or the first sample starts a new run.
    if [ "$4" = "1" ] || [ "$_HS" != "$_prev" ]; then
        if _hist_in "$_HS" "$_ft" && ! _hist_in "$_prev" "$_ft"; then
            _x=1
            eval "_hf_${_s}_ms=$_m"
        fi
        if [ -n "$_prev" ] && _hist_in "$_prev" "$_ft" && ! _hist_in "$_HS" "$_ft"; then
            eval "_fs=\$_hf_${_s}_ms"
            if [ "$_hist_trusted" = "1" ] && [ -n "$_fs" ]; then
                _hist_write_fault "$_s" $((_fs + _hist_off)) $((_m + _hist_off))
            fi
            eval "_hf_${_s}_ms=''"
        fi
        eval "_hr_${_s}_st=\$_HS; _hr_${_s}_ms=$_m"
        printf "run_boot='%s'\nrun_state='%s'\nrun_mono='%s'\n" "$_hist_boot" "$_HS" "$_m" \
            > "$HIST_RUN/$_s.run.tmp" 2>/dev/null && mv -f "$HIST_RUN/$_s.run.tmp" "$HIST_RUN/$_s.run" 2>/dev/null
    fi
    eval "_l=\$HIST_${_s}_METRICS"
    if [ "$_hist_trusted" != "1" ]; then
        _pl="p|$_m|$_dt|$_HS|$_x"
        for _w in $_l; do eval "_v=\${_HV_${_w}:-}"; _pl="$_pl|$_v"; done
        printf '%s\n' "$_pl" >> "$HIST_RUN/$_s.pending" 2>/dev/null
        _hist_pending_cap "$_s"
        return 0
    fi
    # First trusted sample ever: remember when collecting began (once).
    eval "_o=\${_hsn_${_s}:-}"
    if [ -z "$_o" ]; then
        [ -s "$HIST_STORE/$_s/since" ] || _hist_write_since "$_s" $((_m + _hist_off))
        eval "_hsn_${_s}=1"
    fi
    _k=$(( (_m + _hist_off) / HIST_BUCKET * HIST_BUCKET ))
    eval "_o=\$_ha_${_s}_t"
    if [ "$_o" != "$_k" ]; then
        [ -n "$_o" ] && _hist_close "$_s"
        eval "_ha_${_s}_t=$_k"
    fi
    eval "_ha_${_s}_any=1; _ha_${_s}_x=\$((_ha_${_s}_x + _x))"
    eval "_ha_${_s}_st_${_HS}=\$((\${_ha_${_s}_st_${_HS}:-0} + _dt))"
    for _w in $_l; do
        eval "_v=\${_HV_${_w}:-}"
        [ -n "$_v" ] || continue
        eval "_ha_${_s}_n_${_w}=\$((_ha_${_s}_n_${_w} + 1)); _ha_${_s}_s_${_w}=\$((_ha_${_s}_s_${_w} + _v))"
        eval "_o=\$_ha_${_s}_lo_${_w}"
        { [ -z "$_o" ] || [ "$_v" -lt "$_o" ]; } && eval "_ha_${_s}_lo_${_w}=$_v"
        eval "_o=\$_ha_${_s}_hi_${_w}"
        { [ -z "$_o" ] || [ "$_v" -gt "$_o" ]; } && eval "_ha_${_s}_hi_${_w}=$_v"
    done
}

# _hist_write_fault ID START END: the newest completed fault run, on flash.
# Rare (once per outage) and durable, so a reboot right after keeps it.
_hist_write_fault() {
    local _f
    _f="$HIST_STORE/$1/last_fault"
    if command -v qm_durable_write >/dev/null 2>&1; then
        printf '%s %s\n' "$2" "$3" | qm_durable_write "$_f"
    else
        printf '%s %s\n' "$2" "$3" > "$_f.tmp" 2>/dev/null && "$HIST_SYNC" 2>/dev/null \
            && mv -f "$_f.tmp" "$_f" 2>/dev/null && "$HIST_SYNC" 2>/dev/null
    fi
}

# _hist_write_since ID T: when collecting began (CGI "since"); once per store.
_hist_write_since() {
    local _f
    _f="$HIST_STORE/$1/since"
    if command -v qm_durable_write >/dev/null 2>&1; then
        printf '%s\n' "$2" | qm_durable_write "$_f"
    else
        printf '%s\n' "$2" > "$_f" 2>/dev/null && "$HIST_SYNC" 2>/dev/null
    fi
}

_hist_pending_cap() {
    local _n
    local _p
    eval "_n=\$((\${_hp_${1}:-0} + 1)); _hp_${1}=\$_n"
    [ "$_n" -gt $((HIST_PENDING_MAX + 60)) ] || return 0
    _p="$HIST_RUN/$1.pending"
    tail -n "$HIST_PENDING_MAX" "$_p" > "$_p.tmp" 2>/dev/null && mv -f "$_p.tmp" "$_p" 2>/dev/null
    eval "_hp_${1}=$HIST_PENDING_MAX"
}

# _hist_mirror: rewrite every series' open-bucket mirror (CGI reads line 1).
_hist_mirror() {
    local _s
    local _t
    _hist_save_clock
    for _s in $HIST_SERIES; do
        eval "_t=\$_ha_${_s}_t"
        if [ "$_hist_trusted" = "1" ] && [ -n "$_t" ]; then
            _hist_row "$_s"
            printf '%s\n' "$_HROW" > "$HIST_RUN/$_s.open.tmp" 2>/dev/null \
                && mv -f "$HIST_RUN/$_s.open.tmp" "$HIST_RUN/$_s.open" 2>/dev/null
        fi
    done
}

# hist_flush_queues: move every queued row to its day file, one sync, caps.
hist_flush_queues() {
    local _s
    local _q
    local _d
    local _line
    local _t
    local _free
    local _today
    local _f
    local _n
    local _kb
    _hist_closed=0
    _free=$(df -k "$HIST_STORE" 2>/dev/null | awk 'END { print $(NF-2) }')
    case "$_free" in ''|*[!0-9]*) _free=0 ;; esac
    if [ "$_free" -lt "$HIST_MIN_FREE_KB" ]; then
        [ "$_hist_lowfree" = "1" ] || _hist_log warn "flush skipped, ${_free} KB free"
        _hist_lowfree=1
        return 0
    fi
    _hist_lowfree=0
    for _s in $HIST_SERIES; do
        _q="$HIST_RUN/$_s.queue"
        [ -s "$_q" ] || continue
        _d="$HIST_STORE/$_s"
        [ -d "$_d" ] || mkdir -p "$_d" 2>/dev/null
        while IFS= read -r _line; do
            _t="${_line#*\"t\":}"
            _t="${_t%%,*}"
            case "$_t" in ''|*[!0-9]*) continue ;; esac
            printf '%s\n' "$_line" >> "$_d/d$((_t / 86400)).jsonl" 2>/dev/null
        done < "$_q"
        : > "$_q"
        eval "_hq_${_s}=0"
    done
    "$HIST_SYNC" 2>/dev/null
    # Retention: by day-file name, then the per-series size cap (never today).
    # Only on a trusted clock: an untrusted "today" could delete good days.
    _today="$_hist_today"
    case "$_today" in ''|*[!0-9]*) return 0 ;; esac
    for _s in $HIST_SERIES; do
        _d="$HIST_STORE/$_s"
        for _f in "$_d"/d*.jsonl; do
            [ -f "$_f" ] || continue
            _n="${_f##*/d}"
            _n="${_n%.jsonl}"
            case "$_n" in ''|*[!0-9]*) continue ;; esac
            [ "$_n" -lt $((_today - HIST_RETAIN_DAYS)) ] && rm -f "$_f"
        done
        _kb=$(du -sk "$_d" 2>/dev/null)
        _kb="${_kb%%[!0-9]*}"
        case "$_kb" in ''|*[!0-9]*) _kb=0 ;; esac
        while [ "$_kb" -gt "$HIST_MAX_KB" ]; do
            _f=""
            for _n in "$_d"/d*.jsonl; do [ -f "$_n" ] && { _f="$_n"; break; }; done
            [ -n "$_f" ] || break
            [ "$_f" = "$_d/d$_today.jsonl" ] && break
            rm -f "$_f"
            _hist_log warn "$_s over ${HIST_MAX_KB} KB, removed ${_f##*/}"
            _kb=$(du -sk "$_d" 2>/dev/null)
            _kb="${_kb%%[!0-9]*}"
            case "$_kb" in ''|*[!0-9]*) _kb=0 ;; esac
        done
    done
}

hist_init() {
    local _s
    local _f
    local _b
    local hist_boot
    local hist_trusted
    local hist_offset
    local hist_mono
    local run_boot
    local run_state
    local run_mono
    local _ft
    [ -n "$HIST_SERIES" ] || return 0
    if command -v qm_root_dir >/dev/null 2>&1; then
        qm_root_dir "$HIST_RUN" 0700 || { _hist_log error "run dir unusable"; return 0; }
    else
        mkdir -p "$HIST_RUN" 2>/dev/null || return 0
    fi
    mkdir -p "$HIST_STORE" 2>/dev/null
    _b=""
    { read -r _b < "$HIST_BOOT_ID_FILE"; } 2>/dev/null
    _hist_boot="$_b"
    hist_boot=""
    hist_trusted=""
    hist_offset=""
    hist_mono=""
    if [ -f "$HIST_CLOCK" ]; then
        while IFS='=' read -r _f _b; do
            _b="${_b#\'}"
            _b="${_b%\'}"
            case "$_f" in
                hist_boot) hist_boot="$_b" ;;
                hist_trusted) hist_trusted="$_b" ;;
                hist_offset) hist_offset="$_b" ;;
                hist_mono) hist_mono="$_b" ;;
            esac
        done < "$HIST_CLOCK"
    fi
    case "$hist_offset" in ''|*[!0-9-]*) hist_trusted="" ;; esac
    if [ -n "$_hist_boot" ] && [ "$hist_boot" = "$_hist_boot" ]; then
        if [ "$hist_trusted" = "1" ]; then
            _hist_trusted=1
            _hist_off="$hist_offset"
        fi
        case "$hist_mono" in
            ''|*[!0-9]*) ;;
            *) _hist_pm="$hist_mono"; _hist_resume=1 ;;
        esac
    else
        # A new boot: RAM state of an older boot is not ours (tmpfs is wiped
        # on reboot; this covers a poller started with a stale run dir).
        if [ "$hist_boot" != "$_hist_boot" ]; then
            for _s in $HIST_SERIES; do
                rm -f "$HIST_RUN/$_s.open" "$HIST_RUN/$_s.pending" "$HIST_RUN/$_s.run"
            done
        fi
        _hist_trusted=0
        _hist_off=0
    fi
    _hist_hwm=0
    for _s in $HIST_SERIES; do
        mkdir -p "$HIST_STORE/$_s" 2>/dev/null
        _hist_acc_reset "$_s"
        # Resume the current run after a poller restart in the same boot.
        if [ "$_hist_resume" = "1" ] && [ -f "$HIST_RUN/$_s.run" ]; then
            run_boot=""
            run_state=""
            run_mono=""
            while IFS='=' read -r _f _b; do
                _b="${_b#\'}"
                _b="${_b%\'}"
                case "$_f" in
                    run_boot) run_boot="$_b" ;;
                    run_state) run_state="$_b" ;;
                    run_mono) run_mono="$_b" ;;
                esac
            done < "$HIST_RUN/$_s.run"
            case "$run_mono" in ''|*[!0-9]*) run_boot="" ;; esac
            if [ "$run_boot" = "$_hist_boot" ]; then
                eval "_hr_${_s}_st=\$run_state; _hr_${_s}_ms=\$run_mono"
                eval "_ft=\$HIST_${_s}_FAULT"
                _hist_in "$run_state" "$_ft" && eval "_hf_${_s}_ms=\$run_mono"
            fi
        fi
        _f=""
        for _b in "$HIST_STORE/$_s"/d*.jsonl; do [ -f "$_b" ] && _f="$_b"; done
        if [ -n "$_f" ]; then
            _hist_last_t "$_f"
            [ -n "$_HT" ] && [ $((_HT + HIST_BUCKET)) -gt "$_hist_hwm" ] && _hist_hwm=$((_HT + HIST_BUCKET))
        fi
        # A poller restart in the same boot: the last mirror is a partial row.
        if [ -s "$HIST_RUN/$_s.open" ]; then
            if [ "$_hist_trusted" = "1" ]; then
                head -n 1 "$HIST_RUN/$_s.open" >> "$HIST_RUN/$_s.queue" 2>/dev/null
                _hist_closed=1
            fi
            rm -f "$HIST_RUN/$_s.open"
        fi
        _hist_ev_count "$_s"
    done
    _hist_save_clock
    _hist_ready=1
    _hist_log info "ready: series [${HIST_SERIES# }] trusted=$_hist_trusted"
}

# _hist_ev_count ID: today's stored event count for the daily cap.
_hist_ev_count() {
    local _day
    local _n
    _day=""
    _n=0
    if [ "$_hist_trusted" = "1" ] && [ -n "$_hist_pm" ]; then
        _day=$(( (_hist_pm + _hist_off) / 86400 ))
    fi
    if [ -n "$_day" ] && [ -f "$HIST_STORE/$1/d$_day.jsonl" ]; then
        _n=$(grep -c '^{"k":"e"' "$HIST_STORE/$1/d$_day.jsonl" 2>/dev/null)
        case "$_n" in ''|*[!0-9]*) _n=0 ;; esac
    fi
    eval "_he_${1}_d=$_day; _he_${1}_n=$_n"
}

hist_tick() {
    local _m
    local _w
    local _dt
    local _gap
    local _s
    local _st
    [ "$_hist_ready" = "1" ] || return 0
    _hist_c=$((_hist_c + 1))
    [ $((_hist_c % HIST_EVERY)) -eq 0 ] || return 0
    _m="${_MONO_TOP:-}"
    _w="${_NOW:-}"
    case "$_m" in ''|*[!0-9]*) return 0 ;; esac
    case "$_w" in ''|*[!0-9]*) _w=0 ;; esac
    _hist_wall="$_w"
    _gap=0
    if [ -z "$_hist_pm" ] || [ "$_m" -lt "$_hist_pm" ]; then
        _dt=0
        _gap=1
    else
        _dt=$((_m - _hist_pm))
        if [ "$_dt" -gt "$HIST_MAX_DT" ]; then
            # The first sample after a quick poller restart in the same boot
            # keeps the current run (mirror age plus restart time).
            if [ "$_hist_resume" != "1" ] || [ "$_dt" -gt 90 ]; then
                _gap=1
            fi
            _dt="$HIST_MAX_DT"
        fi
    fi
    _hist_resume=0
    _hist_pm="$_m"
    _hist_clock "$_w" "$_m"
    [ "$_hist_trusted" = "1" ] && _hist_today=$(( (_m + _hist_off) / 86400 ))
    for _s in $HIST_SERIES; do
        _HS=""
        "hist_${_s}_sample" 2>/dev/null
        [ -n "$_HS" ] || continue
        eval "_st=\$HIST_${_s}_STATES"
        _hist_in "$_HS" "$_st" || continue
        _hist_add "$_s" "$_m" "$_dt" "$_gap"
    done
    _hist_mc=$((_hist_mc + 1))
    if [ $((_hist_mc % HIST_MIRROR_EVERY)) -eq 0 ]; then
        _hist_mirror
    fi
    _hist_spool
    [ "$_hist_closed" = "1" ] && hist_flush_queues
    return 0
}

# _hist_spool: events from processes without history.sh (watchcat, CGIs).
# events.sh appends "mono|type|severity|message" to ext.spool. Rename, then
# read on the next sample tick, so an append still in flight lands in the
# file before it is read; t comes from the stored mono, not the read time.
_hist_spool() {
    local _w
    local _sm
    local _sy
    local _ss
    local _sx
    _w="$HIST_RUN/ext.spool.work"
    if [ -f "$_w" ]; then
        while IFS='|' read -r _sm _sy _ss _sx; do
            case "$_sm" in ''|*[!0-9]*) continue ;; esac
            case "$_sy" in ''|*[!a-z0-9_]*) continue ;; esac
            case "$_ss" in info|warning|error|critical) ;; *) _ss=info ;; esac
            hist_event "$_sy" "$_sx" "$_ss" "$_sm"
        done < "$_w"
        rm -f "$_w"
    fi
    if [ -s "$HIST_RUN/ext.spool" ]; then
        mv -f "$HIST_RUN/ext.spool" "$_w" 2>/dev/null
    fi
    return 0
}

# hist_event TYPE MESSAGE SEVERITY [MONO] — called by events.sh append_event
# (this cycle's mono) and by _hist_spool (the mono the writer recorded).
hist_event() {
    local _s
    local _evs
    local _keep
    local _m
    local _r
    local _js
    local _rest
    local _t
    local _day
    local _n
    [ "$_hist_ready" = "1" ] || return 0
    _m="${4:-${_MONO_TOP:-}}"
    case "$_m" in ''|*[!0-9]*) _m=""; { read -r _m _r < /proc/uptime; } 2>/dev/null; _m="${_m%%.*}" ;; esac
    case "$_m" in ''|*[!0-9]*) return 0 ;; esac
    for _s in $HIST_SERIES; do
        eval "_evs=\$HIST_${_s}_EVENTS; _keep=\${HIST_${_s}_EVENTS_KEEP:-}"
        _hist_in "$1" "$_evs" || continue
        _HR=""
        command -v "hist_${_s}_radio" >/dev/null 2>&1 && "hist_${_s}_radio" "$1" "$2"
        case "$_HR" in lte|nr) _r="\"$_HR\"" ;; *) _r="null" ;; esac
        if command -v _jstr >/dev/null 2>&1; then
            _jstr "$2"
            _js="$_JV"
        else
            _js=$(jq -n --arg v "$2" '$v' 2>/dev/null)
            [ -n "$_js" ] || _js='""'
        fi
        _rest="\"type\":\"$1\",\"severity\":\"${3:-info}\",\"radio\":$_r,\"message\":$_js}"
        if [ "$_hist_trusted" != "1" ]; then
            printf 'e|%s|%s\n' "$_m" "$_rest" >> "$HIST_RUN/$_s.pending" 2>/dev/null
            _hist_pending_cap "$_s"
            continue
        fi
        _t=$((_m + _hist_off))
        _day=$((_t / 86400))
        eval "_n=\$_he_${_s}_n"
        eval "[ \"\$_he_${_s}_d\" = \"$_day\" ]" || _n=0
        if [ "$_n" -ge "$HIST_EV_DAY_MAX" ] && ! _hist_in "$1" "$_keep"; then
            continue
        fi
        eval "_he_${_s}_d=$_day; _he_${_s}_n=$((_n + 1))"
        _hist_queue_line "$_s" "{\"k\":\"e\",\"t\":$_t,$_rest"
    done
    return 0
}

# hist_flush — TERM trap: queue the open buckets as partial rows, flush.
hist_flush() {
    local _s
    [ "$_hist_ready" = "1" ] || return 0
    for _s in $HIST_SERIES; do
        _hist_close "$_s"
        rm -f "$HIST_RUN/$_s.open"
    done
    hist_flush_queues
}
