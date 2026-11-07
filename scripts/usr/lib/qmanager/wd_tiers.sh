#!/bin/sh
# =============================================================================
# wd_tiers.sh - qmanager_watchcat: recovery ladder (tiers 1/2/4) and cooldown
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: current_tier, last_recovery_time, last_recovery_tier, total_recoveries,
#       cooldown_remaining, cooldown_stale_retries, recovery_reason,
#       _recovery_marker_emitted, wd_hold_out_until, wd_hold_q_until,
#       wd_hold_q_level, wd_hold_q_end, holdoff_until, holdoff_reason (derived)
# Functions: wait_for_modem, execute_tier1, execute_tier2,
#            _wd_confirm_radio_on, wd_enter_radio_off, _wd_start_holdoff,
#            _wd_holdoff_sync, wd_holdoff_clear, wd_holdoff_reload, wd_holdoff_tick,
#            wd_retire_service, execute_tier4, find_next_tier, do_recovery,
#            _cooldown_handle_failure, wd_cooldown_verdict, finish_cooldown
#
# Tier 3 (execute_tier3) and every SIM-slot swap live in wd_sim.sh;
# finish_cooldown hands the primary-recheck verdict to wd_sim_finish_recheck.
# Cross-lib writes (state, failure_counter, revert_settle_active, ...) are listed
# at the top of main() in qmanager_watchcat. Function definitions and global
# initialisers only. The last line sets WD_TIERS_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
current_tier=0
last_recovery_time="null"
last_recovery_tier="null"
total_recoveries=0
cooldown_remaining=0
cooldown_stale_retries=0
recovery_reason="outage"   # "outage" | "quality" — why current/last recovery fired
_recovery_marker_emitted=""     # "<tier>-<reason>" of the last emitted start marker; "" = none this episode
# Pauses after an exhausted ladder (spec section 5.5), one per recovery reason.
# A pause blocks a new ladder of its own reason only (wd_start_gate <reason>).
wd_hold_out_until=0             # mono end of the outage pause; 0 = none
wd_hold_q_until=0               # mono end of the quality pause; 0 = none
wd_hold_q_level=0               # 0-2: step of the last quality pause (15/30/60 min)
wd_hold_q_end=0                 # mono the last quality pause ended; 0 = none within the reset hour
# Derived by _wd_holdoff_sync for the state file: the pause that ends last
# (outage wins a tie). Never written anywhere else.
holdoff_until=0
holdoff_reason=""

_wd_holdoff_sync() {
    if [ "$wd_hold_out_until" -ge "$wd_hold_q_until" ]; then
        holdoff_until="$wd_hold_out_until"
        holdoff_reason="outage"
        [ "$wd_hold_out_until" -gt 0 ] || holdoff_reason=""
    else
        holdoff_until="$wd_hold_q_until"
        holdoff_reason="quality"
    fi
}

# wd_holdoff_clear <outage|quality>: ends that reason's pause early. Outage: a
# fresh reachable=true read. Quality: a clean quality window or a quality
# cooldown success; never reachability (the link is reachable during quality
# trouble). The quality level is kept: it only resets after the quiet hour or a
# settings reload (wd_holdoff_reload).
wd_holdoff_clear() {
    local now
    if [ "$1" = "quality" ]; then
        [ "$wd_hold_q_until" -gt 0 ] || return 0
        now=$(mono_now)
        case "$now" in ''|*[!0-9]*) now=0 ;; esac
        if [ "$wd_hold_q_until" -gt "$now" ]; then
            wd_hold_q_end="$now"
        else
            wd_hold_q_end="$wd_hold_q_until"
        fi
        wd_hold_q_until=0
    else
        [ "$wd_hold_out_until" -gt 0 ] || return 0
        wd_hold_out_until=0
    fi
    _wd_holdoff_sync
}

