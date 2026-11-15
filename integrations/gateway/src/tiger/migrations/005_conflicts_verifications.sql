-- 005_conflicts_verifications.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §6.5 import_conflicts and run_verifications.
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

CREATE TABLE import_conflicts (
    conflict_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hash_version           SMALLINT NOT NULL,
    experiment_key         TEXT NOT NULL,
    existing_run_id        UUID NOT NULL REFERENCES experiment_runs (run_id),
    existing_artifact_hash TEXT NOT NULL,
    incoming_artifact_hash TEXT NOT NULL,
    incoming_file_sha256   TEXT NOT NULL,
    incoming_artifact_path TEXT NOT NULL                       -- label only, same rule as artifact_path
                           CHECK (incoming_artifact_path ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
                                  AND incoming_artifact_path !~ '(^|/)\.\.(/|$)'),
    detected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hash_version, experiment_key, incoming_artifact_hash),
    CHECK (existing_artifact_hash <> incoming_artifact_hash)
);

-- Post-commit verification outcomes (§11.1). Append-only: the importer may INSERT, never UPDATE.
CREATE TABLE run_verifications (
    verification_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- orders the rows of one run
    run_id           UUID NOT NULL REFERENCES experiment_runs (run_id),
    verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),               -- wall clock
    verifier_version TEXT NOT NULL,
    series_digest    TEXT NOT NULL CHECK (series_digest  ~ '^[0-9a-f]{64}$'),   -- recomputed from rows
    events_digest    TEXT NOT NULL CHECK (events_digest  ~ '^[0-9a-f]{64}$'),
    summary_digest   TEXT NOT NULL CHECK (summary_digest ~ '^[0-9a-f]{64}$'),
    outcome          TEXT NOT NULL CHECK (outcome IN ('verified', 'mismatch'))
);
CREATE INDEX run_verifications_run_idx ON run_verifications (run_id, verification_id DESC);
