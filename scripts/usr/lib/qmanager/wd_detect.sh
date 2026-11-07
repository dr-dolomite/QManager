#!/bin/sh
# =============================================================================
# wd_detect.sh - qmanager_watchcat: inputs that start or hold recovery
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: ping_streak_fail, ping_reachable, ping_during_recovery, ssr_hold,
#       last_ssr_detected, ssr_hold_started, wd_resume_mono, wd_outage_age,
#       wd_offline_secs, wd_act_after_eff, wd_recover_secs, wd_ping_interval,
#       _wd_attach_seen,
#       _wd_ssr_cur_id, _wd_ssr_held_id
# Functions: read_ping, wd_resume_mark, wd_attach_tick, wd_outage_update,
#            wd_outage_clear, wd_outage_due, wd_step_wait_secs, wd_decide_start,
#            wd_holdoff_left, wd_radio_reconcile, wd_start_gate,
#            ssr_in_progress, ssr_hold_gate, ssr_hold_clear
#
# The quality window and the quality trigger (evaluate_quality) live in
# wd_quality.sh. Function definitions and global initialisers only. The last
# line sets WD_DETECT_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
ssr_hold="false"          # JSON bool literal for write_state
last_ssr_detected="null"  # JSON null literal or monotonic-seconds integer
ssr_hold_started=0        # monotonic seconds-since-boot when hold began; 0 = not holding
_wd_ssr_cur_id=""         # identity of the SSR ssr_in_progress last saw in its window
_wd_ssr_held_id=""        # identity of the SSR that already held once ("" = none)

# --- Outage age (spec section 5.2) -------------------------------------------
# outage age = min(fail_elapsed_sec, now - wd_resume_mono): an outage that aged
# while the watchdog could not act (boot settle, attach warm-up, radio off,
# LOCKED, a SIM settle) only counts from the moment it could act again.
wd_resume_mono=0          # mono of the last point the watchdog could act again
wd_outage_age=0           # outage age of the last fresh read (failure_secs)
wd_offline_secs=0         # raw fail_elapsed_sec of the last fresh read (offline_secs)
wd_act_after_eff=30       # max(CFG_ACT_AFTER_SEC, ping fail_secs) of the last fresh read
wd_recover_secs=10        # ping recover_secs of the last fresh read (10 when unknown)
wd_ping_interval=5        # ping interval_sec of the last fresh read (5 when unknown)
_wd_attach_seen=0         # 1 while the ping attach warm-up flag was seen
WD_ATTACH_FLAG="/tmp/qmanager_ping_attaching"

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

# Stamps the moment the watchdog can act again; the outage age restarts at 0.
wd_resume_mark() {
    local now
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    wd_resume_mono="$now"
    wd_outage_age=0
}

# Once per pass: the first pass without the ping attach warm-up flag after a
# pass with it is a resume point (the failures counted during the warm-up are
# not an outage the watchdog could have acted on).
wd_attach_tick() {
    if [ -f "$WD_ATTACH_FLAG" ]; then
        _wd_attach_seen=1
    elif [ "$_wd_attach_seen" = "1" ]; then
        _wd_attach_seen=0
        qlog_info "Ping attach warm-up over: outage age restarts now"
        wd_resume_mark
    fi
}

# After a fresh read_ping: sets wd_act_after_eff, wd_offline_secs and
# wd_outage_age (0 while reachable or while the attach flag exists).
wd_outage_update() {
    local fs
    local fe
    local now
    local since
    fs="$CQ_FAIL_SECS"
    case "$fs" in ''|*[!0-9]*) fs=20 ;; esac
    wd_act_after_eff="$CFG_ACT_AFTER_SEC"
    case "$wd_act_after_eff" in ''|*[!0-9]*) wd_act_after_eff=30 ;; esac
    [ "$fs" -gt "$wd_act_after_eff" ] && wd_act_after_eff="$fs"
    wd_recover_secs="$CQ_RECOVER_SECS"
    case "$wd_recover_secs" in ''|*[!0-9]*) wd_recover_secs=10 ;; esac
    [ "${#wd_recover_secs}" -gt 4 ] && wd_recover_secs=9999
    wd_ping_interval="$CQ_INTERVAL_SEC"
    case "$wd_ping_interval" in ''|*[!0-9]*) wd_ping_interval=5 ;; esac
    [ "${#wd_ping_interval}" -gt 3 ] && wd_ping_interval=300
    [ "$wd_ping_interval" -ge 1 ] || wd_ping_interval=5

    if [ "$ping_reachable" = "true" ]; then
        wd_offline_secs=0
        wd_outage_age=0
        return 0
    fi
    fe="$CQ_FAIL_ELAPSED"
    case "$fe" in ''|*[!0-9]*) fe=0 ;; esac
    wd_offline_secs="$fe"
    # The flag may vanish between wd_attach_tick and this read: until the next
    # pass's tick stamps the resume, a seen flag still counts as present.
    if [ -f "$WD_ATTACH_FLAG" ] || [ "$_wd_attach_seen" = "1" ]; then
        wd_outage_age=0
        return 0
    fi
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    since=$((now - wd_resume_mono))
    [ "$since" -lt 0 ] && since=0
    if [ "$fe" -lt "$since" ]; then
        wd_outage_age="$fe"
    else
        wd_outage_age="$since"
    fi
    return 0
}

