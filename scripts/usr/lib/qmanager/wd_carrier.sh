#!/bin/sh
# =============================================================================
# wd_carrier.sh - qmanager_watchcat: the "stuck on one carrier" trigger
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: carrier_single_since, carrier_cc, carrier_armed, carrier_trigger_min
# Functions: wd_carrier_reset, wd_carrier_reload, _wd_carrier_read,
#            evaluate_carrier, wd_carrier_finish
#
# Opt-in (carrier_enabled, Amendment 3 A3.3). The carrier count comes from the
# platform adapter (plat_cc_count: PLAT_CC, empty = unknown) and is read only
# while the feature is on. evaluate_carrier starts the recovery ladder like
# evaluate_quality (wd_ladder_pick / do_recovery from wd_tiers.sh, start gate
# and SSR hold from wd_detect.sh), so it writes state, recovery_reason,
# current_tier and tiers_tried, which other libs own; wd_carrier_finish is the
# carrier arm of finish_cooldown. Function definitions and global initialisers
# only. The last line sets WD_CARRIER_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
# Mono second of the first fresh single-carrier read of the current run; 0 = no
# run. An unknown read keeps it, a read of 2 or more resets it, and the ladder
# starts once mono - since >= carrier_after_min minutes. The state file reports
# mono - since as carrier_single_secs.
carrier_single_since=0
carrier_cc=""                   # last carrier count read; "" = unknown or not read
# 1 once this start (or settings reload) has seen 2 or more carriers: a modem
# that never aggregates is never "stuck" on one carrier.
carrier_armed=0
carrier_trigger_min=0           # minutes of the run that started the open ladder (event text)

# LOCKED and radio_off entry: the run cannot continue across them.
wd_carrier_reset() {
    carrier_single_since=0
}

# Settings reload: the trigger waits for 2 or more carriers again. The carrier
# pause and its growth are reset by wd_holdoff_reload (wd_tiers.sh).
wd_carrier_reload() {
    if [ "$CFG_CARRIER_ENABLED" = "1" ] || [ "$carrier_armed" = "1" ]; then
        qlog_info "Settings reload: the carrier trigger waits for 2 or more carriers again"
    fi
    carrier_armed=0
    carrier_single_since=0
}

# carrier_cc = the adapter's count (1-99), or "" when unknown.
_wd_carrier_read() {
    carrier_cc=""
    command -v plat_cc_count >/dev/null 2>&1 || return 0
    plat_cc_count
    case "$PLAT_CC" in ''|*[!0-9]*|???*) return 0 ;; esac
    _wd_dec "$PLAT_CC" 0
    [ "$_wdd" -ge 1 ] || return 0
    carrier_cc="$_wdd"
    return 0
}

