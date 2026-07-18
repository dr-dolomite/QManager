#!/bin/sh
# =============================================================================
# alert_engine.sh — Centralized Connection-Alert Engine for QManager
# =============================================================================
# ONE downtime state machine + dispatcher, replacing the two duplicated state
# machines that used to live in sms_alerts.sh::check_sms_alert and
# email_alerts.sh::check_email_alert. Sourced into qmanager_poller and invoked
# once per cycle from the always-every-cycle local block (before any AT work),
# so alert detection keeps running at the 2s base cadence regardless of the
# adaptive-polling tier.
#
# This library sources NOTHING itself — the poller sources, in order:
#   qlog.sh (mono_now, qlog_*) -> events.sh -> email_alerts.sh -> sms_alerts.sh
#   -> alert_routing.sh -> alert_engine.sh
# The engine reads globals owned by those libs at call time:
#   conn_internet_available / conn_during_recovery  (poller, from ping.json)
#   _sa_enabled / _sa_threshold_minutes             (sms_alerts.sh)
#   _ea_enabled / _ea_threshold_minutes             (email_alerts.sh)
#   alert_route_enabled / alert_routing_load        (alert_routing.sh)
#   sms_alert_emit / email_alert_emit               (channel libs)
#
# Signal source [guardrail 1]: ICMP reachability (conn_internet_available)
#   ONLY — never service_status / registration state.
# Debounce [guardrail 2]: wall-clock downtime threshold, but elapsed time is
#   measured with the MONOTONIC clock (mono_now, the same clock ping.json's
#   .mono uses), NOT wall-clock epoch. A NITZ clock-step during an SSR-driven
#   outage therefore cannot corrupt the timer — mirrors the watchdog's
#   clock-step hardening.
# Suppression [guardrail 3]: bails on low-power OR watchdog recovery churn,
#   for BOTH channels (email used to miss the conn_during_recovery gate).
# =============================================================================

[ -n "$_ALERT_ENGINE_LOADED" ] && return 0
_ALERT_ENGINE_LOADED=1

# --- Reload flags + suppression sentinels (literal paths — the engine does not
# --- depend on the channel libs having been sourced to evaluate these) -------
_AE_SMS_RELOAD="/tmp/qmanager_sms_reload"
_AE_EMAIL_RELOAD="/tmp/qmanager_email_reload"
_AE_ROUTING_RELOAD="/tmp/qmanager_alert_routing_reload"
_AE_LOW_POWER="/tmp/qmanager_low_power_active"

# --- Reboot-alert detection + delivery (a separate one-shot path) ------------
# boot_id is a per-boot kernel UUID: stable within a boot, regenerated on every
# real reboot, and immune to NITZ/ntpd clock-steps and baseband SSRs (an SSR
# does not reset uptime or regenerate boot_id). It is the reboot detector.
_AE_BOOT_ID_SRC="/proc/sys/kernel/random/boot_id"
# Persisted on ubifs so it survives the reboot we are trying to detect.
_AE_BOOT_ID_FILE="/etc/qmanager/last_boot_id"
# Staged pending alert lives in tmpfs on PURPOSE: a real reboot wipes it (and we
# re-stage fresh on the next boot), while a bare procd respawn of the poller —
# same boot_id — keeps an unsent pending so delivery still happens.
_AE_REBOOT_PENDING="/tmp/qmanager_reboot_pending.json"
# Shared reboot ledger (see qlog.sh::record_planned_reboot + watchcat tier4).
_AE_CRASH_LOG="/etc/qmanager/crash.log"
# Classification window (seconds): a planned reboot writes its breadcrumb, then
# the kernel takes tens of seconds to come back, so the breadcrumb epoch sits a
# short time before the new boot epoch. Generous enough to absorb a slow boot
# and modest clock drift; narrow enough not to swallow a prior reboot's row.
_AE_REBOOT_WINDOW=300
# Storm coalescer: MORE than this many all-cause reboots in the last hour trips
# a single "reboot-looping" message instead of one alert per boot (SMS costs
# money). Suppressed for the rest of the hour via a mono-stamped marker.
_AE_REBOOT_STORM_THRESHOLD=3
_AE_REBOOT_STORM_FLAG="/tmp/qmanager_reboot_storm_hour"

