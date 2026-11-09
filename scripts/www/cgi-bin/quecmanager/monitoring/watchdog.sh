#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
[ -f /usr/lib/qmanager/safe_tmp.sh ] && . /usr/lib/qmanager/safe_tmp.sh
# Cadence tables and the platform adapter (config store, flag paths, services)
# come from conn_state.sh. Guarded: a `.` on a missing file kills a BusyBox
# script; the check below answers internal_error instead.
[ -f /usr/lib/qmanager/conn_state.sh ] && . /usr/lib/qmanager/conn_state.sh
# Recent watchdog reboots (Tier-4 ledger rows). Guarded; the stub reports none.
[ -f /usr/lib/qmanager/wd_ledger.sh ] && . /usr/lib/qmanager/wd_ledger.sh
if ! command -v wd_ledger_recent_json >/dev/null 2>&1; then
    wd_ledger_recent_json() { echo '[]'; }
fi
# =============================================================================
# watchdog.sh - CGI Endpoint: Watchdog settings and status (GET + POST)
# =============================================================================
# GET:  settings (new key names), effective values (act_after_sec, step_wait_sec
#       with the probe cadence applied, quality limits with the watchdog floors),
#       the daemon's state file as `status`, the SIM failover record, recent
#       watchdog reboots, dual-SIM capability and the pre-upgrade auto-disable
#       flag. Never writes config.
# POST: save_settings     any subset of the settings keys; validate everything,
#                         then stage + commit once; unknown keys are rejected
#       revert_sim        flag the daemon consumes on its next pass
#       retry_failback    flag the daemon consumes on its next pass (Amendment 1 B)
#       dismiss_sim_swap  mark the SIM-swap banner dismissed (RM551E only)
#
# Config: platform adapter, watchdog <key> -> quecmanager.watchcat.<key>.
# State:  /tmp/qmanager_watchcat.json (read-only, written by the daemon)
#
# Contract: docs/plans/2026-11-07-cq-watchdog-contracts.md section 5.3 / 5.4,
# Amendments 1-3. Reboots never happen here; the daemon owns every action.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/watchdog.sh
# =============================================================================

qlog_init "cgi_watchdog"
cgi_headers
cgi_handle_options

WATCHCAT_STATE="/tmp/qmanager_watchcat.json"
SIM_SWAP_FLAG="/tmp/qmanager_sim_swap_detected"
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"
WD_SERVICE="qmanager_watchcat"

if ! command -v cfg_get >/dev/null 2>&1 || ! command -v conn_state_cadence >/dev/null 2>&1 \
    || ! command -v plat_flag_raise >/dev/null 2>&1 || ! command -v svc_enable >/dev/null 2>&1; then
    jq -n '{success:false, error:"internal_error", detail:"platform library unavailable"}'
    exit 0
fi

# --- Helpers ------------------------------------------------------------------

# invalid_field <field> <detail>: the validation reply. Everything is validated
# before anything is staged, so there is nothing to revert.
invalid_field() {
    jq -n --arg field "$1" --arg detail "$2" \
        '{success:false, error:"invalid_field", field:$field, detail:$detail}'
    exit 0
}

save_failed() {
    cfg_revert >/dev/null 2>&1
    jq -n '{success:false, error:"save_failed", detail:"The settings could not be saved"}'
    exit 0
}

# wd_int_in <lo> <hi> <val>: prints val without leading zeros when it is plain
# decimal digits within lo..hi (rc 0), else rc 1.
wd_int_in() {
    local v
    v="$3"
    case "$v" in ''|*[!0-9]*) return 1 ;; esac
    while [ "${#v}" -gt 1 ] && [ "${v#0}" != "$v" ]; do
        v="${v#0}"
    done
    [ "${#v}" -le "${#2}" ] || return 1
    [ "$v" -ge "$1" ] && [ "$v" -le "$2" ] || return 1
    printf '%s' "$v"
}

