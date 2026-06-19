#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# watchdog.sh — CGI Endpoint: Watchdog Settings & Status (GET + POST)
# =============================================================================
# GET:  Returns current watchdog configuration (UCI) + live status.
# POST: Saves settings, dismisses SIM swap, or requests SIM revert.
#
# Config: UCI quecmanager.watchcat.*
# State:  /tmp/qmanager_watchcat.json (read-only, written by daemon)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/watchdog.sh
# =============================================================================

qlog_init "cgi_watchdog"
cgi_headers
cgi_handle_options

WATCHCAT_STATE="/tmp/qmanager_watchcat.json"
SIM_SWAP_FLAG="/tmp/qmanager_sim_swap_detected"
SIM_FAILOVER_FILE="/tmp/qmanager_sim_failover"
RELOAD_FLAG="/tmp/qmanager_watchcat_reload"
PING_RELOAD_FLAG="/tmp/qmanager_ping_reload"
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"

# Ensure UCI section exists with defaults.
# Two responsibilities, both idempotent:
#   1. Seed the section on first run with the current (Pass A) schema.
#   2. Defensively migrate a legacy `max_failures` value into `fail_threshold`
#      if a device hits this CGI before the installer migration ran.
ensure_watchcat_config() {
    if uci -q get quecmanager.watchcat >/dev/null 2>&1; then
        # Section exists — run the defensive legacy migration only.
        migrate_fail_threshold
        return
    fi
    uci set quecmanager.watchcat=watchcat
    uci set quecmanager.watchcat.enabled=0
    uci set quecmanager.watchcat.fail_threshold=5
    uci set quecmanager.watchcat.check_interval=10
    uci set quecmanager.watchcat.cooldown=60
    uci set quecmanager.watchcat.tier1_enabled=1
    uci set quecmanager.watchcat.tier2_enabled=1
    uci set quecmanager.watchcat.tier3_enabled=0
    uci set quecmanager.watchcat.tier4_enabled=1
    uci set quecmanager.watchcat.backup_sim_slot=
    uci set quecmanager.watchcat.max_reboots_per_hour=3
    uci set quecmanager.watchcat.quality_enabled=0
    uci set quecmanager.watchcat.quality_consecutive=5
    uci set quecmanager.watchcat.ssr_aware=1
    uci set quecmanager.watchcat.ssr_grace=45
    uci commit quecmanager
}

# Defensive migration: if a legacy max_failures exists and fail_threshold is
# absent, copy the value across and delete the old key (mirrors the installer).
# Idempotent: a no-op once fail_threshold is present.
migrate_fail_threshold() {
    local legacy
    local current
    current=$(uci -q get quecmanager.watchcat.fail_threshold 2>/dev/null)
    [ -n "$current" ] && return
    legacy=$(uci -q get quecmanager.watchcat.max_failures 2>/dev/null)
    if [ -n "$legacy" ]; then
        uci set quecmanager.watchcat.fail_threshold="$legacy"
        uci -q delete quecmanager.watchcat.max_failures 2>/dev/null
        uci commit quecmanager
    fi
}

# Read a UCI value with fallback
uci_get() {
    local val
    val=$(uci -q get "quecmanager.watchcat.$1" 2>/dev/null)
    if [ -z "$val" ]; then
        echo "$2"
    else
        echo "$val"
    fi
}

# Map a ping profile name to its probe interval in seconds. Mirrors the
# qmanager_ping daemon's profile->interval table (the daemon owns the canonical
# table; we replicate only the interval column for read-only reflection). An
# unknown name falls back to relaxed (5 s), matching daemon behaviour.
profile_interval() {
    case "$1" in
        sensitive) echo 1 ;;
        regular)   echo 2 ;;
        relaxed)   echo 5 ;;
        quiet)     echo 10 ;;
        *)         echo 5 ;;
    esac
}

# Resolve a quality preset (latency) to a numeric ms threshold. custom uses the
# stored custom value; unknown/empty falls back to tolerant. Mirrors the poller
# resolve_quality_thresholds() mapping (see docs/features/connection-quality.md).
resolve_latency_ms() {
    local preset="$1"
    local custom="$2"
    case "$preset" in
        standard)      echo 150 ;;
        tolerant)      echo 250 ;;
        very-tolerant) echo 500 ;;
        custom)
            case "$custom" in
                ''|*[!0-9]*) echo 250 ;;
                *) echo "$custom" ;;
            esac
            ;;
        *) echo 250 ;;
    esac
}

