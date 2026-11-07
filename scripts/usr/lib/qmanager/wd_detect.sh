#!/bin/sh
# =============================================================================
# wd_detect.sh - qmanager_watchcat: inputs that start or hold recovery
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: ping_streak_fail, ping_reachable, ping_during_recovery, ssr_hold,
#       last_ssr_detected, ssr_hold_started
# Functions: read_ping, wd_decide_start, wd_holdoff_left, wd_radio_reconcile,
#            wd_start_gate, ssr_in_progress, ssr_hold_gate, ssr_hold_clear
#
# The quality window and the quality trigger (evaluate_quality) live in
# wd_quality.sh. Function definitions and global initialisers only. The last
# line sets WD_DETECT_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
ssr_hold="false"          # JSON bool literal for write_state
last_ssr_detected="null"  # JSON null literal or monotonic-seconds integer
ssr_hold_started=0        # monotonic seconds-since-boot when hold began; 0 = not holding

# Read ping daemon data — returns 0 if valid, 1 if stale/missing
# Sets: ping_streak_fail, ping_reachable, ping_during_recovery
ping_streak_fail=0
ping_reachable="true"
ping_during_recovery="false"

read_ping() {
    # conn_state_read owns the read + staleness rule (max(3 * interval_sec, 15)
    # on the monotonic clock). On failure the ping_* vars keep their previous
    # values; every caller treats a non-zero return as "unknown, skip".
    if ! conn_state_read; then
        if [ "$CQ_STALE_REASON" = "missing" ]; then
            qlog_warn "Ping cache missing"
        else
            qlog_warn "Ping data stale ($(conn_state_why)), skipping cycle"
        fi
        return 1
    fi

    # reachable is true/false, or "null" when the cache did not say — "null"
    # is never treated as up. The down decision stays on the probe-count streak.
    ping_streak_fail="$CQ_STREAK_FAIL"
    ping_reachable="$CQ_REACHABLE"
    ping_during_recovery="$CQ_DURING_RECOVERY"
    return 0
}

# Pure start gate (no I/O, no globals), in this order:
#   wd_decide_start <tiers_any 0|1> <cfun> <holdoff_left_secs>
#   none       no tier is enabled: there is nothing to run, stay as we are
#   holdoff    the ladder ran out recently: wait out the pause
#   radio_off  AT+CFUN is 0 or 4: the radio was turned off on purpose
#   go         start the ladder
# cfun is the digit wd_cfun_now printed; empty (unreadable) counts as on, so a
# failed read never blocks recovery.
wd_decide_start() {
    local hl
    hl="$3"
    case "$hl" in ''|*[!0-9]*) hl=0 ;; esac
    if [ "$1" != "1" ]; then
        printf 'none'
        return 0
    fi
    if [ "$hl" -gt 0 ]; then
        printf 'holdoff'
        return 0
    fi
    case "$2" in
        0|4) printf 'radio_off' ;;
        *) printf 'go' ;;
    esac
    return 0
}

# Prints the seconds left of the pause after an exhausted ladder (0 = none).
wd_holdoff_left() {
    local now
    case "$holdoff_until" in
        ''|*[!0-9]*) printf '0'; return 0 ;;
    esac
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    if [ "$holdoff_until" -gt "$now" ]; then
        printf '%s' $((holdoff_until - now))
    else
        printf '0'
    fi
    return 0
}

# A Tier 2 or SIM-swap radio marker (wd_radio_down=1) is cleared only by a
# confirmed AT+CFUN=1. If every confirming read failed, the marker sticks: the
# start gate then ignores a later airplane mode and the exit cleanup would send
# AT+CFUN=1 over the user's CFUN=0/4. Call this right before wd_start_gate (never
# inside its command substitution: a subshell cannot clear the marker). It reads
# AT+CFUN? only while the marker is set and clears it when the radio reads 1; a
# 0, a 4 or an unreadable reply keeps the marker (ours or the user's, undecidable).
# Nothing is read while the gate is paused by the hold-off: it decides without CFUN.
wd_radio_reconcile() {
    [ "$wd_radio_down" = "1" ] || return 0
    [ "$(wd_holdoff_left)" = "0" ] || return 0
    if [ "$(wd_cfun_now)" = "1" ]; then
        qlog_info "Radio reads AT+CFUN=1: clearing the stale radio-down marker"
        wd_mark_radio_up
    fi
    return 0
}

# Gathers the three inputs for wd_decide_start and prints its verdict. The one
# AT read (AT+CFUN?) is skipped when an earlier gate already decides. While a
# Tier 2 radio toggle is unresolved (wd_radio_down=1) a radio that is off is ours,
# not the user's, so it is reported as on and the ladder keeps escalating.
wd_start_gate() {
    local any
    local hl
    local cf
    any=0
    [ "$CFG_TIER1_ENABLED" = "1" ] && any=1
    [ "$CFG_TIER2_ENABLED" = "1" ] && any=1
    [ "$CFG_TIER3_ENABLED" = "1" ] && any=1
    [ "$CFG_TIER4_ENABLED" = "1" ] && any=1

    hl=$(wd_holdoff_left)

    cf=""
    if [ "$any" = "1" ] && [ "$hl" -eq 0 ] && [ "$wd_radio_down" != "1" ]; then
        cf=$(wd_cfun_now)
    fi
    wd_decide_start "$any" "$cf" "$hl"
}

