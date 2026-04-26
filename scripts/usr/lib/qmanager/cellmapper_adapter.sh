#!/bin/sh
# =============================================================================
# cellmapper_adapter.sh — CellMapper Adapter Dispatcher
# =============================================================================
# Sourceable POSIX shell library responsible for detecting the active modem
# adapter and dispatching collection requests to it.
#
# Adapters live in /usr/lib/qmanager/cellmapper/adapters/*.sh. Each adapter
# must implement the contract documented in that directory's README.md.
#
# On first call, cm_detect_adapter sources every adapter script in glob order
# and stops at the first one whose cm_adapter_detect function returns 0.
# The result is cached in /tmp/qmanager_cm_adapter so subsequent calls in the
# same collection cycle skip the scan.
#
# Exported shell variables after a successful detect:
#   CM_ADAPTER_ID   — machine-readable identifier (e.g. "rm551")
#   CM_ADAPTER_NAME — human-readable name (e.g. "Quectel RM551E-GL")
#
# Install location: /usr/lib/qmanager/cellmapper_adapter.sh
# Dependencies:     /usr/lib/qmanager/qlog.sh (optional, no-op stubs defined)
#                   /usr/lib/qmanager/cellmapper/adapters/*.sh
# =============================================================================

[ -n "$_CM_ADAPTER_LOADED" ] && return 0
_CM_ADAPTER_LOADED=1

# ---------------------------------------------------------------------------
# Ensure qlog stubs exist if logging library has not been sourced yet.
# ---------------------------------------------------------------------------
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }

# Runtime constant — where adapters are installed on the target device.
CM_ADAPTER_DIR="/usr/lib/qmanager/cellmapper/adapters"

# Cache file keeps the detected adapter ID across calls within one session.
CM_ADAPTER_CACHE="/tmp/qmanager_cm_adapter"

# Exported adapter context (populated by cm_detect_adapter).
CM_ADAPTER_ID=""
CM_ADAPTER_NAME=""

# ---------------------------------------------------------------------------
# cm_detect_adapter
# Scan the adapter directory and source the first adapter whose
# cm_adapter_detect function returns 0. Caches the result.
#
# Returns: 0 if an adapter was found, 1 otherwise.
# Side effects: sets CM_ADAPTER_ID, CM_ADAPTER_NAME; writes cache file.
# ---------------------------------------------------------------------------
cm_detect_adapter() {
    # Return immediately if a cached result exists from this session.
    if [ -f "$CM_ADAPTER_CACHE" ]; then
        # shellcheck disable=SC1090
        . "$CM_ADAPTER_CACHE"
        if [ -n "$CM_ADAPTER_ID" ] && [ -f "${CM_ADAPTER_FILE:-}" ]; then
            # Re-source the adapter script to bring its functions into scope.
            # The cache only stores variable assignments, not function defs.
            # shellcheck disable=SC1090
            . "$CM_ADAPTER_FILE"
            qlog_debug "cm_detect_adapter: using cached adapter '$CM_ADAPTER_ID'"
            return 0
        fi
    fi

    if [ ! -d "$CM_ADAPTER_DIR" ]; then
        qlog_error "cm_detect_adapter: adapter directory not found: $CM_ADAPTER_DIR"
        return 1
    fi

    for adapter_file in "$CM_ADAPTER_DIR"/*.sh; do
        [ -f "$adapter_file" ] || continue
        qlog_debug "cm_detect_adapter: probing $adapter_file"

        # Source the adapter to bring its functions into scope.
        # shellcheck disable=SC1090
        . "$adapter_file"

        # Check if the required detection function exists.
        if ! command -v cm_adapter_detect >/dev/null 2>&1; then
            qlog_warn "cm_detect_adapter: $adapter_file missing cm_adapter_detect — skipping"
            continue
        fi

        if cm_adapter_detect; then
            CM_ADAPTER_ID=$(cm_adapter_id)
            CM_ADAPTER_NAME=$(cm_adapter_name)
            export CM_ADAPTER_ID CM_ADAPTER_NAME
            # Write the cache so subsequent library sources can skip detection.
            # Include the adapter file path so the cache-hit path can re-source
            # the script and bring its functions into scope.
            printf 'CM_ADAPTER_ID="%s"\nCM_ADAPTER_NAME="%s"\nCM_ADAPTER_FILE="%s"\n' \
                "$CM_ADAPTER_ID" "$CM_ADAPTER_NAME" "$adapter_file" > "$CM_ADAPTER_CACHE"
            qlog_info "cm_detect_adapter: selected adapter '$CM_ADAPTER_ID' ($CM_ADAPTER_NAME)"
            return 0
        fi
    done

    qlog_error "cm_detect_adapter: no compatible adapter found"
    return 1
}

# ---------------------------------------------------------------------------
# cm_collect_serving
# Return a JSON array of serving cell measurement objects.
# Requires cm_detect_adapter to have been called (or adapter pre-loaded).
#
# Outputs: JSON array on stdout (may be empty array [] on failure).
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_collect_serving() {
    if ! command -v cm_adapter_collect_serving >/dev/null 2>&1; then
        if ! cm_detect_adapter; then
            printf '[]'
            return 1
        fi
    fi
    cm_adapter_collect_serving
}

# ---------------------------------------------------------------------------
# cm_collect_neighbors
# Return a JSON array of neighbour cell measurement objects.
# Requires cm_detect_adapter to have been called (or adapter pre-loaded).
#
# Outputs: JSON array on stdout (may be empty array [] on failure).
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_collect_neighbors() {
    if ! command -v cm_adapter_collect_neighbors >/dev/null 2>&1; then
        if ! cm_detect_adapter; then
            printf '[]'
            return 1
        fi
    fi
    cm_adapter_collect_neighbors
}

# ---------------------------------------------------------------------------
# cm_collect_ca
# Return a JSON array of carrier aggregation component measurements.
# Requires cm_detect_adapter to have been called (or adapter pre-loaded).
#
# Outputs: JSON array on stdout (may be empty array [] on failure).
# Returns: 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
cm_collect_ca() {
    if ! command -v cm_adapter_collect_ca >/dev/null 2>&1; then
        if ! cm_detect_adapter; then
            printf '[]'
            return 1
        fi
    fi
    cm_adapter_collect_ca
}
