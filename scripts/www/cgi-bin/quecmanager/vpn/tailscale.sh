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

# --- Helper: detect how tailscale was installed ------------------------------
# "official" -> QManager static-tarball install (marker file present)
# "tiny"     -> tailscale-tiny opkg package (marker, or opkg detection)
# "opkg"     -> any other opkg-managed tailscale (legacy / luci tiny wrapper)
# The marker file is authoritative; opkg detection is the fallback for installs
# that predate the marker.
TS_INSTALL_MARKER="/etc/tailscale/.qm_install_method"
get_install_variant() {
    local marker
    if [ -f "$TS_INSTALL_MARKER" ]; then
        marker=$(cat "$TS_INSTALL_MARKER" 2>/dev/null | tr -d ' \n\r')
        case "$marker" in
            official) echo "official"; return ;;
            tiny)     echo "tiny"; return ;;
        esac
    fi
    if opkg list-installed 2>/dev/null | awk '{print $1}' | grep -qx 'tailscale-tiny'; then
        echo "tiny"
        return
    fi
    echo "opkg"
}

# --- Helper: write the procd init script for the official (tarball) install --
# The official tarball ships no init.d script, so we generate one. The existing
# CGI helpers (is_daemon_running / connect / start_service / stop_service /
# set_boot_enabled / uninstall) all branch on [ -x /etc/init.d/tailscale ], so
# writing this makes them all work unchanged.
#
# CRITICAL: this is heredoc-written, NOT shipped as a static
# scripts/etc/init.d/tailscale file — install.sh force-copies every init.d file
# on every (OTA) install, which would clobber the opkg-owned
# /etc/init.d/tailscale of a tiny install. Heredoc keeps the official init
# script confined to the official path only.
write_ts_initd() {
    cat > /etc/init.d/tailscale <<'INITD_EOF'
#!/bin/sh /etc/rc.common

START=99
STOP=10
USE_PROCD=1

# Match the state path the QManager CGI fallback uses (tailscale.sh connect /
# start_service). Installed by the QManager official-variant installer.
TS_STATE="/etc/tailscale/tailscaled.state"

start_service() {
    procd_open_instance
    procd_set_param command /usr/bin/tailscaled --state="$TS_STATE"
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}

stop_service() {
    /usr/bin/tailscale down 2>/dev/null
}
INITD_EOF
    chmod 755 /etc/init.d/tailscale
}

# --- Helper: seed the tailscale.settings UCI section -------------------------
# Defensive parity with the tiny package: get_boot_enabled / set_boot_enabled
# treat tailscale.settings.service_enabled as authoritative. Seed it (off by
# default) if absent. Idempotent.
seed_ts_uci_settings() {
    if ! uci -q get tailscale.settings >/dev/null 2>&1; then
        uci -q set tailscale=tailscale 2>/dev/null
        uci -q set tailscale.settings=settings 2>/dev/null
    fi
    uci -q get tailscale.settings.service_enabled >/dev/null 2>&1 \
        || uci -q set tailscale.settings.service_enabled='0'
    uci -q commit tailscale 2>/dev/null
}

