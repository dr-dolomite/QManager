#!/bin/sh
# =============================================================================
# cellmapper_db.sh — CellMapper SQLite Database Library
# =============================================================================
# Sourceable POSIX shell library for managing the CellMapper queue database.
# Provides schema initialization and all read/write operations against the
# SQLite queue.db stored in persistent overlay storage.
#
# Requires sqlite3-cli to be installed on the device (opkg install sqlite3-cli).
# The database is created at /overlay/cellmapper/queue.db on first call to
# cm_db_init.
#
# Two tables:
#   pending  — outbound measurement payloads awaiting upload
#   archive  — upload attempt history for diagnostics and retry logic
#
# Install location: /usr/lib/qmanager/cellmapper_db.sh
# Dependencies:     sqlite3-cli (package: sqlite3-cli)
# =============================================================================

[ -n "$_CM_DB_LOADED" ] && return 0
_CM_DB_LOADED=1

# --- Constants ----------------------------------------------------------------

CM_DB_PATH="/overlay/cellmapper/queue.db"

# --- cm_db_exec ---------------------------------------------------------------
# Wrapper around sqlite3 for the CellMapper queue database.
# Usage: cm_db_exec "<sql statement>"
# Returns: sqlite3 exit code; stdout contains query results.
cm_db_exec() {
    sqlite3 "$CM_DB_PATH" ".timeout 5000" "$1"
}

# --- cm_db_init ---------------------------------------------------------------
# Creates the database file and schema if not already present.
# Sets WAL mode and performance pragmas. Safe to call multiple times.
# Usage: cm_db_init
cm_db_init() {
    local db_dir
    db_dir=$(dirname "$CM_DB_PATH")
    mkdir -p "$db_dir"

    # Apply pragmas and create schema in a single transaction for atomicity.
    # Redirect stdout to /dev/null — PRAGMA journal_mode=WAL prints "wal"
    # to stdout, which pollutes CGI responses.
    sqlite3 "$CM_DB_PATH" >/dev/null <<'EOF'
PRAGMA busy_timeout=5000;
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA auto_vacuum=INCREMENTAL;
PRAGMA page_size=4096;

CREATE TABLE IF NOT EXISTS pending (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at INTEGER NOT NULL,
    size_bytes  INTEGER NOT NULL,
    payload     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_captured ON pending(captured_at);

CREATE TABLE IF NOT EXISTS archive (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uploaded_at INTEGER NOT NULL,
    batch_id    TEXT,
    point_count INTEGER,
    endpoint    TEXT,
    size_bytes  INTEGER,
    latency_ms  INTEGER,
    status      TEXT,
    error_msg   TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_uploaded ON archive(uploaded_at);
EOF
}

# --- cm_db_insert_pending -----------------------------------------------------
# Inserts a single measurement payload into the pending queue.
# Usage: cm_db_insert_pending "$captured_at" "$size_bytes" "$payload"
#   captured_at — Unix timestamp (integer) when the measurement was taken
#   size_bytes  — Byte length of the payload string
#   payload     — JSON or serialized measurement data
cm_db_insert_pending() {
    local captured_at="$1"
    local size_bytes="$2"
    local payload="$3"
    # Use printf %q-style escaping via sqlite3 parameter binding isn't available
    # in the CLI; escape single quotes by doubling them.
    local escaped_payload
    escaped_payload=$(printf '%s' "$payload" | sed "s/'/''/g")
    cm_db_exec "INSERT INTO pending (captured_at, size_bytes, payload)
                VALUES ($captured_at, $size_bytes, '$escaped_payload');"
}

# --- cm_db_count_pending ------------------------------------------------------
# Returns the number of rows currently in the pending queue.
# Usage: count=$(cm_db_count_pending)
cm_db_count_pending() {
    cm_db_exec "SELECT COUNT(*) FROM pending;"
}

# --- cm_db_size_pending -------------------------------------------------------
# Returns the total size in bytes of all payloads in the pending queue.
# Returns 0 if the table is empty.
# Usage: total_bytes=$(cm_db_size_pending)
cm_db_size_pending() {
    local result
    result=$(cm_db_exec "SELECT COALESCE(SUM(size_bytes), 0) FROM pending;")
    printf '%s' "${result:-0}"
}

# --- cm_db_oldest_pending -----------------------------------------------------
# Returns the captured_at timestamp of the oldest row in the pending queue,
# or an empty string if the table is empty.
# Usage: oldest=$(cm_db_oldest_pending)
cm_db_oldest_pending() {
    cm_db_exec "SELECT MIN(captured_at) FROM pending;"
}

# --- cm_db_evict_by_count -----------------------------------------------------
# Removes the oldest rows so that at most $max_count rows remain.
# Uses FIFO order (lowest id = oldest). No-op if count is already within limit.
# Usage: cm_db_evict_by_count "$max_count"
cm_db_evict_by_count() {
    local max_count="$1"
    cm_db_exec "DELETE FROM pending
                WHERE id IN (
                    SELECT id FROM pending
                    ORDER BY id ASC
                    LIMIT MAX(0, (SELECT COUNT(*) FROM pending) - $max_count)
                );"
}

# --- cm_db_evict_by_age -------------------------------------------------------
# Removes all rows whose captured_at timestamp is older than $max_age_sec
# seconds before the current time.
# Usage: cm_db_evict_by_age "$max_age_sec"
cm_db_evict_by_age() {
    local max_age_sec="$1"
    local cutoff
    cutoff=$(( $(date +%s) - max_age_sec ))
    cm_db_exec "DELETE FROM pending WHERE captured_at < $cutoff;"
}
