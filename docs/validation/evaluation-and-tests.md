# Evaluation and tests

Purpose: how Encore is measured, compared with the static baseline, tested and gated. Status: accepted at G0; thresholds are pre-registered here and frozen with the parameters. Owner: validation lead (lane B, world and evidence).

Types and parameters: [contracts](../design/contracts-and-algorithms.md). Rules I1–I8: [architecture](../design/system-architecture.md). FR/NFR ids: [requirements](../specification/requirements.md). "BRIEF S3, R3, R4" are event facts in the [brief](../competition/BRIEF.md), not scenarios.

## 1. Principles

- **MUST observer-only.** Metrics come from `WorldSnapshot` and the reference score; nothing computed here reaches a brain (I6).
- **MUST pre-registration.** Scenarios, thresholds and the win rule are fixed before any evaluation seed runs.
- **MUST losses reported.** Ties and losses stay in the table, marked `TIE` or `LOSS`.
- **MUST split the loss.** *Capacity loss* is what dead drones cost under any algorithm. *Coordination loss* is what a better arrangement of the survivors would win back. Encore can only reduce the second.

## 2. Metrics

- **Reference score:** per world, as defined in [contract §5](../design/contracts-and-algorithms.md#5-world-events-snapshot-metrics): the newest registered score that at least one live drone in that world believes. The static world is therefore always measured against its preloaded score. `p_i` is slot `i` of its current movement.
- **Occupied:** `occ_i = 1` if any live drone's true position is within `rOcc` of `p_i`, whatever slot it believes it holds. `rOcc < slotSpacingMin / 2`, so one drone cannot occupy two slots.
- **Weights:** `w_i = 2(n0 − i) / (n0(n0 + 1))`, sum 1. `P*(M) = Σ_{i<M} w_i`: the best `pwc` that `M` survivors could reach with a global reassignment.
- **Hold sample:** a sample taken while the reference score is in hold. Summaries use hold samples only; collision counts cover the whole run.

`MetricsSample` (every 5 ticks):

| Field | Formula | Unit |
|---|---|---|
| `alive` | `M`, live drones | count |
| `coverage` | `Σ occ_i / n0`; ceiling `M / n0` in both arms | 0–1 |
| `pwc`, `npwc` | `Σ w_i · occ_i`; `pwc / P*(M)` | 0–1 |
| `sfMean`, `sfMax` | Distance from each `dense` point of the reference formation to the nearest live drone: mean, max. Label-independent | m |
| `dupSlots` | Slots named as `belief.slot` by two or more live drones | count |
| `versions` | Live drones per `belief.version` | count |
| `msgs` | Cumulative from `RadioEvent`: `hb`, `score` broadcasts; `delivered` receivers; `lost`; `blocked = jammed + partitioned` | count |
| `collisions`, `nearMisses` | Cumulative pair-entry events from the snapshot | count |
| `slotChanges` | Cumulative: a live drone's `belief.slot` differs from the tick before | count |

Capacity loss `= 1 − P*(M)`. Coordination loss `= P*(M) − pwc`. With no live drone, `npwc`, `sfMean` and `sfMax` are `null` (contract §5), and summaries skip null samples. Event times in the summary keys come from `Observer.recordEvent`, not from guessing at snapshots.

`RunRecord.summary` keys. `endA` = ticks 800–899; `end` = ticks 1700–1799. Wall-clock timings never enter a record (they would break replay equality).

| Key | Meaning | Unit |
|---|---|---|
| `npwcEndA`, `npwcEnd` | Mean `npwc` over `endA`, over `end` | 0–1 |
| `coverageEnd`, `sfMeanEnd`, `sfMaxEnd` | Means over `end` | 0–1, m, m |
| `sfMaxEndA` | Mean `sfMax` over `endA` (the hold in which the kill happened) | m |
| `capacityLoss`, `coordLoss` | Loss split, mean over `end` | 0–1 |
| `tRec` | Time from the first `KILL` to the start of the first 3 s of hold samples all with `npwc ≥ 0.95`. `0` if never below; `null` if not recovered (censored); absent without a `KILL` | s |
| `npwcDeficitSec` | `Σ (1 − npwc) · 0.25 s` over hold samples after the first event | s |
| `slotChanges`, `slotChangesMaxDrone` | Run total; largest for one drone | count |
| `lateSlotChanges` | Slot changes in the last 200 ticks | count |
| `dupSlotSec`, `dupSlotsEnd` | `Σ dupSlots · 0.25 s`; value at the last sample | slot·s, count |
| `collisions`, `nearMisses` | Run totals | count |
| `msgsPerDroneSec`, `deliveryRatio` | `(hb + score) / (mean alive · run seconds)`; `delivered / (delivered + lost + blocked)` | 1/s, 0–1 |
| `adoptP50`, `adoptMax`, `unadopted` | Time from `INJECT_SCORE` to adoption over live adopters; live drones not on the newest registered score at the end (static reports all of them) | s, s, count |
| `splitSec` | Time with two or more keys in `versions` | s |
| `tVersion` | Time from the last `PARTITION_OFF` until `versions` keeps one key; `0` if already one; `null` if never | s |

## 3. Scenarios

MUST. `n0 = 200`, 1800 ticks, default `Params`. Preloaded score `EVAL`, version `{0, OPERATOR}`: movement A = text `ENCORE`, movement B = sphere at tick 900, `transitionTicks` by the contract's authoring formula (`tA` for A, measured from the launch grid). `buildEvalScore` computes A's start as `min(-40, 380 − holdGrace − tA)`: −40 at n0 ≤ 200, and earlier at larger n0 (−51 at 250, −84 at 300). This keeps A's `holdStart + holdGrace ≤ 380` by construction. The contract allows the first movement to start before tick 0, and drones still launch at tick 0. A starts as late as that allows because drones fly paced targets (contract §10). The launch flight runs from tick 0 to A's `holdStart − 60`, so a later start means a slower, safer launch.

The runner then asserts two things:
- **A's paced launch is feasible.** The window `holdStart − 60` must be at least `⌈(tA − 60) / 2⌉` ticks, the farthest drone's flight time at `vMax`.
- **B's hold begins in time.** B's `holdStart ≤ 1300`.

If either assertion fails, the formation cannot be shown in time at that n0. Use a smaller n0 or move the event ticks later. Do not change A's start by hand. Shortening the text does not help: the formation's size is set by n0 slots at `slotSpacingMin`, not by the letter count.

A pure builder in `src/cli/scenarios.ts` (the world may not import `src/score`, the CLI may) returns `{ score, events }` from `(id, seed, params)`. It draws from its own seeded stream and resolves kills to explicit ids from formation-A slot positions (launch slot = id), never from live positions. Plane `P`: point `[0, 30, 0]`, normal `[1, 0, 0]`.

| ID | Events (tick) |
|---|---|
| S0 null | none |
| S1 random kill | `KILL` 400: 20 ids from `randomIds` |
| S2 regional kill | `KILL` 400: the 20 ids whose slots are nearest slot `c`, `c` uniform in `[0, n0)` |
| S3 radio cut, no kills | `PARTITION_ON` 400 `P`; `PARTITION_OFF` 1000; `JAM_ON` 1300 centre `[0, 30, 0]` radius 12; `JAM_OFF` 1600 |
| S4 partition plus failures | `PARTITION_ON` 300 `P`; `KILL` 400 as S2, `c` drawn from slots within 5 m of `P`; `PARTITION_OFF` 700 |
| S5 inject, split, reconnect | `PARTITION_ON` 300 `P`; `INJECT_SCORE` 400 into `d` (lowest id whose slot has `x < −10`) with `composeNext(EVAL, 400, text BRAVO, d, n0, params)`, so the new movement starts at `400 + scoreLead`; `PARTITION_OFF` 700. The group that adopts after `PARTITION_OFF` does so mid-transition and flies with adoption pacing (contract §10, #123); S5 records made before #123 (`results/` at 571c8e4) predate it |

Win rule on `npwcEnd`, paired by seed: win if Δ (Encore − static) `> +0.02`, loss if `< −0.02`, else tie. nPWC cannot see *where* holes are, so the claim about regional kills is carried by `sfMaxEndA` (paired Δ in metres), not by nPWC.

| ID | Pre-registered pass, out of 20 eval seeds | Honest expectation |
|---|---|---|
| S0 | Encore `slotChanges = 0` and both arms `npwcEnd ≥ 0.98` in ≥ 19 | Tie on the image. Encore loses on messages: static sends none |
| S1 | Δ ≥ −0.02, `lateSlotChanges = 0`, `dupSlotsEnd = 0`, `slotChanges ≤ 60` in ≥ 18 | Looks similar in both arms: random holes in farthest-point order are already an even thinning. `coverage` ties; `sfMean` and `sfMax` differ little. Expect an `npwc` win on most seeds (an isolated vacancy is the easy case), but it rests purely on our own priority labels: say so. Encore loses on messages, slot changes, near-misses |
| S2 | Win in ≥ 15; `sfMaxEndA` below static in ≥ 15; median `tRec ≤ 20 s`, at most 5 censored | Where Encore should be visibly ahead: static keeps the hole until the formation change at tick 900, Encore thins the neighbourhood. After the change the same dead indices sit at unrelated, scattered positions, so `sfMaxEnd` is expected to tie, as in S1. `coverage` ties. `npwc` stays below 1 (local, greedy repair). Some seeds may not recover |
| S3 | Encore `slotChanges = 0` and tie in ≥ 19 | Tie at best; Encore only adds blocked messages |
| S4 | Δ ≥ −0.02 in ≥ 18; win in ≥ 10; `dupSlots = 0` from tick 900 in ≥ 18 | Smaller gain than S2. Claimants on opposite sides cannot hear each other: duplicates until physical yield or reconnection, more slot changes and near-misses, losses on some seeds |
| S5 | ≥ 99% of live drones with the same `partitionSide` as `d` (read from a snapshot taken while the partition is on) adopt by tick 600; no drone in the other group adopts before `PARTITION_OFF` (tick 700); one version at the end in 20; median `tVersion ≤ 10 s`; `dupSlotsEnd = 0` | Two versions fly at once for the whole window from injection to `PARTITION_OFF`: groups are fixed at `PARTITION_ON`, wherever drones then fly. The group left behind sees the departed slots as empty and silent and repairs its old formation (contract §8.5 limit 7); those claims revert on reconnection and are counted in `slotChanges` and `dupSlotSec`. Static cannot adopt: a capability difference shown by `unadopted`, no win/tie/loss |
| All | `collisions`, `nearMisses` reported for both arms; no threshold | Encore ≥ static |

SHOULD: S0–S2 again at `n0 = 100`.

## 4. Baseline fairness

MUST be identical in both arms: seed, `n0`, score, slot order, `Params`, `steer`, world, observer, and a deep-equal `events` array with explicit ids. Only `WorldConfig.brain` differs.

Inherent differences, stated and not "fixed":

- Static sends nothing and never changes slot: it is the floor for messages, slot changes and repair traffic.
- Static is not degraded by jams or partitions; it never needed radio.
- Static ignores injection. It stays measured against its preloaded score (contract §5); the capability difference is reported through `unadopted`, not through coverage.

STRETCH central baseline, after G5 only. An assignment with instant global knowledge may be labelled **"oracle upper bound"** and nothing else. A competitor would need a positioned ground station under the same `rRadio`, `loss`, jams and partitions.

## 5. Procedure

1. **Tune** on dev seeds 101–105 only; they never appear in reported results.
2. **Freeze:** commit the `Params` used. `paramsHash` hashes its canonical JSON; every evaluation record carries the same `paramsHash` and `git`.
3. **Run** the minimum matrix first: eval seeds 1–5 on S0, S1, S2, S3 and S5, both arms, paired by seed (50 records in `results/`). The full matrix (seeds 1–20, plus S4: 240 records) is optional and runs only if G1–G4 are green with time to spare. Pass lines written "out of 20" scale to the seeds actually run, and the report states the count.
4. **Report** per scenario and metric: median and IQR per arm, median paired Δ, win/tie/loss counts, censored count, worst seed.
5. **A later parameter change** is a new revision: rerun everything and keep the old table, labelled superseded.

Budget: 15 minutes wall-clock for the matrix. If over, cut in this order and record the cut: `n0` 200 → 150 → 100 for the whole matrix (kills stay 10% of `n0`, `claimGap` by its formula); then S4; then seeds 1–10. Floor: S0, S1, S2, S3, S5 on 5 seeds.

## 6. Automated tests

vitest, headless. All MUST except T15 and T16 (SHOULD). "Gate" is the latest gate by which the test is green.

| ID | Test | Area | Pass condition | Gate |
|---|---|---|---|---|
| T01 | Import boundary | core-agent | `src/agent/**` imports only `src/contracts`, `src/score` and itself; no `Math.random`, `Date`, `performance`, DOM globals | G1 |
| T02 | Differential locality | core-sim | Params from `makeParams(n0, { loss: 0, latencyMin: 1, latencyMax: 1 })`, so no radio outcome depends on the shared random stream. Two worlds differ only by a `KILL` beyond `rRadio` of drone `a`: `inspect(a)` input, output and state deep-equal at the kill tick and the next; every `sensed` entry has exactly the keys `rel` and `vel`; brain inputs deep-frozen | G3 |
| T03 | Order independence | core-sim | Calling brains in descending id gives the same `stateHash()` after 400 ticks | G3 |
| T04 | Deterministic replay | core-sim | Same seed, params, events: equal `stateHash()` every 100 ticks in two runs; another seed differs | G3 |
| T05 | Pure-jam continuity | core-sim | Static under a jam covering the formation: same `stateHash()` as static S0 | G3 |
| T06 | Packet loss | core-sim | `loss` 0: every in-range live receiver, latency in `latencyMin…latencyMax`; `loss` 1: none; `loss` 0.3 over 10 000 candidates: 0.67–0.73 delivered; beyond `rRadio`: none | G1 |
| T07 | Partition and jam | core-sim | While on: no delivery between partition groups (also after drones cross the plane) or into, out of or inside the sphere; `partitioned` and `jammed` counted; after off: deliveries resume | G3 |
| T08 | G1 null run | core-agent | [Contract §8.6](../design/contracts-and-algorithms.md#86-the-first-falsification-test-gate-g1) test 1 | G1 |
| T09 | G1 clumped kill | core-agent | §8.6 test 2, all five conditions, kill centre drawn per seed by `randomIds(seed, slots, 1)`. The result depends on the centre: see the known limitation under §8.6 | G1 |
| T10 | G1 silence is not death | core-agent | §8.6 test 3: jam from 5 s to 40 s after the hold begins | G1 |
| T11 | Recovery stability | observer | S1 and S2 on dev seeds: `slotChanges ≤ 3 × kills`, at most 3 per drone, every commit lowers the slot index, `lateSlotChanges = 0`, no slot duplicated for more than 3 s | G5 |
| T12 | Collision accounting | core-sim | Two scripted drones passing head-on at 2 m/s closing speed: exactly one near-miss entry and one collision entry; dead drones never counted | G1 |
| T13 | UI event to simulation | app-ui | The kill-10% action schedules one `KILL` with the same `0.1 · n0` ids into both worlds; next snapshot shows them dead in both; the app's event log replayed headless gives the same `stateHash()` | G3 |
| T14 | Observer read-only | observer | `stateHash()` equal with and without the observer; snapshots deep-frozen | G5 |
| T15 | Scaling | core-sim | Mean brain step time per drone at `n0 = 300` ≤ 2× that at `n0 = 100`; printed, not stored | G5 |
| T16 | Version order | core-agent | Scores injected on both sides of a partition: after `PARTITION_OFF` every live drone holds the later `issuedTick` (tie: higher origin) | G4 |
| T18 | Score relay | core-agent | Three drones in a line, A in range of B, B in range of C, A out of range of C; inject at A. C adopts within 40 ticks at `loss` 0, and within 400 ticks at `loss` 0.2 on seeds 1–5. Same bounds with two extra up-to-date drones beside B (hidden terminal). No drone sends more than one `SCORE` per `scoreResendMin` | G4 |
| T19 | History and mixed versions | core-agent | More than `historyMax` commits followed by repeated pops ends on the launch slot with `heldSince` 0. A drone holding a claimed slot that hears an earlier holder of the same index on a **different** score version pops back; the same on equal versions | G1 |
| T17 | Formation invariants | score | Every recipe kind: `n0` slots, closest pair ≥ `slotSpacingMin`, same output on a second call | G1 |

## 7. Gates

What happens on a miss: [development plan](../planning/development-plan.md); for G1, the [fallback ladder](../planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1).

| Gate | Target (GMT) | Pass evidence |
|---|---|---|
| G0 design accepted | Sat 20:30 | Contract, architecture, requirements and this file merged; contract types compile in `src/contracts`; link check passes |
| G1 core mechanism feasibility | Sat 23:30 | T08–T10 green on seed 101, then on 101–105; T01, T06, T12, T17 green; one headless command |
| G2 minimum 3D vertical slice | Sun 00:30 | Browser shows both worlds stepped by real brains (the static brain in both until WP-1b merges, then Encore in the upper one); one scheduled kill lowers `alive` in both; roster size and frame rate recorded in [CURRENT_STATE](../CURRENT_STATE.md) |
| G3 communications resilience | Sun 02:30 | T02–T05, T07, T13 green; S3 on seed 101: zero Encore slot changes, `msgs.blocked > 0`; every drawn radio spark maps to a `RadioEvent` (I8) |
| G4 composition and dissemination | Sun 03:30 | T18 green (and T16 if built); S5 on seed 101: injection into one drone, two keys in `versions` during the split, no adoption in the other group before `PARTITION_OFF`, one key at the end; the belief layer shows the same |
| G5 validation | Sun 06:30 | T11 and T14 green; frozen `paramsHash`; the §5 matrix in `results/`; generated table with win/tie/loss, censored counts and `LOSS` rows; one record per scenario re-run with equal `stateHash` and `summary` |
| G6 demo and submission | Freeze 08:30, video 09:00, submit 10:15, hard 11:00 (BRIEF S3) | Backup video of the scripted demo from a fixed seed; README lists libraries (R3), credits AI use (R4) and has "Where Encore ties or loses"; every quoted number traces to a `RunRecord`; Devpost timestamp |

## 8. Bias risks and reporting wording

- **Own labels.** `npwc` uses our slot order, and farthest-point order makes a prefix good on `sfMax` by construction. Always show `coverage`, `sfMean`, `sfMax` beside it and say "priority-weighted by our own slot order".
- **Weight shape** sets the size of any win. It is fixed here; a second weighting is a STRETCH sensitivity check.
- **`coverage` cannot favour Encore.** Say so.
- **`P*(M)` assumes a global reassignment.** `npwc < 1` after local repair is expected.
- **`tRec` includes suspicion, contention and flight time.** Never call it detection latency.
- **Collisions are sampled at 20 Hz.** Closing speed can reach `2 · vMax · DT` = 0.8 m per tick, more than `dCollide`: counts are lower bounds unless the world uses swept closest approach (SHOULD).
- **Kill sets come from slot geometry.** If an Encore drone changed slot before the kill, the region differs between arms; S0 guards this.
- **Medians hide failures.** Print censored counts and the worst seed.
- **Model limits** (vanishing dead drones, disc radio, shared clock, ideal sensing, one process): state them, see [assumptions](../context/evidence-and-assumptions.md).

Wording to use:

- "In simulation, `n0` = 200, 20 seeded paired runs: median final nPWC X (IQR Y) for Encore, Z for static. Encore ahead on a seeds, level on b, behind on c; not recovered on k."
- "N collision events (closer than `dCollide`) and M near-misses in R runs." With none: "0 observed in R runs."
- "Reached nPWC ≥ 0.95 after X s, flight time included", or "did not recover on k of 20 seeds".
- "The two sides flew different versions for X s; one version remained Y s after reconnection."
- Phrases to avoid and their replacements: [requirements §5](../specification/requirements.md#5-claims-we-must-not-make).
- The theme wording and the Neptune North brief are team-reported and not verified online (BRIEF T1, P7): never word a result as meeting either.
