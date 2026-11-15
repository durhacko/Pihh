> **Source handoff, preserved unmodified below this banner.** Author: William Pimentel (`wpimento`). Received Sun 15 Nov 2026 01:12 GMT as `Encore_Tiger_Data_Technical_Plan.md`; added to the repo by Arnav's orchestrator under issue #142. This is William's **source proposal**: its SQL, services, routes, importer and dashboard are not implemented, and its "existing repository" facts were checked against an earlier uploaded snapshot (`Pihh.zip`), not necessarily current `main`. The canonical, reconciled specification is [`../integrations/tiger-data-analytics.md`](../integrations/tiger-data-analytics.md); where the two differ, its conflict records explain why. Nothing below this line has been edited.

---

# Encore × Tiger Data — Technical Architecture and Implementation Plan

**Status:** Proposed design; not an implemented integration  
**Scope:** Tiger Data time-series telemetry, MongoDB Atlas experiment metadata, Gemini composition generation  
**Source:** `Pihh.zip` repository and the detailed design discussion  
**Goal:** Make Encore's simulated swarm resilience measurable, reproducible, auditable, and comparable against a static baseline.

> **Evidence boundary:** Repository behavior described as *existing* was checked against the uploaded source, particularly `src/contracts/metrics.ts`, `src/observer/summary.ts`, and `package.json`. SQL, services, API routes, ingestion workflows, and dashboards in this document are **proposals**, not currently working features. Example chart values are illustrative, not experiment results. Provider-specific Tiger Data syntax and account limits must be confirmed in the provisioned environment.

## 1. Executive summary

Encore is a decentralized drone-show simulation. Tiger Data should become its **telemetry and experiment analytics engine**, not a central coordinator. The objective is to show whether Encore repairs formations after failures, how long repair takes, and what it costs in messages, collisions, and instability.

The full product flow is:

```text
Gemini prompt → validated composition recipe → Encore simulator
                                               │
                           read-only observer ─┤
                                               ▼
                                  deterministic RunRecord
                                               │
                               local immutable JSON artifact
                                               │
                                     telemetry importer
                                               │
                        ┌──────────────────────┴────────────────────┐
                        ▼                                           ▼
             Tiger Data / PostgreSQL                       MongoDB Atlas
          samples, events, summaries                  composition, run catalog
                        └──────────────────────┬────────────────────┘
                                               ▼
                                Resilience analytics dashboard
```

**Four invariants:**

1. Agent decisions use only local simulation state and permitted radio messages; no cloud telemetry may drive drones.
2. The same inputs, events, seed, code and parameters must produce the same deterministic simulation record.
3. Simulation and local reporting work without Gemini, Tiger Data or MongoDB.
4. The UI distinguishes measured, missing, censored, provisional, and illustrative values.

### What we want to demonstrate

- Formation quality before, during and after drone failures.
- Sustained recovery, not merely a transient threshold crossing.
- Encore versus static baseline under matched scenario, seed, initial population, code, parameters, and event schedule.
- Communication overhead, slot contention, collisions and near misses.
- Repeatability across seeds and visibility into unsuccessful runs.
- Actual persisted time-series queries, not just a JSON chart with a Tiger Data logo.

**Critical caveat:** The analytics platform provides evidence about the simulation; it does not improve the underlying swarm algorithm or prove real-world drone safety.

## 2. Existing repository: integration points

| Existing source | Role |
|---|---|
| `src/contracts/metrics.ts` | `MetricsSample`, `RunRecord`, `Observer` interfaces |
| `src/observer/measure.ts` | Observer measurements |
| `src/observer/summary.ts` | Recovery and summary definitions |
| `src/cli/run.ts` | Deterministic run construction |
| `src/cli/main.ts` | Evaluation CLI and JSON output |
| `src/cli/report.ts` | Paired evaluation report |
| `src/contracts/world.ts` | Environment events and world snapshots |
| `src/app/ui/Hud.ts` | Existing live simulation UI |

The checked `MetricsSample` contract contains:

