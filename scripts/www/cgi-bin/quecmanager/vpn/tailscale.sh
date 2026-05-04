#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# tailscale.sh — CGI Endpoint: Tailscale VPN Management (GET + POST)
# =============================================================================
# GET:  Returns installation status, daemon state, connection info, and peers.
# POST: Connect/disconnect, start/stop daemon, enable/disable on boot, logout.
#
# Tailscale manages its own config in /etc/tailscale/ — we are a thin
# control layer, not a service owner. No UCI config needed.
#
# Data sources:
#   tailscale status --json   -> connection state, self info, peers, DNS
#   tailscale version         -> installed version
#   /etc/init.d/tailscale     -> daemon control (start/stop/enable/disable)
#
# POST body: { "action": "connect"|"disconnect"|"logout"|"start_service"|
#                         "stop_service"|"set_boot_enabled" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
# Install location: /www/cgi-bin/quecmanager/vpn/tailscale.sh
# =============================================================================

qlog_init "cgi_tailscale"
cgi_headers
cgi_handle_options

AUTH_URL_FILE="/tmp/qmanager_tailscale_auth_url"
TS_UP_OUTPUT="/tmp/qmanager_tailscale_up_output"
TS_UP_PID_FILE="/tmp/qmanager_tailscale_up_pid"

# --- Helper: check if tailscale + tailscaled are installed -------------------
is_installed() {
    command -v tailscale >/dev/null 2>&1 && command -v tailscaled >/dev/null 2>&1
}

# --- Helper: check if tailscaled daemon is running ---------------------------
is_daemon_running() {
    if [ -x /etc/init.d/tailscale ]; then
        /etc/init.d/tailscale running >/dev/null 2>&1
    else
        pidof tailscaled >/dev/null 2>&1
    fi
}

# --- Helper: check if tailscale is enabled on boot --------------------------
# luci-app-tailscale-community-tiny stores its enabled flag at
# tailscale.settings.service_enabled (see /etc/config/tailscale shipped
# by the package). Fall back to the init.d enabled check if the UCI
# section is absent for any reason.
get_boot_enabled() {
    local uci_enabled
    uci_enabled=$(uci -q get tailscale.settings.service_enabled 2>/dev/null)
    if [ -n "$uci_enabled" ]; then
        [ "$uci_enabled" = "1" ] && echo "true" || echo "false"
        return
    fi
    if [ -x /etc/init.d/tailscale ]; then
        /etc/init.d/tailscale enabled && echo "true" || echo "false"
    else
        echo "false"
    fi
}

# --- Helper: kill stale tailscale up process from previous connect attempt ---
kill_stale_ts_up() {
    if [ -f "$TS_UP_PID_FILE" ]; then
        old_pid=$(cat "$TS_UP_PID_FILE" 2>/dev/null | tr -d ' \n\r')
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null
        fi
        rm -f "$TS_UP_PID_FILE"
    fi
}

# --- Helper: refuse to mutate while install.sh migration is in-flight -------
check_migration_lock() {
    if [ -f /var/lock/qmanager_tailscale_migrate.lock ]; then
        cgi_error "migration_in_progress" "Tailscale package migration is in progress — try again in a moment"
        exit 0
    fi
}

# --- Helper: get tailscale version string ------------------------------------
get_ts_version() {
    tailscale version 2>/dev/null | head -1 | awk '{print $1}'
}

# --- Force Tailscale Fixes gate ---------------------------------------------
# Opt-in toggle owned by /cgi-bin/quecmanager/system/settings.sh + the
# qmanager_vpn_zone init.d boot self-heal. When enabled, this CGI re-acquires
# the historical fw4 zone + mwan3 ipset workarounds for tailscale0:
#   - install success: vpn_fw_ensure_zone "tailscale" "tailscale0"
#   - uninstall success: background vpn_fw_remove_zone "tailscale"
# Process-lifecycle fixes (orphan double-fork, --accept-dns=false,
# --accept-routes ban, migration lock) are unconditional and not gated here.
if [ "$(uci -q get quecmanager.tailscale_workarounds.enabled 2>/dev/null)" = "1" ]; then
    . /usr/lib/qmanager/vpn_firewall.sh
    _TS_WORKAROUNDS=1
else
    _TS_WORKAROUNDS=0
fi

