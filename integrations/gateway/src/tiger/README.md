# `tiger` gateway module (Tiger Data analytics)

Status: **offline parts of TIG-03, TIG-04 and TIG-06.** This folder holds the migration files, the connection settings, the schema-name helper, the repository seam (TIG-04, durhack-41) and the two read routes `GET /api/runs` and `GET /api/runs/:runId/metrics` (TIG-06). There is still no database driver (`pg`), connection or migration runner:

- the live part of TIG-03 (`db.ts`, `migrate.ts`, live tests, the `pg` dependency) waits for decision D3 and a dependency sign-off;
- the comparison routes of TIG-06 wait for TIG-07.

## Read routes and the OFFLINE FIXTURE (never live)

- Both routes are always registered. They have no Tiger source in this build, so they answer 503 `DATABASE_UNAVAILABLE` with reason `MODULE_DISABLED`, and health is `{ enabled: false, db: 'disabled' }`.
- **`TIGER_OFFLINE_FIXTURE=1` is for offline demos and tests only.** It serves the routes from an in-memory read source the caller supplies: the TIG-04 fake repository, fed by the importer from the committed `results/`. While it is on:
  - every run in every response carries `provenance.source: 'fixture'`, `verified: false` and `verification: null`, and never `'tiger'`;
  - health reports `{ enabled: true, db: 'disabled', source: 'fixture' }`;
  - nothing is ever labelled live, and nothing claims to come from Tiger.
- Without a supplied source the flag changes nothing. Any value other than `1` is refused. Leave it unset in every real deployment.
- **Implemented:**
  - validation of every parameter in the analytics RFC §3.4 and §3.5 tables, with unknown parameters refused;
  - list ordering (scenario, n0, seed, arm, runId) with an opaque cursor;
  - metrics paging (`afterTick`, `toTick`, `limit`);
  - counter totals and per-interval deltas, completeness, event markers, summary cells, recovery state and integrity checks;
  - 400 `INVALID_QUERY`, `INVALID_ID` and `INVALID_CURSOR`; 404 `RUN_NOT_FOUND`;
  - an XI-11 `requestId` (as a query parameter) echoed in errors.
- **Not implemented yet:**
  - the per-route rate limits (§3.1);
  - `includeConflicts`' `conflicts` array;
  - the per-read digest recomputation on the metrics route (§2.1). Fixture runs report `verification: null`.