# Settings reload: ends the quality pause and resets its growth (contract 5.4).
wd_holdoff_reload() {
    if [ "$wd_hold_q_until" -gt 0 ] || [ "$wd_hold_q_level" -gt 0 ] || [ "$wd_hold_q_end" -gt 0 ]; then
        qlog_info "Settings reload: quality pause and its growth reset"
    fi
    wd_hold_q_until=0
    wd_hold_q_level=0
    wd_hold_q_end=0
    _wd_holdoff_sync
}

# Once per pass: a quality pause that ran out records its end, and an hour after
# the last quality pause ended the level drops back to 0. No clock read while
# there is nothing to age.
wd_holdoff_tick() {
    local now
    [ "$wd_hold_q_until" -gt 0 ] || [ "$wd_hold_q_end" -gt 0 ] || return 0
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) return 0 ;; esac
    if [ "$wd_hold_q_until" -gt 0 ] && [ "$wd_hold_q_until" -le "$now" ]; then
        wd_hold_q_end="$wd_hold_q_until"
        wd_hold_q_until=0
        _wd_holdoff_sync
    fi
    if [ "$wd_hold_q_until" -eq 0 ] && [ "$wd_hold_q_end" -gt 0 ] && [ $((now - wd_hold_q_end)) -ge "$HOLDOFF_QUALITY_RESET_SECS" ]; then
        if [ "$wd_hold_q_level" -gt 0 ]; then
            qlog_info "No quality pause for ${HOLDOFF_QUALITY_RESET_SECS}s: quality pause length back to 15 minutes"
        fi
        wd_hold_q_level=0
        wd_hold_q_end=0
    fi
    return 0
}

# Wait for modem to respond to AT commands after recovery action
wait_for_modem() {
    local elapsed=0
    while [ "$elapsed" -lt "$MODEM_WAIT_TIMEOUT" ]; do
        if qcmd 'AT' >/dev/null 2>&1; then
            qlog_info "Modem responsive after ${elapsed}s"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    qlog_error "Modem unresponsive after ${MODEM_WAIT_TIMEOUT}s"
    return 1
}

# =============================================================================
# RECOVERY TIERS
# =============================================================================

execute_tier1() {
    qlog_info "TIER 1: Network re-registration (AT+COPS=2 -> AT+COPS=0)"
    append_event "watchcat_recovery" "Watchcat: re-registering on network (Tier 1)" "warning" "wd_tier_start"

    touch "$RECOVERY_FLAG"
    qcmd 'AT+COPS=2' >/dev/null 2>&1
    sleep 2
    qcmd 'AT+COPS=0' >/dev/null 2>&1
    return 0
}

execute_tier2() {
    # Pre-check: tower lock
    if plat_tower_locked; then
        qlog_warn "TIER 2 SKIPPED: tower lock active"
        return 1  # signal to skip this tier
    fi

    # Pre-check: long-running command
    if plat_long_running; then
        qlog_warn "TIER 2 SKIPPED: long-running AT command active"
        return 1
    fi

    qlog_info "TIER 2: Toggling radio (AT+CFUN=0/1)"
    append_event "watchcat_recovery" "Watchcat: toggling radio (Tier 2)" "warning" "wd_tier_start"

    touch "$RECOVERY_FLAG"

    local result
    wd_mark_radio_down
    result=$(qcmd 'AT+CFUN=0' 2>/dev/null)
    if [ $? -ne 0 ]; then
        qlog_error "TIER 2: AT+CFUN=0 failed"
        _wd_confirm_radio_on
        return 0  # action attempted, enter cooldown
    fi

    sleep 3

    qcmd 'AT+CFUN=1' >/dev/null 2>&1
    wait_for_modem
    _wd_confirm_radio_on
    return 0
}