# =============================================================================
# GET — Fetch installation status, daemon state, connection info, peers
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then

    if command -v netbird >/dev/null 2>&1; then
        other_vpn_installed="true"
    else
        other_vpn_installed="false"
    fi

    # --- Tier 1: Not installed -----------------------------------------------
    if ! is_installed; then
        qlog_info "Tailscale not installed"
        jq -n \
            --argjson other_vpn_installed "$other_vpn_installed" \
            '{
                success: true,
                installed: false,
                install_hint: "opkg update && opkg install luci-app-tailscale-community-tiny",
                other_vpn_installed: $other_vpn_installed,
                other_vpn_name: "NetBird"
            }'
        exit 0
    fi

    ts_version=$(get_ts_version)
    boot_enabled=$(get_boot_enabled)

    # --- Tier 2: Installed but daemon not running ----------------------------
    if ! is_daemon_running; then
        qlog_info "Tailscale installed but daemon not running"
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            --argjson other_vpn_installed "$other_vpn_installed" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version,
                other_vpn_installed: $other_vpn_installed,
                other_vpn_name: "NetBird"
            }'
        exit 0
    fi

    # --- Tier 3: Daemon running — fetch full status --------------------------
    qlog_info "Fetching tailscale status"

    # Use timeout if available to prevent hangs
    if command -v timeout >/dev/null 2>&1; then
        status_json=$(timeout 5 tailscale status --json 2>/dev/null)
    else
        status_json=$(tailscale status --json 2>/dev/null)
    fi

    if [ -z "$status_json" ] || ! printf '%s' "$status_json" | jq -e . >/dev/null 2>&1; then
        qlog_error "Failed to get tailscale status JSON"
        jq -n \
            --argjson installed true \
            --argjson daemon_running true \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version,
                backend_state: "Unknown",
                error_detail: "Could not retrieve status from tailscale daemon"
            }'
        exit 0
    fi

    # Extract backend state
    backend_state=$(printf '%s' "$status_json" | jq -r '.BackendState // "Unknown"')

    # Extract auth URL (from status JSON or persisted file)
    auth_url=$(printf '%s' "$status_json" | jq -r '.AuthURL // ""')
    if [ -z "$auth_url" ] && [ -f "$AUTH_URL_FILE" ]; then
        auth_url=$(cat "$AUTH_URL_FILE" 2>/dev/null)
    fi
    # Clear persisted auth URL if we're now running
    if [ "$backend_state" = "Running" ] && [ -f "$AUTH_URL_FILE" ]; then
        rm -f "$AUTH_URL_FILE"
        auth_url=""
    fi

    # Build self object from .Self
    self_json=$(printf '%s' "$status_json" | jq '{
        hostname: (.Self.HostName // ""),
        dns_name: (.Self.DNSName // ""),
        tailscale_ips: [(.Self.TailscaleIPs // [])[] | tostring],
        online: (.Self.Online // false),
        os: (.Self.OS // ""),
        relay: (.Self.Relay // "")
    }' 2>/dev/null) || self_json='{}'

    # Build tailnet object from .CurrentTailnet
    tailnet_json=$(printf '%s' "$status_json" | jq '{
        name: (.CurrentTailnet.Name // ""),
        magic_dns_suffix: (.CurrentTailnet.MagicDNSSuffix // .MagicDNSSuffix // ""),
        magic_dns_enabled: (.CurrentTailnet.MagicDNSEnabled // false)
    }' 2>/dev/null) || tailnet_json='{}'

    # Build peers array from .Peer (map keyed by public key)
    peers_json=$(printf '%s' "$status_json" | jq '[
        (.Peer // {}) | to_entries[] | .value | {
            hostname: (.HostName // ""),
            dns_name: (.DNSName // ""),
            tailscale_ips: [(.TailscaleIPs // [])[] | tostring],
            os: (.OS // ""),
            online: (.Online // false),
            last_seen: (.LastSeen // ""),
            relay: (.Relay // ""),
            exit_node: (.ExitNode // false)
        }
    ]' 2>/dev/null) || peers_json='[]'

    # Extract health warnings
    health_json=$(printf '%s' "$status_json" | jq '.Health // []' 2>/dev/null) || health_json='[]'

    # Assemble full response
    jq -n \
        --argjson installed true \
        --argjson daemon_running true \
        --argjson enabled_on_boot "$boot_enabled" \
        --arg version "$ts_version" \
        --arg backend_state "$backend_state" \
        --arg auth_url "$auth_url" \
        --argjson self "$self_json" \
        --argjson tailnet "$tailnet_json" \
        --argjson peers "$peers_json" \
        --argjson health "$health_json" \
        --argjson other_vpn_installed "$other_vpn_installed" \
        '{
            success: true,
            installed: $installed,
            daemon_running: $daemon_running,
            enabled_on_boot: $enabled_on_boot,
            version: $version,
            backend_state: $backend_state,
            auth_url: $auth_url,
            self: $self,
            tailnet: $tailnet,
            peers: $peers,
            health: $health,
            other_vpn_installed: $other_vpn_installed,
            other_vpn_name: "NetBird"
        }'
    exit 0
fi

# =============================================================================
# POST — Actions: connect, disconnect, logout, start/stop service, boot toggle
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install — install tailscale via opkg (background)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install" ]; then
        check_migration_lock
        TS_INSTALL_RESULT="/tmp/qmanager_tailscale_install.json"
        TS_INSTALL_PID="/tmp/qmanager_tailscale_install.pid"

        # Mutual exclusion: refuse if other VPN is installed
        if command -v netbird >/dev/null 2>&1; then
            cgi_error "other_vpn_installed" "NetBird is already installed. Uninstall it before installing Tailscale."
            exit 0
        fi

        # Check if already running
        if [ -f "$TS_INSTALL_PID" ] && kill -0 "$(cat "$TS_INSTALL_PID" 2>/dev/null)" 2>/dev/null; then
            cgi_error "already_running" "Installation already in progress"
            exit 0
        fi

        # Already installed?
        if is_installed; then
            cgi_error "already_installed" "Tailscale is already installed"
            exit 0
        fi

        qlog_info "Starting Tailscale installation via opkg"

        # Spawn background installer
        (
            echo $$ > "$TS_INSTALL_PID"
            trap 'rm -f "$TS_INSTALL_PID"' EXIT

            printf '{"success":true,"status":"running","message":"Updating package lists..."}' > "$TS_INSTALL_RESULT"
            if ! opkg update >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"Failed to update package lists","detail":"Check internet connection and opkg feeds"}' > "$TS_INSTALL_RESULT"
                exit 1
            fi

            printf '{"success":true,"status":"running","message":"Installing tailscale..."}' > "$TS_INSTALL_RESULT"
            if ! opkg install luci-app-tailscale-community-tiny >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"opkg install failed","detail":"Package may not be available for this architecture"}' > "$TS_INSTALL_RESULT"
                exit 1
            fi

            # Verify
            if command -v tailscale >/dev/null 2>&1; then
                # If Force Tailscale Fixes is enabled, ensure the fw4 zone
                # for tailscale0 + mwan3 ipset entry exist now that the
                # binary is on disk. Already running in an orphaned
                # subshell so the fw4 restart inside vpn_fw_ensure_zone
                # cannot kill the parent CGI.
                if [ "$_TS_WORKAROUNDS" = "1" ]; then
                    vpn_fw_ensure_zone "tailscale" "tailscale0"
                fi
                printf '{"success":true,"status":"complete","message":"Tailscale installed successfully"}' > "$TS_INSTALL_RESULT"
            else
                printf '{"success":false,"status":"error","message":"Package installed but binary not found"}' > "$TS_INSTALL_RESULT"
            fi
        ) </dev/null >/dev/null 2>&1 &

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install_status — poll install progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        TS_INSTALL_RESULT="/tmp/qmanager_tailscale_install.json"
        if [ -f "$TS_INSTALL_RESULT" ]; then
            cat "$TS_INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # All remaining POST actions require tailscale to be installed
    if ! is_installed; then
        cgi_error "not_installed" "Tailscale is not installed"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: connect — start tailscale up, capture auth URL
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "connect" ]; then
        check_migration_lock
        qlog_info "Connecting to Tailscale"

        # Ensure daemon is running first
        if ! is_daemon_running; then
            if [ -x /etc/init.d/tailscale ]; then
                /etc/init.d/tailscale start >/dev/null 2>&1
            else
                tailscaled --state=/etc/tailscale/tailscaled.state >/dev/null 2>&1 &
            fi
            # Wait for daemon to be ready (up to 5 seconds)
            attempts=0
            while [ "$attempts" -lt 5 ]; do
                sleep 1
                is_daemon_running && break
                attempts=$((attempts + 1))
            done
            if ! is_daemon_running; then
                cgi_error "daemon_start_failed" "Could not start tailscale daemon"
                exit 0
            fi
        fi

        # Kill any stale tailscale up process from a previous attempt
        kill_stale_ts_up

        # Clean up old temp files
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT"

        # CRITICAL: NEVER use --accept-routes — it disconnects the device from
        # the network entirely and requires a physical reboot to recover.
        # Run tailscale up as a fully orphaned background job so it survives
        # this CGI exiting. The previous pattern — `( cmd ) &` without stdin
        # redirection — kept the process in the CGI's process group, so when
        # uhttpd closed the HTTP connection the child got SIGHUP/SIGPIPE'd.
        # That killed `tailscale up` before it could push the post-auth prefs
        # to tailscaled, and the admin console showed "registered but
        # disconnected" until the user stopped/started the service and
        # re-authenticated. The double-fork form below (inner `&`, </dev/null)
        # orphans tailscale up to init before the CGI returns.
        ( tailscale up --accept-dns=false --json </dev/null >"$TS_UP_OUTPUT" 2>&1 &
          echo $! > "$TS_UP_PID_FILE"
        )

        # Poll for auth URL or Running state (up to 10 seconds)
        attempts=0
        auth_url=""
        while [ "$attempts" -lt 10 ]; do
            sleep 1
            if [ -f "$TS_UP_OUTPUT" ] && [ -s "$TS_UP_OUTPUT" ]; then
                # Check if already authenticated (BackendState = Running)
                state=$(jq -r 'select(.BackendState == "Running") | .BackendState' "$TS_UP_OUTPUT" 2>/dev/null | head -1)
                if [ "$state" = "Running" ]; then
                    rm -f "$AUTH_URL_FILE" "$TS_UP_PID_FILE"
                    qlog_info "Tailscale already authenticated"
                    jq -n '{"success": true, "already_authenticated": true}'
                    exit 0
                fi
                # Look for auth URL in JSON stream
                auth_url=$(jq -r 'select(.AuthURL != null and .AuthURL != "") | .AuthURL' "$TS_UP_OUTPUT" 2>/dev/null | head -1)
                if [ -n "$auth_url" ]; then
                    printf '%s' "$auth_url" > "$AUTH_URL_FILE"
                    break
                fi
            fi
            attempts=$((attempts + 1))
        done

        if [ -n "$auth_url" ]; then
            qlog_info "Auth URL generated, waiting for user authentication"
            jq -n --arg auth_url "$auth_url" '{"success": true, "auth_url": $auth_url}'
        else
            qlog_error "Timed out waiting for auth URL"
            cgi_error "auth_timeout" "Timed out waiting for auth URL. Check if tailscaled is running."
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: disconnect — disconnect from tailnet (stay registered)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "disconnect" ]; then
        check_migration_lock
        qlog_info "Disconnecting Tailscale"
        result=$(tailscale down 2>&1)
        rc=$?
        if [ "$rc" -ne 0 ]; then
            qlog_error "tailscale down failed: $result"
            cgi_error "disconnect_failed" "Failed to disconnect: $result"
            exit 0
        fi
        rm -f "$AUTH_URL_FILE"
        qlog_info "Tailscale disconnected"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: logout — full deauthentication (removes device from tailnet)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "logout" ]; then
        check_migration_lock
        qlog_info "Logging out of Tailscale"
        kill_stale_ts_up
        result=$(tailscale logout 2>&1)
        rc=$?
        if [ "$rc" -ne 0 ]; then
            qlog_error "tailscale logout failed: $result"
            cgi_error "logout_failed" "Failed to logout: $result"
            exit 0
        fi
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT" "$TS_UP_PID_FILE"
        qlog_info "Tailscale logged out"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: start_service — start tailscaled daemon
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "start_service" ]; then
        check_migration_lock
        if is_daemon_running; then
            cgi_error "already_running" "Tailscale daemon is already running"
            exit 0
        fi
        qlog_info "Starting tailscale daemon"
        if [ -x /etc/init.d/tailscale ]; then
            /etc/init.d/tailscale start >/dev/null 2>&1
        else
            tailscaled --state=/etc/tailscale/tailscaled.state >/dev/null 2>&1 &
        fi
        sleep 1
        if is_daemon_running; then
            qlog_info "Tailscale daemon started"
            cgi_success
        else
            cgi_error "start_failed" "Failed to start tailscale daemon"
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: stop_service — stop tailscaled daemon
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "stop_service" ]; then
        check_migration_lock
        qlog_info "Stopping tailscale daemon"
        kill_stale_ts_up
        if [ -x /etc/init.d/tailscale ]; then
            /etc/init.d/tailscale stop >/dev/null 2>&1
        else
            killall tailscaled 2>/dev/null
        fi
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT" "$TS_UP_PID_FILE"
        qlog_info "Tailscale daemon stopped"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: set_boot_enabled — enable/disable tailscale on boot
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "set_boot_enabled" ]; then
        check_migration_lock
        boot_enabled=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -z "$boot_enabled" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi
        if [ ! -x /etc/init.d/tailscale ]; then
            cgi_error "no_init_script" "Tailscale init script not found"
            exit 0
        fi
        case "$boot_enabled" in
            true)
                # Toggle UCI flag (authoritative for luci-app-tailscale-community-tiny)
                if uci -q get tailscale.settings >/dev/null 2>&1; then
                    uci set tailscale.settings.service_enabled='1'
                    uci commit tailscale
                fi
                /etc/init.d/tailscale enable >/dev/null 2>&1
                qlog_info "Tailscale enabled on boot"
                ;;
            false)
                if uci -q get tailscale.settings >/dev/null 2>&1; then
                    uci set tailscale.settings.service_enabled='0'
                    uci commit tailscale
                fi
                /etc/init.d/tailscale disable >/dev/null 2>&1
                qlog_info "Tailscale disabled on boot"
                ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                exit 0
                ;;
        esac
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: uninstall — remove tailscale packages from the device
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "uninstall" ]; then
        check_migration_lock
        qlog_info "Uninstalling Tailscale packages"

        # Stop service if running.
        if is_daemon_running; then
            qlog_info "Stopping Tailscale daemon before uninstall"
            kill_stale_ts_up
            tailscale down >/dev/null 2>&1
            if [ -x /etc/init.d/tailscale ]; then
                /etc/init.d/tailscale stop >/dev/null 2>&1
            else
                killall tailscaled 2>/dev/null
            fi
            sleep 1
        fi

        # Disable boot entry if init script exists (covers both legacy and tiny).
        [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale disable >/dev/null 2>&1

        # Smart removal: enumerate which of the 6 known package names are
        # installed and remove only those. Handles pure-legacy, pure-tiny,
        # and any partial state.
        PKGS=$(opkg list-installed 2>/dev/null | awk '{print $1}' | grep -E \
            '^(tailscale|tailscaled|tailscale-tiny|luci-app-tailscale|luci-app-tailscale-community|luci-app-tailscale-community-tiny)$' \
            | tr '\n' ' ')
        if [ -n "$PKGS" ]; then
            qlog_info "Removing packages: $PKGS"
            opkg remove $PKGS >/dev/null 2>&1
        else
            qlog_info "No Tailscale packages found to remove"
        fi

        # Clean up state from BOTH legacy and tiny locations.
        rm -rf /var/lib/tailscale/ /etc/tailscale/
        rm -f /tmp/qmanager_tailscale_auth_url /tmp/qmanager_tailscale_up_output /tmp/qmanager_tailscale_up_pid

        # Verify removal (check actual binary paths, not command -v which can be cached).
        hash -r 2>/dev/null
        if [ -x /usr/sbin/tailscale ] || [ -x /usr/bin/tailscale ] || [ -x /usr/sbin/tailscaled ]; then
            qlog_error "Tailscale binary still present after opkg remove"
            cgi_error "uninstall_failed" "Failed to remove Tailscale packages"
            exit 0
        fi

        qlog_info "Tailscale uninstalled successfully"
        cgi_success

        # If Force Tailscale Fixes was enabled, remove the fw4 zone in
        # background AFTER the response is sent. vpn_fw_remove_zone runs
        # /etc/init.d/firewall restart which would kill the HTTP connection
        # if run synchronously (firewall-restart-kills-http rule). The
        # function preserves the mwan3 ipset entry when NetBird is still
        # installed, per the historical guard.
        if [ "$_TS_WORKAROUNDS" = "1" ]; then
            ( vpn_fw_remove_zone "tailscale" ) </dev/null >/dev/null 2>&1 &
        fi
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_method_not_allowed