# wd_body_ok: rc 0 when CONTENT_LENGTH is unset/empty (cgi_read_post then answers
# no_body) or a plain number up to 8192; rc 1 for a longer or non-numeric length.
# Checked before the body is read so a large POST never reaches dd.
wd_body_ok() {
    local n
    n="$CONTENT_LENGTH"
    [ -n "$n" ] || return 0
    case "$n" in *[!0-9]*) return 1 ;; esac
    while [ "${#n}" -gt 1 ] && [ "${n#0}" != "$n" ]; do
        n="${n#0}"
    done
    [ "${#n}" -le 4 ] && [ "$n" -le 8192 ]
}

# wd_stored_int <key> <default> <lo> <hi>: the stored value clamped into lo..hi
# like the daemon reads it; the default when absent or not a number.
wd_stored_int() {
    local raw
    local v
    raw=$(cfg_get watchdog "$1")
    case "$raw" in ''|*[!0-9]*) printf '%s' "$2"; return 0 ;; esac
    v="$raw"
    while [ "${#v}" -gt 1 ] && [ "${v#0}" != "$v" ]; do
        v="${v#0}"
    done
    if [ "${#v}" -gt "${#4}" ]; then
        printf '%s' "$4"
        return 0
    fi
    [ "$v" -lt "$3" ] && v="$3"
    [ "$v" -gt "$4" ] && v="$4"
    printf '%s' "$v"
}

# wd_stored_bool <key> <default true|false>: true/false from a stored 1/0 (the only
# values the daemon honours); the default otherwise.
wd_stored_bool() {
    local raw
    raw=$(cfg_get watchdog "$1")
    case "$raw" in
        1) printf 'true' ;;
        0) printf 'false' ;;
        *) printf '%s' "$2" ;;
    esac
}

# json_or_default <type> <raw> <default>: <raw> re-emitted as one compact JSON
# document when it is exactly one value of <type> (object/array), else the
# default. An empty or half-written file lands on the default, never a 500.
json_or_default() {
    local out
    out=$(printf '%s' "$2" | jq -c -s -e --arg t "$1" \
        'if length == 1 and (.[0] | type) == $t then .[0] else empty end' 2>/dev/null) || out=""
    if [ -n "$out" ]; then
        printf '%s' "$out"
    else
        printf '%s' "$3"
    fi
}

# wd_quality_limits: WD_Q_LAT / WD_Q_LOSS, the connection_quality limits the
# watchdog acts on (contracts section 1): preset value (custom must be in range,
# else tolerant), raised to the floors max(latency, 50) ms and max(loss, 10) %.
wd_quality_limits() {
    local lp
    local lc
    local sp
    local sc
    lp=$(cfg_get connection_quality latency_preset)
    sp=$(cfg_get connection_quality loss_preset)
    case "$lp" in
        standard) WD_Q_LAT=150 ;;
        very-tolerant) WD_Q_LAT=500 ;;
        custom)
            lc=$(cfg_get connection_quality latency_custom_ms)
            WD_Q_LAT=$(wd_int_in 1 10000 "$lc") || WD_Q_LAT=250
            ;;
        *) WD_Q_LAT=250 ;;
    esac
    case "$sp" in
        standard) WD_Q_LOSS=15 ;;
        very-tolerant) WD_Q_LOSS=50 ;;
        custom)
            sc=$(cfg_get connection_quality loss_custom_pct)
            WD_Q_LOSS=$(wd_int_in 1 100 "$sc") || WD_Q_LOSS=30
            ;;
        *) WD_Q_LOSS=30 ;;
    esac
    [ "$WD_Q_LAT" -lt 50 ] && WD_Q_LAT=50
    [ "$WD_Q_LOSS" -lt 10 ] && WD_Q_LOSS=10
    return 0
}