# Resolve a quality preset (loss) to a numeric pct threshold.
resolve_loss_pct() {
    local preset="$1"
    local custom="$2"
    case "$preset" in
        standard)      echo 15 ;;
        tolerant)      echo 30 ;;
        very-tolerant) echo 50 ;;
        custom)
            case "$custom" in
                ''|*[!0-9]*) echo 30 ;;
                *) echo "$custom" ;;
            esac
            ;;
        *) echo 30 ;;
    esac
}

# Validate numeric field: returns 0 if valid int in [min,max], else 1
validate_int() {
    local val="$1"
    local min="$2"
    local max="$3"
    case "$val" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# Reject the request with a structured error and exit.
# Frontend checks .success === false; HTTP status remains 200 (headers
# already emitted by cgi_headers at file top — project convention).
reject_field() {
    local field="$1"
    local reason="$2"
    jq -n --arg field "$field" --arg reason "$reason" \
        '{success:false, error:"invalid_field", field:$field, reason:$reason}'
    exit 0
}

# =============================================================================
# GET — Fetch settings + live status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching watchdog settings"
    ensure_watchcat_config

    enabled="" fail_threshold="" check_interval="" cooldown=""
    tier1="" tier2="" tier3="" tier4="" backup_sim="" max_reboots=""
    quality_enabled="" quality_consecutive=""
    ssr_aware="" ssr_grace=""

    enabled=$(uci_get enabled 0)
    fail_threshold=$(uci_get fail_threshold 5)
    check_interval=$(uci_get check_interval 10)
    cooldown=$(uci_get cooldown 60)
    tier1=$(uci_get tier1_enabled 1)
    tier2=$(uci_get tier2_enabled 1)
    tier3=$(uci_get tier3_enabled 0)
    tier4=$(uci_get tier4_enabled 1)
    backup_sim=$(uci_get backup_sim_slot "")
    max_reboots=$(uci_get max_reboots_per_hour 3)
    quality_enabled=$(uci_get quality_enabled 0)
    quality_consecutive=$(uci_get quality_consecutive 5)
    ssr_aware=$(uci_get ssr_aware 1)
    ssr_grace=$(uci_get ssr_grace 45)

    # --- Probe interval reflection (ping_profile section, read-only mirror) ---
    probe_profile=""
    interval_override=""
    effective_interval=""
    probe_profile=$(uci -q get quecmanager.ping_profile.profile 2>/dev/null)
    [ -z "$probe_profile" ] && probe_profile="relaxed"
    interval_override=$(uci -q get quecmanager.ping_profile.interval_override 2>/dev/null)
    # Effective = override when a valid int is present, else profile-derived.
    case "$interval_override" in
        ''|*[!0-9]*) effective_interval=$(profile_interval "$probe_profile") ;;
        *) effective_interval="$interval_override" ;;
    esac

    # --- Shared quality thresholds (read-only mirror of quality_thresholds) ---
    qt_latency_preset=""
    qt_loss_preset=""
    qt_latency_custom=""
    qt_loss_custom=""
    if uci -q get quecmanager.quality_thresholds >/dev/null 2>&1; then
        qt_latency_preset=$(uci -q get quecmanager.quality_thresholds.latency_preset 2>/dev/null)
        qt_loss_preset=$(uci -q get quecmanager.quality_thresholds.loss_preset 2>/dev/null)
        qt_latency_custom=$(uci -q get quecmanager.quality_thresholds.latency_custom_ms 2>/dev/null)
        qt_loss_custom=$(uci -q get quecmanager.quality_thresholds.loss_custom_pct 2>/dev/null)
    fi
    [ -z "$qt_latency_preset" ] && qt_latency_preset="tolerant"
    [ -z "$qt_loss_preset" ] && qt_loss_preset="tolerant"
    qt_latency_ms=$(resolve_latency_ms "$qt_latency_preset" "$qt_latency_custom")
    qt_loss_pct=$(resolve_loss_pct "$qt_loss_preset" "$qt_loss_custom")

    # Read live status from watchcat daemon state file
    status_json='{}'
    if [ -f "$WATCHCAT_STATE" ]; then
        status_json=$(cat "$WATCHCAT_STATE" 2>/dev/null)
    fi

    # Read SIM failover state
    sim_failover_json='{"active":false}'
    if [ -f "$SIM_FAILOVER_FILE" ]; then
        sim_failover_json=$(cat "$SIM_FAILOVER_FILE" 2>/dev/null)
    fi

    # Read SIM swap detection
    sim_swap_json='{"detected":false}'
    if [ -f "$SIM_SWAP_FLAG" ]; then
        sim_swap_json=$(cat "$SIM_SWAP_FLAG" 2>/dev/null)
    fi

    # Check if watchcat was auto-disabled
    auto_disabled="false"
    [ -f "$DISABLED_FLAG" ] && auto_disabled="true"

    # interval_override: emit JSON null when unset/non-numeric, else the int.
    interval_override_json="null"
    case "$interval_override" in
        ''|*[!0-9]*) interval_override_json="null" ;;
        *) interval_override_json="$interval_override" ;;
    esac

    jq -n \
        --argjson enabled "$enabled" \
        --argjson fail_threshold "$fail_threshold" \
        --argjson check_interval "$check_interval" \
        --argjson cooldown "$cooldown" \
        --argjson tier1 "$tier1" \
        --argjson tier2 "$tier2" \
        --argjson tier3 "$tier3" \
        --argjson tier4 "$tier4" \
        --arg backup_sim "$backup_sim" \
        --argjson max_reboots "$max_reboots" \
        --argjson quality_enabled "$quality_enabled" \
        --argjson quality_consecutive "$quality_consecutive" \
        --argjson ssr_aware "$ssr_aware" \
        --argjson ssr_grace "$ssr_grace" \
        --arg probe_profile "$probe_profile" \
        --argjson interval_override "$interval_override_json" \
        --argjson effective_interval "$effective_interval" \
        --argjson qt_latency_ms "$qt_latency_ms" \
        --argjson qt_loss_pct "$qt_loss_pct" \
        --arg qt_latency_preset "$qt_latency_preset" \
        --arg qt_loss_preset "$qt_loss_preset" \
        --argjson status "$status_json" \
        --argjson sim_failover "$sim_failover_json" \
        --argjson sim_swap "$sim_swap_json" \
        --argjson auto_disabled "$auto_disabled" \
        '{
            success: true,
            settings: {
                enabled: ($enabled == 1),
                fail_threshold: $fail_threshold,
                check_interval: $check_interval,
                cooldown: $cooldown,
                tier1_enabled: ($tier1 == 1),
                tier2_enabled: ($tier2 == 1),
                tier3_enabled: ($tier3 == 1),
                tier4_enabled: ($tier4 == 1),
                backup_sim_slot: (if $backup_sim == "" then null else ($backup_sim | tonumber) end),
                max_reboots_per_hour: $max_reboots,
                quality_enabled: ($quality_enabled == 1),
                quality_consecutive: $quality_consecutive,
                ssr_aware: ($ssr_aware == 1),
                ssr_grace: $ssr_grace
            },
            probe_profile: $probe_profile,
            interval_override: $interval_override,
            effective_interval: $effective_interval,
            quality_thresholds: {
                latency_ms: $qt_latency_ms,
                loss_pct: $qt_loss_pct,
                latency_preset: $qt_latency_preset,
                loss_preset: $qt_loss_preset
            },
            status: $status,
            sim_failover: $sim_failover,
            sim_swap: $sim_swap,
            auto_disabled: $auto_disabled
        }'
    exit 0
