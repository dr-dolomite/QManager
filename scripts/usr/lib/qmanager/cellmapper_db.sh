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

# Directory containing versioned schema migrations (v1.sql, v2.sql, ...).
# Each file is plain SQL; cm_db_migrate applies them in order based on
# the database's PRAGMA user_version.
CM_DB_SCHEMA_DIR="/usr/lib/qmanager/cellmapper/schema"

# Latest schema version known to this build. Bump this whenever a new
# v${N}.sql file is added under CM_DB_SCHEMA_DIR.
CM_DB_SCHEMA_LATEST=1

# --- cm_db_exec ---------------------------------------------------------------
# Wrapper around sqlite3 for the CellMapper queue database.
# Usage: cm_db_exec "<sql statement>"
# Returns: sqlite3 exit code; stdout contains query results.
cm_db_exec() {
    sqlite3 "$CM_DB_PATH" ".timeout 5000" "$1"
}

# --- cm_db_user_version -------------------------------------------------------
# Returns the current PRAGMA user_version of the database (integer).
# Returns 0 if the DB is brand-new or the pragma is unset.
# Usage: ver=$(cm_db_user_version)
cm_db_user_version() {
    local v
    v=$(sqlite3 "$CM_DB_PATH" "PRAGMA user_version;" 2>/dev/null)
    printf '%s' "${v:-0}"
}

# --- cm_db_migrate ------------------------------------------------------------
# Applies any schema migrations whose version is greater than the database's
# current user_version, up through CM_DB_SCHEMA_LATEST. Each version's SQL is
# loaded from $CM_DB_SCHEMA_DIR/v<N>.sql and executed; user_version is then
# bumped to <N>. Safe to call repeatedly — running migrate twice in a row is
# a no-op once user_version is already at the latest.
# Returns: 0 on success, non-zero if a migration file is missing or sqlite3 fails.
# Usage: cm_db_migrate
cm_db_migrate() {
    local current target migration_file rc
    current=$(cm_db_user_version)
    target="$CM_DB_SCHEMA_LATEST"

    # Already at latest — nothing to do.
    if [ "$current" -ge "$target" ] 2>/dev/null; then
        return 0
    fi

    # Apply each pending version in order: current+1 .. target.
    # POSIX sh has no C-style for-loop, so we use a while.
    local next
    next=$((current + 1))
    while [ "$next" -le "$target" ]; do
        migration_file="$CM_DB_SCHEMA_DIR/v${next}.sql"
        if [ ! -f "$migration_file" ]; then
            command -v qlog_error >/dev/null 2>&1 && \
                qlog_error "cm_db_migrate: missing schema file $migration_file"
            return 1
        fi

        # Apply the migration and bump user_version atomically. If sqlite3
        # fails mid-script, user_version stays at the previous value so the
        # next call retries from the same point.
        sqlite3 "$CM_DB_PATH" >/dev/null <<EOF
BEGIN;
.read $migration_file
PRAGMA user_version = $next;
COMMIT;
EOF
        rc=$?
        if [ "$rc" -ne 0 ]; then
            command -v qlog_error >/dev/null 2>&1 && \
                qlog_error "cm_db_migrate: failed to apply $migration_file (rc=$rc)"
            return "$rc"
        fi

        command -v qlog_info >/dev/null 2>&1 && \
            qlog_info "cm_db_migrate: applied schema v${next}"
        next=$((next + 1))
    done

    return 0
}

# --- cm_db_init ---------------------------------------------------------------
# Creates the database file, applies pragmas, and runs schema migrations.
# Safe to call multiple times — idempotent thanks to cm_db_migrate's
# user_version check.
# Usage: cm_db_init
cm_db_init() {
    local db_dir
    db_dir=$(dirname "$CM_DB_PATH")
    mkdir -p "$db_dir"

    # Apply runtime pragmas. These are *not* schema — they're connection /
    # file-format settings that need to be set on the DB file itself.
    # Redirect stdout to /dev/null — PRAGMA journal_mode=WAL prints "wal"
    # to stdout, which would pollute CGI responses if it bubbled up.
    sqlite3 "$CM_DB_PATH" >/dev/null <<'EOF'
PRAGMA busy_timeout=5000;
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA auto_vacuum=INCREMENTAL;
PRAGMA page_size=4096;
EOF

    # Apply versioned schema migrations (creates tables/indexes on first run,
    # no-op on subsequent calls).
    cm_db_migrate
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
