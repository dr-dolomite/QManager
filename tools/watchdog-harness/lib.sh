#!/bin/sh
# lib.sh - stubs and helpers for the watchdog parity harness (dev-only).
# Sourced by inner.sh under BusyBox ash BEFORE the daemon is sourced, so every
# function here shadows the real command of the same name. All harness names are
# prefixed h_ / _h_ / mget / mset so they cannot collide with daemon globals.
#
# Persistent harness state lives in files under $H_STATE (command substitution
# forks, so shell variables set inside it would be lost):
#   clock          fake wall clock, epoch seconds
#   model/<key>    scenario model (link state, slot, quality, ...)
#   uci.db         "key=value" lines read by the uci stub
#   dmesg.txt      what the dmesg stub prints

mget() { # key [default]
    if [ -f "$H_STATE/model/$1" ]; then
        cat "$H_STATE/model/$1"
    else
        printf '%s' "$2"
    fi
}

mset() { # key value
    printf '%s' "$2" > "$H_STATE/model/$1"
}

h_now() { cat "$H_STATE/clock"; }
h_elapsed() { echo $(( $(cat "$H_STATE/clock") - H_CLOCK0 )); }
h_uptime() { echo $(( H_UP0 + $(cat "$H_STATE/clock") - H_CLOCK0 )); }

h_clock_adv() { # seconds
    _h_c=$(cat "$H_STATE/clock")
    _h_c=$(( _h_c + $1 ))
    printf '%s' "$_h_c" > "$H_STATE/clock"
    printf '%s.00 0.00\n' "$(( H_UP0 + _h_c - H_CLOCK0 ))" > "$H_ROOT/proc_uptime"
}

# --- command stubs -----------------------------------------------------------

date() {
    case "$*" in
        "+%s") cat "$H_STATE/clock"; echo ;;
        *) busybox date -u -d "@$(cat "$H_STATE/clock")" "$@" ;;
    esac
}

logger() { :; }
sync() { :; }
reboot() { echo "reboot" >> "$H_OUT/calls.log"; }

dmesg() { cat "$H_STATE/dmesg.txt" 2>/dev/null; }

# uci.db holds one "key=value" line per option and one "key+=item" line per
# list item (in order). uci_del drops both forms of a key.
uci_del() { # key
    : > "$H_STATE/uci.new"
    while IFS= read -r _h_l; do
        case "$_h_l" in
            "$1="*|"$1+="*) ;;
            *) printf '%s\n' "$_h_l" >> "$H_STATE/uci.new" ;;
        esac
    done < "$H_STATE/uci.db"
    mv "$H_STATE/uci.new" "$H_STATE/uci.db"
}

uci_set() { # key value
    uci_del "$1"
    printf '%s=%s\n' "$1" "$2" >> "$H_STATE/uci.db"
}

# uci_quote VALUE: 'VALUE' with an embedded ' written as '\'' (uci show style)
uci_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

uci() {
    [ "$1" = "-q" ] && shift
    case "$1" in
        get)
            while IFS= read -r _h_l; do
                case "$_h_l" in
                    "$2="*) printf '%s\n' "${_h_l#*=}"; return 0 ;;
                esac
            done < "$H_STATE/uci.db"
            return 1
            ;;
        show)
            _h_out=""
            while IFS= read -r _h_l; do
                case "$_h_l" in
                    "$2="*)
                        printf "%s=%s\n" "$2" "$(uci_quote "${_h_l#*=}")"
                        return 0
                        ;;
                    "$2+="*)
                        _h_out="${_h_out:+$_h_out }$(uci_quote "${_h_l#*+=}")"
                        ;;
                esac
            done < "$H_STATE/uci.db"
            [ -n "$_h_out" ] || return 1
            printf '%s=%s\n' "$2" "$_h_out"
            return 0
            ;;
        set)
            echo "uci set $2" >> "$H_OUT/calls.log"
            uci_set "${2%%=*}" "${2#*=}"
            ;;
        add_list)
            echo "uci add_list $2" >> "$H_OUT/calls.log"
            printf '%s+=%s\n' "${2%%=*}" "${2#*=}" >> "$H_STATE/uci.db"
            ;;
        delete)
            echo "uci delete $2" >> "$H_OUT/calls.log"
            uci_del "$2"
            ;;
        revert)
            echo "uci revert $2" >> "$H_OUT/calls.log"
            ;;
        commit)
            echo "uci commit $2" >> "$H_OUT/calls.log"
            ;;
    esac
    return 0
}

qcmd() {
    [ "$1" = "-t" ] && shift 2
    _h_cmd="$1"
    echo "T+$(h_elapsed) $_h_cmd" >> "$H_OUT/at.log"
    if command -v sc_qcmd >/dev/null 2>&1; then
        sc_qcmd "$_h_cmd"
        _h_rc=$?
        [ "$_h_rc" -ne 100 ] && return "$_h_rc"
    fi
    h_qcmd_default "$_h_cmd"
}