# =============================================================================
# GET
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_debug "Fetching watchdog settings"

    enabled=$(wd_stored_bool enabled false)
    act_after=$(wd_stored_int act_after_sec 30 15 600)
    step_wait=$(wd_stored_int step_wait_sec 60 10 300)
    tier1=$(wd_stored_bool tier1_enabled true)
    tier2=$(wd_stored_bool tier2_enabled true)
    tier3=$(wd_stored_bool tier3_enabled false)
    tier4=$(wd_stored_bool tier4_enabled true)
    max_reboots=$(wd_stored_int max_reboots_per_hour 3 1 10)
    quality_enabled=$(wd_stored_bool quality_enabled false)
    quality_after=$(wd_stored_int quality_after_sec 120 30 1800)
    carrier_enabled=$(wd_stored_bool carrier_enabled false)
    carrier_after=$(wd_stored_int carrier_after_min 15 5 240)
    ssr_aware=$(wd_stored_bool ssr_aware true)
    ssr_grace=$(wd_stored_int ssr_grace_sec 45 10 120)
    failback_enabled=$(wd_stored_bool failback_enabled false)
    failback_every=$(wd_stored_int failback_every_min 30 5 1440)

    backup_slot=$(cfg_get watchdog backup_sim_slot)
    case "$backup_slot" in 1|2) ;; *) backup_slot="null" ;; esac

    # Effective values: the probe cadence of the stored sensitivity raises the
    # floors (act >= fail_secs, step wait >= recover_secs + 20).
    conn_state_cadence
    eff_act="$act_after"
    [ "$CQ_CFG_FAIL_SECS" -gt "$eff_act" ] && eff_act="$CQ_CFG_FAIL_SECS"
    eff_step="$step_wait"
    [ $((CQ_CFG_RECOVER_SECS + 20)) -gt "$eff_step" ] && eff_step=$((CQ_CFG_RECOVER_SECS + 20))
    wd_quality_limits

    status_json='{}'
    if [ -f "$WATCHCAT_STATE" ]; then
        status_json=$(json_or_default object "$(cat "$WATCHCAT_STATE" 2>/dev/null)" '{}')
    fi

    sim_failover_json='{"active":false}'
    if [ -f "$PF_FAILOVER_MIRROR" ]; then
        sim_failover_json=$(json_or_default object "$(cat "$PF_FAILOVER_MIRROR" 2>/dev/null)" '{"active":false}')
    fi

    recent_reboots_json=$(json_or_default array "$(wd_ledger_recent_json 5 2>/dev/null)" '[]')

    dual_capable="false"
    plat_dual_sim && dual_capable="true"

    auto_disabled="false"
    [ -f "$DISABLED_FLAG" ] && auto_disabled="true"

    jq -n \
        --argjson enabled "$enabled" \
        --argjson act_after "$act_after" \
        --argjson step_wait "$step_wait" \
        --argjson tier1 "$tier1" \
        --argjson tier2 "$tier2" \
        --argjson tier3 "$tier3" \
        --argjson tier4 "$tier4" \
        --argjson backup_slot "$backup_slot" \
        --argjson max_reboots "$max_reboots" \
        --argjson quality_enabled "$quality_enabled" \
        --argjson quality_after "$quality_after" \
        --argjson carrier_enabled "$carrier_enabled" \
        --argjson carrier_after "$carrier_after" \
        --argjson ssr_aware "$ssr_aware" \
        --argjson ssr_grace "$ssr_grace" \
        --argjson failback_enabled "$failback_enabled" \
        --argjson failback_every "$failback_every" \
        --argjson eff_act "$eff_act" \
        --argjson eff_step "$eff_step" \
        --argjson q_lat "$WD_Q_LAT" \
        --argjson q_loss "$WD_Q_LOSS" \
        --argjson status "$status_json" \
        --argjson sim_failover "$sim_failover_json" \
        --argjson recent_reboots "$recent_reboots_json" \
        --argjson dual_capable "$dual_capable" \
        --argjson auto_disabled "$auto_disabled" \
        '{
            success: true,
            settings: {
                enabled: $enabled,
                act_after_sec: $act_after,
                step_wait_sec: $step_wait,
                tier1_enabled: $tier1,
                tier2_enabled: $tier2,
                tier3_enabled: $tier3,
                tier4_enabled: $tier4,
                backup_sim_slot: $backup_slot,
                max_reboots_per_hour: $max_reboots,
                quality_enabled: $quality_enabled,
                quality_after_sec: $quality_after,
                carrier_enabled: $carrier_enabled,
                carrier_after_min: $carrier_after,
                ssr_aware: $ssr_aware,
                ssr_grace_sec: $ssr_grace,
                failback_enabled: $failback_enabled,
                failback_every_min: $failback_every
            },
            effective: {
                act_after_sec: $eff_act,
                step_wait_sec: $eff_step,
                quality_limits: {latency_ms: $q_lat, loss_pct: $q_loss},
                carrier_enabled: $carrier_enabled,
                carrier_after_min: $carrier_after
            },
            status: $status,
            sim_failover: $sim_failover,
            recent_reboots: $recent_reboots,
            sim_dual_capable: $dual_capable,
            auto_disabled: $auto_disabled
        }'
    exit 0