# wd_step_wait_secs [floor]: prints the effective step wait,
# max(step_wait_sec, recover_secs + 20, floor): an outage verdict needs
# recover_secs of answered probes, so a shorter wait could only ever fail.
# Tier 3 and the SIM settles pass SIM_SETTLE_SECS as the floor; a quality
# cooldown passes 10 x interval_sec + 10, so its window holds the 10 samples a
# verdict needs (contract Amendment 2).
wd_step_wait_secs() {
    local secs
    local fl
    secs="$CFG_STEP_WAIT_SEC"
    case "$secs" in ''|*[!0-9]*) secs=60 ;; esac
    [ $((wd_recover_secs + 20)) -gt "$secs" ] && secs=$((wd_recover_secs + 20))
    fl="$1"
    case "$fl" in ''|*[!0-9]*) fl=0 ;; esac
    [ "$fl" -gt "$secs" ] && secs="$fl"
    printf '%s' "$secs"
}

# LOCKED / radio_off entry: the watchdog cannot act, so no outage age counts.
wd_outage_clear() {
    wd_outage_age=0
    wd_offline_secs=0
}

# rc 0 when the last fresh read is an outage old enough to start recovery.
wd_outage_due() {
    [ "$ping_reachable" = "false" ] || return 1
    [ "$wd_outage_age" -ge "$wd_act_after_eff" ]
}

# Pure start gate (no I/O, no globals), in this order:
#   wd_decide_start <tiers_any 0|1> <cfun> <holdoff_left_secs>
#   none       no tier is enabled: there is nothing to run, stay as we are
#   holdoff    a ladder of the same reason ran out recently: wait out its pause
#              (holdoff_left_secs is the pause of the reason being started only)
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

# wd_holdoff_left <outage|quality>: prints the seconds left of that reason's
# pause after an exhausted ladder (0 = none). Anything but "quality" = outage.
wd_holdoff_left() {
    local now
    local hold_end
    if [ "$1" = "quality" ]; then
        hold_end="$wd_hold_q_until"
    else
        hold_end="$wd_hold_out_until"
    fi
    case "$hold_end" in
        ''|*[!0-9]*) printf '0'; return 0 ;;
    esac
    [ "$hold_end" -gt 0 ] || { printf '0'; return 0; }
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    if [ "$hold_end" -gt "$now" ]; then
        printf '%s' $((hold_end - now))
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
# Nothing is read while the gate for <reason> ($1) is paused by its hold-off: it
# decides without CFUN.
wd_radio_reconcile() {
    [ "$wd_radio_down" = "1" ] || return 0
    [ "$(wd_holdoff_left "$1")" = "0" ] || return 0
    if [ "$(wd_cfun_now)" = "1" ]; then
        qlog_info "Radio reads AT+CFUN=1: clearing the stale radio-down marker"
        wd_mark_radio_up
    fi
    return 0
}

# wd_start_gate <outage|quality>: gathers the three inputs for wd_decide_start
# (the hold-off left of that reason only) and prints its verdict. The one
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
    # The quality ladder is Tier 1-2 only (find_next_tier, spec D5).
    if [ "$1" != "quality" ]; then
        [ "$CFG_TIER3_ENABLED" = "1" ] && any=1
        # A resting Tier 4 (wd_ledger.sh) is not an eligible tier.
        [ "$CFG_TIER4_ENABLED" = "1" ] && [ -z "$reboot_rest_reason" ] && any=1
    fi

    hl=$(wd_holdoff_left "$1")

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
# known, it is within the detection window of now, and that SSR identity has not
# held before; 1 (false) otherwise, including when the platform knows no crash
# time (graceful degradation: absence of evidence is NOT evidence of absence; we
# never block recovery on it). Polls the platform ONCE per invocation (only at
# an escalation decision). Sets _wd_ssr_cur_id for ssr_hold_gate.
ssr_in_progress() {
    [ "$CFG_SSR_AWARE" = "1" ] || return 1

    local crash_ts
    local now
    local id

    plat_ssr_poll
    crash_ts="$PLAT_SSR_MONO"
    case "$crash_ts" in ''|*[!0-9]*) return 1 ;; esac

    now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac

    # One hold per SSR identity: once a restart has held, a later escalation for
    # the same restart (the Tier 4 re-check, a second trigger) goes to the ladder.
    # A platform without an identity falls back to the crash mono.
    id="$PLAT_SSR_ID"
    [ -n "$id" ] || id="mono:$crash_ts"
    [ "$id" = "$_wd_ssr_held_id" ] && return 1

    # The crash is only visible to the ladder once the outage age has reached
    # act_after_eff, so the look-back covers the grace, the trigger, one worst
    # probe cycle (8 s) and two check passes (2 x 10 s).
    local gr
    local aa
    local win
    gr="$CFG_SSR_GRACE"
    case "$gr" in ''|*[!0-9]*) gr=45 ;; esac
    aa="$wd_act_after_eff"
    case "$aa" in ''|*[!0-9]*) aa=30 ;; esac
    win=$((gr + aa + 8 + 2 * 10))

    local delta
    delta=$((now - crash_ts))
    if [ "$delta" -ge 0 ] && [ "$delta" -le "$win" ]; then
        _wd_ssr_cur_id="$id"
        return 0
    fi
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
        _wd_ssr_held_id="$_wd_ssr_cur_id"
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
