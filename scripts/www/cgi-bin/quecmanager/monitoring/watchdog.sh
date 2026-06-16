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
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"

# Ensure UCI section exists with defaults
ensure_watchcat_config() {
    uci -q get quecmanager.watchcat >/dev/null 2>&1 && return
    uci set quecmanager.watchcat=watchcat
    uci set quecmanager.watchcat.enabled=0
    uci set quecmanager.watchcat.max_failures=5
    uci set quecmanager.watchcat.check_interval=10
    uci set quecmanager.watchcat.cooldown=60
    uci set quecmanager.watchcat.tier1_enabled=1
    uci set quecmanager.watchcat.tier2_enabled=1
    uci set quecmanager.watchcat.tier3_enabled=0
    uci set quecmanager.watchcat.tier4_enabled=1
    uci set quecmanager.watchcat.backup_sim_slot=
    uci set quecmanager.watchcat.max_reboots_per_hour=3
    uci set quecmanager.watchcat.quality_enabled=0
    uci set quecmanager.watchcat.latency_ceiling_ms=800
    uci set quecmanager.watchcat.loss_ceiling_pct=20
    uci set quecmanager.watchcat.quality_consecutive=5
    uci set quecmanager.watchcat.ssr_aware=1
    uci set quecmanager.watchcat.ssr_grace=45
    uci commit quecmanager
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

# Validate numeric field: returns 0 if valid int in [min,max], else 1
validate_int() {
    local val="$1" min="$2" max="$3"
    case "$val" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# Reject the request with a structured error and exit.
# Frontend checks .success === false; HTTP status remains 200 (headers
# already emitted by cgi_headers at file top — project convention).
reject_field() {
    local field="$1" reason="$2"
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

    enabled="" max_failures="" check_interval="" cooldown=""
    tier1="" tier2="" tier3="" tier4="" backup_sim="" max_reboots=""
    quality_enabled="" latency_ceiling="" loss_ceiling="" quality_consecutive=""
    ssr_aware="" ssr_grace=""

    enabled=$(uci_get enabled 0)
    max_failures=$(uci_get max_failures 5)
    check_interval=$(uci_get check_interval 10)
    cooldown=$(uci_get cooldown 60)
    tier1=$(uci_get tier1_enabled 1)
    tier2=$(uci_get tier2_enabled 1)
    tier3=$(uci_get tier3_enabled 0)
    tier4=$(uci_get tier4_enabled 1)
    backup_sim=$(uci_get backup_sim_slot "")
    max_reboots=$(uci_get max_reboots_per_hour 3)
    quality_enabled=$(uci_get quality_enabled 0)
    latency_ceiling=$(uci_get latency_ceiling_ms 800)
    loss_ceiling=$(uci_get loss_ceiling_pct 20)
    quality_consecutive=$(uci_get quality_consecutive 5)
    ssr_aware=$(uci_get ssr_aware 1)
    ssr_grace=$(uci_get ssr_grace 45)

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

    jq -n \
        --argjson enabled "$enabled" \
        --argjson max_failures "$max_failures" \
        --argjson check_interval "$check_interval" \
        --argjson cooldown "$cooldown" \
        --argjson tier1 "$tier1" \
        --argjson tier2 "$tier2" \
        --argjson tier3 "$tier3" \
        --argjson tier4 "$tier4" \
        --arg backup_sim "$backup_sim" \
        --argjson max_reboots "$max_reboots" \
        --argjson quality_enabled "$quality_enabled" \
        --argjson latency_ceiling "$latency_ceiling" \
        --argjson loss_ceiling "$loss_ceiling" \
        --argjson quality_consecutive "$quality_consecutive" \
        --argjson ssr_aware "$ssr_aware" \
        --argjson ssr_grace "$ssr_grace" \
        --argjson status "$status_json" \
        --argjson sim_failover "$sim_failover_json" \
        --argjson sim_swap "$sim_swap_json" \
        --argjson auto_disabled "$auto_disabled" \
        '{
            success: true,
            settings: {
                enabled: ($enabled == 1),
                max_failures: $max_failures,
                check_interval: $check_interval,
                cooldown: $cooldown,
                tier1_enabled: ($tier1 == 1),
                tier2_enabled: ($tier2 == 1),
                tier3_enabled: ($tier3 == 1),
                tier4_enabled: ($tier4 == 1),
                backup_sim_slot: (if $backup_sim == "" then null else ($backup_sim | tonumber) end),
                max_reboots_per_hour: $max_reboots,
                quality_enabled: ($quality_enabled == 1),
                latency_ceiling_ms: $latency_ceiling,
                loss_ceiling_pct: $loss_ceiling,
                quality_consecutive: $quality_consecutive,
                ssr_aware: ($ssr_aware == 1),
                ssr_grace: $ssr_grace
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

        val=$(printf '%s' "$POST_DATA" | jq -r '.max_failures // empty')
        if [ -n "$val" ]; then
            validate_int "$val" 1 20 || reject_field "max_failures" "must be integer 1-20"
            uci set quecmanager.watchcat.max_failures="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.check_interval // empty')
        if [ -n "$val" ]; then
            validate_int "$val" 5 60 || reject_field "check_interval" "must be integer 5-60"
            uci set quecmanager.watchcat.check_interval="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.cooldown // empty')
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

        val=$(printf '%s' "$POST_DATA" | jq -r '.max_reboots_per_hour // empty')
        if [ -n "$val" ]; then
            validate_int "$val" 1 10 || reject_field "max_reboots_per_hour" "must be integer 1-10"
            uci set quecmanager.watchcat.max_reboots_per_hour="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.quality_enabled | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            case "$val" in true) uci set quecmanager.watchcat.quality_enabled=1 ;; false) uci set quecmanager.watchcat.quality_enabled=0 ;; esac
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.latency_ceiling_ms | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 0 10000 || reject_field "latency_ceiling_ms" "must be integer 0-10000"
            uci set quecmanager.watchcat.latency_ceiling_ms="$val"
        fi

        val=$(printf '%s' "$POST_DATA" | jq -r '.loss_ceiling_pct | if . == null then empty else tostring end')
        if [ -n "$val" ]; then
            validate_int "$val" 0 100 || reject_field "loss_ceiling_pct" "must be integer 0-100"
            uci set quecmanager.watchcat.loss_ceiling_pct="$val"
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

        uci commit quecmanager

        # Signal running watchcat daemon to reload config (if it's already running)
        touch "$RELOAD_FLAG"

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