# Tier 2 must never leave the radio off. Reads AT+CFUN?; anything but 1 gets one
# more AT+CFUN=1 and a second read. Clears the exit marker only once the radio
# is confirmed on; if it still is not, the marker stays (the exit cleanup then
# restores the radio, and wd_start_gate keeps escalating instead of mistaking it
# for the user's airplane mode).
_wd_confirm_radio_on() {
    local cf
    cf=$(wd_cfun_now)
    if [ "$cf" = "1" ]; then
        wd_mark_radio_up
        return 0
    fi
    qlog_warn "TIER 2: radio functionality is '${cf:-unknown}' after AT+CFUN=1, sending it again"
    qcmd 'AT+CFUN=1' >/dev/null 2>&1
    cf=$(wd_cfun_now)
    if [ "$cf" = "1" ]; then
        wd_mark_radio_up
        return 0
    fi
    qlog_error "TIER 2: radio still not on after a second AT+CFUN=1 (CFUN=${cf:-unknown})"
    return 1
}

# The radio was turned off by the user (AT+CFUN 0 or 4 seen when recovery was
# about to start): park in radio_off, run nothing, and let the main loop's
# radio_off arm resume monitoring when AT+CFUN? reads 1 again.
wd_enter_radio_off() {
    qlog_warn "Radio is off (AT+CFUN 0 or 4): holding recovery until it is back on"
    rm -f "$RECOVERY_FLAG"
    append_event "watchcat_recovery" "Watchcat: radio is off, recovery paused until it is turned back on" "info" "wd_radio_paused"
    state="radio_off"
    current_tier=0
    failure_counter=0
    cooldown_remaining=0
    cooldown_stale_retries=0
    quality_breach_counter=0
    _recovery_marker_emitted=""
    ssr_hold_clear
    wd_outage_clear
}

# Ends the service the way the UI's "off" does (disable, then stop). procd
# respawns any exit, whatever the code, and start_service's config gate is not
# consulted on respawn, so a bare exit would be re-run up to 5 times. `stop`
# deletes the procd instance and TERMs this daemon; the TERM trap runs once the
# init script returns. Without procd (manual run) `stop` is a no-op and the
# caller's exit follows.
wd_retire_service() {
    svc_disable qmanager_watchcat >/dev/null 2>&1
    svc_stop qmanager_watchcat >/dev/null 2>&1
}

execute_tier4() {
    # Token bucket check
    count_recent_reboots
    if [ "$reboots_this_hour" -ge "$CFG_MAX_REBOOTS_PER_HOUR" ]; then
        qlog_error "TIER 4: Reboot limit reached (${reboots_this_hour}/${CFG_MAX_REBOOTS_PER_HOUR} per hour)"
        qlog_error "TIER 4: Auto-disabling watchcat"
        append_event "watchcat_recovery" "Watchcat disabled: reboot limit exceeded (${reboots_this_hour} reboots/hour)" "error"

        # Permanently disable in the config store
        cfg_set watchdog enabled 0
        cfg_commit 2>/dev/null

        CFG_ENABLED=0
        state="disabled"
        touch "$DISABLED_FLAG"
        write_state
        rm -f "$RECOVERY_FLAG"

        wd_retire_service
        exit 0
    fi

    qlog_error "TIER 4: System reboot (recovery ${reboots_this_hour}/${CFG_MAX_REBOOTS_PER_HOUR})"
    append_event "watchcat_recovery" "Watchcat: rebooting system (Tier 4)" "error" "wd_tier4_reboot"

    # Log reboot to crash.log (persists across reboots)
    local ts
    ts=$(date +%s)
    plat_crash_log_prepare
    echo "${ts}|reboot|tier4_escalation" >> "$CRASH_LOG"

    # Trim crash.log to last 20 entries
    if [ -f "$CRASH_LOG" ]; then
        local count
        count=$(wc -l < "$CRASH_LOG" 2>/dev/null || echo 0)
        if [ "$count" -gt 20 ]; then
            tail -n 20 "$CRASH_LOG" > "${CRASH_LOG}.tmp"
            mv "${CRASH_LOG}.tmp" "$CRASH_LOG"
        fi
    fi

    last_recovery_time="$ts"
    last_recovery_tier=4
    total_recoveries=$((total_recoveries + 1))
    write_state
    rm -f "$RECOVERY_FLAG"

    # Reboot after flushing state
    ( sleep 1; plat_reboot ) &
    exit 0
}

