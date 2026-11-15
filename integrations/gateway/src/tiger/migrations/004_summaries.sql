-- 004_summaries.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §6.4 run_summaries.
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

CREATE TABLE run_summaries (
    run_id       UUID PRIMARY KEY REFERENCES experiment_runs (run_id),
    summary_json JSONB NOT NULL CHECK (jsonb_typeof(summary_json) = 'object'),   -- every key, nulls kept
    -- William's typed columns, derived from summary_json so they cannot disagree with it
    npwc_end              DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'npwcEnd')::double precision) STORED,
    npwc_end_a            DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'npwcEndA')::double precision) STORED,
    coverage_end          DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'coverageEnd')::double precision) STORED,
    sf_mean_end           DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'sfMeanEnd')::double precision) STORED,
    sf_max_end            DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'sfMaxEnd')::double precision) STORED,
    t_rec_applicable      BOOLEAN          GENERATED ALWAYS AS (summary_json ? 'tRec') STORED,
    t_rec_seconds         DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'tRec')::double precision) STORED,
    npwc_deficit_seconds  DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'npwcDeficitSec')::double precision) STORED,
    collisions            BIGINT           GENERATED ALWAYS AS ((summary_json ->> 'collisions')::bigint) STORED,
    near_misses           BIGINT           GENERATED ALWAYS AS ((summary_json ->> 'nearMisses')::bigint) STORED,
    msgs_per_drone_second DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'msgsPerDroneSec')::double precision) STORED,
    delivery_ratio        DOUBLE PRECISION GENERATED ALWAYS AS ((summary_json ->> 'deliveryRatio')::double precision) STORED
);
