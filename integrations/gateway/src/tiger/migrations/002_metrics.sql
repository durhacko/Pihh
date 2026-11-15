-- 002_metrics.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §6.2 synthetic_time, simulation_metrics (hypertable), comment, metrics_v.
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

-- The one definition of tick → synthetic time, used by the CHECK below, by Q4 and by Q16b.
CREATE FUNCTION synthetic_time(tick integer) RETURNS timestamptz
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT date_add(timestamptz '2020-01-01 00:00:00+00', tick * interval '50 milliseconds', 'UTC') $$;

CREATE TABLE simulation_metrics (
    sample_time        TIMESTAMPTZ NOT NULL,                  -- SYNTHETIC, not wall clock (§8)
    run_id             UUID NOT NULL REFERENCES experiment_runs (run_id),
    tick               INTEGER NOT NULL,
    alive              INTEGER NOT NULL,
    coverage           DOUBLE PRECISION NOT NULL,
    pwc                DOUBLE PRECISION NOT NULL,
    npwc               DOUBLE PRECISION,
    sf_mean            DOUBLE PRECISION,
    sf_max             DOUBLE PRECISION,
    dup_slots          INTEGER NOT NULL,
    versions           JSONB NOT NULL,
    hb_total           BIGINT NOT NULL,
    score_total        BIGINT NOT NULL,
    delivered_total    BIGINT NOT NULL,
    lost_total         BIGINT NOT NULL,
    blocked_total      BIGINT NOT NULL,
    collisions_total   BIGINT NOT NULL,
    near_misses_total  BIGINT NOT NULL,
    slot_changes_total BIGINT NOT NULL,
    PRIMARY KEY (run_id, sample_time),
    -- William §6.2, preserved
    CHECK (tick >= 0),
    CHECK (alive >= 0),
    CHECK (coverage BETWEEN 0 AND 1),
    CHECK (dup_slots >= 0),
    -- William had pwc BETWEEN 0 AND 1: rejects every committed artifact (TCR-12)
    CHECK (pwc >= 0 AND pwc <= 1 + 1e-9),
    -- additions
    CHECK (tick % 5 = 0),
    CHECK ((alive = 0) = (npwc IS NULL)),
    CHECK (npwc IS NULL OR npwc >= 0),
    CHECK (alive > 0 OR (sf_mean IS NULL AND sf_max IS NULL)),
    CHECK ((sf_mean IS NULL OR sf_mean >= 0) AND (sf_max IS NULL OR sf_max >= 0)),
    CHECK (jsonb_typeof(versions) = 'object'),
    CHECK (LEAST(hb_total, score_total, delivered_total, lost_total, blocked_total,
                 collisions_total, near_misses_total, slot_changes_total) >= 0),
    -- tick → synthetic time, immutable form, §8 and TCR-23
    CHECK (sample_time = synthetic_time(tick))
) WITH (
    tsdb.hypertable,
    tsdb.partition_column = 'sample_time',
    tsdb.chunk_interval   = '7 days',
    tsdb.columnstore      = false,
    tsdb.create_default_indexes = false
);

CREATE INDEX metrics_run_tick_idx ON simulation_metrics (run_id, tick);   -- William, preserved

COMMENT ON COLUMN simulation_metrics.sample_time IS
    'SYNTHETIC: 2020-01-01Z + tick × 50 ms; not wall clock. Same range for every run.';

-- Console-facing view: every judge-facing console query is written against it, never the raw table.
CREATE VIEW metrics_v AS
SELECT m.run_id, m.tick, m.tick * r.dt_seconds AS sim_seconds, m.sample_time AS synthetic_time,
       m.alive, m.coverage, m.pwc, m.npwc, m.sf_mean, m.sf_max, m.dup_slots, m.versions,
       m.hb_total, m.score_total, m.delivered_total, m.lost_total, m.blocked_total,
       m.collisions_total, m.near_misses_total, m.slot_changes_total
FROM simulation_metrics m JOIN experiment_runs r USING (run_id);