# --- State (poller-process memory, module scope) -----------------------------
# _ae_outage_active     : "0" idle / "1" outage in progress
# _ae_outage_start_mono : mono_now at outage start (monotonic seconds)
# _ae_<ch>_armed        : outage exceeded THIS channel's threshold (warrants a
#                         restored message even if the lost message never sent)
# _ae_<ch>_lost_sent    : the connection_lost message attempt for THIS channel
#                         is done (sent or terminally failed) — don't re-attempt
_ae_outage_active="0"
_ae_outage_start_mono=0
_ae_sms_armed="0"
_ae_email_armed="0"
_ae_sms_lost_sent="0"
_ae_email_lost_sent="0"

# =============================================================================
# alert_engine_init — reset state to idle + prime routing cache
# =============================================================================
alert_engine_init() {
    _ae_outage_active="0"
    _ae_outage_start_mono=0
    _ae_sms_armed="0"
    _ae_email_armed="0"
    _ae_sms_lost_sent="0"
    _ae_email_lost_sent="0"
    alert_routing_load
    qlog_info "Alert engine initialized"
}

# --- Per-channel accessors (2 channels only; case dispatch avoids eval) -------
# Master-enable, read from the channel libs' cached config globals.
_ae_channel_enabled() {
    case "$1" in
        sms)   [ "$_sa_enabled" = "true" ] ;;
        email) [ "$_ea_enabled" = "true" ] ;;
        *)     return 1 ;;
    esac
}

# Threshold in SECONDS (minutes * 60), guarded against non-numeric config.
_ae_channel_threshold_secs() {
    local _ae_thr
    _ae_thr=5
    case "$1" in
        sms)   _ae_thr="$_sa_threshold_minutes" ;;
        email) _ae_thr="$_ea_threshold_minutes" ;;
    esac
    case "$_ae_thr" in
        ''|*[!0-9]*) _ae_thr=5 ;;
    esac
    echo $(( _ae_thr * 60 ))
}

# Marker get/set. Getters run in $(...) subshells (read-only, safe). Setters
# must be called in the main shell (not a subshell) so the assignment persists.
_ae_get_armed()     { case "$1" in sms) echo "$_ae_sms_armed" ;; email) echo "$_ae_email_armed" ;; esac; }
_ae_set_armed()     { case "$1" in sms) _ae_sms_armed="$2" ;;   email) _ae_email_armed="$2" ;;   esac; }
_ae_get_lost_sent() { case "$1" in sms) echo "$_ae_sms_lost_sent" ;; email) echo "$_ae_email_lost_sent" ;; esac; }
_ae_set_lost_sent() { case "$1" in sms) _ae_sms_lost_sent="$2" ;;   email) _ae_email_lost_sent="$2" ;;   esac; }

# Dispatch a send to the right channel lib. Returns the emit's rc:
#   0 = sent, 1 = attempted but failed (terminal), 2 = not ready (retry later).
_ae_channel_emit() {
    case "$1" in
        sms)   sms_alert_emit "$2" "$3" ;;
        email) email_alert_emit "$2" "$3" ;;
        *)     return 1 ;;
    esac
}

# =============================================================================
# alert_engine_check — per-cycle entry point (replaces check_*_alert)
# =============================================================================
alert_engine_check() {
    local _ae_ch

    # --- 1. Reload gate: channel libs re-read their config; routing reloads ---
    if [ -f "$_AE_SMS_RELOAD" ]; then
        rm -f "$_AE_SMS_RELOAD"
        _sa_read_config 2>/dev/null
        qlog_info "Alert engine: SMS channel config reloaded (enabled=$_sa_enabled)"
    fi
    if [ -f "$_AE_EMAIL_RELOAD" ]; then
        rm -f "$_AE_EMAIL_RELOAD"
        _ea_read_config 2>/dev/null
        qlog_info "Alert engine: email channel config reloaded (enabled=$_ea_enabled)"
    fi
    if [ -f "$_AE_ROUTING_RELOAD" ]; then
        alert_routing_load
        qlog_info "Alert engine: routing reloaded"
    fi

    # --- 2. Suppression gates [guardrail 3] — both channels, one place -------
    # Low-power mode: no radio work of any kind.
    [ -f "$_AE_LOW_POWER" ] && return 0
    # Watchdog recovery churn: stale lte/nr state during AT+COPS/AT+CFUN. Outage
    # state persists across this guard (mono timer keeps its start), so a
    # qualifying restored message still fires on the first cycle after recovery.
    [ "$conn_during_recovery" = "true" ] && return 0

    # --- 3. Signal source [guardrail 1]: ICMP reachability only --------------
    # Unknown/stale ping data → leave outage state untouched (don't start or
    # clear an outage on unknown data). The monotonic elapsed math naturally
    # catches up on the next non-null cycle.
    case "$conn_internet_available" in
        null|"") return 0 ;;
    esac

    # --- 4. Post-recovery reboot alert (separate one-shot path) --------------
    # NOT part of the outage state machine — a reboot has no outage window. It
    # is placed after the suppression + ping-null guards above so it inherits
    # the low-power / recovery-churn suppression. Cheap early-out when there is
    # no staged pending file (the common case).
    _ae_reboot_check

    if [ "$conn_internet_available" = "false" ]; then
        _ae_handle_down
    elif [ "$conn_internet_available" = "true" ]; then
        _ae_handle_up
    fi
    return 0
}