# =============================================================================
# ESCALATION ENGINE
# =============================================================================

# Find the next enabled tier >= start_tier. Returns 0 if found (sets
# current_tier), 1 if no tiers left.
find_next_tier() {
    local start="$1"
    local t="$start"

    while [ "$t" -le 4 ]; do
        case "$t" in
            1) [ "$CFG_TIER1_ENABLED" = "1" ] && { current_tier="$t"; return 0; } ;;
            2) [ "$CFG_TIER2_ENABLED" = "1" ] && { current_tier="$t"; return 0; } ;;
            3) [ "$CFG_TIER3_ENABLED" = "1" ] && { current_tier="$t"; return 0; } ;;
            4) [ "$CFG_TIER4_ENABLED" = "1" ] && { current_tier="$t"; return 0; } ;;
        esac
        t=$((t + 1))
    done
    return 1  # no enabled tiers remaining
}

do_recovery() {
    local action_result=0

    qlog_info "RECOVERY: Executing Tier $current_tier (reason=$recovery_reason)"
    touch "$RECOVERY_FLAG"

    # Emit a single reason-tagged recovery-start marker before the per-tier
    # action events. The per-tier execute_* functions log their own tier-specific
    # detail; this one carries the TRIGGER REASON (outage vs quality) so the
    # activity feed can distinguish a reachability recovery from a quality one.
    # Suppressed on the recursive skip-to-next-tier path (only fires at entry).
    if [ "$_recovery_marker_emitted" != "$current_tier-$recovery_reason" ]; then
        _recovery_marker_emitted="$current_tier-$recovery_reason"
        if [ "$recovery_reason" = "quality" ]; then
            append_event "watchcat_recovery" "Watchcat: starting recovery (Tier $current_tier) — connection quality degraded" "warning" "wd_tier_start"
        else
            append_event "watchcat_recovery" "Watchcat: starting recovery (Tier $current_tier) — internet unreachable" "warning" "wd_tier_start"
        fi
    fi

    # A tier can block for minutes (a Tier 3 swap) with no loop pass writing the
    # state file: publish the long heartbeat window first so the poller does not
    # report the daemon as dead meanwhile.
    write_state_busy

    case "$current_tier" in
        1) execute_tier1; action_result=$? ;;
        2) execute_tier2; action_result=$? ;;
        3) execute_tier3; action_result=$? ;;
        4) execute_tier4; action_result=$? ;;  # may not return (reboot/exit)
    esac

    # If tier was skipped (returned 1), try next tier
    if [ "$action_result" -ne 0 ]; then
        qlog_info "Tier $current_tier skipped, trying next"
        if find_next_tier $((current_tier + 1)); then
            do_recovery  # recurse with next tier
        else
            qlog_error "No more enabled tiers — all recovery options exhausted"
            rm -f "$RECOVERY_FLAG"
            _wd_start_holdoff
            state="monitor"
            current_tier=0
            failure_counter=0
            _recovery_marker_emitted=""
        fi
        return
    fi

    # Recovery action executed — enter cooldown. Quality samples taken before the
    # action describe the old link, so the quality window restarts here.
    wd_quality_mark
    local ts
    ts=$(date +%s)
    last_recovery_time="$ts"
    last_recovery_tier="$current_tier"
    total_recoveries=$((total_recoveries + 1))
    # Tier-3 (SIM failover) needs a longer settle floor: a physical swap is still
    # attaching well past the generic cooldown, so enforce max(CFG_COOLDOWN, 90)
    # before finish_cooldown reads the first success ping. cooldown_remaining
    # carries the longer value so the UI countdown stays honest.
    if [ "$current_tier" -eq 3 ] && [ "$CFG_COOLDOWN" -lt "$SIM_SETTLE_SECS" ]; then
        cooldown_remaining="$SIM_SETTLE_SECS"
    else
        cooldown_remaining="$CFG_COOLDOWN"
    fi
    state="cooldown"
    qlog_info "Entering COOLDOWN for ${cooldown_remaining}s (after Tier $current_tier)"
}

