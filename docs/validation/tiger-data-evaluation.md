# Tiger Data evaluation

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file has been built, run or measured. There is no Tiger Data, MongoDB or Gemini code, no `src/telemetry/`, no `integrations/gateway/` and no backend on `main` at `23d6748`. Every test below is a **planned check**. §8 records the executed evidence, and there is none yet.

Purpose: the validation specification for importing Encore's committed `RunRecord` artifacts into Tiger Data and querying them for experiment analytics. It defines tests `TIG-T01`…`TIG-T44`, the database testing strategy, the experimental-method checks, the principal 12-step end-to-end acceptance with its evidence, and the gates. Status: proposed. Owner: Arnav (integration, issue #142). Source author: William Pimentel (`wpimento`), [Tiger Data technical plan](../handoffs/Encore_Tiger_Data_Technical_Plan.md) §15 "Test plan and acceptance criteria", with the cautions of §7, §8, §9, §12–§14 and Appendix A. Audit base: `origin/main` `23d6748`.

Sibling documents, written together with this one:

- **Canonical overview:** [`../integrations/tiger-data-analytics.md`](../integrations/tiger-data-analytics.md), owner of `TIG-FR-*`/`TIG-NFR-*`, `TIG-CC-*`, `TCR-*`, `TIG-D*` and `TIG-R*`. Where a rule below differs from it, the overview wins.
- **Ingestion RFC:** [`../design/TIGER_TELEMETRY_AND_INGESTION_RFC.md`](../design/TIGER_TELEMETRY_AND_INGESTION_RFC.md): validation, identity, manifest, ledger states, DDL, import and verification queries.
- **Analytics RFC:** [`../design/TIGER_ANALYTICS_AND_DASHBOARD_RFC.md`](../design/TIGER_ANALYTICS_AND_DASHBOARD_RFC.md): routes, provenance, analytics queries, dashboard.
- **Work packages:** [`../planning/tiger-data-integration-work-packages.md`](../planning/tiger-data-integration-work-packages.md), `TIG-01`…`TIG-11`.
- `TIG-T*` tests are defined only here; the other four cite them.

