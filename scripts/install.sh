#!/bin/sh
# =============================================================================
# QManager Installer (v2) — filesystem-driven, crash-resilient
# =============================================================================
# Installs QManager frontend + backend onto a barebone OpenWRT device running
# RM551E-GL modem firmware. Designed to work without extra opkg dependencies
# beyond what this script installs itself.
#
# Design invariants:
#   1. POSIX /bin/sh only (no bashisms, no arrays, no [[ ]])
#   2. curl-only HTTP (no wget, no uclient-fetch fallbacks)
#   3. Service lists are filesystem-driven — zero hardcoded script names
#      except for the small UCI-gated list (user-controlled services).
#   4. Two-phase VERSION write (pending -> final) so partial installs leave
#      the old VERSION intact and the update CGI can detect the failure.
#   5. Every visible line also goes to /tmp/qmanager_install.log with a
#      timestamp and severity, for easy post-mortem debugging.
#
# Archive layout at INSTALL_DIR:
#   out/                        Next.js static export (frontend)
#   scripts/                    Backend shell tree
#     etc/init.d/               Init.d service scripts
#     etc/qmanager/             Default config files
#     usr/bin/                  Daemons and utilities (qmanager_*, qcmd, ...)
#     usr/lib/qmanager/         Shared shell libraries
#     www/cgi-bin/quecmanager/  CGI API endpoints
#   dependencies/               Bundled binaries (atcli_smd11, sms_tool)
#   install.sh                  This script
#
# Usage:
#   cd /tmp && tar xzf qmanager.tar.gz
#   cd qmanager_install && sh install.sh
#
# Flags:
#   --frontend-only    Only install frontend files
#   --backend-only     Only install backend scripts
#   --skip-packages    Skip opkg package install (OTA path uses this)
#   --no-enable        Do not enable init.d services
#   --no-start         Do not start services after install
#   --no-reboot        Do not reboot after install (OTA path uses this)
#   --force            Skip modem firmware detection
#   --help, -h         Show this help
# =============================================================================

set -e

# --- Configuration -----------------------------------------------------------

VERSION="v0.0.0-dev"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/qmanager_install.log"

# Target filesystem paths
WWW_ROOT="/www"
CGI_DIR="/www/cgi-bin/quecmanager"
LIB_DIR="/usr/lib/qmanager"
BIN_DIR="/usr/bin"
INITD_DIR="/etc/init.d"
CONF_DIR="/etc/qmanager"
UPDATES_DIR="/etc/qmanager/updates"
SESSION_DIR="/tmp/qmanager_sessions"
BACKUP_DIR="/etc/qmanager/backups"
VERSION_FILE="/etc/qmanager/VERSION"
VERSION_PENDING="/etc/qmanager/VERSION.pending"

# Source directories inside the tarball
SRC_FRONTEND="$INSTALL_DIR/out"
SRC_SCRIPTS="$INSTALL_DIR/scripts"
SRC_DEPS="$INSTALL_DIR/dependencies"

# Packages
# Note: coreutils-timeout is required even though BusyBox ships a `timeout`
# applet — barebone OpenWRT builds (like OEM modem firmware) often strip
# applets at compile time, so we can't assume BusyBox `timeout` is present.
# qcmd wraps atcli_smd11 with `timeout` as a last-ditch safety net, and the
# installer's run_capture_timeout helper uses it too. Cheap guarantee.
REQUIRED_PACKAGES="jq curl coreutils-timeout websocat ethtool"
OPTIONAL_PACKAGES="msmtp ookla-speedtest"
# Removed before install to avoid /dev/smd11 conflicts and sms_tool collision
CONFLICT_PACKAGES="sms-tool socat-at-bridge socat"

# UCI-gated services — only enabled if a prior install had them enabled.
# Everything else is enabled unconditionally. This is the ONLY hardcoded
# service list in this script.
UCI_GATED_SERVICES="qmanager_tower_failover qmanager_watchcat qmanager_bandwidth qmanager_dpi qmanager_vpn_zone qmanager_sms_forward"

# Expected modem firmware signature (after normalization: upper + alnum only)
REQUIRED_FIRMWARE="RM551EGL"

# Watchcat maintenance lock — touched at the start of stop_services and
# released at the end of install (or on EXIT trap). When this file exists,
# qmanager_watchcat enters LOCKED state and skips all connectivity checks,
# which prevents it from observing install-induced disruption (services
# stopping, modem state changes) and escalating to a Tier 4 system reboot
# mid-install.
WATCHCAT_LOCK="/tmp/qmanager_watchcat.lock"

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
# All user-visible output mirrors to LOG_FILE with timestamps. The log is
# truncated at the start of each install run so it always reflects the most
# recent attempt.

log_init() {
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
    : > "$LOG_FILE" 2>/dev/null || true
    _log_raw "=== QManager install started at $(date '+%Y-%m-%d %H:%M:%S') (version=$VERSION) ==="
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
    printf "\n  ${RED}${BOLD}Installation failed.${NC}\n" >&2
    printf "  See %s for details.\n\n" "$LOG_FILE" >&2
    exit 1
}

# --- Progress Tracking -------------------------------------------------------

TOTAL_STEPS=1
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

# --- Shell Helpers -----------------------------------------------------------

# Run a command with a rotating spinner on TTY, silent otherwise. Output and
# errors are always appended to LOG_FILE.
run_with_spinner() {
    local label="$1"; shift
    local rc=0

    if [ ! -t 1 ]; then
        "$@" >>"$LOG_FILE" 2>&1 || rc=$?
        return "$rc"
    fi

    "$@" >>"$LOG_FILE" 2>&1 &
    local cpid=$! i=0 f
    while kill -0 "$cpid" 2>/dev/null; do
        case $(( i % 3 )) in
            0) f='|' ;; 1) f='/' ;; *) f='-' ;;
        esac
        printf "\r    ${CYAN}%s${NC}  %s " "$f" "$label"
        i=$(( i + 1 ))
        sleep 1
    done
    wait "$cpid"
    rc=$?
    printf "\r\033[2K"
    return "$rc"
}

# Capture stdout of a command with a hard timeout. Uses `timeout` when
# available, otherwise a simple poll loop.
run_capture_timeout() {
    local seconds="$1"; shift
    local out_file="/tmp/qm_tmo_out.$$"
    local rc=0 pid="" i=0

    rm -f "$out_file"

    if command -v timeout >/dev/null 2>&1; then
        timeout "$seconds" "$@" >"$out_file" 2>/dev/null || rc=$?
    else
        "$@" >"$out_file" 2>/dev/null &
        pid=$!
        while kill -0 "$pid" 2>/dev/null; do
            if [ "$i" -ge "$seconds" ]; then
                kill "$pid" 2>/dev/null || true
                wait "$pid" 2>/dev/null || true
                rc=124
                break
            fi
            i=$(( i + 1 ))
            sleep 1
        done
        if [ "$rc" -ne 124 ]; then
            wait "$pid" 2>/dev/null
            rc=$?
        fi
    fi

    [ -f "$out_file" ] && cat "$out_file"
    rm -f "$out_file"
    return "$rc"
}

pkg_binary() {
    case "$1" in
        ookla-speedtest)    echo "speedtest" ;;
        coreutils-timeout)  echo "timeout" ;;
        *) echo "$1" ;;
    esac
}

count_files() {
    find "$1" -type f 2>/dev/null | wc -l | tr -d ' '
}

# --- Atomic File Install -----------------------------------------------------
# Copy src to dst with CRLF strip + chmod + atomic rename. This replaces
# separate passes for line endings and permissions in the current installer.
#
# Returns 0 on success, 1 on failure (caller decides whether to die).

