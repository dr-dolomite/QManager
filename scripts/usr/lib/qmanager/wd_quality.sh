#!/bin/sh
# =============================================================================
# wd_quality.sh - qmanager_watchcat: the quality window and quality trigger
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: quality_breach_since, quality_since, WD_PING_HISTORY, WD_PERIOD,
#       q_avg_latency, q_packet_loss
# Functions: wd_probe_period, wd_quality_mark, read_quality, quality_breached,
#            evaluate_quality
#
# evaluate_quality starts the recovery ladder (find_next_tier / do_recovery from
# wd_tiers.sh, start gate and SSR hold from wd_detect.sh), so it writes state,
# recovery_reason and current_tier, which other libs own. Function definitions
# and global initialisers only. The last line sets WD_QUALITY_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
# Mono second of the first breaching evaluation of the current quality breach;
# 0 = no breach in progress. A clean window resets it, a no-signal window keeps
# it, and the ladder starts once mono - since >= CFG_QUALITY_AFTER_SEC (spec
# section 5.2). The state file reports mono - since as quality_breach_secs.
quality_breach_since=0

# Quality window. Quality is judged from the ping daemon's raw sample history
# ("<rtt ms|null> <leg>" per line, newest last), not from the poller's
# status.json, so a long-gone outage cannot leak into a fresh decision.
# quality_since is the monotonic second the window starts at: wd_quality_mark
# resets it after every event that makes older samples meaningless (startup, an
# outage, a recovery action, a SIM swap, a LOCKED or radio-off exit). The window
# holds at most W samples, W = clamp(120 / ping interval, 10, 60), and at least
# 10 samples (answers and losses) must have accrued since the mark or there is
# no signal.
quality_since=0
WD_PING_HISTORY="/tmp/qmanager_ping_history"

# wd_probe_period: WD_PERIOD = seconds between two ping samples, the larger of
# the configured interval and the daemon's measured cycle (cycle_ms, rounded).
# In an outage a cycle runs the parallel fallback legs (~4 s), which is longer
# than a 1-2 s interval; counting samples by the interval alone would reach
# back past the mark or underestimate how long a failure streak took.
WD_PERIOD=5
wd_probe_period() {
    local _cms
    WD_PERIOD="$CQ_INTERVAL_SEC"
    case "$WD_PERIOD" in ''|*[!0-9]*) WD_PERIOD=5 ;; esac
    [ "$WD_PERIOD" -ge 1 ] || WD_PERIOD=5
    _cms="$CQ_CYCLE_MS"
    case "$_cms" in ''|*[!0-9]*) return 0 ;; esac
    [ "${#_cms}" -le 7 ] || return 0
    _cms=$(( (_cms + 500) / 1000 ))
    [ "$_cms" -gt "$WD_PERIOD" ] && WD_PERIOD="$_cms"
    return 0
}

wd_quality_mark() {
    quality_since=$(mono_now)
    case "$quality_since" in ''|*[!0-9]*) quality_since=0 ;; esac
}

# Returns 0 with the window's figures, 1 for no signal (too few samples since the
# mark, or no history). Freshness is the caller's job: read_ping has already run
# this pass and a stale ping cache stops the pass before this is reached.
# Sets: q_avg_latency (may be "null"), q_packet_loss (integer 0-100)
q_avg_latency="null"
q_packet_loss="0"
read_quality() {
    local iv
    local w
    local n
    local now
    local since
    local out

    wd_probe_period
    iv="$WD_PERIOD"
    w=$((120 / iv))
    [ "$w" -lt 10 ] && w=10
    [ "$w" -gt 60 ] && w=60

    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac
    since="$quality_since"
    case "$since" in ''|*[!0-9]*) since=0 ;; esac
    [ "$now" -ge "$since" ] || return 1
    n=$(( (now - since) / iv ))
    [ "$n" -gt "$w" ] && n=$w
    [ "$n" -ge 10 ] || return 1

    [ -f "$WD_PING_HISTORY" ] || return 1
    # Lines are "<rtt|null> <leg>" (one column in an older ring): $1 only.
    out=$(tail -n "$n" "$WD_PING_HISTORY" 2>/dev/null | awk '
        { c++ }
        $1 ~ /^[0-9]+(\.[0-9]+)?$/ { s += $1; k++; next }
        { nl++ }
        END {
            if (c < 10) exit 1
            if (k > 0) avg = sprintf("%.1f", s / k); else avg = "null"
            printf "%s %d\n", avg, int(nl * 100 / c)
        }')
    [ -n "$out" ] || return 1
    q_avg_latency="${out% *}"
    q_packet_loss="${out#* }"
    case "$q_packet_loss" in ''|*[!0-9]*) q_packet_loss=0 ;; esac
    return 0
}