```ts
interface MetricsSample {
  tick: number;
  alive: number;
  coverage: number;
  pwc: number;
  npwc: number | null;
  sfMean: number | null;
  sfMax: number | null;
  dupSlots: number;
  versions: Record<string, number>;
  msgs: {
    hb: number;
    score: number;
    delivered: number;
    lost: number;
    blocked: number;
  };
  collisions: number;
  nearMisses: number;
  slotChanges: number;
}
```

One sample is returned every **five simulation ticks**. Message, collision, near-miss and slot-change counters are **cumulative**.

The checked `RunRecord` is:

```ts
interface RunRecord {
  v: 1;
  git: string;
  paramsHash: string;
  scenario: string;
  arm: 'encore' | 'static';
  seed: number;
  n0: number;
  events: EnvEvent[];
  series: MetricsSample[];
  summary: Record<string, number | null>;
  stateHash: string;
}
```

The record does **not** include a dedicated run UUID, Gemini prompt ID, generated composition ID, per-sample `inHold`, individual drone positions, or a cloud ingestion status. Those require an external manifest or a versioned contract change.

`src/observer/summary.ts` confirms `DT = 0.05` seconds per simulation tick (20 Hz), sampling every 5 ticks (4 Hz), and a 12-sample sustained recovery threshold. Its summary uses hold-only windows at ticks 800–899 and 1700–1799. Avoid recalculating those summaries from unqualified database averages.

The package currently provides `npm run eval` via `tsx src/cli/main.ts`, plus typecheck, lint, tests and build. Cloud persistence is **not** part of the checked dependencies.

## 3. Objectives and evidence standards

### Scientific objective

Test whether Encore's decentralized repair achieves better post-failure formation quality than a static assignment baseline without unacceptable additional communication or movement-related instability.

### Engineering objective

Store, query and audit historical experiments without making the simulator dependent on network availability.

### Sponsor-integration objective

Use Tiger Data for genuine time-series persistence and server-side queries. Use MongoDB for composition/configuration documents and run catalog metadata. Use Gemini for authoring validated composition recipes, not as a runtime drone brain.

### Main dashboard questions

1. What was the formation quality (`coverage`, `pwc`, `npwc`, `sfMean`, `sfMax`)?
2. Was recovery sustained, and what was authoritative `tRec`?
3. What communication and instability costs accompanied repair?
4. Were comparisons fairly paired and reproducible?

`npwc` measures quality relative to surviving capacity. A high `npwc` with fewer surviving drones **does not** mean the original formation is fully restored. Always show `alive`, `coverage` and `npwc` together.

## 4. Operational architecture

### 4.1 Mandatory: post-run batch ingestion

```text
Headless CLI → RunRecord → immutable local JSON → validate/hash
                                                   ↓
                                          normalize records
                                                   ↓
                                      Tiger SQL transaction
                                                   ↓
                                       verify imported rows
                                                   ↓
                                    MongoDB catalog upsert
                                                   ↓
                                       mark import complete
```

This is the recommended first implementation. Network latency and database failures cannot change simulation results. Original JSON is the canonical evidence, and uploads can be retried.

### 4.2 Optional: live ingestion

```text
Browser simulation → read-only observer → bounded buffer
                                      → HTTP telemetry API
                                      → Tiger Data
                                      → analytics polling/SSE
```

The browser's local HUD should still use local observer data. Live cloud measurements are provisional until a complete `RunRecord` is verified. Bounded queues must have explicit backpressure behavior: stop export, spill to durable local storage where available, or drop samples with a visible loss count. **Never silently claim a partial live stream is complete.**

### 4.3 Dependency boundary

Permitted: `Simulation → Observer → Export → Database`.  
Prohibited: `Database → Agent decision`, including querying Tiger Data for slot assignments.  
Gemini must generate a composition *before* execution, and its output must pass validation before entering the simulation.

## 5. Data ownership and identity

| Information | Authoritative owner |
|---|---|
| Prompt, composition recipe, version, scenario configuration | MongoDB Atlas |
| Scenario/seed/arm and code/config identity | Run artifact; indexed in both systems |
| Time-series metrics | Tiger Data |
| Scheduled environment events | Original artifact; queryable copy in Tiger Data |
| Observer-produced summary values | Original artifact; queryable copy in Tiger Data |
| Original deterministic `RunRecord` | Local immutable artifact storage |
| Import status and artifact checksum | Import manifest / MongoDB catalog |
| Individual positions | Not in initial integration; optional later |

