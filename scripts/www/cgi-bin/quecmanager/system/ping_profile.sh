#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# ping_profile.sh — CGI Endpoint: Connection Quality / Ping Profile (GET + POST)
# =============================================================================
# GET:  Returns the active ping profile name + 2 probe targets.
# POST: action=save — validates + persists profile + targets, then drops the
#       /tmp/qmanager_ping_reload flag so qmanager_ping re-reads within one cycle.
#
# Config: UCI quecmanager.ping_profile.{profile,target_1,target_2}
#   profile  ∈ sensitive | regular | relaxed | quiet  (daemon owns the params)
#   target_1/target_2 — HTTP(S) URLs the daemon curl-probes
#
# Note: GET response keys are target1/target2 (no underscore); POST body keys
# are target_1/target_2 (matching the UCI keys).
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/ping_profile.sh
# Install location: /www/cgi-bin/quecmanager/system/ping_profile.sh
# =============================================================================

qlog_init "cgi_ping_profile"
cgi_headers
cgi_handle_options

RELOAD_FLAG="/tmp/qmanager_ping_reload"

# Map a ping profile name to its probe interval in seconds. Mirrors the
# qmanager_ping daemon's profile->interval table. Unknown => relaxed (5 s).
profile_interval() {
    case "$1" in
        sensitive) echo 1 ;;
        regular)   echo 2 ;;
        relaxed)   echo 5 ;;
        quiet)     echo 10 ;;
        *)         echo 5 ;;
    esac
}

# Ensure the UCI section exists with concrete defaults (seed-on-read).
ensure_ping_profile_config() {
    uci -q get quecmanager.ping_profile >/dev/null 2>&1 && return
    uci set quecmanager.ping_profile=ping_profile
    uci set quecmanager.ping_profile.profile='relaxed'
    uci set quecmanager.ping_profile.target_1='http://cp.cloudflare.com/'
    uci set quecmanager.ping_profile.target_2='http://www.gstatic.com/generate_204'
    uci commit quecmanager
}

# Validate a probe target URL server-side (mirrors the client rules):
# trimmed, non-empty, length <= 256, no whitespace, and free of shell/HTML
# metacharacters. Returns 0 = valid, 1 = invalid. Echoes the normalized URL
# (https:// prepended when scheme-less) on success.
validate_target() {
    local url
    # Trim leading/trailing whitespace.
    url=$(printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

    # Non-empty.
    [ -n "$url" ] || return 1

    # Length <= 256 (BusyBox-safe length count).
    if [ "${#url}" -gt 256 ]; then
        return 1
    fi

    # No interior whitespace (space or tab).
    case "$url" in
        *" "*|*"	"*) return 1 ;;
    esac

    # Reject shell/HTML metacharacters: ` $ ( ) ; | < > " \
    case "$url" in
        *'`'*|*'$'*|*'('*|*')'*|*';'*|*'|'*|*'<'*|*'>'*|*'"'*|*'\'*) return 1 ;;
    esac

    # Normalize: prepend https:// when scheme-less.
    case "$url" in
        *://*) ;;
        *) url="https://$url" ;;
    esac

    printf '%s' "$url"
    return 0
}

# =============================================================================
# GET — Fetch active ping profile + targets
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching ping profile"
    ensure_ping_profile_config

    profile=$(uci -q get quecmanager.ping_profile.profile 2>/dev/null)
    [ -z "$profile" ] && profile="relaxed"
    target1=$(uci -q get quecmanager.ping_profile.target_1 2>/dev/null)
    [ -z "$target1" ] && target1="http://cp.cloudflare.com/"
    target2=$(uci -q get quecmanager.ping_profile.target_2 2>/dev/null)
    [ -z "$target2" ] && target2="http://www.gstatic.com/generate_204"

    # interval_override is written exclusively by the Watchdog page; reflected
    # here read-only so the Sensitivity card can show "overridden by Watchdog".
    interval_override=$(uci -q get quecmanager.ping_profile.interval_override 2>/dev/null)
    case "$interval_override" in
        ''|*[!0-9]*)
            interval_override_json="null"
            effective_interval=$(profile_interval "$profile")
            ;;
        *)
            interval_override_json="$interval_override"
            effective_interval="$interval_override"
            ;;
    esac

    jq -n \
        --arg profile "$profile" \
        --arg target1 "$target1" \
        --arg target2 "$target2" \
        --argjson interval_override "$interval_override_json" \
        --argjson effective_interval "$effective_interval" \
        '{success: true, profile: $profile, target1: $target1, target2: $target2,
          interval_override: $interval_override, effective_interval: $effective_interval}'
    exit 0
fi

# =============================================================================
# POST — Save ping profile + targets
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    if [ "$ACTION" != "save" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    ensure_ping_profile_config

    PROFILE=$(printf '%s' "$POST_DATA" | jq -r '.profile // empty')
    RAW_T1=$(printf '%s' "$POST_DATA" | jq -r '.target_1 // empty')
    RAW_T2=$(printf '%s' "$POST_DATA" | jq -r '.target_2 // empty')

    # --- Validate profile against the 4-value allowlist ---
    case "$PROFILE" in
        sensitive|regular|relaxed|quiet) ;;
        *)
            cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"
            exit 0
            ;;
    esac

    # --- Validate + normalize each target ---
    T1=$(validate_target "$RAW_T1") || {
        cgi_error "invalid_target" "target_1 is not a valid URL"
        exit 0
    }
    T2=$(validate_target "$RAW_T2") || {
        cgi_error "invalid_target" "target_2 is not a valid URL"
        exit 0
    }

    # --- Persist + signal the daemon ---
    uci set quecmanager.ping_profile.profile="$PROFILE"
    uci set quecmanager.ping_profile.target_1="$T1"
    uci set quecmanager.ping_profile.target_2="$T2"
    uci commit quecmanager

    touch "$RELOAD_FLAG"

    qlog_info "Ping profile saved: profile=$PROFILE targets=$T1,$T2"
    echo '{"success":true}'
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only GET and POST are supported"