# Decide whether current quality (already read by read_quality) breaches the
# limits: the shared CQ thresholds raised to the watchdog floors (wd_config.sh),
# so both limits are always set. OR logic: avg latency > limit, or loss >= limit.
# avg_latency_ms is a FLOAT: compare in awk (BusyBox [ -gt ] errors on
# decimals). An all-lost window has no average and is judged on loss alone.
# Returns 0 if breached, 1 if not.
quality_breached() {
    if [ "$q_avg_latency" != "null" ]; then
        if awk -v a="$q_avg_latency" -v c="$CFG_LATENCY_THRESHOLD_MS" 'BEGIN{ exit !((a+0) > (c+0)) }'; then
            qlog_warn "QUALITY breach: avg latency ${q_avg_latency}ms > ${CFG_LATENCY_THRESHOLD_MS}ms"
            return 0
        fi
    fi
    if [ "$q_packet_loss" -ge "$CFG_LOSS_THRESHOLD_PCT" ] 2>/dev/null; then
        qlog_warn "QUALITY breach: loss ${q_packet_loss}% >= ${CFG_LOSS_THRESHOLD_PCT}%"
        return 0
    fi
    return 1
}

# Quality trigger (spec section 5.2). Runs only in monitor with a fresh
# reachable=true read and streak_fail=0; any other pass ends the breach in
# progress (the outage restarts the window too). A breaching window starts the
# breach timer (quality_breach_since = mono of the first breaching pass), a clean
# window resets it, a no-signal window keeps it. Once the breach has lasted
# CFG_QUALITY_AFTER_SEC the start gate decides; the quality ladder is Tier 1-2
# only (find_next_tier, wd_tiers.sh).
# Returns 0 if it TRIGGERED recovery this cycle (caller skips rest of cycle),
# 1 otherwise.
evaluate_quality() {
    local now
    local held
    local gate
    [ "$CFG_QUALITY_ENABLED" = "1" ] || return 1
    if [ "$state" != "monitor" ] || [ "$ping_reachable" != "true" ] || [ "$ping_streak_fail" != "0" ]; then
        quality_breach_since=0
        return 1
    fi
    if ! read_quality; then
        # no-signal: the breach timer is kept (never starts, never resets)
        return 1
    fi
    if ! quality_breached; then
        quality_breach_since=0
        # A clean window (read_quality had enough samples) ends a quality pause
        # early (spec section 5.5).
        if [ "$wd_hold_q_until" -gt 0 ]; then
            qlog_info "QUALITY: clean window, ending the quality pause"
            wd_holdoff_clear quality
        fi
        return 1
    fi

    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac
    case "$quality_breach_since" in ''|*[!0-9]*) quality_breach_since=0 ;; esac
    if [ "$quality_breach_since" -le 0 ] || [ "$quality_breach_since" -gt "$now" ]; then
        quality_breach_since="$now"
        # mono 0 cannot mark a breach (0 = none): count from second 1.
        [ "$quality_breach_since" -gt 0 ] || quality_breach_since=1
    fi
    held=$((now - quality_breach_since))
    if [ "$held" -lt "$CFG_QUALITY_AFTER_SEC" ]; then
        qlog_info "QUALITY: breach for ${held}s/${CFG_QUALITY_AFTER_SEC}s (avg ${q_avg_latency}ms vs ${CFG_LATENCY_THRESHOLD_MS}ms, loss ${q_packet_loss}% vs ${CFG_LOSS_THRESHOLD_PCT}%)"
        return 1
    fi

    wd_radio_reconcile quality
    gate=$(wd_start_gate quality)
    case "$gate" in
        none|holdoff)
            # No Tier 1/2 to run, or paused after an exhausted quality ladder:
            # no recovery, no event. The breach timer keeps running (the link
            # is still degraded), so quality_breach_secs stays truthful and a
            # breach that outlasts the pause starts the ladder when it ends.
            qlog_debug "QUALITY: recovery not started ($gate)"
            return 1
            ;;
        radio_off)
            wd_enter_radio_off
            return 0
            ;;
    esac
    qlog_warn "QUALITY → RECOVERY: breach for ${held}s (avg ${q_avg_latency}ms / loss ${q_packet_loss}% vs ${CFG_LATENCY_THRESHOLD_MS}ms / ${CFG_LOSS_THRESHOLD_PCT}%)"
    append_event "watchcat_recovery" "Watchcat: connection quality degraded (latency ${q_avg_latency}ms / loss ${q_packet_loss}%) — starting recovery" "warning" "wd_tier_start"
    quality_breach_since=0
    recovery_reason="quality"

    # SSR-aware hold: if a recoverable baseband SSR is mid-flight, hold
    # the ladder this cycle rather than forcing a detach. Not the main
    # loop here — return from evaluate_quality so do_recovery is skipped;
    # the main loop's write_state + sleep proceed normally.
    if ssr_hold_gate; then
        state="ssr_hold"
        return 0
    fi

    state="recovery"
    # A tier above 2 left over from an outage episode is not a quality step.
    if [ "$current_tier" -eq 0 ] || [ "$current_tier" -gt 2 ]; then
        find_next_tier 1
    fi
    do_recovery
    return 0
}

WD_QUALITY_LOADED=1