Use two identities:

```text
experiment_key = SHA256(canonicalized scenario, seed, arm, n0,
                        git, paramsHash, events, composition/config identity)
artifact_hash  = SHA256(canonicalized complete RunRecord)
```

Canonicalization must be deterministic, versioned, and compatible with the repository's existing canonical serialization semantics. For Gemini-generated scores, store an immutable composition/config identity outside `RunRecord` unless the contract is explicitly upgraded.

**Conflict rule:** The same experiment identity with a different artifact hash is a reproducibility/identity conflict, not a harmless duplicate. Do not silently overwrite.

**Cross-database limitation:** Tiger Data and MongoDB do not share an atomic transaction. Write/verify Tiger first, then upsert MongoDB, then mark the import complete. Failed later steps must be reconciled by an idempotent importer.

## 6. Database design

### 6.1 `experiment_runs` (ordinary PostgreSQL table)

```sql
CREATE TABLE experiment_runs (
    run_id UUID PRIMARY KEY,
    experiment_key TEXT NOT NULL,
    artifact_hash TEXT NOT NULL UNIQUE,
    scenario TEXT NOT NULL,
    arm TEXT NOT NULL CHECK (arm IN ('encore', 'static')),
    seed INTEGER NOT NULL,
    n0 INTEGER NOT NULL CHECK (n0 > 0),
    git_revision TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    record_version INTEGER NOT NULL,
    expected_samples INTEGER NOT NULL CHECK (expected_samples >= 0),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX experiment_runs_pair_idx
ON experiment_runs (scenario, seed, n0, arm, git_revision, params_hash);
```

The metadata must be checked against the source artifact. A matching label or `experiment_key` alone does not prove a valid pair: scheduled events and, for generated compositions, composition/config identity must also match.

### 6.2 `simulation_metrics` (hypertable)

```sql
CREATE TABLE simulation_metrics (
    sample_time TIMESTAMPTZ NOT NULL,
    run_id UUID NOT NULL,
    tick INTEGER NOT NULL,
    alive INTEGER NOT NULL,
    coverage DOUBLE PRECISION NOT NULL,
    pwc DOUBLE PRECISION NOT NULL,
    npwc DOUBLE PRECISION,
    sf_mean DOUBLE PRECISION,
    sf_max DOUBLE PRECISION,
    dup_slots INTEGER NOT NULL,
    versions JSONB NOT NULL,
    hb_total BIGINT NOT NULL,
    score_total BIGINT NOT NULL,
    delivered_total BIGINT NOT NULL,
    lost_total BIGINT NOT NULL,
    blocked_total BIGINT NOT NULL,
    collisions_total BIGINT NOT NULL,
    near_misses_total BIGINT NOT NULL,
    slot_changes_total BIGINT NOT NULL,
    PRIMARY KEY (sample_time, run_id, tick),
    CHECK (tick >= 0),
    CHECK (alive >= 0),
    CHECK (coverage BETWEEN 0 AND 1),
    CHECK (pwc BETWEEN 0 AND 1),
    CHECK (dup_slots >= 0)
);

-- Conventional TimescaleDB API; verify against provisioned Tiger service.
SELECT create_hypertable(
    'simulation_metrics', 'sample_time', if_not_exists => TRUE
);

CREATE INDEX metrics_run_tick_idx
ON simulation_metrics (run_id, tick);
```

A hypertable's unique index must include its partitioning dimension; the proposed primary key includes `sample_time`. Because `run_id` and `tick` are not globally unique across synthetic timestamps unless the importer enforces a stable mapping, the importer must validate the mapping and prevent duplicate logical ticks.

**Timestamp semantics:** `sample_time` is a deterministic synthetic timestamp derived from tick, **not wall-clock event time**. The authoritative x-axis remains `tick`, or `tick × DT` seconds.

```ts
const BASE_EPOCH_MS = Date.parse('2020-01-01T00:00:00Z');
function sampleTime(tick: number): string {
  return new Date(BASE_EPOCH_MS + tick * 50).toISOString();
}
```