Specifications:
- work package: [TIG-03](../../../../docs/planning/tiger-data-integration-work-packages.md#tig-03-sql-migrations-and-tiger-connection);
- schema, migrations and connections: [ingestion RFC §6, §7 and §13](../../../../docs/design/TIGER_TELEMETRY_AND_INGESTION_RFC.md);
- tests: [evaluation](../../../../docs/validation/tiger-data-evaluation.md) T31, T33 and T35.

## Files

| File | What it is |
|---|---|
| `migrations/000_migrations_table.sql` | `schema_migrations`, from the RFC §7 table (columns only in the RFC) |
| `migrations/001`–`005` | The RFC §6.1–§6.5 blocks, verbatim below a header |
| `migrations/006_roles.sql` | Grants only (RFC §13). Roles are created by the owner's run-once script, never by a migration |
| `config.ts` | `loadTigerReaderConfig`, `loadTigerImporterConfig`, `loadTigerAdminConfig`, `tlsModeLine` |
| `schemaName.ts` | `checkSchemaName`, the one way a schema name enters SQL, and `schemaStatements` |
| `module.ts` | The registry entry: the two read routes; disabled without a source; the offline fixture flag |
| `routes/index.ts` | `GET /api/runs` and `GET /api/runs/:runId/metrics` handlers |
| `services/` | `runs.ts` (list, `RunMeta`, `Provenance`), `metrics.ts` (`RunMetricsResponse`), `source.ts` (the read port over `TigerReader`), `bridge.ts` (the only `src/` imports), `disabled.ts` |
| `.env.example` | The HTTP server's variable names |

`test/tiger/migrations.test.ts` checks each migration file below its header against the RFC block, byte for byte, plus every delta TIG-03 lists. `test/tiger/config.test.ts` covers the loaders, the TLS rules, the schema-name helper and the module.

## Migrations

- **Unqualified names.** The same bytes and checksum serve schema `encore` and every `tig_test_<12 hex>` test schema.
- **What the runner (TIG-03 live) does around the files:**
  - checks the name with `checkSchemaName`;
  - runs `schemaStatements(name).create` before 000;
  - runs each file in its own transaction after `set_config('search_path', $1, true)`;
  - records the file's sha256 in `schema_migrations`;
  - after 006, issues the three schema-level grants from `schemaStatements(name).grants`.
- **Pasting by hand into the Tiger console:** run `CREATE SCHEMA IF NOT EXISTS encore;` and `SET search_path = encore;` first.
- **Version gates.** PostgreSQL ≥ 16 and TimescaleDB ≥ 2.20, enforced by the runner. Each file has one DDL variant, never one chosen at run time.
- **No retention policy**, deliberately: `add_retention_policy` would drop every run at once (RFC §6.2). Columnstore is off.
- **Down script:** not in this part. Per §7 it revokes 006's grants, then drops 005 → 000; local development only.

## Settings

Three credentials, one per process (RFC §13). Each process refuses a credential it must not hold. "Present" means the variable is set at all, even to an empty string.

| Variable | Read by | Refused by |
|---|---|---|
| `TIGER_READ_DATABASE_URL` | the gateway HTTP server (`encore_reader`) | — |
| `TIGER_DATABASE_URL` | the importer CLI, from `src/tiger/.env.importer` (`encore_importer`) | the HTTP server |
| `TIGER_ADMIN_DATABASE_URL` | `tiger:migrate`, the live-test harness, the owner tools; supplied only for that command | the HTTP server and the importer |
| `TIGER_LIVE_WRITE_URL` | the TIG-11 live writer only | the HTTP server |
| `TIGER_TLS_UNVERIFIED` | every Tiger process: unset = TLS `verify-full` (default); `1` = TLS `require`; any other value is refused | — |

**TLS** (RFC §13 names only; there is no other TLS setting):
- A URL carrying `sslmode`, `sslrootcert`, `sslcert`, `sslkey` or `ssl` (any value, any letter case) is refused. Tiger's console strings carry `?sslmode=require`, so strip it.
- `require` is encrypted, but the server is not authenticated. It is the only mode a free service supports. The conditions in RFC §13 apply: channel binding, long passwords, trusted networks only, and rotation afterwards.
- `tlsModeLine()` gives the one start-up line stating the effective mode.
- Error messages name the variable and the rule, never a value.

**Refusing to start (T31).**
- A write, admin or live-write URL (`TIGER_DATABASE_URL`, `TIGER_ADMIN_DATABASE_URL`, `TIGER_LIVE_WRITE_URL`) in the HTTP server's environment makes `createModule` throw the skeleton's `FatalConfigError`. `buildGateway` re-throws it, so **the whole gateway refuses to start**.
- Any other bad tiger setting is a plain `TigerConfigError`: the registry disables only `tiger` and lists the problem, and the other modules run. Examples: a URL with TLS parameters, a bad `TIGER_TLS_UNVERIFIED`, a malformed URL.

## Known gaps
- **No `.env.importer.example` yet.** TIG-03 lists it, but two shared files refuse it:
  - the skeleton test "no committed .env file" (`test/offline.test.ts`) allows only `.env.example`;
  - the root `.env.*` rule in `.gitignore` ignores it.

  Until the skeleton allows names-only `.env.*.example` files, the importer's file is described here instead. `src/tiger/.env.importer` is local, never committed, and holds names and values for the importer CLI only:
  ```
  TIGER_DATABASE_URL=      # encore_importer; no TLS parameters in the URL
  TIGER_TLS_UNVERIFIED=    # unset = verify-full; 1 = require (encrypted, server not authenticated; RFC §13)
  ```
  Never put `TIGER_ADMIN_DATABASE_URL` (the importer refuses to start) or `TIGER_READ_DATABASE_URL` there.
- **Provider checklist** (tier, region, versions, TLS mode, date): recorded here by hand after TIG-D1, per TIG-03.
