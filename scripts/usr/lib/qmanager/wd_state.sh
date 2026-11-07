#!/bin/sh
# =============================================================================
# wd_state.sh - qmanager_watchcat: state file writer and maintenance-lock check
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: state, prev_state, failure_counter, wd_radio_down, _wd_sleep_pid
# Functions: write_state, write_state_busy, check_locked, wd_sleep,
#            wd_mark_radio_down, wd_mark_radio_up, wd_cfun_now
#
# write_state serialises globals owned by every lib into STATE_FILE (the poller
# reads it); it only reads them. Function definitions and global initialisers
# only. The last line sets WD_STATE_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
state="monitor"
prev_state=""
failure_counter=0
wd_radio_down=0           # 1 between a CFUN=0 and its confirmed CFUN=1
_wd_sleep_pid=""          # backgrounded sleep of the current wd_sleep

# =============================================================================
# STATE FILE WRITER
# =============================================================================

# _wd_num VALUE DEFAULT: sets _wdn to VALUE when it is a plain non-negative
# integer without a leading zero (valid JSON), else to DEFAULT. Sets a global
# instead of printing so write_state does not fork per field.
_wd_num() {
    case "$1" in
        ''|*[!0-9]*|0[0-9]*) _wdn="$2" ;;
        *) _wdn="$1" ;;
    esac
}

# Serialises the globals into STATE_FILE. $1 is stale_after: how long (s) the
# poller may go without a fresh write before it reports the daemon as not
# reporting. Every numeric/boolean input is coerced first, so one corrupted
# global cannot make jq fail and leave the state file empty or stale. The JSON
# is built into a variable and written atomically only when non-empty.
_wd_write_state_file() {
    local stale
    local ts
    local v_mono
    local v_enabled
    local v_tier
    local v_failures
    local v_last_time
    local v_last_tier
    local v_total
    local v_cooldown
    local v_orig
    local v_curr
    local v_reboots
    local v_ssr_hold
    local v_ssr_det
    local v_ssr_started
    local v_ssr_grace
    local v_holdoff
    local v_pr_enabled
    local v_pr_interval
    local v_pr_last
    local v_pr_active
    local json
    stale="$1"
    ts=$(date +%s)
    _wd_num "$(mono_now)" 0;               v_mono="$_wdn"
    _wd_num "$CFG_ENABLED" 0;              v_enabled="$_wdn"
    _wd_num "$current_tier" 0;             v_tier="$_wdn"
    _wd_num "$failure_counter" 0;          v_failures="$_wdn"
    _wd_num "$last_recovery_time" null;    v_last_time="$_wdn"
    _wd_num "$last_recovery_tier" null;    v_last_tier="$_wdn"
    _wd_num "$total_recoveries" 0;         v_total="$_wdn"
    _wd_num "$cooldown_remaining" 0;       v_cooldown="$_wdn"
    _wd_num "$original_sim_slot" null;     v_orig="$_wdn"
    _wd_num "$current_sim_slot" null;      v_curr="$_wdn"
    _wd_num "$reboots_this_hour" 0;        v_reboots="$_wdn"
    _wd_num "$last_ssr_detected" null;     v_ssr_det="$_wdn"
    _wd_num "$ssr_hold_started" 0;         v_ssr_started="$_wdn"
    _wd_num "$CFG_SSR_GRACE" 45;           v_ssr_grace="$_wdn"
    _wd_num "$holdoff_until" 0;            v_holdoff="$_wdn"
    _wd_num "$CFG_PRIMARY_RECHECK_ENABLED" 0;  v_pr_enabled="$_wdn"
    _wd_num "$CFG_PRIMARY_RECHECK_INTERVAL" 30; v_pr_interval="$_wdn"
    _wd_num "$last_recheck_time" 0;        v_pr_last="$_wdn"
    case "$ssr_hold" in
        true) v_ssr_hold=true ;;
        *) v_ssr_hold=false ;;
    esac
    case "$primary_recheck_active" in
        true) v_pr_active=true ;;
        *) v_pr_active=false ;;
    esac

    # Contract keys (docs/plans cq-watchdog-contracts section 3). Keys whose rule
    # has not landed yet carry their idle value: step_wait_until, failure_secs,
    # reboot_budget_exhausted, reboot_rest_reason, quality_breach_secs,
    # failback_failures, ping_stale.
    json=$(jq -n -c \
        --argjson ts "$ts" \
        --argjson mono "$v_mono" \
        --argjson stale_after "$stale" \
        --argjson enabled "$v_enabled" \
        --arg state "$state" \
        --argjson tier "$v_tier" \
        --argjson failures "$v_failures" \
        --argjson last_time "$v_last_time" \
        --argjson last_tier "$v_last_tier" \
        --argjson total "$v_total" \
        --argjson cooldown "$v_cooldown" \
        --arg sf_active "$sim_failover_active" \
        --argjson sf_orig "$v_orig" \
        --argjson sf_curr "$v_curr" \
        --argjson reboots "$v_reboots" \
        --arg recovery_reason "$recovery_reason" \
        --argjson ssr_hold "$v_ssr_hold" \
        --argjson ssr_started "$v_ssr_started" \
        --argjson ssr_grace "$v_ssr_grace" \
        --argjson last_ssr_mono "$v_ssr_det" \
        --argjson holdoff_until "$v_holdoff" \
        --arg holdoff_reason "$holdoff_reason" \
        --argjson pr_enabled "$v_pr_enabled" \
        --argjson pr_interval "$v_pr_interval" \
        --argjson pr_last "$v_pr_last" \
        --argjson pr_active "$v_pr_active" \
        '{
            timestamp: $ts, enabled: ($enabled == 1),
            state: $state, current_tier: $tier,
            recovery_reason: (if ($tier == 0 and ($state == "monitor" or $state == "locked" or $state == "radio_off" or $state == "disabled")) then null else $recovery_reason end),
            last_recovery_time: $last_time,
            last_recovery_tier: $last_tier,
            last_recovery_reason: $recovery_reason,
            total_recoveries: $total,
            failure_count: $failures,
            failure_secs: 0,
            cooldown_remaining: $cooldown,
            step_wait_until: null,
            holdoff_until: (if $holdoff_until > $mono then $holdoff_until else null end),
            holdoff_reason: (if $holdoff_until > $mono and $holdoff_reason != "" then $holdoff_reason else null end),
            reboots_this_hour: $reboots,
            reboot_budget_exhausted: false,
            reboot_rest_reason: null,
            ssr_hold: $ssr_hold,
            ssr_hold_until: (if $ssr_hold then ($ssr_started + $ssr_grace) else null end),
            last_ssr_mono: $last_ssr_mono,
            quality_breach_secs: 0,
            failback_active: $pr_active,
            failback_failures: 0,
            failback_next_at: (if ($pr_enabled == 1 and $sf_active == "true") then ($pr_last + $pr_interval * 60) else null end),
            sim_failover_active: ($sf_active == "true"),
            original_sim_slot: $sf_orig,
            current_sim_slot: $sf_curr,
            ping_stale: false,
            mono: $mono,
            stale_after: $stale_after
        }' 2>/dev/null)
    [ -n "$json" ] || return 1

    if command -v qm_atomic_write >/dev/null 2>&1; then
        printf '%s\n' "$json" | qm_atomic_write "$STATE_FILE"
    else
        printf '%s\n' "$json" > "$STATE_TMP" && mv "$STATE_TMP" "$STATE_FILE"
    fi
}

