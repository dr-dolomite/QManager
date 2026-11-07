#!/bin/sh
# lib.sh - helpers for the ping harness (dev-only). Sourced by inner.sh under
# BusyBox ash BEFORE the daemon is sourced. Every harness name is h_ / _h_
# prefixed so it cannot collide with daemon globals.
#
# Persistent harness state lives in files under $H_STATE:
#   uci.db       "sec.key=value" / "sec.key+=item" lines served by the fake uci
#   pingtab      "<target> <delay_s> <ok:RTT|fail> [<resolved addr>]", last match wins
#   no6          present = ping -6 / ping6 fail (no IPv6 ping on this build)
#   ran/         <target>.start / <target>.finish markers written by the fake ping

# --- applet-preferring BusyBox ------------------------------------------------
# Some builds (Ubuntu's 1.36.1) run applets before searching PATH, which would
# bypass the fake ping. There the fakes are shell functions, and `timeout N ping`
# (an applet exec'ing an applet) is a function that runs the fake script as a
# direct child and kills it at the deadline. The other builds (and the device)
# use the real timeout applet.
if [ "$H_PREFER_APPLETS" = "1" ]; then
    ping() { "$H_BIN/ping" "$@"; }
    ping6() { "$H_BIN/ping6" "$@"; }
    timeout() {
        _h_ts="$1"
        shift
        case "$1" in
            ping|ping6) _h_tc="$H_BIN/$1"; shift; "$_h_tc" "$@" & ;;
            *) "$@" & ;;
        esac
        _h_tp=$!
        ( sleep "$_h_ts"; kill "$_h_tp" 2>/dev/null ) &
        _h_tk=$!
        wait "$_h_tp"
        _h_trc=$?
        kill "$_h_tk" 2>/dev/null
        return "$_h_trc"
    }
fi

# --- scenario configuration helpers ------------------------------------------

h_cfg() { # sec.key value
    printf '%s=%s\n' "$1" "$2" >> "$H_STATE/uci.db"
}

h_cfg_list() { # sec.key item...
    _h_k="$1"
    shift
    for _h_i in "$@"; do
        printf '%s+=%s\n' "$_h_k" "$_h_i" >> "$H_STATE/uci.db"
    done
}

h_ping() { # target delay_s ok:RTT|fail [resolved addr]
    printf '%s %s %s %s\n' "$1" "$2" "$3" "${4:-$1}" >> "$H_STATE/pingtab"
}

# h_route default|none: whether the fake /proc/net/ipv6_route holds a ::/0 route
# on a real interface. A ::/0 entry on lo (the kernel's unreachable stub) is
# always present, like on a real box.
h_route() {
    {
        printf '%s\n' "fe800000000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001 rmnet_data0"
        printf '%s\n' "00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200 lo"
        if [ "$1" = "default" ]; then
            printf '%s\n' "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003 rmnet_data0"
        fi
    } > "$H_ROOT/proc_ipv6_route"
}

h_no6() { : > "$H_STATE/no6"; }

# --- probes ---------------------------------------------------------------------

h_marks_reset() { rm -rf "$H_STATE/ran"; mkdir -p "$H_STATE/ran"; }

# Prints which targets the fake ping was started for, and which of those ran to
# completion; the difference is what was cut short (killed) or timed out.
h_marks_report() {
    _h_started=""
    _h_done=""
    _h_cut=""
    for _h_f in "$H_STATE"/ran/*.start; do
        [ -f "$_h_f" ] || continue
        _h_t="${_h_f##*/}"
        _h_t="${_h_t%.start}"
        _h_started="$_h_started $_h_t"
        if [ -f "$H_STATE/ran/$_h_t.finish" ]; then
            _h_done="$_h_done $_h_t"
        else
            _h_cut="$_h_cut $_h_t"
        fi
    done
    printf '  probed:%s\n  finished:%s\n  cut short:%s\n' "$_h_started" "$_h_done" "$_h_cut"
}

# Counts leftover fake-ping processes and their sleeps (matched by the work dir's
# own ping path, or by the exact "sleep <delay>" of a table entry), retrying for
# half a second so a SIGTERM in flight can land. 0 means no orphan.
h_orphans() {
    _h_try=0
    while :; do
        _h_n=0
        for _h_d in /proc/[0-9]*; do
            _h_comm=""
            { read -r _h_comm < "$_h_d/comm"; } 2>/dev/null || continue
            case "$_h_comm" in ping|ping6|sleep|timeout) ;; *) continue ;; esac
            _h_cmd=$(tr '\0' ' ' < "$_h_d/cmdline" 2>/dev/null)
            case "$_h_cmd" in
                *"$H_BIN/ping"*) _h_n=$((_h_n + 1)) ;;
                "sleep "*)
                    _h_dl="${_h_cmd#sleep }"
                    _h_dl="${_h_dl% }"
                    if [ "$_h_dl" != "0.2" ] && awk -v d="$_h_dl" '$2 == d { f = 1 } END { exit !f }' "$H_STATE/pingtab" 2>/dev/null; then
                        _h_n=$((_h_n + 1))
                    fi
                    ;;
            esac
        done
        [ "$_h_n" -eq 0 ] && break
        _h_try=$((_h_try + 1))
        [ "$_h_try" -ge 5 ] && break
        sleep 0.1
    done
    echo "  orphans: $_h_n"
}

