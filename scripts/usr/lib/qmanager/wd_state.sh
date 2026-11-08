#!/bin/sh
# =============================================================================
# wd_state.sh - qmanager_watchcat: state file writer and maintenance-lock check
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: state, prev_state, failure_counter, wd_radio_down, _wd_sleep_pid,
#       _wd_ssf_seen, _wd_ssf_stale, WD_SIM_SWITCH_MAX_LOCK
# Functions: write_state, write_state_busy, check_locked, _wd_pid_live,
#            _wd_manual_switch, wd_sleep, wd_mark_radio_down, wd_mark_radio_up,
#            wd_cfun_now
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
_wd_ssf_seen=0            # mono_now when another holder's SIM-switch flag was first seen; 0 = not seen
_wd_ssf_stale=0           # 1 once that flag outlived WD_SIM_SWITCH_MAX_LOCK (logged once)
WD_SIM_SWITCH_MAX_LOCK=120  # a manual switch flag locks for at most this long (s, mono clock)

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
    local v_fsecs
    local v_offline
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
    local v_qlevel
    local v_hold_out
    local v_hold_q
    local v_clevel
    local v_hold_c
    local v_csince
    local v_css
    local v_cc
    local v_state
    local v_fb_fail
    local v_fb_next
    local v_pr_active
    local v_ping_stale
    local v_rb_limit
    local v_rb_until
    local v_rb_spent
    local v_qsince
    local v_qbs
    local v_swu
    local v_tried
    local v_ls_time
    local v_ls_tier
    local v_ls_took
    local t
    local json
    stale="$1"
    ts=$(date +%s)
    _wd_num "$(mono_now)" 0;               v_mono="$_wdn"
    _wd_num "$CFG_ENABLED" 0;              v_enabled="$_wdn"
    _wd_num "$current_tier" 0;             v_tier="$_wdn"
    _wd_num "$failure_counter" 0;          v_failures="$_wdn"
    _wd_num "$wd_outage_age" 0;            v_fsecs="$_wdn"
    _wd_num "$wd_offline_secs" 0;          v_offline="$_wdn"
    _wd_num "$last_recovery_time" null;    v_last_time="$_wdn"
    _wd_num "$last_recovery_tier" null;    v_last_tier="$_wdn"
    _wd_num "$total_recoveries" 0;         v_total="$_wdn"
    _wd_num "$last_success_time" null;     v_ls_time="$_wdn"
    _wd_num "$last_success_tier" null;     v_ls_tier="$_wdn"
    _wd_num "$last_success_took_s" null;   v_ls_took="$_wdn"
    _wd_num "$cooldown_remaining" 0;       v_cooldown="$_wdn"
    _wd_num "$step_wait_until" 0;          v_swu="$_wdn"
    # tiers_tried ("1 2") as a JSON int array; anything but a tier digit is dropped.
    v_tried=""
    for t in $tiers_tried; do
        case "$t" in
            [1-4]) v_tried="${v_tried:+$v_tried,}$t" ;;
        esac
    done
    _wd_num "$original_sim_slot" null;     v_orig="$_wdn"
    _wd_num "$current_sim_slot" null;      v_curr="$_wdn"
    _wd_num "$reboots_this_hour" 0;        v_reboots="$_wdn"
    _wd_num "$CFG_MAX_REBOOTS_PER_HOUR" 3; v_rb_limit="$_wdn"
    _wd_num "$reboot_rest_until" null;   v_rb_until="$_wdn"
    case "$reboot_budget_exhausted" in
        true) v_rb_spent=true ;;
        *) v_rb_spent=false ;;
    esac
    _wd_num "$last_ssr_detected" null;     v_ssr_det="$_wdn"
    _wd_num "$ssr_hold_started" 0;         v_ssr_started="$_wdn"
    _wd_num "$CFG_SSR_GRACE" 45;           v_ssr_grace="$_wdn"
    _wd_num "$holdoff_until" 0;            v_holdoff="$_wdn"
    _wd_num "$wd_hold_q_level" 0;          v_qlevel="$_wdn"
    _wd_num "$wd_hold_out_until" 0;        v_hold_out="$_wdn"
    _wd_num "$wd_hold_q_until" 0;          v_hold_q="$_wdn"
    _wd_num "$wd_hold_c_level" 0;          v_clevel="$_wdn"
    _wd_num "$wd_hold_c_until" 0;          v_hold_c="$_wdn"
    # carrier_single_secs: how long the current single-carrier run has lasted;
    # carrier_cc: the last carrier count read (null = unknown or not read).
    _wd_num "$carrier_single_since" 0;     v_csince="$_wdn"
    v_css=0
    if [ "$v_csince" -gt 0 ] && [ "$v_mono" -ge "$v_csince" ]; then
        v_css=$((v_mono - v_csince))
    fi
    _wd_num "$carrier_cc" null;            v_cc="$_wdn"
    # quality_breach_secs: how long the current quality breach has lasted.
    _wd_num "$quality_breach_since" 0;     v_qsince="$_wdn"
    v_qbs=0
    if [ "$v_qsince" -gt 0 ] && [ "$v_mono" -ge "$v_qsince" ]; then
        v_qbs=$((v_mono - v_qsince))
    fi
    # State holdoff (spec section 5.5): idle (monitor) under any active pause, or
    # suspecting an outage that the outage pause blocks. Every other state wins.
    v_state="$state"
    case "$state" in
        monitor)
            if [ "$v_hold_out" -gt "$v_mono" ] || [ "$v_hold_q" -gt "$v_mono" ] || [ "$v_hold_c" -gt "$v_mono" ]; then
                v_state="holdoff"
            fi
            ;;
        suspect)
            [ "$v_hold_out" -gt "$v_mono" ] && v_state="holdoff"
            ;;
    esac
    _wd_num "$failback_failures" 0;        v_fb_fail="$_wdn"
    [ "$v_fb_fail" -gt "${WD_FAILBACK_MAX_FAILS:-3}" ] && v_fb_fail="${WD_FAILBACK_MAX_FAILS:-3}"
    wd_failback_next_at
    _wd_num "$WD_FB_NEXT_AT" null;         v_fb_next="$_wdn"
    case "$ssr_hold" in
        true) v_ssr_hold=true ;;
        *) v_ssr_hold=false ;;
    esac
    case "$wd_ping_stale" in
        true) v_ping_stale=true ;;
        *) v_ping_stale=false ;;
    esac
    case "$primary_recheck_active" in
        true) v_pr_active=true ;;
        *) v_pr_active=false ;;
    esac

    # Contract keys (docs/plans cq-watchdog-contracts section 3).
    # step_wait_until is null outside a cooldown.
    json=$(jq -n -c \
        --argjson ts "$ts" \
        --argjson mono "$v_mono" \
        --argjson stale_after "$stale" \
        --argjson enabled "$v_enabled" \
        --arg state "$v_state" \
        --argjson tier "$v_tier" \
        --argjson failures "$v_failures" \
        --argjson fsecs "$v_fsecs" \
        --argjson offline "$v_offline" \
        --argjson last_time "$v_last_time" \
        --argjson last_tier "$v_last_tier" \
        --argjson total "$v_total" \
        --argjson ls_time "$v_ls_time" \
        --argjson ls_tier "$v_ls_tier" \
        --arg ls_reason "$last_success_reason" \
        --argjson ls_took "$v_ls_took" \
        --argjson cooldown "$v_cooldown" \
        --argjson swu "$v_swu" \
        --argjson tried "[$v_tried]" \
        --arg sf_active "$sim_failover_active" \
        --argjson sf_orig "$v_orig" \
        --argjson sf_curr "$v_curr" \
        --argjson reboots "$v_reboots" \
        --argjson rb_limit "$v_rb_limit" \
        --argjson rb_spent "$v_rb_spent" \
        --arg rb_reason "$reboot_rest_reason" \
        --argjson rb_until "$v_rb_until" \
        --arg recovery_reason "$recovery_reason" \
        --argjson ssr_hold "$v_ssr_hold" \
        --argjson ssr_started "$v_ssr_started" \
        --argjson ssr_grace "$v_ssr_grace" \
        --argjson last_ssr_mono "$v_ssr_det" \
        --argjson holdoff_until "$v_holdoff" \
        --arg holdoff_reason "$holdoff_reason" \
        --argjson qlevel "$v_qlevel" \
        --argjson clevel "$v_clevel" \
        --argjson fb_fail "$v_fb_fail" \
        --argjson fb_next "$v_fb_next" \
        --argjson pr_active "$v_pr_active" \
        --argjson qbs "$v_qbs" \
        --argjson css "$v_css" \
        --argjson cc "$v_cc" \
        --argjson ping_stale "$v_ping_stale" \
        '{
            timestamp: $ts, enabled: ($enabled == 1),
            state: $state, current_tier: $tier,
            tiers_tried: $tried,
            recovery_reason: (if ($state == "recovery" or $state == "cooldown" or $state == "ssr_hold") then $recovery_reason else null end),
            last_recovery_time: $last_time,
            last_recovery_tier: $last_tier,
            last_recovery_reason: $recovery_reason,
            total_recoveries: $total,
            last_success_time: $ls_time,
            last_success_tier: $ls_tier,
            last_success_reason: (if ($ls_reason == "outage" or $ls_reason == "quality" or $ls_reason == "carrier") then $ls_reason else null end),
            last_success_took_s: $ls_took,
            failure_count: $failures,
            failure_secs: $fsecs,
            offline_secs: $offline,
            cooldown_remaining: $cooldown,
            step_wait_until: (if ($state == "cooldown" and $swu > 0) then $swu else null end),
            holdoff_until: (if $holdoff_until > $mono then $holdoff_until else null end),
            holdoff_reason: (if $holdoff_until > $mono and $holdoff_reason != "" then $holdoff_reason else null end),
            holdoff_quality_level: $qlevel,
            holdoff_carrier_level: $clevel,
            reboots_this_hour: $reboots,
            reboot_limit: $rb_limit,
            reboot_budget_exhausted: $rb_spent,
            reboot_rest_reason: (if $rb_reason == "" then null else $rb_reason end),
            reboot_rest_until: (if $rb_reason == "" then null else $rb_until end),
            ssr_hold: $ssr_hold,
            ssr_hold_until: (if $ssr_hold then ($ssr_started + $ssr_grace) else null end),
            last_ssr_mono: $last_ssr_mono,
            quality_breach_secs: $qbs,
            carrier_single_secs: $css,
            carrier_cc: $cc,
            failback_active: $pr_active,
            failback_failures: $fb_fail,
            failback_next_at: $fb_next,
            sim_failover_active: ($sf_active == "true"),
            original_sim_slot: $sf_orig,
            current_sim_slot: $sf_curr,
            ping_stale: $ping_stale,
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

    # Profile apply or config restore in progress
    _wd_pid_live "$PROFILE_APPLY_PID" && return 0
    _wd_pid_live "$PF_RESTORE_PID" && return 0

    # Manual SIM switch in progress (not this daemon's own Tier 3 swap)
    _wd_manual_switch && return 0

    return 1
}