The fixed epoch can repeat across runs because `run_id` differentiates them. Store actual ingestion time separately in `experiment_runs`.

**Trade-off:** At hackathon volumes, an ordinary PostgreSQL table indexed by `(run_id, tick)` may be equally practical. Hypertables are justified by the intended time-series feature demonstration and future scaling, not because tens of thousands of rows require partitioning.

### 6.3 `simulation_events` (ordinary table)

```sql
CREATE TABLE simulation_events (
    run_id UUID NOT NULL REFERENCES experiment_runs(run_id),
    event_index INTEGER NOT NULL,
    tick INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL,
    PRIMARY KEY (run_id, event_index)
);
```

Preserve the original event ordering; multiple events may occur on one tick. Event types include `KILL`, `JAM_ON`, `JAM_OFF`, `PARTITION_ON`, `PARTITION_OFF`, `INJECT_SCORE` and `SET_LOSS`. These are **scheduled environment events**, not a complete internal drone decision or packet event log. Large score payloads could later be replaced with references to immutable composition artifacts.

### 6.4 `run_summaries` (ordinary table)

```sql
CREATE TABLE run_summaries (
    run_id UUID PRIMARY KEY REFERENCES experiment_runs(run_id),
    npwc_end DOUBLE PRECISION,
    npwc_end_a DOUBLE PRECISION,
    coverage_end DOUBLE PRECISION,
    sf_mean_end DOUBLE PRECISION,
    sf_max_end DOUBLE PRECISION,
    t_rec_seconds DOUBLE PRECISION,
    npwc_deficit_seconds DOUBLE PRECISION,
    collisions BIGINT,
    near_misses BIGINT,
    msgs_per_drone_second DOUBLE PRECISION,
    delivery_ratio DOUBLE PRECISION,
    summary_json JSONB NOT NULL
);
```

Populate from the observer's authoritative `RunRecord.summary`; do not recalculate approximations in SQL. `summary_json` preserves additional keys, including version adoption, split duration, and slot-change metrics.

## 7. Recovery semantics and analytical correctness

`src/observer/summary.ts` defines recovery as follows:

1. Find the first `KILL` event.
2. Consider post-kill observer samples.
3. Count only consecutive samples that are in a formation-hold period and have finite, non-null `npwc >= 0.95`.
4. Require **12 consecutive samples**, each five ticks apart.
5. Return `(first qualifying tick - kill tick) × DT` once the streak qualifies.
6. Special case: return zero if **every post-kill hold sample** already satisfies the threshold.
7. Return `null` if there are no eligible hold samples or no sustained recovery.

At 20 Hz and every-five-tick sampling, consecutive samples are 0.25 simulated seconds apart. A 12-sample streak spans 2.75 seconds between first and last observations, and its reported recovery time refers to the **start** of the streak.

Three distinct UI states are necessary:

| State | Meaning |
|---|---|
| Recovered | Finite authoritative `tRec` |
| Not recovered / censored | Applicable kill scenario, but `tRec` is null |
| Not applicable | No relevant kill/recovery measure |

**Do not drop null recoveries from averages without disclosure.** Doing so biases the result toward successful runs.

`MetricsSample` does not include `inHold`; therefore, Tiger cannot reproduce the exact summary solely from exported samples. For the hackathon, use `RunRecord.summary` as authoritative. Reimplementing the summary in SQL would require exporting hold-state and additional event/reference context, with extensive equivalence tests.

Similarly, `npwcEnd` is a hold-filtered mean in ticks 1700–1799, not simply `AVG(npwc)` over every sample in that interval. `npwcEndA` uses ticks 800–899.

`npwc` is normalized to survivor capacity. Pair it with absolute coverage and alive count to avoid misleading claims about original formation restoration.

## 8. Ingestion implementation

### Proposed files

```text
src/
  telemetry/
    schema.ts
    validate.ts
    identity.ts
    serialize.ts
    importer.ts
    verify.ts
  server/
    db/
      tiger.ts
      mongo.ts
    routes/
      runs.ts
      analytics.ts
    services/
      comparisons.ts
sql/
  001_runs.sql
  002_metrics.sql
  003_events.sql
  004_summaries.sql
scripts/
  import-results.ts
tests/
  telemetry/
    serialize.test.ts
    import.test.ts
    compare.test.ts
```