Linked, not restated: metric, summary and scenario definitions, the win rule, the procedure and the wording rules are in the base [evaluation and tests](evaluation-and-tests.md) (§2 metrics, §3 scenarios, §4 fairness, §5 procedure, §8 wording); base tests T01–T19 are its §6. The export envelope and persistence boundary are `X-OUT` and `X-PERSIST` in the [optional integration boundaries](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#4-x-out-telemetry-export) (provisional: depends on #110), whose boundary test is `P2-T35` in the [Phase 2 evaluation](PHASE2_EVALUATION.md) (provisional: depends on #110). Composition identities come from the [Gemini spec](../integrations/gemini-generated-formations.md) (`sceneHash`; provisional: depends on #117) and the [MongoDB show library](../integrations/mongodb-atlas-show-library.md) (`contentHash`; provisional: depends on #130).

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
2. **Core checks stay offline; gateway unit tests still run automatically.** Integration and live tests live in the gateway's own package (`integrations/gateway/`, module `tiger`) and never run under `npm run check` or `bash scripts/check.sh`, which stay offline and unchanged. Because root CI runs only `check.sh`, the gateway's offline unit tests run in a separate CI job, **`CI-GW`** (planned; needs the CI owner's sign-off, §10 item 11). It is a separate workflow triggered by `paths: integrations/**, src/analytics/**` and is a required check for PRs touching `integrations/**`. It runs `npm ci --ignore-scripts` in `integrations/gateway`, then T31, T33, T34, T36 and the fake-repository tests, then `npm audit --omit=dev --audit-level=high`. It also greps the built app `dist/` for `postgres://` and `TIGER_`, and the gateway build for `postgres://`. Without `CI-GW`, a change that interpolates SQL or logs a URL would merge green.
3. **Live tests are opt-in.** They run only when a test connection string is set, never against a shared or demo database; skipped means reported as not run.
4. **Imported is not verified.** A run is "verified" only after the post-commit row-digest re-read (TIG-T13). "Imported" means committed.
5. **Fixtures are evidence, not new results.** Their numbers are cited only from `RESULTS.md`; no Tiger query output is presented as a new experimental result.

### 1.1 Repository facts the tests rely on

Checked in this worktree at `23d6748`.

| Fact | Where | Consequence for the tests |
|---|---|---|
| `MetricsSample` and `RunRecord` match William §2; no run UUID, composition id, `inHold` or import status | [`src/contracts/metrics.ts`](../../src/contracts/metrics.ts) 6–23 | Identity lives in an external manifest; no contract change in the MVP |
| 50 committed records: S0, S1, S2, S3, S5 × seeds 1–5 × {static, encore}, `n0` 200, all `v: 1`, one `git` (`571c8e4…`, not `23d6748`), one `paramsHash` | `results/*.json`, [`PARAMS.md`](../../results/PARAMS.md) | The fixture set `FX-50` (§2) |
| Every record has 360 samples, ticks 5, 10, …, 1800; no tick-0 sample; counters never decrease | `results/*.json` | Expected schedule `{5k : 1 ≤ k ≤ 360}`, not `0…1800` |
| 0–4 events per record, 80 in total; S5's `INJECT_SCORE` carries the full score | `results/*.json` | Event counts and digests (T42) |
| 7,943 samples have `pwc` and `npwc` equal to `1.0000000000000004`; some summaries hold `npwcEnd` `1.0000000000000002`, `coordLoss` `−4.4e-16`, `npwcDeficitSec` `−2.6e-14`. No null `npwc`, `sfMean` or `sfMax` occurs | `results/*.json` | A strict `BETWEEN 0 AND 1` rejects every artifact (T05). Null handling needs synthetic fixtures (T07) |
| Summary: 23 keys always, plus `tRec` **only** with a `KILL` (absent otherwise, not null). `recovery()` (from `tick >= killTick`) needs 12 consecutive hold samples 5 ticks apart with finite `npwc ≥ 0.95` and returns `(start − killTick) × DT`; 0 if every post-kill hold sample qualifies; else null | [`src/observer/summary.ts`](../../src/observer/summary.ts) 41, 56–78, 135 | Three recovery states (T23, T39). `inHold` is not exported, so no summary is recomputed from samples |
| `canonicalJson` sorts keys, drops `undefined`, throws on a non-finite number. Files are written as `JSON.stringify(record) + '\n'`, not canonically | [`src/cli/run.ts`](../../src/cli/run.ts) 27–36; [`src/cli/main.ts`](../../src/cli/main.ts) 155 | `fileSha256` ≠ `artifactHash` for every committed file (T08) |
| `fairPair` compares only `git`, `paramsHash` and canonical `events` (scenario, `n0`, seed come from grouping); S5 has no verdict; `buildReport` is the only full-report entry point: Markdown, order-independent | [`src/cli/report.ts`](../../src/cli/report.ts) 22–24, 134–136, 253–263 | Report equality is string equality (§1.2); pairing is filtered by `pairKey` first (T22) |
| `runReport` reads every top-level `*.json` in the directory, filters `v === 1`, no other validation | `src/cli/main.ts` 99–109 | No manifest or ledger `*.json` may sit in `results/` (T14) |
| `DT = 0.05` is a module constant, not a field of `Params`, so `paramsHash` does not cover it | `src/contracts/params.ts` 3 | DT comparability is tied to `git` (T25) |
| The boundaries test and the ESLint `fetch`/`Date` bans cover only the five core folders | `tests/boundaries.test.ts` 8–16; `eslint.config.js` 9–13 | `src/telemetry/` needs its own entry (T27) |

### 1.2 Report equality, defined

William §15's "same results as existing CLI report" is made exact here, because `RESULTS.md` is not a pure generated file: its generated part (lines 1–226 at `23d6748`) is followed by a hand-written `---` / `## Notes` section.

Let `F` be the records read exactly as `runReport` reads them (top-level `*.json` of `results/`, sorted, parsed, filtered `v === 1`), and `D` the records reconstructed from Tiger rows for the same set of `artifactHash` values, in any order.

- **E1, record equality:** for every record, `canonicalJson(d) === canonicalJson(f)`, hence equal `artifactHash`. This is stronger than report equality, because `buildReport` ignores `series`, `stateHash` and `v`.
- **E2, report equality (the principal proof):** `buildReport(D) === buildReport(F)` as JavaScript strings. No whitespace normalisation, no numeric tolerance.
- **E3, anchoring to the committed file:** with `md = buildReport(F)` and `R` the committed blob (`git show <commit>:results/RESULTS.md`, so checkout line-ending conversion cannot interfere), `R.startsWith(md)` and `R.slice(md.length).startsWith('\n---\n')`. Whole-file equality is **not** a criterion and fails by design.

`GET /api/experiments/comparison` answers one cell `(scenario, n0, git, paramsHash)` (all four required), and `buildReport` over one cell prints `Records: 10` and one group. No route call therefore yields the five-scenario report, and E2 with `F` defined as the route's own filtered set could not detect a selection that diverges from the CLI. So the route is checked per cell, and E3 through a function:

- **E2-cell:** for each cell, `reportMarkdown === buildReport(F_cell)`, where `F_cell` is every local record of that cell from `F`, **unfiltered**. When no exclusion fires (as with `FX-50`), this also proves the route's selection is neutral.
- **E2-sel:** when exclusions fire (`FX-COMP`, `FX-DEV`, an archived run), `reportMarkdown === buildReport(F_cell \ X)` and the response's `excluded` equals `X`. `X` is the expected list written in the test, never read back from the route.
- **E3 through the gateway:** a gateway-internal function (no route, so T36's route table is unchanged) reconstructs every verified run of one `(git, paramsHash)`, here all 50, and calls `buildReport` once. E2 and E3 apply to its output `D`.

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
| DT "read from versioned parameters" | DT recorded as `dtSeconds`, tied to `git`, not `paramsHash` | TCR-15 |
| Primary key `(sample_time, run_id, tick)` | `(run_id, sample_time)` plus the tick-to-time `CHECK` (ingestion RFC §6.2) | TCR-24 |

---

## 2. Fixtures and test doubles

Committed files are read-only. Derived fixtures are generated by test code into a temporary directory, carry `fixture` provenance, and never enter a shared or demo database.

| Fixture | Content |
|---|---|
| `FX-50` | The 50 committed `results/*.json`, read from the git blob at the test's commit |
| `FX-PAIR` | `S2_n200_static_s1.json` and `S2_n200_encore_s1.json` (a `KILL` scenario; static censored, Encore recovered, per `RESULTS.md`) |
| `FX-S5` | `S5_n200_{static,encore}_s1.json` (largest event payload, no-verdict scenario) |
| `FX-BAD/*` | One derived file per rejection reason, tagged with the expected reason: `v: 2`; a sample value written as `1e999` (which `JSON.parse` turns into `Infinity`); tick 905 removed; tick 905 duplicated; `collisions` decreasing at one sample; `alive > n0`; `coverage` above 1; `pwc` above `1 + 1e-9`; unknown event type; `KILL` id outside `[0, n0)`; arm `central`; file above the size cap; more samples than the cap |
| `FX-NULL` | Derived from `S1_n200_static_s1.json` with the tail set to `alive 0` and `npwc`, `sfMean`, `sfMax` null (the committed set has no null quality value) |
| `FX-DIRTY`, `FX-UNKNOWN` | `git` suffixed `-dirty`; `git` set to `unknown` |
| `FX-CONFLICT` | `S2_n200_encore_s1.json` with one summary value changed: same `experimentKey`, different `artifactHash` |
| `FX-RESER` | `S0_n200_encore_s1.json` re-serialised with `canonicalJson`: different `fileSha256`, same `artifactHash` |
| `FX-MISMATCH` | `FX-PAIR` with one `KILL` id changed in the Encore record only (report shows `MISMATCH`) |
| `FX-UNPAIRED` | `FX-50` minus one static record |
| `FX-DEV` | `FX-PAIR` relabelled seed 101. Synthetic: it is **not** a development run and exists only to test exclusion |
| `FX-COMP` | `FX-PAIR` with manifests whose `compositionId` differs (`scenario:S2` versus a placeholder `sceneHash`) |
| `FX-GAP` | Database rows for `FX-PAIR` with tick 905 deleted from one run after import (alignment test only) |

**Mocked `TigerRepository`.** The gateway module talks to the database only through a repository boundary: the `TigerWriter` and `TigerReader` interfaces of TIG-04, called `TigerRepository` here for both. The fake is in memory and enforces the same uniqueness rules as the DDL (`artifact_hash`, `experiment_key` among clean-git runs, `(run_id, sample_time)`, `(run_id, event_index)`), applies a transaction as all-or-nothing, and can inject a fault after the k-th row, at `COMMIT`, after `COMMIT`, or on read-back. It never returns a value it was not given, so a tampering test edits its store directly.

---

## 3. Database testing strategy

| Layer | Database | Counts as "real Tiger Data"? |
|---|---|---|
| Unit | Mocked `TigerRepository` only | No |
| Integration | `timescale/timescaledb` container pinned to a tag matching the target service's TimescaleDB and PostgreSQL versions (record both with `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'` and `SELECT version()`) | No. It is TimescaleDB, not the managed provider |
| Live | A disposable **Tiger Cloud** service created for testing (free or trial), separate from any service used for a demo | **Yes**, and only this |

Provider facts that shape the live setup (checked 2026-11-15 against Tiger Data's official docs; sources in the ingestion RFC):

- VERIFIED: free services (shared compute, `us-east-1`, 750 MiB, read-only at the cap, no pooler) **supply no SSL certificate**, so only `sslmode=require` works there (T35). Trial data may be removed when a trial ends without a payment method (rule 5).
- VERIFIED: a hypertable's unique indexes must include the partition column; the default chunk interval is 7 days; `CREATE TABLE … WITH (tsdb.hypertable, …)` enables the columnstore unless `tsdb.columnstore=false`.
- UNVERIFIED: COPY and named prepared statements through the transaction-mode pooler; live tests use the direct connection.
- PARTLY: the service's TimescaleDB version (2.31 announced 26 Oct 2026; 2.32.0 on GitHub 12 Nov 2026). T41 records `extversion`.

**Isolation and clean-up per run.**

1. Each run generates a `testRunId` (12 random lowercase hex characters) and creates schema `tig_test_<testRunId>` in place of the RFC's `encore` schema, applies the migrations inside it, and grants the test importer and reader roles on that schema only. The schema name is the one identifier not fixed in code, so it is handled by a single helper, the only exception T33's scan allows. The helper rejects any name not matching `^(encore|tig_test_[0-9a-f]{12})$` before use. It quotes the name with `%I` (`format()` or pg-format) for `CREATE`/`DROP SCHEMA`. Migrations use unqualified names under `set_config('search_path', $1, true)` (the parameterised `SET LOCAL`), so the name is never interpolated into migration SQL.
2. `afterAll` drops the schema with `CASCADE`, **also after a failure**, then queries `information_schema.schemata` and `timescaledb_information.hypertables` to record that zero objects of this run remain.
3. A sweep drops `tig_test_*` schemas from earlier crashed runs that are older than 24 hours, judged by their migrations table's `applied_at`. It selects names only from `information_schema.schemata WHERE schema_name ~ '^tig_test_[0-9a-f]{12}$'`, and it refuses to run unless `current_database()` and the connection's service id match the allow-listed test service.
4. Containers run with `--rm` and a throw-away volume.
5. Connection strings live only in the runner's environment (for example `TIGER_TEST_WRITE_URL`, `TIGER_TEST_READ_URL`); neither CI nor `scripts/check.sh` sets them.
6. Volume, size and latency are observations, never pass criteria. William §11's 18,000 sample rows is an exact expectation for the committed data, not a budget.

---

## 4. Tests TIG-T01–TIG-T44

All MUST. "WP" is the [work package](../planning/tiger-data-integration-work-packages.md) that makes the test pass: TIG-02 validation and identity (`src/telemetry/`, including the pure ledger logic); TIG-03 migrations and connection (roles, TLS, secrets); TIG-04 importer; TIG-05 verification and retry; TIG-06 analytics API; TIG-07 paired comparison; TIG-08 UI; TIG-09 optional MongoDB catalogue; TIG-10 end-to-end validation; TIG-11 live ingestion. Caps, states and queries `Q*` are the RFCs'; the tests cite them.

### 4.1 Import correctness (T01–T12)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T01 | Unsupported record version | unit | `FX-BAD/v2` | Rejected before any row is built with `SCHEMA_VERSION_UNSUPPORTED`; state `rejected`; no repository call | TIG-02 |
| T02 | Structure, events and size caps | unit | `FX-BAD/*` (arm, event type, `KILL` id, size, sample cap) | Each rejected with its tagged reason and JSON path; the RFC's caps (file 1 MiB checked before parsing, about 9× the largest fixture; events, event size, `versions` keys) accept every `FX-50` file and reject cap + 1 | TIG-02 |
| T03 | Finite numbers before serialisation | unit | `FX-BAD/1e999`; an in-memory record with `NaN` | Both rejected by an explicit check, never turned into `null` (William §8's `JSON.stringify` warning); `canonicalJson` throwing is not relied on as the validator | TIG-02 |
| T04 | Sample schedule and completeness | unit | `FX-50`; `FX-BAD/missing-905`, `/duplicate-905` | `FX-50`: 360 samples, first 5, last 1800, step 5, `expected_samples = 360`. Missing or duplicate tick rejected (William: "Missing sample tick") | TIG-02 |
| T05 | Ranges with tolerance, stored unclamped | unit | `FX-50`; `FX-BAD/coverage`, `/pwc` | All 50 accepted, including `pwc = 1.0000000000000004` and negative-epsilon summary values; `coverage` above 1, `pwc` above `1 + 1e-9` or `alive` outside `[0, n0]` rejected; no range check on `npwc` or summary values; rows equal the source bit for bit (`Object.is`) | TIG-02 |
| T06 | Cumulative counters | unit | `FX-50`; `FX-BAD/counter-decrease` | `msgs.*`, `collisions`, `nearMisses`, `slotChanges` non-negative integers, non-decreasing; the decreasing one rejected (William: "Counter decreases") | TIG-02 |
| T07 | Nulls and zero alive | unit | `FX-NULL` | `npwc`, `sfMean`, `sfMax` serialise to `null` (SQL NULL), never 0; `alive = 0` with a non-null quality value rejected; no quality value is fabricated (William: "`npwc = null`", "Zero alive") | TIG-02 |
| T08 | Identity hashes | unit | `FX-50`, `FX-RESER`, key-permuted copy | `artifactHash` ≠ `fileSha256` for all 50; permuting keys keeps `artifactHash`, changes `fileSha256`; the ingestion RFC's §4.4 vectors for `FX-PAIR` reproduced in full; `pairKey` equal within each committed pair, distinct across pairs | TIG-02 |
| T09 | Weak provenance | unit | `FX-DIRTY`, `FX-UNKNOWN`, a manifest without `compositionId` | `gitClean = false`, flagged "weaker reproducibility evidence", conflict-exempt (two different `-dirty` records on one HEAD are no conflict), excluded from default comparisons; no composition identity ⇒ storable, `pair_key` NULL, never compared | TIG-02 |
| T10 | Pure row normalisation and its inverse | unit | `FX-50` (deep-frozen) | William's §8 field mapping; `sample_time` = `2020-01-01T00:00:00Z` + `tick × 50 ms`; `event_index` = array position, `details` the full event; `summary_json` deep-equals `summary` (absent stays absent, null stays null; TCR-25); rows → record restores `artifactHash`; the frozen input is not mutated | TIG-02 |
| T11 | Transactional import and rollback | unit | Mock with a fault after sample row 200, a failing in-transaction check, and a lost `COMMIT` acknowledgement | Fault or failed check: zero rows for the run, state stays `validated`, retry allowed; lost acknowledgement: `incomplete` (`COMMIT_UNKNOWN`), resolved by reconciliation; artifact bytes unchanged; the importer never reports "persisted" (William: "Fail mid-import") | TIG-04 |
| T12 | Idempotency and conflict | unit | `FX-PAIR` twice; then `FX-CONFLICT`; then `FX-RESER` | Second import: verified no-op, row counts unchanged; `FX-CONFLICT`: `conflict`, no row changed, conflict recorded, never resolved by `ON CONFLICT DO NOTHING` alone; `FX-RESER`: idempotent, re-serialisation noted. With a deterministic `run_id` scheme (TIG-D4), the recomputed `run_id` equals the stored one | TIG-04 |

### 4.2 Cross-database behaviour and the ledger (T13–T16)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T13 | Post-commit digest verification | unit | Mock; after commit, change one stored `npwc` by 1 ulp, one event `details`, one summary key | Fresh-connection re-read digests differ from the manifest's in each case; state `incomplete` (`VERIFY_MISMATCH`), run excluded from comparisons; a count-only check passes on the same data, showing why counts are not enough (William §8) | TIG-05 |
| T14 | Ledger state machine and location | unit | Scripted attempt sequences, including a lost ledger | Only the ingestion RFC's transitions occur; the ledger is append-only (earlier lines byte-identical); a lost ledger is rebuilt from Tiger, entries marked "reconstructed"; manifests and ledger sit outside `results/` (TIG-D5), and `npm run eval -- --report results/` still reads exactly 50 records | TIG-02, TIG-05 |
| T15 | Failure after Tiger commit, and Tiger unavailable | unit, integration | Mock and container: process killed between `COMMIT` and the ledger append; database refused at connect | Next run takes the identical-artifact path, re-verifies, writes `verified`, inserts nothing; database down: artifacts untouched, state stays `validated`, a later retry succeeds; no output claims cloud persistence on failure (William §14) | TIG-05 |
| T16 | MongoDB independence | unit | Source scan of the `tiger` module; gateway started with the MongoDB module disabled and with it failing | No MongoDB call in the Tiger import path; import succeeds either way; nothing written to `saved_shows`. If TIG-D2 approves a catalogue (TIG-09): written only after `verified`; a MongoDB failure reports "catalog incomplete", Tiger and ledger untouched, and an idempotent retry reconciles it (William: "MongoDB fails after Tiger commit") | TIG-05, TIG-09 |

### 4.3 Experimental correctness (T17–T26)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T17 | Record reconstruction round trip | integration | `FX-50` imported into the container | §1.2 E1 for all 50: `BIGINT` read as numbers (node-postgres returns strings by default), `float8` exact, JSONB numbers exact, `tRec` absent versus null preserved, same-tick event order preserved | TIG-07 |
| T18 | **Multi-seed paired statistics match the existing CLI report** | integration | `FX-50` imported; rows returned in SQL order and in a fixed shuffled order; then `FX-COMP` and `FX-DEV` added | §1.2 exactly: E2-cell for each of the five cells through `GET /api/experiments/comparison` (`excluded` empty); E2 and E3 on the all-runs function's output; E2-sel after the additions | TIG-07 |
| T19 | Report equality under perturbation | integration | `FX-UNPAIRED`, `FX-MISMATCH`, `FX-S5` subsets, reconstructed and passed to `buildReport` unfiltered | E2 for each: valid pairs, excluded pairs (`MISMATCH`, `UNPAIRED`), medians, paired deltas, censored counts, worst seed and the S5 no-verdict line all agree (William §15, last paragraph) | TIG-07 |
| T20 | Unfair comparisons rejected | unit | Run pairs differing in seed, events, `git`, `paramsHash`, `n0`, scenario, `compositionId` (`FX-COMP`), or with the same arm | `GET /api/comparisons` returns `422 UNFAIR_PAIR` with one analytics-RFC reason code per difference (TCR-19) (`SEED`, `EVENTS`, `GIT`, `PARAMS`, `N0`, `SCENARIO`, `COMPOSITION`, `DT`, …) **before** any series query; same arm gives `400`; with the viewing override every delta is null (William: "Different seeds / events / code/params") | TIG-07 |
| T21 | Alignment without silent loss | integration | `FX-GAP` | Full outer alignment by tick (TCR-31): tick 905 present with the missing side null and listed in an explicit missing-tick report; `npwc` null stays null, never 0; Δ null where either side is null (William §9.2) | TIG-06 |
| T22 | Comparison service reuses `report.ts` | unit | Mock holding `FX-50` and `FX-COMP` | Records filtered by equal `pairKey` before `buildReport`, excluded seeds listed with reasons; response carries `buildReport` Markdown verbatim plus `npwcRows`/`stats` output; a source scan finds no median, quantile, win-margin or censoring logic in the gateway or analytics SQL; S5: no verdict, no W/T/L, pass line labelled "not derivable from stored telemetry" (TCR-35) | TIG-07 |
| T23 | Censoring honesty | unit | `FX-50` S1/S2 groups | Three states mapped: finite `tRec` = Recovered, null with a `KILL` = Not recovered (censored), key absent = Not applicable; any `tRec` aggregate uses `stats(…, true)` and is shown with `n` and the censored count; a censored quantile reaches JSON as `'censored'`, never `null`; a scan finds no `AVG(t_rec_seconds)` in the named analytics queries (Appendix A: `AVG()` drops NULLs) | TIG-07 |
| T24 | Cumulative counters as deltas | integration | `FX-50` | `LAG` partitioned by `run_id`, ordered by `tick`; per-run Σ deltas = last total − first total; no delta crosses runs; the first row's delta equals its total and is marked "since run start"; an interval wider than 5 ticks is flagged as spanning a gap; totals and deltas carry different labels | TIG-06 |
| T25 | Time semantics | integration | `FX-50` | `sim_seconds = tick × DT` with DT from the manifest's `dtSeconds` (tied to `git`, never to `paramsHash`); runs whose DT differs are refused as a pair; every named query filters by `run_id`; `imported_at` is wall-clock and labelled; no query or label calls `sample_time` real time | TIG-06 |
| T26 | Frozen revision | unit | `FX-50` plus one record with another `git` | The multi-seed endpoint defaults to one `(git, paramsHash)` (TIG-D10) and refuses mixing unless asked; if asked, `buildReport`'s `WARNING` line is present; `gitClean = false` records are excluded by default; a superseded revision is labelled, never merged (base [§5](evaluation-and-tests.md#5-procedure) step 5) | TIG-07 |

### 4.4 Isolation and determinism (T27–T30)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T27 | Purity of `src/telemetry/` | unit | `tests/boundaries.test.ts` extended with a `telemetry` entry; ESLint block | `src/telemetry/` imports only contracts, itself and the shared canonical-JSON module; no `fetch`, `WebSocket`, `XMLHttpRequest` or `node:net`/`pg`; no core folder imports `src/telemetry/`; nothing under `src/` imports `integrations/` | TIG-02 |
| T28 | Determinism and non-mutation | unit, app | (a) Base T04 and T14 (`tests/observer/read-only.test.ts`); one scratch record made twice at one commit, with and without the gateway running. (b) For every package that adds browser network code (TIG-08's Tiger mode, TIG-11): a scripted app run with no operator input, driven through `window.encore`, made with the X-RUN/live client or exporter on and its transport stalled, failing and slow, then with it off | (a) Base tests green; the scratch files are byte-identical; importing leaves every `FX-50` file byte-identical. (a) is a smoke test only: the CLI never connects to the gateway, so it cannot fail and is no evidence for TIG-NFR-01. (b) `stateHashes()` and `series()` are equal across every variant at fixed ticks, read while paused (William: "Observer enabled/disabled") | TIG-04 (a); TIG-08, TIG-11 (b) |
| T29 | Offline core unaffected | unit | Networking off, gateway absent, `integrations/` removed | `bash scripts/check.sh` passes; `npm run eval -- --report results/` reproduces E3; NFR-04's acceptance check unchanged; `P2-T35` green (provisional: depends on #110) (William: "Tiger offline") | TIG-02, TIG-10 |
| T30 | No path from the database to a drone | unit | Source scan of the analytics client and view | Analytics code imports no controller, intent or `INJECT_SCORE` builder; responses are only rendered; nothing runs in the tick loop (William §4.3) | TIG-08 |

### 4.5 Security (T31–T36)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T31 | Secrets and missing secrets | unit (`CI-GW`) | Gateway started without, then with, Tiger settings; captured logs; built `dist/` | Without settings the module reports `disabled`, other modules still run; no log, error body or bundle contains a host, password or `postgres://`; no `VITE_*` Tiger setting (William: "Missing secrets") | TIG-03, TIG-06 |
| T32 | Least-privilege roles | integration, live | `encore_reader` and `encore_importer` per the ingestion RFC | Reader: `INSERT`, `UPDATE`, `DELETE`, DDL all refused; `default_transaction_read_only` on. Importer: `INSERT`/`SELECT` on the four tables and `import_conflicts` only; no DDL, `UPDATE` or `DELETE` | TIG-03 |
| T33 | Parameterised SQL only | unit (`CI-GW`) | Source scan; hostile query strings (`S1'; DROP TABLE experiment_runs;--`, `$1`, Unicode); hostile schema names | No SQL built by string interpolation of input; identifiers never from input, except the schema name through §3's validating helper, which rejects every hostile name; hostile values return `400 INVALID_QUERY` or an empty result, tables intact | TIG-04, TIG-06 |
| T34 | Untrusted input and bounds | unit (`CI-GW`) | Over-long query values, page size above the cap, unknown parameters, burst of requests | Rejected with the shared error envelope (code, message, optional details), no raw driver error; pagination and series bounds enforced; rate limit returns `429 RATE_LIMITED` | TIG-06 |
| T35 | TLS | live | Test service | The client refuses `sslmode=disable`; uses `verify-full` where the service supplies certificates and records `require` on a free service as a documented weaker mode | TIG-03 |
| T36 | Exposure | unit (`CI-GW`) | Route table; bind address | Only `GET` routes under `/api/runs`, `/api/comparisons`, `/api/experiments/comparison`, `/api/health`; no write route; bound to `127.0.0.1` with an `Origin` check. A live-ingestion write route (TIG-11) needs authentication tests before it merges | TIG-06 |

### 4.6 User interface: provenance and censoring (T37–T40)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T37 | Provenance on every chart | UI | View model fed `tiger`, `local-artifact`, `live-provisional` and `fixture` responses | Every chart and table has a badge with `source`, `verified`, `importedAt`, `artifactHash` prefix, `git`, `gitClean`; a local fallback is never `tiger`; fixtures and illustrative values labelled (William §10) | TIG-08 |
| T38 | Unfair pairing blocked | UI | `FX-MISMATCH`, `FX-COMP` | Default: comparison not drawn, reasons listed; override: runs side by side, no deltas, persistent warning naming each difference | TIG-08 |
| T39 | Recovery display | UI | `FX-PAIR`, an S0 record | Recovered / Not recovered (censored) / Not applicable shown distinctly; the sustained-recovery band is `[s, s + 60)` ticks with `s = killTick + tRec/DT`, covering the 12 samples `s`…`s + 55`, drawn only for a finite `tRec`; `tRec = 0` is labelled without asserting which of its two causes applied (§10, item 10); threshold line at 0.95; `npwc` always beside `alive` and `coverage`; nulls shown as missing (`—`), never 0 | TIG-08 |
| T40 | Labels and degraded states | UI | Gateway stopped mid-session | Totals versus deltas and synthetic time versus `imported_at` labelled; S5 shows no verdict; with the gateway down the view shows "unavailable" or `local-artifact`, never stale data badged `tiger` | TIG-08 |

### 4.7 Live Tiger integration and acceptance (T41–T44)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| T41 | Schema on the provider | live | Fresh schema on the test service | Migrations apply; hypertable created with an explicit partition column; primary key includes `sample_time`; the tick-to-time `CHECK` (immutable form, ingestion RFC) rejects a mismatched row; range `CHECK`s accept all 50 fixtures; no retention job on `simulation_metrics` (`timescaledb_information.jobs`) and columnstore as TIG-D9 sets it; `extversion`, PostgreSQL version and chunk count recorded as observations | TIG-03 |
| T42 | Import of the committed matrix | live | `FX-50` with the importer CLI and importer role | 50 runs, 18,000 sample rows, 80 event rows, 50 summary rows; per run 360 samples, first tick 5, last 1800; all 50 `verified`; re-import changes nothing; `FX-CONFLICT` becomes `conflict`; a connection killed mid-import leaves zero rows for that run | TIG-04, TIG-05 |
| T43 | Analytics against the provider | live | T42's data, reader role | T17–T19, T21 and T24 repeated against Tiger Cloud; API responses carry `source: 'tiger'`, `verified: true`; reader writes refused (T32) | TIG-06, TIG-07 |
| T44 | Principal end-to-end acceptance | e2e | §6 | All twelve steps pass on one commit with their evidence attached | TIG-10 |

---

## 5. Experimental-method checks

These apply to every comparison the API or dashboard shows. They implement base [§1](evaluation-and-tests.md#1-principles), [§5](evaluation-and-tests.md#5-procedure) and [§8](evaluation-and-tests.md#8-bias-risks-and-reporting-wording) and William §12, and add no new rule.

| Check | Rule | How it is tested |
|---|---|---|
| Pre-registered seeds | Reported seeds are the pre-registered evaluation seeds (1–5 here; 1–20 only if the full matrix runs); scenarios and the win rule come from the base file, never the dashboard | T26: the multi-seed endpoint takes scenario, `n0`, `git`, `paramsHash` and **no** seed list |
| Development seeds 101–105 never reported | Stored only in test schemas; the comparison endpoint excludes them as "development seed, not evidence"; no export or screenshot shows one as a result | `FX-DEV` in T22, T26 |
| Every outcome shown | Losses (`LOSS` rows), ties, censored recoveries, mismatched and unpaired seeds stay visible with counts; nothing is filtered by outcome | T19, T23, T39 |
| No cherry-picking | Single-run views carry "single seed: not a result"; a seed subset is never presented as the multi-seed comparison | T37, T26 |
| `n` and worst seed | Every multi-seed view shows fair-pair `n`, censored count and worst seed exactly as `buildReport` prints them | T18, T19 |
| Weak evidence excluded | `gitClean = false`, missing composition identity, mixed revisions: stored, labelled, excluded from default comparisons | T09, T26 |
| No new result claimed | Analytics numbers are cited only by reference to `RESULTS.md`; Tiger output is a verified copy | Wording rule, §10 |

---

## 6. Principal end-to-end acceptance (TIG-T44)

William §15's "most important end-to-end test", extended to the whole workflow, against a **disposable Tiger Cloud service**; a container run is a rehearsal and is reported as such. Instead of "generate records with the existing CLI" it uses the **committed** records (TCR-06): the CLI's overwrite guard refuses a re-run into `results/` at `23d6748`, because the records carry `git` `571c8e4…`. Step 11 makes a scratch record to test determinism.

| Step | Action | Evidence to capture |
|---|---|---|
| 1 | Record the environment | Commit and clean tree; `SELECT version()` and the `extversion` query output; `sslmode`; Node, `pg` and gateway versions; host redacted |
| 2 | Check the fixtures offline | `fileSha256` and `artifactHash` lists for the 50 files; validator verdict "50 accepted"; E3 result (`startsWith` true, remainder begins `\n---\n`) |
| 3 | Apply migrations to a fresh schema | Migration log; `\d+` of the four tables; `timescaledb_information.hypertables` row; the query showing no retention job; columnstore setting |
| 4 | Import the 50 records with the importer CLI (importer role) | Ledger lines for all 50 ending `verified`; manifests location (outside `results/`); importer exit status |
| 5 | Verify counts | Query text and result for runs (50), samples (18,000), events (80), summaries (50); per-run sample count, first and last tick (360, 5, 1800) for every run |
| 6 | Verify content | For every run: artifact-derived row digest and re-read digest (equal); reconstructed `artifactHash` equal to the manifest (E1) |
| 7 | Re-import and conflict | Second importer run: 50 no-ops, counts unchanged (query before and after); `FX-CONFLICT`: state `conflict`, counts unchanged, conflict entry shown |
| 8 | Query one run and one pair through the API | `GET /api/runs` (filtered), `GET /api/runs/:runId/metrics` (row count 360, first and last rows), `GET /api/comparisons` for `FX-PAIR` (alignment report "0 missing ticks"); one unfair pair answered `422 UNFAIR_PAIR` with its reasons; provenance block of each; the SQL text each route executed, from the query log with parameter values shown separately |
| 9 | Reconstruct the multi-seed report | For each of the five cells, `GET /api/experiments/comparison` output (`excluded` empty) and its `diff` against `buildReport(F_cell)` (empty, E2-cell). The all-runs function's output over the 50 records, its `diff` against `buildReport(F)` (empty, E2) and its E3 result. sha256 of each compared pair of strings (equal) |
| 10 | Inspect the dashboard | Screenshot of the Experiment Analytics view on `FX-PAIR`: provenance badge `tiger · verified` with `artifactHash` prefix, `git`, `gitClean`; Encore "Recovered" with its band, static "Not recovered (censored)"; `npwc` beside `alive` and `coverage`; synthetic-time label |
| 11 | Disconnection | (a) Stop the gateway or cut the network with the dashboard open: screenshot showing "unavailable" or `local-artifact`, never `tiger`. (b) Kill the importer mid-transaction on a fresh schema: zero rows for that run, state still `validated` (or `incomplete` if a `COMMIT` acknowledgement was lost). (c) Offline: `npm run eval -- --report results/` reproduces E3; a scratch S2 seed 1 record made with and without the gateway running has equal `fileSha256` (T28(a), a smoke test). If TIG-08's Tiger mode is in scope, the T28(b) `stateHashes()`/`series()` comparison as well |
| 12 | Reconcile and clean up | Re-run the importer (and `tiger reconcile`): the interrupted run becomes `verified`; final counts; drop the test schema (or delete the service) and show zero remaining objects; a scan of all captured evidence for hosts, passwords and connection strings, with zero hits |

T44 passes only when all twelve steps pass on one commit with the evidence attached to the issue or PR; missing evidence fails its step.

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
| Observer enabled/disabled | Same deterministic state hash | T28 (base T14) |
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

A gate opens only when every listed test passes on one commit. Gates are cumulative.

| Gate | Requires | Also requires |
|---|---|---|
| **Before importer use on shared data** (any Tiger service other than a disposable test schema) | T01–T16, T27–T29, T31–T33, T35, T41, T42 | **TIG-D1**, the one network decision shared with Phase 2 D3, Gemini GF-D1 and MongoDB MDB-D1 ([boundaries §9](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#9-the-no-network-rule-and-decision-d3), provisional: depends on #110); approving it for another integration does not approve it here. TIG-D4 (`run_id`), TIG-D5 (ledger location), TIG-D9 (hypertable settings) and TIG-D11 (dirty revisions) decided. `CI-GW` (§1 rule 2) merged and required for PRs touching `integrations/**`. Every artifact still held locally (rule 5) |
| **Before analytics in a demo** (judged demo, video or Devpost showing Tiger-backed charts) | The gate above, plus T17–T26, T30, T34, T36–T40, T43, T44; T28(b) if TIG-08's Tiger mode is shown | §6 evidence attached. Service tier and TLS posture (TIG-D8: `verify-full` for any shared demo) decided. Dashboard placement (TIG-D3) settled with the build-config owner if a separate page is used. The offline path (T29, `local-artifact` provenance) rehearsed and kept as the fallback. Spoken claims follow §10 |
| **Before any public deployment** | All of the above, re-run in the deployed configuration | Server-side authentication on every route, public-scale rate limits, Tiger reachable only from the server, T31–T36 re-specified for the public origin, a read replica if resource isolation is needed (VERIFIED: a read-only role gives none). Out of MVP scope |
| **Before live telemetry** (TIG-11, stretch) | All of the above that apply, plus new tests `TIG-T45+` written with TIG-11 | Phase 2 `X-OUT`/`X-PERSIST` (provisional: depends on #110) built and green on `P2-T35`; bounded queue with drop counts visible; no network call in the tick loop (T28(b) with the exporter on); every live chart `live-provisional` until the final `RunRecord` is imported and verified; a partial stream never shown as complete; authenticated write route (T36) |

---

## 10. Wording, and inconsistencies noted while writing

**Wording.** The base [rules](evaluation-and-tests.md#8-bias-risks-and-reporting-wording) apply. Say "imported into and verified against Tiger Data" only with T42 or T44 evidence, and "a verified copy of the committed results", never "Tiger Data results" or "Tiger Data shows Encore recovers". Label `sample_time` "synthetic time from tick". Only the core and the `local-artifact` fallback are offline-capable.

**Inconsistencies noted** (reported, not resolved here):

1. The base file's `tRec` row says "the first 3 s of hold samples"; the code needs 12 consecutive samples 5 ticks apart, which span 55 ticks (2.75 s) between first and last observation (William §7 is right). T39 follows the code.
2. William §6.2's `CHECK (pwc BETWEEN 0 AND 1)` and §8's "valid metric ranges" reject all 50 committed artifacts (§1.1); the ingestion RFC fixes the tolerance (TCR-12). His `coverage` check needs none.
3. DT is not a `Params` field, so `paramsHash` cannot vouch for it; "DT from the artifact's params" cannot be implemented as written. The ingestion RFC records `dtSeconds` in the manifest (TCR-15); T25 follows it.
4. `report.ts` exports no structured analysis; a JSON multi-seed response cannot carry medians or censored counts without reimplementing private functions or a `src/cli` refactor (owner sign-off; TCR-17). T22 accepts the Markdown-verbatim MVP.
5. `report.ts` imports `canonicalJson` from `run.ts`, which loads `node:crypto`, the world and both brains; a browser dashboard cannot import it as it stands. T27's "shared canonical-JSON module" assumes the single extraction of XI-7 (TCR-16, TIG-D7); until then `src/telemetry/` is Node-only.
6. `experiment_key UNIQUE` (TCR-03) is narrowed by the ingestion RFC to a partial index over clean-git runs, because two different `-dirty` trees share an `experimentKey` (TCR-14, TIG-D11). T09 and T12 test the narrowed rule.
7. The overview numbers the audit's conflicts `TCR-10`…`TCR-35`; the work-package file still cites them by name (*range tolerance*, *dirty git*, …). This file uses the overview's numbers.
8. The analytics RFC's error body adds `retryable` and module codes (`INVALID_QUERY`, `UNFAIR_PAIR`), where XI-3's shared envelope has no `retryable` and puts module reasons under `VALIDATION_FAILED` details. T20, T33 and T34 follow the analytics RFC; the overview should settle one envelope.
9. The analytics RFC compares against `RESULTS.md` with trailing newlines trimmed; E3 is exact and implies it.
10. `tRec = 0` has two causes in `summary.ts`: every post-kill hold sample qualifies (line 60), or a 12-sample streak starts at the kill tick (line 75), after which `npwc` may dip again. The summary cannot tell them apart. The overview (§6.5) labels 0 "never below threshold in hold after the kill", which is false in the second case; the analytics RFC draws a band from the kill marked "indicative". T39 requires a label that asserts neither.
11. **Open:** `CI-GW` (§1 rule 2) adds a workflow under `.github/workflows/`, which the work-package ownership table marks as touched by no package and which has no named owner. Who approves it, and whether it joins TIG-03's allowed files, is undecided.
12. The overview traces TIG-NFR-01 to TIG-01 and TIG-10 with T28 as evidence. T28(a) cannot fail for the CLI, so the real evidence is T28(b), which belongs to TIG-08's Tiger mode and TIG-11.
13. The ingestion RFC's DDL qualifies every name with `encore.`. §3's per-run test schemas need unqualified names resolved through `search_path`.
14. The analytics RFC (§6.7) and TIG-06/TIG-07 state E2 for the route as a whole. §1.2 splits it into E2-cell and E2-sel and moves E3 to a function, because the route answers only one cell.