# =============================================================================
# COOLDOWN COMPLETION
# =============================================================================

# Every enabled tier has been tried without restoring the connection: pause a
# new ladder of the same reason (wd_start_gate <reason> returns "holdoff").
# Outage: HOLDOFF_OUTAGE_SECS. Quality: 15/30/60 minutes; the level steps up when
# the previous quality pause ended less than HOLDOFF_QUALITY_RESET_SECS ago.
_wd_start_holdoff() {
    local now
    local secs
    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    if [ "$recovery_reason" = "quality" ]; then
        if [ "$wd_hold_q_end" -gt 0 ] && [ $((now - wd_hold_q_end)) -lt "$HOLDOFF_QUALITY_RESET_SECS" ]; then
            [ "$wd_hold_q_level" -lt 2 ] && wd_hold_q_level=$((wd_hold_q_level + 1))
        else
            wd_hold_q_level=0
        fi
        case "$wd_hold_q_level" in
            1) secs="$HOLDOFF_QUALITY_SECS_1" ;;
            2) secs="$HOLDOFF_QUALITY_SECS_2" ;;
            *) secs="$HOLDOFF_QUALITY_SECS_0" ;;
        esac
        wd_hold_q_until=$((now + secs))
        wd_hold_q_end=0
    else
        secs="$HOLDOFF_OUTAGE_SECS"
        wd_hold_out_until=$((now + secs))
    fi
    _wd_holdoff_sync
    append_event "watchcat_recovery" "Watchcat: all recovery steps tried, pausing $((secs / 60)) minutes" "error" "wd_holdoff"
}

# Shared failure path for cooldown — fallback if Tier 3, then escalate.
_cooldown_handle_failure() {
    qlog_warn "COOLDOWN failure path entered for Tier $current_tier"

    # The radio gate was read for the swap-back below, so the escalation does not
    # read it a second time.
    local _ch_gated
    _ch_gated=0

    # If Tier 3 failed to restore connectivity, fall back to original SIM
    if [ "$current_tier" -eq 3 ] && [ "$current_sim_slot" != "$original_sim_slot" ] && [ "$original_sim_slot" != "null" ]; then
        # The swap-back cycles the radio (AT+CFUN=0/1): never over a radio the
        # user turned off. Keep the modem on the backup as a recorded failover and
        # park in radio_off; wd_sim_on_radio_back swaps back once it is on again.
        wd_radio_reconcile "$recovery_reason"
        _ch_gated=1
        if [ "$(wd_start_gate "$recovery_reason")" = "radio_off" ]; then
            qlog_warn "COOLDOWN: radio is off, deferring the swap back to slot $original_sim_slot"
            wd_sim_defer_revert
            wd_enter_radio_off
            return
        fi
        # A revert that cannot be verified leaves the modem on the backup slot:
        # record that as the failover it is (wd_sim_adopt_live_slot).
        sim_failover_fallback || wd_sim_adopt_live_slot
        # The Tier 3 settle is over: outage age counts from here.
        wd_resume_mark
    fi

    # Escalate to the next enabled tier. Cooldown already verified the prior tier
    # did NOT restore the link/quality, so recovery must continue immediately.
    # current_tier is now the next tier; run it directly via do_recovery rather
    # than bouncing through suspect. The reachability path used to prime an
    # accumulator (failure_counter=CFG_MAX_FAILURES) to force the next suspect
    # cycle to re-breach; with the raw-streak model that prime is gone, and for
    # the quality path a suspect bounce would wrongly fall through to natural
    # recovery (link is reachable during quality degradation). Direct do_recovery
    # is correct and reason-agnostic.
    if find_next_tier $((current_tier + 1)); then
        # Tier 2 confirms its own radio-on, so AT+CFUN 0/4 here is the user's.
        if [ "$_ch_gated" -eq 0 ]; then
            wd_radio_reconcile "$recovery_reason"
            if [ "$(wd_start_gate "$recovery_reason")" = "radio_off" ]; then
                wd_enter_radio_off
                return
            fi
        fi
        qlog_info "Escalating to Tier $current_tier (reason=$recovery_reason)"
        append_event "watchcat_recovery" "Watchcat: recovery escalating to Tier $current_tier — previous tier did not restore the connection" "warning" "wd_escalate"
        state="recovery"
        do_recovery
    else
        qlog_error "All recovery tiers exhausted — returning to monitor"
        _wd_start_holdoff
        state="monitor"
        current_tier=0
        failure_counter=0
        _recovery_marker_emitted=""
    fi
}