### CLI experiment generation

```bash
npm run eval -- \
  --scenario S0,S1,S2,S3,S5 \
  --seeds 1-5 \
  --arms static,encore \
  --n0 200 \
  --out results/
```

The documented minimum matrix is five scenarios × five seeds × two arms = **50 records**. The optional full matrix including S4 and 20 seeds is **240 records**. Keep tuning seeds 101–105 separate from reported evaluation seeds.

### Validation checklist

- Record version exactly supported (`v === 1`).
- Valid scenario, arm, seed, initial population and events.
- Samples strictly increasing and on expected five-tick schedule.
- `alive` between zero and `n0`; valid metric ranges.
- Finite numbers except documented nullable fields.
- Nonnegative, nondecreasing cumulative counters.
- Summary keys and nullable semantics preserved.
- Hash and metadata consistency checked.
- Maximum file size, sample count, event count and payload size enforced.

Beware: JavaScript `JSON.stringify` converts `NaN` and infinities to `null`. Validate finite values **before** serialization; use runtime schemas or explicit checks.

### Pure serialization example

```ts
function serializeSample(runId: string, sample: MetricsSample) {
  return {
    runId,
    tick: sample.tick,
    sampleTime: sampleTime(sample.tick),
    alive: sample.alive,
    coverage: sample.coverage,
    pwc: sample.pwc,
    npwc: sample.npwc,
    sfMean: sample.sfMean,
    sfMax: sample.sfMax,
    dupSlots: sample.dupSlots,
    versions: sample.versions,
    hbTotal: sample.msgs.hb,
    scoreTotal: sample.msgs.score,
    deliveredTotal: sample.msgs.delivered,
    lostTotal: sample.msgs.lost,
    blockedTotal: sample.msgs.blocked,
    collisionsTotal: sample.collisions,
    nearMissesTotal: sample.nearMisses,
    slotChangesTotal: sample.slotChanges,
  };
}
```

The adapter should not recalculate metrics or mutate the source record.

### Transaction and idempotency

```text
Validate artifact and derive identity
BEGIN Tiger transaction
  insert experiment_runs
  insert all simulation_metrics
  insert scheduled simulation_events
  insert authoritative run_summaries
  verify expected sample/event counts
COMMIT
Verify imported content/checksum
Upsert MongoDB catalog metadata
Mark import complete
```

For the expected dataset size, a per-run transaction is reasonable. Use parameterized queries. Small batches can use multi-row inserts; larger datasets can use PostgreSQL `COPY` or staging tables.

Avoid using `ON CONFLICT DO NOTHING` as the sole correctness policy. It can hide contradictory rows. Distinguish identical-artifact retries from conflicting artifacts and verify data rather than blindly ignoring duplicates.

### Verification query

```sql
SELECT COUNT(*) AS sample_count,
       MIN(tick) AS first_tick,
       MAX(tick) AS last_tick
FROM simulation_metrics
WHERE run_id = $1;
```

Counts alone do not prove integrity. Also compare tick sequences, event payloads, summary values and ideally a canonical digest of rows retrieved in tick order.

## 9. Analytics API and queries

### 9.1 One run's measurements

`GET /api/runs/:runId/metrics`

```sql
SELECT tick,
       tick * 0.05 AS sim_seconds,
       alive, coverage, npwc,
       sf_mean, sf_max, dup_slots,
       collisions_total
FROM simulation_metrics
WHERE run_id = $1
ORDER BY tick;
```

The timestep constant should ultimately be read from versioned simulation parameters rather than duplicated in SQL and TypeScript.

### 9.2 Matched Encore/static comparison

`GET /api/comparisons?encoreRunId=...&staticRunId=...`

First validate identical scenario, seed, `n0`, code revision, parameter hash, event schedule and composition/configuration identity. Then:

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

An inner join silently excludes unmatched ticks; the service must check sample alignment and flag missing data. `NULL` `npwc` is meaningful when no drones survive; do not convert it to zero.

### 9.3 Multi-seed comparison

`GET /api/experiments/comparison?scenario=S2`

