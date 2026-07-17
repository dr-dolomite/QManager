#!/bin/sh
# =============================================================================
# config_backup_sections.sh — Config Backup Section Library
# =============================================================================
# Sourced by collect.sh (CGI) and qmanager_config_restore (worker).
# Exposes collect_<section> and apply_<section> function pairs plus a
# dispatch table listing the canonical section key order.
#
# Contract:
#   collect_<section>    → echoes a JSON fragment to stdout; exits non-zero on failure
#   apply_<section>      → reads a JSON fragment from stdin; exits:
#                            0  = success
#                            1  = generic failure (retryable)
#                            2  = unsupported on this modem (skip, no retry)
#
# Public functions:
#   cfg_backup_is_known_section <key>  → returns 0 if key is valid
#   cfg_backup_collect <key>           → echoes the section's JSON to stdout
#   cfg_backup_apply <key>             → reads section JSON from stdin and applies
#
# Install location: /usr/lib/qmanager/config_backup_sections.sh
# =============================================================================

[ -n "$_CFG_BACKUP_SECTIONS_LOADED" ] && return 0
_CFG_BACKUP_SECTIONS_LOADED=1

# --- Logging ---
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
}

# --- Canonical apply order (safe first, IMEI/profiles last) ---
# alert_routing sits with sms_alerts (both are trivial, safe JSON writes) so the
# two alert-config sections restore together, ahead of the risky AT/IMEI work.
CFG_BACKUP_APPLY_ORDER="sms_alerts alert_routing watchdog network_mode_apn bands tower_lock ttl_hl imei profiles"

# --- Known section keys (used for validation) ---
CFG_BACKUP_KNOWN_SECTIONS="$CFG_BACKUP_APPLY_ORDER"

cfg_backup_is_known_section() {
    case " $CFG_BACKUP_KNOWN_SECTIONS " in
        *" $1 "*) return 0 ;;
        *) return 1 ;;
    esac
}

# --- Dispatcher: collect by key ---
cfg_backup_collect() {
    local key="$1"
    case "$key" in
        sms_alerts)       collect_sms_alerts ;;
        alert_routing)    collect_alert_routing ;;
        watchdog)         collect_watchdog ;;
        network_mode_apn) collect_network_mode_apn ;;
        bands)            collect_bands ;;
        tower_lock)       collect_tower_lock ;;
        ttl_hl)           collect_ttl_hl ;;
        imei)             collect_imei ;;
        profiles)         collect_profiles ;;
        *)                qlog_error "Unknown section: $key"; return 1 ;;
    esac
}

# --- Dispatcher: apply by key (reads stdin) ---
cfg_backup_apply() {
    local key="$1"
    case "$key" in
        sms_alerts)       apply_sms_alerts ;;
        alert_routing)    apply_alert_routing ;;
        watchdog)         apply_watchdog ;;
        network_mode_apn) apply_network_mode_apn ;;
        bands)            apply_bands ;;
        tower_lock)       apply_tower_lock ;;
        ttl_hl)           apply_ttl_hl ;;
        imei)             apply_imei ;;
        profiles)         apply_profiles ;;
        *)                qlog_error "Unknown section: $key"; return 1 ;;
    esac
}

# --- Per-section implementations follow below ---
# Each is a collect_<key>/apply_<key> pair. Keep them grouped.