# --- Helper: official-variant installer (runs inside background subshell) -----
# Downloads the official static arm64 tarball, installs binaries to /usr/bin,
# writes the procd init script + marker + UCI parity. Writes phased progress to
# $TS_INSTALL_RESULT. Must be called from within the orphaned install subshell.
install_official() {
    TS_TGZ="/tmp/qm_tailscale_dl.tgz"
    TS_EXTRACT="/tmp/qm_tailscale_extract"
    PKGS_JSON_URL="https://pkgs.tailscale.com/stable/?mode=json"

    rm -rf "$TS_TGZ" "$TS_EXTRACT"

    # Phase: disk space. Tarball ~27MB compressed / ~55MB extracted; guard /tmp
    # at ~100MB for download + extract headroom.
    printf '{"success":true,"status":"running","message":"Checking disk space..."}' > "$TS_INSTALL_RESULT"
    tmp_avail=$(df -k /tmp 2>/dev/null | awk 'NR==2{print $4}')
    case "$tmp_avail" in ''|*[!0-9]*) tmp_avail=0 ;; esac
    if [ "$tmp_avail" -lt 102400 ]; then
        printf '{"success":false,"status":"error","message":"Not enough space in /tmp","detail":"Need ~100MB free to download Tailscale"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi

    # Phase: resolve latest version. Plain key access only — device jq has NO
    # regex. Shape: {"Version":"1.98.4","Tarballs":{"arm64":"tailscale_1.98.4_arm64.tgz"}}
    printf '{"success":true,"status":"running","message":"Resolving latest version..."}' > "$TS_INSTALL_RESULT"
    meta=$(curl -fsSL --max-time 20 "$PKGS_JSON_URL" 2>/dev/null)
    tarball=$(printf '%s' "$meta" | jq -r '.Tarballs.arm64 | if . == null then empty else . end' 2>/dev/null)
    ts_ver=$(printf '%s' "$meta" | jq -r '.Version | if . == null then empty else . end' 2>/dev/null)
    if [ -z "$tarball" ]; then
        printf '{"success":false,"status":"error","message":"Could not resolve latest Tailscale version","detail":"pkgs.tailscale.com unreachable or response format changed"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi
    [ -n "$ts_ver" ] || ts_ver="latest"
    dl_url="https://pkgs.tailscale.com/stable/${tarball}"

    # Phase: download.
    printf '{"success":true,"status":"running","message":"Downloading Tailscale %s..."}' "$ts_ver" > "$TS_INSTALL_RESULT"
    if ! curl -fsSL --max-time 600 -o "$TS_TGZ" "$dl_url" 2>/dev/null; then
        rm -f "$TS_TGZ"
        printf '{"success":false,"status":"error","message":"Download failed","detail":"Check internet connection and retry"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi

    # Phase: extract. BusyBox tar handles gzip via -z; fall back to gzip pipe if
    # the -z applet is stripped from this build.
    printf '{"success":true,"status":"running","message":"Extracting..."}' > "$TS_INSTALL_RESULT"
    mkdir -p "$TS_EXTRACT"
    if ! tar -xzf "$TS_TGZ" -C "$TS_EXTRACT" 2>/dev/null; then
        if ! gzip -dc "$TS_TGZ" 2>/dev/null | tar -x -C "$TS_EXTRACT" 2>/dev/null; then
            rm -rf "$TS_TGZ" "$TS_EXTRACT"
            printf '{"success":false,"status":"error","message":"Extraction failed"}' > "$TS_INSTALL_RESULT"
            exit 1
        fi
    fi

    # Locate the binaries — top dir is e.g. tailscale_1.98.4_arm64/. Don't assume
    # a glob expands; resolve the dir explicitly.
    src_dir=$(find "$TS_EXTRACT" -maxdepth 1 -type d -name 'tailscale_*' 2>/dev/null | head -n1)
    [ -n "$src_dir" ] || src_dir="$TS_EXTRACT"
    if [ ! -f "$src_dir/tailscale" ] || [ ! -f "$src_dir/tailscaled" ]; then
        rm -rf "$TS_TGZ" "$TS_EXTRACT"
        printf '{"success":false,"status":"error","message":"Binaries not found in archive"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi

    # Phase: install binaries. Guard overlay at ~80MB.
    printf '{"success":true,"status":"running","message":"Installing binaries..."}' > "$TS_INSTALL_RESULT"
    ov_avail=$(df -k /overlay 2>/dev/null | awk 'NR==2{print $4}')
    case "$ov_avail" in ''|*[!0-9]*) ov_avail=0 ;; esac
    if [ "$ov_avail" -lt 81920 ]; then
        rm -rf "$TS_TGZ" "$TS_EXTRACT"
        printf '{"success":false,"status":"error","message":"Not enough space on overlay","detail":"Free space and retry"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi
    if ! cp "$src_dir/tailscale" /usr/bin/tailscale || ! cp "$src_dir/tailscaled" /usr/bin/tailscaled; then
        rm -f /usr/bin/tailscale /usr/bin/tailscaled
        rm -rf "$TS_TGZ" "$TS_EXTRACT"
        printf '{"success":false,"status":"error","message":"Failed to install binaries to /usr/bin"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi
    chmod 755 /usr/bin/tailscale /usr/bin/tailscaled

    # Phase: write service + marker + UCI parity.
    printf '{"success":true,"status":"running","message":"Writing service..."}' > "$TS_INSTALL_RESULT"
    mkdir -p /etc/tailscale
    write_ts_initd
    printf 'official\n' > "$TS_INSTALL_MARKER"
    seed_ts_uci_settings

    # Clean up /tmp artifacts.
    rm -rf "$TS_TGZ" "$TS_EXTRACT"

    # Verify + optional firewall workaround (mirror the tiny path).
    if command -v tailscale >/dev/null 2>&1; then
        if [ "$_TS_WORKAROUNDS" = "1" ]; then
            vpn_fw_ensure_zone "tailscale" "tailscale0"
        fi
        printf '{"success":true,"status":"complete","message":"Tailscale %s installed successfully","variant":"official"}' "$ts_ver" > "$TS_INSTALL_RESULT"
    else
        printf '{"success":false,"status":"error","message":"Install completed but binary not found"}' > "$TS_INSTALL_RESULT"
    fi
}