# =============================================================================
# _ae_handle_down — internet is DOWN this cycle
# =============================================================================
_ae_handle_down() {
    local _ae_ch
    local _ae_now
    local _ae_elapsed
    local _ae_thr
    local _ae_rc

    # Start a new outage on the leading edge.
    if [ "$_ae_outage_active" != "1" ]; then
        _ae_outage_active="1"
        _ae_outage_start_mono=$(mono_now)
        _ae_sms_armed="0"
        _ae_email_armed="0"
        _ae_sms_lost_sent="0"
        _ae_email_lost_sent="0"
        qlog_info "Alert engine: outage started (mono=$_ae_outage_start_mono)"
    fi

    # Elapsed via the MONOTONIC clock [guardrail 2] — immune to NITZ steps.
    _ae_now=$(mono_now)
    _ae_elapsed=$(( _ae_now - _ae_outage_start_mono ))
    [ "$_ae_elapsed" -lt 0 ] && _ae_elapsed=0

    for _ae_ch in sms email; do
        _ae_channel_enabled "$_ae_ch" || continue
        _ae_thr=$(_ae_channel_threshold_secs "$_ae_ch")
        [ "$_ae_elapsed" -ge "$_ae_thr" ] || continue

        # Crossed this channel's threshold → arm it. Arming is independent of
        # capability, so email arms here (warranting a recovery email) even
        # though it never sends a connection_lost message.
        _ae_set_armed "$_ae_ch" "1"

        # The connection_lost message goes out only for a routed, capable
        # channel (SMS only). Skip if not routed/capable or already attempted.
        alert_route_enabled connection_lost "$_ae_ch" || continue
        [ "$(_ae_get_lost_sent "$_ae_ch")" = "1" ] && continue

        _ae_channel_emit "$_ae_ch" connection_lost "$_ae_elapsed"
        _ae_rc=$?
        # rc 2 = "not ready" (e.g. SMS modem not yet registered) — leave the
        # marker clear so we retry next cycle without burning a send attempt.
        # rc 0 (sent) or rc 1 (registered but sms_tool failed) are both terminal.
        if [ "$_ae_rc" != "2" ]; then
            _ae_set_lost_sent "$_ae_ch" "1"
        fi
    done
}

# =============================================================================
# _ae_handle_up — internet is UP this cycle
# =============================================================================
_ae_handle_up() {
    local _ae_ch
    local _ae_now
    local _ae_total

    # Nothing to do unless we were tracking an outage.
    [ "$_ae_outage_active" = "1" ] || return 0

    _ae_now=$(mono_now)
    _ae_total=$(( _ae_now - _ae_outage_start_mono ))
    [ "$_ae_total" -lt 0 ] && _ae_total=0

    # Fire a restored message for every channel that was armed AND is routed
    # for connection_restored. SMS armed <=> its outage crossed threshold (which
    # also covers the "a down SMS was sent" case); email armed <=> the outage
    # exceeded email's threshold. Restored is fire-once — no retry semantics.
    for _ae_ch in sms email; do
        _ae_channel_enabled "$_ae_ch" || continue
        [ "$(_ae_get_armed "$_ae_ch")" = "1" ] || continue
        alert_route_enabled connection_restored "$_ae_ch" || continue
        _ae_channel_emit "$_ae_ch" connection_restored "$_ae_total"
    done

    # Reset all outage state.
    _ae_outage_active="0"
    _ae_outage_start_mono=0
    _ae_sms_armed="0"
    _ae_email_armed="0"
    _ae_sms_lost_sent="0"
    _ae_email_lost_sent="0"
    qlog_info "Alert engine: outage cleared (total=${_ae_total}s)"
}

