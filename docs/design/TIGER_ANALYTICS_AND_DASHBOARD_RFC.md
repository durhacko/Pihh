# Tiger Data analytics and dashboard RFC

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file exists in code: no gateway, Tiger Data service, analytics route or dashboard is on `main`. No query here has been run against a database, and no test listed here has been executed.
>
> Source design by **William Pimentel** (`wpimento`): [`../handoffs/Encore_Tiger_Data_Technical_Plan.md`](../handoffs/Encore_Tiger_Data_Technical_Plan.md) (§3, §7, §9, §10, §12, §14, App. A), preserved unmodified. Integrated by **Arnav** (contract and integration owner), issue #142.

Purpose: how stored Encore experiments are queried, compared and shown: query semantics, the read-only analytics API, fair pairing, paired trajectories, multi-seed statistics, and the Experiment Analytics dashboard. Status: proposed; any network use needs decision TIG-D1 (= Phase 2 D3, approved per integration; = GF-D1 = MDB-D1, XI-9, XI-21), one decision scoped to the optional gateway only ([boundaries §9](OPTIONAL_INTEGRATION_BOUNDARIES.md#9-the-no-network-rule-and-decision-d3), provisional, #110). The core and the default build stay offline (NFR-04). Nothing here is shown or claimed at DurHack unless TIG-D12 says otherwise (overview §15). Owner: Arnav (integration); William (source design). Audit base: `origin/main` 23d6748.

Companion documents. The canonical overview is [`../integrations/tiger-data-analytics.md`](../integrations/tiger-data-analytics.md); it owns `TIG-FR`, `TIG-NFR`, `TIG-CC`, `TCR`, `TIG-D` and `TIG-R`. Schema, import, the import state machine and verification are in the [ingestion RFC](TIGER_TELEMETRY_AND_INGESTION_RFC.md). Work packages `TIG-01…TIG-11` are in the [work packages](../planning/tiger-data-integration-work-packages.md), and tests `TIG-T01…T44` in the [evaluation](../validation/tiger-data-evaluation.md). This file defines only the analytics queries **Q17–Q26**; Q1–Q16 belong to the ingestion RFC. Links into Phase 2, Gemini and MongoDB documents are *provisional: depends on #110 / #117 / #130* respectively.

---

## 1. Scope and starting point

### 1.1 Scope

**In this RFC:**
- read semantics;
- queries Q17–Q26;
- the four read-only routes;
- pairing, alignment and statistics;
- the dashboard.

**Elsewhere:**
- DDL, the importer and Q1–Q16 are in the ingestion RFC.
- Metric and summary definitions are in [evaluation §2](../validation/evaluation-and-tests.md#2-metrics), linked rather than restated.
- The gateway skeleton, guard, error envelope and `requestId` rule are in [boundaries §6.2](OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard) (provisional, #110), cited and never redefined.
- MongoDB holds no telemetry and no experiment catalogue in `saved_shows` (XI-6, TD-11). Nothing here reads MongoDB; a MongoDB `contentHash` appears only as a composition identity (§4.2).

### 1.2 Code facts this RFC depends on (23d6748, read 2026-11-15)

The overview lists the full set of verified facts. This RFC relies on these:

- **Contracts.** The counters in `MetricsSample` ([`metrics.ts:6-23`](../../src/contracts/metrics.ts)) are cumulative. `npwc`, `sfMean` and `sfMax` are `null` when `alive` is 0. `DT` is a constant ([`params.ts:3`](../../src/contracts/params.ts)), not a field of `Params`.
- **Recovery** ([`summary.ts:56-78`](../../src/observer/summary.ts)). It returns `(streakStart − killTick) × DT` at the first run of 12 consecutive qualifying hold samples (line 75), `0` when every post-kill hold sample is at or above 0.95 (line 60), and `null` when no hold sample follows the kill (line 59) or no qualifying run exists. So `tRec = 0` has two causes the record cannot separate: the all-hold case, or a streak that starts at the kill tick. The `tRec` key exists only when there is a `KILL` (lines 134-135). `inHold` is not stored.
- **Report** ([`report.ts`](../../src/cli/report.ts)). The exports are `WIN_MARGIN`, `verdict`, `quantile`, `median`, `stats`, `Group`, `fairPair`, `pairStatus`, `npwcRows` and `buildReport` (which returns Markdown). Grouping, paired deltas, censoring and `NO_VERDICT` are private, so **no structured report exists**.
- **Evidence.** The 50 committed records in `results/` (#122) have 360 samples each, from tick 5 to tick 1800. `buildReport` over them reproduces [`RESULTS.md`](../../results/RESULTS.md) up to its hand-written notes. They are the fixtures for every check, and their results are **not** Tiger results.
- **UI.** At 23d6748, `src/app/ui/styles.css` holds the tokens but nothing imports them, and `main.ts` calls the loader in `index.ts`, which auto-mounts any `src/app/ui/*.ts` that exports `createPanel`. At c697f6c (read-only re-check, [overview §2](../integrations/tiger-data-analytics.md#2-repository-audit-main-23d6748)), #113 has merged and imports the tokens (`src/app/main.ts:37`). The loader still exists, but nothing calls it. It stays a trap for any new module there (TCR-18). `dom.ts` provides `h`, `esc`, `fmt` and `fmtTime`. The Vite build has one entry. There is no charting dependency.

### 1.3 Deviations from William's plan

William's intent is kept everywhere. Each change is either a correction he anticipated or a consequence of current code.

| William | This RFC | Conflict record |
|---|---|---|
| §9.1 `tick * 0.05 AS sim_seconds` | `tick * r.dt_seconds`, read per run | TCR-15 |
| §9.2 inner join on tick | Full outer alignment on a tick spine, with a missing-tick report. His query is kept in §5.1 | TCR-31 (his own caveat) |
| §9.3 reuse `report.ts` semantics | `report.ts` is executed on reconstructed records after classification (§6.2), not after a `pairKey` filter: `MISMATCH` and `UNPAIRED` seeds reach it. Output is Markdown verbatim plus `npwcRows`/`stats` until a structured `analyse` export exists (§6) | TCR-17, TCR-19, TIG-D7 |
| §15 compare against `npm run eval -- --report` | Report equality as in evaluation §1.2 E1–E3 (§6.7) | TCR-07 |
| §10 separate Experiment Analytics page | Recommended; placement is TIG-D3 (§7.1) | TCR-09, TCR-18 |
| §7, §10 censored recovery shown | The three states are read from `t_rec_applicable`/`summary_json`, never from `t_rec_seconds` alone | TCR-25 |
| §10 run selector | Kept, plus import-state and dirty-revision filters (dirty runs are hidden by default, listable for viewing, never compared) | TCR-14, TIG-D11 |

---

## 2. Query semantics

### 2.1 Columns this RFC reads

The DDL is owned by the [ingestion RFC](TIGER_TELEMETRY_AND_INGESTION_RFC.md). The listings here write `encore.<table>` for readability. The runtime statements use unqualified names, and the schema is resolved through `search_path` (`set_config('search_path', $1, true)`: `encore` in production, `tig_test_<12 hex>` in tests, checked by one helper; ingestion RFC §7). Beyond William's columns (§6), the analytics reads these. If the ingestion RFC changes a name, Q17–Q26 follow it.

| Table | Columns used beyond William's | Why the analytics needs them |
|---|---|---|
| `experiment_runs` | `pair_key`, `hash_version`, `git_clean`, `composition_id`, `series_digest`, `events_digest`, `summary_digest`, `dt_seconds`, `expected_samples`, `telemetry_state` | Fair pairing (§4); `verified` (below); `sim_seconds` (§2.3); archived runs (§3.5) |
| `run_summaries` | `t_rec_applicable` (generated: `summary_json ? 'tRec'`) | The recovery states (§2.5) |
| `import_conflicts` | `experiment_key`, `existing_run_id`, `existing_artifact_hash`, `incoming_artifact_hash`, `detected_at` | The "conflict" state (TCR-29) |
| `run_verifications` | `run_id`, `verification_id`, `outcome`, `series_digest`, `events_digest`, `summary_digest` | The import-time half of `verified` (below; ingestion RFC §6.5, §11.1) |

**`verified` uses two mechanisms, never the local ledger or row existence alone** (TCR-30). A row's existence proves only that some holder of the writer credential committed it: case G (verification never ran), case H (digests differ) and a hand-deleted sample (`FX-GAP`) all leave the row in place.
- **Writer side.** After each commit the importer re-reads the rows and appends one `run_verifications` row (`verified` or `mismatch`, with the digests it recomputed; ingestion RFC Q13). The importer can only INSERT there.
- **Read side.** Every route that returns series or events (metrics, pairs, multi-seed) re-reads them (Q18–Q21, or the ingestion RFC's Q10–Q12). It compares `sha256(canonicalJson(…))` of the series, events and summary with the row's `series_digest`, `events_digest` and `summary_digest`, using the one shared `canonicalJson` (XI-7) through the same pure `src/telemetry/` helpers as the importer. At 360 rows a run, this is expected to cost less than the query. That is an estimate to measure in TIG-10 (TIG-NFR-08), not a fact. Nothing is cached, for the reasons in §3.7.

The "table condition" below means: the latest `run_verifications` row for the run (highest `verification_id`) is `verified`, and its three digests equal the `experiment_runs` digests. The outcome is `verification` (§3.2):

| `verification` | Condition | `verified` |
|---|---|---|
| `verified` | The table condition holds, `telemetry_state = 'present'`, and on routes that return series or events the per-read recomputation matches | `true` |
| `verified-at-import` | The run list (Q17), which returns no series and does not recompute: the table condition holds and `telemetry_state = 'present'`. Shown as "verified at import" | `true` (list route only) |
| `verified-without-series` | `archived`: the table condition holds and, on routes that return events, the events and summary digests match on read; the samples are gone | `false` |
| `mismatch` | Any digest disagreement: the latest row is `mismatch`, its digests differ from `experiment_runs`, or the per-read recomputation differs. `details` names which | `false` |
| `not-checked` | No `run_verifications` row yet (case G) | `false` |

What digests cannot prove is stated once in the [overview](../integrations/tiger-data-analytics.md): they show internal consistency only, and only comparison with the local artifact catches a writer-credential holder who rewrites rows and digests together (TD-1). A `mismatch` run is never paired or counted (reason `UNVERIFIED`, §4.2, §6.2).

### 2.2 Every query is scoped by `run_id`

All runs share one synthetic epoch (William §6.2, App. A), so a query constrained only by `sample_time` mixes every run.
- Every query on `simulation_metrics` or `simulation_events` filters by `run_id = $n` (or a bounded `ANY($n)`).
- Window functions use `PARTITION BY run_id`.
- No route accepts a time range without a run.
- Runs are selected by identity columns, never by time.

### 2.3 Time axis

- **Authoritative axis: `tick`.** Ordering, joins and alignment use `tick` only.
- **Simulated seconds: `sim_seconds = tick × dt_seconds`**, read per run (TCR-15).
  - `dt_seconds` is asserted, not measured: the importer reads `DT` from `src/contracts/params.ts` at the **record's** `git` ([ingestion RFC §8](TIGER_TELEMETRY_AND_INGESTION_RFC.md#8-time-semantics-td-6)). A clean record whose commit is missing locally is rejected (`DT_UNVERIFIABLE`); an `unknown`-git record takes the importer's `DT` with a `DT_ASSUMED` warning and is never compared anyway.
  - It is a display value and is never compared for equality: `185 × 0.05` is not exactly `9.25` in binary floating point.
  - Different `dt_seconds` means the runs are not comparable. Pairing rejects such runs (§4). The multi-seed route fixes one `git`, so it cannot meet them. The migration CHECK pins `dt_seconds` to 0.05, so against the database the `DT` check adds nothing beyond `git`; it can fire only against the in-memory fake, or if that CHECK is ever widened.
- **`sample_time` is synthetic.** It is the hypertable partition column. It is never returned as a date and never used in analytics joins.
- **Wall-clock time.** The only wall-clock value is `imported_at`, labelled "ingestion time".
- **Formatting.** The dashboard uses `fmtTime` (`dom.ts`) only when `run.dtSeconds` equals its built-in `DT`.

### 2.4 Gauges, cumulative counters and deltas

| Kind | Columns | Meaning of one row | Delta allowed |
|---|---|---|---|
| Gauge | `alive`, `coverage`, `pwc`, `npwc`, `sf_mean`, `sf_max`, `dup_slots`, `versions` | State at that sample tick | No: a gauge difference is not an event count |
| Cumulative counter | `hb_total`, `score_total`, `delivered_total`, `lost_total`, `blocked_total`, `collisions_total`, `near_misses_total`, `slot_changes_total` | Total since the run started (`src/observer/index.ts:59-60`) | Yes, by `LAG` over `tick` within one run |

The rules for deltas (William §9.4):

1. **Within one run, ordered by `tick`.** `delta = total − LAG(total, 1, 0)`. The first row's delta is its total: it covers ticks 0–5 and is marked "since run start".
2. **Validate before use.** Import already rejects a decreasing counter, so a negative delta here means the stored rows and the verified artifact disagree.
   - The route returns the totals with `counters.check = 'decreasing'` and `deltas = null`.
   - The dashboard shows the integrity state (§7.4).
3. **Gaps.** An interval wider than the 5-tick cadence is flagged as spanning a gap.
4. **Units.**
   - `hb` and `score` count **broadcasts**.
   - `delivered`, `lost` and `blocked` count **receiver outcomes** ([evaluation §2](../validation/evaluation-and-tests.md#2-metrics)).
   - `collisions` and `nearMisses` count **pair entries**.
   - `slotChanges` counts **drone slot changes**.

   Broadcasts and receiver outcomes never share an axis.
5. **Rates are approximations.** A per-interval `Δ(hb + score) / (alive × interval seconds)` is labelled "approximate". It is never compared with `msgsPerDroneSec`, which averages `alive` over every tick.
6. **A total is not an event.** `collisions_total = 3` at tick t means three since the start.

### 2.5 NULL semantics

- **`npwc`, `sf_mean`, `sf_max` NULL** means no live drone (contract §5). It stays NULL in rows, in JSON (`null`) and in charts, where it is drawn as a gap, never as 0 (William §9.2, §15). `fmt()` in `dom.ts` already prints `—` for null.
- **Arithmetic with NULL gives NULL.** `e.npwc − s.npwc` is NULL when either value is NULL or a row is absent. The API passes `null` through; it never substitutes 0.
- **`AVG`, `MIN`, `MAX`, `percentile_cont` and `COUNT(col)` skip NULLs; `COUNT(*)` does not.** Any aggregate of a nullable column therefore also returns `COUNT(*)` and `COUNT(col)`.
- **Censored outcomes must not be averaged away** (William §7, App. A). `AVG(t_rec_seconds)` silently drops every run that never recovered, so it describes only the successes. A median that drops them does the same.
  - `report.ts` ranks a censored `tRec` as +∞ (`stats(values, true)`, lines 60-66), so it stays in `n`.
  - No query here aggregates `tRec`: all `tRec` statistics come from `report.ts` (§6).
- **`tRec` has three states, and the SQL column cannot tell two of them apart.** `run_summaries.t_rec_seconds` is NULL both when the run was censored (key present, value `null`) and when it is not applicable (key absent, no KILL). The state is read from `t_rec_applicable`, which is generated from `summary_json ? 'tRec'` (TCR-25; Q21):

  | State | `summary_json` | Meaning |
  |---|---|---|
  | Recovered | `tRec` present and a number > 0 | Finite authoritative `tRec`: the start of the first qualifying 12-sample streak |
  | Recovered, `tRec = 0` | `tRec` present and exactly `0` | One of two causes the record cannot separate (§1.2): every post-kill hold sample at or above 0.95 (`summary.ts:60`), or a streak that starts at the kill tick (`summary.ts:75`). No band is drawn (§7.3) |
  | Not recovered, or not measurable (censored) | `tRec` present, JSON `null` | A KILL exists, and either no hold sample follows it (`summary.ts:59`), or some post-kill hold sample is below 0.95 or null and no qualifying 12-sample run starts at or after the kill tick |
  | Not applicable | `tRec` absent | No KILL within the run |

  The exact rule and display texts are canonical in the overview §6.5; this table follows them. `tRec = 0` is a sub-state of Recovered, so the API still has three `recovery.state` values (§3.5) and flags it with `tRecZero`.

  Consistency rule: "a KILL within the run horizon exists" if and only if "`tRec` is present". A violation is an integrity error.
- **Other null summary keys mean "not applicable"** (for example, `npwcDeficitSec` with no event, or `deliveryRatio` with no messages), as `report.ts` labels them (`nullLabel`, lines 84-86).
- **Summary values come only from `summary_json` / `run_summaries`**, never from SQL over samples. `npwcEnd` is a hold-filtered mean over ticks 1700–1799, not `AVG(npwc)` over that range (William §7). `inHold` is not stored (TIG-CC-01, deferred).

### 2.6 Analytics queries Q17–Q26

Proposed, **not executed**. All are parameterised (`$n`), use the read-only role, and are verified against the provisioned service before use. Identifiers are never built from input. The listings are schema-qualified for readability only (§2.1).

Q17 shows the latest-verification `LATERAL` join and the `table_verification` expression (the table condition of §2.1). Q22 (once per run) and Q24 repeat them.

```sql
-- Q17 PROPOSED (not executed). Run list for the selector. Every filter is optional; keyset pagination.
SELECT r.run_id, r.scenario, r.arm, r.seed, r.n0, r.git_revision, r.git_clean, r.params_hash,
       r.composition_id, r.pair_key, r.experiment_key, r.hash_version, r.artifact_hash, r.state_hash,
       r.expected_samples, r.dt_seconds, r.telemetry_state, r.imported_at, r.events_digest,
       CASE WHEN lv.outcome IS NULL THEN 'not-checked'
            WHEN lv.outcome = 'verified' AND lv.series_digest = r.series_digest
                 AND lv.events_digest = r.events_digest AND lv.summary_digest = r.summary_digest
            THEN 'ok' ELSE 'mismatch' END                              AS table_verification,
       EXISTS (SELECT 1 FROM encore.import_conflicts c
                WHERE c.existing_run_id = r.run_id OR c.experiment_key = r.experiment_key) AS contested
FROM encore.experiment_runs r
LEFT JOIN LATERAL (SELECT v.outcome, v.series_digest, v.events_digest, v.summary_digest
                   FROM encore.run_verifications v WHERE v.run_id = r.run_id
                   ORDER BY v.verification_id DESC LIMIT 1) lv ON true
WHERE ($1::text IS NULL OR r.scenario = $1)
  AND ($2::bigint IS NULL OR r.seed = $2)                           -- seed is BIGINT (uint32)
  AND ($3::text IS NULL OR r.arm = $3)
  AND ($4::text IS NULL OR r.git_revision = $4)
  AND ($5::text IS NULL OR r.params_hash = $5)
  AND ($6::text IS NULL OR r.composition_id = $6)
  AND ($7::int  IS NULL OR r.n0 = $7)
  AND ($8::boolean OR r.git_clean)                                   -- $8 = includeDirty (listing only)
  AND ($9::text IS NULL OR r.telemetry_state = $9)                   -- 'present' | 'archived'
  AND ($10::text IS NULL OR (r.scenario, r.n0, r.seed, r.arm, r.run_id)
                          > ($10, $11::int, $12::bigint, $13::text, $14::uuid))   -- cursor
ORDER BY r.scenario, r.n0, r.seed, r.arm, r.run_id
LIMIT $15;                                                           -- limit + 1, to detect a next page
```

```sql
-- Q18 PROPOSED (not executed). One run's series, ordered, bounded; sim_seconds from the run's own dt.
SELECT m.tick,
       m.tick * r.dt_seconds AS sim_seconds,
       m.alive, m.coverage, m.pwc, m.npwc, m.sf_mean, m.sf_max, m.dup_slots, m.versions,
       m.hb_total, m.score_total, m.delivered_total, m.lost_total, m.blocked_total,
       m.collisions_total, m.near_misses_total, m.slot_changes_total
FROM encore.simulation_metrics m
JOIN encore.experiment_runs r ON r.run_id = m.run_id
WHERE m.run_id = $1 AND m.tick > $2 AND m.tick <= $3                 -- $2 = afterTick (default -1)
ORDER BY m.tick
LIMIT $4;
```

```sql
-- Q19 PROPOSED (not executed). Interval deltas of cumulative counters, plus the non-decreasing check.
SELECT m.tick,
       m.tick - COALESCE(LAG(m.tick) OVER w, 0)                          AS interval_ticks,
       LAG(m.tick) OVER w IS NULL                                        AS since_run_start,
       m.hb_total          - LAG(m.hb_total,          1, 0::bigint) OVER w AS hb_delta,
       m.score_total       - LAG(m.score_total,       1, 0::bigint) OVER w AS score_delta,
       m.delivered_total   - LAG(m.delivered_total,   1, 0::bigint) OVER w AS delivered_delta,
       m.lost_total        - LAG(m.lost_total,        1, 0::bigint) OVER w AS lost_delta,
       m.blocked_total     - LAG(m.blocked_total,     1, 0::bigint) OVER w AS blocked_delta,
       m.collisions_total  - LAG(m.collisions_total,  1, 0::bigint) OVER w AS collisions_delta,
       m.near_misses_total - LAG(m.near_misses_total, 1, 0::bigint) OVER w AS near_misses_delta,
       m.slot_changes_total- LAG(m.slot_changes_total,1, 0::bigint) OVER w AS slot_changes_delta
FROM encore.simulation_metrics m
WHERE m.run_id = $1
WINDOW w AS (PARTITION BY m.run_id ORDER BY m.tick)
ORDER BY m.tick;
-- The service sets counters.check = 'decreasing' if any *_delta < 0, naming the first field and tick.
-- Deltas are computed over the whole run even when the response pages, so a page boundary never
-- creates a false "since run start" row.
```

```sql
-- Q20 PROPOSED (not executed). Scheduled environment events for markers, in original order.
SELECT e.event_index, e.tick, e.event_type,
       e.details - 'score'                     AS details,          -- markers do not need the score body
       e.details -> 'score' -> 'version'       AS score_version,    -- INJECT_SCORE only
       CASE WHEN e.event_type = 'KILL' THEN jsonb_array_length(e.details -> 'ids') END AS kill_count
FROM encore.simulation_events e
WHERE e.run_id = $1
ORDER BY e.event_index;
```

```sql
-- Q21 PROPOSED (not executed). Authoritative summary and the three-way recovery state.
SELECT s.summary_json,
       CASE WHEN NOT s.t_rec_applicable                         THEN 'not-applicable'
            WHEN jsonb_typeof(s.summary_json -> 'tRec') = 'null' THEN 'censored'
            ELSE 'recovered' END                               AS recovery_state,   -- = RecoveryState['state']
       s.t_rec_seconds,                                        -- NULL for both censored and not applicable
       (SELECT MIN(e.tick) FROM encore.simulation_events e
         WHERE e.run_id = s.run_id AND e.event_type = 'KILL'
           AND e.tick <= $2)                                   AS first_kill_tick   -- $2 = run horizon in ticks
FROM encore.run_summaries s
WHERE s.run_id = $1;
-- summary.ts takes the first KILL after sorting events by tick, ignoring events after the horizon
-- (lines 98, 134), which is MIN(tick) here. first_kill_tick IS NULL must coincide with 'not-applicable'.
-- The values are emitted exactly as RecoveryState['state'] (§3.5), so the service needs no mapping.
```

The remaining queries are elsewhere in this file:
- Q22 (pair check) is in §4, Q23 (alignment) in §5, and Q24 (selection) in §6.
- Q25 is reserved: reconstruction reuses the ingestion RFC's re-read queries Q10–Q12.
- Q26 (an optional `time_bucket` view) is in §7.3.

---

## 3. Analytics API

### 3.1 Common rules

- **Placement.** The routes belong to the `tiger` module (`integrations/gateway/src/tiger/`, XI-20) of the one shared optional gateway `integrations/gateway/` (XI-1; [boundaries §6](OPTIONAL_INTEGRATION_BOUNDARIES.md#6-x-run-external-integration-runner), provisional, #110). The module is enabled only by its own server-side settings, and its absence or failure never affects the other modules, the app, the simulator, the CLI or `report.ts`.
- **Shared skeleton and guard.** The module uses the gateway's one server, `guard.ts`, `errors.ts`, `config.ts` and `GET /api/health`, defined once in [boundaries §6.2](OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard) (XI-12, provisional, #110), and never redefines them. That guard binds `127.0.0.1` only, refuses non-loopback peers, allows only `Host` `127.0.0.1:<port>` or `localhost:<port>` (plus the dev proxy, if one is decided), requires an exact `Origin` on every non-GET request, and sends no CORS headers unless OIB-Q2 decides for CORS. Every analytics route is a `GET`.
- **Imports.** The module imports only pure modules (XI-2): `src/contracts/**`, `src/score/**` (including `src/score/canonical.ts`, XI-19), `src/telemetry/**` and the pure composition validator `src/app/compose/validate.ts` (XI-13). After TIG-D7, it also imports the extracted statistics module (§6.2 step 4). It never imports `src/cli`. It never spawns a child process.
- **Read-only.** The routes use the read role (`SELECT` only, `default_transaction_read_only = on`). There is no upload route; the CLI importer writes (TCR-08). The API process holds only the reader credential `TIGER_READ_DATABASE_URL`. It refuses to start if the importer credential (`TIGER_DATABASE_URL`, kept in `.env.importer`), the admin credential `TIGER_ADMIN_DATABASE_URL` or the live-write credential `TIGER_LIVE_WRITE_URL` is set (TIG-03).
- **Bounded.** The gateway keeps a small pool of at most 3 connections; shared compute allows `max_connections` = 25 (Tiger Cloud docs, VERIFIED 2026-11-15) and a read-only role gives no resource isolation. Each statement has `statement_timeout` = 5 s, and acquiring a pool connection times out after 2 s (503). The gateway binds to `127.0.0.1`, so every caller is one client: budgets are global per route, not per client.

  | Route | Budget beyond which 429 with `Retry-After` |
  |---|---|
  | `/api/runs`, `/api/runs/:runId/metrics` | 20 requests per second |
  | `/api/comparisons` | 5 requests per second |
  | `/api/experiments/comparison` | 1 computation at a time, queue of 2 |
- **Size.** No route takes a body. Response size is bounded by the `limit` parameters (§3.4, §3.5). The per-artifact cap is the ingestion RFC's 1 MiB (XI-8), about 9× the largest committed record (113,222 bytes); nothing larger can be stored.
- **`requestId`** follows the shared rule (XI-11, [boundaries §6.2](OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard)): optional, client-generated, `^[A-Za-z0-9._:-]{1,64}$`, echoed in the error envelope, and dropped (not echoed) when it does not match.
- **Number decoding.** node-postgres returns `int8` (including `COUNT(*)`) as a string by default (TIG-T17). The gateway converts it with a `Number.isSafeInteger` check, and a failure gives 500. `double precision` values are never rounded or clamped: the committed `pwc = 1.0000000000000004` passes through.
- **No infinity in JSON.** A censored quantile (+∞ in `report.ts`) is sent as `'censored'`, because `JSON.stringify(Infinity)` gives `null`, which would merge censored with not applicable.

**Errors** use the gateway's one shared envelope and code list (XI-3), held in `errors.ts` ([boundaries §6.2](OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard), provisional, #110): `{ "error": { "code", "message", "details"?: [{ "path", "reason" }], "requestId"? } }`. A success body has no `success` flag; the HTTP status carries it. Causes specific to Tiger are `details[].reason` values, never codes:

| Status | `code` (XI-3) | `details[].reason` (this module) |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `INVALID_QUERY`, `INVALID_ID`, `INVALID_CURSOR`, `SAME_RUN`, `ARM_ROLES` |
| 403 | `FORBIDDEN` | — (the shared guard: `Host` not allowed, or `Origin` missing or not matching on a non-GET) |
| 404 | `NOT_FOUND` | `RUN_NOT_FOUND` (with `path` naming the parameter) |
| 409 | `CONFLICT` | `AMBIGUOUS_SELECTION`: two runs for one (seed, arm) |
| 422 | `VALIDATION_FAILED` | one entry per §4.2 reason (`SCENARIO`, `GIT`, `HASH_VERSION`, `HORIZON`, `CONTESTED`, `UNVERIFIED`, …); `DIRTY_REVISION` |
| 429 | `RATE_LIMITED` | — (`Retry-After` set) |
| 500 | `INTERNAL` | `RECONSTRUCTION_MISMATCH`, `REPORT_FAILED`, `UNSAFE_INTEGER` |
| 503 | `DATABASE_UNAVAILABLE` | `MODULE_DISABLED` when the module is not configured (as in the `shows` module); `POOL_TIMEOUT` (`Retry-After: 5` except for `MODULE_DISABLED`) |
| 503 | `PROVIDER_UNAVAILABLE` | `REPORT_NOT_ENABLED`: the multi-seed route before TIG-D7 (§6.2 step 4); no `Retry-After` |
| 504 | `TIMEOUT` | `STATEMENT_TIMEOUT` |

Excluded runs in a success body are listed as `excluded[].reason` (§6.2), not as errors.

- **400 or 422.** Malformed input gets 400, as in the `shows` module. A well-formed request for existing runs that must not be compared gets 422. It is a domain refusal, and the dashboard renders it as the blocked-comparison state, not as an input error.
- **Retries.** Clients retry only network errors, timeouts, 503 and 429, never by reading message text.
- **Error text.** Errors never contain driver text, SQL, hosts, user names or connection strings.

**Health.** The shared `GET /api/health` shows `modules.tiger: { enabled: boolean }`. This RFC adds `db: 'up' | 'down' | 'disabled'` to it, as for `shows`, taken from a cached `SELECT 1` that is refreshed at most every 10 s.

### 3.2 Provenance block

Every run in every response carries this block:

```ts
interface Provenance {
  source: 'tiger' | 'local-artifact' | 'live-provisional' | 'fixture';
  verified: boolean;          // true only for source 'tiger' with verification 'verified', or 'verified-at-import'
                              // on the run list (§2.1, TCR-30); false for every other source, and shown false
                              // while the gateway is down (§7.4)
  verification: 'verified' | 'verified-at-import' | 'verified-without-series' | 'mismatch' | 'not-checked'
              | null;         // null unless 'tiger'; 'verified-at-import' only on GET /api/runs
  importedAt: string | null;  // ISO 8601 ingestion wall-clock time; only for source 'tiger'
  artifactHash: string | null;// sha256(canonicalJson(record)), hex; null for live-provisional
  git: string | null;         // RunRecord.git, verbatim
  gitClean: boolean | null;   // false for '-dirty' or 'unknown'
}
```

`source` describes **where the bytes came from**, not where they are drawn. A gateway response only ever says `'tiger'`; the other three values are set by the dashboard's own loaders (§7). A parsed and hashed local file is still `verified: false`: it is the authoritative artifact, but nothing was compared with it (TIG-08's `createLocalClient` says the same).

### 3.3 Run metadata (shared shape)

```ts
interface RunMeta {
  runId: string; scenario: string; arm: 'encore' | 'static'; seed: number; n0: number;
  git: string; gitClean: boolean; paramsHash: string; compositionId: string | null;
  experimentKey: string; pairKey: string | null; hashVersion: number;
  stateHash: string; recordVersion: 1; expectedSamples: number; dtSeconds: number;
  eventsDigest: string;       // so the UI can derive the EVENTS reason without a request per candidate (§7.3)
  telemetryState: 'present' | 'archived';
  contested: boolean;         // an import_conflicts row names this run or its experimentKey
  pairable: boolean;          // false when compositionId/pairKey is null or gitClean is false
  provenance: Provenance;
}
```

### 3.4 `GET /api/runs`

| Parameter | Validation |
|---|---|
| `scenario` | `^S[0-9]{1,2}$` |
| `seed` | integer 0…4 294 967 295 (uint32, as stored) |
| `arm` | `encore` or `static` |
| `n0` | integer 1…10 000 |
| `git` | `^[0-9a-f]{40}(-dirty)?$` or `unknown` |
| `paramsHash` | `^[0-9a-f]{64}$` |
| `compositionId` | ≤ 128 characters, `^[A-Za-z0-9:_.-]+$` |
| `telemetry` | `present` (default), `archived`, `any` |
| `includeConflicts` | `true` or `false` (default `false`) |
| `includeDirty` | `true` or `false` (default `false`) |
| `limit` | 1…200, default 50 |
| `cursor` | opaque base64url, ≤ 256 characters |

Any other parameter gets 400 `VALIDATION_FAILED` (reason `INVALID_QUERY`).

```ts
interface RunListResponse { items: RunMeta[]; conflicts?: ConflictEntry[]; nextCursor: string | null }
interface ConflictEntry { experimentKey: string; existingRunId: string; existingArtifactHash: string;
                          incomingArtifactHash: string; detectedAt: string; selectable: false }
```

- Implemented by Q17. Rows are ordered by (scenario, n0, seed, arm, run_id), so pages are stable.
- `provenance.verification` comes from Q17's `table_verification`: `'ok'` gives `verified-at-import` for a present run and `verified-without-series` for an archived one; otherwise `not-checked` or `mismatch` (§2.1). The list never recomputes digests.
- `includeDirty` only shows dirty runs in the list, badged (§7.2). No comparison route accepts it (TIG-D10).
- With `includeConflicts=true`, `conflicts` lists the matching `import_conflicts` rows. The rejected artifact's rows were never stored (TCR-29).
- Statuses: 200, 400, 403, 429, 503, 504, 500.

### 3.5 `GET /api/runs/:runId/metrics`

| Parameter | Validation |
|---|---|
| `:runId` | lower-case canonical UUID (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), checked before any query, or 400 `INVALID_ID` |
| `afterTick` | integer ≥ −1, default −1 |
| `toTick` | integer ≥ 0 |
| `limit` | 1…2000, default 2000; one 1800-tick run is 360 rows |

```ts
type CounterField = 'hb' | 'score' | 'delivered' | 'lost' | 'blocked' | 'collisions' | 'nearMisses' | 'slotChanges';
interface SampleRow {
  tick: number; simSeconds: number;
  alive: number; coverage: number; pwc: number; npwc: number | null; sfMean: number | null; sfMax: number | null;
  dupSlots: number; versions: Record<string, number>;
  totals: Record<CounterField, number>;
  deltas: Record<CounterField, number> | null;     // null when counters.check !== 'ok'
  intervalTicks: number; sinceRunStart: boolean; spansGap: boolean;
}
interface EventMarker { index: number; tick: number; type: EnvEventType; details: unknown; killCount?: number; scoreVersion?: unknown }
type SummaryCell = { present: false } | { present: true; value: number | null };
type RecoveryState =
  | { state: 'recovered'; tRec: number; killTick: number; tRecZero: boolean;
      streakStartTick: number | null; bandEndTickExclusive: number | null }   // both null when tRecZero (no band)
  | { state: 'censored'; killTick: number }
  | { state: 'not-applicable' };
interface RunMetricsResponse {
  run: RunMeta;
  timeAxis: { authoritative: 'tick'; dtSeconds: number; sampleTicks: number; syntheticTimeNote: string };
  page: { afterTick: number; returned: number; nextAfterTick: number | null };
  samples: SampleRow[];
  counters: { check: 'ok' | 'decreasing'; firstDecrease: { field: CounterField; tick: number } | null };
  completeness: { expected: number; present: number; missingTicks: number[]; offScheduleTicks: number[] };
  events: EventMarker[];
  summary: { cells: Record<string, SummaryCell>; recovery: RecoveryState; integrity: string[] };
}
```

- **Sources.** Q18 provides the rows, Q19 the deltas, Q20 the markers and Q21 the summary.
- **Completeness.** `completeness` compares the stored ticks with the expected schedule `{sampleTicks, 2·sampleTicks, …, expectedSamples·sampleTicks}` (first sample at tick 5).
- **Sample cadence.** `sampleTicks` = 5, the contract's documented cadence ("one per 5 ticks", `metrics.ts:6`; ingestion Q7 uses the same value, TCR-11).
- **Recovery fields** are defined in §7.3.
- **`summary.integrity`** lists failed consistency checks:
  - KILL presence versus `tRec` presence;
  - the last sample's totals for `collisions`, `nearMisses` and `slotChanges` versus the summary keys of the same name. These were equal in all 50 committed records.
- **Statuses:** 200; 400; 404 `RUN_NOT_FOUND`; 429; 503; 504; 500.
- **Verification.** This route recomputes the digests on every read (§2.1). A run that is not `verified` (or `verified-without-series` when archived) is still returned, with its `verification` and badge, so the integrity state can be seen. It is a single-run view with no deltas across runs.
- **Archived runs** return 200 with `samples: []`, `run.telemetryState: 'archived'`, and the events and summary. The dashboard says "telemetry archived; the owner can restore it from the local artifact (`tiger restore`, ingestion RFC Q16b)", which is distinct from a run with zero measurements (William §14). A re-import does not restore it: the importer reports `ARCHIVED` (ingestion RFC §10, case 2(a′)).

### 3.6 `GET /api/comparisons` and `GET /api/experiments/comparison`

The pair route, `GET /api/comparisons?encoreRunId&staticRunId[&allowMismatch=true][&afterTick&limit]`, is specified in §4 (fairness) and §5 (response).

The multi-seed route, `GET /api/experiments/comparison?scenario&n0&git&paramsHash[&compositionId][&matrix=minimum|full]`, is specified in §6. All four of its main parameters are required; `matrix` (default `minimum`) picks a pre-registered seed set, not a seed list. A `git` ending in `-dirty`, or equal to `unknown`, is refused with 422 `VALIDATION_FAILED` (reason `DIRTY_REVISION`): dirty runs are importable but never compared (TCR-14, TIG-D11). One `(git, paramsHash)` per request is the default comparison set (TIG-D10). This RFC offers no mixing option, so `buildReport`'s mixed-revision warning cannot arise here.

### 3.7 Database unavailable, caching and bounds

- **Database down.** The route returns 503 `DATABASE_UNAVAILABLE` (`Retry-After: 5`) or 504 `TIMEOUT`, and health reports `db: 'down'`. The gateway never serves stale rows and never falls back to local files. Only the operator opens local files, in the dashboard, which labels them `local-artifact` (§7.4).
- **Module not configured.** The route returns 503 with reason `MODULE_DISABLED` and no `Retry-After`.
- **No caching in the MVP.** A stored run's state can change without any `artifactHash` changing: archival (Q16), a new `import_conflicts` row, a hand delete (case H) or a failed read-path check (§2.1). A key built from hashes would answer 304 with stale state, so every response, errors included, is `Cache-Control: no-store` with no `ETag`, and the gateway keeps no result cache. Each request re-reads and re-verifies. The in-process report over at most 40 records is expected to take milliseconds (§6.2). That is an estimate to measure in TIG-10 (TIG-NFR-08), not a fact.
  - The dashboard keeps data in memory only, never in `localStorage`.

---

## 4. Fair pairing

### 4.1 Rule

An Encore run and a static run form a **fair pair** if and only if all of these hold:

1. their `pair_key`s are equal and non-null, and their arms differ;
2. `report.ts`'s own `fairPair` holds: same `git`, same `paramsHash`, and `canonicalJson(events)` equal.

`pair_key` already covers scenario, seed, `n0`, git, params, events and composition (ingestion RFC), so (1) implies (2). Both are checked anyway, so that the gateway's semantics can never drift from the report's (TCR-19).

**How (2) is checked.** Once TIG-D7 extracts `report.ts`'s statistics, `fairPair` included, into a pure module the gateway may import under XI-2, the route calls `fairPair` on the two reconstructed records. Before that, XI-2 bars `src/cli` ([boundaries §6](OPTIONAL_INTEGRATION_BOUNDARIES.md#6-x-run-external-integration-runner), provisional, #110), so the route checks (2) as equality of `git_revision`, `params_hash` and `events_digest`. That digest is `sha256(canonicalJson(record.events))`, recorded at import (ingestion RFC), so the check computes the same predicate. TIG-T20 confirms the equivalence on the 50 records and on copies with an altered event, git or params.

A fair pair is **eligible for deltas** only if both runs are also clean (`git_clean`), have `telemetry_state = 'present'`, are `verified` (both mechanisms of §2.1: the latest `run_verifications` row and the per-read check) and are not contested. A conflict means the determinism invariant failed, so the stored artifact is not known to be the right one; the run stays out of comparisons until Arnav resolves it (ingestion RFC §10). Eligibility gates every delta the API returns.

The reason derivation is one pure function, `pairReasons(a: RunMeta, b: RunMeta): Reason[]` in `src/telemetry/pairing.ts`. The gateway applies it to Q22's row and the dashboard to `RunMeta`, so the selector can list every candidate's reasons without a request per candidate (§7.3). TIG-T20 asserts that both give the same reasons.

```sql
-- Q22 PROPOSED (not executed). Pair check: every component, so a refusal can say why.
SELECT e.arm AS encore_arm, s.arm AS static_arm,
       COALESCE(e.pair_key = s.pair_key, false)                 AS same_pair_key,
       e.scenario = s.scenario AS same_scenario, e.seed = s.seed AS same_seed, e.n0 = s.n0 AS same_n0,
       e.git_revision = s.git_revision AS same_git, e.params_hash = s.params_hash AS same_params,
       e.events_digest = s.events_digest AS same_events,
       e.composition_id IS NOT NULL AND s.composition_id IS NOT NULL AS composition_known,
       e.composition_id IS NOT DISTINCT FROM s.composition_id AS same_composition,
       e.hash_version = s.hash_version AS same_hash_version,
       e.dt_seconds = s.dt_seconds AS same_dt, e.expected_samples = s.expected_samples AS same_horizon,
       e.git_clean AND s.git_clean AS both_clean,
       e.telemetry_state = 'present' AND s.telemetry_state = 'present' AS both_present,
       NOT EXISTS (SELECT 1 FROM encore.import_conflicts c
                    WHERE c.existing_run_id IN (e.run_id, s.run_id)
                       OR c.experiment_key IN (e.experiment_key, s.experiment_key)) AS neither_contested,
       CASE WHEN ve.outcome IS NULL THEN 'not-checked'
            WHEN ve.outcome = 'verified' AND ve.series_digest = e.series_digest
                 AND ve.events_digest = e.events_digest AND ve.summary_digest = e.summary_digest
            THEN 'ok' ELSE 'mismatch' END AS encore_table_verification,
       CASE WHEN vs.outcome IS NULL THEN 'not-checked'
            WHEN vs.outcome = 'verified' AND vs.series_digest = s.series_digest
                 AND vs.events_digest = s.events_digest AND vs.summary_digest = s.summary_digest
            THEN 'ok' ELSE 'mismatch' END AS static_table_verification
FROM encore.experiment_runs e CROSS JOIN encore.experiment_runs s
LEFT JOIN LATERAL (SELECT v.outcome, v.series_digest, v.events_digest, v.summary_digest
                   FROM encore.run_verifications v WHERE v.run_id = e.run_id
                   ORDER BY v.verification_id DESC LIMIT 1) ve ON true
LEFT JOIN LATERAL (SELECT v.outcome, v.series_digest, v.events_digest, v.summary_digest
                   FROM encore.run_verifications v WHERE v.run_id = s.run_id
                   ORDER BY v.verification_id DESC LIMIT 1) vs ON true
WHERE e.run_id = $1 AND s.run_id = $2;
-- The gateway also runs the read-path digest check (§2.1, Q10–Q12) on both runs.
-- Either run not 'verified' (table condition or read check) adds UNVERIFIED.
```

### 4.2 Reasons for rejection

| Reason code | Condition | Overridable for viewing |
|---|---|---|
| `SAME_RUN` | `encoreRunId = staticRunId` | No (400 `VALIDATION_FAILED`) |
| `ARM_ROLES` | `encoreRunId` is not `encore`, or `staticRunId` is not `static` | No (400 `VALIDATION_FAILED`) |
| `SCENARIO`, `SEED`, `N0` | Different experiment cell | Yes |
| `GIT`, `PARAMS`, `EVENTS` | `fairPair` would be false (William §15: rejected) | Yes |
| `COMPOSITION_UNKNOWN` | Either `composition_id` is NULL, so the runs cannot be paired | Yes |
| `COMPOSITION` | Different composition identity (`scenario:<id>`, Gemini `sceneHash`, MongoDB `contentHash`) | Yes |
| `HASH_VERSION` | Identities were computed by different hash versions | Yes |
| `DT` | Different `dt_seconds`, so a tick is not the same simulated time (App. A). Fires only against the fake while the CHECK pins 0.05 (§2.3) | Yes, aligned by tick, with a time warning |
| `HORIZON` | Different `expected_samples` | Yes |
| `GIT_DIRTY` | Either run is `-dirty` or `unknown` | Yes |
| `CONTESTED` | An `import_conflicts` row names either run or its `experiment_key` | Yes; deltas always null |
| `UNVERIFIED` | Either run is not `verified` (§2.1): `mismatch` or `not-checked` (archived runs give `ARCHIVED` instead) | Yes; deltas always null |
| `ARCHIVED` | Either run's samples are archived (`telemetry_state`) | Not a refusal: always 200, see below |

Without `allowMismatch=true`, any overridable reason gives 422 `VALIDATION_FAILED`, with one `details[]` entry per reason (`reason` = the code above, for example `'HASH_VERSION'`; `path` naming the run parameter). These are `details[].reason` values under the shared code, never codes of their own (XI-3).

`ARCHIVED` is not a blocked comparison: there is simply nothing to align. The route returns 200 with `rows: []`, `fairness.eligible: false`, every delta `null` with `deltaReason: 'archived'`, and the archived run's `telemetryState: 'archived'`. The dashboard renders the "Archived telemetry" state for that arm (§7.4), never the blocked-pair state.

With `allowMismatch=true` and only overridable reasons, the route returns 200 with:
- `fairness.fair: false` and `fairness.overridden: true`;
- `warnings[]` naming each reason in words;
- **every delta set to `null`**.

Viewing two unfair runs side by side is allowed (William §10); subtracting them is not, because the difference would mix the algorithm with whatever else differs.

---

## 5. Paired trajectories

### 5.1 William's query, preserved

William §9.2, kept as the source:

```sql
SELECT e.tick,
       e.npwc AS encore_npwc,
       s.npwc AS static_npwc,
       e.npwc - s.npwc AS delta_npwc
FROM simulation_metrics e
JOIN simulation_metrics s ON e.tick = s.tick
WHERE e.run_id = $1
  AND s.run_id = $2
ORDER BY e.tick;
```

As William states, the inner join drops a tick that is missing in either run, without trace. A chart drawn from it would bridge the hole with a straight line and look complete. His mitigation, "check sample alignment and flag missing data", is built into the replacement.

### 5.2 Replacement: full outer alignment on the expected schedule

```sql
-- Q23 PROPOSED (not executed). $1 encore run, $2 static run, $3 sample cadence in ticks (5).
WITH n AS (
  SELECT GREATEST(e.expected_samples, s.expected_samples) AS samples
  FROM encore.experiment_runs e CROSS JOIN encore.experiment_runs s
  WHERE e.run_id = $1 AND s.run_id = $2
),
spine AS (SELECT g * $3::int AS tick FROM n, generate_series(1, n.samples) AS g),   -- 5, 10, ..., last
e AS (SELECT tick, alive, coverage, npwc, sf_mean, sf_max, versions FROM encore.simulation_metrics WHERE run_id = $1),
s AS (SELECT tick, alive, coverage, npwc, sf_mean, sf_max, versions FROM encore.simulation_metrics WHERE run_id = $2),
pairs AS (
  SELECT COALESCE(e.tick, s.tick) AS tick,
         e.tick IS NOT NULL AS encore_present, s.tick IS NOT NULL AS static_present,
         e.alive AS encore_alive, s.alive AS static_alive,
         e.coverage AS encore_coverage, s.coverage AS static_coverage,
         e.npwc AS encore_npwc, s.npwc AS static_npwc,
         e.sf_mean AS encore_sf_mean, s.sf_mean AS static_sf_mean,
         e.sf_max AS encore_sf_max, s.sf_max AS static_sf_max,
         e.versions AS encore_versions, s.versions AS static_versions,
         e.npwc - s.npwc AS delta_npwc                         -- NULL if either is NULL or absent
  FROM e FULL OUTER JOIN s ON s.tick = e.tick
)
SELECT COALESCE(sp.tick, p.tick)            AS tick,
       sp.tick IS NOT NULL                  AS on_schedule,
       COALESCE(p.encore_present, false)    AS encore_present,
       COALESCE(p.static_present, false)    AS static_present,
       p.encore_alive, p.static_alive, p.encore_coverage, p.static_coverage,
       p.encore_npwc, p.static_npwc, p.encore_sf_mean, p.static_sf_mean,
       p.encore_sf_max, p.static_sf_max, p.encore_versions, p.static_versions, p.delta_npwc
FROM spine sp FULL OUTER JOIN pairs p ON p.tick = sp.tick
ORDER BY 1;
```

Every expected tick appears once. Every stored tick appears once, including off-schedule ones. The presence flags make every gap explicit.

The service derives the alignment report from this result and returns:

```ts
interface ArmPoint { alive: number; coverage: number; npwc: number | null; sfMean: number | null; sfMax: number | null }
interface ComparisonResponse {
  encore: RunMeta; static: RunMeta;
  fairness: { fair: boolean; eligible: boolean; overridden: boolean; reasons: string[]; checks: Record<string, boolean> };
  warnings: string[];
  alignment: { expectedTicks: number; bothPresent: number; encoreMissing: number[]; staticMissing: number[];
               offSchedule: number[]; complete: boolean };
  rows: { tick: number; simSeconds: number | null; onSchedule: boolean;
          encore: ArmPoint | null; static: ArmPoint | null; deltaNpwc: number | null }[];
  deltaReason: 'ineligible' | 'archived' | null;   // why every delta is null, if so
  reference: { differs: boolean; fromTick: number | null };   // NO_VERDICT scenarios only (S5), else differs: false
  events: { encore: EventMarker[]; static: EventMarker[]; identical: boolean };
  summaries: { key: string; static: SummaryCell; encore: SummaryCell; delta: number | null;
               differentReference: boolean }[];
  recovery: { encore: RecoveryState; static: RecoveryState };
}
```

Rules for the response:
- **Seconds.** `simSeconds` is `null` when the two `dtSeconds` differ.
- **Deltas.** `deltaNpwc` and `summaries[].delta` are numbers only for an eligible pair with both values numeric (as `pairedDeltas`, `report.ts:166-175`). For `tRec`, that means both arms recovered. A censored arm is shown by its state, never as a number.
- **Different reference formation (S5).** Each world is measured against the newest score one of its live drones believes ([contract §5](contracts-and-algorithms.md#5-world-events-snapshot-metrics)), so once Encore adopts the injected score the two arms' `npwc`, `coverage` and `sf*` describe different formations ([evaluation §4](../validation/evaluation-and-tests.md#4-baseline-fairness)). For a `NO_VERDICT` scenario the route sets `reference.fromTick` to the first sample at which the arms' `versions` key sets differ. From that tick, `deltaNpwc` is `null`, and the `npwc*`, `coverage*` and `sf*` summary deltas carry `differentReference: true`, shown as "different reference formation: not a like-for-like difference". The dashboard draws the arms side by side with `unadopted`, `adoptP50` and `tVersion`, and no delta line. `reportMarkdown` stays verbatim.
- **Alignment.** `alignment.complete = false` marks the comparison incomplete, even for a fair pair. It is still returned so the hole can be inspected (§7.4). Import completeness checks should already prevent this.
- **Statuses:** 200; 400; 404 with `path` naming the missing id; 422; 429; 503; 504; 500.
- **Bounds** follow §3.5. `afterTick` pages through the rows, while `alignment` always covers the whole run.

---

## 6. Multi-seed statistics

### 6.1 Principle

The statistics are those of `src/cli/report.ts`, **executed, not reimplemented** (William §9.3). That covers medians, IQR, paired deltas, W/T/L, exclusions, censoring, worst seed and S5. A second implementation would drift: it might drop censored `tRec`, change the quantile type, or give S5 a verdict.

### 6.2 Mechanism

1. **Select (Q24).** Choose the runs of one cell: scenario, `n0`, `git` and `paramsHash`, plus `compositionId` if given.

   ```sql
   -- Q24 PROPOSED (not executed). Candidate runs for one experiment cell.
   SELECT r.run_id, r.arm, r.seed, r.pair_key, r.composition_id, r.git_clean, r.events_digest,
          r.hash_version, r.expected_samples, r.telemetry_state, r.artifact_hash, r.imported_at,
          CASE WHEN lv.outcome IS NULL THEN 'not-checked'
               WHEN lv.outcome = 'verified' AND lv.series_digest = r.series_digest
                    AND lv.events_digest = r.events_digest AND lv.summary_digest = r.summary_digest
               THEN 'ok' ELSE 'mismatch' END                           AS table_verification,
          EXISTS (SELECT 1 FROM encore.import_conflicts c
                   WHERE c.existing_run_id = r.run_id OR c.experiment_key = r.experiment_key) AS contested
   FROM encore.experiment_runs r
   LEFT JOIN LATERAL (SELECT v.outcome, v.series_digest, v.events_digest, v.summary_digest
                      FROM encore.run_verifications v WHERE v.run_id = r.run_id
                      ORDER BY v.verification_id DESC LIMIT 1) lv ON true
   WHERE r.scenario = $1 AND r.n0 = $2 AND r.git_revision = $3 AND r.params_hash = $4
     AND ($5::text IS NULL OR r.composition_id = $5)
   ORDER BY r.seed, r.arm, r.run_id;
   -- hash_version, expected_samples and verification are classified in step 2, not filtered here,
   -- so that every excluded run is listed with its reason.
   ```

2. **Classify** the candidates against the **expected seed set**: seeds 1–5 for `matrix=minimum` (the default, the committed matrix) and 1–20 for `matrix=full` ([evaluation §5](../validation/tiger-data-evaluation.md), base [§5](../validation/evaluation-and-tests.md#5-procedure)). The set is a constant beside `pairReasons`, never a request parameter, so the endpoint still takes no seed list (T26). Every excluded run is listed with its reason, never dropped silently:
   - `DEV_SEED`: seeds 101–105, "development seed, not evidence" (base §5 step 1, `FX-DEV`);
   - `NOT_PREREGISTERED`: any other seed outside the expected set;
   - `COMPOSITION_UNKNOWN`: an unknown composition. Dirty runs cannot match a clean `git` filter;
   - `CONTESTED`: an `import_conflicts` row names the run or its `experiment_key` (ingestion RFC §10: out of comparisons until resolved);
   - `UNVERIFIED`: the run is not `verified` (§2.1): `table_verification` is `mismatch` or `not-checked`, or the step-3 recomputation differs. For an archived run the read check covers events and summary only (step 3);
   - `HASH_VERSION`: `hash_version` differs from the current one. One database holds one `hashVersion` (ingestion RFC §4.5), so this is a guard;
   - `HORIZON`: `expected_samples` differs from `expectedTicks / 5` (360 for every CLI scenario);
   - `COMPOSITION`: a seed whose two arms differ in `pair_key` only through `compositionId`; both are excluded, because the report cannot see composition and would otherwise count them as a pair.
   - **Ambiguity.** If one (seed, arm) still has more than one run, return 409 `AMBIGUOUS_SELECTION`, listing the competing `compositionId`s. `buildReport` would throw on such a duplicate (`report.ts:121`). CLI scenarios produce exactly one run per cell, so this arises only from other sources of composition.
   - **Archived runs are reported, not excluded.** `buildReport` reads only `summary`, `events`, `git`, `paramsHash` and the grouping keys, never `series`, all of which an archived run keeps. Excluding them would let a manual per-run archival remove seeds from the statistics. They are listed in `selection.archived`.
   - **Everything else goes to the report.** That includes seeds with one arm (`UNPAIRED`) and pairs that `fairPair` rejects (`MISMATCH`), so the per-arm medians match the CLI's.
   - **Shared event sets.** `selection.distinctEventSets` counts the distinct `events_digest` values per arm among the reported runs, and `selection.sharedEventSeeds` lists the seeds that share one. This is information, not an exclusion. In the committed matrix, S2 seeds 1 and 3 have the same kill set, so S2 has 5 seeds and 4 distinct kill sets (checked against `results/` on 2026-11-15; overview §2, TIG-R08). S0, S3 and S5 have one event set by design.
   - **Missing seeds.** Each expected (seed, arm) with no reported run goes in `selection.missing`, with `state: 'absent'` (no row: never imported, or rejected or conflicting at import, which only the local ledger records) or `'excluded'`. `selection.complete` is true only when `missing` is empty. A dropped seed silently rescales every "out of 20" pass line (`report.ts:198`), so an incomplete selection is shown with a banner and is never called a multi-seed result (§7.3).
3. **Reconstruct and verify.** Rebuild each `RunRecord` from Tiger with the ingestion RFC's re-read and recompute its `artifactHash`. An archived run is rebuilt with `series: []` and checked on `events_digest`, `summary_digest` and the metadata instead. A recomputed digest that differs moves the run to `UNVERIFIED` (step 2). If a run that passed both checks still does not rebuild to its `artifactHash`, return 500 `RECONSTRUCTION_MISMATCH` and produce no report, rather than a reduced one.
4. **Run the report, in process only.** TIG-D7 extracts `report.ts`'s statistics (with `canonicalJson`, TCR-16) into a pure module the gateway may import under XI-2, re-exported by `report.ts` so the CLI is unchanged. The gateway then calls `buildReport`, `npwcRows` and `stats` in process. **Until TIG-D7 is approved, the route answers 503 `PROVIDER_UNAVAILABLE` with `details[].reason = 'REPORT_NOT_ENABLED'`**, and the dashboard points to `results/RESULTS.md` and `npm run eval -- --report`. There is no subprocess path and no fallback: the `tiger` module never spawns a child process (§3.1). A report failure gives 500 `INTERNAL` with reason `REPORT_FAILED`.
5. **Respond** with the analysis, the Markdown, the selection and one provenance block per reported run.

Output mode follows TCR-17:
- **MVP, `markdown-plus-rows`.** `reportMarkdown` verbatim, plus `perSeed` from `npwcRows` and the per-arm `MetricStats` from `stats`. The gateway assembles the `Group` from the same records it passed to `buildReport` and builds the `stats` input exactly as `report.ts:237-240` does, because an absent key and a censored one must stay apart (TCR-25):
  - keys: `METRIC_ORDER` filtered to keys present in some record's `summary`, then the remaining present keys in default `sort()` order;
  - values per arm: `records.filter(r => key in r.summary).map(r => r.summary[key] ?? null)`, from the reconstructed `summary` object, never from `summary_json` columns or `t_rec_seconds`;
  - `censoredHigh` only for `'tRec'`, mirroring the private `CENSORED_HIGH`.

  Tests pin this against the Markdown: no `tRec` row for the S0, S3 and S5 groups, and static `tRec` printed `censored ×5` for S1. The fields marked † need private functions, so they carry the sentinel `{ unavailable: 'see-report-text' }`, never `null`, which already means "no value" (§7.3).
- **Later, `structured`.** The full `ScenarioAnalysis`, from the `analyseReport` export (§6.5), which should also export the per-key `stats` input so the mirror above disappears.

```ts
type Quantity = number | 'censored' | null;      // 'censored' = +Infinity from stats(values, true)
interface MetricStats { n: number; median: Quantity; q1: Quantity; q3: Quantity; nulls: number }   // = report.ts Stats
type Unavailable = { unavailable: 'see-report-text' };   // a † field in markdown-plus-rows mode: in reportMarkdown
type Dagger<T> = T | Unavailable;                          // every † field below is Dagger<its type>
interface ScenarioAnalysis {
  scenario: string; n0: number;
  seeds: { static: number; encore: number; fairPairs: number; mismatched: number; unpaired: number } | null;   // †
  perSeed: { seed: number; status: 'paired' | 'mismatch' | 'unpaired';
             static: SummaryCell; encore: SummaryCell; delta: number | null;
             verdict: 'WIN' | 'TIE' | 'LOSS' | null }[];                 // = npwcRows(group)
  winMargin: 0.02;                                                       // = WIN_MARGIN
  verdicts: { win: number; tie: number; loss: number; ofFairPairs: number;            // † ; null for a NO_VERDICT scenario
              noVerdict: { mismatched: number; unpaired: number; nullNpwcEnd: number } } | null;
  noVerdictReason: string | null;                                        // † NO_VERDICT[scenario]
  worstSeed: { kind: 'paired'; seed: number; delta: number }             // †
           | { kind: 'per-arm'; arms: { arm: 'static' | 'encore'; seed: number; npwcEnd: number }[] } | null;
  censoredTRec: Record<'static' | 'encore', { applicable: false } | { applicable: true; censored: number; of: number }> | null;  // †
  metrics: { key: string; censoredHigh: boolean; static: MetricStats; encore: MetricStats;
             medianPairedDelta: number | null; pairs: number | null }[]; // † on the last two; METRIC_ORDER, then extra keys A–Z
}
interface ExperimentComparisonResponse {
  query: { scenario: string; n0: number; git: string; paramsHash: string; compositionId: string | null;
           matrix: 'minimum' | 'full' };
  selection: { candidates: number; reported: number; expectedSeeds: number[]; complete: boolean;
               excluded: { runId: string; seed: number; arm: string;
                           reason: 'DEV_SEED' | 'NOT_PREREGISTERED' | 'COMPOSITION_UNKNOWN' | 'CONTESTED'
                                 | 'UNVERIFIED' | 'HASH_VERSION' | 'HORIZON' | 'COMPOSITION' }[];
               missing: { seed: number; arm: 'static' | 'encore'; state: 'absent' | 'excluded' }[];
               archived: string[];             // runIds reported from summary and events only
               distinctEventSets: { static: number; encore: number };   // COUNT(DISTINCT events_digest) per arm
               sharedEventSeeds: number[][] }; // groups of seeds whose runs share one events_digest
  analysis: ScenarioAnalysis;                  // † fields are Unavailable in markdown-plus-rows mode
  reportMarkdown: string;                      // buildReport output for exactly the reported records
  report: { generator: 'src/cli/report.ts'; codeGit: string; mode: 'structured' | 'markdown-plus-rows';
            inputDigest: string };
  provenance: Provenance[];                    // one per reported run, ordered by seed then arm
}
```

### 6.3 Field semantics

These are the exact `report.ts` meanings. Line numbers refer to 23d6748.

| Field | Meaning |
|---|---|
| `perSeed[].delta` | Encore − static on `npwcEnd`, for a fair pair with both values numeric (line 159) |
| `verdict` | `WIN` if Δ > +0.02, `LOSS` if Δ < −0.02, otherwise `TIE`. The inequalities are strict, so Δ = 0.02 exactly is a TIE. The verdict is `null` for a scenario with no verdicts (lines 27-31, 160) |
| `verdicts` | Counts of verdicts among the fair pairs; `noVerdict` splits the rest into mismatched, unpaired and null-`npwcEnd` seeds (lines 214-219) |
| `metrics[].static/encore` | Median and IQR (q1, q3: quantile type 7) over **all** records of that arm, paired or not. `n` excludes nulls, which are counted in `nulls`, except for `tRec`, where `n` includes censored seeds as +∞ (lines 60-66, 237-247) |
| `medianPairedDelta`, `pairs` | Median of the per-seed differences over fair pairs where both values are numeric. For `tRec`, only pairs where both arms recovered count (lines 166-175) |
| `worstSeed` | Lowest Δ `npwcEnd` among the pairs with a delta; ties go to the lowest seed. With no pairs, the lowest `npwcEnd` per arm (lines 220-232) |
| `censoredTRec` | Per arm, "k of m" records with a null `tRec`, among those that have the key; "not applicable" when none has it (lines 177-188) |
| `n` (everywhere) | Shown with every median. The pass lines in the evaluation doc, written "out of 20", scale to the number of fair pairs, as the report header says |

The dashboard displays verdicts **from the response**, never recomputed from rounded numbers. A Δ shown as `0.020` may be a WIN or a TIE.

### 6.4 Why the median of paired differences is not the difference of medians

Pairing cancels what the two arms share on a seed: the kill set, the events and the random stream. The median of the per-seed differences describes a typical seed's matched comparison. The difference of the two medians compares two *different* seeds, and its sign can even be the opposite.

**Illustrative numbers, not measurements.** Take three seeds with static `npwcEnd` 0.90, 0.95, 1.00 and Encore 0.99, 0.90, 0.96.
- The paired differences are +0.09, −0.05 and −0.04. Their median is **−0.04**, and the W/T/L count is 1 / 0 / 2.
- The medians are 0.96 for Encore and 0.95 for static, a difference of **+0.01**.

`report.ts` reports the paired form, so the dashboard does too (William §9.3). Where it shows both arms' medians, it labels them "per-arm median" and never subtracts them.

### 6.5 Structured output: proposed `src/cli` change (not a contract change)

In `markdown-plus-rows` mode the dashboard renders `reportMarkdown` beside the `perSeed` chart (§7.3). It never fills the † fields by computing them itself.

**PROPOSED `src/cli` CHANGE — needs the `src/cli` owner's sign-off (WP-7b, #26); it is not a contract change** (the "structured `analyse` later" step of TCR-17). It has two parts:
1. Split `report.ts` into `analyseReport(records): ScenarioAnalysis[]` and `renderReport(analysis): string`. `analyseReport` holds today's private grouping, deltas, censoring, `NO_VERDICT` and worst-seed logic, unchanged.
2. Make `buildReport(records) = renderReport(analyseReport(records))`.

No CLI flag is needed, because the gateway calls the functions in process (§6.2 step 4).

The correctness condition is that `buildReport` stays byte-identical on the 50 committed records and on the existing report tests.

### 6.6 S5 and other scenario rules

- **S5.**
  - `NO_VERDICT.S5` gives this rule: Δ is still shown per seed, `verdict` is `null`, `verdicts` is `null`, and `noVerdictReason` = "no win/tie/loss: static cannot adopt an injected score (capability difference, see `unadopted`)".
  - The worst seed and the metric table are still produced ([evaluation §3](../validation/evaluation-and-tests.md#3-scenarios); William §12).
  - The dashboard shows `unadopted`, `adoptP50`, `adoptMax`, `splitSec` and `tVersion` for S5, and never a W/T/L count.
  - S5's pre-registered pass line ([evaluation §3](../validation/evaluation-and-tests.md#3-scenarios)) is labelled per clause, and no pass or fail is computed for any clause:

    | Clause | Label |
    |---|---|
    | 1–2: adoption by `partitionSide` by tick 600; no adoption on the other side before tick 700 | "not derivable (needs `partitionSide`, which no record stores)" |
    | 3: one version at the end | "in the record; not evaluated by `report.ts`", linking the last sample's `versions` |
    | 4: median `tVersion` ≤ 10 s | the same label, linking the `tVersion` metric row |
    | 5: `dupSlotsEnd = 0` | the same label, linking the `dupSlotsEnd` metric row |
- **Pass lines in general.** `report.ts` computes no pass or fail result against the pre-registered lines, so neither does the API or the dashboard. The dashboard may quote a pass line's text with a link to the evaluation doc, never a verdict on it.
- **`tRec` for S0, S3 and S5.** These scenarios have no KILL, so `tRec` is not applicable and the report prints `n/a (no KILL)`.

### 6.7 Report equality, the principal correctness proof

The [evaluation §1.2](../validation/tiger-data-evaluation.md) is canonical for the definitions, which are not restated here:
- **E1:** record equality;
- **E2:** `buildReport(reconstructed) === buildReport(local)`, compared as exact strings;
- **E3:** anchoring to the committed `RESULTS.md` before its hand-written notes (TCR-07).

This route answers one cell, so it cannot produce the five-scenario report. The checks therefore split as the evaluation defines them:
- **E2-cell:** for each cell, `reportMarkdown` equals `buildReport` over every local record of that cell, unfiltered. When no exclusion fires (as with the 50 committed records), this also proves the selection is neutral.
- **E2-sel:** when exclusions fire, `reportMarkdown` equals `buildReport` over the cell minus the expected excluded set, and `selection.excluded` equals that set. The test writes the set; it never reads it back from the route.
- **E3:** through a gateway-internal function, not a route. It reconstructs every verified run of one `(git, paramsHash)`, here all 50, and calls `buildReport` once.

Record order does not matter: reversing the input gives identical output. Archived runs are reported, not excluded (§6.2 step 2), so they stay in the E2-cell set. For an archived run, E1 compares everything but `series`; E2 still holds, because `buildReport` never reads `series`. In structured mode, `renderReport(analysis)` must also equal that string.

The tests are TIG-T17–T19 and T22, and **none has been executed**.

---

## 7. Dashboard

### 7.1 Placement (TIG-D3)

| Option | Fits the design system | Build impact | Contention | Assessment |
|---|---|---|---|---|
| **A.** Separate Vite page `analytics.html` plus `src/analytics/` | Imports `src/app/ui/styles.css`, `dom.ts`, `icons.ts` | `vite.config.ts` needs `build.rollupOptions.input` (owner sign-off); the default build stays network-free | Low: new files only | **Recommended** (William §10) |
| **B.** A view inside the #113 app shell | Native | None | High: `main.ts`, `worlds.ts` and `src/app/ui/*` are contended by #113, #148, #127 and #126; at 23d6748 a module in `src/app/ui/` that exports `createPanel` auto-mounts into the 3D app, and at c697f6c nothing calls that loader, but it is still a trap (TCR-18, §1.2) | Not recommended; it would also compete with the 3D view for frame budget |
| **C.** Dev-server-only page | Same as A | None (`vite build` does not emit it) | Low | Fallback only: absent from the demo build |

This RFC recommends A, as William does. The decision is TIG-D3, with Arnav and the build-config owner (TCR-09, TCR-18).

The HTTP client lives in `src/app/live/analytics/`, inside the one confined app-side network folder `src/app/live/` (XI-14; [boundaries §6.2](OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard)). It talks to the gateway over X-RUN/live ([boundaries §6.1](OPTIONAL_INTEGRATION_BOUNDARIES.md#61-x-runlive-provisional-d3-gated)), which returns read-only analytics data for display only. The stored evidence it reads is X-PERSIST (experiment evidence). Both are cited as X-RUN/live and X-PERSIST (provisional, #110). The client sits behind the module's own build-time, non-secret boolean flag, off by default and constant-folded, so the default build contains no network path. `src/analytics/**` holds the local client, view models and charts, and has no network API: an ESLint ban covers `fetch`, `WebSocket`, `XMLHttpRequest` and `EventSource` there (TIG-08). With the flag off, the page:
- makes zero requests;
- offers only local-artifact mode;
- passes NFR-04's acceptance check unchanged ([requirements](../specification/requirements.md)).

Fixture mode exists only under `import.meta.env.DEV`, so `vite build` emits no fixture loader or fixture data, and a check greps the production bundle for the fixture marker. Acceptance screenshots (T44 step 10) are never taken in fixture mode.

The page imports neither `three`, the simulation nor `src/cli`. It may call the gateway while a simulation runs elsewhere, but it is never part of a tick loop or a decision path, and nothing it receives reaches a drone (XI-5).

### 7.2 Design system reuse

- **Tokens and components** from `src/app/ui/styles.css`:
  - `.surface` and `.panel-head`;
  - `.eyebrow`;
  - `.seg` for toggles;
  - `.field`, `.input`, `.hint`, `.hint.warn` and `.hint.err`;
  - `.btn` and `.btn.danger`;
  - `.tag`.

  The page overrides the 3D app's `body { overflow: hidden }` so the document can scroll.
- **Helpers** from `dom.ts`: `h()`, `esc()` for database text, `fmt()` (which prints `—` for null) and `fmtTime()` (§2.3). Icons come from `icons.ts`.
- **Precision.** `fmt()` defaults to 2 decimals, which would print `npwc = 0.946` as `0.95`, apparently at the threshold. `npwc`, `pwc` and `coverage` are therefore always printed with `fmt(v, 3)`, as `report.ts` does, with the raw value in a `title` and copy affordance. Threshold facts ("meets 0.95") are computed from the raw value, never from the printed string.
- **A provenance badge on every chart and panel.** It always names the source in words; colour is never the only signal.

  | `source` | Tag | Text |
  |---|---|---|
  | `tiger`, `verification = 'verified'` | `.tag.main` | "Tiger Data · verified copy" |
  | `tiger`, `verified-at-import` (selector rows only) | `.tag.main` | "Tiger Data · verified at import; checked again when opened" |
  | `tiger`, `mismatch` or `verified-without-series` | `.tag.main` + `.hint.warn` | "Tiger Data · imported, not verified" (with the reason) |
  | `tiger`, `not-checked` | `.tag.main` + `.hint.warn` | "Tiger Data · imported, verification not yet run" |
  | `tiger`, contested or archived | `.tag.main` + `.hint.warn` | "Tiger Data · identity contested" / "· telemetry archived" |
  | `tiger`, held while health reports `db: 'down'` | `.tag.main` + `.hint.warn` | "Tiger Data · cached at hh:mm · not current"; `verified` shown as false |
  | `gitClean = false` (any source) | `.hint.warn`, added | "Dirty or unknown revision · weaker reproducibility evidence", on every chart and selector row (T09) |
  | `local-artifact` | `.tag.obs` | "Local file · not a database query" |
  | `live-provisional` | `.tag.later` | "Live · provisional" |
  | `fixture` | `.tag.proto` | "Illustrative fixture · not a measurement" |

- **Encoding.** The chrome stays achromatic, and no new hex values are added. Every pair below still differs without colour (§7.5).

  | Element | Encoding |
  |---|---|
  | Arm | Encore solid `--ice`; static long-dash `--text-2`. One stroke pattern per arm everywhere |
  | Live provenance | reduced opacity and a "LIVE" end label, never dashes |
  | 0.95 threshold | thin solid `--text-3` line with an inline text label |
  | `KILL` | vertical `--danger` line with a ▼ marker and text |
  | `JAM`, `PARTITION` | `--jam` and `--partition` bands with different hatch angles, each with text |
  | `INJECT_SCORE` | `--score` marker with its version |
  | Censored | `--text-2` text with the word "censored", not the warning colour (`--transit` is `.hint.warn` and "in transit" in the 3D app) |
- **Charts** are inline SVG from a small `src/analytics/chart.ts`. No dependency is added; a charting library would need approval.

### 7.3 Views

**Run selector.**
- **Filters:** scenario, seed, arm, git revision (with a clean/dirty indicator), `paramsHash`, composition, `n0`, import status (present, archived or conflict) and "include dirty revisions" (off).
- **Pairing.** Choosing an Encore run proposes the static run with the same `pairKey`. Every other static run is listed with its rejection reasons in text, from `pairReasons` over the listed `RunMeta` (§4.1), with no request per candidate.
- **Unfair pairs.** An unfair pair is **blocked by default**: Compare is disabled and the reasons are listed. "View anyway (not a fair comparison)" (`.btn.danger`) requests `allowMismatch=true`. A persistent warning banner then names the reasons, and every delta is hidden.

**Single-seed caption.** The recovery timeline and every pair view carry a persistent caption: "Single seed: not a result. See the multi-seed summary" ([evaluation §5](../validation/tiger-data-evaluation.md), T37).

**Recovery timeline.** These small multiples share one tick axis, labelled with simulated seconds:
1. `npwc` for both arms, with the threshold line at **0.95** labelled "recovery threshold; tRec = start of the first 12 consecutive qualifying hold samples".
2. `alive` as a step line.
3. `coverage`.
4. `sfMax` (with `sfMean`), in metres.

`npwc` is never shown without `alive`, `coverage`, `sfMean` and `sfMax` beside it (William §3, TIG-R01; the `report.ts` header): a high `npwc` with fewer survivors does not mean the original formation was restored, and `npwc` cannot see where the holes are ([evaluation §3](../validation/evaluation-and-tests.md#3-scenarios)).

**Y-axis domains** are fixed, never auto-scaled:
- `npwc` and `coverage` use [0, 1], allowing the 1e-15 overshoot (`pwc = 1.0000000000000004`). An optional zoom is labelled on the axis ("y-axis zoomed: 0.80–1.00") and is never the default.
- `alive` uses [0, `n0`], so capacity loss stays visible (TIG-R11).
- `sf*` and every counter use one scale shared by both arms; any panel that shows both arms uses one scale.

On these charts:
- **NULLs are gaps.** A missing tick gets a "missing sample" mark.
- **Failure markers** come from `simulation_events` and are captioned "scheduled environment events":
  - `KILL` is a line labelled "KILL · k drones";
  - `PARTITION` and `JAM` are shaded ON–OFF intervals matched by `id`;
  - `INJECT_SCORE` is labelled with its version, and `SET_LOSS` with its value.
  - When `events.identical` is false (an overridden pair), each arm's markers go on their own labelled strip, with the warning "the two runs have different event schedules".
- **First qualifying 12-sample streak (2.75 s)**, drawn only for `tRec > 0` and derived only from the authoritative `tRec`. Each arm gets its own labelled strip under the `npwc` chart in that arm's stroke pattern ("Encore: first qualifying streak from 12.25 s", "Static: not recovered, or not measurable: censored"), so two bands never overlap:
  - `streakStartTick = killTick + round(tRec / dtSeconds)`, which must be a sample tick; otherwise there is an integrity warning.
  - The band spans `[streakStartTick, streakStartTick + 12 × sampleTicks)`: 12 samples at 0.25 s per sample. The first and last samples in it are 2.75 s apart (William §7).
  - It is not a "sustained recovery interval". `summary.ts:75` returns at the first such streak and never looks later, so `npwc` may fall below 0.95 afterwards, and later dips are not measured. The end state is `npwcEnd`, not `tRec`.
  - The label reads "tRec = x s (start of the first qualifying streak; includes suspicion, contention and flight time, not detection latency)" ([evaluation §8](../validation/evaluation-and-tests.md#8-bias-risks-and-reporting-wording)).
- **The recovery states** are always stated in text, with the overview §6.5 wording:

  | State | Display |
  |---|---|
  | Recovered (`tRec > 0`) | The band and the label |
  | `tRec = 0` (`tRecZero: true`) | **No band.** The text "tRec = 0: either every post-kill hold sample had npwc ≥ 0.95 (`summary.ts:60`) or a 12-sample streak began at the kill tick (`summary.ts:75`); the record cannot tell which." Never "Recovered after 0 s" |
  | Censored | `--text-2` text: "Not recovered, or not measurable (no hold sample after the kill): censored" |
  | Not applicable | "No kill: recovery not measured" |

- **Hold windows are not drawn.** They are not stored (TIG-CC-01, a PROPOSED CONTRACT CHANGE — REQUIRES ARNAV APPROVAL, deferred; defined in the overview). A caption says "points at or above 0.95 outside the band are not recovery: they may be transient or inside a transition".

**Coordination costs.** A `.seg` toggle switches between **cumulative totals** and **per-interval change**. The y-axis title says which is shown, with the interval: "change per 5-tick sample interval (0.25 s)".
- **Gaps.** A `spansGap` interval is drawn hatched with a "spans k missing samples" marker, never as a normal bar. The first interval is marked "since run start".
- **Per second** is an optional mode, dividing by `intervalTicks × dtSeconds`, labelled "approximate" (§2.4 rule 5).
- **Messages:** broadcasts (`hb`, `score`) on one chart, receiver outcomes (`delivered`, `lost`, `blocked`) on another.
- **Duplicate slots:** `dupSlots`, a gauge, so it has no delta mode.
- **Instability:** `slotChanges`, `collisions` and `nearMisses`.
- **Authoritative totals.** The summary's `collisions`, `nearMisses`, `slotChanges`, `msgsPerDroneSec` and `deliveryRatio` appear beside the charts as the authoritative values. A mismatch with the last sample raises an integrity warning.
- **Captions** state that collision counts are lower bounds at 20 Hz sampling ([evaluation §8](../validation/evaluation-and-tests.md#8-bias-risks-and-reporting-wording)), and that static sends no messages by design.

**Experiment summary panel**, from §6, one panel per scenario cell:
- seed counts, with the distinct event sets per arm when they are fewer than the seeds ("S2: 5 seeds, 4 distinct kill sets") and the seeds that share one (§6.2);
- the per-seed table: seed, static, encore, Δ, and verdict, `MISMATCH` or `UNPAIRED`, with losses kept and marked;
- the W/T/L line with the ±0.02 rule, or, for S5, the no-verdict reason. For S2, the paired Δ of `sfMaxEndA` sits beside it, captioned "the regional-kill claim is carried by `sfMaxEndA`, not by `npwc`" ([evaluation §3](../validation/evaluation-and-tests.md#3-scenarios));
- the worst seed;
- censored `tRec` per arm, which is the primary `tRec` comparison. The `tRec` median Δ is captioned "k of m fair pairs; m − k excluded because at least one arm is censored", and "—" there means "no pair where both recovered", not "no difference";
- the metric table of per-arm median [IQR] (n) and median Δ (k pairs);
- the exclusions with reasons, and the missing seeds;
- when `selection.complete` is false, a `.hint.warn` banner "Incomplete selection: k of m pre-registered seeds; not a multi-seed result", and the panel never uses the words "multi-seed result";
- a footer: "computed by `src/cli/report.ts` at `<codeGit>` over the reconstructed, verified records; equality with the CLI report is tested by TIG-T18/T19". The route does not check that equality at run time, so the footer never claims it (evaluation §1.2).

In `markdown-plus-rows` mode, each † item reads "In the report text below (computed by `report.ts`)", never "—", blank or 0. `reportMarkdown` is rendered by a small, tested, dependency-free converter in `src/analytics/` that turns its pipe tables into `<table>` with `<th scope="col">` and keeps `**…**` as `<strong>`, so `LOSS` and `MISMATCH` stay marked for screen readers. A "Copy raw Markdown" button gives the verbatim text.

**Provenance panel**, per run:
- `source`, `verified`, and import time (labelled as real ingestion time);
- `artifactHash`, `experimentKey`, `pairKey`, `stateHash` and `run_id`, shortened, each with a copy button;
- `git` with clean/dirty, `paramsHash` and `compositionId`.

It ends with the statement: "The local `RunRecord` file and the CLI report are the authoritative evidence; this database holds a verified copy". It links to `results/RESULTS.md` for the committed matrix.

**Optional time-series view (Q26).** This is a demonstration of a time-series function only. At 360 rows per run it adds no analytical value (William §6.2, §11), and it never replaces Q18.

```sql
-- Q26 PROPOSED (not executed; time_bucket with an origin argument UNVERIFIED on the service).
-- A min/max envelope, not an average: AVG would hide NULLs and transitions.
SELECT time_bucket(INTERVAL '1 second', m.sample_time, TIMESTAMPTZ '2020-01-01 00:00:00+00') AS bucket,
       MIN(m.tick) AS first_tick, MAX(m.tick) AS last_tick, COUNT(*) AS samples, COUNT(m.npwc) AS npwc_samples,
       MIN(m.npwc) AS npwc_min, MAX(m.npwc) AS npwc_max, MIN(m.alive) AS alive_min
FROM encore.simulation_metrics m
WHERE m.run_id = $1
GROUP BY bucket ORDER BY bucket;
-- "1 second" equals 20 ticks only under the 50 ms tick-to-time mapping; label the axis by first_tick.
```

### 7.4 States

| State | Trigger | Display | Actions |
|---|---|---|---|
| Loading | A request is in flight | Skeleton panels with `role="status"` "Loading runs…"; the previous chart stays visible but dimmed | Cancel |
| Empty | 200 with no items | "No runs match these filters" and the active filters | Clear filters |
| Database unavailable | 503 `DATABASE_UNAVAILABLE`, 504, or health `db: 'down'` | "Tiger Data is unavailable. Nothing shown here comes from the database." Data loaded earlier stays only with the badge "Tiger Data · cached at hh:mm · not current" and `verified` shown as false (§7.2); it is never badged as a current Tiger copy (T40) | Retry; Open local files |
| Multi-seed not enabled | 503 `PROVIDER_UNAVAILABLE` with reason `REPORT_NOT_ENABLED` | "Multi-seed statistics need TIG-D7. Authoritative report: `results/RESULTS.md`" | — |
| Module disabled / flag off | 503 with reason `MODULE_DISABLED`, or a build without the flag | "Database analytics are not enabled in this build" | Open local files |
| Local-artifact fallback | The operator opens `RunRecord` files (file picker, no network) | Every badge reads "Local file · not a database query". Per-run charts work. Fair pairing and statistics need `report.ts` in the browser, which needs the canonical-JSON extraction (TCR-16, TIG-D7). Until then: "Not available in local mode; authoritative report: `results/RESULTS.md`" | — |
| Archived telemetry | `telemetryState: 'archived'` | "Telemetry archived; summary and events kept; the owner can restore it from the local artifact (ingestion RFC Q16b)". Not shown as zero measurements | Copy run id |
| Incomplete import | `alignment.complete = false` or `completeness.missingTicks` non-empty; in local mode, a ledger state of `incomplete` | A `.hint.warn` banner naming the missing ticks | Copy run id |
| Conflict | `contested: true` or a `conflicts[]` entry | Contested runs are marked and kept out of deltas and statistics (§4.1, §6.2); rejected artifacts are listed, not selectable: "Same experiment identity, different artifact: not imported" | Copy hashes |
| Integrity failure | `counters.check = 'decreasing'` or `summary.integrity` non-empty | `.hint.err` naming the check; the affected view is not drawn | — |
| Unfair comparison | 422 `VALIDATION_FAILED` whose `details[].reason` values are §4.2 reasons | The blocked state with the reasons (§7.3) | View anyway |
| Censored | `recovery.state = 'censored'` | As in §7.3; counted in the summary panel, never dropped | — |
| Not applicable | `recovery.state = 'not-applicable'`, or a NO_VERDICT scenario | "Not applicable" with the reason, never `0` and never blank | — |
| Illustrative fixture | Fixture mode, dev server only (§7.1) | A `.tag.proto` badge on every element, a page-wide banner, and no mixing with real runs in one chart | Exit fixture mode |

### 7.5 Accessibility

- **Text equivalents.** Each chart is an `<svg role="img">` with `aria-labelledby` (its title) and `aria-describedby` (a generated text equivalent).
  - The text gives, from the raw data only: arms, tick range, minimum `npwc`, threshold facts ("k of 360 samples at or above 0.95; first at tick t"), recovery state and `tRec`, events, and missing samples.
  - A sample value is never labelled with a summary key name. The end state reads "last sampled `npwc` at tick 1800: x (a sample, not the summary)", then "`npwcEnd` (observer summary): y".
  - It makes no evaluative claim.
- **Data table.** A "Show data table" toggle (`.btn.small`) reveals a `<table>` with `<th scope>` headers: the same rows at 3 decimals, a "meets 0.95" column computed from the raw value, the provenance and `—` for NULL.
- **Not colour alone.** Line style, marker shape and text labels distinguish arms and events.
- **Announcements** use `role="status"` or `aria-live="polite"`, as `Hud.ts` and `Console.ts` do.
- **Controls** are native, keyboard-reachable buttons and inputs, with the stylesheet's focus styles.
- **Numbers** are tabular `--mono`.
- **Motion.** `styles.css` honours `prefers-reduced-motion`, and charts do not animate.

### 7.6 Live telemetry (stretch, TIG-11)

Live telemetry is provisional by construction. **No accepted boundary covers it.** [X-OUT](OPTIONAL_INTEGRATION_BOUNDARIES.md#4-x-out-telemetry-export) is an offline file writer, and [X-RUN/live](OPTIONAL_INTEGRATION_BOUNDARIES.md#61-x-runlive-provisional-d3-gated) allows only operator-initiated requests with no world state per tick. TIG-11 needs a proposed **X-OUT/live** amendment to the #110 boundaries doc, recorded there as an open question ([OIB-Q5](OPTIONAL_INTEGRATION_BOUNDARIES.md#13-open-questions), not accepted), and D3, approved per integration (= TIG-D1; XI-21), must name it explicitly (provisional, #110). It also needs the live write-auth decision TIG-D13 (overview). Until both, TIG-11 cannot be approved.

The proposed shape ([TIG-11](../planning/tiger-data-integration-work-packages.md)):
- **Sender.** `src/app/live/telemetry/`, behind the module's build flag. `offer()` runs once per rendered frame, after all `stepBoth()` calls, and takes a synchronous slice. Sending is fire-and-forget into a bounded queue that drops and counts. It never runs in the tick loop.
- **Write route.** A separate gateway process, the second entry point `integrations/gateway/src/tiger-live/server.ts` of the same package, built on the shared skeleton and allowed only if OIB-Q5 is accepted (XI-20), with its own credential `TIGER_LIVE_WRITE_URL` and an INSERT-only role on a staging table, never `simulation_metrics`. The read-only API process refuses to start if that credential is set (§3.1).
- **Identity.** Staging rows are keyed on (`streamId`, `arm`, `seq`). `streamId` is a per-session id from the exporter, new on every build or reset. X-OUT's `runId` is only a label. When the final app `RunRecord` is imported and verified, the importer records `streamId` → (`experimentKey`, `run_id`), which is the link the "live and batch differ" view needs.

Rules for showing it:
- **Labels.** Live series carry `live-provisional` and `verified: false`, and are drawn at reduced opacity with a "LIVE" end label, keeping their arm's stroke pattern (§7.2).
- **Gaps.** `seq` gaps and `footer.dropped`/`truncated` are shown as counts ("k samples dropped").
- **No authoritative values.** No `tRec`, summary, verdict or band is derived from live data. The panels say "available after the final record is imported and verified".
- **Never complete.** A stream is never called complete. The verified `RunRecord` replaces it once imported, matched through the `streamId` link. Any disagreement between the two is reported ("live and batch differ at k ticks").
- **Exporting from the app is new work.** The app has no `RunRecord` export today (TCR-26), and the MVP reads `RunRecord` files, not X-OUT (TCR-32).

### 7.7 What the dashboard must never display

1. Illustrative or fixture values as measured, including William's example chart values; fixtures and real runs in one chart.
2. A summary value recomputed from samples (for example, `AVG(npwc)` over ticks 1700–1799) in place of `summary_json`.
3. A `tRec` aggregate that leaves out censored runs, or that is shown without its censored count.
4. `0` or an interpolated value in place of a NULL or a missing sample.
5. Deltas for an unfair, overridden, archived, dirty, contested or unverified pair; an S5 delta across different reference formations presented as like-for-like.
6. W/T/L for S5; pass or fail on a pre-registered line; a verdict or threshold fact recomputed from rounded numbers; an incomplete seed selection called a multi-seed result.
7. A cumulative total labelled as per-interval; broadcasts and receivers on one axis.
8. `sample_time` as a date or time of day.
9. Non-Tiger data, or Tiger data held while the database is down, with current-Tiger wording; a live stream presented as complete.
10. `npwc` without `alive`, `coverage`, `sfMean` and `sfMax`; `tRec` called "detection latency".
11. Credentials, hosts or raw driver errors.

---

## 8. Planned checks (none executed)

The [evaluation](../validation/tiger-data-evaluation.md) is canonical for the tests' IDs and pass conditions. They all use the committed records as fixtures. **Nothing here has been run.** The tests this RFC relies on are:

| Tests | What they cover |
|---|---|
| TIG-T17–T19, T22 | Reconstruction and report equality (§6.7) |
| TIG-T20 | Pair rejection and equivalence with `fairPair` (§4) |
| TIG-T21 | Full outer alignment (§5) |
| TIG-T23 | Censoring and the three recovery states (§2.5) |
| TIG-T24, T25 | Deltas and time semantics (§2.3–§2.4) |
| TIG-T26 | Frozen revision (§3.6) |
| TIG-T30, T33, T34, T36 | No path back to drones; parameterised SQL; bounds; exposure |
| TIG-T37–T40 | Provenance, blocked pairs, recovery display, degraded states (§7) |
| TIG-T43 | Q17–Q26 on the provider: `?`, `jsonb_typeof`, `FULL OUTER JOIN` on the hypertable, `time_bucket` with an origin |

Cases this RFC asks the evaluation to add to those tests (the evaluation owns their wording):
- **T13:** a sample changed after commit gives `verification: 'mismatch'`, `verified: false`, a changed badge, and the run is excluded from pairs. A committed run with no `run_verifications` row (case G) gives `not-checked` on every route; with a `verified` row it gives `verified-at-import` on the list and `verified` on the metrics route.
- **T19/T22:** `FX-50` gives `distinctEventSets` 4 per arm for S2 and 5 for S1, with S2 seeds 1 and 3 in `sharedEventSeeds`; `FX-50` minus both arms of one S2 seed gives `missing` and `complete: false`; `FX-DEV` is excluded as `DEV_SEED`; after `FX-CONFLICT`, the S2 seed-1 Encore run is excluded as `CONTESTED`; an archived run is still reported and E2 holds; the `stats` input mirror (§6.2).
- **T20:** `pairReasons` gives the same reasons in the gateway and the UI; `CONTESTED`, `UNVERIFIED`, and the archived 200 response.
- **T34:** seed 4 294 967 295 in the filter and the cursor; the per-route budgets and the 2 s pool timeout; archiving a run then re-requesting it gives 200 with `samples: []` (no cached state).
- **T37–T40:** the single-seed caption; the dirty badge; `npwc = 0.9496` printed `0.950` and not meeting 0.95; fixed y-domains; per-arm bands, drawn only for `tRec > 0`, and the two-cause `tRec = 0` text with no band; gap-spanning intervals; the "cached · not current" badge; † items in `markdown-plus-rows` mode; no fixture loader in the production bundle.

## 9. Open points for Arnav

1. **TIG-D3 placement.** Option A needs a `vite.config.ts` entry, with the build-config owner's sign-off.
2. **TIG-D7 and TCR-17.** Approve extracting `report.ts`'s statistics into a pure module the gateway may import (XI-2) and, later, the `analyse` split (§6.5). TIG-D7 is a hard prerequisite of the multi-seed route, which answers 503 `PROVIDER_UNAVAILABLE` (`REPORT_NOT_ENABLED`) until then. There is no subprocess fallback (§6.2 step 4).
3. **Rejected artifacts are invisible to readers.** Validator rejections never reach Tiger, so `selection.missing` can say only `absent`. An append-only `encore.import_attempts` table (hashes, reason code, no payload) would let readers tell "never imported" from "rejected"; it is ingestion-RFC DDL.
4. **Archived runs in the statistics.** Resolved by [overview §6.6](../integrations/tiger-data-analytics.md#66-pairing-and-statistics) and TIG-FR-10: they are reported from summary and events, not excluded (§6.2 step 2). Refusing the whole cell (409) while any candidate is archived was the rejected alternative.
5. **Expected seed sets.** `matrix=minimum|full` (seeds 1–5 or 1–20) is a constant here. Confirm whether it should instead come from a committed pre-registration manifest.
6. **Shared envelope.** This RFC maps its causes onto XI-3 codes and adds `db` to `modules.tiger` in `/api/health` (§3.1). It also uses 422 for `VALIDATION_FAILED` on unfair pairs, where the `shows` module uses 400.
