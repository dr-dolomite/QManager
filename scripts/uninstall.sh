#!/bin/sh
# =============================================================================
# QManager Uninstaller (v2) — filesystem-driven, safe by default
# =============================================================================
# Completely removes QManager from an OpenWRT device.
#
# Design invariants:
#   1. POSIX /bin/sh only
#   2. Filesystem-driven — scans actual installed files, not hardcoded lists
#   3. Structured logging to /tmp/qmanager_uninstall.log
#   4. Confirmation required unless --force is passed
#
# What it removes:
#   - All init.d qmanager* services (stops, disables, deletes)
#   - All qmanager_* daemons + qcmd + atcli_smd11 + sms_tool + nfqws
#     + bridge_traffic_monitor_*
#   - /usr/lib/qmanager/ (entire tree)
#   - /www/cgi-bin/quecmanager/ (entire tree)
#   - /www/* (except cgi-bin, luci-static, index.html.old)
#   - Restores /www/index.html from index.html.old if present
#   - UCI config (quecmanager.*)
#   - Firewall rule files (/etc/firewall.user.ttl, /etc/firewall.user.mtu)
#   - nftables DPI rules (/etc/nftables.d/12-mangle-qmanager-dpi.nft + live chain)
#   - Runtime state in /tmp (JSON cache, logs, PID files, sessions)
#   - Cron jobs
#   - Optionally: /etc/qmanager/ (password, profiles, backups)
#
# Usage:
#   sh uninstall.sh [OPTIONS]
#
# Flags:
#   --force              Skip confirmation prompt
#   --keep-config        Keep /etc/qmanager/ (default: ask)
#   --purge              Remove /etc/qmanager/ without asking
#   --no-reboot          Do not reboot after uninstall
#   --help, -h           Show this help
# =============================================================================

set -e

VERSION="v0.0.0-dev"
LOG_FILE="/tmp/qmanager_uninstall.log"

# Target paths
WWW_ROOT="/www"
CGI_DIR="/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
INITD_DIR="/etc/init.d"
CONF_DIR="/etc/qmanager"
SESSION_DIR="/tmp/qmanager_sessions"
VERSION_FILE="/etc/qmanager/VERSION"
VERSION_PENDING="/etc/qmanager/VERSION.pending"

# --- Colors & Icons ----------------------------------------------------------

if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    DIM=''
    NC=''
fi

ICO_OK='✓'
ICO_WARN='⚠'
ICO_ERR='✗'
ICO_STEP='▶'

# --- Logging -----------------------------------------------------------------

log_init() {
    : > "$LOG_FILE" 2>/dev/null || true
    _log_raw "=== QManager uninstall started at $(date '+%Y-%m-%d %H:%M:%S') ==="
}

_log_raw() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE" 2>/dev/null || true
}

info() {
    _log_raw "[INFO ] $1"
    printf "    ${GREEN}${ICO_OK}${NC}  %s\n" "$1"
}

warn() {
    _log_raw "[WARN ] $1"
    printf "    ${YELLOW}${ICO_WARN}${NC}  %s\n" "$1"
}

error() {
    _log_raw "[ERROR] $1"
    printf "    ${RED}${ICO_ERR}${NC}  %s\n" "$1"
}

die() {
    error "$1"
    printf "\n  ${RED}${BOLD}Uninstall failed.${NC}\n" >&2
    printf "  See %s for details.\n\n" "$LOG_FILE" >&2
    exit 1
}

# --- Progress ----------------------------------------------------------------

TOTAL_STEPS=7
CURRENT_STEP=0

_draw_bar() {
    local curr="$1" tot="$2" w="${3:-20}"
    local fill=$(( curr * w / tot ))
    local bar="" i=0
    while [ "$i" -lt "$w" ]; do
        if [ "$i" -lt "$fill" ]; then
            bar="${bar}█"
        else
            bar="${bar}░"
        fi
        i=$(( i + 1 ))
    done
    printf "%s" "$bar"
}