# =============================================================================
# REBOOT ALERT — detection (once at startup) + delivery (once per boot)
# =============================================================================
# Fires ONE alert per real device boot, delivered post-recovery (at the reboot
# instant all of userspace is dead — both channels are undeliverable, so the
# alert can only ever go out once connectivity is back). Three causes:
#   watchdog  — the watchcat tier-4 escalation reboot (crash.log tier4 row)
#   user      — any planned reboot (button / scheduled / IPPT / IMEI / MBN /
#               install-update); all fold into "user" via a crash.log user row
#   unplanned — a boot with NO matching recent breadcrumb (power loss / firmware
#               AP-hang). Inferred purely from the ABSENCE of a breadcrumb; this
#               device exposes no positive hardware signal for it.
# Routing defaults OFF on both channels (opt-in), but detection + the ledger
# record every boot regardless of routing.

# _ae_reboot_count_last_hour — ALL-cause reboot count in the trailing hour.
# Distinct from watchcat's count_recent_reboots (tier4-only, for the token
# bucket). Every real boot leaves exactly one crash.log row — planned rows are
# written pre-reboot by record_planned_reboot, watchdog rows by watchcat, and an
# inferred unplanned row is written post-boot by alert_engine_reboot_detect — so
# this count tracks the true reboot rate for the storm coalescer.
_ae_reboot_count_last_hour() {
    local _f="$_AE_CRASH_LOG"
    local _now
    local _cut
    local _n
    [ -f "$_f" ] || { echo 0; return; }
    _now=$(date +%s)
    _cut=$(( _now - 3600 ))
    _n=$(awk -v c="$_cut" -F'|' '$1 ~ /^[0-9]+$/ && $1 >= c { n++ } END { print n+0 }' "$_f" 2>/dev/null)
    case "$_n" in ''|*[!0-9]*) _n=0 ;; esac
    echo "$_n"
}

# _ae_classify_reboot <boot_epoch> — newest in-window crash.log reason → bucket.
_ae_classify_reboot() {
    local _be="$1"
    local _reason
    [ -f "$_AE_CRASH_LOG" ] || { echo "unplanned"; return; }

    # crash.log is chronological (appended), so the LAST in-window row is the
    # newest. awk regex is fine here (only jq lacks Oniguruma on this device).
    _reason=$(awk -v be="$_be" -v win="$_AE_REBOOT_WINDOW" -F'|' '
        $1 ~ /^[0-9]+$/ {
            d = $1 - be; if (d < 0) d = -d;
            if (d <= win) { r = $3 }
        }
        END { print r }
    ' "$_AE_CRASH_LOG" 2>/dev/null)

    case "$_reason" in
        tier4_escalation) echo "watchdog" ;;
        user)             echo "user" ;;
        *)                echo "unplanned" ;;
    esac
}

# _ae_stage_reboot_pending <boot_id> <cause> — write the tmpfs pending file.
_ae_stage_reboot_pending() {
    local _bid="$1"
    local _cause="$2"
    local _mono
    _mono=$(mono_now)
    jq -n -c \
        --arg bid "$_bid" \
        --arg cause "$_cause" \
        --argjson mono "$_mono" \
        '{boot_id: $bid, cause: $cause, detected_mono: $mono, sms_sent: false, email_sent: false}' \
        > "$_AE_REBOOT_PENDING" 2>/dev/null
}

# _ae_reboot_mark_sent <channel> — flip the per-channel flag in the pending file
# (atomic temp+mv; the file is tiny). Never `//` on the sibling boolean.
_ae_reboot_mark_sent() {
    local _ch="$1"
    local _key
    local _tmp
    case "$_ch" in
        sms)   _key="sms_sent" ;;
        email) _key="email_sent" ;;
        *)     return 1 ;;
    esac
    [ -f "$_AE_REBOOT_PENDING" ] || return 1
    _tmp="${_AE_REBOOT_PENDING}.tmp.$$"
    if jq -c --arg k "$_key" '.[$k] = true' "$_AE_REBOOT_PENDING" > "$_tmp" 2>/dev/null; then
        mv "$_tmp" "$_AE_REBOOT_PENDING" 2>/dev/null || rm -f "$_tmp"
    else
        rm -f "$_tmp"
    fi
}

# _ae_storm_flag_fresh — is the storm-suppression marker < 1h old (monotonic)?
_ae_storm_flag_fresh() {
    local _t
    local _age
    [ -f "$_AE_REBOOT_STORM_FLAG" ] || return 1
    _t=$(cat "$_AE_REBOOT_STORM_FLAG" 2>/dev/null)
    case "$_t" in ''|*[!0-9]*) return 1 ;; esac
    _age=$(( $(mono_now) - _t ))
    [ "$_age" -ge 0 ] && [ "$_age" -lt 3600 ]
}

