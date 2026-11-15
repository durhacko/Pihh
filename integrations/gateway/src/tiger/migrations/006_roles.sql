-- 006_roles.sql: TIGER_TELEMETRY_AND_INGESTION_RFC.md §13 grants only (roles are created by the owner's run-once script, never here).
-- The text below the first blank line is the RFC block verbatim (migrations.test.ts compares them byte for byte).
-- Unqualified names: the runner sets search_path to the checked schema (§7). Never edit a file once applied.

GRANT SELECT, INSERT ON experiment_runs, simulation_metrics, simulation_events,
                        run_summaries, import_conflicts, run_verifications
                     TO encore_importer;
GRANT SELECT ON schema_migrations TO encore_importer;   -- the §7 compatibility check
-- These three name the schema, so the runner issues them through the checked %I helper (§7):
--   GRANT USAGE ON SCHEMA <schema> TO encore_importer, encore_reader;
--   GRANT SELECT ON ALL TABLES IN SCHEMA <schema> TO encore_reader;   -- includes the metrics_v view
--   ALTER DEFAULT PRIVILEGES IN SCHEMA <schema> GRANT SELECT ON TABLES TO encore_reader;