# Carrier trigger (Amendment 3 A3.3). Runs every pass that reaches the trigger
# block; counts only in monitor with a fresh reachable=true read and
# streak_fail=0, any other pass ends the run in progress (an outage, an SSR hold,
# a recovery of another reason). LOCKED and radio_off end it at entry. A read of
# 2 or more carriers arms the trigger, resets the run, ends a carrier pause and a
# kept carrier tier; an unknown read keeps the run; a single carrier counts
# only once armed and never while a tower lock is set. Once the run has lasted
# carrier_after_min the start gate decides; the carrier ladder is Tier 1-2 only
# (find_next_tier). Returns 0 if it acted this pass, 1 otherwise.
evaluate_carrier() {
    local now
    local held
    local gate
    if [ "$CFG_CARRIER_ENABLED" != "1" ]; then
        carrier_single_since=0
        carrier_cc=""
        carrier_armed=0
        case "$state" in
            monitor|suspect)
                if [ "$current_tier" -gt 0 ] && [ "$recovery_reason" = "carrier" ]; then
                    qlog_info "CARRIER: disabled, the kept Tier $current_tier is cleared"
                    current_tier=0
                    tiers_tried=""
                fi
                ;;
        esac
        return 1
    fi
    if [ "$state" != "monitor" ] || [ "$ping_reachable" != "true" ] || [ "$ping_streak_fail" != "0" ]; then
        carrier_single_since=0
        return 1
    fi
    _wd_carrier_read
    case "$carrier_cc" in
        '')
            # unknown: the run is kept (never starts, never resets)
            return 1
            ;;
        1) ;;
        *)
            if [ "$carrier_armed" != "1" ]; then
                carrier_armed=1
                qlog_info "CARRIER: $carrier_cc carriers seen, the single-carrier trigger is armed"
            fi
            carrier_single_since=0
            if [ "$wd_hold_c_until" -gt 0 ]; then
                qlog_info "CARRIER: $carrier_cc carriers again, ending the carrier pause"
                wd_holdoff_clear carrier
            fi
            if [ "$current_tier" -gt 0 ] && [ "$recovery_reason" = "carrier" ]; then
                qlog_info "CARRIER: $carrier_cc carriers again, the kept Tier $current_tier is cleared"
                current_tier=0
                tiers_tried=""
            fi
            return 1
            ;;
    esac
    [ "$carrier_armed" = "1" ] || return 1
    # A tower lock pins the cell on purpose: one carrier is expected there.
    if plat_tower_locked; then
        carrier_single_since=0
        return 1
    fi

    now=$(mono_now)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac
    case "$carrier_single_since" in ''|*[!0-9]*) carrier_single_since=0 ;; esac
    if [ "$carrier_single_since" -le 0 ] || [ "$carrier_single_since" -gt "$now" ]; then
        carrier_single_since="$now"
        # mono 0 cannot mark a run (0 = none): count from second 1.
        [ "$carrier_single_since" -gt 0 ] || carrier_single_since=1
        qlog_warn "CARRIER: one component carrier, recovery after ${CFG_CARRIER_AFTER_MIN} min"
    fi
    held=$((now - carrier_single_since))
    if [ "$held" -lt $((CFG_CARRIER_AFTER_MIN * 60)) ]; then
        qlog_debug "CARRIER: one carrier for ${held}s/$((CFG_CARRIER_AFTER_MIN * 60))s"
        return 1
    fi

    wd_radio_reconcile carrier
    gate=$(wd_start_gate carrier)
    case "$gate" in
        none|holdoff)
            # No Tier 1/2 to run, or paused after an exhausted carrier ladder:
            # no recovery, no event. The run keeps counting, so one that
            # outlasts the pause starts the ladder when it ends.
            qlog_debug "CARRIER: recovery not started ($gate)"
            return 1
            ;;
        radio_off)
            wd_enter_radio_off
            return 0
            ;;
    esac
    carrier_trigger_min=$((held / 60))
    carrier_single_since=0
    if ! wd_ladder_pick carrier; then
        _wd_ladder_exhausted "CARRIER: no carrier tier left after the kept Tier $current_tier"
        return 0
    fi
    qlog_warn "CARRIER → RECOVERY: one carrier for ${held}s"

    # SSR-aware hold, as for quality: the main loop's write_state + sleep follow.
    if ssr_hold_gate; then
        state="ssr_hold"
        return 0
    fi

    state="recovery"
    do_recovery
    return 0
}

# The carrier arm of finish_cooldown. Success = a fresh read of 2 or more
# carriers on a reachable link. One carrier fails (escalate, or the pause after
# Tier 2). An unknown count or reachable=null extends (max 3, then
# inconclusive, tier kept). reachable=false hands the link to the outage
# trigger: the carrier episode ends without a verdict and the outage path
# starts its own ladder on its own act-after rule.
wd_carrier_finish() {
    local pok=0
    local ccs=2
    if read_ping; then
        pok=1
        wd_outage_update
        if [ "$ping_reachable" = "true" ] && [ "$CFG_CARRIER_ENABLED" = "1" ]; then
            _wd_carrier_read
            case "$carrier_cc" in
                '') ccs=2 ;;
                1) ccs=1 ;;
                *) ccs=0 ;;
            esac
        fi
    fi

    case "$(wd_cooldown_verdict carrier "$pok" "$ping_reachable" "$ccs" "$cooldown_stale_retries")" in
        extend)
            cooldown_stale_retries=$((cooldown_stale_retries + 1))
            qlog_warn "COOLDOWN(carrier): carrier count not known (retry $cooldown_stale_retries/3) — extending by ${CFG_CHECK_INTERVAL}s"
            wd_step_wait_extend
            touch "$RECOVERY_FLAG"   # keep events suppressed during extension
            ;;
        success)
            wd_step_wait_clear
            qlog_info "COOLDOWN(carrier) complete: $carrier_cc carriers after Tier $current_tier"
            append_event "watchcat_recovery" "Watchcat: recovery succeeded (Tier $current_tier) — carrier aggregation restored" "info" "wd_succeeded"
            _wd_record_success
            state="monitor"
            current_tier=0
            tiers_tried=""
            failure_counter=0
            quality_breach_since=0
            carrier_single_since=0
            wd_holdoff_clear carrier
            _recovery_marker_emitted=""
            ;;
        inconclusive)
            wd_step_wait_clear
            qlog_error "COOLDOWN(carrier): no carrier verdict after 3 retries"
            _cooldown_inconclusive
            ;;
        handover)
            wd_step_wait_clear
            qlog_warn "COOLDOWN(carrier): link down after Tier $current_tier, the outage trigger takes over"
            state="monitor"
            current_tier=0
            tiers_tried=""
            carrier_single_since=0
            _recovery_marker_emitted=""
            ;;
        *)
            wd_step_wait_clear
            qlog_warn "COOLDOWN(carrier) complete: still one carrier after Tier $current_tier"
            _cooldown_handle_failure
            ;;
    esac
    return 0
}

WD_CARRIER_LOADED=1