# =============================================================================
# SMS Alerts — /etc/qmanager/sms_alerts.json + /tmp/qmanager_sms_reload flag
# =============================================================================
collect_sms_alerts() {
    local cfg="/etc/qmanager/sms_alerts.json"
    if [ ! -f "$cfg" ]; then
        echo '{"enabled":false,"recipient_phone":"","threshold_minutes":5}'
        return 0
    fi
    jq -c '{enabled: (.enabled // false),
            recipient_phone: (.recipient_phone // ""),
            threshold_minutes: (.threshold_minutes // 5)}' "$cfg"
}

apply_sms_alerts() {
    local cfg="/etc/qmanager/sms_alerts.json"
    local input
    input=$(cat)
    # Validate structure
    echo "$input" | jq -e 'has("enabled") and has("recipient_phone") and has("threshold_minutes")' >/dev/null 2>&1 || {
        qlog_error "apply_sms_alerts: invalid input"
        return 1
    }
    # Atomic write
    mkdir -p /etc/qmanager
    local tmp="${cfg}.tmp.$$"
    echo "$input" | jq '.' > "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$cfg" || return 1
    # Signal poller to reload
    touch /tmp/qmanager_sms_reload
    return 0
}

# =============================================================================
# Alert Routing — /etc/qmanager/alert_routing.json + reload flag
# =============================================================================
# Additive section. The on-disk shapes of sms_alerts.json / email_alerts.json
# are untouched; only the routing matrix is backed up here. Booleans use the
# null-safe "if . == null" form, never `//`, so a genuine `false` survives.
collect_alert_routing() {
    local cfg="/etc/qmanager/alert_routing.json"
    if [ ! -f "$cfg" ]; then
        # No file → emit the canonical default so restore is deterministic.
        echo '{"version":1,"events":{"connection_lost":{"sms":true,"email":false},"connection_restored":{"sms":true,"email":true}}}'
        return 0
    fi
    jq -c '{version: (.version // 1),
            events: {
                connection_lost: {
                    sms:   (if (.events.connection_lost.sms) == null then true else (.events.connection_lost.sms) end),
                    email: false
                },
                connection_restored: {
                    sms:   (if (.events.connection_restored.sms) == null then true else (.events.connection_restored.sms) end),
                    email: (if (.events.connection_restored.email) == null then true else (.events.connection_restored.email) end)
                }
            }}' "$cfg"
}

apply_alert_routing() {
    local cfg="/etc/qmanager/alert_routing.json"
    local input
    input=$(cat)
    # Validate structure (events object present)
    echo "$input" | jq -e '.events' >/dev/null 2>&1 || {
        qlog_error "apply_alert_routing: invalid input"
        return 1
    }
    mkdir -p /etc/qmanager
    local tmp="${cfg}.tmp.$$"
    # Re-clamp connection_lost.email to false (server is authoritative — email
    # can never deliver during an outage regardless of what the backup holds).
    echo "$input" | jq '.events.connection_lost.email = false' > "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$cfg" || return 1
    # Signal the running poller to reload routing next cycle
    touch /tmp/qmanager_alert_routing_reload
    return 0
}

# =============================================================================
# Watchdog / Watchcat — UCI quecmanager.watchcat.*
# =============================================================================
_WATCHCAT_KEYS="enabled max_failures check_interval cooldown tier1_enabled tier2_enabled tier3_enabled tier4_enabled backup_sim_slot max_reboots_per_hour"

collect_watchdog() {
    local out="{"
    local sep=""
    local k v
    for k in $_WATCHCAT_KEYS; do
        v=$(uci -q get "quecmanager.watchcat.$k")
        # Encode as string (type handling happens on apply)
        out="${out}${sep}\"${k}\":$(echo "$v" | jq -R '.')"
        sep=","
    done
    out="${out}}"
    echo "$out"
}

apply_watchdog() {
    local input k v
    input=$(cat)
    # Ensure section exists
    uci -q get quecmanager.watchcat >/dev/null 2>&1 || {
        uci set quecmanager.watchcat=watchcat
    }
    for k in $_WATCHCAT_KEYS; do
        v=$(echo "$input" | jq -r --arg k "$k" '.[$k] // empty')
        # Empty string is a valid value for backup_sim_slot
        if [ "$k" = "backup_sim_slot" ] || [ -n "$v" ]; then
            uci set "quecmanager.watchcat.${k}=${v}"
        fi
    done
    uci commit quecmanager || return 1
    touch /tmp/qmanager_watchcat_reload

    local enabled
    enabled=$(uci -q get quecmanager.watchcat.enabled)
    if [ "$enabled" = "1" ]; then
        rm -f /tmp/qmanager_watchcat_disabled
        /etc/init.d/qmanager_watchcat enable >/dev/null 2>&1
        ( /etc/init.d/qmanager_watchcat restart >/dev/null 2>&1 & )
    else
        ( /etc/init.d/qmanager_watchcat stop >/dev/null 2>&1 & )
        /etc/init.d/qmanager_watchcat disable >/dev/null 2>&1
    fi
    return 0
}

# =============================================================================
# Network Mode + APN — AT commands via qcmd
# =============================================================================
collect_network_mode_apn() {
    local resp
    # Compound read: nr5g_disable_mode, roam_pref, mode_pref, APN contexts
    resp=$(qcmd 'AT+QNWPREFCFG="nr5g_disable_mode";+QNWPREFCFG="roam_pref";+QNWPREFCFG="mode_pref";+CGDCONT?') || return 1

    local nr5g_dis roam mode
    nr5g_dis=$(echo "$resp" | awk -F',' '/nr5g_disable_mode/ {gsub(/[[:space:]"]/,"",$2); print $2; exit}')
    roam=$(echo "$resp"     | awk -F',' '/roam_pref/         {gsub(/[[:space:]"]/,"",$2); print $2; exit}')
    mode=$(echo "$resp"     | awk -F',' '/mode_pref/         {gsub(/[[:space:]"]/,"",$2); print $2; exit}')

    # Parse all +CGDCONT lines → JSON array
    local contexts
    contexts=$(echo "$resp" | awk '
        /\+CGDCONT:/ {
            gsub(/\+CGDCONT: */, "", $0);
            n = split($0, a, ",");
            cid = a[1]; gsub(/"/, "", cid);
            pdp = a[2]; gsub(/"/, "", pdp);
            apn = a[3]; gsub(/"/, "", apn);
            printf "%s{\"cid\":%s,\"pdp_type\":\"%s\",\"apn\":\"%s\"}", (first==""?"":","), cid, pdp, apn;
            first="done";
        }
        END { }
    ')
    contexts="[${contexts}]"

    jq -n \
      --arg nr "$nr5g_dis" --arg ro "$roam" --arg md "$mode" \
      --argjson ctx "$contexts" \
      '{nr5g_disable_mode: ($nr|tonumber? // 0),
        roam_pref: ($ro|tonumber? // 1),
        mode_pref: $md,
        contexts: $ctx}'
}

apply_network_mode_apn() {
    local input
    input=$(cat)

    local nr5g_dis roam mode
    nr5g_dis=$(echo "$input" | jq -r '.nr5g_disable_mode // empty')
    roam=$(echo "$input"     | jq -r '.roam_pref // empty')
    mode=$(echo "$input"     | jq -r '.mode_pref // empty')

    # Order: nr5g_disable → roam → mode_pref → APN contexts
    if [ -n "$nr5g_dis" ]; then
        qcmd "AT+QNWPREFCFG=\"nr5g_disable_mode\",${nr5g_dis}" >/dev/null || return 1
        sleep 1
    fi
    if [ -n "$roam" ]; then
        qcmd "AT+QNWPREFCFG=\"roam_pref\",${roam}" >/dev/null || return 1
        sleep 1
    fi
    if [ -n "$mode" ] && [ "$mode" != "null" ]; then
        qcmd "AT+QNWPREFCFG=\"mode_pref\",${mode}" >/dev/null || return 1
        sleep 1
    fi

    # Apply each APN context
    local count i cid pdp apn
    count=$(echo "$input" | jq '.contexts | length')
    i=0
    while [ "$i" -lt "$count" ]; do
        cid=$(echo "$input" | jq -r ".contexts[$i].cid")
        pdp=$(echo "$input" | jq -r ".contexts[$i].pdp_type")
        apn=$(echo "$input" | jq -r ".contexts[$i].apn")
        qcmd "AT+CGDCONT=${cid},\"${pdp}\",\"${apn}\"" >/dev/null || return 1
        sleep 1
        i=$((i+1))
    done

    # If any APN was written, cycle the PS attach so the live session
    # re-negotiates with the new context — matches cellular/apn.sh and
    # qmanager_profile_apply::apply_apn. One cycle total, not per-context.
    if [ "$count" -gt 0 ]; then
        qlog_info "apply_network_mode_apn: detaching for APN reattach"
        qcmd 'AT+COPS=2' >/dev/null 2>&1 || qlog_warn "apply_network_mode_apn: AT+COPS=2 failed"
        sleep 2
        qlog_info "apply_network_mode_apn: reattaching"
        qcmd 'AT+COPS=0' >/dev/null 2>&1 || qlog_warn "apply_network_mode_apn: AT+COPS=0 reattach failed"
        sleep 2
    fi

    return 0
}

# =============================================================================
# LTE/5G Bands — AT+QNWPREFCFG lte_band, nsa_nr5g_band, nr5g_band
# NR-DC (nrdc_nr5g_band) is intentionally excluded: the modem manages it and
# coerces manual writes, so it is neither backed up nor restored.
# =============================================================================
collect_bands() {
    local resp
    resp=$(qcmd 'AT+QNWPREFCFG="ue_capability_band"') || return 1
    # Each line: +QNWPREFCFG: "lte_band",1:3:7:28   (colon-delimited numeric list)
    # The "nr5g_band" match excludes nsa_/nrdc_ lines (substring-match hazard).
    local lte
    local nsa
    local sa
    lte=$(echo "$resp" | awk -F',' '/"lte_band"/         {print $2; exit}')
    nsa=$(echo "$resp" | awk -F',' '/"nsa_nr5g_band"/    {print $2; exit}')
    sa=$(echo  "$resp" | awk -F',' '/"nr5g_band"/ && !/nsa_/ && !/nrdc_/ {print $2; exit}')

    # failover flag
    local failover
    failover=$(cat /etc/qmanager/band_failover_enabled 2>/dev/null || echo "0")

    jq -n --arg l "$lte" --arg n "$nsa" --arg s "$sa" --arg f "$failover" \
        '{lte_bands: $l, nsa_bands: $n, sa_bands: $s, failover_enabled: ($f == "1")}'
}

apply_bands() {
    local input
    local lte
    local nsa
    local sa
    local failover
    input=$(cat)
    lte=$(echo "$input"       | jq -r '.lte_bands // empty')
    nsa=$(echo "$input"       | jq -r '.nsa_bands // empty')
    sa=$(echo "$input"        | jq -r '.sa_bands  // empty')
    failover=$(echo "$input"  | jq -r 'if .failover_enabled == null then "false" else (.failover_enabled | tostring) end')

    # Kill any running band failover watcher before re-locking
    if [ -f /tmp/qmanager_band_failover.pid ]; then
        local old_bf_pid
        old_bf_pid=$(cat /tmp/qmanager_band_failover.pid 2>/dev/null | tr -d ' \n\r')
        [ -n "$old_bf_pid" ] && kill "$old_bf_pid" 2>/dev/null
        rm -f /tmp/qmanager_band_failover.pid /tmp/qmanager_band_failover
    fi

    [ -n "$lte" ] && { qcmd "AT+QNWPREFCFG=\"lte_band\",${lte}"        >/dev/null || return 1; sleep 1; }
    [ -n "$nsa" ] && { qcmd "AT+QNWPREFCFG=\"nsa_nr5g_band\",${nsa}"   >/dev/null || return 1; sleep 1; }
    [ -n "$sa"  ] && { qcmd "AT+QNWPREFCFG=\"nr5g_band\",${sa}"        >/dev/null || return 1; sleep 1; }

    # Restore failover flag + respawn watcher if enabled
    mkdir -p /etc/qmanager
    if [ "$failover" = "true" ]; then
        echo "1" > /etc/qmanager/band_failover_enabled
        ( /usr/bin/qmanager_band_failover </dev/null >/dev/null 2>&1 & )
    else
        rm -f /etc/qmanager/band_failover_enabled
    fi
    return 0
}

# =============================================================================
# Tower Locking — /etc/qmanager/tower_lock.json + AT+QNWLOCK apply
# =============================================================================
collect_tower_lock() {
    local cfg="/etc/qmanager/tower_lock.json"
    if [ ! -f "$cfg" ]; then
        echo '{"lte":{"cells":[]},"nr_sa":{"cells":[]},"failover":{"enabled":false}}'
        return 0
    fi
    # Keep only the persistent structure — drop any runtime fields; filter nulls
    jq -c '{lte: {cells: [(.lte.cells // [])[] | select(. != null)]},
            nr_sa: {cells: [(.nr_sa.cells // [])[] | select(. != null)]},
            failover: {enabled: (.failover.enabled // false)}}' "$cfg"
}

apply_tower_lock() {
    local input lte_n i earfcn pci nr_cell
    input=$(cat)

    # Kill failover watcher first to prevent false no-signal detection
    /etc/init.d/qmanager_tower_failover stop >/dev/null 2>&1

    # --- Apply LTE cells (filter null slots) ---
    local non_null_lte
    non_null_lte=$(echo "$input" | jq -c '[.lte.cells[]? | select(. != null)]')
    lte_n=$(echo "$non_null_lte" | jq 'length')
    if [ "$lte_n" = "0" ]; then
        qcmd 'AT+QNWLOCK="common/4g",0' >/dev/null || return 1
    else
        local cmd="AT+QNWLOCK=\"common/4g\",${lte_n}"
        i=0
        while [ "$i" -lt "$lte_n" ] && [ "$i" -lt 3 ]; do
            earfcn=$(echo "$non_null_lte" | jq -r ".[$i].earfcn")
            pci=$(echo "$non_null_lte"    | jq -r ".[$i].pci")
            cmd="${cmd},${earfcn},${pci}"
            i=$((i+1))
        done
        qcmd "$cmd" >/dev/null || return 1
    fi
    sleep 2

    # --- Apply NR-SA cell ---
    nr_cell=$(echo "$input" | jq -c '.nr_sa.cells[0] // null')
    if [ "$nr_cell" = "null" ]; then
        qcmd 'AT+QNWLOCK="common/5g",0' >/dev/null || return 1
    else
        local pci arfcn scs band
        pci=$(echo "$nr_cell"   | jq -r '.pci')
        arfcn=$(echo "$nr_cell" | jq -r '.arfcn')
        scs=$(echo "$nr_cell"   | jq -r '.scs')
        band=$(echo "$nr_cell"  | jq -r '.band')
        qcmd "AT+QNWLOCK=\"common/5g\",${pci},${arfcn},${scs},${band}" >/dev/null || return 1
    fi
    sleep 2

    # --- MTU reapply + config file update ---
    if command -v mtu_reapply_after_bounce >/dev/null 2>&1; then
        mtu_reapply_after_bounce
    fi

    # Persist config file so tower page reflects the restored state
    mkdir -p /etc/qmanager
    local tmp="/etc/qmanager/tower_lock.json.tmp.$$"
    echo "$input" | jq '.' > "$tmp" && mv "$tmp" /etc/qmanager/tower_lock.json

    # Restart failover watcher if enabled
    local fo
    fo=$(echo "$input" | jq -r '.failover.enabled')
    if [ "$fo" = "true" ]; then
        /etc/init.d/qmanager_tower_failover enable >/dev/null 2>&1
        ( /etc/init.d/qmanager_tower_failover start >/dev/null 2>&1 & )
    fi
    return 0
}

# =============================================================================
# TTL/HL — parses /etc/firewall.user.ttl for current values; rewrites same file
# =============================================================================
collect_ttl_hl() {
    local file="/etc/firewall.user.ttl"
    local ttl=0 hl=0
    if [ -f "$file" ]; then
        ttl=$(awk '/ttl-set/ {for(i=1;i<=NF;i++) if($i=="--ttl-set") {print $(i+1); exit}}' "$file")
        hl=$(awk '/hl-set/  {for(i=1;i<=NF;i++) if($i=="--hl-set")  {print $(i+1); exit}}' "$file")
        [ -z "$ttl" ] && ttl=0
        [ -z "$hl" ] && hl=0
    fi
    local autostart=0
    if /etc/init.d/qmanager_ttl enabled 2>/dev/null; then autostart=1; fi
    jq -n --arg t "$ttl" --arg h "$hl" --arg a "$autostart" \
        '{ttl: ($t|tonumber), hl: ($h|tonumber), autostart: ($a == "1")}'
}

apply_ttl_hl() {
    local input ttl hl autostart file tmp cur_ttl cur_hl
    input=$(cat)
    ttl=$(echo "$input" | jq -r '.ttl // 0')
    hl=$(echo "$input"  | jq -r '.hl // 0')
    autostart=$(echo "$input" | jq -r '.autostart // false')

    file="/etc/firewall.user.ttl"
    tmp="${file}.tmp.$$"

    # Read current values (so we can delete only the matching rules, not the whole chain)
    cur_ttl=0
    cur_hl=0
    if [ -f "$file" ]; then
        cur_ttl=$(awk '/ttl-set/ {for(i=1;i<=NF;i++) if($i=="--ttl-set") {print $(i+1); exit}}' "$file")
        cur_hl=$(awk '/hl-set/  {for(i=1;i<=NF;i++) if($i=="--hl-set")  {print $(i+1); exit}}' "$file")
        [ -z "$cur_ttl" ] && cur_ttl=0
        [ -z "$cur_hl" ] && cur_hl=0
    fi

    # Delete only the existing TTL/HL rules (not the entire chain)
    if [ "$cur_ttl" -gt 0 ] 2>/dev/null; then
        iptables -t mangle -D POSTROUTING -o rmnet+ -j TTL --ttl-set "$cur_ttl" 2>/dev/null
    fi
    if [ "$cur_hl" -gt 0 ] 2>/dev/null; then
        ip6tables -t mangle -D POSTROUTING -o rmnet+ -j HL --hl-set "$cur_hl" 2>/dev/null
    fi

    : > "$tmp"
    if [ "$ttl" -gt 0 ] 2>/dev/null; then
        iptables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set "$ttl" || { rm -f "$tmp"; return 1; }
        echo "iptables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set $ttl" >> "$tmp"
    fi
    if [ "$hl" -gt 0 ] 2>/dev/null; then
        ip6tables -t mangle -A POSTROUTING -o rmnet+ -j HL --hl-set "$hl" || { rm -f "$tmp"; return 1; }
        echo "ip6tables -t mangle -A POSTROUTING -o rmnet+ -j HL --hl-set $hl" >> "$tmp"
    fi
    mv "$tmp" "$file" || return 1

    if [ "$autostart" = "true" ]; then
        /etc/init.d/qmanager_ttl enable >/dev/null 2>&1
    else
        /etc/init.d/qmanager_ttl disable >/dev/null 2>&1
    fi
    return 0
}

# =============================================================================
# IMEI — AT+CGSN read, AT+EGMR write (triggers modem reboot)
# =============================================================================
collect_imei() {
    local imei status_file="/tmp/qmanager_status.json"
    if [ -f "$status_file" ]; then
        imei=$(jq -r '.device.imei // empty' "$status_file")
    fi
    if [ -z "$imei" ]; then
        local resp
        resp=$(qcmd 'AT+CGSN') || return 1
        imei=$(echo "$resp" | awk 'NR==2 {gsub(/[^0-9]/,""); print}')
    fi

    # Also include backup-imei config if present
    local bk="/etc/qmanager/imei_backup.json"
    if [ -f "$bk" ]; then
        jq --arg i "$imei" '{current_imei: $i, backup: .}' "$bk"
    else
        jq -n --arg i "$imei" '{current_imei: $i, backup: {enabled: false, imei: ""}}'
    fi
}

apply_imei() {
    local input new_imei current
    input=$(cat)
    new_imei=$(echo "$input" | jq -r '.current_imei // empty')

    # Validate: exactly 15 digits
    case "$new_imei" in
        ''|*[!0-9]*) qlog_warn "apply_imei: invalid IMEI format"; return 1 ;;
    esac
    [ "${#new_imei}" = "15" ] || { qlog_warn "apply_imei: wrong length"; return 1; }

    # Skip write if already matches live IMEI (avoids unnecessary NVM write)
    current=$(jq -r '.device.imei // empty' /tmp/qmanager_status.json 2>/dev/null)
    if [ "$current" = "$new_imei" ]; then
        qlog_info "apply_imei: IMEI already matches, skipping"
    else
        qcmd "AT+EGMR=1,7,\"${new_imei}\"" >/dev/null || return 1
        # IMEI is written to NVM but does NOT take effect until the modem
        # reboots. We deliberately do NOT call AT+CFUN=1,1 here — QManager
        # runs on the modem itself, so the reboot would kill our CGI
        # mid-restore. The worker collects this hint and surfaces a
        # "Reboot required" dialog to the user after restore completes.
        touch /tmp/qmanager_config_restore.reboot_required
        qlog_info "apply_imei: IMEI written (reboot required to apply)"
    fi

    # Restore imei_backup.json if present
    local bk_enabled bk_imei
    bk_enabled=$(echo "$input" | jq -r '.backup.enabled // false')
    bk_imei=$(echo "$input"    | jq -r '.backup.imei // ""')
    if [ -n "$bk_imei" ] || [ "$bk_enabled" = "true" ]; then
        mkdir -p /etc/qmanager
        jq -n --argjson e "$bk_enabled" --arg i "$bk_imei" \
            '{enabled: $e, imei: $i}' > /etc/qmanager/imei_backup.json
    fi
    return 0
}

# =============================================================================
# Custom SIM Profiles — /etc/qmanager/profiles/*.json + /etc/qmanager/active_profile
# =============================================================================
collect_profiles() {
    local dir="/etc/qmanager/profiles" active_file="/etc/qmanager/active_profile"
    local active_id="" profiles_array="[]"

    if [ -d "$dir" ]; then
        # Build array of all profile objects
        profiles_array="["
        local sep="" f
        for f in "$dir"/p_*.json; do
            [ -f "$f" ] || continue
            profiles_array="${profiles_array}${sep}$(cat "$f")"
            sep=","
        done
        profiles_array="${profiles_array}]"
    fi

    if [ -f "$active_file" ]; then
        active_id=$(cat "$active_file")
    fi

    jq -n \
        --argjson p "$profiles_array" \
        --arg a "$active_id" \
        '{profiles: $p, active_profile_id: $a}'
}

apply_profiles() {
    local input
    input=$(cat)

    local dir="/etc/qmanager/profiles"
    mkdir -p "$dir"

    # Write each profile file
    local n i id payload
    n=$(echo "$input" | jq '.profiles | length')
    i=0
    while [ "$i" -lt "$n" ]; do
        id=$(echo "$input" | jq -r ".profiles[$i].id")
        # Sanitize: only allow p_<digits>_<hex>
        case "$id" in
            p_[0-9]*_[0-9a-f]*) ;;
            *) qlog_warn "apply_profiles: invalid id $id, skipping"; i=$((i+1)); continue ;;
        esac
        case "$id" in
            */*|*..*|*\\*) qlog_warn "apply_profiles: id has path chars, skipping"; i=$((i+1)); continue ;;
        esac
        payload=$(echo "$input" | jq -c ".profiles[$i]")
        echo "$payload" > "${dir}/${id}.json" || return 1
        i=$((i+1))
    done

    # Handle active profile activation
    local wanted_id
    wanted_id=$(echo "$input" | jq -r '.active_profile_id // empty')
    if [ -z "$wanted_id" ]; then
        qlog_info "apply_profiles: no active profile in backup"
        return 0
    fi

    case "$wanted_id" in
        p_[0-9]*_[0-9a-f]*) ;;
        *) qlog_warn "apply_profiles: invalid active_profile_id, skipping activation"; return 0 ;;
    esac
    case "$wanted_id" in
        */*|*..*|*\\*) qlog_warn "apply_profiles: active_profile_id has path chars, skipping"; return 0 ;;
    esac

    # Check SIM ICCID match
    local profile_iccid current_iccid
    profile_iccid=$(jq -r '.sim_iccid // empty' "${dir}/${wanted_id}.json" 2>/dev/null)
    current_iccid=$(jq -r '.device.iccid // empty' /tmp/qmanager_status.json 2>/dev/null)

    if [ -n "$profile_iccid" ] && [ -n "$current_iccid" ] && [ "$profile_iccid" != "$current_iccid" ]; then
        qlog_warn "apply_profiles: SIM ICCID mismatch ($profile_iccid vs $current_iccid), skipping activation"
        # Signal sim mismatch via specific exit code that the worker translates
        return 3
    fi

    # Write the active marker only — do NOT spawn qmanager_profile_apply.
    # QManager runs on the modem itself, so we cannot afford a CFUN=1,1
    # reboot mid-restore. On the next user-initiated reboot, the boot-time
    # auto_apply_profile (via qmanager_poller::collect_boot_data) will pick
    # up the active marker and run the full APN -> TTL/HL -> IMEI pipeline
    # naturally. The worker collects the reboot-required hint here so the
    # frontend can prompt the user.
    echo "$wanted_id" > /etc/qmanager/active_profile
    touch /tmp/qmanager_config_restore.reboot_required
    qlog_info "apply_profiles: active marker written for $wanted_id (reboot required to apply)"
    return 0
}