h_slots() {
    printf '  slots: 1=%s(%s) 2=%s(%s) 3=%s(%s) 4=%s(%s)\n' \
        "$SS1" "$SR1" "$SS2" "$SR2" "$SS3" "$SR3" "$SS4" "$SR4"
}

# h_cycle LABEL [MAX_CS [MIN_CS]]: one probe_cycle, with the result, the slot
# states, an elapsed-time window (centiseconds, printed as yes/NO so the output
# is deterministic), the cut-short probes and the orphan count.
h_cycle() {
    _hc_label="$1"
    _hc_max="$2"
    _hc_min="$3"
    h_marks_reset
    _uptime_cs
    _hc_t0="$_CS"
    probe_cycle
    _hc_rc=$?
    _uptime_cs
    _hc_el=$((_CS - _hc_t0))
    printf '%s: rc=%s rtt=%s family=%s leg=%s\n' "$_hc_label" "$_hc_rc" "${PROBE_RTT:-none}" "$last_family" "$last_leg"
    h_slots
    if [ -n "$_hc_max" ]; then
        if [ "$_hc_el" -lt "$_hc_max" ]; then _hc_ok=yes; else _hc_ok=NO; fi
        printf '  elapsed < %s cs: %s\n' "$_hc_max" "$_hc_ok"
    fi
    if [ -n "$_hc_min" ]; then
        if [ "$_hc_el" -ge "$_hc_min" ]; then _hc_ok=yes; else _hc_ok=NO; fi
        printf '  elapsed >= %s cs: %s\n' "$_hc_min" "$_hc_ok"
    fi
    h_marks_report
    h_orphans
}

# --- the real main loop ----------------------------------------------------------

h_ring_lines() {
    _h_rl=0
    if [ -f "$H_ROOT/tmp/qmanager_ping_history" ]; then
        _h_rl=$(wc -l < "$H_ROOT/tmp/qmanager_ping_history")
    fi
    echo "$_h_rl"
}

h_main_start() {
    main > "$H_OUT/main.out" 2>&1 &
    H_MAINPID=$!
}

# h_wait_ring N: block until the ring holds N lines (20 s cap).
h_wait_ring() {
    _h_w=0
    while [ "$(h_ring_lines)" -lt "$1" ] && [ "$_h_w" -lt 400 ]; do
        sleep 0.05
        _h_w=$((_h_w + 1))
    done
}

# h_main_stop: let the cycle in flight finish writing, then stop the daemon the
# way init does (SIGTERM) and wait for its cleanup trap.
h_main_stop() {
    sleep 0.3
    kill -TERM "$H_MAINPID" 2>/dev/null
    wait "$H_MAINPID" 2>/dev/null
}

# h_dump FILE LABEL: a state file, volatile fields masked.
h_dump() {
    echo "--- $2"
    if [ -f "$1" ]; then
        sed -e 's/"timestamp":[0-9]*/"timestamp":T/' \
            -e 's/"mono":[0-9]*/"mono":M/' \
            -e 's/"cycle_ms":[0-9]*/"cycle_ms":C/' \
            -e 's/"fail_elapsed_sec":[0-9]*/"fail_elapsed_sec":F/' \
            -e "s/^_cq_fe='[0-9]*'/_cq_fe='F'/" \
            -e "s/^_cq_ts='[0-9]*'/_cq_ts='T'/" \
            -e "s/^_cq_mono='[0-9]*'/_cq_mono='M'/" \
            -e "s/^_cq_cyc='[0-9]*'/_cq_cyc='C'/" "$1"
    else
        echo "(absent)"
    fi
}

# h_state_dump: ping.json, ping.env, slots.json and the ring as the daemon left them.
h_state_dump() {
    h_dump "$H_ROOT/tmp/qmanager_ping.json" "ping.json"
    h_dump "$H_ROOT/var/run/qmanager/ping.env" "ping.env"
    h_dump "$H_ROOT/tmp/qmanager_ping_slots.json" "slots.json"
    h_dump "$H_ROOT/tmp/qmanager_ping_history" "ring"
}
