-- =============================================================================
-- v1.sql — CellMapper Queue DB Schema (version 1)
-- =============================================================================
-- Initial schema for the CellMapper SQLite queue database.
--
-- Tables:
--   pending — outbound measurement payloads awaiting upload
--   archive — upload attempt history for diagnostics and retry logic
--
-- This file is applied by cm_db_migrate() in cellmapper_db.sh when the
-- database's PRAGMA user_version is < 1. After successful application,
-- user_version is set to 1.
--
-- Pragmas (busy_timeout, journal_mode, synchronous, auto_vacuum, page_size)
-- are applied separately by cm_db_init() — they are not schema and do not
-- belong in versioned migrations.
-- =============================================================================

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