install_file() {
    local src="$1" dst="$2" mode="${3:-755}"

    if [ ! -f "$src" ]; then
        _log_raw "install_file: source missing: $src"
        return 1
    fi

    mkdir -p "$(dirname "$dst")" 2>/dev/null || true

    local tmp="$dst.qm_install.$$"
    local src_bytes
    local tmp_bytes

    if ! cp "$src" "$tmp" 2>>"$LOG_FILE"; then
        _log_raw "install_file: cp failed: $src -> $tmp"
        rm -f "$tmp"
        return 1
    fi

    # Integrity check: the copied bytes must equal the source exactly. A
    # truncated cp (interrupted transfer / ENOSPC) can leave a 0-byte or
    # partial file that still passes `sh -n` and execs as a silent no-op —
    # this shipped an empty qmanager_profile_apply once and broke profile
    # activation with start_failed. Must run BEFORE the CRLF strip, where tmp
    # is still byte-identical to src. wc -c is BusyBox-core (no stat/md5 dep);
    # tr -d ' ' normalizes the leading whitespace some wc builds emit.
    src_bytes=$(wc -c < "$src" 2>/dev/null | tr -d ' ')
    tmp_bytes=$(wc -c < "$tmp" 2>/dev/null | tr -d ' ')
    if [ "$src_bytes" != "$tmp_bytes" ]; then
        _log_raw "install_file: SIZE MISMATCH (truncated copy) $src (${src_bytes} B) -> $tmp (${tmp_bytes} B)"
        rm -f "$tmp"
        return 1
    fi

    # CRLF safety net for shell scripts. Build.sh should prevent CRLF in
    # the tarball but Windows-side editors and SMB shares can re-introduce
    # it. CRLF stripping must NEVER run on binary files — ELF binaries
    # contain 0x0D bytes throughout their machine code, and stripping them
    # corrupts the binary (manifests as "Segmentation fault" on first run).
    # Detect ELF via magic bytes (\x7fELF at offset 0) and skip the strip.
    if ! head -c 4 "$tmp" 2>/dev/null | grep -q ELF; then
        if grep -q "$(printf '\r')" "$tmp" 2>/dev/null; then
            if tr -d '\r' < "$tmp" > "$tmp.lf"; then
                mv "$tmp.lf" "$tmp"
                _log_raw "install_file: stripped CRLF from $(basename "$src")"
            else
                rm -f "$tmp.lf"
            fi
        fi
    else
        _log_raw "install_file: $(basename "$src") is ELF — skipping CRLF strip"
    fi

    chmod "$mode" "$tmp" 2>/dev/null || true

    # Atomic replacement. Requires caller to have stopped any running process
    # that has $dst open, otherwise this will fail with ETXTBSY.
    if ! mv "$tmp" "$dst" 2>>"$LOG_FILE"; then
        _log_raw "install_file: atomic rename failed: $tmp -> $dst"
        rm -f "$tmp"
        return 1
    fi

    return 0
}

# Install every file in a flat source directory. Returns the count of files
# installed. Dies on any individual failure.
install_dir_flat() {
    local src="$1" dst="$2" mode="${3:-755}" count=0 fname

    [ -d "$src" ] || { _log_raw "install_dir_flat: missing source $src"; return 1; }
    mkdir -p "$dst"

    for f in "$src"/*; do
        [ -f "$f" ] || continue
        fname="$(basename "$f")"
        if install_file "$f" "$dst/$fname" "$mode"; then
            count=$(( count + 1 ))
        else
            die "Failed to install $fname to $dst"
        fi
    done

    printf '%d' "$count"
    return 0
}

# Recursively install a directory tree (used for CGI which has subdirs).
# Wipes the destination first for a clean replacement. Applies 755 to all
# .sh files and 644 to everything else.
install_tree() {
    local src="$1" dst="$2"
    local mismatch

    [ -d "$src" ] || { _log_raw "install_tree: missing source $src"; return 1; }

    rm -rf "$dst"
    mkdir -p "$dst"
    cp -r "$src"/. "$dst"/ || die "Failed to copy $src to $dst"

    # Integrity sweep: every source file must have a destination counterpart
    # of equal byte size. Same failure mode as install_file — a truncated
    # cp -r can silently deploy a 0-byte CGI script. Must run BEFORE the CRLF
    # strip, which legitimately changes dst sizes. The `find | while` body runs
    # in a SUBSHELL (pipe), so a `die` there would only exit the subshell and
    # let the install continue past a broken file — instead we record each
    # mismatch to a marker file and `die` in the current shell after the loop.
    mismatch="/tmp/qm_install_treechk.$$"
    rm -f "$mismatch"
    find "$src" -type f | while IFS= read -r sf; do
        rel=${sf#"$src"/}
        df="$dst/$rel"
        sb=$(wc -c < "$sf" 2>/dev/null | tr -d ' ')
        db=$(wc -c < "$df" 2>/dev/null | tr -d ' ')
        if [ "$sb" != "$db" ]; then
            printf '%s (src=%s dst=%s)\n' "$rel" "$sb" "$db" >> "$mismatch"
        fi
    done
    if [ -f "$mismatch" ]; then
        _log_raw "install_tree: truncated copies detected:"
        cat "$mismatch" >> "$LOG_FILE" 2>/dev/null || true
        rm -f "$mismatch"
        die "install_tree: $src -> $dst copy truncated (see $LOG_FILE)"
    fi

    # CRLF strip across the whole tree
    find "$dst" -type f -name "*.sh" | while IFS= read -r f; do
        if grep -q "$(printf '\r')" "$f" 2>/dev/null; then
            tr -d '\r' < "$f" > "$f.lf" && mv "$f.lf" "$f"
        fi
    done

    find "$dst" -type f -name "*.sh" -exec chmod 755 {} \;
    find "$dst" -type f ! -name "*.sh" -exec chmod 644 {} \;

    return 0
}

# --- Pre-flight --------------------------------------------------------------

detect_modem_firmware() {
    local atcli="" raw="" detected="" cache

    # Prefer an existing atcli binary, fall back to the bundled one.
    if [ -x "$BIN_DIR/atcli_smd11" ]; then
        atcli="$BIN_DIR/atcli_smd11"
    elif [ -f "$SRC_DEPS/atcli_smd11" ]; then
        chmod 755 "$SRC_DEPS/atcli_smd11" 2>/dev/null || true
        [ -x "$SRC_DEPS/atcli_smd11" ] && atcli="$SRC_DEPS/atcli_smd11"
    fi

    if [ -n "$atcli" ]; then
        raw=$(run_capture_timeout 8 "$atcli" 'ATI' 2>/dev/null || true)

        detected=$(printf '%s\n' "$raw" \
            | tr -d '\r' \
            | sed -n 's/^VERSION:[[:space:]]*//p' \
            | head -n1)

        if [ -z "$detected" ]; then
            detected=$(printf '%s\n' "$raw" | tr -d '\r' | grep -E 'RM[0-9]{3,}' | head -n1)
        fi

        if [ -z "$detected" ]; then
            raw=$(run_capture_timeout 8 "$atcli" 'AT+GMR' 2>/dev/null || true)
            detected=$(printf '%s\n' "$raw" | tr -d '\r' | grep -E 'RM[0-9]{3,}' | head -n1)
        fi
    fi

    # Cache fallback: on upgrade, /dev/smd11 may be temporarily busy, but the
    # poller's cache file already contains the firmware string.
    if [ -z "$detected" ]; then
        for cache in /tmp/qmanager_status.json /etc/qmanager/status.json; do
            [ -f "$cache" ] || continue
            detected=$(tr -d '\r\n' < "$cache" \
                | sed -n 's/.*"device"[[:space:]]*:[[:space:]]*{[^}]*"firmware"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
            [ -n "$detected" ] && break
        done
    fi

    [ -n "$detected" ] || return 1
    printf '%s' "$detected"
    return 0
}

preflight() {
    step "Pre-flight checks"

    [ "$(id -u)" -eq 0 ] || die "This script must be run as root"

    if [ -f /etc/openwrt_release ]; then
        local distro
        distro=$(. /etc/openwrt_release && echo "$DISTRIB_DESCRIPTION")
        info "OpenWRT detected: $distro"
    else
        warn "Cannot detect OpenWRT — proceeding anyway"
    fi

    # Source dir sanity
    [ "$DO_FRONTEND" = "1" ] && [ ! -d "$SRC_FRONTEND" ] \
        && die "Frontend source not found: $SRC_FRONTEND"
    [ "$DO_BACKEND" = "1" ]  && [ ! -d "$SRC_SCRIPTS" ] \
        && die "Backend source not found: $SRC_SCRIPTS"
    [ "$DO_BACKEND" = "1" ]  && [ ! -d "$SRC_DEPS" ] \
        && die "Bundled deps not found: $SRC_DEPS"

    # Modem firmware detection
    if [ "$DO_FORCE" = "1" ]; then
        warn "Skipping modem firmware check (--force)"
        info "Pre-flight checks passed"
        return 0
    fi

    local fw
    fw=$(detect_modem_firmware || true)

    if [ -z "$fw" ]; then
        warn "Could not detect modem firmware (tried ATI/AT+GMR and cache)"
        warn "This usually means /dev/smd11 is busy or the modem is not responsive"
        if [ -t 0 ]; then
            printf "\n    Continue installation anyway? [y/N] "
            read -r answer
            case "$answer" in
                y|Y|yes|YES)
                    warn "Proceeding without firmware verification"
                    ;;
                *)
                    die "Installation aborted by user"
                    ;;
            esac
        else
            die "Firmware detection failed and shell is non-interactive. Use --force to override."
        fi
        info "Pre-flight checks passed"
        return 0
    fi

    local fw_norm
    fw_norm=$(printf '%s' "$fw" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')
    if ! printf '%s' "$fw_norm" | grep -q "$REQUIRED_FIRMWARE"; then
        die "Unsupported modem firmware: $fw (expected token: $REQUIRED_FIRMWARE)"
    fi

    info "Modem firmware: $fw"
    info "Signature check passed ($REQUIRED_FIRMWARE)"
    info "Pre-flight checks passed"
}