fi

# =============================================================================
# POST
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    wd_body_ok || {
        cgi_error "payload_too_large" "Request body is larger than 8192 bytes"
        exit 0
    }
    cgi_read_post

    if ! printf '%s' "$POST_DATA" | jq -e 'type == "object"' >/dev/null 2>&1; then
        cgi_error "invalid_json" "Request body is not a JSON object"
        exit 0
    fi

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action | if type == "string" then . else "" end')
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # save_settings
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        qlog_info "Saving watchdog settings"

        # One row per body key: k<key> <kind> <value>. The "k" prefix keeps an
        # empty key from collapsing the tab split. Kinds: int (integer-valued
        # number), num (fractional), str, bool, null, other. @tsv escapes tab,
        # newline and backslash, so a hostile key cannot add rows.
        rows=$(printf '%s' "$POST_DATA" | jq -r '
            to_entries[] | select(.key != "action")
            | ["k" + .key,
               (.value | if type == "number" then (if . == floor then "int" else "num" end)
                         elif type == "string" then "str"
                         elif type == "boolean" then "bool"
                         elif type == "null" then "null"
                         else "other" end),
               (.value | if type == "number" then (if . == floor then (floor | tostring) else tostring end)
                         elif type == "boolean" then tostring
                         elif type == "string" then . else "" end)]
            | @tsv')

        tab=$(printf '\t')
        stage_list=""
        slot_present=0
        slot_new=""
        tier3_new=""
        has_enabled=0
        enabled_new=""
        has_carrier=0

        # Pass 1: validate every key, stage nothing. The first failing key in
        # request order is reported.
        while IFS="$tab" read -r wk wt wv; do
            [ -n "$wk" ] || continue
            wk="${wk#k}"
            case "$wk" in
                enabled|tier1_enabled|tier2_enabled|tier3_enabled|tier4_enabled|quality_enabled|ssr_aware|failback_enabled|carrier_enabled)
                    [ "$wt" = "bool" ] || invalid_field "$wk" "must be true or false"
                    if [ "$wv" = "true" ]; then bv=1; else bv=0; fi
                    stage_list="$stage_list$wk=$bv
"
                    case "$wk" in
                        enabled) has_enabled=1; enabled_new="$bv" ;;
                        tier3_enabled) tier3_new="$bv" ;;
                        carrier_enabled) has_carrier=1 ;;
                    esac
                    ;;
                act_after_sec|step_wait_sec|max_reboots_per_hour|quality_after_sec|carrier_after_min|ssr_grace_sec|failback_every_min)
                    case "$wk" in
                        act_after_sec) lo=15; hi=600 ;;
                        step_wait_sec) lo=10; hi=300 ;;
                        max_reboots_per_hour) lo=1; hi=10 ;;
                        quality_after_sec) lo=30; hi=1800 ;;
                        carrier_after_min) lo=5; hi=240 ;;
                        ssr_grace_sec) lo=10; hi=120 ;;
                        failback_every_min) lo=5; hi=1440 ;;
                    esac
                    [ "$wt" = "int" ] && iv=$(wd_int_in "$lo" "$hi" "$wv") \
                        || invalid_field "$wk" "must be an integer $lo-$hi"
                    stage_list="$stage_list$wk=$iv