h_qcmd_default() {
    case "$1" in
        "AT+QUIMSLOT?")
            printf '+QUIMSLOT: %s\r\nOK\r\n' "$(mget slot 1)"
            ;;
        AT+QUIMSLOT=*)
            [ "$(mget quimslot_swallow 0)" = "1" ] || mset slot "${1#AT+QUIMSLOT=}"
            printf 'OK\r\n'
            ;;
        AT+QCCID)
            _h_s=$(mget slot 1)
            printf '+QCCID: %s\r\nOK\r\n' "$(mget "iccid_slot$_h_s" "8900000000000000000$_h_s")"
            ;;
        "AT+CFUN?")
            printf '+CFUN: %s\r\nOK\r\n' "$(mget cfun 1)"
            ;;
        "AT+CPIN?")
            _h_v=$(mget "cpin_slot$(mget slot 1)" "+CPIN: READY")
            case "$_h_v" in
                +CME*) printf '%s\r\n' "$_h_v" ;;
                *) printf '%s\r\nOK\r\n' "$_h_v" ;;
            esac
            ;;
        *)
            printf 'OK\r\n'
            ;;
    esac
    return 0
}

# --- inputs the real daemons would produce -----------------------------------

# Ping-history ring (/tmp/qmanager_ping_history, "<rtt|null> <leg>" per line,
# newest last, 60 lines): one sample per 5 fake seconds since the last refresh.
# Unreachable -> null; otherwise q_latency, with q_loss percent of the samples
# null (evenly spread: sample k is null when floor((k+1)*P/100) > floor(k*P/100)).
h_hist_append() { # dt reachable
    _h_ns=$(( $1 / 5 ))
    _h_hf="$H_ROOT/tmp/qmanager_ping_history"
    [ -f "$_h_hf" ] || : > "$_h_hf"
    _h_k=$(mget hist_cnt 0)
    _h_p=$(mget q_loss 0)
    _h_lat=$(mget q_latency 24.5)
    while [ "$_h_ns" -gt 0 ]; do
        if [ "$2" = "false" ] || [ $(( (_h_k + 1) * _h_p / 100 )) -gt $(( _h_k * _h_p / 100 )) ]; then
            echo "null -" >> "$_h_hf"
        else
            echo "$_h_lat p4" >> "$_h_hf"
        fi
        _h_k=$(( _h_k + 1 ))
        _h_ns=$(( _h_ns - 1 ))
    done
    mset hist_cnt "$_h_k"
    tail -n 60 "$_h_hf" > "$_h_hf.tmp" && mv "$_h_hf.tmp" "$_h_hf"
}

# Rewrites ping.json and status.json from the model at the current fake time.
# Called after every clock advance, so cached data is always as fresh as the
# newest sleep. Model keys: reachable, link_slot_<n> (overrides reachable by SIM
# slot), slot, ping_stale=1 / status_stale=1 (stop refreshing), q_latency, q_loss.
h_refresh() {
    _h_now=$(cat "$H_STATE/clock")
    _h_up=$(( H_UP0 + _h_now - H_CLOCK0 ))
    _h_last=$(mget last_refresh "$_h_now")
    _h_dt=$(( _h_now - _h_last ))
    mset last_refresh "$_h_now"
    _h_slot=$(mget slot 1)
    _h_reach=$(mget reachable true)
    _h_lk=$(mget "link_slot_$_h_slot" "")
    [ -n "$_h_lk" ] && _h_reach="$_h_lk"
    if [ "$_h_reach" = "false" ]; then
        _h_down=$(( $(mget down_secs 0) + _h_dt ))
        mset down_secs "$_h_down"
        _h_sf=$(( _h_down / 5 ))
        _h_ss=0
    else
        mset down_secs 0
        _h_sf=0
        _h_ss=10
    fi
    if [ "$(mget ping_stale 0)" != "1" ]; then
        _h_dr=false
        [ -f "$H_ROOT/tmp/qmanager_recovery_active" ] && _h_dr=true
        printf '{"timestamp":%s,"mono":%s,"reachable":%s,"last_rtt_ms":24.5,"streak_success":%s,"streak_fail":%s,"during_recovery":%s,"interval_sec":%s,"fail_secs":15,"recover_secs":10,"profile":"relaxed","last_family":"v4","targets":["192.0.2.1"]}\n' \
            "$_h_now" "$_h_up" "$_h_reach" "$_h_ss" "$_h_sf" "$_h_dr" "$(mget ping_interval 5)" > "$H_ROOT/tmp/qmanager_ping.json"
        h_hist_append "$_h_dt" "$_h_reach"
    fi
    if [ "$(mget status_stale 0)" != "1" ]; then
        printf '{"timestamp":%s,"mono":%s,"connectivity":{"avg_latency_ms":%s,"packet_loss_pct":%s}}\n' \
            "$_h_now" "$_h_up" "$(mget q_latency 24.5)" "$(mget q_loss 0)" > "$H_ROOT/tmp/qmanager_status.json"
    fi
}