# --- SSR (baseband subsystem restart) awareness ---------------------------
# The modem suffers RECOVERABLE baseband subsystem restarts (SSRs): the baseband
# crashes and comes back on its own, with the data path restored within tens of
# seconds. If watchcat fires its recovery ladder (forced AT+COPS / AT+CFUN
# detach) WHILE the baseband is mid-self-heal, it amplifies a ~30-60s
# self-healing outage into a multi-minute thrash. This gate detects an
# in-progress SSR and HOLDS the ladder for a grace window, only falling through
# to the normal ladder if connectivity does not return (the genuine stuck /
# AP-hang case).

# Best-effort read-only check for a RECENT baseband crash (plat_ssr_poll gives
# its time in monotonic seconds since boot). Returns 0 (true) if a crash is
# known AND it is within the detection window of now (CFG_SSR_GRACE +
# CFG_FAIL_THRESHOLD * ping interval + 2 check intervals); 1 (false) otherwise,
# including when the platform knows no crash time (graceful degradation:
# absence of evidence is NOT evidence of absence; we never block recovery on
# it). Polls the platform ONCE per invocation (only at an escalation decision).
ssr_in_progress() {
    [ "$CFG_SSR_AWARE" = "1" ] || return 1

    local crash_ts
    local now

    plat_ssr_poll
    crash_ts="$PLAT_SSR_MONO"
    case "$crash_ts" in ''|*[!0-9]*) return 1 ;; esac

    now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac

    # The crash is only visible to the ladder once the ping daemon has counted
    # CFG_FAIL_THRESHOLD failed probes (one probe period apart, WD_PERIOD: the
    # failing cycle can outlast the interval) and a check pass has seen them, so
    # the look-back must cover that detection delay as well as the grace. A bare
    # grace window always expired first on slow ping profiles (the hold never
    # engaged and every SSR was amplified).
    local iv
    local ft
    local ci
    local gr
    local win
    gr="$CFG_SSR_GRACE"
    case "$gr" in ''|*[!0-9]*) gr=45 ;; esac
    wd_probe_period
    iv="$WD_PERIOD"
    ft="$CFG_FAIL_THRESHOLD"
    case "$ft" in ''|*[!0-9]*) ft=5 ;; esac
    ci="$CFG_CHECK_INTERVAL"
    case "$ci" in ''|*[!0-9]*) ci=10 ;; esac
    win=$((gr + ft * iv + 2 * ci))

    local delta
    delta=$((now - crash_ts))
    [ "$delta" -ge 0 ] && [ "$delta" -le "$win" ] && return 0
    return 1
}

# Decide whether to HOLD the recovery ladder this cycle. Returns 0 to HOLD
# (caller skips do_recovery and lets the modem self-heal), 1 to PROCEED to the
# normal ladder. Sits BELOW all existing guards (LOCKED, cooldown, revert) and
# only intercepts at the do_recovery initiation sites.
ssr_hold_gate() {
    local now
    local held

    # Already holding? Check whether the grace window expired.
    if [ "$ssr_hold" = "true" ]; then
        now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
        case "$now" in ''|*[!0-9]*) now=0 ;; esac
        held=$((now - ssr_hold_started))
        if [ "$held" -ge "$CFG_SSR_GRACE" ]; then
            qlog_warn "SSR-hold grace (${CFG_SSR_GRACE}s) expired without recovery; releasing to ladder"
            ssr_hold="false"
            ssr_hold_started=0
            return 1   # fall through to the normal ladder (genuine stuck case)
        fi
        return 0       # keep holding
    fi

    # Not yet holding — start a hold only if an SSR is detectable right now.
    if ssr_in_progress; then
        now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
        case "$now" in ''|*[!0-9]*) now=0 ;; esac
        ssr_hold="true"
        ssr_hold_started="$now"
        last_ssr_detected="$now"   # monotonic seconds; UI surfaces "self-recovery"
        qlog_warn "Recoverable baseband SSR detected; holding recovery ladder up to ${CFG_SSR_GRACE}s for self-heal"
        append_event "watchcat_recovery" "Watchcat: recoverable baseband restart detected — holding recovery to let the modem self-heal" "info" "wd_ssr_hold"
        return 0
    fi
    return 1
}

# Clear an SSR hold on natural recovery (connectivity returned on its own — the
# expected happy path; we did nothing harmful). Idempotent.
ssr_hold_clear() {
    if [ "$ssr_hold" = "true" ]; then
        qlog_info "SSR-hold cleared: connectivity recovered naturally"
    fi
    ssr_hold="false"
    ssr_hold_started=0
}

WD_DETECT_LOADED=1