# --- Version Markers ---------------------------------------------------------

mark_version_pending() {
    # Writing the pending marker BEFORE touching the filesystem means that a
    # partial install leaves VERSION unchanged (old value) and VERSION.pending
    # present, which is a clear signal of an aborted upgrade for debugging.
    mkdir -p "$CONF_DIR"
    printf '%s' "$VERSION" > "$VERSION_PENDING"
    _log_raw "Marked pending version: $VERSION"
}

finalize_version() {
    if [ -f "$VERSION_PENDING" ]; then
        mv "$VERSION_PENDING" "$VERSION_FILE" 2>/dev/null \
            || printf '%s' "$VERSION" > "$VERSION_FILE"
    else
        printf '%s' "$VERSION" > "$VERSION_FILE"
    fi
    _log_raw "Finalized version file: $VERSION_FILE = $VERSION"
}

# --- Package Management ------------------------------------------------------

remove_conflicts() {
    step "Removing conflicting packages"

    conflict_pkg_installed() {
        local pkg="$1"
        local installed

        installed=$(opkg list-installed 2>>"$LOG_FILE") \
            || die "Failed to query installed packages via opkg"

        printf '%s\n' "$installed" | awk '{print $1}' | grep -qx "$pkg"
    }

    local any=0
    local failed=0
    for pkg in $CONFLICT_PACKAGES; do
        if conflict_pkg_installed "$pkg"; then
            any=1
            if opkg remove "$pkg" >>"$LOG_FILE" 2>&1; then
                info "Removed: $pkg"
            else
                warn "Could not remove $pkg normally, retrying with forced dependency removal"
                if opkg remove --force-removal-of-dependent-packages "$pkg" >>"$LOG_FILE" 2>&1; then
                    info "Removed with force-removal-of-dependent-packages: $pkg"
                elif opkg remove --force-depends "$pkg" >>"$LOG_FILE" 2>&1; then
                    info "Removed with force-depends: $pkg"
                else
                    warn "Could not remove $pkg even with force flags"
                    failed=1
                fi
            fi

            if conflict_pkg_installed "$pkg"; then
                warn "$pkg is still installed after removal attempts"
                failed=1
            fi
        fi
    done
    [ "$any" = "0" ] && info "No conflicting packages found"

    if [ "$failed" != "0" ]; then
        die "Conflicting packages must be removed before install can continue. Remove manually with: opkg remove sms-tool socat-at-bridge socat"
    fi

    return 0
}

install_packages() {
    step "Installing required packages"

    if run_with_spinner "Updating package lists" opkg update; then
        info "Package lists updated"
    else
        warn "opkg update failed — will try installing from cache"
    fi

    for pkg in $REQUIRED_PACKAGES; do
        if command -v "$(pkg_binary "$pkg")" >/dev/null 2>&1; then
            info "$pkg already installed"
        elif run_with_spinner "Installing $pkg" opkg install "$pkg"; then
            info "$pkg installed"
        else
            die "Failed to install required package: $pkg"
        fi
    done

    printf "\n"
    info "Optional packages available:"
    for pkg in $OPTIONAL_PACKAGES; do
        case "$pkg" in
            msmtp)           printf "    %-18s — email alerts\n" "$pkg" ;;
            ethtool)         printf "    %-18s — ethernet link speed control\n" "$pkg" ;;
            ookla-speedtest) printf "    %-18s — speed test\n" "$pkg" ;;
            *)               printf "    %-18s\n" "$pkg" ;;
        esac
    done

    local answer=""
    if [ -t 0 ]; then
        printf "\n  Install optional packages? [Y/n] "
        read -r answer || answer=""
    else
        info "Non-interactive shell — installing optional packages by default"
    fi

    case "$answer" in
        n|N|no|NO)
            info "Skipping optional packages"
            ;;
        *)
            for pkg in $OPTIONAL_PACKAGES; do
                if command -v "$(pkg_binary "$pkg")" >/dev/null 2>&1; then
                    info "$pkg already installed"
                elif run_with_spinner "Installing $pkg" opkg install "$pkg"; then
                    info "$pkg installed"
                else
                    warn "$pkg not available — feature will be disabled"
                fi
            done
            ;;
    esac
}

# --- Service Management (filesystem-driven) ----------------------------------

# Stop all QManager services. Order matters here:
#
#   1. Touch the watchcat lock file FIRST. Watchcat checks this at the top
#      of its main loop and enters LOCKED state, skipping all escalation
#      tiers. Without this guard, watchcat would observe the disruption
#      caused by stopping the poller / DPI / etc, fail its connectivity
#      checks, and could escalate to Tier 4 (system reboot) mid-install.
#
#   2. Hard-kill watchcat (SIGKILL) BEFORE anything else. SIGKILL bypasses
#      the trap handler so even if watchcat was mid-execute_tier4 it can't
#      spawn the detached `( sleep 1 && reboot ) &` subshell.
#
#   3. Kill ALL other qmanager_* daemons (SIGTERM, brief drain, then
#      SIGKILL stragglers) BEFORE calling init.d stop. This is the key
#      fix: if procd's stop_service has to wait for a daemon that's
#      mid-AT-command, it can stall for tens of seconds per service. With
#      11 init.d scripts in series, the cumulative stall starves the
#      kernel hardware watchdog and the device reboots spontaneously
#      ~1-2 minutes into the install.
#
#   4. THEN call init.d stop on every qmanager* script. With daemons
#      already dead, procd's stop_service returns immediately — it just
#      runs the cleanup hooks (rm -f state files).
stop_services() {
    step "Stopping QManager services"

    # Step 1: Pause watchcat for the entire install window.
    # Note: the lock file mechanism was added in v0.1.15 — any pre-v0.1.15
    # watchcat binary on disk will ignore this file. That's why step 2 uses
    # init.d stop (to disable procd respawn) instead of relying on the lock.
    touch "$WATCHCAT_LOCK" 2>/dev/null || true
    info "Watchcat locked for install window"

    # Step 2: Stop watchcat FIRST via init.d so procd marks it stopped and
    # won't respawn it mid-install. Critical on upgrade paths where the
    # currently-running watchcat may be an older version that doesn't honour
    # the maintenance lock file — a respawned old-version instance can
    # observe the install disruption, fail its connectivity checks, and
    # escalate to Tier 4 (system reboot) before we've finished installing.
    if [ -x "$INITD_DIR/qmanager_watchcat" ]; then
        "$INITD_DIR/qmanager_watchcat" stop 2>>"$LOG_FILE" || true
    fi
    killall -9 qmanager_watchcat 2>/dev/null || true
    # Re-assert the lock in case an older init.d stop_service() hook
    # (pre-v0.1.15) removed /tmp/qmanager_watchcat.lock on the way out.
    touch "$WATCHCAT_LOCK" 2>/dev/null || true

    # Step 3: Stop every other qmanager* init.d service BEFORE killall'ing
    # daemons. procd-managed services (poller, ping, dpi, tower_failover,
    # bandwidth, etc.) would otherwise be respawned by procd after we kill
    # them, opening the same race window as watchcat. Running init.d stop
    # first tells procd the service should be stopped — it won't respawn.
    if [ -d "$INITD_DIR" ]; then
        for svc in "$INITD_DIR"/qmanager*; do
            [ -x "$svc" ] || continue
            # Watchcat was already stopped in step 2
            [ "$(basename "$svc")" = "qmanager_watchcat" ] && continue
            "$svc" stop 2>>"$LOG_FILE" || true
        done
        info "Stopped all init.d services"
    fi

    # Step 4: SIGTERM any qmanager_* daemons that slipped past init.d stop
    # (e.g. non-procd one-shot scripts, or processes that ignored SIGTERM).
    if [ -d "$BIN_DIR" ]; then
        for f in "$BIN_DIR"/qmanager_*; do
            [ -f "$f" ] || continue
            local pname
            pname="$(basename "$f")"
            # Never kill updater workers during OTA installs. If qmanager_update
            # (or qmanager_auto_update -> qmanager_update chain) is terminated
            # here, OTA status can be left stuck at "installing" with no reboot.
            case "$pname" in
                qmanager_update|qmanager_auto_update) continue ;;
            esac
            killall "$pname" 2>/dev/null || true
        done
    fi
    for p in bridge_traffic_monitor_rm551 websocat nfqws; do
        killall "$p" 2>/dev/null || true
    done

    # Brief drain so daemons can flush state files via their EXIT traps
    sleep 1

    # Step 5: SIGKILL stragglers — anything still alive after the drain
    if [ -d "$BIN_DIR" ]; then
        for f in "$BIN_DIR"/qmanager_*; do
            [ -f "$f" ] || continue
            local pname
            pname="$(basename "$f")"
            case "$pname" in
                qmanager_update|qmanager_auto_update) continue ;;
            esac
            killall -9 "$pname" 2>/dev/null || true
        done
    fi
    for p in bridge_traffic_monitor_rm551 websocat nfqws; do
        killall -9 "$p" 2>/dev/null || true
    done

    info "All services stopped"
}