# Pure verdict for a finished cooldown (no I/O, no globals):
#   wd_cooldown_verdict <reason> <ping_ok 0|1> <reachable> <q_state 0|1|2> <stale_retries>
#   reason         "quality" or anything else (= reachability)
#   ping_ok        1 when read_ping returned fresh data this pass
#   reachable      true | false | null (only read when ping_ok = 1)
#   q_state        0 quality good, 1 breached, 2 no data (only read for "quality")
#   stale_retries  extensions already spent (cap 3)
# Prints success | extend | fail. "no data" (stale ping or too few samples) is
# extended up to 3 times, then counts as a failed recovery.
wd_cooldown_verdict() {
    local retries
    retries="$5"
    case "$retries" in ''|*[!0-9]*) retries=3 ;; esac
    if [ "$2" != "1" ]; then
        if [ "$retries" -lt 3 ]; then printf 'extend'; else printf 'fail'; fi
        return 0
    fi
    if [ "$1" = "quality" ]; then
        case "$4" in
            0) printf 'success' ;;
            1) printf 'fail' ;;
            *) if [ "$retries" -lt 3 ]; then printf 'extend'; else printf 'fail'; fi ;;
        esac
        return 0
    fi
    if [ "$3" = "true" ]; then printf 'success'; else printf 'fail'; fi
    return 0
}