"
                    ;;
                backup_sim_slot)
                    case "$wt:$wv" in
                        null:) slot_present=1; slot_new="" ;;
                        int:1|int:2) slot_present=1; slot_new="$wv" ;;
                        *) invalid_field "backup_sim_slot" "must be 1, 2 or null" ;;
                    esac
                    ;;
                *)
                    invalid_field "$wk" "unknown setting"
                    ;;
            esac
        done <<EOF
$rows
EOF

        # Cross-field rules against the merged result (stored + request).
        if [ -n "$tier3_new" ]; then
            merged_t3="$tier3_new"
        else
            merged_t3=0
            [ "$(wd_stored_bool tier3_enabled false)" = "true" ] && merged_t3=1
        fi
        if [ "$slot_present" = "1" ]; then
            merged_slot="$slot_new"
        else
            merged_slot=$(cfg_get watchdog backup_sim_slot)
            case "$merged_slot" in 1|2) ;; *) merged_slot="" ;; esac
        fi
        if [ "$tier3_new" = "1" ] && [ -z "$merged_slot" ]; then
            invalid_field "tier3_enabled" "Tier 3 needs a backup SIM slot"
        fi
        if [ "$slot_present" = "1" ] && [ -z "$slot_new" ] && [ "$merged_t3" = "1" ]; then
            invalid_field "backup_sim_slot" "the backup SIM slot cannot be cleared while Tier 3 is on"
        fi

        # Pass 2: stage everything, commit once.
        while IFS='=' read -r sk sv; do
            [ -n "$sk" ] || continue
            cfg_set watchdog "$sk" "$sv" || save_failed
        done <<EOF
$stage_list
EOF
        if [ "$slot_present" = "1" ]; then
            if [ -n "$slot_new" ]; then
                cfg_set watchdog backup_sim_slot "$slot_new" || save_failed
            else
                cfg_del watchdog backup_sim_slot || save_failed
            fi
        fi
        cfg_commit || save_failed

        # The running daemon re-reads on the reload flag; it is never restarted
        # from here (that would drop a live recovery).
        plat_flag_raise "$PF_WD_RELOAD"
        # The poller gates its SA carrier read on the carrier toggle.
        [ "$has_carrier" = "1" ] && plat_flag_raise "$PF_POLLER_RELOAD"

        if [ "$has_enabled" = "1" ]; then
            if [ "$enabled_new" = "1" ]; then
                rm -f "$DISABLED_FLAG"
                svc_enable "$WD_SERVICE" >/dev/null 2>&1
                if ! svc_running "$WD_SERVICE"; then
                    ( svc_start "$WD_SERVICE" </dev/null >/dev/null 2>&1 & )
                fi
                qlog_info "Watchdog settings saved, watchcat enabled"
            else
                svc_stop "$WD_SERVICE" >/dev/null 2>&1
                svc_disable "$WD_SERVICE" >/dev/null 2>&1
                qlog_info "Watchdog settings saved, watchcat stopped and disabled"
            fi
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # dismiss_sim_swap (RM551E only)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "dismiss_sim_swap" ]; then
        qlog_info "Dismissing SIM swap notification"
        if [ -f "$SIM_SWAP_FLAG" ]; then
            tmp_json=$(jq -c '.dismissed = true' "$SIM_SWAP_FLAG" 2>/dev/null)
            if [ -n "$tmp_json" ]; then
                # Root-owned rewrite, not a write-through of a planted file
                printf '%s\n' "$tmp_json" | qm_atomic_write "$SIM_SWAP_FLAG" || save_failed
            fi
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # revert_sim: the daemon defers it while busy and honours only a root-owned flag
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "revert_sim" ]; then
        qlog_info "User requesting SIM revert"
        : | qm_atomic_write "$REVERT_FLAG" || save_failed
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # retry_failback: reset the give-up and try the primary SIM at once. Also ok
    # when no failover is active (the daemon removes the flag and ignores it).
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "retry_failback" ]; then
        qlog_info "User requesting a failback retry"
        : | qm_atomic_write "$PF_FAILBACK_RETRY_FLAG" || save_failed
        echo '{"success":true}'
        exit 0
    fi

    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

cgi_error "method_not_allowed" "Only GET and POST are supported"