fi

# =============================================================================
# POST — Save settings / dismiss SIM swap / revert SIM
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_settings
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        qlog_info "Saving watchdog settings"
        ensure_watchcat_config

        # Extract fields from POST body
        val=""

        val=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in
                true) uci set quecmanager.watchcat.enabled=1 ;;
                false) uci set quecmanager.watchcat.enabled=0 ;;
            esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.fail_threshold | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 1 20 || reject_field "fail_threshold" "must be integer 1-20"
            uci set quecmanager.watchcat.fail_threshold="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.check_interval | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 5 60 || reject_field "check_interval" "must be integer 5-60"
            uci set quecmanager.watchcat.check_interval="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.cooldown | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 10 300 || reject_field "cooldown" "must be integer 10-300"
            uci set quecmanager.watchcat.cooldown="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.tier1_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.tier1_enabled=1 ;; false) uci set quecmanager.watchcat.tier1_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.tier2_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.tier2_enabled=1 ;; false) uci set quecmanager.watchcat.tier2_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.tier3_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.tier3_enabled=1 ;; false) uci set quecmanager.watchcat.tier3_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.tier4_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.tier4_enabled=1 ;; false) uci set quecmanager.watchcat.tier4_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.backup_sim_slot // empty')
        if [ -n "$val" ] && [ "$val" != "null" ]; then
            case "$val" in
                1|2) uci set quecmanager.watchcat.backup_sim_slot="$val" ;;
                *) reject_field "backup_sim_slot" "must be 1 or 2" ;;
            esac
        else
            uci set quecmanager.watchcat.backup_sim_slot=""
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.max_reboots_per_hour | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 1 10 || reject_field "max_reboots_per_hour" "must be integer 1-10"
            uci set quecmanager.watchcat.max_reboots_per_hour="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.quality_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.quality_enabled=1 ;; false) uci set quecmanager.watchcat.quality_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.quality_consecutive | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 1 60 || reject_field "quality_consecutive" "must be integer 1-60"
            uci set quecmanager.watchcat.quality_consecutive="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.ssr_grace | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 10 120 || reject_field "ssr_grace" "must be integer 10-120"
            uci set quecmanager.watchcat.ssr_grace="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.ssr_aware | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.ssr_aware=1 ;; false) uci set quecmanager.watchcat.ssr_aware=0 ;; esac
        fi

        # ---------------------------------------------------------------------
        # Probe interval (ping_profile section). The Watchdog page is the single
        # writer for the Custom interval override; the Sensitivity page only
        # reflects it (one owner avoids a two-writer race). These writes target
        # quecmanager.ping_profile.*, NOT watchcat.*.
        # ---------------------------------------------------------------------
        ping_profile_changed=0

        val=$(printf '%s' "$POST_DATA" | jq -r '.probe_profile // empty')
        if [ -n "$val" ]; then
            case "$val" in
                sensitive|regular|relaxed|quiet)
                    # Ensure the section exists before writing into it.
                    uci -q get quecmanager.ping_profile >/dev/null 2>&1 || \
                        uci set quecmanager.ping_profile=ping_profile
                    uci set quecmanager.ping_profile.profile="$val"
                    ping_profile_changed=1
                    ;;
                *) reject_field "probe_profile" "must be one of: sensitive, regular, relaxed, quiet" ;;
            esac
        fi

        # interval_override: present + null/empty => clear; present + int => set
        # (range 1-60); absent => leave untouched. We distinguish "key absent"
        # from "key present but null" so the page can explicitly clear.
        has_override=$(printf '%s' "$POST_DATA" | jq -r 'has("interval_override")')
        if [ "$has_override" = "true" ]; then
            val=$(printf '%s' "$POST_DATA" | jq -r '.interval_override | if . == null then empty else tostring end')
            uci -q get quecmanager.ping_profile >/dev/null 2>&1 || \
                uci set quecmanager.ping_profile=ping_profile
            if [ -z "$val" ]; then
                # Explicit clear (null or empty string).
                uci -q delete quecmanager.ping_profile.interval_override 2>/dev/null
            else
                validate_int "$val" 1 60 || reject_field "interval_override" "must be integer 1-60"
                uci set quecmanager.ping_profile.interval_override="$val"
            fi
            ping_profile_changed=1
        fi

        uci commit quecmanager

        # Signal running watchcat daemon to reload config (if it's already running)
        touch "$RELOAD_FLAG"

        # If any ping_profile field changed, signal the ping daemon too.
        if [ "$ping_profile_changed" = "1" ]; then
            touch "$PING_RELOAD_FLAG"
        fi

        # Clear auto-disabled flag if user is re-enabling
        new_enabled=""
        new_enabled=$(uci -q get quecmanager.watchcat.enabled 2>/dev/null)
        if [ "$new_enabled" = "1" ]; then
            rm -f "$DISABLED_FLAG"
            # Enable and start the watchcat init script
            /etc/init.d/qmanager_watchcat enable 2>/dev/null
            ( /etc/init.d/qmanager_watchcat restart >/dev/null 2>&1 & )
            qlog_info "Watchdog settings saved, watchcat enabled and started"
        else
            # Stop and disable the watchcat init script
            /etc/init.d/qmanager_watchcat stop >/dev/null 2>&1
            /etc/init.d/qmanager_watchcat disable 2>/dev/null
            qlog_info "Watchdog settings saved, watchcat stopped and disabled"
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: dismiss_sim_swap
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "dismiss_sim_swap" ]; then
        qlog_info "Dismissing SIM swap notification"
        if [ -f "$SIM_SWAP_FLAG" ]; then
            tmp_json=$(jq -c '.dismissed = true' "$SIM_SWAP_FLAG" 2>/dev/null)
            if [ -n "$tmp_json" ]; then
                printf '%s\n' "$tmp_json" > "$SIM_SWAP_FLAG"
            fi
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: revert_sim
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "revert_sim" ]; then
        qlog_info "User requesting SIM revert"
        touch "$REVERT_FLAG"
        echo '{"success":true,"message":"SIM revert requested. The watchcat will process this shortly."}'
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only GET and POST are supported"
