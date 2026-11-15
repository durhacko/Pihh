# Tiger Data evaluation

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file has been built, run or measured. There is no Tiger Data, MongoDB or Gemini code, no `src/telemetry/`, no `integrations/gateway/` and no backend on `main` at `23d6748`. Every test below is a **planned check**. §8 records the executed evidence, and there is none yet.

Purpose: the validation specification for importing Encore's committed `RunRecord` artifacts into Tiger Data and querying them for experiment analytics. It defines tests `TIG-T01`…`TIG-T44`, the database testing strategy, the experimental-method checks, the principal 12-step end-to-end acceptance with its evidence, and the gates. Status: proposed. Owner: Arnav (integration, issue #142). Source author: William Pimentel (`wpimento`), [Tiger Data technical plan](../handoffs/Encore_Tiger_Data_Technical_Plan.md) §15 "Test plan and acceptance criteria", with the cautions of §7, §8, §9, §12–§14 and Appendix A. Audit base: `origin/main` `23d6748`.

Sibling documents, written together with this one:

- **Canonical overview:** [`../integrations/tiger-data-analytics.md`](../integrations/tiger-data-analytics.md), owner of `TIG-FR-*`/`TIG-NFR-*`, `TIG-CC-*`, `TCR-*`, `TIG-D*` and `TIG-R*`. Where a rule below differs from it, the overview wins.
- **Ingestion RFC:** [`../design/TIGER_TELEMETRY_AND_INGESTION_RFC.md`](../design/TIGER_TELEMETRY_AND_INGESTION_RFC.md): validation, identity, manifest, ledger states, DDL, import and verification queries.
- **Analytics RFC:** [`../design/TIGER_ANALYTICS_AND_DASHBOARD_RFC.md`](../design/TIGER_ANALYTICS_AND_DASHBOARD_RFC.md): routes, provenance, analytics queries, dashboard.
- **Work packages:** [`../planning/tiger-data-integration-work-packages.md`](../planning/tiger-data-integration-work-packages.md), `TIG-01`…`TIG-11`.
- `TIG-T*` tests are defined only here; the other four cite them.

