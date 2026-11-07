#!/bin/sh
# =============================================================================
# wd_ledger.sh - qmanager_watchcat: reboot ledger (crash.log) accounting
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: reboots_this_hour, _rb_next, reboot_budget_exhausted,
#       reboot_rest_reason, reboot_rest_until, _wd_rb_prev, _wd_rb_prev_oldest,
#       _wd_rb_newest, _wd_rb_free_at, _wd_guard_at, _wd_link_up, _wd_budget_ev
# Functions: count_recent_reboots, wd_reboot_rest_eval, _wd_rest_derive,
#            wd_link_up_seen, _wd_epoch_file, _wd_persist,
#            wd_budget_spent_event, wd_ledger_tick, wd_ledger_recent_json
#
# Reads CRASH_LOG (defined by the daemon). Function definitions and global
# initialisers only, so a CGI may source it for wd_ledger_recent_json. The last
# line sets WD_LEDGER_LOADED. The one top-level command sources the platform
# adapter (idempotent) so a CGI gets PF_CRASH_LOG without the daemon.
#
# Reboot budget (spec section 5.6): Tier 4 rests, it never disables the
# watchdog. "hourly": tier4_escalation rows in the rolling hour >= the limit.
# "long_outage" (long-run guard): the budget was also spent in the previous
# hour with no link-up since; Tier 4 then rests until the link has been up once
# or 24 h have passed. Two persistent files in PF_STATE_DIR, written only on
# their edges (flash): wd_reboot_guard (<engage epoch>) and wd_link_up
# (<epoch> of the first reachable read after a watchdog reboot).
# =============================================================================

[ -f /usr/lib/qmanager/qm_platform_cqwd.sh ] && . /usr/lib/qmanager/qm_platform_cqwd.sh

# --- State Variables (owned here) --------------------------------------------
reboots_this_hour=0
_rb_next=0                # mono_now at/after which wd_ledger_tick recounts
reboot_budget_exhausted="false"   # rows this hour >= CFG_MAX_REBOOTS_PER_HOUR
reboot_rest_reason=""     # "" (Tier 4 may run) | hourly | long_outage
reboot_rest_until=""      # mono when Tier 4 may run again, "" = null
_wd_rb_prev=0             # tier4_escalation rows in the previous hour
_wd_rb_prev_oldest=0      # epoch of the oldest of those rows
_wd_rb_newest=0           # epoch of the newest tier4_escalation row
_wd_rb_free_at=0          # epoch at which the hourly count drops below the limit
_wd_guard_at=0            # long-run guard engage epoch, 0 = not engaged
_wd_link_up=0             # link-up stamp epoch, 0 = none
_wd_budget_ev=0           # 1 once the hourly wd_budget_spent fired this episode
WD_GUARD_SECS=86400
WD_REBOOT_GUARD_FILE="$PF_STATE_DIR/wd_reboot_guard"
WD_LINK_UP_FILE="$PF_STATE_DIR/wd_link_up"

# 0 iff the wall clock is plausible. Prefers schedule_guard.sh's _qm_clock_sane
# (sourced by the daemon); the fallback applies the same rule (year >= 2025).
_wd_clock_sane() {
    if command -v _qm_clock_sane >/dev/null 2>&1; then
        _qm_clock_sane
        return
    fi
    local y
    y=$(date +%Y)
    case "$y" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$y" -ge 2025 ]
}