Return eligible paired seeds, medians, paired median deltas, interquartile ranges, win/tie/loss counts, censored recovery counts, excluded pairs and worst seed.

**Reuse the existing `src/cli/report.ts` comparison semantics** rather than implementing a second, subtly different statistical system. The median of paired differences is generally **not** the difference of two group medians. The dashboard should preserve pairing.

### 9.4 Cumulative counters

For message rates or interval collision counts, compute differences between adjacent samples, e.g. with SQL `LAG`, after validating that counters never decrease. Do not chart `collisions_total = 3` as “three new collisions at this tick.”

## 10. Dashboard specification

Build a dedicated **Experiment Analytics** page separate from the 3D simulation.

**Run selector:** scenario, seed, arm, Git revision, parameter hash, composition ID. Block unfair pairings by default; optionally allow mismatched viewing with a prominent warning.

**Recovery timeline:** `npwc` for Encore and static, `alive`, failure markers from stored events, threshold line at 0.95, sustained recovery interval, and clear status for censored recovery.

**Coordination costs:** delivered/lost/blocked messages, heartbeat and score broadcasts, duplicate slots, slot changes, collisions and near misses. Separate cumulative totals from per-interval deltas.

**Experiment summary:** paired median deltas, IQR, wins/ties/losses, excluded pairs, censored outcomes, worst seed, and provenance metadata.

**Data provenance:** distinguish a live provisional chart, a verified Tiger-backed historical query, and a local JSON fallback. Never imply a local fallback is a live database query.

Illustrative dashboard values must remain explicitly labeled illustrative until actual evaluations populate the charts.

## 11. Expected data volume and scaling

Assume 1,800 simulation ticks and one observer sample every five ticks:

| Workload | Approximate metric rows |
|---|---:|
| One run | 360 |
| 50-run minimum matrix | 18,000 |
| 240-run full matrix | 86,400 |
| 240 runs × 200 drone positions × 360 samples | 17,280,000 position rows |

The first three are small PostgreSQL workloads. Do **not** claim ordinary PostgreSQL cannot handle them. Tiger Data's value is specialized time-series tooling and future growth, not necessity at this scale.

Individual drone positions are **out of scope initially**. They are not part of `MetricsSample`; extracting them requires a new `WorldSnapshot` export, substantially increases data volume, and risks duplicating replay information available through deterministic simulation. Add them only if there is a specific analytics/replay requirement and a measured storage budget.

Confirm Tiger Data plan pricing, supported TimescaleDB version, connection limits, TLS requirements, retention and available extensions before implementation. Do not assume free unlimited capacity.

## 12. Scientific and measurement limitations

| Risk | Impact | Mitigation |
|---|---|---|
| Priority-weighted metric reflects chosen weights | `npwc` may improve without broad geometric improvement | Display coverage and shape fidelity |
| Static baseline cannot repair | Improvement only establishes advantage over this baseline | Describe baseline precisely |
| S5 may evaluate different scores | Ordinary win/tie/loss comparison invalid | Preserve repository's S5-specific evaluation treatment |
| Null `tRec` silently excluded | Recovery looks artificially strong | Explicit censored counts |
| Five-tick sampling | Short oscillations may be missed | Retain authoritative summary and disclose resolution |
| Discrete physics collision checks | Fast crossings may go undetected | Disclose simulation limits; improve collision model separately |
| Simulated environment | Not proof of physical safety | State simulation-only conclusions |
| Five seeds | Limited statistical confidence | Report n, worst seed; run 20 seeds when feasible |
| Cherry-picked seed | Selection bias | Predefine seeds and report all outcomes |
| `tRec` mixes detection, coordination and motion | Cannot claim detection latency | Use exact definition |
| `npwc` normalized by survivors | May conceal absolute capacity loss | Show alive, coverage, npwc together |

## 13. Infrastructure, architecture and security risks