finish_cooldown() {
    rm -f "$RECOVERY_FLAG"

    # --- Primary recheck settle (blind auto-failback test) ---
    # We swapped back to primary and held the settle floor. Decide from a FRESH
    # health read whether primary is good (failback) or still bad (return to
    # backup). Must run BEFORE the revert/reason-aware arms.
    if [ "$primary_recheck_active" = "true" ]; then
        wd_sim_finish_recheck
        return
    fi

    # --- Post-revert SIM settle ---
    # A user revert reuses the cooldown state purely as a settle timer. There is
    # no tier action to validate and nothing to escalate: just return to monitor
    # once the floor elapses. Bypass the reason-aware success/escalation logic.
    if [ "$revert_settle_active" = "true" ]; then
        revert_settle_active="false"
        qlog_info "Post-revert SIM settle complete — resuming monitoring"
        wd_resume_mark
        state="monitor"
        current_tier=0
        failure_counter=0
        cooldown_stale_retries=0
        quality_breach_counter=0
        _recovery_marker_emitted=""
        return
    fi

    # --- Reason-aware success criteria ---
    # A quality-triggered recovery cannot use reachability as the success
    # signal: a degraded-but-reachable link reports reachable the whole time,
    # so it would ALWAYS look "restored". Judge success from a FRESH quality
    # read against the configured ceilings instead.
    if [ "$recovery_reason" = "quality" ]; then
        # Fresh ping data is the freshness gate for the quality window; the
        # window figures then come from the ping history (read_quality).
        local pok=0
        local qs=2
        if read_ping; then
            pok=1
            # The cooldown's fresh read refreshes failure_secs / offline_secs too.
            wd_outage_update
            if read_quality; then
                if quality_breached; then
                    qs=1
                else
                    qs=0
                fi
            fi
        fi

        case "$(wd_cooldown_verdict quality "$pok" "$ping_reachable" "$qs" "$cooldown_stale_retries")" in
            extend)
                cooldown_stale_retries=$((cooldown_stale_retries + 1))
                qlog_warn "COOLDOWN(quality): quality data not ready (retry $cooldown_stale_retries/3) — extending by ${CFG_CHECK_INTERVAL}s"
                cooldown_remaining="$CFG_CHECK_INTERVAL"
                touch "$RECOVERY_FLAG"   # keep events suppressed during extension
                return
                ;;
            success)
                cooldown_stale_retries=0
                qlog_info "COOLDOWN(quality) complete: quality RESTORED after Tier $current_tier"
                append_event "watchcat_recovery" "Watchcat: recovery succeeded (Tier $current_tier) — connection quality restored" "info" "wd_succeeded"
                # A quality-triggered Tier-3 swap finalizes exactly like reachability —
                # otherwise the modem strands on backup with no failover state / revert
                # path. No-op for non-Tier-3 quality recoveries.
                finalize_sim_failover
                state="monitor"
                current_tier=0
                failure_counter=0
                quality_breach_counter=0
                wd_holdoff_clear quality
                _recovery_marker_emitted=""
                return
                ;;
            *)
                cooldown_stale_retries=0
                if [ "$qs" -eq 2 ]; then
                    qlog_error "COOLDOWN(quality): quality data still not ready after 3 retries — treating as recovery failure"
                else
                    qlog_warn "COOLDOWN(quality) complete: quality STILL degraded after Tier $current_tier"
                fi
                _cooldown_handle_failure
                return
                ;;
        esac
    fi

    # --- Reachability path (recovery_reason="outage") ---
    # Try to read fresh ping data
    local rok=0
    if read_ping; then
        rok=1
        # The cooldown's fresh read refreshes failure_secs / offline_secs too.
        wd_outage_update
    fi

    case "$(wd_cooldown_verdict outage "$rok" "$ping_reachable" 2 "$cooldown_stale_retries")" in
        extend)
            cooldown_stale_retries=$((cooldown_stale_retries + 1))
            qlog_warn "COOLDOWN: ping data stale (retry $cooldown_stale_retries/3) — extending by ${CFG_CHECK_INTERVAL}s"
            cooldown_remaining="$CFG_CHECK_INTERVAL"
            touch "$RECOVERY_FLAG"   # keep events suppressed during extension
            return
            ;;
        success)
            cooldown_stale_retries=0
            qlog_info "COOLDOWN complete: connectivity RESTORED after Tier $current_tier"
            append_event "watchcat_recovery" "Watchcat: recovery succeeded (Tier $current_tier) — internet connectivity restored" "info" "wd_succeeded"

            # If this was Tier 3 SIM failover, finalize the failover state (no-op
            # otherwise). Shared with the quality success arm.
            finalize_sim_failover

            # Reset — connectivity recovered
            state="monitor"
            current_tier=0
            failure_counter=0
            quality_breach_counter=0
            wd_holdoff_clear outage
            _recovery_marker_emitted=""
            return
            ;;
        *)
            cooldown_stale_retries=0
            if [ "$rok" -eq 0 ]; then
                qlog_error "COOLDOWN: ping data still stale after 3 retries — treating as recovery failure"
            else
                qlog_warn "COOLDOWN complete: connectivity NOT restored after Tier $current_tier"
            fi
            _cooldown_handle_failure
            return
            ;;
    esac
}

WD_TIERS_LOADED=1