# Count WATCHDOG reboots in the last hour from crash.log.
# crash.log is now a shared reboot ledger: watchcat writes tier4_escalation rows,
# and record_planned_reboot (qlog.sh) writes user/unplanned rows for the reboot-
# alert feature. The reboot budget + the dashboard's reboots_this_hour must
# keep their original meaning ("watchdog-caused reboots this hour"), so we count
# ONLY tier4_escalation rows here. Field layout: <epoch>|reboot|<reason>.
#
# The window is a rolling hour on the wall clock. The modem boots at 1970 until
# NITZ/ntp steps the clock, so with an insane clock the window cannot be
# evaluated: count every row older than 2025-01-01 (the clock-less boot rows).
# That over-counts, which is the safe direction for the Tier-4 cap; the first
# recount on a sane clock drops them again.
#
# Also sets, for the long-run guard (sane clock only, else 0): _wd_rb_prev and
# _wd_rb_prev_oldest (rows in the previous hour, (now-7200, now-3600): the
# boundary second already counts in this hour), _wd_rb_free_at (first epoch at
# which fewer than the limit count, once the limit is reached) and
# _wd_rb_newest (newest row, any clock).
count_recent_reboots() {
    local now
    local sane
    local out
    local max
    reboots_this_hour=0
    _wd_rb_prev=0
    _wd_rb_prev_oldest=0
    _wd_rb_newest=0
    _wd_rb_free_at=0
    [ -f "$CRASH_LOG" ] || return 0
    now=$(date +%s)
    case "$now" in
        ''|*[!0-9]*) now=0 ;;
    esac
    if _wd_clock_sane; then
        sane=1
    else
        sane=0
    fi
    max="$CFG_MAX_REBOOTS_PER_HOUR"
    case "$max" in
        ''|*[!0-9]*) max=3 ;;
    esac
    # A row counted at epoch e stops counting at e + 3601 (the window is
    # e >= now - 3600). cur[] is sorted with an insertion sort (crash.log keeps
    # at most 20 rows; BusyBox awk has no asort).
    out=$(awk -v now="$now" -v sane="$sane" -v max="$max" -F'|' '
        $2 == "reboot" && $3 == "tier4_escalation" && $1 ~ /^[0-9]+$/ {
            e = $1 + 0
            if (e > newest) newest = e
            if (sane == 1) {
                if (e >= now - 3600) { n++; cur[n] = e }
                else if (e > now - 7200) {
                    p++
                    if (po == 0 || e < po) po = e
                }
            }
            else if (e < 1735689600) n++
        }
        END {
            free = 0
            if (sane == 1 && max > 0 && n >= max) {
                for (i = 2; i <= n; i++) {
                    v = cur[i]
                    j = i - 1
                    while (j >= 1 && cur[j] > v) { cur[j + 1] = cur[j]; j-- }
                    cur[j + 1] = v
                }
                free = cur[n - max + 1] + 3601
            }
            printf "%s %s %s %s %s\n", n + 0, p + 0, po + 0, newest + 0, free + 0
        }' "$CRASH_LOG" 2>/dev/null)
    # shellcheck disable=SC2086
    set -- $out
    case "$1" in ''|*[!0-9]*) ;; *) reboots_this_hour="$1" ;; esac
    case "$2" in ''|*[!0-9]*) ;; *) _wd_rb_prev="$2" ;; esac
    case "$3" in ''|*[!0-9]*) ;; *) _wd_rb_prev_oldest="$3" ;; esac
    case "$4" in ''|*[!0-9]*) ;; *) _wd_rb_newest="$4" ;; esac
    case "$5" in ''|*[!0-9]*) ;; *) _wd_rb_free_at="$5" ;; esac
    return 0
}

# _wd_epoch_file FILE: prints the epoch held in FILE, or 0 when it is absent
# or not a plain 1-10 digit epoch (garbage reads as absent).
_wd_epoch_file() {
    local v
    v=""
    [ -f "$1" ] && read -r v < "$1" 2>/dev/null
    case "$v" in
        ''|*[!0-9]*|0*) printf '0' ;;
        *)
            if [ "${#v}" -gt 10 ]; then printf '0'; else printf '%s' "$v"; fi
            ;;
    esac
}

# _wd_persist FILE VALUE: durable atomic write (flash). Edge writes only.
_wd_persist() {
    if command -v qm_durable_write >/dev/null 2>&1; then
        printf '%s\n' "$2" | qm_durable_write "$1"
    else
        printf '%s\n' "$2" > "$1.tmp" && mv -f "$1.tmp" "$1"
    fi
}

# Recount the budget and apply the long-run guard. Sets reboot_budget_exhausted,
# reboot_rest_reason and reboot_rest_until. With an insane clock the guard is
# neither engaged nor released (an engaged guard file keeps Tier 4 resting) and
# no deadline can be given (reboot_rest_until null). Deadlines are converted
# from epoch to mono with the current offset (now_epoch - now_mono).
wd_reboot_rest_eval() {
    local now
    local mnow
    local off
    local max
    count_recent_reboots
    max="$CFG_MAX_REBOOTS_PER_HOUR"
    case "$max" in
        ''|*[!0-9]*) max=3 ;;
    esac
    if [ "$reboots_this_hour" -ge "$max" ]; then
        reboot_budget_exhausted="true"
    else
        reboot_budget_exhausted="false"
    fi

    if [ -f "$WD_REBOOT_GUARD_FILE" ]; then
        _wd_guard_at=$(_wd_epoch_file "$WD_REBOOT_GUARD_FILE")
        if [ "$_wd_guard_at" -eq 0 ]; then
            qlog_warn "Reboot guard file unreadable, removing it"
            rm -f "$WD_REBOOT_GUARD_FILE"
        fi
    else
        _wd_guard_at=0
    fi
    _wd_link_up=$(_wd_epoch_file "$WD_LINK_UP_FILE")

    now=$(date +%s)
    mnow=$(mono_now)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    case "$mnow" in ''|*[!0-9]*) mnow=0 ;; esac
    off=""
    if [ "$now" -gt 0 ] && _wd_clock_sane; then
        off=$((now - mnow))
        if [ "$_wd_guard_at" -gt 0 ]; then
            if [ "$_wd_link_up" -gt "$_wd_guard_at" ]; then
                qlog_info "Reboot guard released: the link came back"
                rm -f "$WD_REBOOT_GUARD_FILE"
                _wd_guard_at=0
            elif [ "$now" -ge $((_wd_guard_at + WD_GUARD_SECS)) ]; then
                qlog_info "Reboot guard released: 24 h since it engaged"
                rm -f "$WD_REBOOT_GUARD_FILE"
                _wd_guard_at=0
            fi
        elif [ "$reboot_budget_exhausted" = "true" ] && [ "$_wd_rb_prev" -ge "$max" ] \
            && [ "$_wd_link_up" -le "$_wd_rb_prev_oldest" ]; then
            _wd_persist "$WD_REBOOT_GUARD_FILE" "$now"
            _wd_guard_at="$now"
            qlog_warn "Reboot guard engaged: limit reached in two consecutive hours with no link-up"
            append_event "watchcat_recovery" "Watchcat: reboots paused until the connection comes back (long outage)" "warning" "wd_budget_spent"
        fi
    fi

    _wd_rest_derive "$off"
    return 0
}