| Risk | Mitigation |
|---|---|
| Tiger unavailable | Keep local JSON; retry later |
| Browser credential exposure | Server-only credentials, never `VITE_*` secrets |
| Duplicate or contradictory import | Artifact hash and explicit conflict checks |
| Partial Tiger import | Per-run transaction and verification |
| Cross-database inconsistency | Reconciliation state machine; idempotent retries |
| Synthetic time confused with real time | Label simulated seconds and ingestion timestamp separately |
| Missing sample rows | Completeness and tick-sequence checks |
| Schema evolution | Versioned migrations and adapters |
| Excessive live writes | Batching, bounded queues, controlled concurrency |
| Connection exhaustion | Small connection pool and limits |
| TLS errors | Provider-supported certificate verification |
| Arbitrary uploads / API abuse | Authentication, size limits, rate limits, runtime validation |
| SQL injection | Parameterized queries only |
| Overly broad database access | Separate least-privilege read/write roles |
| Telemetry retention deletes old rows | Keep canonical local artifact and represent archived state |
| Cloud telemetry feeds agent brain | Enforce one-way observer/export boundary |
| Live telemetry affects determinism | No network calls in simulation update loop |
| Live and batch results disagree | Live provisional; completed summary authoritative |
| Missing composition identity in `RunRecord` | Immutable external import manifest |
| Unclean/unknown Git revision | Warn that reproducibility evidence is weaker |

An uploaded JSON record is untrusted input. Enforce maximum sizes, finite values, valid event payloads and permitted schema versions. Never log database passwords or full connection strings. Use authentication for writes and read-only credentials for analytics.

## 14. Offline failure behavior

**Batch mode:** simulation completes, JSON is saved, upload is attempted. If upload fails, preserve the original artifact, report upload failure and allow retry. Do not report cloud persistence as successful.

**Live mode:** local simulation and HUD continue regardless of cloud state. A bounded queue may stop exporting, spill locally or explicitly drop telemetry with a loss counter. The final verified batch artifact remains the authoritative evidence.

If MongoDB succeeds but Tiger fails, or vice versa, show `import_incomplete` and reconcile. If telemetry has been archived or deleted, distinguish that state from an experiment with zero measurements.

## 15. Test plan and acceptance criteria

| Test | Required behavior |
|---|---|
| Import same artifact twice | No duplicate logical run or rows |
| Same experiment identity, different hash | Conflict surfaced |
| Fail mid-import | Tiger transaction rolls back |
| MongoDB fails after Tiger commit | Import incomplete; retry reconciles |
| `npwc = null` | Preserved as SQL NULL |
| Zero alive | No fabricated quality values |
| Missing sample tick | Import completeness fails |
| Counter decreases | Invalid record rejected |
| Unsupported record version | Explicit rejection |
| Different seeds | Comparison rejected |
| Different events | Comparison rejected |
| Different code/params | Comparison rejected |
| Valid paired runs | Same results as existing CLI report |
| Tiger offline | Local simulator/report unaffected |
| Observer enabled/disabled | Same deterministic simulation state hash |
| Missing secrets | Safe error, no credential leakage |

**Most important end-to-end test:** generate records with the existing CLI, import into Tiger Data, retrieve summaries, reconstruct the comparison report, and compare against the existing `npm run eval -- --report ...` output. Valid pairs, excluded pairs, medians, paired deltas, censored counts and worst seeds must agree.

## 16. Implementation roadmap

### Phase 1 — reliable ingestion (roughly 2–4 hours)

- Provision Tiger Data and configure TLS/credentials.
- Create migrations for runs, metrics, events and summaries.
- Implement strict validator and pure serializer.
- Import one completed record transactionally.
- Verify counts, tick sequence and hash.
- Prove reimport is idempotent.

**Exit criterion:** one `RunRecord` survives upload and round-trip verification unchanged in meaning.

### Phase 2 — paired analytics (roughly 2–4 hours)

- Implement run and time-series query endpoints.
- Validate paired experiment metadata.
- Return aligned Encore/static trajectories.
- Reuse existing CLI comparison statistics.
- Check cloud results against local report.

**Exit criterion:** Tiger-backed analytics match the authoritative local evaluation report.

### Phase 3 — dashboard and MongoDB catalog (roughly 3–5 hours)

- Store composition/config metadata in MongoDB.
- Link via immutable run/composition identifiers.
- Add run selector, recovery curves and event annotations.
- Add quality, coordination and paired-result views.
- Expose provenance and incomplete-import warnings.

**Exit criterion:** users can select a real persisted experiment and inspect the evidence and its provenance.

