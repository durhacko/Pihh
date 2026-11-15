-- 001_runs.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §6.1 experiment_runs.
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

CREATE TABLE experiment_runs (
    run_id            UUID PRIMARY KEY,                       -- UUIDv5(artifact_hash), §4.2
    experiment_key    TEXT NOT NULL CHECK (experiment_key ~ '^[0-9a-f]{64}$'),
    pair_key          TEXT          CHECK (pair_key       ~ '^[0-9a-f]{64}$'),
    artifact_hash     TEXT NOT NULL UNIQUE CHECK (artifact_hash ~ '^[0-9a-f]{64}$'),
    file_sha256       TEXT NOT NULL CHECK (file_sha256    ~ '^[0-9a-f]{64}$'),   -- as first imported (§5)
    hash_version      SMALLINT NOT NULL CHECK (hash_version >= 1),
    manifest_version  SMALLINT NOT NULL CHECK (manifest_version >= 1),
    validator_version TEXT NOT NULL,
    importer_version  TEXT NOT NULL,                          -- gateway package version + its git
    source_kind       TEXT NOT NULL CHECK (source_kind IN ('cli-scenario', 'app-export')),
    artifact_path     TEXT NOT NULL                           -- label, as first imported; never opened (§5, §11.2)
                      CHECK (artifact_path ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
                             AND artifact_path !~ '(^|/)\.\.(/|$)'),
    file_bytes        INTEGER NOT NULL CHECK (file_bytes > 0),                   -- as first imported
    scenario          TEXT NOT NULL,
    arm               TEXT NOT NULL CHECK (arm IN ('encore', 'static')),
    seed              BIGINT NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),     -- uint32, §3.2
    n0                INTEGER NOT NULL CHECK (n0 > 0),
    git_revision      TEXT NOT NULL,
    git_clean         BOOLEAN NOT NULL,
    params_hash       TEXT NOT NULL CHECK (params_hash ~ '^[0-9a-f]{64}$'),
    state_hash        TEXT NOT NULL,
    dt_seconds        DOUBLE PRECISION NOT NULL CHECK (dt_seconds = 0.05),   -- asserted DT at the record's git, §8
    composition_id    TEXT,
    record_version    INTEGER NOT NULL CHECK (record_version = 1),
    expected_samples  INTEGER NOT NULL CHECK (expected_samples >= 0),
    event_count       INTEGER NOT NULL CHECK (event_count >= 0),
    series_digest     TEXT NOT NULL,
    events_digest     TEXT NOT NULL,
    summary_digest    TEXT NOT NULL,
    telemetry_state   TEXT NOT NULL DEFAULT 'present' CHECK (telemetry_state IN ('present', 'archived')),
    imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),     -- real ingestion time (TD-6)
    CHECK (git_clean = (git_revision ~ '^[0-9a-f]{40}$')),
    CHECK ((composition_id IS NULL) = (pair_key IS NULL))     -- no composition identity ⇒ not pairable
);

-- TD-5 / TCR-03: one artifact per experiment identity, for clean-git runs (dirty runs: §4.3, TCR-14)
CREATE UNIQUE INDEX experiment_runs_experiment_key_clean_uq
    ON experiment_runs (experiment_key) WHERE git_clean;

-- William §6.1, preserved
CREATE INDEX experiment_runs_pair_idx
    ON experiment_runs (scenario, seed, n0, arm, git_revision, params_hash);

CREATE INDEX experiment_runs_pair_key_idx ON experiment_runs (pair_key, arm);
