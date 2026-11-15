-- 003_events.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §6.3 simulation_events.
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

CREATE TABLE simulation_events (
    run_id      UUID NOT NULL REFERENCES experiment_runs (run_id),
    event_index INTEGER NOT NULL CHECK (event_index >= 0),   -- position in RunRecord.events
    tick        INTEGER NOT NULL CHECK (tick >= 0),
    event_type  TEXT NOT NULL CHECK (event_type IN ('KILL', 'JAM_ON', 'JAM_OFF', 'PARTITION_ON',
                                                    'PARTITION_OFF', 'INJECT_SCORE', 'SET_LOSS')),
    details     JSONB NOT NULL,                              -- the complete EnvEvent, verbatim
    PRIMARY KEY (run_id, event_index),
    -- immutable forms: ->> and int4out are IMMUTABLE, to_jsonb() is only STABLE (TCR-23)
    CHECK (details ->> 'type' = event_type),
    CHECK (jsonb_typeof(details -> 'tick') = 'number' AND details ->> 'tick' = tick::text)
);
CREATE INDEX simulation_events_type_idx ON simulation_events (event_type, tick);
