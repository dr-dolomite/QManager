#!/bin/sh
# =============================================================================
# wd_quality.sh - qmanager_watchcat: the quality window and quality trigger
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: quality_breach_counter, quality_since, WD_PING_HISTORY, WD_PERIOD,
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
quality_breach_counter=0

# Quality window. Quality is judged from the ping daemon's raw sample history
# ("<rtt ms|null> <leg>" per line, newest last), not from the poller's
# status.json, so a long-gone outage cannot leak into a fresh decision.
# quality_since is the monotonic second the window starts at: wd_quality_mark
# resets it after every event that makes older samples meaningless (startup, an
# outage, a recovery action, a SIM swap, a LOCKED or radio-off exit). The window
# holds at most W samples, W = clamp(120 / ping interval, 6, 60), and at least 3
# samples must have accrued since the mark or there is no signal.
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
    [ "$w" -lt 6 ] && w=6
    [ "$w" -gt 60 ] && w=60

    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac
    since="$quality_since"
    case "$since" in ''|*[!0-9]*) since=0 ;; esac
    [ "$now" -ge "$since" ] || return 1
    n=$(( (now - since) / iv ))
    [ "$n" -gt "$w" ] && n=$w
    [ "$n" -ge 3 ] || return 1

    [ -f "$WD_PING_HISTORY" ] || return 1
    # Lines are "<rtt|null> <leg>" (one column in an older ring): $1 only.
    out=$(tail -n "$n" "$WD_PING_HISTORY" 2>/dev/null | awk '
        { c++ }
        $1 ~ /^[0-9]+(\.[0-9]+)?$/ { s += $1; k++; next }
        { nl++ }
        END {
            if (c < 3) exit 1
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
# configured ceilings. OR logic; a ceiling of 0 means IGNORE that metric.
# avg_latency_ms is a FLOAT — comparison MUST use awk (BusyBox [ -gt ] errors
# on decimals). Returns 0 if breached, 1 if not.
quality_breached() {
    # latency: only if threshold > 0 AND we have a numeric windowed average
    if [ "$CFG_LATENCY_THRESHOLD_MS" -gt 0 ] 2>/dev/null && [ "$q_avg_latency" != "null" ]; then
        if awk -v a="$q_avg_latency" -v c="$CFG_LATENCY_THRESHOLD_MS" 'BEGIN{ exit !((a+0) > (c+0)) }'; then
            qlog_warn "QUALITY breach: avg latency ${q_avg_latency}ms > ${CFG_LATENCY_THRESHOLD_MS}ms (shared)"
            return 0
        fi
    fi
    # loss: only if threshold > 0
    if [ "$CFG_LOSS_THRESHOLD_PCT" -gt 0 ] 2>/dev/null; then
        if [ "$q_packet_loss" -ge "$CFG_LOSS_THRESHOLD_PCT" ] 2>/dev/null; then
            qlog_warn "QUALITY breach: loss ${q_packet_loss}% >= ${CFG_LOSS_THRESHOLD_PCT}% (shared)"
            return 0
        fi
    fi
    return 1
}

# Accrue the consecutive-breach counter and, on reaching the threshold, kick
# off the SAME Tier 1->4 recovery ladder used by the reachability path.
# Returns 0 if it TRIGGERED recovery this cycle (caller skips rest of cycle),
# 1 otherwise.
evaluate_quality() {
    [ "$CFG_QUALITY_ENABLED" = "1" ] || return 1
    if ! read_quality; then
        # no-signal: leave counter unchanged (never count as breach, never reset)
        return 1
    fi
    if quality_breached; then
        quality_breach_counter=$((quality_breach_counter + 1))
        qlog_info "QUALITY: breach ${quality_breach_counter}/${CFG_QUALITY_CONSECUTIVE} (avg ${q_avg_latency}ms vs ${CFG_LATENCY_THRESHOLD_MS}ms, loss ${q_packet_loss}% vs ${CFG_LOSS_THRESHOLD_PCT}%)"
        if [ "$quality_breach_counter" -ge "$CFG_QUALITY_CONSECUTIVE" ]; then
            local gate
            wd_radio_reconcile
            gate=$(wd_start_gate)
            case "$gate" in
                none|holdoff)
                    # Nothing to run, or paused after an exhausted ladder: no
                    # recovery, no event; the breach count restarts.
                    qlog_debug "QUALITY: recovery not started ($gate)"
                    quality_breach_counter=0
                    return 1
                    ;;
                radio_off)
                    wd_enter_radio_off
                    return 0
                    ;;
            esac
            qlog_warn "QUALITY → RECOVERY: ${CFG_QUALITY_CONSECUTIVE} consecutive breaches (avg ${q_avg_latency}ms / loss ${q_packet_loss}% vs ${CFG_LATENCY_THRESHOLD_MS}ms / ${CFG_LOSS_THRESHOLD_PCT}%)"
            append_event "watchcat_recovery" "Watchcat: connection quality degraded (latency ${q_avg_latency}ms / loss ${q_packet_loss}%) — starting recovery" "warning" "wd_tier_start"
            quality_breach_counter=0
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
            if [ "$current_tier" -eq 0 ]; then
                find_next_tier 1
            fi
            do_recovery
            return 0
        fi
    else
        quality_breach_counter=0
    fi
    return 1
}

WD_QUALITY_LOADED=1