# --- Helper: tiny-variant installer (runs inside background subshell) ---------
# Installs the tailscale-tiny opkg package directly. Seeds tailscale.settings +
# writes the marker for symmetry with the official path.
install_tiny() {
    printf '{"success":true,"status":"running","message":"Updating package lists..."}' > "$TS_INSTALL_RESULT"
    if ! opkg update >/dev/null 2>&1; then
        printf '{"success":false,"status":"error","message":"Failed to update package lists","detail":"Check internet connection and opkg feeds"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi

    printf '{"success":true,"status":"running","message":"Installing tailscale-tiny..."}' > "$TS_INSTALL_RESULT"
    if ! opkg install tailscale-tiny >/dev/null 2>&1; then
        printf '{"success":false,"status":"error","message":"opkg install failed","detail":"Package may not be available for this architecture"}' > "$TS_INSTALL_RESULT"
        exit 1
    fi

    # Verify
    if command -v tailscale >/dev/null 2>&1; then
        # Defensive UCI parity + marker (package may already ship the section).
        seed_ts_uci_settings
        mkdir -p /etc/tailscale
        printf 'tiny\n' > "$TS_INSTALL_MARKER"
        if [ "$_TS_WORKAROUNDS" = "1" ]; then
            vpn_fw_ensure_zone "tailscale" "tailscale0"
        fi
        printf '{"success":true,"status":"complete","message":"Tailscale installed successfully","variant":"tiny"}' > "$TS_INSTALL_RESULT"
    else
        printf '{"success":false,"status":"error","message":"Package installed but binary not found"}' > "$TS_INSTALL_RESULT"
    fi
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
                install_hint: "opkg update && opkg install tailscale-tiny",
                install_variants: ["official", "tiny"],
                other_vpn_installed: $other_vpn_installed,
                other_vpn_name: "NetBird"
            }'
        exit 0
    fi

    ts_version=$(get_ts_version)
    boot_enabled=$(get_boot_enabled)
    install_variant=$(get_install_variant)

    # --- Tier 2: Installed but daemon not running ----------------------------
    if ! is_daemon_running; then
        qlog_info "Tailscale installed but daemon not running"
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            --arg install_variant "$install_variant" \
            --argjson other_vpn_installed "$other_vpn_installed" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version,
                install_variant: $install_variant,
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
            --arg install_variant "$install_variant" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version,
                install_variant: $install_variant,
                backend_state: "Unknown",
                error_detail: "Could not retrieve status from tailscale daemon"
            }'
        exit 0
    fi

    # Extract backend state
    backend_state=$(printf '%s' "$status_json" | jq -r '.BackendState // "Unknown"')

    # Extract auth URL (from status JSON or persisted file)
    auth_url=$(printf '%s' "$status_json" | jq -r '.AuthURL | if . == null then empty else . end')
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

    # Whether this device currently advertises itself as an exit node. Extracted
    # top-level (like backend_state) for the hook's convenience. .Self.ExitNodeOption
    # is true when --advertise-exit-node is set on the local prefs.
    exit_node_advertised=$(printf '%s' "$status_json" | jq -r '.Self.ExitNodeOption // false' 2>/dev/null)
    [ "$exit_node_advertised" = "true" ] || exit_node_advertised="false"

    # Assemble full response
    jq -n \
        --argjson installed true \
        --argjson daemon_running true \
        --argjson enabled_on_boot "$boot_enabled" \
        --arg version "$ts_version" \
        --arg backend_state "$backend_state" \
        --arg auth_url "$auth_url" \
        --arg install_variant "$install_variant" \
        --argjson exit_node_advertised "$exit_node_advertised" \
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
            install_variant: $install_variant,
            backend_state: $backend_state,
            exit_node_advertised: $exit_node_advertised,
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

        # Variant selection: "official" (static tarball) or "tiny" (opkg).
        # Missing -> default "tiny" for backward compatibility with old clients.
        VARIANT=$(printf '%s' "$POST_DATA" | jq -r '.variant // empty')
        case "$VARIANT" in
            official|tiny) : ;;
            "") VARIANT="tiny" ;;
            *)
                cgi_error "invalid_variant" "variant must be 'official' or 'tiny'"
                exit 0
                ;;
        esac

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

        qlog_info "Starting Tailscale installation (variant=$VARIANT)"

        # Spawn background installer. The variant installers (install_official /
        # install_tiny) are sourced in the parent and inherit into this orphaned
        # subshell. They write phased progress to $TS_INSTALL_RESULT and exit
        # non-zero on failure.
        (
            echo $$ > "$TS_INSTALL_PID"
            trap 'rm -f "$TS_INSTALL_PID"' EXIT

            if [ "$VARIANT" = "official" ]; then
                install_official
            else
                install_tiny
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

        # CRITICAL: NEVER use --accept-routes or --advertise-routes — accepting
        # routes disconnects the device from the network entirely and requires
        # a physical reboot to recover. Route advertising is banned by design.
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
    # action: set_exit_node — opt-in advertise this device as a Tailscale exit
    # node, applied only while Tailscale is connected. Uses `tailscale set` (NOT
    # `tailscale up`, which would reset every pref we didn't pass). Advertising
    # an exit node still requires the user to APPROVE it in the Tailscale admin
    # console before peers can route through it; any IP-forwarding warning
    # surfaces via the `health` array in the GET status response.
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "set_exit_node" ]; then
        check_migration_lock
        exit_node_enabled=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -z "$exit_node_enabled" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi
        case "$exit_node_enabled" in
            true|false) : ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                exit 0
                ;;
        esac

        # Daemon must be up.
        if ! is_daemon_running; then
            cgi_error "not_connected" "Tailscale must be connected to change exit-node advertising"
            exit 0
        fi

        # Require authenticated/Running backend state.
        if command -v timeout >/dev/null 2>&1; then
            en_status=$(timeout 5 tailscale status --json 2>/dev/null)
        else
            en_status=$(tailscale status --json 2>/dev/null)
        fi
        en_state=$(printf '%s' "$en_status" | jq -r '.BackendState // "Unknown"' 2>/dev/null)
        if [ "$en_state" != "Running" ]; then
            cgi_error "not_connected" "Tailscale must be connected to change exit-node advertising"
            exit 0
        fi

        # Apply via `tailscale set` so unspecified prefs are preserved.
        en_result=$(tailscale set --advertise-exit-node="$exit_node_enabled" 2>&1)
        en_rc=$?
        if [ "$en_rc" -ne 0 ]; then
            qlog_error "tailscale set --advertise-exit-node=$exit_node_enabled failed: $en_result"
            cgi_error "set_failed" "Failed to update exit-node advertising: $en_result"
            exit 0
        fi
        qlog_info "Exit-node advertising set to $exit_node_enabled"
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

        # Disable boot entry if init script exists (covers official, legacy, tiny).
        [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale disable >/dev/null 2>&1

        # Method-aware removal. Official (tarball) installs have no opkg entry —
        # remove the binaries, the heredoc-written init script, its rc.d symlinks
        # and the UCI section directly. Everything else goes through the existing
        # 6-package smart opkg removal.
        if [ "$(get_install_variant)" = "official" ]; then
            qlog_info "Removing official (tarball) Tailscale install"
            rm -f /usr/bin/tailscale /usr/bin/tailscaled /etc/init.d/tailscale
            rm -f /etc/rc.d/*tailscale 2>/dev/null
            uci -q delete tailscale 2>/dev/null && uci -q commit tailscale 2>/dev/null
            # uci delete+commit does NOT remove /etc/config/tailscale on-device —
            # the section resurrects on next read. Remove the file outright.
            rm -f /etc/config/tailscale 2>/dev/null || true
        else
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
        fi

        # Clean up state from official, legacy and tiny locations (marker lives
        # in /etc/tailscale, removed here).
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