# _wd_pid_live FILE: rc 0 when FILE holds the PID of a live process.
_wd_pid_live() {
    local pid
    [ -n "$1" ] && [ -f "$1" ] || return 1
    pid=$(cat "$1" 2>/dev/null)
    # 0 (or 00...) would make kill -0 test the whole process group: never live.
    case "$pid" in ''|*[!0-9]*|0|00*) return 1 ;; esac
    kill -0 "$pid" 2>/dev/null
}

# _wd_manual_switch: rc 0 while another process holds the SIM-switch flag.
# wd_swap_slot raises the same flag (WD_SWAP_FLAG_OWNED=1) and must not lock
# the daemon out. The holder removes the flag on exit; a holder killed outright
# leaves it behind, so the flag counts for at most WD_SIM_SWITCH_MAX_LOCK
# seconds from first sight on the mono clock (the file's mtime is wall time,
# which steps on NITZ). Unreadable clock: not counted (pre-union behaviour).
_wd_manual_switch() {
    local now
    if [ "$WD_SWAP_FLAG_OWNED" = "1" ] || ! plat_manual_sim_switch; then
        _wd_ssf_seen=0
        _wd_ssf_stale=0
        return 1
    fi
    _wd_num "$(mono_now)" 0
    now="$_wdn"
    [ "$now" = "0" ] && return 1
    [ "$_wd_ssf_seen" = "0" ] && _wd_ssf_seen="$now"
    if [ $((now - _wd_ssf_seen)) -lt "$WD_SIM_SWITCH_MAX_LOCK" ]; then
        return 0
    fi
    if [ "$_wd_ssf_stale" = "0" ]; then
        _wd_ssf_stale=1
        qlog_warn "SIM-switch flag present for ${WD_SIM_SWITCH_MAX_LOCK}s, treating it as stale"
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