# _ae_reboot_emit_storm <count> — send ONE coalesced reboot-loop message on each
# routed+capable+enabled channel. Fire-once (no rc-2 retry) — a storm is already
# a degraded state and we must not thrash SMS.
_ae_reboot_emit_storm() {
    local _n="$1"
    qlog_warn "Alert engine: reboot storm (n=$_n) — sending coalesced alert"
    if _ae_channel_enabled sms && alert_route_enabled reboot sms; then
        sms_alert_emit reboot 0 storm "$_n"
    fi
    if _ae_channel_enabled email && alert_route_enabled reboot email; then
        email_alert_emit reboot 0 storm "$_n"
    fi
}

# =============================================================================
# alert_engine_reboot_detect — ONE-SHOT boot_id compare + pending stage
# =============================================================================
# Called once from the poller's main() after alert_engine_init (libs loaded).
# Detection lives here (not in the outage machine) so all reboot state sits in
# one place. A bare procd respawn of the poller sees an unchanged boot_id and
# stages nothing; a real reboot changes boot_id and stages a fresh pending file.
alert_engine_reboot_detect() {
    local _live_id
    local _stored_id
    local _cause
    local _boot_epoch

    _live_id=$(cat "$_AE_BOOT_ID_SRC" 2>/dev/null | tr -d ' \r\n')
    # No boot_id (kernel without the entropy file) → never fabricate a reboot.
    [ -n "$_live_id" ] || return 0

    mkdir -p /etc/qmanager 2>/dev/null
    _stored_id=""
    [ -f "$_AE_BOOT_ID_FILE" ] && _stored_id=$(cat "$_AE_BOOT_ID_FILE" 2>/dev/null | tr -d ' \r\n')

    # First run ever (fresh install / first boot): record the id, do NOT alert.
    if [ -z "$_stored_id" ]; then
        printf '%s\n' "$_live_id" > "$_AE_BOOT_ID_FILE" 2>/dev/null
        qlog_info "Alert engine: first boot_id recorded ($_live_id), no reboot alert"
        return 0
    fi

    # Same boot → poller respawn, not a reboot. Keep any unsent pending intact.
    [ "$_stored_id" = "$_live_id" ] && return 0

    # boot_id changed → a real reboot happened. Classify, then commit the new id
    # IMMEDIATELY so a mid-boot procd respawn cannot re-detect the same reboot.
    #
    # _boot_epoch is deliberately WALL-CLOCK (now - uptime): it exists only to be
    # compared against the wall-clock epochs in crash.log, so both sides must use
    # the same clock. There is no NITZ/ntpd-readiness gate here — if the wall
    # clock has not yet been corrected at poller startup, boot_epoch can be off,
    # which at worst mislabels a genuine planned reboot as "unplanned" (the
    # in-window breadcrumb is missed). That is benign: detection still fires once
    # per boot, the ledger + storm counting are unaffected, and the only cost is
    # a single mislabeled cause on the alert/history. A monotonic clock cannot be
    # used here because crash.log breadcrumbs are wall-clock stamped.
    _boot_epoch=$(( $(date +%s) - $(mono_now) ))
    _cause=$(_ae_classify_reboot "$_boot_epoch")

    # An unplanned boot leaves no breadcrumb of its own — record one now (post
    # facto) so it appears in the "recent reboots" history and counts toward the
    # storm coalescer. record_planned_reboot is a neutral ledger writer; the
    # tier4 token bucket ignores this row (it counts tier4_escalation only).
    if [ "$_cause" = "unplanned" ]; then
        record_planned_reboot "unplanned" 2>/dev/null || true
    fi

    _ae_stage_reboot_pending "$_live_id" "$_cause"
    printf '%s\n' "$_live_id" > "$_AE_BOOT_ID_FILE" 2>/dev/null
    qlog_info "Alert engine: reboot detected (cause=$_cause boot_id=$_live_id)"
}