step() {
    CURRENT_STEP=$(( CURRENT_STEP + 1 ))
    local pct=$(( CURRENT_STEP * 100 / TOTAL_STEPS ))
    _log_raw ""
    _log_raw "=== Step $CURRENT_STEP/$TOTAL_STEPS: $1 ==="
    printf "\n"
    if [ -t 1 ]; then
        printf "  ${DIM}[%s  %3d%%  Step %d/%d]${NC}\n" \
            "$(_draw_bar "$CURRENT_STEP" "$TOTAL_STEPS")" \
            "$pct" "$CURRENT_STEP" "$TOTAL_STEPS"
    fi
    printf "  ${BLUE}${BOLD}${ICO_STEP}${NC}${BOLD} %s${NC}\n" "$1"
}

# --- Pre-flight --------------------------------------------------------------

preflight() {
    step "Pre-flight checks"

    [ "$(id -u)" -eq 0 ] || die "This script must be run as root"

    if [ -f /etc/openwrt_release ]; then
        local distro
        distro=$(. /etc/openwrt_release && echo "$DISTRIB_DESCRIPTION")
        info "OpenWRT: $distro"
    else
        warn "Cannot detect OpenWRT — proceeding anyway"
    fi

    # Warn if QManager doesn't appear to be installed
    if [ ! -d "$CGI_DIR" ] && [ ! -d "$LIB_DIR" ] && [ ! -f "$BIN_DIR/qcmd" ]; then
        warn "QManager does not appear to be installed"
        if [ "$DO_FORCE" = "1" ]; then
            warn "Proceeding anyway (--force)"
        elif [ -t 0 ]; then
            printf "\n    Continue uninstall anyway? [y/N] "
            read -r _ans
            case "$_ans" in
                y|Y|yes|YES) info "Proceeding with uninstall cleanup" ;;
                *) printf "\n  ${YELLOW}Aborted.${NC}\n\n"; exit 0 ;;
            esac
        else
            die "QManager not installed and shell is non-interactive"
        fi
    else
        info "QManager installation detected"
    fi
}

# --- Confirmation ------------------------------------------------------------

confirm_uninstall() {
    printf "\n"
    printf "  ${YELLOW}${BOLD}This will permanently remove QManager from your device.${NC}\n\n"
    printf "  The following will be deleted:\n\n"
    printf "    ${DIM}${ICO_STEP}${NC}  Frontend files in %s\n" "$WWW_ROOT"
    printf "    ${DIM}${ICO_STEP}${NC}  CGI endpoints in %s\n" "$CGI_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Libraries in %s\n" "$LIB_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Daemons: %s/qmanager_*, qcmd, atcli_smd11, sms_tool\n" "$BIN_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Init.d services: %s/qmanager*\n" "$INITD_DIR"
    printf "    ${DIM}${ICO_STEP}${NC}  Runtime state in /tmp\n"
    printf "    ${DIM}${ICO_STEP}${NC}  UCI config (quecmanager.*)\n"
    printf "    ${DIM}${ICO_STEP}${NC}  Cron jobs\n"
    printf "    ${DIM}${ICO_STEP}${NC}  Firewall rule files\n"
    printf "\n"
    printf "  Type ${BOLD}yes${NC} to confirm: "
    read -r _confirm
    case "$_confirm" in
        yes|YES)
            printf "\n"
            ;;
        *)
            printf "\n  ${YELLOW}Aborted — nothing was removed.${NC}\n\n"
            exit 0
            ;;
    esac
}

# --- Service Stop (filesystem-driven) ----------------------------------------

stop_services() {
    step "Stopping QManager services"

    # Stop every init.d qmanager* service — filesystem-driven
    if [ -d "$INITD_DIR" ]; then
        for f in "$INITD_DIR"/qmanager*; do
            [ -x "$f" ] || continue
            "$f" stop 2>>"$LOG_FILE" || true
        done
        info "Stopped all init.d services"
    fi

    # Kill every qmanager_* daemon present in /usr/bin
    if [ -d "$BIN_DIR" ]; then
        for f in "$BIN_DIR"/qmanager_*; do
            [ -f "$f" ] || continue
            killall "$(basename "$f")" 2>/dev/null || true
        done
    fi

    # Non-qmanager-prefixed binaries
    for p in bridge_traffic_monitor_rm551 websocat nfqws qcmd; do
        killall "$p" 2>/dev/null || true
    done

    sleep 1
    info "All daemon processes killed"
}