seed_uci_defaults() {
    step "Seeding UCI defaults"

    # Force Tailscale Fixes — opt-in toggle, default OFF. Re-enables the
    # historical fw4 zone + mwan3 ipset workarounds for tailscale0 on top of
    # any firmware that already handles routing (sdxpinn-patch). Recommended
    # for R02 firmware users where outbound reply packets get marked for WAN
    # egress and never traverse the tunnel. Owned by system/settings.sh and
    # the qmanager_vpn_zone boot self-heal.
    if ! uci -q get quecmanager.tailscale_workarounds >/dev/null 2>&1; then
        uci set quecmanager.tailscale_workarounds=tailscale_workarounds
    fi
    if ! uci -q get quecmanager.tailscale_workarounds.enabled >/dev/null 2>&1; then
        uci set quecmanager.tailscale_workarounds.enabled=0
        info "Seeded quecmanager.tailscale_workarounds.enabled=0 (off by default)"
    else
        info "quecmanager.tailscale_workarounds.enabled already set — preserving user choice"
    fi

    # Connection Quality — ping profile (drives qmanager_ping interval +
    # fail/recover thresholds and the 2 HTTP probe targets). The profile NAME
    # is the only knob persisted; the daemon holds the profile->params table.
    # Seed concrete, user-editable defaults. NOTE: quality_thresholds is
    # deliberately NOT seeded — its absence is the "default" signal that drives
    # the frontend isDefault hint and the tolerant/tolerant fallback in the
    # poller + quality_thresholds.sh CGI.
    if ! uci -q get quecmanager.ping_profile >/dev/null 2>&1; then
        uci set quecmanager.ping_profile=ping_profile
    fi
    if ! uci -q get quecmanager.ping_profile.profile >/dev/null 2>&1; then
        uci set quecmanager.ping_profile.profile='relaxed'
        info "Seeded quecmanager.ping_profile.profile=relaxed"
    else
        info "quecmanager.ping_profile.profile already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.ping_profile.target_1 >/dev/null 2>&1; then
        uci set quecmanager.ping_profile.target_1='http://cp.cloudflare.com/'
        info "Seeded quecmanager.ping_profile.target_1=http://cp.cloudflare.com/"
    else
        info "quecmanager.ping_profile.target_1 already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.ping_profile.target_2 >/dev/null 2>&1; then
        uci set quecmanager.ping_profile.target_2='http://www.gstatic.com/generate_204'
        info "Seeded quecmanager.ping_profile.target_2=http://www.gstatic.com/generate_204"
    else
        info "quecmanager.ping_profile.target_2 already set — preserving user choice"
    fi

    # Upgrade migration — the seeded probe targets were the old heavy HTTPS root
    # pages (https://cloudflare.com / https://google.com). Those fold DNS + TCP
    # + server TTFB into the reported latency (~3.3× real RTT) and hard-fail
    # (curl 000) on weak signal, registering phantom packet loss. Migrate ONLY
    # the exact old seeded values to the lightweight HTTP probe pages the daemon
    # now reports TCP-connect RTT against. A user-customized target (any other
    # value) is sacred and never touched. uci commit happens once at the end of
    # this function; touch the reload flag so a running daemon re-reads.
    _ping_migrated=0
    if [ "$(uci -q get quecmanager.ping_profile.target_1 2>/dev/null)" = "https://cloudflare.com" ]; then
        uci set quecmanager.ping_profile.target_1='http://cp.cloudflare.com/'
        info "Migrated ping target_1: https://cloudflare.com -> http://cp.cloudflare.com/"
        _ping_migrated=1
    fi
    if [ "$(uci -q get quecmanager.ping_profile.target_2 2>/dev/null)" = "https://google.com" ]; then
        uci set quecmanager.ping_profile.target_2='http://www.gstatic.com/generate_204'
        info "Migrated ping target_2: https://google.com -> http://www.gstatic.com/generate_204"
        _ping_migrated=1
    fi
    if [ "$_ping_migrated" = "1" ]; then
        touch /tmp/qmanager_ping_reload
        info "Dropped /tmp/qmanager_ping_reload — running ping daemon will pick up migrated targets"
    fi

    # Connection Watchdog (watchcat) — connection-quality trigger keys. The
    # full watchcat section is otherwise seeded lazily by the watchdog.sh CGI
    # (ensure_watchcat_config) on first read; seed only the quality keys here
    # so fresh installs match that contract. Idempotent + preserve-user-choice,
    # same shape as the blocks above. Defaults: quality off, 800ms / 20% / 5.
    if ! uci -q get quecmanager.watchcat >/dev/null 2>&1; then
        uci set quecmanager.watchcat=watchcat
    fi
    if ! uci -q get quecmanager.watchcat.quality_enabled >/dev/null 2>&1; then
        uci set quecmanager.watchcat.quality_enabled=0
        info "Seeded quecmanager.watchcat.quality_enabled=0 (off by default)"
    else
        info "quecmanager.watchcat.quality_enabled already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.watchcat.latency_ceiling_ms >/dev/null 2>&1; then
        uci set quecmanager.watchcat.latency_ceiling_ms=800
        info "Seeded quecmanager.watchcat.latency_ceiling_ms=800"
    else
        info "quecmanager.watchcat.latency_ceiling_ms already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.watchcat.loss_ceiling_pct >/dev/null 2>&1; then
        uci set quecmanager.watchcat.loss_ceiling_pct=20
        info "Seeded quecmanager.watchcat.loss_ceiling_pct=20"
    else
        info "quecmanager.watchcat.loss_ceiling_pct already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.watchcat.quality_consecutive >/dev/null 2>&1; then
        uci set quecmanager.watchcat.quality_consecutive=5
        info "Seeded quecmanager.watchcat.quality_consecutive=5"
    else
        info "quecmanager.watchcat.quality_consecutive already set — preserving user choice"
    fi

    # SMS Forwarding — opt-in inbound-SMS relay daemon (qmanager_sms_forward,
    # gated via UCI_GATED_SERVICES so install never force-enables it). Seed the
    # section + concrete defaults so a fresh install has a stable shape. Disabled
    # by default; empty target. Idempotent + preserve-user-choice across upgrade.
    if ! uci -q get quecmanager.sms_forwarding >/dev/null 2>&1; then
        uci set quecmanager.sms_forwarding=sms_forwarding
    fi
    if ! uci -q get quecmanager.sms_forwarding.enabled >/dev/null 2>&1; then
        uci set quecmanager.sms_forwarding.enabled='0'
        info "Seeded quecmanager.sms_forwarding.enabled=0 (off by default)"
    else
        info "quecmanager.sms_forwarding.enabled already set — preserving user choice"
    fi
    if ! uci -q get quecmanager.sms_forwarding.target_phone >/dev/null 2>&1; then
        uci set quecmanager.sms_forwarding.target_phone=''
        info "Seeded quecmanager.sms_forwarding.target_phone=''"
    else
        info "quecmanager.sms_forwarding.target_phone already set — preserving user choice"
    fi

    # Call Forwarding (removed) — drop the stale section on upgrade from a build
    # that seeded quecmanager.call_forwarding. Harmless no-op on fresh installs.
    if uci -q get quecmanager.call_forwarding >/dev/null 2>&1; then
        uci -q delete quecmanager.call_forwarding 2>/dev/null
        info "Removed retired quecmanager.call_forwarding section"
    fi

    uci commit quecmanager 2>/dev/null || warn "uci commit quecmanager failed"
}

