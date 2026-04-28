#!/bin/sh
# =============================================================================
# errors.sh — CellMapper Cross-Process Error Ring Buffer
# =============================================================================
# Shared error tracking for the CellMapper subsystem. Both the collector
# (qmanager_cm_collector) and the uploader (qmanager_cm_uploader) source
# this module so that errors from either daemon land in the same ring and
# show up in the UI's error log card.
#
# Storage layout:
#   /tmp/cellmapper/errors/                    — directory (created on demand)
#   /tmp/cellmapper/errors/ring.json           — JSON array, last 20 entries
#   /tmp/cellmapper/errors/.lock/              — advisory lock (mkdir-based)
#
# Each entry is:
#   {"ts": <unix_ts>, "source": "<component>", "msg": "<text>", "count": <n>}
#
# If cm_error_record is called twice in a row with the same source+msg, the
# count of the most recent entry is incremented instead of appending — this
# preserves the original collector behaviour and keeps the UI uncluttered
# when a transient failure (e.g. "no GPS fix") repeats every cycle.
#
# Public API:
#   cm_error_record <component> <message>      — append (or increment) entry
#   cm_error_ring_get                          — emit JSON array (last 20)
#   cm_error_ring_clear                        — wipe the ring (admin / tests)
#   cm_error_ring_path                         — print the ring file path
#
# Install location: /usr/lib/qmanager/cellmapper/errors.sh
# Dependencies:     jq, mkdir, mv, rm (BusyBox)
# =============================================================================

[ -n "$_CM_ERRORS_LOADED" ] && return 0
_CM_ERRORS_LOADED=1

# --- Constants ---------------------------------------------------------------

CM_ERRORS_DIR="/tmp/cellmapper/errors"
CM_ERRORS_RING="$CM_ERRORS_DIR/ring.json"
CM_ERRORS_LOCK="$CM_ERRORS_DIR/.lock"
CM_ERRORS_MAX=20

# --- _cm_errors_lock ---------------------------------------------------------
# Acquire an advisory lock via mkdir (atomic on every POSIX FS we ship to).
# Spins for up to ~2 seconds (40 * 50ms). Returns 0 on success, 1 on giveup.
_cm_errors_lock() {
    mkdir -p "$CM_ERRORS_DIR" 2>/dev/null
    local i=0
    while [ "$i" -lt 40 ]; do
        if mkdir "$CM_ERRORS_LOCK" 2>/dev/null; then
            return 0
        fi
        # BusyBox sleep accepts fractional seconds.
        sleep 0.05 2>/dev/null || sleep 1
        i=$((i + 1))
    done
    return 1
}

# --- _cm_errors_unlock -------------------------------------------------------
_cm_errors_unlock() {
    rmdir "$CM_ERRORS_LOCK" 2>/dev/null
}

# --- cm_error_ring_path ------------------------------------------------------
cm_error_ring_path() {
    printf '%s' "$CM_ERRORS_RING"
}

# --- cm_error_ring_get -------------------------------------------------------
# Emit the current ring as a JSON array (oldest-first). Always emits a
# valid JSON array — "[]" when empty or missing.
cm_error_ring_get() {
    if [ ! -s "$CM_ERRORS_RING" ]; then
        printf '[]'
        return 0
    fi

    # Defensive: jq -c on the file; fall back to "[]" if file is corrupt.
    local out
    out=$(jq -c '. // []' "$CM_ERRORS_RING" 2>/dev/null)
    case "$out" in
        '['*) printf '%s' "$out" ;;
        *)    printf '[]' ;;
    esac
}

# --- cm_error_record ---------------------------------------------------------
# Append an error to the ring. If the most recent entry has the same
# (source, msg) tuple, increment its count and bump its timestamp instead
# of appending a new row. Trims the ring to CM_ERRORS_MAX entries.
#
# Usage: cm_error_record <source> <message>
#   <source>  — short component tag, e.g. "gps", "adapter", "uploader"
#   <message> — human-readable text
cm_error_record() {
    local src="$1"
    local msg="$2"
    local now

    [ -z "$src" ] && src="unknown"
    [ -z "$msg" ] && msg="(empty error)"

    now=$(date +%s)

    if ! _cm_errors_lock; then
        # Lock contention — best-effort log via syslog and bail. Losing one
        # error event during heavy contention is preferable to blocking the
        # caller (typically a tight collector loop).
        command -v qlog_warn >/dev/null 2>&1 && \
            qlog_warn "cm_error_record: could not acquire lock for $src: $msg"
        return 1
    fi

    # Read current ring (or empty array if missing).
    local current
    if [ -s "$CM_ERRORS_RING" ]; then
        current=$(cat "$CM_ERRORS_RING" 2>/dev/null)
    else
        current="[]"
    fi
    case "$current" in
        '['*) : ;;
        *)    current="[]" ;;
    esac

    # Update the ring via jq: dedup-into-count if the last entry matches,
    # else append; finally trim to the most recent CM_ERRORS_MAX entries.
    local updated
    updated=$(printf '%s' "$current" | jq -c \
        --arg     src "$src" \
        --arg     msg "$msg" \
        --argjson ts  "$now" \
        --argjson max "$CM_ERRORS_MAX" '
        (if length > 0 and (last.source == $src) and (last.msg == $msg) then
            .[:-1] + [.[-1] | .count = (.count + 1) | .ts = $ts]
        else
            . + [{ts: $ts, source: $src, msg: $msg, count: 1}]
        end)
        | (if length > $max then .[(length - $max):] else . end)
    ' 2>/dev/null)

    if [ -n "$updated" ]; then
        # Atomic write via temp file + rename.
        local tmp="$CM_ERRORS_RING.tmp.$$"
        printf '%s\n' "$updated" > "$tmp" 2>/dev/null
        if [ -s "$tmp" ]; then
            mv -f "$tmp" "$CM_ERRORS_RING" 2>/dev/null
        else
            rm -f "$tmp" 2>/dev/null
        fi
    fi

    _cm_errors_unlock
    return 0
}

# --- cm_error_ring_clear -----------------------------------------------------
# Truncate the ring back to "[]". Used by admin endpoints / tests.
cm_error_ring_clear() {
    if _cm_errors_lock; then
        printf '%s\n' '[]' > "$CM_ERRORS_RING" 2>/dev/null
        _cm_errors_unlock
    fi
}