# --- Service Removal ---------------------------------------------------------

remove_services() {
    step "Removing init.d services"

    local removed=0 fname
    for f in "$INITD_DIR"/qmanager*; do
        [ -f "$f" ] || continue
        fname="$(basename "$f")"
        "$f" disable 2>/dev/null || true
        rm -f "$f"
        info "Removed /etc/init.d/$fname"
        removed=$(( removed + 1 ))
    done

    # Clean up orphaned rc.d symlinks
    for link in /etc/rc.d/*qmanager*; do
        [ -e "$link" ] && rm -f "$link" 2>/dev/null || true
    done

    if [ "$removed" = "0" ]; then
        warn "No init.d services found — may have already been removed"
    else
        info "$removed service(s) disabled and removed"
    fi
}

# --- Backend Removal ---------------------------------------------------------

remove_backend() {
    step "Removing backend files"

    # --- Binaries in /usr/bin/ ---
    local bin_count=0

    if [ -f "$BIN_DIR/qcmd" ]; then
        rm -f "$BIN_DIR/qcmd"
        bin_count=$(( bin_count + 1 ))
    fi

    for f in "$BIN_DIR"/qmanager_*; do
        [ -f "$f" ] || continue
        rm -f "$f"
        bin_count=$(( bin_count + 1 ))
    done

    for extra in atcli_smd11 sms_tool bridge_traffic_monitor_rm551 nfqws; do
        if [ -f "$BIN_DIR/$extra" ]; then
            rm -f "$BIN_DIR/$extra"
            bin_count=$(( bin_count + 1 ))
        fi
    done
    info "Removed $bin_count binary/daemon file(s) from $BIN_DIR"

    # --- Tailscale Force-Fixes firewall cleanup ---
    # If the user opted into Force Tailscale Fixes, an explicit fw4 zone for
    # tailscale0 + a mwan3 ipset entry for the CGNAT range were created. Drop
    # them before /usr/lib/qmanager is wiped (vpn_firewall.sh must still be
    # sourceable). The library is idempotent — fast no-op if no zone exists,
    # and preserves the mwan3 entry when NetBird is also installed.
    if [ -f "$LIB_DIR/vpn_firewall.sh" ]; then
        # shellcheck disable=SC1091
        . "$LIB_DIR/vpn_firewall.sh" 2>/dev/null || true
        if command -v vpn_fw_remove_zone >/dev/null 2>&1; then
            vpn_fw_remove_zone "tailscale" 2>/dev/null || true
            info "Cleaned up Tailscale firewall workarounds (if present)"
        fi
    fi

    # --- Shared libraries ---
    if [ -d "$LIB_DIR" ]; then
        rm -rf "$LIB_DIR"
        info "Removed $LIB_DIR"
    else
        warn "$LIB_DIR not found — already removed"
    fi

    # --- CGI endpoints ---
    if [ -d "$CGI_DIR" ]; then
        rm -rf "$CGI_DIR"
        info "Removed $CGI_DIR"
    else
        warn "$CGI_DIR not found — already removed"
    fi

    # --- UCI config namespace ---
    if uci -q get quecmanager >/dev/null 2>&1; then
        uci -q delete quecmanager 2>/dev/null || true
        uci commit 2>/dev/null || true
        info "Removed UCI config (quecmanager.*)"
    fi
    if [ -f /etc/config/quecmanager ]; then
        rm -f /etc/config/quecmanager
        info "Removed /etc/config/quecmanager"
    fi

    # --- Firewall rule files ---
    if [ -f /etc/firewall.user.ttl ]; then
        rm -f /etc/firewall.user.ttl
        info "Removed /etc/firewall.user.ttl"
        warn "Live iptables TTL/HL rules remain active — will clear on reboot"
    fi
    if [ -f /etc/firewall.user.mtu ]; then
        rm -f /etc/firewall.user.mtu
        info "Removed /etc/firewall.user.mtu"
    fi

    # --- nftables DPI rules (persistent .nft file + live chain) ---
    if [ -f /etc/nftables.d/12-mangle-qmanager-dpi.nft ]; then
        rm -f /etc/nftables.d/12-mangle-qmanager-dpi.nft
        info "Removed /etc/nftables.d/12-mangle-qmanager-dpi.nft"
    fi
    # Drop the live chain too so rules clear without waiting for fw4 reload
    if command -v nft >/dev/null 2>&1; then
        if nft list chain inet fw4 mangle_postrouting_qmanager_dpi >/dev/null 2>&1; then
            nft delete chain inet fw4 mangle_postrouting_qmanager_dpi 2>/dev/null || true
            info "Removed live nftables DPI chain"
        fi
    fi

    # --- msmtp config + bandwidth certs (if present in config dir) ---
    if [ -f /etc/qmanager/msmtprc ]; then
        rm -f /etc/qmanager/msmtprc
        info "Removed /etc/qmanager/msmtprc (email config)"
    fi
    if [ -d /etc/qmanager/bandwidth_certs ]; then
        rm -rf /etc/qmanager/bandwidth_certs
        info "Removed /etc/qmanager/bandwidth_certs (bandwidth SSL)"
    fi
    # Hardware band-capability file (force-deployed by installer, not user config)
    if [ -f /etc/qmanager/supported_bands_hw.env ]; then
        rm -f /etc/qmanager/supported_bands_hw.env
        info "Removed /etc/qmanager/supported_bands_hw.env (hardware band capability)"
    fi

    # --- Cron jobs ---
    if crontab -l 2>/dev/null | grep -q qmanager; then
        crontab -l 2>/dev/null | grep -v qmanager | crontab - 2>/dev/null || true
        info "Removed qmanager cron jobs"
    fi
}

# --- Frontend Removal --------------------------------------------------------

remove_frontend() {
    step "Removing frontend files"

    local removed=0
    for item in "$WWW_ROOT"/*; do
        [ -e "$item" ] || continue
        local name
        name="$(basename "$item")"
        case "$name" in
            cgi-bin|luci-static|index.html.old) continue ;;
            *)
                rm -rf "$item"
                removed=$(( removed + 1 ))
                ;;
        esac
    done
    info "Removed $removed item(s) from $WWW_ROOT"

    if [ -f "$WWW_ROOT/index.html.old" ]; then
        mv "$WWW_ROOT/index.html.old" "$WWW_ROOT/index.html"
        info "Restored original /www/index.html from index.html.old"
    else
        warn "No backup found — original index.html was not restored"
        warn "  Device web UI may show a blank page until LuCI is reinstalled"
        warn "  Recovery: opkg install luci && reboot"
    fi
}

# --- Runtime State Removal ---------------------------------------------------

remove_runtime_state() {
    step "Removing runtime state from /tmp"

    local tmp_count=0

    # JSON cache and state files
    for f in /tmp/qmanager_status.json \
             /tmp/qmanager_ping.json \
             /tmp/qmanager_ping_history \
             /tmp/qmanager_signal_history.json \
             /tmp/qmanager_events.json \
             /tmp/qmanager_email_log.json \
             /tmp/qmanager_sms_log.json \
             /tmp/qmanager_profile_state.json \
             /tmp/qmanager_watchcat.json \
             /tmp/qmanager_band_failover_state.json \
             /tmp/qmanager_tower_failover_state.json \
             /tmp/qmanager_update.json \
             /tmp/qmanager_config_restore.json \
             /tmp/qmanager_config_restore_input.json \
             /tmp/qmanager_config_restore.cancel \
             /tmp/qmanager_config_restore.reboot_required \
             /tmp/qmanager_language_install.json \
             /tmp/qmanager_language_install_input.json \
             /tmp/qmanager_language_install.cancel; do
        [ -f "$f" ] && rm -f "$f" && tmp_count=$(( tmp_count + 1 ))
    done

    # Logs
    for f in /tmp/qmanager.log /tmp/qmanager.log.1 /tmp/qmanager_update.log /tmp/qmanager_install.log; do
        [ -f "$f" ] && rm -f "$f" && tmp_count=$(( tmp_count + 1 ))
    done

    # Lock/PID/flag files (/tmp)
    rm -f /tmp/qmanager_*.lock \
          /tmp/qmanager_*.pid \
          /tmp/qmanager_email_reload \
          /tmp/qmanager_sms_reload \
          /tmp/qmanager_sms_forward_reload \
          /tmp/qmanager_sms_forward_seen \
          /tmp/qmanager_sms_forward_failures.json \
          /tmp/qmanager_sms_forward_failures.json.tmp \
          /tmp/qmanager_ping_reload \
          /tmp/qmanager_quality_reload \
          /tmp/qmanager_imei_check_done \
          /tmp/qmanager_refresh_policy_band \
          /tmp/qmanager_supported_bands.env \
          /tmp/qmanager_long_running \
          /tmp/qmanager_low_power_active \
          /tmp/qmanager_recovery_active \
          /tmp/qmanager_pending_reboot_verizon \
          /tmp/qm_spin_out \
          /tmp/qm_tmo_out.* \
          2>/dev/null || true

    # PID files in /var/run (config-restore and language-install workers)
    rm -f /var/run/qmanager_config_restore.pid \
          /var/run/qmanager_language_install.pid \
          2>/dev/null || true

    # Staged update artifacts
    rm -f /tmp/qmanager_staged.tar.gz \
          /tmp/qmanager_staged_version \
          /tmp/qmanager_staged_sha256.txt \
          /tmp/qmanager_rollback.tar.gz \
          /tmp/qmanager_update_new.tar.gz \
          2>/dev/null || true

    # Language-pack install staging/download scratch dirs
    rm -rf /tmp/qmanager_lp_staging \
           /tmp/qmanager_lp_download \
           2>/dev/null || true

    # Bandwidth monitor runtime
    rm -rf /tmp/quecmanager 2>/dev/null || true

    # Session directory
    if [ -d "$SESSION_DIR" ]; then
        rm -rf "$SESSION_DIR"
        info "Removed session directory $SESSION_DIR"
    fi

    # Leftover install scratch
    rm -rf /tmp/qmanager_install 2>/dev/null || true

    info "Removed $tmp_count tracked file(s) from /tmp (plus lock/flag/pid files)"
}

# --- Config Directory Handling -----------------------------------------------

remove_config() {
    if [ -d "$CONF_DIR" ]; then
        rm -rf "$CONF_DIR"
        info "Removed $CONF_DIR"
    fi
}

# --- Summary -----------------------------------------------------------------

print_summary() {
    printf "\n"
    if [ -t 1 ]; then
        printf "  [%s  100%%  Complete]\n" "$(_draw_bar "$TOTAL_STEPS" "$TOTAL_STEPS")"
    fi
    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${GREEN}${BOLD}  QManager - Uninstall Complete${NC}\n"
    printf "  ══════════════════════════════════════════\n\n"

    printf "  ${GREEN}${ICO_OK}${NC}  Frontend files removed from %s\n" "$WWW_ROOT"
    printf "  ${GREEN}${ICO_OK}${NC}  CGI endpoints, libraries, and daemons removed\n"
    printf "  ${GREEN}${ICO_OK}${NC}  Init.d services disabled and removed\n"
    printf "  ${GREEN}${ICO_OK}${NC}  Runtime state cleared from /tmp\n"

    if [ -f "$WWW_ROOT/index.html" ]; then
        printf "  ${GREEN}${ICO_OK}${NC}  Original index.html restored\n"
    else
        printf "  ${YELLOW}${ICO_WARN}${NC}  No index.html — device web UI may be blank until LuCI is restored\n"
    fi

    printf "\n"
    printf "  ${DIM}Uninstall log: %s${NC}\n" "$LOG_FILE"
    printf "  ${DIM}Tip: A reboot is recommended to clear any live iptables/nftables state.${NC}\n\n"
}

# --- Reboot ------------------------------------------------------------------

reboot_system() {
    if command -v reboot >/dev/null 2>&1; then
        reboot
        return $?
    fi
    if [ -x /sbin/reboot ]; then
        /sbin/reboot
        return $?
    fi
    if command -v busybox >/dev/null 2>&1; then
        busybox reboot
        return $?
    fi
    warn "Cannot find reboot command — please reboot manually"
    return 1
}

# --- Usage -------------------------------------------------------------------

usage() {
    cat <<EOF
QManager Uninstaller $VERSION

Usage: sh uninstall.sh [OPTIONS]

Options:
  --force              Skip confirmation prompt
  --keep-config        Always keep /etc/qmanager/ (no prompt)
  --purge              Always remove /etc/qmanager/ (no prompt)
  --no-reboot          Do not reboot after uninstall
  --help, -h           Show this help

What is removed:
  /www/              Frontend files (original index.html restored if backed up)
  /www/cgi-bin/      QManager CGI endpoints
  /usr/lib/qmanager/ Shared libraries
  /usr/bin/          qcmd, atcli_smd11, sms_tool, qmanager_* daemons
  /etc/init.d/       qmanager* service scripts (stopped + disabled)
  /tmp/              Runtime JSON, logs, sessions, lock/PID files
  UCI                quecmanager.* config namespace
  /etc/firewall.*    TTL/MTU rule files
  nftables           qmanager_dpi rules in /etc/nftables.d/ (if present)
  Cron               qmanager-related entries

Optional (asked or via flag):
  /etc/qmanager/     Password, profiles, tower/band configs, backups
EOF
}

# --- Main --------------------------------------------------------------------

main() {
    DO_FORCE=0
    DO_CONFIG="ask"   # "ask" | "keep" | "purge"
    DO_REBOOT=1

    while [ $# -gt 0 ]; do
        case "$1" in
            --force)         DO_FORCE=1 ;;
            --keep-config)   DO_CONFIG="keep" ;;
            --purge)         DO_CONFIG="purge" ;;
            --no-reboot)     DO_REBOOT=0 ;;
            --help|-h)       usage; exit 0 ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    log_init

    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager - Uninstall Script${NC}\n"
    printf "  ${DIM}  Version: %s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    preflight

    [ "$DO_FORCE" = "0" ] && confirm_uninstall

    stop_services
    remove_services
    remove_backend
    remove_frontend
    remove_runtime_state

    # --- Handle /etc/qmanager/ config directory ---
    step "Handling configuration directory"
    case "$DO_CONFIG" in
        purge)
            remove_config
            info "Configuration directory purged"
            ;;
        keep)
            [ -d "$CONF_DIR" ] && info "Kept $CONF_DIR (configs preserved)"
            ;;
        ask)
            if [ -d "$CONF_DIR" ]; then
                printf "\n"
                warn "Configuration directory $CONF_DIR still exists."
                warn "Contains: password hash, profiles, tower/band locks, IMEI backup, backups."
                if [ -t 0 ]; then
                    printf "  Remove it? [y/N] "
                    read -r answer
                    case "$answer" in
                        y|Y|yes|YES)
                            remove_config
                            info "Configuration directory removed"
                            ;;
                        *)
                            info "Kept $CONF_DIR (configs preserved for reinstall)"
                            ;;
                    esac
                else
                    info "Non-interactive — kept $CONF_DIR by default"
                fi
            else
                info "Configuration directory already absent"
            fi
            ;;
    esac

    # Make sure VERSION markers are gone if the config dir was removed
    rm -f "$VERSION_FILE" "$VERSION_PENDING" 2>/dev/null || true

    print_summary

    if [ "$DO_REBOOT" = "1" ]; then
        printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
        sleep 5
        reboot_system
    fi
}

main "$@"