enable_services() {
    step "Enabling init.d services"

    # Every qmanager* service gets enabled unconditionally UNLESS it is in
    # UCI_GATED_SERVICES. Gated services are only enabled if a prior install
    # had them enabled (detected via /etc/rc.d symlink presence).
    for svc in "$INITD_DIR"/qmanager*; do
        [ -x "$svc" ] || continue
        local name
        name="$(basename "$svc")"

        local gated=0
        for g in $UCI_GATED_SERVICES; do
            [ "$name" = "$g" ] && gated=1 && break
        done

        if [ "$gated" = "0" ]; then
            "$svc" enable >>"$LOG_FILE" 2>&1 || warn "Failed to enable $name"
            info "Enabled $name"
            continue
        fi

        local was_enabled=0
        for rc in /etc/rc.d/*"$name"*; do
            [ -e "$rc" ] && was_enabled=1 && break
        done

        if [ "$was_enabled" = "1" ]; then
            "$svc" enable >>"$LOG_FILE" 2>&1 || warn "Failed to enable $name"
            info "Enabled $name (preserving previous state)"
        else
            info "Skipped $name (UCI-gated, enable manually if needed)"
        fi
    done
}

start_services() {
    step "Starting QManager services"

    if [ -x "$INITD_DIR/qmanager" ]; then
        "$INITD_DIR/qmanager" start >>"$LOG_FILE" 2>&1 \
            || warn "Failed to start main qmanager service"
        info "Started main qmanager service"
    fi
}

# --- File Install Steps ------------------------------------------------------

backup_originals() {
    step "Backing up original files"

    mkdir -p "$BACKUP_DIR"

    if [ ! -f "$WWW_ROOT/index.html.old" ] && [ -f "$WWW_ROOT/index.html" ]; then
        if grep -q "QManager" "$WWW_ROOT/index.html" 2>/dev/null; then
            info "Existing index.html is already QManager — skipping backup"
        else
            mv "$WWW_ROOT/index.html" "$WWW_ROOT/index.html.old"
            info "Backed up /www/index.html -> index.html.old"
        fi
    elif [ -f "$WWW_ROOT/index.html.old" ]; then
        info "Original index.html.old already preserved"
    else
        info "No existing index.html to back up"
    fi

    if [ -f "$CONF_DIR/auth.json" ]; then
        local ts
        ts=$(date +%Y%m%d_%H%M%S)
        cp "$CONF_DIR/auth.json" "$BACKUP_DIR/auth.json.$ts" 2>/dev/null || true
        info "Backed up password hash ($BACKUP_DIR/auth.json.$ts)"
    fi
}

install_frontend() {
    step "Installing frontend"

    # Wipe /www/* except preserved items (intentional per project decision)
    for item in "$WWW_ROOT"/*; do
        [ -e "$item" ] || continue
        local name
        name="$(basename "$item")"
        case "$name" in
            cgi-bin|luci-static|index.html.old) continue ;;
            *) rm -rf "$item" ;;
        esac
    done

    cp -r "$SRC_FRONTEND"/. "$WWW_ROOT"/ || die "Failed to copy frontend to $WWW_ROOT"

    local n
    n=$(count_files "$SRC_FRONTEND")
    info "Frontend installed ($n files)"
}

install_backend() {
    step "Installing backend scripts"

    # --- Libraries (flat directory) ---
    if [ -d "$SRC_SCRIPTS/usr/lib/qmanager" ]; then
        local lib_count
        lib_count=$(install_dir_flat "$SRC_SCRIPTS/usr/lib/qmanager" "$LIB_DIR" 755)
        # Non-.sh files in the lib dir should be 644
        find "$LIB_DIR" -maxdepth 1 -type f ! -name "*.sh" -exec chmod 644 {} \; 2>/dev/null
        info "Libraries: $lib_count files -> $LIB_DIR"
    fi

    # --- Daemons and utilities (flat) ---
    if [ -d "$SRC_SCRIPTS/usr/bin" ]; then
        local bin_count
        bin_count=$(install_dir_flat "$SRC_SCRIPTS/usr/bin" "$BIN_DIR" 755)
        info "Daemons: $bin_count files -> $BIN_DIR"
    fi

    # --- CGI endpoints (recursive) ---
    if [ -d "$SRC_SCRIPTS/www/cgi-bin/quecmanager" ]; then
        install_tree "$SRC_SCRIPTS/www/cgi-bin/quecmanager" "$CGI_DIR"
        local cgi_count
        cgi_count=$(find "$CGI_DIR" -name "*.sh" -type f 2>/dev/null | wc -l | tr -d ' ')
        info "CGI endpoints: $cgi_count scripts -> $CGI_DIR"
    fi

    # --- Init.d services (flat) ---
    if [ -d "$SRC_SCRIPTS/etc/init.d" ]; then
        local svc_count
        svc_count=$(install_dir_flat "$SRC_SCRIPTS/etc/init.d" "$INITD_DIR" 755)
        info "Init.d: $svc_count services -> $INITD_DIR"
    fi

    # --- nftables.d files (persistent firewall rules) ---
    if [ -d "$SRC_SCRIPTS/etc/nftables.d" ]; then
        mkdir -p /etc/nftables.d
        local nft_count=0
        for f in "$SRC_SCRIPTS/etc/nftables.d"/*.nft; do
            [ -f "$f" ] || continue
            local fname
            fname="$(basename "$f")"
            if install_file "$f" "/etc/nftables.d/$fname" 644; then
                nft_count=$(( nft_count + 1 ))
            fi
        done
        info "nftables.d: $nft_count rule files -> /etc/nftables.d"
        # Trigger fw4 reload so rules take effect on running system (OTA --no-reboot path)
        if command -v fw4 >/dev/null 2>&1; then
            fw4 reload >/dev/null 2>&1 || true
        fi
    fi

    # --- Required runtime directories ---
    mkdir -p "$CONF_DIR/profiles" "$SESSION_DIR" "$UPDATES_DIR" /var/lock

    # --- Default config files (deploy ONLY if missing, never overwrite) ---
    # Exception: supported_bands_hw.env is a manually-maintained spec-sheet file
    # that MUST refresh on every upgrade, so it is force-copied below (outside the
    # deploy-if-missing loop) rather than treated as user-owned config.
    if [ -d "$SRC_SCRIPTS/etc/qmanager" ]; then
        local deployed=0
        for f in "$SRC_SCRIPTS/etc/qmanager"/*; do
            [ -f "$f" ] || continue
            local fname
            fname="$(basename "$f")"
            [ "$fname" = "supported_bands_hw.env" ] && continue
            if [ ! -f "$CONF_DIR/$fname" ]; then
                cp "$f" "$CONF_DIR/$fname"
                deployed=$(( deployed + 1 ))
                info "  Deployed default config: $fname"
            fi
        done
        [ "$deployed" = "0" ] && info "  All default configs already present"

        # Force-copy the hardware band-capability file every install/upgrade so
        # spec/firmware edits in the repo always reach the device.
        if [ -f "$SRC_SCRIPTS/etc/qmanager/supported_bands_hw.env" ]; then
            cp "$SRC_SCRIPTS/etc/qmanager/supported_bands_hw.env" "$CONF_DIR/supported_bands_hw.env"
            info "  Force-deployed hardware band capability: supported_bands_hw.env"
        fi
    fi

    # UCI config stub
    [ -f /etc/config/quecmanager ] || touch /etc/config/quecmanager

    info "Backend installed"
}

install_bundled_binaries() {
    step "Installing bundled binaries (atcli_smd11, sms_tool)"

    [ -d "$SRC_DEPS" ] || die "Bundled dependencies not found: $SRC_DEPS"

    for bin in atcli_smd11 sms_tool; do
        local src="$SRC_DEPS/$bin"
        local dst="$BIN_DIR/$bin"

        [ -f "$src" ] || die "Missing required binary: dependencies/$bin"

        if ! install_file "$src" "$dst" 755; then
            die "Failed to install $bin (file busy? Ensure stop_services ran first)"
        fi
        info "Installed $bin -> $dst"
    done

    # Smoke test (warn-only — modem may not be ready yet on fresh hardware)
    local smoke
    smoke=$(run_capture_timeout 5 atcli_smd11 'AT' 2>/dev/null || true)
    if printf '%s\n' "$smoke" | grep -q OK; then
        info "atcli_smd11 smoke test passed"
    else
        warn "atcli_smd11 smoke test did not return OK — check /dev/smd11"
    fi
}

# --- Tailscale Firewall Zone Migration ---------------------------------------
# Removes the legacy 'tailscale' fw4 zone and its forwarding rules from UCI.
# Pre-sdxpinn-patch QManager builds added this zone to make the modem reachable
# over Tailscale's magic IP (100.x.x.x). The patched RM551E firmware now
# handles routing/firewall for tailscale0 on its own, so the zone is dead
# config and is removed unconditionally on every install.
# Idempotent — fast no-op when no 'tailscale' zone exists (the steady state).
#
# EXCEPTION: when the user has explicitly opted into Force Tailscale Fixes
# (quecmanager.tailscale_workarounds.enabled=1), this migration is skipped —
# the zone is what the user asked to keep. The opt-in path owns lifecycle of
# the zone via system/settings.sh + qmanager_vpn_zone.

migrate_tailscale_firewall_zone() {
    step "Migrating legacy Tailscale firewall zone"

    if ! command -v uci >/dev/null 2>&1; then
        info "uci not available — skipping firewall zone migration"
        return 0
    fi

    if [ "$(uci -q get quecmanager.tailscale_workarounds.enabled 2>/dev/null)" = "1" ]; then
        info "Force Tailscale Fixes enabled — preserving Tailscale firewall zone"
        return 0
    fi

    # Find a 'tailscale' named zone in UCI
    local found=0
    local i=0
    local val
    while true; do
        val=$(uci -q get "firewall.@zone[$i].name") || break
        if [ "$val" = "tailscale" ]; then
            found=1
            break
        fi
        i=$((i + 1))
    done

    if [ "$found" = "0" ]; then
        info "No legacy Tailscale firewall zone present"
        return 0
    fi

    info "Removing legacy Tailscale firewall zone and forwarding rules"

    # Collect forwarding indices in reverse order (delete tail-first so the
    # in-place index renumber done by uci doesn't shift our remaining targets).
    # Only break on src lookup failure (end-of-list). A missing dest is
    # treated as a non-match so manual or partial UCI edits don't truncate
    # the scan early.
    local fwd_indices=""
    local src
    local dest
    i=0
    while true; do
        src=$(uci -q get "firewall.@forwarding[$i].src") || break
        dest=$(uci -q get "firewall.@forwarding[$i].dest" 2>/dev/null || echo "")
        if [ "$src" = "tailscale" ] || [ "$dest" = "tailscale" ]; then
            fwd_indices="$i $fwd_indices"
        fi
        i=$((i + 1))
    done
    for idx in $fwd_indices; do
        uci delete "firewall.@forwarding[$idx]" 2>/dev/null || true
    done

    # Remove the zone itself
    i=0
    while true; do
        val=$(uci -q get "firewall.@zone[$i].name") || break
        if [ "$val" = "tailscale" ]; then
            uci delete "firewall.@zone[$i]" 2>/dev/null || true
            break
        fi
        i=$((i + 1))
    done

    if ! uci commit firewall 2>/dev/null; then
        warn "uci commit firewall failed — legacy Tailscale zone may persist until next reboot"
        return 0
    fi

    # Best-effort: drop the dead mwan3 ipset entry if NetBird is NOT installed.
    # When NetBird is present, its CGI/init.d will re-assert the entry — there
    # is no ordering guarantee here, so we only clear when no consumer remains.
    # Ipset entries are in-kernel only, harmless if absent.
    if ! command -v netbird >/dev/null 2>&1; then
        if command -v ipset >/dev/null 2>&1 && \
           ipset list mwan3_connected_ipv4 >/dev/null 2>&1; then
            ipset del mwan3_connected_ipv4 100.64.0.0/10 2>/dev/null || true
        fi
    fi

    # Restart firewall so the deletions take effect immediately. The default
    # install path ends with a reboot, which would also achieve this — but the
    # OTA path uses --no-reboot, where this restart matters.
    /etc/init.d/firewall restart >/dev/null 2>&1 || true

    info "Legacy Tailscale firewall zone removed"
}

# --- Tailscale Package Migration ---------------------------------------------
# Migrates from legacy {tailscale, tailscaled, luci-app-tailscale} to
# {tailscale-tiny, luci-app-tailscale-community-tiny}.
#
# - Preserves the user's node identity by copying the state file from
#   /var/lib/tailscale/tailscaled.state to /etc/tailscale/tailscaled.state
#   BEFORE removing legacy packages.
# - Restores the prior boot-enable + run state after the swap.
# - Lock-protected so concurrent CGI install/uninstall POSTs back off cleanly.
# - Reliability over speed: aborts before opkg remove if state copy fails.
# Idempotent — fast no-op when already on tiny or no Tailscale installed.

migrate_tailscale_packages() {
    step "Migrating Tailscale to community-tiny"

    if ! command -v opkg >/dev/null 2>&1; then
        info "opkg not available — skipping Tailscale package migration"
        return 0
    fi

    # Official (static-tarball) installs are owned by the tailscale.sh CGI, not
    # opkg. They carry a marker file and have no opkg package entry to migrate —
    # skip entirely so this never tries to opkg-swap a tarball install.
    if [ "$(cat /etc/tailscale/.qm_install_method 2>/dev/null | tr -d ' \n\r')" = "official" ]; then
        info "Official (tarball) Tailscale install detected — skipping opkg migration"
        return 0
    fi

    local lock="/var/lock/qmanager_tailscale_migrate.lock"
    if ! ( set -C; echo $$ > "$lock" ) 2>/dev/null; then
        warn "Tailscale migration lock held by another process — skipping"
        return 0
    fi
    trap 'rm -f "$lock"' EXIT INT TERM

    local installed
    installed=$(opkg list-installed 2>/dev/null | awk '{print $1}')

    local has_legacy=0
    local has_tiny=0
    echo "$installed" | grep -qE '^(tailscale|tailscaled|luci-app-tailscale)$' && has_legacy=1 || true
    echo "$installed" | grep -qE '^(tailscale-tiny|luci-app-tailscale-community-tiny)$' && has_tiny=1 || true

    if [ "$has_legacy" = "0" ] && [ "$has_tiny" = "0" ]; then
        info "Tailscale not installed — nothing to migrate"
        rm -f "$lock"; trap - EXIT INT TERM
        return 0
    fi

    if [ "$has_legacy" = "0" ] && [ "$has_tiny" = "1" ]; then
        info "Already on tailscale-tiny — nothing to migrate"
        rm -f "$lock"; trap - EXIT INT TERM
        return 0
    fi

    if [ "$has_legacy" = "1" ] && [ "$has_tiny" = "1" ]; then
        warn "Both legacy and tiny packages present — opkg conflict, manual cleanup required"
        rm -f "$lock"; trap - EXIT INT TERM
        return 0
    fi

    # ---- has_legacy=1, has_tiny=0 → MIGRATE ---------------------------------
    info "Legacy Tailscale detected — migrating to community-tiny"

    # Wait for any in-flight opkg operation to release its lock (≤30s).
    local waited=0
    while [ -f /var/lock/opkg.lock ] && [ "$waited" -lt 30 ]; do
        sleep 1
        waited=$((waited + 1))
    done
    if [ -f /var/lock/opkg.lock ]; then
        warn "opkg lock still held after 30s — aborting Tailscale migration"
        rm -f "$lock"; trap - EXIT INT TERM
        return 1
    fi

    # Snapshot prior state.
    local was_boot_enabled
    local was_running
    was_boot_enabled=$(uci -q get tailscale.@tailscale[0].enabled 2>/dev/null)
    [ "$was_boot_enabled" = "1" ] || was_boot_enabled="0"
    if pidof tailscaled >/dev/null 2>&1; then
        was_running=1
    else
        was_running=0
    fi
    info "Prior state: boot_enabled=$was_boot_enabled running=$was_running"

    # Stop daemon.
    [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale stop >/dev/null 2>&1 || true

    # Poll for tailscaled to actually exit (≤10s), then SIGKILL.
    waited=0
    while pidof tailscaled >/dev/null 2>&1 && [ "$waited" -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
    done
    if pidof tailscaled >/dev/null 2>&1; then
        warn "tailscaled did not exit cleanly — sending SIGKILL"
        killall -9 tailscaled 2>/dev/null
        sleep 1
    fi

    # Clear /etc/rc.d symlinks so the legacy init script doesn't re-trigger.
    [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale disable >/dev/null 2>&1 || true

    # Copy the state file BEFORE opkg remove. If this fails we abort with
    # legacy intact — user retries via UI later.
    if [ -s /var/lib/tailscale/tailscaled.state ]; then
        if ! mkdir -p /etc/tailscale 2>/dev/null; then
            warn "Failed to create /etc/tailscale — aborting migration (legacy intact)"
            rm -f "$lock"; trap - EXIT INT TERM
            return 1
        fi
        if ! cp -p /var/lib/tailscale/tailscaled.state /etc/tailscale/tailscaled.state 2>/dev/null; then
            warn "Failed to copy Tailscale state file — aborting migration (legacy intact)"
            rm -f "$lock"; trap - EXIT INT TERM
            return 1
        fi
        info "Tailscale state file copied to /etc/tailscale/tailscaled.state"
    else
        info "No Tailscale state file to migrate (device was never connected)"
    fi

    # Swap packages.
    if ! opkg remove luci-app-tailscale tailscale tailscaled >/dev/null 2>&1; then
        warn "opkg remove of legacy Tailscale packages reported errors — continuing"
    fi
    if ! opkg install luci-app-tailscale-community-tiny >/dev/null 2>&1; then
        warn "opkg install luci-app-tailscale-community-tiny FAILED — Tailscale uninstalled, state preserved in /etc/tailscale/"
        rm -f "$lock"; trap - EXIT INT TERM
        return 1
    fi

    # Restore boot-enable.
    if [ "$was_boot_enabled" = "1" ]; then
        uci -q set tailscale.settings.service_enabled='1' 2>/dev/null
        uci -q commit tailscale 2>/dev/null
        [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale enable >/dev/null 2>&1 || true
    fi

    # Restore run state.
    if [ "$was_running" = "1" ] || [ "$was_boot_enabled" = "1" ]; then
        [ -x /etc/init.d/tailscale ] && /etc/init.d/tailscale start >/dev/null 2>&1 || true
    fi

    # Clean up legacy state dir.
    rm -rf /var/lib/tailscale 2>/dev/null

    rm -f "$lock"; trap - EXIT INT TERM
    info "Tailscale migration complete"
    return 0
}

# Refreshes the official-variant Tailscale procd init script so its stop hook
# no longer runs `tailscale down` (which persisted WantRunning=false and
# stranded the node disconnected across reboots). Existing official installs
# carry the old init on disk; the CGI heredoc fix only affects fresh installs,
# so OTA upgrades self-heal here. OFFICIAL VARIANT ONLY — no-op for tiny/opkg
# or any install without the marker. Idempotent.
migrate_tailscale_initd_boot_fix() {
    [ "$(cat /etc/tailscale/.qm_install_method 2>/dev/null | tr -d ' \n\r')" = "official" ] || return 0
    if [ ! -f /usr/lib/qmanager/tailscale_initd.sh ]; then
        warn "Official Tailscale init refresh skipped — tailscale_initd.sh lib missing"
        return 0
    fi
    . /usr/lib/qmanager/tailscale_initd.sh
    qm_write_ts_initd
    info "Refreshed official Tailscale init script (boot-reconnect fix)"
}

# --- Cleanup Legacy ----------------------------------------------------------
# Removes qmanager_* files on disk that are NOT in the fresh source tree.
# This is the ONLY place where legacy cleanup happens — integrated into the
# install path rather than a separate pass.

cleanup_legacy_scripts() {
    step "Cleaning up legacy scripts"

    local removed=0 fname

    # Retire the legacy qmanager_wan_guard daemon (removed in this version). OTA
    # overlays do not prune absent-from-tree files, so remove it explicitly on
    # upgraded devices. Idempotent — silent no-op on fresh installs. The generic
    # loops below would also catch it, but this guarantees the running daemon is
    # stopped and the binary gone before enable_services runs.
    if [ -f "$INITD_DIR/qmanager_wan_guard" ]; then
        "$INITD_DIR/qmanager_wan_guard" stop 2>/dev/null || true
        "$INITD_DIR/qmanager_wan_guard" disable 2>/dev/null || true
        rm -f "$INITD_DIR/qmanager_wan_guard"
        info "  Retired legacy daemon: qmanager_wan_guard"
    fi
    rm -f "$BIN_DIR/qmanager_wan_guard"
    rm -f /etc/rc.d/*qmanager_wan_guard 2>/dev/null || true

    # Retire orphaned Wake-on-LAN UCI flag (WoL feature removed). Key-only
    # delete — preserves the quecmanager.network section in case a SKU adds
    # sibling keys. The qmanager_wol_fix init.d is auto-pruned by the stale
    # init.d loop below; wol.sh CGI is harmless if it lingers.
    uci -q delete quecmanager.network.disable_wol 2>/dev/null && uci -q commit quecmanager 2>/dev/null || true

    # Daemons: /usr/bin/qmanager_*, qcmd, bridge_traffic_monitor_*
    for f in "$BIN_DIR"/qmanager_* "$BIN_DIR/qcmd" "$BIN_DIR"/bridge_traffic_monitor_*; do
        [ -f "$f" ] || continue
        fname="$(basename "$f")"
        [ -f "$SRC_SCRIPTS/usr/bin/$fname" ] && continue
        rm -f "$f"
        info "  Removed legacy daemon: $fname"
        removed=$(( removed + 1 ))
    done

    # Init.d services
    for f in "$INITD_DIR"/qmanager*; do
        [ -f "$f" ] || continue
        fname="$(basename "$f")"
        [ -f "$SRC_SCRIPTS/etc/init.d/$fname" ] && continue
        "$f" disable 2>/dev/null || true
        "$f" stop 2>/dev/null || true
        rm -f "$f"
        for _link in /etc/rc.d/*"$fname"*; do
            [ -e "$_link" ] && rm -f "$_link"
        done
        info "  Removed legacy service: $fname"
        removed=$(( removed + 1 ))
    done

    # Libraries
    if [ -d "$LIB_DIR" ]; then
        for f in "$LIB_DIR"/*; do
            [ -f "$f" ] || continue
            fname="$(basename "$f")"
            [ -f "$SRC_SCRIPTS/usr/lib/qmanager/$fname" ] && continue
            rm -f "$f"
            info "  Removed legacy library: $fname"
            removed=$(( removed + 1 ))
        done
    fi

    if [ "$removed" = "0" ]; then
        info "No legacy scripts found"
    else
        info "Removed $removed legacy file(s)"
    fi
}

# --- Post-install Health Check -----------------------------------------------

health_check() {
    step "Post-install health check"

    sleep 2

    local poller_pid
    local ping_pid
    poller_pid=$(pidof qmanager_poller 2>/dev/null || true)
    ping_pid=$(pidof qmanager_ping 2>/dev/null || true)

    if [ -n "$poller_pid" ]; then
        info "Poller running (PID: $poller_pid)"
    else
        warn "Poller does not appear to be running"
    fi

    if [ -n "$ping_pid" ]; then
        info "Ping daemon running (PID: $ping_pid)"
    else
        warn "Ping daemon does not appear to be running"
    fi

    # Wait up to 10s for the poller to produce its status cache. Stronger
    # health signal than just pidof.
    local i=0
    while [ "$i" -lt 10 ]; do
        if [ -f /tmp/qmanager_status.json ]; then
            info "Poller status cache is live (/tmp/qmanager_status.json)"
            return 0
        fi
        sleep 1
        i=$(( i + 1 ))
    done

    warn "Poller did not produce /tmp/qmanager_status.json within 10s"
    warn "Service may still be initializing — check /tmp/qmanager.log"
}

# --- AT Stack Verification ---------------------------------------------------
# Runs at the very end of install, before reboot, to confirm that the full AT
# command pipeline (qcmd → atcli_smd11 → /dev/smd11) is working. This catches
# the scenario where install "succeeds" but AT commands are silently broken
# (e.g., leftover conflicting process holding /dev/smd11, wrong binary, perms).
# Warn-only with retries — fresh hardware may need a few seconds after services
# start before the modem accepts AT traffic on /dev/smd11.

at_stack_check() {
    step "Verifying AT command stack (qcmd ATI)"

    if ! command -v qcmd >/dev/null 2>&1; then
        warn "qcmd not found on PATH — skipping AT stack check"
        return 0
    fi

    local out="" i=0
    while [ "$i" -lt 3 ]; do
        out=$(run_capture_timeout 8 qcmd 'ATI' 2>/dev/null || true)
        if printf '%s\n' "$out" | grep -q '^OK'; then
            info "qcmd ATI → OK (AT stack verified)"
            local model
            model=$(printf '%s\n' "$out" | grep -iE 'quectel|RM[0-9]+|EG[0-9]+' | head -n1 | tr -d '\r')
            [ -n "$model" ] && info "Modem reports: $model"
            return 0
        fi
        i=$(( i + 1 ))
        [ "$i" -lt 3 ] && sleep 2
    done

    warn "qcmd ATI did not return OK after 3 attempts"
    warn "  Troubleshooting:"
    warn "    1. Check /dev/smd11 exists: ls -la /dev/smd11"
    warn "    2. Test directly:           atcli_smd11 'AT'"
    warn "    3. Check for conflicts:     opkg list-installed | grep -E 'sms-tool|socat'"
    warn "    4. Review install log:      $LOG_FILE"
    warn "  AT commands may start working once the modem finishes initializing."
    return 1
}

# --- Summary -----------------------------------------------------------------

print_summary() {
    printf "\n"
    if [ -t 1 ]; then
        printf "  [%s  100%%  Complete]\n" "$(_draw_bar "$TOTAL_STEPS" "$TOTAL_STEPS")"
    fi
    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${GREEN}${BOLD}  QManager - Installation Complete${NC}\n"
    printf "  ══════════════════════════════════════════\n\n"

    printf "  ${DIM}Version:     ${NC}%s\n" "$VERSION"
    [ "$DO_FRONTEND" = "1" ] && printf "  ${DIM}Frontend:    ${NC}%s\n" "$WWW_ROOT"
    if [ "$DO_BACKEND" = "1" ]; then
        printf "  ${DIM}CGI:         ${NC}%s\n" "$CGI_DIR"
        printf "  ${DIM}Libraries:   ${NC}%s\n" "$LIB_DIR"
        printf "  ${DIM}Daemons:     ${NC}%s/qmanager_*\n" "$BIN_DIR"
        printf "  ${DIM}Init.d:      ${NC}%s/qmanager*\n" "$INITD_DIR"
        printf "  ${DIM}Config:      ${NC}%s\n" "$CONF_DIR"
        printf "  ${DIM}Install log: ${NC}%s\n" "$LOG_FILE"
    fi

    printf "\n"
    printf "  ${DIM}Packages:${NC}\n"
    for pkg in $REQUIRED_PACKAGES $OPTIONAL_PACKAGES; do
        if command -v "$(pkg_binary "$pkg")" >/dev/null 2>&1; then
            printf "    ${GREEN}${ICO_OK}${NC}  %-18s installed\n" "$pkg"
        else
            printf "    ${YELLOW}${ICO_WARN}${NC}  %-18s missing\n" "$pkg"
        fi
    done

    printf "\n"
    local device_ip
    device_ip=$(uci get network.lan.ipaddr 2>/dev/null | cut -d'/' -f1 || echo "192.168.1.1")
    printf "  Open in browser:  ${BOLD}http://%s${NC}\n\n" "$device_ip"

    if [ ! -f "$CONF_DIR/auth.json" ]; then
        info "First-time setup: you will be prompted to create a password"
    fi
    printf "\n"
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
    die "Cannot find reboot command"
}

# --- Usage -------------------------------------------------------------------

usage() {
    cat <<EOF
QManager Installer $VERSION

Usage: sh install.sh [OPTIONS]

Options:
  --frontend-only    Only install frontend files
  --backend-only     Only install backend scripts
  --skip-packages    Skip opkg package install (used by OTA)
  --no-enable        Do not enable init.d services
  --no-start         Do not start services after install
  --no-reboot        Do not reboot after install (used by OTA)
  --force            Skip modem firmware detection
  --help, -h         Show this help

Archive layout:
  qmanager_install/
    install.sh         (this script)
    out/               (Next.js static export)
    scripts/           (backend tree)
    dependencies/      (bundled binaries)

Example:
  cd /tmp && tar xzf qmanager.tar.gz
  cd qmanager_install && sh install.sh
EOF
}

# --- Main --------------------------------------------------------------------

main() {
    # Always release the watchcat lock on exit so a failed install doesn't
    # leave watchcat permanently in LOCKED state. /tmp clears on reboot but
    # if the user retries without rebooting, a stale lock would brick
    # connectivity monitoring until next boot.
    trap 'rm -f "$WATCHCAT_LOCK" 2>/dev/null || true' EXIT INT TERM

    DO_FRONTEND=1
    DO_BACKEND=1
    DO_ENABLE=1
    DO_START=1
    DO_PACKAGES=1
    DO_REBOOT=1
    DO_FORCE=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --frontend-only) DO_FRONTEND=1; DO_BACKEND=0 ;;
            --backend-only)  DO_FRONTEND=0; DO_BACKEND=1 ;;
            --skip-packages) DO_PACKAGES=0 ;;
            --no-enable)     DO_ENABLE=0 ;;
            --no-start)      DO_START=0 ;;
            --no-reboot)     DO_REBOOT=0 ;;
            --force)         DO_FORCE=1 ;;
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

    # Compute total step count for the progress bar
    TOTAL_STEPS=1  # preflight
    TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))                                # remove_conflicts (always)
    [ "$DO_PACKAGES" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))    # install_packages
    TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))                                # stop_services
    if [ "$DO_FRONTEND" = "1" ]; then
        TOTAL_STEPS=$(( TOTAL_STEPS + 2 ))                            # backup + frontend
    fi
    if [ "$DO_BACKEND" = "1" ]; then
        TOTAL_STEPS=$(( TOTAL_STEPS + 7 ))                            # backend + bundled + cleanup + migrate_tailscale_fw + migrate_tailscale_pkg + migrate_tailscale_initd + seed
        [ "$DO_ENABLE" = "1" ] && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))  # enable
        if [ "$DO_START" = "1" ]; then
            TOTAL_STEPS=$(( TOTAL_STEPS + 3 ))                        # start + health + at_stack_check
        fi
    fi

    # Banner
    printf "\n"
    printf "  ══════════════════════════════════════════\n"
    printf "  ${BOLD}  QManager - Installation Script${NC}\n"
    printf "  ${DIM}  Version: %s${NC}\n" "$VERSION"
    printf "  ══════════════════════════════════════════\n"

    preflight

    mark_version_pending

    # Always run conflict removal — the conflicting opkg packages (sms-tool,
    # socat-at-bridge, socat) clobber /dev/smd11 and collide with our bundled
    # sms_tool binary regardless of whether we're installing opkg packages.
    # --skip-packages must not leave conflicts in place.
    remove_conflicts

    if [ "$DO_PACKAGES" = "1" ]; then
        install_packages
    fi

    stop_services

    if [ "$DO_FRONTEND" = "1" ]; then
        backup_originals
        install_frontend
    fi

    if [ "$DO_BACKEND" = "1" ]; then
        install_backend
        install_bundled_binaries
        cleanup_legacy_scripts
        migrate_tailscale_firewall_zone
        migrate_tailscale_packages
        migrate_tailscale_initd_boot_fix
        seed_uci_defaults

        [ "$DO_ENABLE" = "1" ] && enable_services

        if [ "$DO_START" = "1" ]; then
            start_services
            health_check
            at_stack_check || true
            # Release watchcat from maintenance mode now that install is
            # past the disruptive phases. Watchcat will exit LOCKED state
            # on its next loop iteration and resume normal monitoring.
            rm -f "$WATCHCAT_LOCK" 2>/dev/null || true
        fi
    fi

    finalize_version
    print_summary

    if [ "$DO_REBOOT" = "1" ]; then
        printf "  Rebooting in 5 seconds — press Ctrl+C to cancel...\n\n"
        sleep 5
        reboot_system
    fi
}

main "$@"