### Phase 4 — optional live telemetry (roughly 4–8+ hours)

- Add read-only observer export and bounded buffering.
- Implement authenticated batch HTTP ingestion.
- Add polling or server-sent updates.
- Implement backpressure and offline behavior.
- Reconcile provisional samples against completed artifact.

**Exit criterion:** cloud disconnection does not alter simulation results or conceal telemetry loss.

All estimates are rough and exclude potentially significant service setup, deployment and debugging time.

## 17. Explicitly excluded from the first release

- Cloud-based drone coordination or slot assignment.
- Every-tick telemetry uploads.
- Gemini-generated numerical experiment conclusions treated as truth.
- Duplicate storage of all telemetry in MongoDB.
- Replacement of the local evaluation report.
- Dependency on live internet access for the demo.
- Claims of universal resilience from one successful seed.
- Individual position hypertables and full cloud replay.
- Complex continuous aggregates before basic queries work.

## 18. Final architecture decision

| Concern | Decision |
|---|---|
| Primary telemetry source | Existing observer and `RunRecord` |
| Upload strategy | Post-run batch first |
| Tiger Data | Hypertable for metrics; ordinary SQL tables for identity/events/summaries |
| MongoDB Atlas | Compositions, configuration and run catalog |
| Gemini | Validated composition authoring, outside agent control loop |
| Statistics | Existing report semantics |
| Time axis | Simulation tick and deterministic synthetic timestamp |
| Canonical evidence | Immutable local JSON artifact |
| Duplicate policy | Artifact-hash idempotency with conflict detection |
| Failure policy | Local-first and retryable |
| Dashboard | Historical resilience comparison and event annotation |
| Live telemetry | Stretch goal |
| Position storage | Deferred |
| Agent access to cloud data | Forbidden |

### Recommended hackathon demonstration

1. Show a Gemini-generated, validated composition in Encore.
2. Run a reproducible failure scenario with a known seed.
3. Demonstrate drones responding locally, without a cloud controller.
4. Open the Tiger Data-backed analytics view.
5. Show the failure marker, `alive`, coverage, `npwc`, recovery status and communication costs.
6. Compare against the matched static run and show multi-seed results, including failures.
7. Show the MongoDB record linking the composition, configuration and experiment.
8. Explain that the cloud is an **observer and historical analytics system**, not a dependency of swarm behavior.

**Final objective:** Tiger Data makes Encore's resilience claims inspectable, reproducible and defensible. The database is evidence infrastructure, not a substitute for the decentralized algorithm.

---

## Appendix A — important implementation cautions

- The TimescaleDB `create_hypertable` call shown is conventional SQL syntax; check whether your Tiger Data service prefers newer `CREATE TABLE ... WITH (...)` syntax.
- The sample primary key includes the partition time, but stable `sample_time` mapping must still be enforced at import time.
- If every run starts at the same synthetic epoch, time-only queries span many runs; always filter by `run_id` or explicitly aggregate across runs.
- If comparing different configurations, do not assume `tick` means the same physical time unless `DT` matches.
- SQL `AVG()` excludes NULLs; that may be inappropriate for censored outcomes.
- JSONB version distributions preserve variable version labels, but indexing/querying them at scale may need specialized expressions or normalized rows.
- Synthetic timestamp retention rules could accidentally remove all historical runs together if based on that old synthetic date; **do not enable time-based retention on `sample_time` without redesigning the time axis or retention strategy**.
- Automatic compression/columnstore features and hypertable options depend on the Tiger Data/TimescaleDB version and service tier.
- If the canonical artifact is stored only on one developer's laptop, it is not durable team evidence. Consider a backed-up shared artifact store later, while keeping it outside the simulator control loop.

## Appendix B — reference paths

- `src/contracts/metrics.ts`
- `src/contracts/world.ts`
- `src/observer/measure.ts`
- `src/observer/summary.ts`
- `src/cli/run.ts`
- `src/cli/main.ts`
- `src/cli/report.ts`
- `src/app/ui/Hud.ts`
- `docs/` evaluation and design materials in the uploaded repository

This document is a **design specification**, not a claim that the proposed cloud services, endpoints, migrations or UI have already been implemented.