# _wd_rest_derive OFF: reboot_rest_reason / reboot_rest_until from the current
# guard and budget globals. OFF = now_epoch - now_mono, "" with an insane clock
# (no deadline then).
_wd_rest_derive() {
    local off
    off="$1"
    reboot_rest_until=""
    if [ "$_wd_guard_at" -gt 0 ]; then
        reboot_rest_reason="long_outage"
        [ -n "$off" ] && reboot_rest_until=$((_wd_guard_at + WD_GUARD_SECS - off))
    elif [ "$reboot_budget_exhausted" = "true" ]; then
        reboot_rest_reason="hourly"
        [ -n "$off" ] && [ "$_wd_rb_free_at" -gt 0 ] && reboot_rest_until=$((_wd_rb_free_at - off))
    else
        reboot_rest_reason=""
    fi
    return 0
}

# A fresh reachable=true read. Ends the budget episode (the next hourly
# wd_budget_spent may fire again) and, on the first one after a watchdog reboot
# newer than the stamp, writes the link-up stamp (one flash write per reboot)
# and releases an engaged guard. Needs a sane clock.
wd_link_up_seen() {
    local mnow
    local now
    _wd_budget_ev=0
    [ "$_wd_rb_newest" -gt "$_wd_link_up" ] || return 0
    _wd_clock_sane || return 0
    now=$(date +%s)
    case "$now" in ''|*[!0-9]*) return 0 ;; esac
    [ "$now" -gt "$_wd_rb_newest" ] || return 0
    _wd_persist "$WD_LINK_UP_FILE" "$now"
    _wd_link_up="$now"
    qlog_info "Link up after a watchdog reboot, link-up stamp written"
    # Release an engaged guard here, without a recount (that stays on the
    # once-a-minute tick).
    if [ "$_wd_guard_at" -gt 0 ] && [ "$now" -gt "$_wd_guard_at" ]; then
        qlog_info "Reboot guard released: the link came back"
        rm -f "$WD_REBOOT_GUARD_FILE"
        _wd_guard_at=0
        mnow=$(mono_now)
        case "$mnow" in ''|*[!0-9]*) mnow=0 ;; esac
        _wd_rest_derive $((now - mnow))
    fi
}

# The hourly wd_budget_spent event, once per episode (until a reachable read).
wd_budget_spent_event() {
    [ "$_wd_budget_ev" = "1" ] && return 0
    _wd_budget_ev=1
    append_event "watchcat_recovery" "Watchcat: reboot limit reached (${CFG_MAX_REBOOTS_PER_HOUR} per hour), reboots paused" "warning" "wd_budget_spent"
}

# Recount at most once a minute so the figure decays when a row ages out of the
# hour. Called as the first statement of every main-loop pass (before the reload
# check), so it also runs while locked, in cooldown or on any early `continue`.
wd_ledger_tick() {
    local now
    now=$(mono_now)
    case "$now" in
        ''|*[!0-9]*) return 0 ;;
    esac
    if [ "$now" -ge "$_rb_next" ]; then
        wd_reboot_rest_eval
        _rb_next=$((now + 60))
    fi
}

# Watchdog (Tier-4) reboots for the Watchdog page's Recent Activity: a JSON
# array of epoch ints, newest first, at most <limit> (default 5), "[]" on any
# problem. Uses no daemon globals (CRASH_LOG falls back to PF_CRASH_LOG) and
# is safe to source from a CGI. Same awk approach as monitoring/alerts.sh; the
# device jq has no regex, so numeric epochs are matched in awk.
wd_ledger_recent_json() {
    local limit
    local file
    local rows
    local out
    limit="$1"
    case "$limit" in
        ''|*[!0-9]*) limit=5 ;;
    esac
    file="${CRASH_LOG:-$PF_CRASH_LOG}"
    if [ ! -f "$file" ] || [ ! -s "$file" ]; then
        printf '[]'
        return 0
    fi
    rows=$(awk -F'|' '
        $2 == "reboot" && $3 == "tier4_escalation" && $1 ~ /^[0-9]+$/ {
            printf "%s%s", sep, $1 + 0
            sep = ","
        }' "$file" 2>/dev/null)
    if [ -z "$rows" ]; then
        printf '[]'
        return 0
    fi
    out=$(printf '[%s]' "$rows" | jq -c --argjson n "$limit" 'sort | reverse | .[0:$n]' 2>/dev/null)
    if [ -z "$out" ]; then
        printf '[]'
        return 0
    fi
    printf '%s' "$out"
}

WD_LEDGER_LOADED=1