# --- scenario helpers ----------------------------------------------------------

# dmesg_crash SECS_AGO: an MPSS fatal-error line that old (by fake uptime)
dmesg_crash() {
    _h_t=$(( $(h_uptime) - $1 ))
    printf '[ %s.123456][ T8033] 4080000.remoteproc-mss: fatal error received: err_fatal\n' "$_h_t" > "$H_STATE/dmesg.txt"
}

# failover_write ACTIVE ORIG CURR [ORIG_ICCID]: seed the Tier-3 failover record
failover_write() {
    printf '{"active":%s,"original_slot":%s,"current_slot":%s,"switched_at":%s,"reason":"connectivity_failure","original_iccid":"%s","current_iccid":""}\n' \
        "$1" "$2" "$3" "$(h_now)" "${4:-89000000000000000001}" > "$H_ROOT/tmp/qmanager_sim_failover"
}

# crash_log_add SECS_AGO REASON: append a reboot-ledger row SECS_AGO before now
crash_log_add() {
    printf '%s|reboot|%s\n' "$(( $(h_now) - $1 ))" "$2" >> "$H_ROOT/etc/qmanager/crash.log"
}

# crash_log_epoch EPOCH REASON: append a ledger row with a literal epoch
# (1970-era rows, non-numeric epochs)
crash_log_epoch() {
    printf '%s|reboot|%s\n' "$1" "$2" >> "$H_ROOT/etc/qmanager/crash.log"
}

h_touch() { : > "$H_ROOT/tmp/$1"; }
h_rm() { rm -f "$H_ROOT/tmp/$1"; }

# --- pass driver --------------------------------------------------------------

h_hook() { # pass number
    if command -v "sc_pass_$1" >/dev/null 2>&1; then
        "sc_pass_$1"
    fi
}

h_snap() { # pass number
    {
        echo "=== pass $1 (t+$(h_elapsed)) ==="
        echo "-- state"
        cat "$H_ROOT/tmp/qmanager_watchcat.json" 2>/dev/null || echo "(absent)"
        echo "-- files"
        ( cd "$H_ROOT" && ls -1 tmp etc/qmanager var/run 2>/dev/null \
            | grep -v -E '^(qmanager\.log|qmanager_events\.json|qmanager_ping\.json|qmanager_ping_history|qmanager_ping_history\.tmp|qmanager_status\.json|qmanager_watchcat\.json)$' )
        echo "-- failover"
        cat "$H_ROOT/tmp/qmanager_sim_failover" 2>/dev/null || echo "(none)"
        if command -v sc_snap_extra >/dev/null 2>&1; then
            echo "-- extra"
            sc_snap_extra "$1"
        fi
    } >> "$H_OUT/passes.txt"
    echo "--- pass $1 ---" >> "$H_OUT/at.log"
    echo "--- pass $1 ---" >> "$H_OUT/calls.log"
}

_h_total=0
_h_booted=0
_h_pass=0

# The fake sleep. Three kinds of call:
#   - the boot settle (arg = BOOT_SETTLE, first time): advance, arm pass 1;
#   - the end-of-pass sleep (arg = CFG_CHECK_INTERVAL, after boot): snapshot,
#     then stop after SC_PASSES passes (exit runs the daemon's EXIT trap) or
#     advance and arm the next pass;
#   - anything else (sleep 2, sleep 5, ...): just advance the clock.
# Inputs are refreshed after every advance.
sleep() {
    _h_n="$1"
    # A backgrounded "( sleep 1; sync; reboot ) &" runs in another process: it
    # must not touch the clock the exiting main shell is still reading.
    read -r _h_pid _h_rest < /proc/self/stat
    [ "$_h_pid" = "$H_MAINPID" ] || return 0
    _h_total=$(( _h_total + 1 ))
    if [ "$_h_total" -gt 4000 ]; then
        echo "harness: runaway (4000 sleeps)" >&2
        exit 99
    fi
    if [ "$_h_booted" = "0" ] && [ "$_h_n" = "$BOOT_SETTLE" ]; then
        h_clock_adv "$_h_n"
        _h_booted=1
        h_hook 1
        h_refresh
        return 0
    fi
    if [ "$_h_booted" = "1" ] && [ "$_h_n" = "$CFG_CHECK_INTERVAL" ]; then
        _h_pass=$(( _h_pass + 1 ))
        h_snap "$_h_pass"
        if [ "$_h_pass" -ge "$SC_PASSES" ]; then
            exit 0
        fi
        h_clock_adv "$_h_n"
        h_hook $(( _h_pass + 1 ))
        h_refresh
        return 0
    fi
    h_clock_adv "$_h_n"
    h_refresh
    return 0
}