Linked, not restated: metric, summary and scenario definitions, the win rule, the procedure and the wording rules are in the base [evaluation and tests](evaluation-and-tests.md) (§2 metrics, §3 scenarios, §4 fairness, §5 procedure, §8 wording); base tests T01–T19 are its §6. The export envelope and persistence boundary are `X-OUT` and `X-PERSIST` in the [optional integration boundaries](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#4-x-out-telemetry-export) (provisional, #110), whose boundary test is `P2-T35` in the [Phase 2 evaluation](PHASE2_EVALUATION.md) (provisional, #110). The shared gateway skeleton, its guard, the error envelope, the `requestId` rule and the app-side folder `src/app/live/` are defined once in [boundaries §6.2](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard) (provisional, #110); the tests below cite it and do not redefine it. Composition identities come from the [Gemini spec](../integrations/gemini-generated-formations.md) (`sceneHash`; provisional: depends on #117) and the [MongoDB show library](../integrations/mongodb-atlas-show-library.md) (`contentHash`; provisional: depends on #130).

---

## 1. Scope and evidence rules

Almost everything here is a deterministic pass/fail check over the 50 committed records in [`results/`](../../results/README.md). The local artifacts and the CLI report ([`RESULTS.md`](../../results/RESULTS.md)) stay authoritative; Tiger Data holds a verified, queryable copy and is never the only copy of any evidence (William §5, Appendix A).

| Kind | Where it runs | What it may establish | Permitted wording |
|---|---|---|---|
| **Unit** | Root `npm run check` (`tests/telemetry/`, pure `src/telemetry/`), or the gateway package with a mocked `TigerRepository`. No network, no database | Validation, identity, row serialisation, ledger logic, importer control flow, route behaviour, report reuse | "TIG-Txx passes on commit X". **Never** "imported into Tiger" |
| **Integration** | Gateway package against a local PostgreSQL + TimescaleDB container | SQL, constraints, transactions, hypertable DDL, roles | "Against TimescaleDB `<extversion>` on PostgreSQL `<version>` in a local container …" |
| **Live** | Gateway package against a disposable Tiger Cloud service (§3) | Real Tiger Data persistence, provider TLS, provider defaults | "Imported into and verified against Tiger Cloud on date D, service `<redacted id>`, TimescaleDB `<extversion>`" |
| **UI** | View-model tests in Node (`vitest` runs with `environment: 'node'`), plus screenshots | Provenance, censoring and labelling rules | "The view model labels …"; screenshots only as acceptance evidence |
| **e2e** | A person following §6 | William's whole workflow | Only with the §6 evidence attached |

Rules:

1. **No cloud claim from a mock or a container.** Only a Live test or the §6 acceptance against a Tiger Cloud service may support "stored in Tiger Data". A local TimescaleDB container proves the SQL, not the provider.
2. **Core checks stay offline; gateway unit tests still run automatically.** Integration and live tests live in the gateway's own package (`integrations/gateway/`, module `tiger`) and never run under `npm run check` or `bash scripts/check.sh`, which stay offline and unchanged. Because root CI runs only `check.sh`, the gateway's offline unit tests run in a separate CI job, **`CI-GW`** (planned; needs the CI owner's sign-off, which is open, §10 item 11). It is a separate workflow triggered by `paths: integrations/**, src/analytics/**, src/app/live/**` and is a required check for PRs touching `integrations/**`. It runs `npm ci --ignore-scripts` in `integrations/gateway`, then T31, T33, T34, T36 and the fake-repository tests, then `npm audit --omit=dev --audit-level=high` and `npm audit signatures` (the dependency policy of boundaries §6.2). It also greps the built app `dist/` for `postgres://` and `TIGER_`, and the gateway build for `postgres://`. Without `CI-GW`, a change that interpolates SQL or logs a URL would merge green.
3. **Live tests are opt-in.** They run only when a test connection string is set, never against a shared or demo database; skipped means reported as not run.
4. **Imported is not verified.** "Imported" means committed. A run is "verified" only when both mechanisms agree: the latest `run_verifications` row (written after the post-commit re-read, ingestion RFC §11.1) says `verified` and matches the run row's digests, telemetry is present, and, on routes that return series or events, the per-read digest recomputation (analytics RFC §2.1) matches too. The run list, which recomputes nothing, says "verified at import" (TIG-T13, T37, T43).
5. **Fixtures are evidence, not new results.** Their numbers are cited only from `RESULTS.md`; no Tiger query output is presented as a new experimental result.

### 1.1 Repository facts the tests rely on

Checked in this worktree at `23d6748`.

| Fact | Where | Consequence for the tests |
|---|---|---|
| `MetricsSample` and `RunRecord` match William §2; no run UUID, composition id, `inHold` or import status | [`src/contracts/metrics.ts`](../../src/contracts/metrics.ts) 6–23 | Identity lives in an external manifest; no contract change in the MVP |
| 50 committed records: S0, S1, S2, S3, S5 × seeds 1–5 × {static, encore}, `n0` 200, all `v: 1`, one `git` (`571c8e4…`, not `23d6748`), one `paramsHash` | `results/*.json`, [`PARAMS.md`](../../results/PARAMS.md) | The fixture set `FX-50` (§2) |
| The largest file is 113,222 bytes (`S5_n200_encore_s4.json`); all 50 total 5,380,896 bytes | `results/*.json` (measured) | The 1 MiB per-record cap is about 9× the largest file (XI-8; T02) |
| Every record has 360 samples, ticks 5, 10, …, 1800; no tick-0 sample; counters never decrease | `results/*.json` | Expected schedule `{5k : 1 ≤ k ≤ 360}`, not `0…1800` |
| 0–4 events per record, 80 in total; S5's `INJECT_SCORE` carries the full score. Every `KILL` is at tick 400. S2 seeds 1 and 3 share a kill set, so S2 has 4 distinct event sets (S1 has 5; S0, S3 and S5 one each by design). No committed record has `tRec = 0` | `results/*.json` (re-checked) | Event counts and digests (T42); `distinctEventSets` (T22); `tRec = 0` needs a synthetic fixture (T39) |
| 7,943 samples have `pwc` and `npwc` equal to `1.0000000000000004`; some summaries hold `npwcEnd` `1.0000000000000002`, `coordLoss` `−4.4e-16`, `npwcDeficitSec` `−2.6e-14`. No null `npwc`, `sfMean` or `sfMax` occurs | `results/*.json` | A strict `BETWEEN 0 AND 1` rejects every artifact (T05). Null handling needs synthetic fixtures (T07) |
| Summary: 23 keys always, plus `tRec` **only** with a `KILL` (absent otherwise, not null). `recovery()` (from `tick >= killTick`) needs 12 consecutive hold samples 5 ticks apart with finite `npwc ≥ 0.95` and returns `(start − killTick) × DT`; 0 if every post-kill hold sample qualifies; else null | [`src/observer/summary.ts`](../../src/observer/summary.ts) 41, 56–78, 135 | Three recovery states plus the `tRec = 0` case (T23, T39). `inHold` is not exported, so no summary is recomputed from samples |
| `canonicalJson` sorts keys, drops `undefined`, throws on a non-finite number. Files are written as `JSON.stringify(record) + '\n'`, not canonically | [`src/cli/run.ts`](../../src/cli/run.ts) 27–36; [`src/cli/main.ts`](../../src/cli/main.ts) 155 | `fileSha256` ≠ `artifactHash` for every committed file (T08) |
| `fairPair` compares only `git`, `paramsHash` and canonical `events` (scenario, `n0`, seed come from grouping); S5 has no verdict; `buildReport` is the only full-report entry point: Markdown, order-independent. Per-arm statistics use every record of an arm; deltas use `paired` seeds only; a mismatched seed prints `**MISMATCH**` | [`src/cli/report.ts`](../../src/cli/report.ts) 22–24, 134–142, 194–208, 253–263 | Report equality is string equality (§1.2). The pair route needs equal `pairKey`; the multi-seed route classifies instead of filtering, so `MISMATCH` and `UNPAIRED` seeds reach `buildReport` (T19, T22) |
| `report.ts` lives in `src/cli`, which XI-2 bars from the gateway | XI-2; boundaries §6 (provisional, #110) | The multi-seed route answers 503 until TIG-D7 (T18) |
| `runReport` reads every top-level `*.json` in the directory, filters `v === 1`, no other validation | `src/cli/main.ts` 99–109 | No manifest or ledger `*.json` may sit in `results/` (T14) |
| `DT = 0.05` is a module constant, not a field of `Params`, so `paramsHash` does not cover it | `src/contracts/params.ts` 3 | DT comparability is tied to `git`; the database CHECK pins `dt_seconds` to 0.05, so a DT refusal can fire only against the fake (T20, T25) |
| The boundaries test and the ESLint `fetch`/`Date` bans cover only the five core folders | `tests/boundaries.test.ts` 8–16; `eslint.config.js` 9–13 | `src/telemetry/` and `src/analytics/` need their own entries (T27) |

### 1.2 Report equality, defined

William §15's "same results as existing CLI report" is made exact here, because `RESULTS.md` is not a pure generated file: its generated part (lines 1–226 at `23d6748`) is followed by a hand-written `---` / `## Notes` section.

Let `F` be the records read exactly as `runReport` reads them (top-level `*.json` of `results/`, sorted, parsed, filtered `v === 1`), and `D` the records reconstructed from Tiger rows for the same set of `artifactHash` values, in any order.

- **E1, record equality:** for every record, `canonicalJson(d) === canonicalJson(f)`, hence equal `artifactHash`. This is stronger than report equality, because `buildReport` ignores `series`, `stateHash` and `v`. For an archived run, E1 compares everything but `series`.
- **E2, report equality (the principal proof):** `buildReport(D) === buildReport(F)` as JavaScript strings. No whitespace normalisation, no numeric tolerance.
- **E3, anchoring to the committed file:** with `md = buildReport(F)` and `R` the committed blob (`git show <commit>:results/RESULTS.md`, so checkout line-ending conversion cannot interfere), `R.startsWith(md)` and `R.slice(md.length).startsWith('\n---\n')`. Whole-file equality is **not** a criterion and fails by design.

`GET /api/experiments/comparison` answers one cell `(scenario, n0, git, paramsHash)` (all four required), and `buildReport` over one cell prints `Records: 10` and one group. No route call therefore yields the five-scenario report, and E2 with `F` defined as the route's own filtered set could not detect a selection that diverges from the CLI. So the route is checked per cell, and E3 through a function:

- **E2-cell:** for each cell, `reportMarkdown === buildReport(F_cell)`, where `F_cell` is every local record of that cell from the fixture set that was imported, **unfiltered**. When no exclusion fires (as with `FX-50`), this also proves the route's selection is neutral.
- **E2-sel:** when exclusions fire (`FX-COMP`, `FX-DEV`, `FX-NOTPRE`, `FX-CONFLICT`, a `mismatch` run; in the fake also `FX-HASHV` and `FX-HORIZON`), `reportMarkdown === buildReport(F_cell \ X)` and the response's `excluded` equals `X`. `X` is the expected list written in the test, never read back from the route.
- **E3 through the gateway:** a gateway-internal function (no route, so T36's route table is unchanged) reconstructs every verified run of one `(git, paramsHash)`, here all 50, and calls `buildReport` once. E2 and E3 apply to its output `D`.

An archived run is reported, not excluded (overview §6.6, TIG-FR-10, analytics RFC §6.2). It stays in the E2-cell set, never in `X`, and is listed in `selection.archived`. E2 holds because `buildReport` never reads `series`.

**Before TIG-D7.** XI-2 bars the gateway from importing `report.ts` until TIG-D7 allows it. Until then the route answers 503 `PROVIDER_UNAVAILABLE` with `details[].reason = 'REPORT_NOT_ENABLED'`, no report subprocess is ever spawned, and the E3 function does not exist. E1–E3 are then checked offline in `tests/telemetry/`, over records rebuilt by `rowsToRecord` from the rows `normalise` produces (no database). That is evidence for the round trip through the row format, not for Tiger.

E1 holds for every reconstructed record. E3 applies to `FX-50` only.

### 1.3 Deviations from William's plan that change a test

Each is a conflict record (`TCR-*`) or decision (`TIG-D*`) in the canonical overview.

| William | This file tests | Record |
|---|---|---|
| `src/server/` and top-level `sql/` | Networked code in `integrations/gateway/` (module `tiger`); pure code in `src/telemetry/`; SQL as documentation, later gateway migrations | TCR-01 |
| `experiment_key` not unique | Unique over clean-git runs (partial index) as the database backstop for the conflict rule | TCR-03, TCR-14; TIG-D11 |
| MongoDB catalogue upsert inside the import path | No MongoDB in the Tiger MVP; import state in the local ledger and Tiger | TCR-02, TCR-04; TIG-D2 |
| Minimum-matrix command re-run into `results/` | The committed 50 records are the fixtures; any re-run writes to a scratch `--out`, never `results/` | TCR-06 |
| Compare against `npm run eval -- --report` output | §1.2 E1–E3 | TCR-07 |
| Authenticated HTTP upload | Importer CLI with a write role; read-only analytics routes; no HTTP write route in the MVP | TCR-08 |
| `CHECK (pwc BETWEEN 0 AND 1)` | `pwc` up to `1 + 1e-9`, `coverage` in [0, 1], values stored unclamped | TCR-12 |
| Expected schedule implied from tick 0 | Ticks 5…1800, 360 samples | TCR-11 |
| DT "read from versioned parameters" | DT recorded as `dtSeconds`, asserted at the record's `git`, not `paramsHash` | TCR-15 |
| Primary key `(sample_time, run_id, tick)` | `(run_id, sample_time)` plus the tick-to-time `CHECK` (ingestion RFC §6.2) | TCR-24 |
| "Mark import complete" as the last step | `verified` from an INSERT-only `run_verifications` row plus a per-read digest check | TCR-30 |

---

## 2. Fixtures and test doubles

Committed files are read-only. Derived fixtures are generated by test code into a temporary directory, carry `fixture` provenance, and never enter a shared or demo database.

| Fixture | Content |
|---|---|
| `FX-50` | The 50 committed `results/*.json`, read from the git blob at the test's commit |
| `FX-PAIR` | `S2_n200_static_s1.json` and `S2_n200_encore_s1.json` (a `KILL` scenario; static censored, Encore recovered, per `RESULTS.md`) |
| `FX-S5` | `S5_n200_{static,encore}_s1.json` (largest event payload, no-verdict scenario) |
| `FX-BAD/*` | One derived file per rejection reason, tagged with the expected reason: `v: 2`; a sample value written as `1e999` (which `JSON.parse` turns into `Infinity`); tick 905 removed; tick 905 duplicated; `collisions` decreasing at one sample; `alive > n0`; `coverage` above 1; `pwc` above `1 + 1e-9`; unknown event type; `KILL` id outside `[0, n0)`; a `JAM_ON` `id` outside `^[A-Za-z0-9_.:-]{1,64}$`; a string holding `\u0000`; a string holding a lone surrogate `\ud800`; arm `central`; file above the size cap; more samples than the cap |
| `FX-NULL` | Derived from `S1_n200_static_s1.json` with the tail set to `alive 0` and `npwc`, `sfMean`, `sfMax` null (the committed set has no null quality value) |
| `FX-DIRTY`, `FX-UNKNOWN` | `git` suffixed `-dirty`; `git` set to `unknown` |
| `FX-CONFLICT` | `S2_n200_encore_s1.json` with one summary value changed: same `experimentKey`, different `artifactHash` |
| `FX-RESER` | `S0_n200_encore_s1.json` re-serialised with `canonicalJson`: different `fileSha256`, same `artifactHash` |
| `FX-MOVED` | A byte-identical copy of `S0_n200_encore_s1.json` under another directory and file name (as #137's `superseded-*` copies would be) |
| `FX-MISMATCH` | `FX-PAIR` with one `KILL` id changed in the Encore record only (report shows `MISMATCH`) |
| `FX-UNPAIRED` | `FX-50` minus one static record |
| `FX-MISSING` | `FX-50` minus both arms of S2 seed 2 |
| `FX-DEV` | `FX-PAIR` relabelled seed 101. Synthetic: it is **not** a development run and exists only to test exclusion |
| `FX-NOTPRE` | `FX-PAIR` relabelled seed 6: outside the minimum matrix's seeds 1–5, not a development seed |
| `FX-COMP` | `FX-PAIR` with manifests whose `compositionId` differs (`scenario:S2` versus a placeholder `sceneHash`) |
| `FX-GAP` | Database rows for `FX-PAIR` with tick 905 deleted from one run after import (alignment test only) |
| `FX-TREC0` | A view-model input only: `FX-PAIR`'s Encore summary with `tRec` set to 0 (no committed record has 0) |
| `FX-HASHV` | In the fake only: the stored `experiment_runs` row of `S1_n200_static_s3.json` with `hash_version` 2 and nothing else changed. One database holds one `hashVersion`, so only the fake can hold it |
| `FX-HORIZON` | In the fake only: the stored `S1_n200_encore_s4.json` run cut to ticks 5…900, with `expected_samples` 180, consistent digests and a `verified` `run_verifications` row. Every CLI scenario expects 360, so only the fake can hold it |

**Mocked `TigerRepository`.** The gateway module talks to the database only through one repository boundary: the `TigerRepository` interface of TIG-04 (the ingestion RFC §1 seam). The fake is in memory and enforces the same uniqueness rules as the DDL (`artifact_hash`, `experiment_key` among clean-git runs, `(run_id, sample_time)`, `(run_id, event_index)`, the `import_conflicts` key), keeps `run_verifications` append-only, applies a transaction as all-or-nothing, and can inject a fault after the k-th row, at `COMMIT`, after `COMMIT`, or on read-back. It never returns a value it was not given, so a tampering test edits its store directly.

---

## 3. Database testing strategy

| Layer | Database | Counts as "real Tiger Data"? |
|---|---|---|
| Unit | Mocked `TigerRepository` only | No |
| Integration | `timescale/timescaledb` container pinned by digest (`timescale/timescaledb@sha256:…`, recorded in T41's evidence), chosen to match the target service's TimescaleDB and PostgreSQL versions (record both with `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'` and `SELECT version()`) | No. It is TimescaleDB, not the managed provider |
| Live | A disposable **Tiger Cloud** service created for testing (free or trial), separate from any service used for a demo | **Yes**, and only this |

Provider facts that shape the live setup (checked 2026-11-15 against Tiger Data's official docs; sources in the ingestion RFC):

- VERIFIED: free services (shared compute, `us-east-1`, 750 MiB, read-only at the cap, no pooler) **supply no SSL certificate**, so only `sslmode=require` works there (T35). Trial data may be removed when a trial ends without a payment method (rule 5).
- VERIFIED: a hypertable's unique indexes must include the partition column; the default chunk interval is 7 days; `CREATE TABLE … WITH (tsdb.hypertable, …)` enables the columnstore unless `tsdb.columnstore=false`.
- UNVERIFIED: COPY and named prepared statements through the transaction-mode pooler; live tests use the direct connection.
- UNVERIFIED: whether node-postgres can make SCRAM channel binding mandatory against a Tiger service (TIG-03 checks; T35 records it).
- PARTLY: the service's TimescaleDB version (2.31 announced 26 Oct 2026; 2.32.0 on GitHub 12 Nov 2026). T41 records `extversion`.

**Isolation and clean-up per run.**

1. Each run generates a `testRunId` (12 random lowercase hex characters) and creates schema `tig_test_<testRunId>` in place of the RFC's `encore` schema, applies the migrations inside it as the schema owner (the harness's admin credential, never the importer's), and grants the test importer and reader roles on that schema only. The schema name is the one identifier not fixed in code, so it is handled by a single helper, the only exception T33's scan allows. The helper rejects any name not matching `^(encore|tig_test_[0-9a-f]{12})$` before use. It quotes the name with `%I` (`format()` or pg-format) for `CREATE`/`DROP SCHEMA`. Migration and runtime SQL use unqualified names under `set_config('search_path', $1, true)` (the parameterised `SET LOCAL`), so the name is never interpolated into migration SQL.
2. `afterAll` drops the schema with `CASCADE`, **also after a failure**, then queries `information_schema.schemata` and `timescaledb_information.hypertables` to record that zero objects of this run remain.
3. A sweep drops `tig_test_*` schemas from earlier crashed runs that are older than 24 hours, judged by their migrations table's `applied_at`. It selects names only from `information_schema.schemata WHERE schema_name ~ '^tig_test_[0-9a-f]{12}$'`, and it refuses to run unless `current_database()` and the connection's service id match the allow-listed test service.
4. Containers run with `--rm` and a throw-away volume.
5. Connection strings live only in the runner's environment. There are three: the test service's admin URL `TIGER_ADMIN_DATABASE_URL` (read only by the live-test harness, for schemas, migrations and the sweep; TR-6), the test importer URL `TIGER_TEST_WRITE_URL` and the test reader URL `TIGER_TEST_READ_URL`. The switch is these three: live tests are skipped unless all three are set (WP TIG-03 names the same set). Neither CI nor `scripts/check.sh` sets them.
6. Volume, size and latency are observations, never pass criteria. William §11's 18,000 sample rows is an exact expectation for the committed data, not a budget.

---

## 4. Tests TIG-T01–TIG-T44

All MUST. "WP" is the [work package](../planning/tiger-data-integration-work-packages.md) that makes the test pass: TIG-02 validation and identity (`src/telemetry/`, including the pure ledger logic); TIG-03 migrations and connection (roles, TLS, secrets); TIG-04 importer; TIG-05 verification and retry; TIG-06 analytics API; TIG-07 paired comparison; TIG-08 UI; TIG-09 optional MongoDB catalogue; TIG-10 end-to-end validation; TIG-11 live ingestion. Caps, states and queries `Q*` are the RFCs'; the tests cite them. Error responses use the shared envelope `{ "error": { "code", "message", "details"?: [{ "path", "reason" }], "requestId"? } }` with an XI-3 `code`; Tiger causes are `details[].reason` values. Live-ingestion tests are `TIG-T45+`, written with TIG-11.

### 4.1 Import correctness (T01–T12)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T01 | Unsupported record version | unit | `FX-BAD/v2` | Rejected before any row is built with `SCHEMA_VERSION_UNSUPPORTED`; state `rejected`; no repository call | TIG-02 |
| T02 | Structure, events, strings and size caps | unit | `FX-BAD/*` (arm, event type, `KILL` id, event `id`, `\u0000`, lone surrogate, size, sample cap) | Each rejected with its tagged reason and JSON path. Every string reachable from the record, keys included, is checked after parsing for U+0000 and unpaired surrogates. The RFC's caps (file 1 MiB checked before parsing, about 9× the largest committed file of 113,222 bytes, XI-8; events, event size, `versions` keys) accept every `FX-50` file and reject cap + 1 | TIG-02 |
| T03 | Finite numbers before serialisation | unit | `FX-BAD/1e999`; an in-memory record with `NaN` | Both rejected by an explicit check, never turned into `null` (William §8's `JSON.stringify` warning); `canonicalJson` throwing is not relied on as the validator | TIG-02 |
| T04 | Sample schedule and completeness | unit | `FX-50`; `FX-BAD/missing-905`, `/duplicate-905` | `FX-50`: 360 samples, first 5, last 1800, step 5, `expected_samples = 360`. Missing or duplicate tick rejected (William: "Missing sample tick") | TIG-02 |
| T05 | Ranges with tolerance, stored unclamped | unit | `FX-50`; `FX-BAD/coverage`, `/pwc` | All 50 accepted, including `pwc = 1.0000000000000004` and negative-epsilon summary values; `coverage` above 1, `pwc` above `1 + 1e-9` or `alive` outside `[0, n0]` rejected; no range check on `npwc` or summary values; rows equal the source bit for bit (`Object.is`) | TIG-02 |
| T06 | Cumulative counters | unit | `FX-50`; `FX-BAD/counter-decrease` | `msgs.*`, `collisions`, `nearMisses`, `slotChanges` non-negative integers, non-decreasing; the decreasing one rejected (William: "Counter decreases") | TIG-02 |
| T07 | Nulls and zero alive | unit | `FX-NULL` | `npwc`, `sfMean`, `sfMax` serialise to `null` (SQL NULL), never 0; `alive = 0` with a non-null quality value rejected; no quality value is fabricated (William: "`npwc = null`", "Zero alive") | TIG-02 |
| T08 | Identity hashes and the lock key | unit | `FX-50`, `FX-RESER`, key-permuted copy | `artifactHash` ≠ `fileSha256` for all 50; permuting keys keeps `artifactHash`, changes `fileSha256`; the ingestion RFC's §4.4 vectors for `FX-PAIR` reproduced in full; `pairKey` equal within each committed pair, distinct across pairs. Q2's lock key: `BigInt.asIntN(64, BigInt('0x' + key.slice(0, 16)))` gives −8478644600858377980 for `8a55cda8450d8104` and 4181465500289548022 for `3a078cb7d94f3ef6` (ingestion RFC §9) | TIG-02 |
| T09 | Weak provenance | unit | `FX-DIRTY`, `FX-UNKNOWN`, a manifest without `compositionId` | `gitClean = false`, flagged "weaker reproducibility evidence", conflict-exempt (two different `-dirty` records on one HEAD are no conflict), never compared (TIG-D10, TIG-D11); no composition identity ⇒ storable, `pair_key` NULL, never compared | TIG-02 |
| T10 | Pure row normalisation and its inverse | unit | `FX-50` (deep-frozen) | William's §8 field mapping; `sample_time` = `2020-01-01T00:00:00Z` + `tick × 50 ms`; `event_index` = array position, `details` the full event; `summary_json` deep-equals `summary` (absent stays absent, null stays null; TCR-25); rows → record restores `artifactHash`; the frozen input is not mutated | TIG-02 |
| T11 | Transactional import and rollback | unit | Mock with a fault after sample row 200, a failing in-transaction check, and a lost `COMMIT` acknowledgement | Fault or failed check: zero rows for the run, state stays `validated`, retry allowed; lost acknowledgement: `incomplete` (`COMMIT_UNKNOWN`), resolved by reconciliation; artifact bytes unchanged; the importer never reports "persisted" (William: "Fail mid-import") | TIG-04 |
| T12 | Idempotency, conflict and development seeds | unit | `FX-PAIR` twice; then `FX-CONFLICT`; then `FX-RESER` and `FX-MOVED` after `S0_n200_encore_s1.json`; `FX-DEV` with the fake's target schema named `encore`, then `tig_test_<testRunId>` | Second import: `verified`, zero new data rows, one new `run_verifications` row. `FX-CONFLICT`: `conflict`, no row changed, one `import_conflicts` row (Q15), never resolved by `ON CONFLICT DO NOTHING` alone. `FX-RESER` and `FX-MOVED`: the manifest is reused because its identity fields are equal (first-observation fields are never compared), each attempt's file is recorded on its `discovered` ledger line, and each ends `verified` with zero new data rows. A manifest whose identity fields differ gives `rejected` with `MANIFEST_MISMATCH`. With a deterministic `run_id` scheme (TIG-D4), the recomputed `run_id` equals the stored one. `FX-DEV` into schema `encore`: `rejected` with `DEV_SEED`, no repository write call, nothing sent (ingestion RFC §10 step 1). The same fixture into `tig_test_<testRunId>`: accepted and `verified` | TIG-04 |

### 4.2 Cross-database behaviour and the ledger (T13–T16)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T13 | Post-commit verification and the `verified` flag | unit | Mock: (a) after commit, change one stored `npwc` by 1 ulp, one event `details`, one summary key; (b) case G: verification cannot connect, or the row is not yet visible; (c) a change made after a `verified` `run_verifications` row | (a) The re-read (primary, importer credential, `BEGIN READ ONLY`) gives digests that differ from the manifest's; a Q13 row with `outcome = 'mismatch'`; state `incomplete` (`VERIFY_MISMATCH`); case H: the API reports `verification: 'mismatch'`, `verified: false`, the run is never paired (`UNVERIFIED`, deltas null) or counted, and the badge changes. (b) No Q13 row, ledger `imported`, never `VERIFY_MISMATCH`; the API reports `verification: 'not-checked'`, `verified: false`; a retry verifies only. (c) The per-read recomputation on the metrics and pair routes reports `mismatch`. A count-only check passes on the same data, showing why counts are not enough (William §8) | TIG-05 |
| T14 | Ledger state machine, location and two checkouts | unit | Scripted attempt sequences, including a lost ledger; two worktrees with two state directories importing into one schema | Only the ingestion RFC's transitions occur (including `archived`); the ledger is append-only (earlier lines byte-identical); a lost ledger is rebuilt from Tiger, entries marked "reconstructed"; manifests and ledger sit outside `results/` (TIG-D5), and `npm run eval -- --report results/` still reads exactly 50 records. A run imported from worktree A has no entry in B's ledger: B's `tiger reconcile` finds its evidence **by content** (scanning `--dir` or `--evidence-root`), never by `artifact_path`; a file at that path with another hash is reported "file at path superseded" (informational), never `VERIFY_MISMATCH`; no matching file gives "stored copy without local evidence"; nothing is deleted; the run keeps its Q13 row | TIG-02, TIG-05 |
| T15 | Failure after Tiger commit, Tiger unavailable, archive and restore | unit, integration | Mock and container: process killed between `COMMIT` and the ledger append; database refused at connect; `FX-PAIR` archived (Q16), then re-imported, then restored (Q16b); a delete (Q16c) attempted while an `import_conflicts` row names the run | Next run takes the identical-artifact path, re-verifies, writes `verified`, inserts no data rows; database down: artifacts untouched, state stays `validated`, a later retry succeeds; no output claims cloud persistence on failure (William §14). Archived: re-import appends `archived` with `ARCHIVED`, never `VERIFY_MISMATCH`, and Q14 expects `samples = 0`. Restore: the local artifact is found by content and validated, then `verified` with `run_id`, events, summary and conflicts unchanged. Q16c refuses while the conflict row exists. Archive, restore and delete run only under the owner credential; the importer has no `UPDATE` or `DELETE` | TIG-05 |
| T16 | MongoDB independence | unit | Source scan of the `tiger` module; gateway started with the MongoDB module disabled and with it failing | No MongoDB call in the Tiger import path; import succeeds either way; nothing written to `saved_shows`, and MongoDB holds no Tiger telemetry (XI-6). If TIG-D2 approves a catalogue (TIG-09): written only after `verified`; a MongoDB failure reports "catalog incomplete", Tiger and ledger untouched, and an idempotent retry reconciles it (William: "MongoDB fails after Tiger commit") | TIG-05, TIG-09 |

### 4.3 Experimental correctness (T17–T26)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T17 | Record reconstruction round trip | integration | `FX-50` imported into the container | §1.2 E1 for all 50: `BIGINT` read as numbers (node-postgres returns strings by default), `float8` exact, JSONB numbers exact, `tRec` absent versus null preserved, same-tick event order preserved | TIG-07 |
| T18 | **Multi-seed paired statistics match the existing CLI report** | unit, integration | `FX-50` imported; rows returned in SQL order and in a fixed shuffled order; then `FX-COMP`, `FX-DEV`, `FX-NOTPRE` and `FX-CONFLICT` added | Before TIG-D7: every cell answers 503 `PROVIDER_UNAVAILABLE` with reason `REPORT_NOT_ENABLED`, no child process is spawned, and E2 and E3 hold offline (§1.2). After TIG-D7: §1.2 exactly: E2-cell for each of the five cells through `GET /api/experiments/comparison` (`excluded` and `missing` empty, `complete: true`); E2 and E3 on the all-runs function's output; E2-sel after the additions | TIG-07 |
| T19 | Report equality under perturbation | unit, integration | `FX-UNPAIRED`, `FX-MISMATCH`, `FX-MISSING`, `FX-S5` subsets, reconstructed and passed to `buildReport` unfiltered; one archived run | E2 for each: valid pairs, excluded pairs (`MISMATCH`, `UNPAIRED`), medians, paired deltas, censored counts, worst seed and the S5 no-verdict line all agree (William §15, last paragraph). `FX-MISMATCH`: `reportMarkdown` shows the `**MISMATCH**` row and "mismatched 1", and per-arm `n` counts the mismatched seed. `FX-MISSING`: `selection.missing` lists seed 2 for both arms (`absent`), `complete: false`. The archived run as §1.2 says | TIG-07 |
| T20 | Unfair comparisons rejected | unit | Run pairs differing in seed, events, `git`, `paramsHash`, `n0`, scenario, `compositionId` (`FX-COMP`), hash version, horizon; a dirty run; a contested run (`FX-CONFLICT`); a `mismatch` run; an archived run; the same run twice; arms swapped. In the fake only: a pair whose `dt_seconds` differ | `GET /api/comparisons` returns 422 `VALIDATION_FAILED` with one `details[]` entry per analytics-RFC §4.2 reason **before** any series query. `reason` is the code itself (`SEED`, `EVENTS`, `GIT`, `PARAMS`, `N0`, `SCENARIO`, `COMPOSITION`, `HASH_VERSION`, `HORIZON`, `GIT_DIRTY`, `CONTESTED`, `UNVERIFIED`, `DT`), and `path` names the run parameter (`encoreRunId` or `staticRunId`). `SAME_RUN` and `ARM_ROLES` give 400 `VALIDATION_FAILED`. With the viewing override every delta is null, and `CONTESTED` and `UNVERIFIED` keep deltas null. An archived pair gives 200 with `rows: []`, `fairness.eligible: false` and every delta null with `deltaReason: 'archived'`. `pairReasons` gives the same reasons in the gateway and in the UI. The digest-based `fairPair` check equals `fairPair` on the 50 records and on copies with an altered event, `git` or params. The `DT` case runs only against the fake, because the database CHECK pins `dt_seconds` (William: "Different seeds / events / code/params") | TIG-07 |
| T21 | Alignment without silent loss | unit, integration | (a) `FX-PAIR` rows with tick 905 removed from one side, in the pure `alignByTick`; (b) `FX-GAP` through the route; (c) the `FX-S5` pair | (a) Full outer alignment by tick (TCR-31): tick 905 present with the missing side null and listed in an explicit missing-tick report; `npwc` null stays null, never 0; Δ null where either side is null, other Δ unchanged (William §9.2). (b) The gapped run's read-path check gives `mismatch`, so the pair is blocked (`UNVERIFIED`); with the override the missing-tick report lists 905 and every delta is null. (c) `reference.differs` is true from the first tick where the two runs' `versions` key sets differ; from there `deltaNpwc` is null and the `npwc`, coverage and shape-fidelity summary deltas carry `differentReference: true` | TIG-06, TIG-07 |
| T22 | Comparison service reuses `report.ts` | unit | Mock holding `FX-50`, `FX-COMP`, `FX-DEV`, `FX-NOTPRE`, `FX-CONFLICT`, one `mismatch` run, `FX-HASHV` and `FX-HORIZON` | Selection is classification, not a `pairKey` filter: only `COMPOSITION_UNKNOWN`, `COMPOSITION`, `CONTESTED`, `DEV_SEED`, `NOT_PREREGISTERED`, `UNVERIFIED`, `HASH_VERSION` and `HORIZON` runs are excluded, each listed with its reason (analytics RFC §6.2). `FX-HASHV` is excluded as `HASH_VERSION` and `FX-HORIZON` as `HORIZON`, and each shows in `selection.missing` as `excluded` (E2-sel); `MISMATCH` and `UNPAIRED` seeds reach `buildReport`. `distinctEventSets` is 4 for S2 and seeds 1 and 3 are flagged as sharing an `events_digest`. The response carries `buildReport` Markdown verbatim plus `npwcRows` and `stats` output; every † field is `{ unavailable: 'see-report-text' }`, never `null`. The `stats` input mirrors `report.ts:237-240` (present keys in `METRIC_ORDER`, then the rest in `sort()` order; values from the reconstructed `summary`; `censoredHigh` only for `tRec`): no `tRec` row for S0, S3 and S5, static `tRec` printed `censored ×5` for S1. A source scan finds no median, quantile, win-margin or censoring logic in the gateway or analytics SQL. S5: no verdict, no W/T/L; its pass line is labelled per clause, clauses 1–2 "not derivable (needs `partitionSide`, which no record stores)" and 3–5 "in the record; not evaluated by `report.ts`", with no pass or fail computed (TCR-35) | TIG-07 |
| T23 | Censoring honesty | unit | `FX-50` S1/S2 groups | Three states mapped: finite `tRec` = Recovered, null with a `KILL` = Not recovered (censored), key absent = Not applicable; `tRec = 0` sets `tRecZero: true`; any `tRec` aggregate uses `stats(…, true)` and is shown with `n` and the censored count; a censored quantile reaches JSON as `'censored'`, never `null`; a scan finds no `AVG(t_rec_seconds)` in the named analytics queries (Appendix A: `AVG()` drops NULLs) | TIG-07 |
| T24 | Cumulative counters as deltas | integration | `FX-50` | `LAG` partitioned by `run_id`, ordered by `tick`; per-run Σ deltas = last total − first total; no delta crosses runs; the first row's delta equals its total and is marked "since run start"; an interval wider than 5 ticks is flagged as spanning a gap; totals and deltas carry different labels | TIG-06 |
| T25 | Time semantics | integration | `FX-50`; a record whose `git` commit is not available locally; a record with `git` `unknown` | `sim_seconds = tick × dt_seconds`, where `dt_seconds` is the DT read at the record's `git` (`git show <git>:src/contracts/params.ts`), never from `paramsHash`; a clean-git record whose commit is missing is `rejected` with `DT_UNVERIFIABLE`; an `unknown`-git record gets a `DT_ASSUMED` ledger warning; every named query filters by `run_id`; `imported_at` is wall-clock and labelled; no query or label calls `sample_time` real time. The DT pair refusal is T20's fake-only case | TIG-06 |
| T26 | Frozen revision | unit | `FX-50` plus one record with another `git`; `FX-DIRTY` | The multi-seed endpoint takes exactly one clean `(git, paramsHash)` (TIG-D10), with no mixing option and no `includeDirty`; the other-revision record is never merged into the cell, and `buildReport`'s mixed-revision `WARNING` line never appears; a `-dirty` or `unknown` `git` gets 422 `VALIDATION_FAILED` with reason `DIRTY_REVISION`; a superseded revision is labelled, never merged (base [§5](evaluation-and-tests.md#5-procedure) step 5) | TIG-07 |

### 4.4 Isolation and determinism (T27–T30)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T27 | Purity and the network boundary | unit | `tests/boundaries.test.ts` extended with `telemetry` and `analytics` entries; ESLint blocks; `P2-T35`'s allow-list (provisional, #110) | `src/telemetry/` imports only contracts, itself and the shared canonical-JSON module (XI-7); `src/telemetry/` and `src/analytics/**` use no `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource` or `node:net`/`pg`; network APIs appear under `src/` only in `src/app/live/analytics/` and `src/app/live/telemetry/`, behind their non-secret build flags (XI-14); `src/app/live/analytics/**` imports no X-IN validator, composition client or `INJECT_SCORE` builder; no core folder imports `src/telemetry/`; nothing under `src/` imports `integrations/` | TIG-02, TIG-08 |
| T28 | Determinism and non-mutation | unit, app | (a) Base T04 and T14 (`tests/observer/read-only.test.ts`); one scratch record made twice at one commit, with and without the gateway running. (b) For every package that adds browser network code (TIG-08's Tiger mode, the X-RUN/live client in `src/app/live/analytics/`; TIG-11, the exporter in `src/app/live/telemetry/`): a scripted app run with no operator input, driven through `window.encore`, made with the client or exporter on and its transport stalled (a `send` that never settles), failing and slow, then with it off | (a) Base tests green; the scratch files are byte-identical; importing leaves every `FX-50` file byte-identical. (a) is a smoke test only: the CLI never connects to the gateway, so it cannot fail and is no evidence for TIG-NFR-01. (b) Tick count, `stateHashes()` and `series()` are equal across every variant at fixed ticks, read while paused; with the exporter stalled, drops are counted and shown (William: "Observer enabled/disabled") | TIG-04 (a); TIG-08, TIG-11 (b) |
| T29 | Offline core unaffected | unit | Networking off, gateway absent, `integrations/` removed, every build flag off | `bash scripts/check.sh` passes; `npm run eval -- --report results/` reproduces E3; the default build makes zero external requests; NFR-04's acceptance check unchanged; `P2-T35` green (provisional, #110) (William: "Tiger offline") | TIG-02, TIG-10 |
| T30 | No path from the database to a drone | unit | Source scan of `src/analytics/**` and `src/app/live/{analytics,telemetry}/**` | Analytics code imports no controller, intent or `INJECT_SCORE` builder; responses are only rendered; nothing is called from the tick loop, a brain, the world or the observer (William §4.3, XI-5) | TIG-08 |

### 4.5 Security (T31–T36)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T31 | Secrets and missing secrets | unit (`CI-GW`) | Gateway started without, then with, Tiger settings; each process started with a credential it must not hold; captured logs; built `dist/` | Three credentials, one per process: reader `TIGER_READ_DATABASE_URL` (HTTP server), importer `TIGER_DATABASE_URL` from `tiger/.env.importer` (importer CLI), admin `TIGER_ADMIN_DATABASE_URL` (migrations and the live-test harness only). The HTTP server refuses to start if the importer, admin or `TIGER_LIVE_WRITE_URL` credential is set; the importer CLI refuses if the admin URL is set. Without settings `/api/health` reports `modules.tiger: { enabled: false, db: 'disabled' }` and other modules still run. No log, error body or bundle contains a host, password or `postgres://`; no `VITE_*` variable holds a Tiger credential or host, and the only Tiger `VITE_*` setting is the non-secret boolean build flag (XI-14) (William: "Missing secrets") | TIG-03, TIG-06 |
| T32 | Least-privilege roles | integration, live | `encore_reader` and `encore_importer` per the ingestion RFC §13; migrations applied by the owner | Reader: `INSERT`, `UPDATE`, `DELETE` and DDL all refused, also after `SET default_transaction_read_only = off` and inside `BEGIN READ WRITE`, because grants, not the session default, enforce read-only; a fourth reader connection is refused (`CONNECTION LIMIT 3`); the role-level `statement_timeout` applies. Importer: `SELECT`/`INSERT` on the four tables, `import_conflicts` and `run_verifications`, `SELECT` on `schema_migrations`, nothing else; no DDL, `UPDATE`, `DELETE` or `TRUNCATE`; its `current_user` is not the schema owner and has no `CREATE` on the schema. Whether `REVOKE TEMPORARY` could be applied is recorded (UNVERIFIED) | TIG-03 |
| T33 | Parameterised SQL and paths | unit (`CI-GW`) | Source scan; hostile query strings (`S1'; DROP TABLE experiment_runs;--`, `$1`, Unicode); hostile schema names; seed 4294967295 as filter and inside a cursor; rows carrying `../../x`, `\\h\s\x.json`, `results/../../x` as paths | No SQL built by string interpolation of input; identifiers never from input, except the schema name through §3's validating helper, which rejects every hostile name; hostile values return 400 `VALIDATION_FAILED` (`INVALID_QUERY`) or an empty result, tables intact; Q17's seed parameters are `::bigint`, so 4294967295 matches. The path CHECK refuses the hostile rows; no component opens a path read from the database; import and reconciliation open only files found under `--dir` or `--evidence-root`, resolved inside that root, with symlinks refused (`lstat`) and UNC and drive-letter paths refused before any open | TIG-04, TIG-05, TIG-06 |
| T34 | Untrusted input and bounds | unit (`CI-GW`) | Over-long query values, page size above the cap, unknown parameters, a valid and an invalid `requestId`, bursts per route, a pool held busy, a run archived between two requests | Rejected with the shared envelope (code, message, optional details), no raw driver error; a success body has no `success` flag. A `requestId` matching `^[A-Za-z0-9._:-]{1,64}$` is echoed; one that does not match is dropped, not echoed, and the request proceeds (XI-11). Pagination and series bounds enforced. Per-route budgets (20/s for the list and metrics routes, 5/s for pairs, multi-seed 1 at a time with a queue of 2) then 429 `RATE_LIMITED` with `Retry-After`. A pool acquisition over 2 s gives 503 `DATABASE_UNAVAILABLE` with reason `POOL_TIMEOUT`. Every response, errors included, is `Cache-Control: no-store` with no `ETag`; the re-request after archiving gives 200 with `samples: []` | TIG-06 |
| T35 | TLS | unit (`CI-GW`), live | URL parsing; test service | A URL carrying `sslmode` (any value, including `no-verify`, `prefer` and `disable`), `sslrootcert`, `sslcert`, `sslkey` or `ssl` is refused; `ssl` is built only from `sslMode`. `verify-full` is used where the service supplies certificates, and a wrong-hostname certificate fails it; `require` works only with `TIGER_TLS_UNVERIFIED=1` and is recorded as a documented weaker mode on a free service; the start-up log states the effective mode. The pinned `pg` version and whether SCRAM channel binding can be made mandatory are recorded (UNVERIFIED until checked) | TIG-03 |
| T36 | Exposure and the shared guard | unit (`CI-GW`) | Route table; bind address; requests with foreign `Host` and `Origin` | Only `GET` routes under `/api/runs`, `/api/comparisons`, `/api/experiments/comparison`, `/api/health`; no write route. The guard is boundaries §6.2's, not a Tiger copy: bound to `127.0.0.1`, refusing to start on any other address unless a server-side authorisation is configured and enabled (a flag alone is never enough); a non-loopback peer refused; `Host` allowed only as `127.0.0.1:<port>` or `localhost:<port>` (plus the dev proxy if used), so `Host: evil.example:<port>` gets 403 `FORBIDDEN` with no `Origin` and with `Origin: http://evil.example`; a non-GET with a missing, `null` or foreign `Origin` gets 403; a non-JSON body gets 415 `UNSUPPORTED_MEDIA_TYPE`; no CORS headers (OIB-Q2). A live-ingestion write route (TIG-11) is a separate process and needs `TIG-T45+` authentication tests against TIG-D13 before it merges | TIG-06 |

### 4.6 User interface: provenance and censoring (T37–T40)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T37 | Provenance on every chart | UI | View model fed `tiger` (each `verification` value), `local-artifact`, `live-provisional` and `fixture` responses; `FX-DIRTY`; a production build | Every chart and table has a badge with `source`, `verified`, `verification`, `importedAt`, `artifactHash` prefix, `git`, `gitClean`: `verified` gives "Tiger Data · verified copy"; a run-list row shows "verified at import"; `mismatch` and `verified-without-series` give "imported, not verified" with the reason. A dirty or unknown revision adds "Dirty or unknown revision · weaker reproducibility evidence" on every chart and selector row. A local file is never `tiger` and is `verified: false`. Fixtures and illustrative values are labelled; fixture mode exists only under `import.meta.env.DEV`, and a grep of the production bundle finds no fixture loader or data. Timeline and pair views carry "Single seed: not a result. See the multi-seed summary" (William §10) | TIG-08 |
| T38 | Unfair pairing blocked | UI | `FX-MISMATCH`, `FX-COMP`, a contested run, an archived run | Default: comparison not drawn, reasons listed for every candidate from `pairReasons`, with no request per candidate; override: runs side by side, no deltas, persistent warning naming each difference; `CONTESTED` and `UNVERIFIED` keep deltas hidden; an archived arm shows "Archived telemetry", never the blocked state | TIG-08 |
| T39 | Recovery display | UI | `FX-PAIR`, `FX-TREC0`, an S0 record; a sample with `npwc = 0.9496` | Recovered / `tRec = 0` / Not recovered (censored) / Not applicable shown distinctly. The band is the "first qualifying 12-sample streak (2.75 s)", never a "sustained recovery interval": `[s, s + 60)` ticks with `s = killTick + tRec/DT`, covering the 12 samples `s`…`s + 55`, drawn only for `tRec > 0`, one labelled strip per arm. `tRec = 0` draws no band, shows the two-cause label of overview §6.5 and is never "Recovered after 0 s". Censored reads "Not recovered, or not measurable (no hold sample after the kill): censored". Threshold line at 0.95; `npwc` always beside `alive`, `coverage`, `sfMean` and `sfMax`; y-axes fixed ([0, 1] for `npwc` and `coverage`, [0, `n0`] for `alive`, one scale per panel for both arms); `0.9496` prints `0.950` and does not meet 0.95; the end state reads "last sampled `npwc` at tick 1800: x (a sample, not the summary)", then `npwcEnd`; nulls shown as missing (`—`), never 0 | TIG-08 |
| T40 | Labels and degraded states | UI | Gateway stopped mid-session; a 503 `REPORT_NOT_ENABLED`; an incomplete selection; `markdown-plus-rows` mode | Totals versus deltas and synthetic time versus `imported_at` labelled; gap-spanning intervals hatched and marked, the first interval marked "since run start", per-second values labelled "approximate"; S5 shows no verdict. With the gateway down, data loaded earlier keeps only the badge "Tiger Data · cached at hh:mm · not current" with `verified` shown false, never current-Tiger wording; "Open local files" is offered and nothing falls back automatically. The not-enabled state points to `results/RESULTS.md`. An incomplete selection shows its banner and is never called a "multi-seed result". † items read "In the report text below (computed by `report.ts`)", and the report table keeps `**MISMATCH**` and `LOSS` as `<strong>` | TIG-08 |

### 4.7 Live Tiger integration and acceptance (T41–T44)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T41 | Schema on the provider | live | Fresh schema on the test service, migrations applied with the admin credential | The runner's version gates pass (PostgreSQL ≥ 16, TimescaleDB ≥ 2.20); migrations apply; hypertable created with an explicit partition column; primary key includes `sample_time`; the tick-to-time `CHECK` (immutable form, ingestion RFC) rejects a mismatched row; range `CHECK`s accept all 50 fixtures; Q2 with the `8a55…` key raises no 22003; no retention job on `simulation_metrics` (`timescaledb_information.jobs`) and columnstore as TIG-D9 sets it; `extversion`, PostgreSQL version, the container digest of any rehearsal and chunk count recorded as observations | TIG-03 |
| T42 | Import of the committed matrix | live | `FX-50` with the importer CLI and importer role | 50 runs, 18,000 sample rows, 80 event rows, 50 summary rows; per run 360 samples, first tick 5, last 1800; all 50 `verified`, each with a `run_verifications` row; Q2 takes its lock for every run; re-import adds no data rows (one new `run_verifications` row per run); `FX-CONFLICT` becomes `conflict`; a connection killed mid-import leaves zero rows for that run | TIG-04, TIG-05 |
| T43 | Analytics against the provider | live | T42's data, reader role; one run with its Q13 row withheld (case G); one run changed by the admin after its `verified` row (case H) | T17–T19, T21 and T24 repeated against Tiger Cloud; API responses carry `source: 'tiger'`, `verification: 'verified'` and `verified: true` (the list route: `verified-at-import`); the case-G run reports `not-checked` and `verified: false`; the case-H run reports `mismatch`, `verified: false` and is excluded; reader writes refused (T32) | TIG-06, TIG-07 |
| T44 | Principal end-to-end acceptance | e2e | §6 | All twelve steps pass on one commit with their evidence attached | TIG-10 |

---

## 5. Experimental-method checks

These apply to every comparison the API or dashboard shows. They implement base [§1](evaluation-and-tests.md#1-principles), [§5](evaluation-and-tests.md#5-procedure) and [§8](evaluation-and-tests.md#8-bias-risks-and-reporting-wording) and William §12, and add no new rule.

| Check | Rule | How it is tested |
|---|---|---|
| Pre-registered seeds | Reported seeds are the pre-registered evaluation seeds (1–5 here; 1–20 only if the full matrix runs); scenarios and the win rule come from the base file, never the dashboard. Missing seeds are listed, and an incomplete selection is never called a multi-seed result | T26: the multi-seed endpoint takes scenario, `n0`, `git`, `paramsHash` and `matrix=minimum\|full`, which picks a constant seed set, and **no** seed list; `NOT_PREREGISTERED`, `missing` and `complete` in T19 and T22 |
| Development seeds 101–105 never reported | The importer refuses them in schema `encore` (`DEV_SEED`), so they are stored only in test schemas; the comparison endpoint still excludes them as `DEV_SEED`, "development seed, not evidence"; no export or screenshot shows one as a result | `FX-DEV` in T12, T18, T22 |
| Every outcome shown | Losses (`LOSS` rows), ties, censored recoveries, mismatched and unpaired seeds stay visible with counts; `MISMATCH` and `UNPAIRED` seeds reach `buildReport`; nothing is filtered by outcome | T19, T22, T23, T39 |
| No cherry-picking | Single-run views carry "Single seed: not a result. See the multi-seed summary"; a seed subset is never presented as the multi-seed comparison | T37, T26 |
| `n` and worst seed | Every multi-seed view shows fair-pair `n`, censored count and worst seed exactly as `buildReport` prints them, and the distinct event sets ("S2: 5 seeds, 4 distinct kill sets") | T18, T19, T22 |
| `tRec` read honestly | Per-arm censored counts are the primary `tRec` comparison; the `tRec` median Δ is captioned "k of m fair pairs" | T22, T23, T40 |
| `npwc` never alone | `npwc` beside `alive`, `coverage`, `sfMean` and `sfMax`; for S2, the paired Δ of `sfMaxEndA` beside the W/T/L line | T39 |
| Weak evidence excluded | `gitClean = false`, missing composition identity, contested, unverified and mixed-revision runs: stored, labelled, never compared | T09, T20, T22, T26 |
| No new result claimed | Analytics numbers are cited only by reference to `RESULTS.md`; Tiger output is a verified copy | Wording rule, §10 |

---

## 6. Principal end-to-end acceptance (TIG-T44)

William §15's "most important end-to-end test", extended to the whole workflow, against a **disposable Tiger Cloud service**; a container run is a rehearsal and is reported as such. Instead of "generate records with the existing CLI" it uses the **committed** records (TCR-06): the CLI's overwrite guard refuses a re-run into `results/` at `23d6748`, because the records carry `git` `571c8e4…`. Step 11 makes a scratch record to test determinism.

| Step | Action | Evidence to capture |
|---|---|---|
| 1 | Record the environment | Commit and clean tree; `SELECT version()` and the `extversion` query output; the start-up line stating the effective TLS mode; channel-binding status; Node, pinned `pg` and gateway versions; container digest for a rehearsal; host redacted |
| 2 | Check the fixtures offline | `fileSha256` and `artifactHash` lists for the 50 files; validator verdict "50 accepted"; E3 result (`startsWith` true, remainder begins `\n---\n`) |
| 3 | Apply migrations to a fresh schema (admin credential) | Migration log with version gates; `\d+` of the four tables, `import_conflicts`, `run_verifications` and `schema_migrations`; `timescaledb_information.hypertables` row; the query showing no retention job; columnstore setting |
| 4 | Import the 50 records with the importer CLI (importer credential) | Ledger lines for all 50 ending `verified`; 50 `run_verifications` rows with `outcome = 'verified'`; manifests location (outside `results/`); importer exit status |
| 5 | Verify counts | Query text and result for runs (50), samples (18,000), events (80), summaries (50); per-run sample count, first and last tick (360, 5, 1800) for every run |
| 6 | Verify content | For every run: artifact-derived row digest and re-read digest (equal); reconstructed `artifactHash` equal to the manifest (E1) |
| 7 | Re-import and conflict | Second importer run: 50 `verified` no-ops, data-row counts unchanged (query before and after), 50 new `run_verifications` rows; `FX-CONFLICT`: state `conflict`, counts unchanged, conflict entry shown |
| 8 | Query one run and one pair through the API | `GET /api/runs` (filtered; rows "verified at import"), `GET /api/runs/:runId/metrics` (row count 360, first and last rows, `verification: 'verified'`), `GET /api/comparisons` for `FX-PAIR` (alignment report "0 missing ticks"); one unfair pair answered 422 `VALIDATION_FAILED` with one `details[]` entry per analytics-RFC §4.2 reason (`reason` = the code, such as `SEED` or `EVENTS`; `path` = `encoreRunId` or `staticRunId`); provenance block of each; the SQL text each route executed, from the query log with parameter values shown separately |
| 9 | Reconstruct the multi-seed report | Before TIG-D7: one cell's 503 `PROVIDER_UNAVAILABLE` body with reason `REPORT_NOT_ENABLED`, and the offline E1–E3 results of §1.2. After TIG-D7: for each of the five cells, `GET /api/experiments/comparison` output (`excluded` and `missing` empty, `complete: true`) and its `diff` against `buildReport(F_cell)` (empty, E2-cell); the all-runs function's output over the 50 records, its `diff` against `buildReport(F)` (empty, E2) and its E3 result; sha256 of each compared pair of strings (equal) |
| 10 | Inspect the dashboard | Screenshot of the Experiment Analytics view on `FX-PAIR`, never in fixture mode: provenance badge "Tiger Data · verified copy" with `artifactHash` prefix, `git`, `gitClean`; Encore "Recovered" with its "first qualifying 12-sample streak" band, static "Not recovered, or not measurable (no hold sample after the kill): censored"; `npwc` beside `alive`, `coverage`, `sfMean` and `sfMax`; the single-seed caption; synthetic-time label |
| 11 | Disconnection | (a) Stop the gateway or cut the network with the dashboard open: screenshot showing "unavailable", or earlier data badged "cached at hh:mm · not current" with `verified` false, never current `tiger`; `local-artifact` only after the operator opens files. (b) Kill the importer mid-transaction on a fresh schema: zero rows for that run, state still `validated` (or `incomplete` if a `COMMIT` acknowledgement was lost). (c) Offline: `npm run eval -- --report results/` reproduces E3; a scratch S2 seed 1 record made with and without the gateway running has equal `fileSha256` (T28(a), a smoke test). If TIG-08's Tiger mode is in scope, the T28(b) `stateHashes()`/`series()` comparison as well. (d) The judged build loads and runs with the gateway process absent |
| 12 | Reconcile and clean up | Re-run the importer (and `tiger reconcile`): the interrupted run becomes `verified`; final counts; drop the test schema (or delete the service) and show zero remaining objects; a scan of all captured evidence for hosts, passwords and connection strings, with zero hits |

T44 passes only when all twelve steps pass on one commit with the evidence attached to the issue or PR; missing evidence fails its step.

**Judge evidence (only if TIG-D12 approves a Tiger claim).** The overview's §15 judge-evidence file is built from steps 1, 3, 5, 6 and 8: a dated file outside `results/` with each named query's text and output, `extversion` and `version()`, row counts, the E1 digest summary and redacted service details. The same queries may be recorded in the Tiger console for the backup video (#131). No credential is shared with judges.

---

## 7. Coverage of William's §15

| William §15 | Required behaviour | Tests |
|---|---|---|
| Import same artifact twice | No duplicate logical run or rows | T12, T42 |
| Same experiment identity, different hash | Conflict surfaced | T12, T42 |
| Fail mid-import | Tiger transaction rolls back | T11, T42, §6 step 11 |
| MongoDB fails after Tiger commit | Import incomplete; retry reconciles | T15 (ledger analogue), T16 (catalogue, if TIG-D2 approves one) |
| `npwc = null` | Preserved as SQL NULL | T07, T17 |
| Zero alive | No fabricated quality values | T07 |
| Missing sample tick | Import completeness fails | T04 |
| Counter decreases | Invalid record rejected | T06 |
| Unsupported record version | Explicit rejection | T01 |
| Different seeds | Comparison rejected | T20 |
| Different events | Comparison rejected | T20 |
| Different code/params | Comparison rejected | T20, T25 |
| Valid paired runs | Same results as the existing CLI report | T18, T19 |
| Tiger offline | Local simulator and report unaffected | T29, T15 |
| Observer enabled/disabled | Same deterministic state hash | T28 (base T14; T28(b) for app network code) |
| Missing secrets | Safe error, no credential leakage | T31 |
| End-to-end test | Valid pairs, excluded pairs, medians, paired deltas, censored counts and worst seeds agree | T18, T19, T44 |

William §8's validation checklist maps to T01–T07; §13's infrastructure risks to T11–T15 and T31–T36; Appendix A's cautions to T25 (one epoch, `run_id` filters, DT), T23 (`AVG()` and NULLs) and T41 (retention, hypertable syntax, columnstore).

---

## 8. Planned versus executed evidence

**No test in this file has been executed.** No code, Tiger service, container or role exists for this work.

| Evidence | Tests | Status |
|---|---|---|
| Validation, identity, serialisation | T01–T10 | Planned |
| Importer control flow and ledger (mocked) | T11–T16 | Planned |
| Reconstruction and report equality | T17–T19 | Planned. The audit saw `buildReport` over the 50 records reproduce `RESULTS.md` lines 1–226 byte for byte: an audit observation behind E3's definition, not test evidence |
| Comparison, alignment, censoring, time | T20–T26 | Planned |
| Isolation and determinism | T27–T30 | Planned |
| Security | T31–T36 | Planned. T35's free-service limit is a provider fact, not observed |
| UI | T37–T40 | Planned. No dashboard exists; placement is TIG-D3 |
| Live provider and acceptance | T41–T44 | Planned. No test service exists |

When a test runs, its PR records commit, date, command, database kind and version, and result, naming pre-existing failures.

---

## 9. Gates

A gate opens only when every listed test passes on one commit. Gates are cumulative, except the TIG-D12 slice, which stands alone.

| Gate | Requires | Also requires |
|---|---|---|
| **TIG-D12 slice** (only if TIG-D12 approves it; a planning estimate, not a commitment) | T01–T10, T27, T29, the offline E1–E3 of §1.2; on a disposable service, T41's schema checks (hypertable, keys, CHECKs, no retention) and the counts and digest equality of T42, without ledger, reconcile or API | TIG-D12 and the TIG-D1 exception it names. TIG-D8's posture: a trial service created at least 30 minutes before the first `verify-full` connection, imports only from a trusted network. The judge-evidence file of §6. Claims limited to digest equality between the stored copy and the committed records; no dashboard or API claim |
| **Before importer use on shared data** (any Tiger service other than a disposable test schema) | T01–T16, T27–T29, T31–T33, T35, T41, T42 | **TIG-D1**, the one network decision: D3 (Phase 2) = GF-D1 (Gemini) = MDB-D1 (MongoDB) = TIG-D1 (XI-9; [boundaries §9](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#9-the-no-network-rule-and-decision-d3), provisional, #110), scoped to the optional gateway only. TIG-D4 (`run_id`), TIG-D5 (ledger location), TIG-D8 (TLS posture), TIG-D9 (hypertable settings) and TIG-D11 (dirty revisions) decided. `CI-GW` (§1 rule 2) merged and required for PRs touching `integrations/**`. Every artifact still held locally (rule 5) |
| **Before analytics in a demo** (judged demo, video or Devpost showing Tiger-backed charts) | The gate above, plus T17–T26, T30, T34, T36–T40, T43, T44; T28(b) if TIG-08's Tiger mode is shown | Nothing Tiger-backed is shown or claimed at DurHack unless TIG-D12 says so (overview §15). §6 evidence attached. TIG-D7 decided if the multi-seed panel is shown. Service tier and TLS posture (TIG-D8: `verify-full` for any shared demo) decided. Dashboard placement (TIG-D3) settled with the build-config owner if a separate page is used. The judged build loads and runs with the gateway process absent (§6 step 11(d)). The offline path (T29, `local-artifact` provenance) rehearsed and kept as the fallback, never presented as Tiger evidence. Spoken claims follow §10 |
| **Before any public deployment** | All of the above, re-run in the deployed configuration | Server-side authentication on every route, public-scale rate limits, Tiger reachable only from the server, T31–T36 re-specified for the public origin, a read replica if resource isolation is needed (VERIFIED: a read-only role gives none). Out of MVP scope |
| **Before live telemetry** (TIG-11, stretch) | All of the above that apply, plus new tests `TIG-T45+` written with TIG-11 against TIG-D13 | TIG-11 is covered by neither `X-OUT` nor `X-RUN/live`. It needs the proposed `X-OUT/live` boundary amendment, named explicitly by a D3 revision; the boundaries doc records it as an open question, not an accepted boundary ([OIB-Q5](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#13-open-questions), provisional, #110). TIG-D13 (live write authentication) decided. The write route is the one separately approved second entry point `integrations/gateway/src/tiger-live/server.ts` (XI-20), allowed only if OIB-Q5 is accepted. It is built on the shared skeleton (guard, errors, config), with its own `TIGER_LIVE_WRITE_URL` and an INSERT-only staging role; staging rows keyed (`streamId`, `arm`, `seq`); `offer()` once per rendered frame after all `stepBoth()` calls; bounded queue with drop counts visible; the stalled-network test (T28(b) with the exporter on: tick count and `stateHash` unchanged); every live chart `live-provisional` until the final `RunRecord` is imported and verified; a partial stream never shown as complete |

---

## 10. Wording, and inconsistencies noted while writing

**Wording.** The base [rules](evaluation-and-tests.md#8-bias-risks-and-reporting-wording) apply. Say "imported into and verified against Tiger Data" only with T42 or T44 evidence, and "a verified copy of the committed results", never "Tiger Data results" or "Tiger Data shows Encore recovers". Say "verified at import" for the run list, which recomputes nothing. Label `sample_time` "synthetic time from tick". Only the core and the `local-artifact` fallback are offline-capable. Nothing Tiger-backed is claimed at DurHack unless TIG-D12 says otherwise.

**Inconsistencies noted** (reported, not resolved here). Items marked **Resolved** were checked against the current companions on 2026-11-15; their numbers are kept so that references stay valid.

1. The base file's `tRec` row says "the first 3 s of hold samples"; the code needs 12 consecutive samples 5 ticks apart, which span 55 ticks (2.75 s) between first and last observation (William §7 is right). T39 follows the code.
2. William §6.2's `CHECK (pwc BETWEEN 0 AND 1)` and §8's "valid metric ranges" reject all 50 committed artifacts (§1.1); the ingestion RFC fixes the tolerance (TCR-12). His `coverage` check needs none.
3. DT is not a `Params` field, so `paramsHash` cannot vouch for it; "DT from the artifact's params" cannot be implemented as written. The ingestion RFC asserts `dt_seconds` at the record's `git` (TCR-15) and pins it with a CHECK, so the DT pair refusal fires only against the fake. The overview's TIG-R15 now says the same.
4. **Resolved.** The work-package file no longer describes a report subprocess or environment scrubbing (TR-2).
5. `report.ts` imports `canonicalJson` from `run.ts`, which loads `node:crypto`, the world and both brains; a browser dashboard cannot import it as it stands. T27's "shared canonical-JSON module" assumes the single extraction of XI-7 (TCR-16, TIG-D7); until then `src/telemetry/` is Node-only.
6. `experiment_key UNIQUE` (TCR-03) is narrowed by the ingestion RFC to a partial index over clean-git runs, because two different `-dirty` trees share an `experimentKey` (TCR-14, TIG-D11). T09 and T12 test the narrowed rule.
7. **Open:** the ingestion RFC still cites the overview's conflict records by name (*sample schedule*, *dirty git*, …), not by number. The work-package file now uses the numbers, as this file does.
8. **Resolved.** The analytics RFC now gives `REPORT_NOT_ENABLED` the code `PROVIDER_UNAVAILABLE`.
9. **Resolved.** The analytics RFC has no "trailing newlines trimmed" comparison; it cites §1.2's E3.
10. **Resolved.** The analytics RFC §7.3 now draws no band for `tRec = 0` and gives the two-cause label of overview §6.5.
11. **Open:** `CI-GW` (§1 rule 2) adds a workflow under `.github/workflows/`. The work-package ownership table now lists it under TIG-03, "if signed off", but the CI owner who approves it is still unnamed.
12. **Resolved.** The overview now traces TIG-NFR-01 to T28(b) as the evidence, with T28(a) a smoke test only.
13. **Resolved.** The ingestion RFC's DDL listings and grants are now unqualified (TR-5).
14. **Resolved.** The analytics RFC §6.7 now splits E2 into E2-cell and E2-sel and moves E3 to a function.
15. **Resolved.** The analytics RFC now uses the five `verification` values of rule 4.
16. **Resolved.** Archived runs in the multi-seed route are reported, not excluded, and listed in `selection.archived` (overview §6.6, TIG-FR-10 and TCR-19; analytics RFC §6.2). §1.2 and T19 follow this.
17. **Resolved.** The analytics RFC §6.2 now moves a `mismatch` run to `UNVERIFIED`; `RECONSTRUCTION_MISMATCH` is left only for a run that passed both checks and still does not rebuild.
18. **Resolved.** The ingestion RFC §13 now names the admin URL `TIGER_ADMIN_DATABASE_URL`, as the work-package file and T31 do.
19. **Resolved.** The overview §12 and analytics RFC §7.6 now say TIG-11 needs the proposed `X-OUT/live` amendment (OIB-Q5).
20. **Resolved.** The analytics RFC §3.1 no longer restates an `Origin` rule of its own.
21. **Resolved.** The analytics RFC now restores an archived run through the owner's Q16b.
22. **Resolved.** The analytics RFC §7.3 now calls the band the "first qualifying 12-sample streak" and says it is not a "sustained recovery interval".
23. **Open:** the work-package file (TIG-11 and its ownership table) still places the live writer at `integrations/gateway/tiger/live/**` (TR-3). XI-20 later set it as `integrations/gateway/src/tiger-live/server.ts`, allowed only if OIB-Q5 is accepted, which the overview and both RFCs now follow. The live gate (§9) follows XI-20.
