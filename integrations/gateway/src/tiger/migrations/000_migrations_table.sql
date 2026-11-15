-- 000_migrations_table.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §7, row 000.
-- The RFC gives the columns only: schema_migrations (version INT PK, name TEXT, sha256 TEXT, applied_at TIMESTAMPTZ).
-- NOT NULL, the sha256 format CHECK and the applied_at default are this file's additions. Unqualified names: the
-- runner creates the schema and sets search_path before this file (§7). Never edit a file once applied.

CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY CHECK (version >= 0),
    name       TEXT NOT NULL,
    sha256     TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),   -- of the file's bytes; a changed file stops the runner
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