# =============================================================================
# _ae_reboot_check — per-cycle post-recovery delivery of a staged reboot alert
# =============================================================================
_ae_reboot_check() {
    local _cause
    local _mono0
    local _age
    local _storm_n

    # Cheap early-out: nothing staged.
    [ -f "$_AE_REBOOT_PENDING" ] || return 0

    # Deliver only once the internet is actually back (SMS needs registration,
    # email needs DNS). Caller already ruled out null/"".
    [ "$conn_internet_available" = "true" ] || return 0

    # Null-safe reads (project rule: never `//`, even when provably safe).
    _cause=$(jq -r '.cause | if . == null then "unplanned" else . end' "$_AE_REBOOT_PENDING" 2>/dev/null)
    _mono0=$(jq -r '.detected_mono | if . == null then 0 else . end' "$_AE_REBOOT_PENDING" 2>/dev/null)
    case "$_mono0" in ''|*[!0-9]*) _mono0=0 ;; esac

    # Age since detection (monotonic) — approximates "time since back online",
    # which is what the message conveys ("rebooted ~Xm ago").
    _age=$(( $(mono_now) - _mono0 ))
    [ "$_age" -lt 0 ] && _age=0

    # --- Storm coalescer ----------------------------------------------------
    _storm_n=$(_ae_reboot_count_last_hour)
    if [ "$_storm_n" -gt "$_AE_REBOOT_STORM_THRESHOLD" ]; then
        if _ae_storm_flag_fresh; then
            # Already alerted this hour → suppress this boot's per-reboot alert.
            qlog_info "Alert engine: reboot storm already alerted this hour, dropping pending (n=$_storm_n)"
        else
            _ae_reboot_emit_storm "$_storm_n"
            mono_now > "$_AE_REBOOT_STORM_FLAG" 2>/dev/null
        fi
        rm -f "$_AE_REBOOT_PENDING"
        return 0
    fi

    # --- Per-channel delivery (routing AND capability AND master-enable) ----
    # A channel that is not actionable (disabled or not routed for reboot) is
    # trivially "done" — nothing to send. SMS returns rc 2 until the modem
    # re-registers; leave it unmarked and retry next cycle.
    _ae_reboot_deliver_channel sms   "$_age" "$_cause"
    _ae_reboot_deliver_channel email "$_age" "$_cause"

    # Drop the pending file once BOTH channels are done (sent, terminally
    # failed, or not-actionable). A channel still pending an SMS retry keeps the
    # file for the next cycle.
    if _ae_reboot_channel_done sms && _ae_reboot_channel_done email; then
        qlog_info "Alert engine: reboot alert complete (cause=$_cause), clearing pending"
        rm -f "$_AE_REBOOT_PENDING"
    fi
}

# _ae_reboot_deliver_channel <channel> <age> <cause> — attempt one channel.
# No-op (and leaves the channel "done" via not-actionable) when the channel is
# master-disabled or reboot is not routed to it.
_ae_reboot_deliver_channel() {
    local _ch="$1"
    local _age="$2"
    local _cause="$3"
    local _rc

    # Already delivered? (per-channel flag true in the pending file)
    _ae_reboot_channel_done "$_ch" && return 0
    # Not actionable → nothing to attempt; it counts as done for teardown.
    _ae_channel_enabled "$_ch" || return 0
    alert_route_enabled reboot "$_ch" || return 0

    case "$_ch" in
        sms)   sms_alert_emit reboot "$_age" "$_cause" ;;
        email) email_alert_emit reboot "$_age" "$_cause" ;;
        *)     return 0 ;;
    esac
    _rc=$?

    # rc 2 = not ready (SMS modem not yet re-registered) → retry next cycle,
    # leave the flag unset. rc 0 (sent) / rc 1 (terminal fail) → mark done.
    if [ "$_rc" != "2" ]; then
        _ae_reboot_mark_sent "$_ch"
    fi
}

# _ae_reboot_channel_done <channel> — returns 0 if the channel needs no further
# work: either it already delivered (flag true) OR it is not actionable
# (master-disabled or reboot not routed to it, so there is nothing to send).
_ae_reboot_channel_done() {
    local _ch="$1"
    local _flag
    # Null-safe boolean reads — NEVER `//` on a JSON boolean (a stored `false`
    # would be coerced by `//`). Use the explicit if . == null form.
    case "$_ch" in
        sms)   _flag=$(jq -r 'if (.sms_sent   | if . == null then false else . end) then "1" else "0" end' "$_AE_REBOOT_PENDING" 2>/dev/null) ;;
        email) _flag=$(jq -r 'if (.email_sent | if . == null then false else . end) then "1" else "0" end' "$_AE_REBOOT_PENDING" 2>/dev/null) ;;
        *)     return 0 ;;
    esac
    [ "$_flag" = "1" ] && return 0
    # Not yet flagged: done only if it is not actionable (nothing to send).
    if _ae_channel_enabled "$_ch" && alert_route_enabled reboot "$_ch"; then
        return 1
    fi
    return 0
}