# Normal heartbeat: the poller treats the daemon as not reporting after
# 3 check intervals + 60 s without a fresh write.
write_state() {
    local iv
    _wd_num "$CFG_CHECK_INTERVAL" 10
    iv="$_wdn"
    _wd_write_state_file $((3 * iv + 60))
}

# Heartbeat for a long blocking section (a Tier 3 swap can take minutes with no
# loop pass): a generous window so a recovery in progress is not reported dead.
write_state_busy() {
    _wd_write_state_file 600
}

# =============================================================================
# HELPERS
# =============================================================================

# Check if maintenance mode is active (any lock condition)
check_locked() {
    # Explicit maintenance lock
    [ -f "$LOCK_FILE" ] && return 0

    # Long-running AT command (cell scan, firmware update)
    plat_long_running && return 0

    # Profile apply in progress
    if [ -f "$PROFILE_APPLY_PID" ]; then
        local pid
        pid=$(cat "$PROFILE_APPLY_PID" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

# Interruptible sleep. A plain `sleep N` in the foreground delays the TERM trap
# until it returns, so procd's stop would wait out the full interval. Running it
# in the background and `wait`ing lets TERM interrupt the wait at once; the exit
# cleanup kills the orphaned sleep via $_wd_sleep_pid.
wd_sleep() {
    sleep "$1" &
    _wd_sleep_pid=$!
    wait "$_wd_sleep_pid"
    _wd_sleep_pid=""
}

# Radio-off marker. Set by every code path that sends AT+CFUN=0 and cleared once
# AT+CFUN=1 is confirmed, so the daemon's exit cleanup can restore the radio if
# a TERM lands between the two commands.
wd_mark_radio_down() { wd_radio_down=1; }
wd_mark_radio_up() { wd_radio_down=0; }

# Prints the current functionality level (0, 1 or 4) from AT+CFUN?, or nothing
# when the reply cannot be read. Callers treat empty as "unknown", never as off.
wd_cfun_now() {
    local out
    local n
    out=$(qcmd 'AT+CFUN?' 2>/dev/null)
    n=$(printf '%s' "$out" | sed -n 's/.*+CFUN: *\([0-9]\).*/\1/p' | head -n 1)
    case "$n" in
        0|1|4) printf '%s' "$n" ;;
    esac
    return 0
}

WD_STATE_LOADED=1
