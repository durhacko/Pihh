# Phase 2 candidates

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file exists in the code. It is an ideation record for Phase 2, issue #110. Existing behaviour is labelled (a)–(e) below; everything else is a proposal.

Purpose: the canonical catalogue of Phase 2 candidates (`E01`–`E10`, `N01`–`N21`), their existing-state audit, their scores, their ranking, the prior art behind them and the accepted, deferred and rejected lists. Status: proposal for Arnav's review; nothing here is approved. Owner: Arnav (Phase 2 architecture, issue #110). Audit base: `origin/main` 26b438a (first audited at 7a50a69).

## 1. How to read this file

### 1.1 What lives here and what does not

This file is canonical only for the candidates, the existing-state audit, the scoring, the ranking, the prior art, the inversion analysis and the verdict lists. Everything else lives in a sibling document; link to it, do not copy it.

| Topic | Canonical document |
|---|---|
| Tracks H and P, capabilities `C1`–`C9`, proposed requirements, ADRs and the contract-change register `P2-CC-*` | [`PHASE2_ARCHITECTURE.md`](../design/PHASE2_ARCHITECTURE.md) |
| Gates `P2-G0`–`P2-G6`, decisions `D1`–`D7`, risks `P2-R*`, emergency cut order | [`PHASE2_ROADMAP.md`](../planning/PHASE2_ROADMAP.md) |
| Motion primitives, `slotPosAt`, observer under motion, linter checks `L1`–`L6` | [`ANIMATED_CHOREOGRAPHY_RFC.md`](../design/ANIMATED_CHOREOGRAPHY_RFC.md) |
| Healing in motion, feed-forward, avoidance budget, safety filter | [`ADAPTIVE_RECOVERY_AND_SAFETY_RFC.md`](../design/ADAPTIVE_RECOVERY_AND_SAFETY_RFC.md) |
| Boundaries `X-IN`, `X-OUT`, `X-PERSIST`, `X-RUN` | [`OPTIONAL_INTEGRATION_BOUNDARIES.md`](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md) |
| Tests `P2-T*`, checked properties `INV-*`, scenarios `M0`–`M6`, sweeps `X*`, fuzz campaigns `FZ*` | [`PHASE2_EVALUATION.md`](../validation/PHASE2_EVALUATION.md) |
| Work packages `P2-WP-*` | [`PHASE2_WORK_PACKAGES.md`](../development/PHASE2_WORK_PACKAGES.md) |
| Demo beats `P2-B*` | [`PHASE2_JUDGING_STORYBOARD.md`](../demo/PHASE2_JUDGING_STORYBOARD.md) |
| Base contract, requirements, evaluation, base prior art | [contract](../design/contracts-and-algorithms.md), [requirements](../specification/requirements.md), [evaluation](../validation/evaluation-and-tests.md), [evidence §1.2](../context/evidence-and-assumptions.md#12-prior-art) |

### 1.2 Status labels

Every statement about existing code carries one label, at audit base 26b438a:

- **(a)** implemented and tested on `main`
- **(b)** implemented but not integrated
- **(c)** in an open PR or under active development
- **(d)** documented only
- **(e)** not present

### 1.3 Base work since the first audit

The merges between 7a50a69 and 26b438a are listed once, in [`PHASE2_ARCHITECTURE.md`](../design/PHASE2_ARCHITECTURE.md#changes-since-first-audit). **They are base work, and no candidate below may claim them.** At 26b438a, `src/app/main.ts` calls neither `connectComposer` nor `connectInspector`, so composer, console, timeline, inspector and ghost slots stay (b) until open PR #113 mounts them; and `results/` holds only `README.md` (evidence matrix: open PR #122).

### 1.4 Constraints that decide most verdicts

These constraints are canonical in [`PHASE2_ROADMAP.md`](../planning/PHASE2_ROADMAP.md) and [`PHASE2_ARCHITECTURE.md`](../design/PHASE2_ARCHITECTURE.md). The scores below apply them as follows:

1. **Evidence fragility.** After the evidence matrix run (#122) starts, any change to `src/agent/**` behaviour, to `steer`, to `Params` or to the shape of `EncoreState` forces a new evidence revision. `paramsHash` hashes the canonical JSON of the whole `Params` object (`src/cli/run.ts:38-41`), so even a default-off field counts. `stateHash` includes every body's brain `state` (`src/sim/world.ts:209-211`).
2. **Short window.** Hackathon Phase 2 (Track H) has at most about 2–4 hours after the base gates, uses new files only and makes zero `[contract]` PRs. So any candidate that needs a `P2-CC-*` gets TF-H = 1.
3. **Contended files** ([full list](../development/PHASE2_WORK_PACKAGES.md#62-files-track-h-must-not-edit)). Track H does not edit the brains, `steer.ts`, `src/contracts/**` or the contract doc; files of open PRs #113, #115, #121 and #82 (`main.ts`, `worlds.ts`, `actions.ts`, `commands.ts`, `Hud.ts`, `Composer.ts`, `Console.ts`, `Timeline.ts`, `world.ts`, `grid.ts`, `observer/measure.ts`); the existing `src/cli/**` files and `results/**` before #122's records are archived; or `package.json`. Track H CLI work is standalone files run with `npx tsx src/cli/<x>.ts`.

   The safe seam is a new `src/app/render/layers/*Layer.ts`. It registers itself through `import.meta.glob` (`src/app/render/layers/index.ts:3-11`) and receives every tick's snapshot through `ingest` (`src/app/render/Layer.ts:12-14`).
4. **Performance headroom is thin.** The frame budget is "both worlds ≤ 3 ms" (SHOULD, [experience §10](../design/experience-and-demo.md#10-performance)); the #118 harness's one recorded run ([`assets/qa/perf.md`](../../assets/qa/perf.md), not a benchmark) put `stepBoth` at 7.7 ms mean with 200 drones and the Encore arm (#115 targets it). Each Phase 2 per-tick addition stays ≤ 0.5 ms/tick/world, measured opt-in with that harness (`P2-T18`).

## 2. Method

### 2.1 Screens (applied before scoring)

As in [`EVALUATION_FRAMEWORK.md`](EVALUATION_FRAMEWORK.md), pass/fail screens come before any score. A candidate that fails one is rejected whatever its score.

| Screen | Passes if | Fails here |
|---|---|---|
| Increment | It adds something that base work (states (a)–(c), plus base MUSTs still owed) does not already provide | `E04` minimum (it is FR-10 evidence, which is base work), `N16`, `N17` |
| Boundary | It is legal under rules I1–I8 ([architecture §3](../design/system-architecture.md#3-information-rules)), and it introduces no central controller or re-derivation of brain logic in the app | the "world-side enforcement", "oracle in a brain" and "app-computed `canHeal` reasons" variants (§7.3) |
| Demo safety | It cannot change the FR-35 scripted run's `stateHash`, and it is off by default on the demo path | `N15` in its live form |
| Rules | No network, no external service and no sponsor-specific design (NFR-04; decision `D3`) | sponsor integrations (§7.3) |

Separately, a **track screen** sends to Track P every candidate that needs a `P2-CC-*`, a `Params` or `EncoreState` field, or an edit to a contended file. That is a scheduling decision, not a rejection.

### 2.2 The twelve dimensions

Every dimension is scored 1–5, and **higher is always better**. Cost 5 means cheap; Regr 5 means low regression risk. Scores rate the **Phase 2 increment over the base**, for the minimal valuable slice unless stated otherwise.

| Key | Dimension | 5 looks like |
|---|---|---|
| CA | Challenge alignment (decentralised coordination, independent decisions, resilience to interrupted communication: EV-08, team-reported, unverified) | It directly strengthens one of the three |
| Orig | Originality | An uncommon combination for a swarm show, framed honestly |
| Depth | Technical depth | A non-trivial algorithm or system argument |
| Demo | Demonstrability | A judge gets it in 10 s |
| Vis | Visual impact | You see it without explanation |
| Arch | Architecture fit | Uses existing seams; no contract change |
| Rel | Reliability and testability | Pure, deterministic, unit-testable |
| Cost | Implementation cost | Under 2 agent-hours |
| Regr | Regression risk | Cannot touch the demo path or the evidence |
| Perf | Performance | ≤ 0.5 ms/tick/world, or offline |
| Eval | Evaluability | It yields a falsifiable artefact traceable to a `RunRecord` (NFR-09) |
| TF-H / TF-P | Time feasibility in the hackathon (Track H) / after it (Track P) | It fits the window with validation time |

Confidence follows the framework: **H** (evidence or a spike), **M** (informed judgement), **L** (guess).

### 2.3 Expected competitive contribution (ECC)

ECC is a **heuristic for ordering, not a measurement**:

- **Value** `V = 0.20·CA + 0.15·Orig + 0.20·Depth + 0.15·Demo + 0.10·Vis + 0.20·Eval`. The weights adapt [`EVALUATION_FRAMEWORK.md`](EVALUATION_FRAMEWORK.md):
  - Sponsor fit is dropped, because no brief is verified and `D3` is open.
  - Eval stands for both Research/Learning and the NFR-09 rule that every number must trace to a record.
- **Delivery** `D = mean(Arch, Rel, Cost, Regr, Perf)`.
- `ECC-H = V × (TF-H/5) × (D/5)`. Inside the hackathon, delivery risk counts in full.
- `ECC-P = V × (TF-P/5)`. After the hackathon, regression risk is handled by a declared new revision (`D5`) and gates `P2-G1`–`P2-G4`, not by the score.
- A margin under 0.3 is a tie, as in the framework. For Track P, ties are broken on CA, then Depth. A post-hackathon item is judged on its contribution, not on expo demo impact.

## 3. Candidate catalogue and existing-state audit

### 3.1 Families from the Phase 2 brief: E01–E10

| ID | Candidate | What exists at 26b438a | Minimal Phase 2 slice | Full version | Information boundary |
|---|---|---|---|---|---|
| `E01` | Continuous animated 3D choreography | (a) Static formations only: `Recipe` has no motion, size or centre field (`src/contracts/score.ts:7-10`), and every formation is centred on `CENTRE = [0,30,0]` (`src/score/expand.ts:9`). (a) #96 `pacedSlotPos` (`src/agent/steer.ts:114`) is a time-dependent aim point during transitions only, used for steering in both brains. (d) [contract §12](../design/contracts-and-algorithms.md#12-deliberately-not-in-the-mvp) "Rotating or animated holds" is STRETCH, as is FR-38. (e) Target velocity and moving-formation code | A rigid spin of a hold about the vertical axis through `CENTRE`, as an optional movement field. Pure `slotPosAt`/`slotVelAt` in `src/score`, shared by both brains and the observer, with `pacedSlotPos` moved there. Needs `P2-CC-01`, `-02` and `-06` | Rigid translation, transverse travelling waves and an outward-only pulse; animated cues; linter `L6` | Clean: the slot position is a function of the score (I4, I5) and the synced clock (AS-01). Do not hold formation from `HB.pos`, which is legal but stale |
| `E02` | Self-healing while formations move | (e). Condition 3 of `evaluateCanHeal` needs the drone settled and slow (`src/agent/encoreBrain.ts:189`, using the speed test at `:314`), so a moving hold switches healing off. `targetChanged` clears every `emptySince`. (d) [contract §8.5](../design/contracts-and-algorithms.md#85-known-limits-state-these-dont-hide-them) limit 4: "no healing during transitions" | Rigid motion only, through co-moving-frame vacancy sensing (`N01`). Needs `E01` and `P2-CC-04` | Non-rigid motion, with the claim feasibility guard; healing during paced transitions | Clean if it uses only the score, the clock, its own pos/vel and anonymous `sensed`. Using the holder's `HB.pos` to excuse lag would change the detector's semantics |
| `E03` | Local predictive collision avoidance | (a) `steer` has arrive tracking (`TRACK_GAIN = 4`), linear separation below `dAvoid` = 1.4 m and a mirrored sidestep of `0.3·aMax` (`src/agent/steer.ts:9-11, 33-79`); both arms use it. (a) #96 pacing: S0 static collisions 60 → 14 (one run, reported on #96). (d) ADR-009 rejected velocity-obstacle planners. Analytic, not measured: the tracking request (up to 64 m/s² before the world clamp) can swamp separation (≤ 8) and sidestep (2.4) | An avoidance-first acceleration budget (`N03`), measured on S0 against the post-#96 baseline. Needs `P2-CC-05`(a) | A CBF-style pairwise filter (`N04`), counted with swept collisions (`N10`) | Clean: it uses `sensed` only. Never enforce safety in the world (ADR-009) |
| `E04` | Graceful degradation and adaptive fidelity | (a) Farthest-point order: any prefix is an evenly spread shape ([contract §6](../design/contracts-and-algorithms.md#6-composition-from-recipe-to-slots); `src/score/fps.ts`). (a) `P*(M)`, `capacityLoss` and `coordLoss` in the observer (`src/observer/measure.ts:45`). (e) The FR-10 screenshots at 90% and 70%, which are a **base MUST** | A prefix preview (k = 100/90/70/50%). It is FR-10 evidence, so it is not Phase 2 unless the base fails to deliver that evidence; even then it is credited to FR-10 | Recomposition to M survivors. It needs agreement on M (`N11`), or an operator-triggered score with a recipe scale field (a contract change) | Automatic recomposition tempts a global alive count, which only the observer has (I5, I6) |
| `E05` | Explainable decision inspector | (b) `Inspector.ts` and `inspectorTruth.ts` are built and tested, but `connectInspector` is never called; (c) #113 mounts it. (a) `Belief.log` holds the last 20 decisions, and `Belief.canHeal` is a boolean (`src/contracts/agent.ts:27-36`). (e) A peer diff and `canHeal` reasons | A knowledge-versus-truth peer diff: it reads `inspect().state` generically, guarded, and takes truth from the observer. Blocked on #113; needs hooks in `Inspector.ts` and `inspectorTruth.ts`, so Track H only with a `D1` exception | `Belief.why` (`P2-CC-07`) and a per-drone score age (`N20`) | Showcases I1 against I6. The app must never re-derive brain logic |
| `E06` | Fault laboratory, replay and counterexample search | (a) A deterministic world, `stateHash`, T04 replay and T13 (an app event log replays headless). (a) Scenarios S0–S5 hard-coded in `buildScenario`. (a) #104 scripted demo with timed intents (`ControlIntent.at`). (e) Schedule generation, history checkers, shrinking, `--replay` and a CLI params override | `N05` + `N06`: invariant checkers, plus a seeded fuzzer with ddmin and JSON repros | CLI `--replay`, loading a repro in the app, fault presets | The generator is the environment (I3, I6). It must build schedules from launch geometry, never from Encore's beliefs |
| `E07` | Advanced resilience evaluation | (a) The observer, 24 summary keys, a paired report and the analytic `P*(M)`. (a) The CLI Encore arm (#116, `src/cli/brains.ts`). (c) The evidence minimum matrix #122; no records in `results/`. (e) Sweeps, bootstrap CIs, a simulated oracle, swept collisions | One exploratory breakdown curve (`X1` or `X2`), with a `--set key=value` override | `N09` + `N10`, bootstrap CIs, scaling | None: everything is observer-side |
| `E08` | Concurrent score conflicts and convergence | (a) #105: LWW adoption on `(issuedTick, origin)` (`src/agent/encoreBrain.ts:129-143`), rate-limited re-send (`:118-122`), anti-entropy, T16 and T18 (`tests/g4/`); post-partition churn is measured but not asserted. (d) FR-22 (SHOULD); contract §8.5 limits 7–9 and [contract §9](../design/contracts-and-algorithms.md#9-score-dissemination-and-partitions-adr-005-adr-008) | A dual-injection scenario across a partition (`X3`), with a documented churn bound and a "two colours → one" beat | Deferred adoption at movement boundaries (`N21`) | Adoption only through delivered `SCORE` messages (I7). Never merge concurrent scores |
| `E09` | Connectivity-aware motion | (e) No connectivity metric, component count or overlay. (a) Radio X-ray draws the real delivered links | An authoring-time radio-graph check: components and hop diameter at `rRadio`. Folded into `N08` as `L2` | Runtime connectivity control (λ₂). **Rejected** | The check uses the score vocabulary only. Runtime control would need positions beyond sensing |
| `E10` | Enhanced composition and authoring | (a) Recipe kinds text, sphere and helix; `composeNext`; the inject path. (b) #112 composer with `validateDraft` (`src/app/ui/Composer.ts:83`) and #109 timeline (no seek), not mounted until #113. (d) `form svg`, `form cloud`, `cue add`, `show save` and `seek` are marked `'later'` in `src/app/ui/commands.ts` | Linter warnings in `validateDraft` (`N08`). No new recipe kind | New recipe kinds (contract; gossip does not reject unknown kinds, so they need boundary validation), multi-cue authoring, animated cues | A score enters through one drone's inbox only (I7); the preview stays local |

### 3.2 New ideas: N01–N21

Effort figures are estimates in agent-hours, with low confidence. None are measured.

| ID | Candidate | Mechanism | State at 26b438a | Effort | Verdict |
|---|---|---|---|---|---|
| `N01` | Co-moving-frame vacancy sensing | Evaluate slot positions at `input.tick`. Make the settle test relative (`|vel − slotVelAt| < 0.5`). Use `rOccEff = rOcc + lagBound` for the vacancy test only. Add a feasibility guard for claims | (e) | 6–10 + revalidation | Accept, Track P (`C8`; needs `N02`) |
| `N02` | Target-velocity feed-forward | `steer(…, targetVel = ZERO)`, fed with the motion part of `pacedSlotVel` only. That is zero for static scores, so S0–S5 `stateHash` stay equal (`P2-T23`) | (e) | 1–2 + test | Accept, Track P (`C7`), first |
| `N03` | Avoidance-first acceleration budget | Compute avoidance first, then scale tracking into the remaining `aMax` | (e) | 1–2 + re-run | Accept, Track P (`C9`), measured before `N04` |
| `N04` | Pairwise CBF-style safety filter | Half-space projections with Gauss–Seidel sweeps in a deterministic `(|rel|², rel, vel)` order; the sidestep stays as tie-breaker; both arms | (e) | 4–6 + re-run | Accept, Track P (`C9`) |
| `N05` | Invariant checkers on real histories | Pure, incremental checkers over contract §8.4/§8.5; the `INV-*` definitions are canonical in [`PHASE2_EVALUATION.md` §4](../validation/PHASE2_EVALUATION.md#4-checked-properties) | (e) | 2 + 1 readout | Accept, Track H (`C1`), minimal |
| `N06` | Counterexample search with ddmin | Seeded swarm-testing generator (`FZ1`), runs at `n0` = 40, shrinks to 1-minimal `p2-repro/1` files; never emits two different scores with one version | (e) | 2–3 | Accept, Track H (`C1`), minimal |
| `N07` | Repair cascade trail | A self-registered layer draws an arrow only for an observed `belief.slot` change, once the claimant is within `rOcc` of its new target, so it never overlaps that drone's tether. The increment over tethers: it persists about 6 s after arrival, colours commits and pops apart, and its count equals the HUD's "Slot changes" (`src/app/ui/Hud.ts:128`). X-ray only | (a) `TetherLayer` (`src/app/render/layers/TetherLayer.ts:1-4`): in X-ray, every live drone farther than `rOcc` from its own `belief.target` already has an amber line to it, so a claimant's flight to its new slot is visible today. The trail is (e) | 1.5–2 | Accept, Track H (`C2`), minimal |
| `N08` | Score linter | Pure `src/cli/lint.ts`, also imported by the composer: `L1` predicted conflicts under ideal paced flight (no avoidance; not a collision forecast), `L2` radio components and hop diameter, `L3` unhealable islands, `L4` altitude, `L5` paced speed; warns, never blocks | (e) | 2 + 1 | Accept, Track H (`C3`), recommended |
| `N09` | Analytic oracle time bound | Time to first npwc ≥ 0.95 under instant global knowledge, as a relaxed bound: for each unoccupied slot, the earliest reach time `τ` of any live drone (no exclusivity); add priority weights in order of `τ` until `pwc ≥ 0.95·P*(M)` (definition in [`PHASE2_EVALUATION.md` §3.2](../validation/PHASE2_EVALUATION.md#32-recovery); `P2-WP-08`). No assignment is solved: a min-bottleneck assignment bounds a different event and can exceed `tRec`. Offline in the CLI, labelled "oracle upper bound" | (a) `P*(M)` only; the time bound is (e) | 2–3 | Accept, Track H stretch (`C4`) |
| `N10` | Swept collision accounting | Closest approach of linear relative motion within each tick, observer-side, with no world change | (d) contract §10 SHOULD; (e) in code | 1–1.5 | Accept, Track H stretch (`C4`); also feeds `C9` |
| `N11` | Recomposition by distributed size estimation | Extrema propagation or an epoch bitmap in `Heartbeat`, then agreement on k | (e) | very high | **Reject** |
| `N12` | Dark-but-hovering failure | `KILL` gains `mode: 'dark'` (`P2-CC-08`) | (d) contract §12 "Dark-but-hovering failures" left out | 3–4 | Defer; state it as a limit |
| `N13` | Announced graceful leave | A `leaving` flag in `HB` plus a landing behaviour | (e) | 3–5 | Defer |
| `N14` | Replay scrubber in the app | Seek by re-simulation, or by world checkpointing, which the `World` contract lacks | (d) `seek` marked `'later'`; #87 decided "no seek", and the #109 timeline has none | 4+ | Defer |
| `N15` | Live chaos monkey | Random faults injected during the live demo | (e) | 1–2 | **Reject** (demo safety); its headless form is `N06` |
| `N16` | Partition "split show" | Each half keeps flying its own score | (a) FR-21 behaviour via #105; existing S5 and 3-minute script beats | 0 | **Reject** as a feature; keep as a beat under `C6` |
| `N17` | Two-signal suspicion | `vacant()` ANDs sensed emptiness with heartbeat silence | (a) `src/agent/encoreBrain.ts:199-202` | 0 | **Reject** as a mechanism; use as explanation in `C2`/`C5` |
| `N18` | Camera-aware saliency priority | Farthest-point order in the audience's projected plane | (e) | 3 + re-run | Defer |
| `N19` | Transition-minimising orientation | Rigid rotation or mirror of the next formation, without permuting indices | (e) | 3–4 | Defer |
| `N20` | Per-drone score age | A ring or tint by `belief.version` age | (a) belief layer colours by version | 1 | Merge into `C5` full |
| `N21` | Deferred adoption at movement boundaries | Apply a newer score at the next movement boundary | (e) | 3 + G4 re-run | Defer, until `C6` measures the discontinuity |

Overlaps: `E06` is `N05` + `N06`; `E02` is `N01` applied; `E03` full is `N04`. Scores of overlapping rows are **not additive**.

## 4. Scores

Scores are for the minimal slice (Track P items: their first post-hackathon slice). The E-family scores are carried over from the Phase 2 ideation pass; the N-family scores are new here.

| ID | CA | Orig | Depth | Demo | Vis | Arch | Rel | Cost | Regr | Perf | Eval | TF-H | TF-P | Conf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `E01` | 3 | 2 | 3 | 4 | 5 | 3 | 3 | 2 | 2 | 4 | 3 | 1 | 4 | M |
| `E02` | 5 | 4 | 5 | 3 | 3 | 3 | 2 | 1 | 1 | 4 | 4 | 1 | 3 | M |
| `E03` | 3 | 2 | 4 | 2 | 2 | 4 | 4 | 3 | 2 | 4 | 5 | 1 | 4 | M |
| `E04` | 4 | 2 | 2 | 3 | 3 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 5 | H |
| `E05` | 5 | 3 | 3 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 2 | 3 | 5 | M |
| `E06` | 4 | 4 | 5 | 3 | 2 | 5 | 5 | 3 | 5 | 3 | 5 | 3 | 5 | H/M |
| `E07` | 4 | 2 | 3 | 3 | 2 | 5 | 5 | 4 | 5 | 3 | 5 | 3 | 5 | H |
| `E08` | 4 | 1 | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 5 | 4 | 3 | 5 | M |
| `E09` | 4 | 3 | 3 | 2 | 2 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | M |
| `E10` | 5 | 2 | 2 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 2 | 2 | 4 | M |
| `N01` | 5 | 4 | 5 | 3 | 3 | 3 | 2 | 2 | 1 | 4 | 4 | 1 | 3 | M |
| `N02` | 2 | 1 | 3 | 3 | 4 | 4 | 5 | 4 | 3 | 5 | 4 | 1 | 5 | M |
| `N03` | 2 | 1 | 2 | 1 | 1 | 4 | 4 | 5 | 2 | 5 | 5 | 1 | 5 | M |
| `N04` | 3 | 2 | 4 | 2 | 2 | 4 | 3 | 2 | 1 | 4 | 5 | 1 | 3 | M |
| `N05` | 4 | 3 | 4 | 3 | 2 | 5 | 5 | 4 | 5 | 4 | 5 | 4 | 5 | H |
| `N06` | 4 | 4 | 5 | 3 | 1 | 5 | 5 | 3 | 5 | 3 | 5 | 3 | 5 | M |
| `N07` | 5 | 2 | 3 | 4 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 5 | M |
| `N08` | 4 | 3 | 4 | 4 | 3 | 4 | 5 | 4 | 5 | 5 | 4 | 3 | 5 | M |
| `N09` | 3 | 2 | 4 | 2 | 1 | 5 | 4 | 3 | 5 | 4 | 5 | 3 | 5 | M |
| `N10` | 2 | 1 | 3 | 2 | 1 | 5 | 5 | 4 | 5 | 3 | 5 | 4 | 5 | M |
| `N11` | 4 | 3 | 5 | 3 | 4 | 1 | 1 | 1 | 1 | 3 | 2 | 1 | 2 | M |
| `N12` | 3 | 3 | 3 | 3 | 3 | 2 | 4 | 3 | 2 | 5 | 3 | 1 | 4 | L |
| `N13` | 3 | 2 | 3 | 2 | 2 | 2 | 3 | 2 | 2 | 5 | 3 | 1 | 3 | L |
| `N14` | 2 | 2 | 3 | 4 | 3 | 2 | 3 | 1 | 4 | 1 | 2 | 1 | 2 | M |
| `N15` | 3 | 2 | 2 | 3 | 3 | 3 | 1 | 4 | 4 | 4 | 1 | 3 | 4 | M |
| `N16` | 1 | 1 | 1 | 2 | 2 | 5 | 5 | 5 | 5 | 5 | 1 | 5 | 5 | H |
| `N17` | 1 | 1 | 1 | 2 | 1 | 5 | 5 | 5 | 5 | 5 | 1 | 5 | 5 | H |
| `N18` | 3 | 3 | 3 | 2 | 3 | 2 | 4 | 3 | 1 | 5 | 2 | 1 | 3 | L |
| `N19` | 4 | 2 | 3 | 2 | 2 | 3 | 4 | 3 | 3 | 5 | 4 | 1 | 4 | L |
| `N20` | 3 | 1 | 1 | 3 | 3 | 4 | 4 | 4 | 5 | 5 | 1 | 3 | 5 | M |
| `N21` | 3 | 2 | 3 | 2 | 3 | 2 | 2 | 3 | 1 | 5 | 3 | 1 | 3 | L |

### 4.1 Reasoning behind the scores

| ID | Why these scores |
|---|---|
| `E01` | Visual impact is high, but a camera orbit already gives "it moves" for free, and moving shows are industry practice, so Orig is low. On its own it adds choreography, not coordination: it earns its place as the enabler for `E02` |
| `E02` | It answers the difficulty that contract §12 itself states, and it is the strongest coordination story. It changes the most validated logic, in the most contended file. The G1 known miss is recorded in [`tests/g1/g1.beyond.test.ts`](../../tests/g1/g1.beyond.test.ts) (its comment gives the post-pacing count); the 40-centre sweep baseline is re-measured on the `P2-G0` (P) commit before `P2-T31` uses it |
| `E03` | Easy to evaluate (S0 counts) but poor to show: "14 → n" is a README line. The #80 spike, as reported in the PR #96 notes (not recorded in the repo), found that a time-to-collision sidestep made paced-flight counts *worse*, so it must be measured before anyone believes it works |
| `E04` | Cheap and safe, but the minimal slice is base FR-10 evidence, so it fails the increment screen |
| `E05` | The best demonstration of "independent decisions with partial knowledge". Its TF-H depends on #113 mounting the inspector, which Phase 2 does not control, and on a `D1` exception for two hooks. Eval is low: a panel is not a number |
| `E06` | FoundationDB- and Jepsen-style practice applied to a swarm. It has falsifiable output and zero risk to the demo path. Hours are uncertain |
| `E07` | A breakdown point convinces more than one good number, but it has value only after #122's records are archived, and few seeds invite over-reading |
| `E08` | Most of the capability is #105 (base). Phase 2 adds evidence and a beat. Orig 1: physical-clock LWW is textbook |
| `E09` | Honest and cheap as an authoring check, but weak alone. It is valuable as linter `L2` |
| `E10` | The best theme fit ("composition", unverified), but new shapes are shallow, and #112 already covers the visible part |
| `N01` | Same as `E02`. The co-moving frame is a standard idea, and it is clean to explain. Its risk is the jam-plus-lag false vacancy (contract §8.5 limit 6, made more likely by motion). Without feed-forward, lag pushes `rOccEff` past its `slotSpacingMin − rOcc` = 0.9 m cap, so it depends on `N02` (`P2-CC-03`) |
| `N02` | A precondition, not a feature. Rel 5 because a bit-identity test settles it. Regr 3 because it touches `steer.ts` in both arms. Feeding forward the pacing lerp term is a separate, measured option |
| `N03` | About 20 lines, but with pacing the tracking error is small, so the effect may be negligible. Measure it first |
| `N04` | More principled than `N03` and more code. Discrete time, clamps and infeasibility mean it is a heuristic in Encore, never a certificate |
| `N05` | A pure library over snapshots, in the observer's allowed imports. The main risk is a false violation, which is mitigated by headless S0–S5 runs before any readout |
| `N06` | Produces minimal, replayable counterexamples. It is calibrated by rediscovering the known G1 late commit (`INV-QUIET`; the `it.fails` in `tests/g1/g1.beyond.test.ts`), which must be re-confirmed on current `main` first. The cost at `n0` = 40 is unmeasured |
| `N07` | Makes contract §8's core sentence (holes move outward and downward in priority) visible in the existing regional-kill beat, now that Encore flies in the app (#107). It uses real data only (I8). Its colours must not reuse cyan (claim HB) or amber (in transit). Re-scored after screening against `TetherLayer`: tethers already show each claimant flying to its new target, so the increment is narrower (persistence after arrival, commit/pop colours, a count tied to "Slot changes"). Orig 2, Demo 4, Vis 4, confidence M |
| `N08` | Composition with consequences. `L1` has a closed form under #96's shared lerp fraction. A scratch computation found far more ideal-path conflicts than the 14 measured S0 collisions ([RFC §9](../design/ANIMATED_CHOREOGRAPHY_RFC.md#9-score-linter-checks-l1l6)), so `P2-T08` is a calibration report, never a forecast |
| `N09` | Shows how much of the achievable result Encore reaches. Low visual value; risky only if it is read as a competitor |
| `N10` | Pure measurement honesty. It quantifies how far end-of-tick counts undercount. Its O(pairs) cost needs a grid bound |
| `N11` | High on paper. But agreement on k conflicts with staying available in a partition, it needs a `Heartbeat` contract change, and FPS plus the downward cascade already approximates prefix-k |
| `N12` | Honest about a designed blind spot. It touches the contract `EnvEvent`, `world.ts` and the observer's alive semantics. Saying it in the pitch costs nothing |
| `N13` | Adds contract surface for a modest gain in recovery time |
| `N14` | Seek needs world checkpointing that the contract lacks; re-simulating an 1800-tick seek at the recorded 7.7 ms per `stepBoth` takes about 14 s |
| `N15` | An unscripted fault during a judged demo threatens FR-35 and the core beat |
| `N16`, `N17` | No increment: both already exist on `main` |
| `N18` | Changes `expandRecipe`, so every slot of every formation changes and all evidence is invalidated |
| `N19` | `L1` could measure its benefit. It needs an orientation field in `Recipe` |
| `N20` | Marginal: the belief layer already colours by version |
| `N21` | Changes §9 semantics just after #105 validated them. Measure the discontinuity first (`C6`) |

## 5. Ranking by expected competitive contribution

Sorted by ECC-H. "Rank P" is the order by ECC-P. Values are computed from the table in §4 with the formulas in §2.3.

| Rank H | ID | V | D | ECC-H | ECC-P | Rank P | Screens | Outcome |
|---|---|---|---|---|---|---|---|---|
| 1 | `N05` | 3.70 | 4.6 | 2.72 | 3.70 | 5 | pass | `C1`, minimal |
| 2 | `N07` | 3.70 | 4.4 | 2.60 | 3.70 | 4 | pass | `C2`, minimal |
| 3 | `E04` | 3.05 | 5.0 | 2.44 | 3.05 | 11 | **fails increment** | note only (base FR-10) |
| 4 | `E09` | 3.15 | 4.6 | 2.32 | 3.15 | 9 | pass | inside `C3` as `L2` |
| 5 | `N08` | 3.75 | 4.6 | 2.07 | 3.75 | 3 | pass | `C3`, recommended |
| 6 | `E06` | 4.05 | 4.2 | 2.04 | 4.05 | 1 | pass | = `C1` |
| 7 | `N06` | 3.95 | 4.2 | 1.99 | 3.95 | 2 | pass | `C1`, minimal |
| 8 | `N10` | 2.55 | 4.4 | 1.80 | 2.55 | 15 | pass | `C4`, stretch |
| 9 | `E07` | 3.35 | 4.4 | 1.77 | 3.35 | 7 | pass | `C4`, stretch |
| 10 | `E05` | 3.60 | 3.8 | 1.64 | 3.60 | 6 | pass | `C5` (minimal slice stretch; full in Track P) |
| 11 | `E08` | 3.35 | 4.0 | 1.61 | 3.35 | 8 | pass | `C6`, stretch |
| 12 | `N09` | 3.10 | 4.2 | 1.56 | 3.10 | 10 | pass | `C4`, stretch |
| 13 | `N16` | 1.25 | 5.0 | 1.25 | 1.25 | 29 | **fails increment** | reject |
| 14 | `N17` | 1.15 | 5.0 | 1.15 | 1.15 | 30 | **fails increment** | reject |
| 15 | `N20` | 1.90 | 4.4 | 1.00 | 1.90 | 23 | pass | merged into `C5` full |
| 16 | `N15` | 2.25 | 3.2 | 0.86 | 1.80 | 24 | **fails demo safety** | reject |
| 17 | `E10` | 3.10 | 3.4 | 0.84 | 2.48 | 18 | pass | minimal slice inside `C3`; rest deferred |
| 18 | `N02` | 2.80 | 4.2 | 0.47 | 2.80 | 12 | track P | `C7`, first |
| 19 | `E03` | 3.20 | 3.4 | 0.44 | 2.56 | 14 | track P | `C9` |
| 20 | `N19` | 3.00 | 3.6 | 0.43 | 2.40 | 20 | track P | defer |
| 21 | `N01` | 4.15 | 2.4 | 0.40 | 2.49 | 17 | track P | `C8`, flagship |
| 22 | `N12` | 3.00 | 3.2 | 0.38 | 2.40 | 19 | track P | defer |
| 23 | `E02` | 4.15 | 2.2 | 0.37 | 2.49 | 16 | track P | = `C8` |
| 24 | `E01` | 3.20 | 2.8 | 0.36 | 2.56 | 13 | track P | = `C7` |
| 25 | `N04` | 3.20 | 2.8 | 0.36 | 1.92 | 22 | track P | `C9` |
| 26 | `N03` | 2.20 | 4.0 | 0.35 | 2.20 | 21 | track P | `C9`, before `N04` |
| 27 | `N18` | 2.65 | 3.0 | 0.32 | 1.59 | 26 | track P | defer |
| 28 | `N13` | 2.60 | 2.8 | 0.29 | 1.56 | 27 | track P | defer |
| 29 | `N21` | 2.70 | 2.6 | 0.28 | 1.62 | 25 | track P | defer |
| 30 | `N14` | 2.60 | 2.2 | 0.23 | 1.04 | 31 | track P | defer |
| 31 | `N11` | 3.50 | 1.4 | 0.20 | 1.40 | 28 | track P | reject |

What the ranking says, and where the verdict departs from it:

- **Hackathon.** Among candidates that pass every screen, `N05`, `N07`, `N08` and `N06` (with `E06` as their family) lead clearly. They become the minimal set (`C1` + `C2`) and the recommended addition (`C3`). `N10`, `E07`, `E05`, `E08` and `N09` sit in a band 0.2 wide, which is a tie by the framework's rule. Their order in the stretch set is therefore set by dependencies, not by score:
  - `C4` needs #122's records archived.
  - `C5` needs #113 to mount the inspector, and a `D1` exception.
  - `C6` needs only `P2-WP-01`'s run harness (#105 is on `main`).

  The emergency cut order is in [`PHASE2_ROADMAP.md`](../planning/PHASE2_ROADMAP.md#emergency-cut-order).
- **`C1` above `C2` in the minimal set.** `N05` and `N07` are 0.12 apart, a tie. `N07` is a demo-path item (decision `D7`) and needs a browser rehearsal. `C1` is headless and has no regression risk. Both are in the minimal set; the cut order keeps `N06` last.
- **Post-hackathon.** `N02` leads the Track P items on ECC-P (2.80), and it is a precondition for every moving target anyway. `E01`, `E03`, `E02` and `N01` lie within 0.07 of each other, which is a tie. The tie-break on CA then Depth picks `E02`/`N01` as the flagship: CA 5, Depth 5 and the highest Value of any candidate (4.15). Dependencies fix the build order:
  1. `N02` feed-forward (precondition).
  2. `E01` spin (enabler).
  3. `N01`/`E02` healing in motion.
  4. `N03` → `N04`. These follow the flagship because the spike evidence says to measure before believing.

  This is `C7` → `C8` → `C9`, as in [`PHASE2_ARCHITECTURE.md`](../design/PHASE2_ARCHITECTURE.md#2-capabilities-c1c9). [Gate](../planning/PHASE2_ROADMAP.md#gates) `P2-G2`(a) blocks `P2-G3`; `P2-G2`(b) blocks animated formations in a judged demo.
- **`N12` scores close to the Track P items but stays deferred.** Its contract change (`P2-CC-08`) is listed for completeness and not recommended. The limit can be stated in the pitch at no cost.

## 6. Capability mapping

Accepted candidates are bundled into capabilities `C1`–`C9`. The bundles and their contract changes are canonical in [`PHASE2_ARCHITECTURE.md` §2](../design/PHASE2_ARCHITECTURE.md#2-capabilities-c1c9), and their work packages in [`PHASE2_WORK_PACKAGES.md`](../development/PHASE2_WORK_PACKAGES.md). §7.1 lists which candidates feed each one; in addition, `N17` is the caption of `C2`, `N16` a beat of `C6` and `N20` part of `C5` full.

## 7. Verdict lists

### 7.1 Accepted

| Set | Items | Reason |
|---|---|---|
| Minimal (Track H) | `C1` (`N05`, `N06`), `C2` (`N07`) | Highest ECC-H among items that pass every screen. New files only. Each has a defined proof of value: the fuzzer rediscovers the known G1 late commit (`P2-T05`, once re-confirmed on current `main`), and the arrow count equals the observer's `slotChanges` delta (`P2-T06`) |
| Recommended (Track H) | `C3` (`N08`, `E09` minimal, `E10` minimal) | Theme fit, pure and testable. The composer hook is one hook in #112's merged `validateDraft`, added after open #121 (which edits `Composer.ts`) merges and visible once #113 mounts the composer, and it never blocks injection (`P2-T09`) |
| Stretch (Track H) | `C4` (`E07`, `N09`, `N10`), `C5` minimal (`E05`), `C6` (`E08`) | A tie band; `C4` and `C5` depend on base work (#122, #113) that Phase 2 does not control |
| Post-hackathon (Track P) | `C7` (`N02` first, `E01`), `C8` (`N01`, `E02`, flagship; needs `N02`), `C9` (`N03` → `N04`, `N10`), `C5` full (`P2-CC-07`, `N20`) | Highest Value, but each needs a contract change, brain changes and a new evidence revision (`D2`, `D5`) |

### 7.2 Deferred, in order

1. `N12` dark-but-hovering failure: state it as a limit now.
2. `N13` announced graceful leave.
3. `N18` saliency priority: it invalidates every slot.
4. `N19` transition-minimising orientation: measure with `L1` first.
5. `N14` replay scrubber: needs world checkpointing.
6. `N21` deferred adoption: needs `C6`'s measurement first.
7. A simulated oracle **arm**: it needs `AgentBrain.kind` widened and would be a central harness.
8. `E10` new recipe kinds and multi-cue authoring.
9. `E04` full recomposition: only ever operator-triggered, through `INJECT_SCORE`.

### 7.3 Rejected

| Item | Reason |
|---|---|
| `E09` runtime connectivity control | It fights the authored shape. It needs multi-hop estimates and new messages. FPS formations may need gaps larger than `rRadio` |
| `N11` distributed size estimation and recomposition | Agreement on k conflicts with staying available in a partition; two layouts would collide in space. Needs a `Heartbeat` contract change |
| Push-sum, and fleet-wide consensus (Raft/Paxos) | Push-sum loses mass on loss and death. A quorum over `n0` = 200 is unreachable with one-hop radio and no relaying. The score is an LWW register, and that is enough ([contract §9](../design/contracts-and-algorithms.md#9-score-dissemination-and-partitions-adr-005-adr-008)) |
| `N15` live chaos monkey | Fails the demo-safety screen. The headless form is `N06` |
| Merging concurrent scores | A blended choreography is one no operator authored. The LWW loser is discarded by design |
| World-side collision enforcement | A central controller. Violates ADR-009 and I3 |
| Oracle as a competitor | Contract §12 and evaluation §4 allow only the label "oracle upper bound" |
| Re-deriving brain logic in the app (`canHeal` reasons) | Drifts silently from the brain and breaks inspector isolation. Wait for `Belief.why` |
| Repackaging existing behaviour as new (`N16`, `N17`) | Fails the increment screen |
| Sponsor-specific design in Phase 2 docs | Fails the rules screen. Any integration goes only through the provider-neutral boundaries in [`OPTIONAL_INTEGRATION_BOUNDARIES.md`](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md), after `D3` |

## 8. Literature and prior art

Base prior art (Skybrush, CBBA, SwarMer, DASH, mean-shift assembly) is canonical in [evidence §1.2](../context/evidence-and-assumptions.md#12-prior-art). This section covers only the techniques the Phase 2 candidates draw on.

**Rule:** Encore claims none of the techniques below as new. The positioning sentence in evidence §1.2 stays binding unchanged: Encore "invents no new algorithm", and Phase 2 does not change that. The wording rules are in the [claims table](../specification/requirements.md#5-claims-we-must-not-make).

| Technique and prior art | Used by | Applies to Encore when | Encore does **not** claim |
|---|---|---|---|
| Heartbeat failure detection; unreliable failure detectors [31]; SWIM suspicion [33]; phi-accrual [32] | base vacancy detector, `N17`, `N01` | Failures are crash-stop ("kill = disappear"). The detector is a timeout, so at best eventually perfect. Silence can mean loss, range or partition, which is why vacancy also needs sensed emptiness | Any new failure detector, or that Encore "detects dead drones" |
| Alive-but-not-functioning failures [30] | `N12` | Encore's model has no such failure: a stated gap | That the detector handles dark-but-hovering drones |
| Epidemic gossip and anti-entropy [34, 35]; version digests [36] | `E08`, base #105 | One-hop geometric radio graph: dissemination is bounded below by hop diameter, not `log n`. The per-hop delay is unmeasured | O(log n) dissemination; novelty of the digest pattern |
| LWW register as a state-based CRDT [37]; Lamport clocks [38]; HLC [39] | `E08`/`C6`, `N21` | `issuedTick` is the global simulation tick (a physical clock, AS-01). Convergence needs the graph to be eventually connected | A Lamport or causal order; merging; strong consistency during a partition |
| Auctions [22, 23]; CBBA [24, 25] | base priority claims | Loosely: Encore's bids are one-sided, with no prices and no consensus phase | Optimality bounds or a convergence proof (see EV-11) |
| Distributed Hungarian method [26]; optimal assignment | `N09` (prior art only) | `N09` solves no assignment: it is a relaxed per-slot reach bound ([evaluation §3.2](../validation/PHASE2_EVALUATION.md#32-recovery)). Only offline, in the CLI, as "oracle upper bound". Never in a brain | That Encore approaches optimal assignment |
| Swap-based assignment and CAPT [10]; stable matching [27] | base claims, `N19`, `N08` `L1` | CAPT's collision result assumes minimum-sum-of-squares assignment, synchronised straight lines and minimum spacing. #96's shared lerp fraction resembles the synchronised profile, but the assignment is fixed by index | A collision property for transitions; `L1` gives "predicted conflicts under ideal paced flight", not a collision forecast |
| Self-assembly and scale-independent repair [28, 29] | `E04`, `N11` | Encore keeps the scale and thins the density, the opposite trade-off | A novel self-repair method |
| Farthest-point sampling, a k-centre 2-approximation [21] | `E04`, base FR-10 | Over the candidate cloud, not the continuous shape. The formation is scaled for `n0`, not M | Optimal degradation, or a perceptual result (AS-09) |
| Virtual structure [15]; tracking a time-varying reference with feed-forward [16]; formation taxonomy [14] | `C7`, `N02` | Every drone can evaluate `p_ref(t)` and `ṗ_ref(t)` from the score and the synced tick. Encore is position-based | A new moving-formation method |
| Planning in the body frame for rigid motion [15, 10] | `N01`/`C8` | Rigid motion only. Non-rigid motion needs the feasibility guard (`P2-CC-04`) | A new vacancy detector. At most, the combination with the two-signal AND is distinctive, and it is unmeasured |
| Velocity obstacles, RVO, ORCA, AVO [1–4] | `C9` alternative | Their results assume a single integrator, perfect sensing and full reciprocity. Encore is a clamped double integrator at DT = 0.05 | Any collision property |
| Control barrier functions and safety filters [5, 6] | `N04` | Continuous time, an exact model and QP feasibility. Projection sweeps only approximate the QP | A certificate; "collision-free" |
| Potential fields and boids [7–9] | today's `steer`, `N03` | The family has local minima and no safety result under bounded acceleration | Safety at high closing speed |
| Offline show validation [17, 18]; display swarms [13]; centralised swarm planners [11, 12] | `N08`, `C7`, `L6` | As an **offline** validator of the score only; centralised planners do not apply at runtime | That the linter is a safety check |
| Connectivity control [42, 43] | `E09` (runtime rejected) | Only as an authoring-time check | Maintained connectivity |
| Distributed counting: push-sum [44], extrema propagation [45], HyperLogLog [46] | `N11` (rejected) | Not used | — |
| Consensus: Paxos [41], Raft [40] | rejected | Needed only for irreversible group-wide actions, which Encore does not have | — |
| Deterministic simulation testing [47]; history checkers [48]; property testing and shrinking [49, 50]; swarm testing [51] | `C1` | The world is deterministic given seed, params and events, on one JS engine (NFR-03, T04). `stateHash` does not cover in-flight messages or RNG state, so a repro must re-run from tick 0 | Proofs or coverage: "checked properties on these runs, not proofs" |
| Hausdorff and Chamfer distances [19, 20] | base `sfMax`/`sfMean`, `M0`–`M6` | Encore uses the directed versions (shape to drones) | A perceptual fidelity measure |

**Defensibly distinctive, as a combination and not an invention** (wording per the claims table):
- farthest-point priority, so that losses thin the image;
- a two-signal vacancy test that ANDs sensing with heartbeat silence, with no gossiped membership;
- repair that needs only one-hop broadcast;
- a seeded, paired evaluation against a static baseline and an analytic ceiling.

Phase 2 adds two more combinations, both still unmeasured:
- `C1`'s checked properties applied to a swarm protocol;
- `C8`'s co-moving-frame application of the two-signal test.

## 9. Inversion analysis: how Phase 2 could make Encore worse

Risks with owners and triggers are canonical as `P2-R*` in [`PHASE2_ROADMAP.md`](../planning/PHASE2_ROADMAP.md). The rules below are binding on every Phase 2 candidate.

| Failure mode | How it would happen here | Rule |
|---|---|---|
| Feature bloat | Half-wired panels nobody rehearsed | At most two Phase 2 items on the demo path, each tied to a scripted beat (`P2-B*`) or a README number. Everything else stays headless |
| Animation-caused collisions | A breathing hold shrinks spacing below `dAvoid`, or lag shears the sphere | No animated holds in Track H. In Track P, rigid motion and transverse waves only, with feed-forward required and `L6` bounds. Motion S0 collisions must stay within a margin fixed in advance (`P2-G2`(b)) |
| Breaking healing | Any edit to `encoreBrain.ts`, `state.ts` or `steer.ts` | No edits in Track H. In Track P, the G1 suite and the 40-centre sweep must not fall below their count re-measured on the `P2-G0` (P) commit (`P2-T31`), and every "no effect when off" claim needs a bit-identity test (`P2-T23`) |
| Gossip semantic breakage | "Improving" adoption after #105 | No change to contract §9 semantics. `C6` adds scenarios, measurements and visuals only |
| Centralised shortcuts | Oracle logic in a brain; world-side safety; a fuzzer that adapts to beliefs; app code deciding from truth | Oracle only in the CLI or observer, labelled. No world-side safety. Generators work from launch geometry. Isolation tests stay green |
| Performance at 200 | Per-tick checkers, per-frame allocations, an O(n²) swept check | ≤ 0.5 ms/tick/world per addition, measured opt-in with the #118 harness (`P2-T10`, `P2-T18`). Persistent buffers. Incremental checkers. Fuzzing offline at `n0` = 40 |
| Misleading baselines | A steering change in one arm only; a sweep used for tuning; the oracle shown as a rival | Steering changes go to both arms. Sweeps are labelled exploratory, with `paramsHash` (`P2-T11`). Tune on dev seeds only. Keep LOSS rows |
| UI obscuring the core demo | Trails and warnings cluttering the 90 s script | Phase 2 visuals are off by default (X-ray only). FR-35's script is unchanged and its `stateHash` is equal after every merge |
| Sponsor dependency | An SDK or API added for a side prize | Rules screen. No network (NFR-04) until `D3` |
| No validation time | Merging at 08:20 without a browser check | Phase 2 merges close at 07:30. Each item needs a headless test and one browser check. Tag `demo-good-<n>` before every merge; revert first |
| Impressive but shallow | Pretty arrows with no evidence; "novel" claims | Every item yields a test, a repro or a record-traceable number. Wording follows the claims table |
| Silent evidence invalidation | A default-off `Params` field, or a new `EncoreState` field | No `Params` or state fields after #122 starts. Otherwise declare a new revision and re-run (`D5`) |
| Merge contention | Edits to files of open PRs #113, #115, #121, #122 and #82 (§1.4) | Track H is new files only, plus one hook in a file whose owning PR has merged and that no open PR edits (`validateDraft` after #121 merges) |
| Contract churn at night | A `[contract]` PR needs Arnav's attention | Zero `[contract]` PRs in Track H (`D4`: recommend no) |
| Repackaging | Presenting #96, #104, #105, #107, #109, #112, #116, #118 or FR-10 as Phase 2 | Increment screen. Base work is never Phase 2 work |

## 10. Uncertainties

- The ECC weights and every score are judgement (confidence mostly M). Sensitivity was checked by script on the §4 table: moving 0.05 of weight between any two Value dimensions keeps `N05` and `N07` first and second among Track H candidates that pass the screens, and leaves the top five (`N05`, `N07`, `E09`, `N08`, `E06`) unchanged (re-run after the `N07` re-score). Screens and tracks do not depend on scores.
- Agent-hour estimates are unmeasured, and so is the run time at `n0` = 40 for ddmin.
- The challenge text (Neptune North) is uncaptured (#1). CA rests on EV-08, which is unverified, and the ranking does not depend on sponsor fit.
- `pacedSlotPos` lives in `src/agent/steer.ts:114`, not in `src/score`. `P2-CC-02` proposes moving it to `src/score` byte for byte (with a new `pacedSlotVel`), `steer.ts` re-exporting it; the [choreography RFC §3.5](../design/ANIMATED_CHOREOGRAPHY_RFC.md#35-composition-with-paced-targets-96) owns this.

## 11. Open questions

- **`N07` trail onset.** Drawing an arrow only once the claimant is within `rOcc` of its new target (§3.2) avoids overlapping its tether, but the arrow then lags the commit by the flight time, so the "ripple runs inward" beat ([P2-B1](../demo/PHASE2_JUDGING_STORYBOARD.md#p2-b1-repair-cascade-trail)) shows late. The alternative draws at commit and adds what tethers cannot show (the hop index along a chain). Neither is measured; `P2-WP-03` owns the choice and needs an acceptance check that no trail segment is drawn while that drone's tether is drawn.

## References

The numbers are local to this file. "From knowledge" means the research packs did not re-check the item in this session: check the primary source before quoting it.

1. P. Fiorini, Z. Shiller. Motion planning in dynamic environments using velocity obstacles. IJRR 17(7), 1998. https://www.osti.gov/biblio/665350
2. J. van den Berg, M. Lin, D. Manocha. Reciprocal velocity obstacles for real-time multi-agent navigation. ICRA 2008. https://www.cs.unc.edu/~geom/RVO/icra2008.pdf
3. J. van den Berg, S. J. Guy, M. Lin, D. Manocha. Reciprocal n-body collision avoidance. ISRR 2009 / Springer 2011. https://gamma.cs.unc.edu/ORCA/ · https://github.com/snape/RVO2
4. J. van den Berg, J. Snape, S. J. Guy, D. Manocha. Reciprocal collision avoidance with acceleration-velocity obstacles. ICRA 2011. https://gamma.cs.unc.edu/AVO
5. L. Wang, A. D. Ames, M. Egerstedt. Safety barrier certificates for collisions-free multirobot systems. IEEE T-RO 2017. https://resolver.caltech.edu/CaltechAUTHORS:20170215-165434009
6. U. Borrmann, L. Wang, A. D. Ames, M. Egerstedt. Control barrier certificates for safe swarm behavior. IFAC ADHS 2015. https://repository.gatech.edu/entities/publication/d09cfcf4-bce7-4aed-bceb-b880d233ceae
7. C. W. Reynolds. Flocks, herds and schools: a distributed behavioral model. SIGGRAPH 1987. (from knowledge)
8. O. Khatib. Real-time obstacle avoidance for manipulators and mobile robots. IJRR 5(1), 1986. (from knowledge)
9. Y. Koren, J. Borenstein. Potential field methods and their inherent limitations for mobile robot navigation. ICRA 1991. (from knowledge)
10. M. Turpin, N. Michael, V. Kumar. CAPT: concurrent assignment and planning of trajectories for multiple robots. IJRR 33(1), 2014. https://ri.cmu.edu/publications/capt-concurrent-assignment-and-planning-of-trajectories-for-multiple-robots (the exact spacing condition is from memory: check the paper)
11. J. A. Preiss, W. Hönig, G. S. Sukhatme, N. Ayanian. Crazyswarm: a large nano-quadcopter swarm. ICRA 2017. https://act.usc.edu/publications/Preiss_ICRA2017.pdf
12. W. Hönig, J. A. Preiss, T. K. S. Kumar, G. S. Sukhatme, N. Ayanian. Trajectory planning for quadrotor swarms. IEEE T-RO 34(4), 2018. https://act.usc.edu/publications/Hoenig_TRO2018.pdf
13. J. Alonso-Mora, A. Breitenmoser, M. Rufli, R. Siegwart, P. Beardsley. Image and animation display with multiple mobile robots. IJRR 2012. https://studios.disneyresearch.com/?p=29480
14. K.-K. Oh, M.-C. Park, H.-S. Ahn. A survey of multi-agent formation control. Automatica 53, 2015. https://dblp.org/rec/journals/automatica/OhPA15.html
15. M. A. Lewis, K.-H. Tan. High precision formation control of mobile robots using virtual structures. Autonomous Robots 4, 1997. (from knowledge)
16. W. Ren. Multi-vehicle consensus with a time-varying reference state. Systems & Control Letters 56, 2007. (from knowledge; check the exact title)
17. Intel Shooting Star press coverage. https://techcrunch.com/?p=1446096 (secondary source; EV-10 says not to cite specifics)
18. Skybrush Studio safety checks and transitions. https://docs.skybrush.io/public/skybrush-studio-for-blender/latest/panels/safety_and_export/safety_check.html
19. D. P. Huttenlocher, G. A. Klanderman, W. J. Rucklidge. Comparing images using the Hausdorff distance. IEEE PAMI 15(9), 1993. (from knowledge)
20. H. G. Barrow et al. Parametric correspondence and chamfer matching. IJCAI 1977; H. Fan, H. Su, L. Guibas. A point set generation network for 3D object reconstruction. CVPR 2017. (from knowledge)
21. T. F. Gonzalez. Clustering to minimize the maximum intercluster distance. TCS 38, 1985; Y. Eldar et al. The farthest point strategy for progressive image sampling. IEEE TIP 6(9), 1997. (from knowledge)
22. D. P. Bertsekas. The auction algorithm: a distributed relaxation method for the assignment problem. Annals of OR 14, 1988. (from knowledge)
23. M. B. Dias, R. Zlot, N. Kalra, A. Stentz. Market-based multirobot coordination: a survey and analysis. Proc. IEEE 94(7), 2006. (from knowledge)
24. H.-L. Choi, L. Brunet, J. P. How. Consensus-based decentralized auctions for robust task allocation. IEEE T-RO 25(4), 2009. https://dspace.mit.edu/handle/1721.1/52330
25. L. Johnson, S. Ponda, H.-L. Choi, J. How. Asynchronous decentralized task allocation for dynamic environments. AIAA Infotech 2011. (from knowledge)
26. S. Chopra, G. Notarstefano, M. Rice, M. Egerstedt. A distributed version of the Hungarian method for multirobot assignment. IEEE T-RO 33(4), 2017. https://arxiv.org/abs/1805.08712
27. D. Gale, L. S. Shapley. College admissions and the stability of marriage. Amer. Math. Monthly, 1962. (from knowledge)
28. M. Rubenstein, A. Cornejo, R. Nagpal. Programmable self-assembly in a thousand-robot swarm. Science 345(6198), 2014. https://ssr.princeton.edu/sites/g/files/toruqf2946/files/documents/science2014-rubenstein.pdf
29. K. Stoy, R. Nagpal. Self-repair through scale independent self-reconfiguration. IROS 2004. (from knowledge)
30. A. F. T. Winfield, J. Nembrini. Safety in numbers: fault-tolerance in robot swarms. IJMIC 1(1), 2006. (from knowledge)
31. T. D. Chandra, S. Toueg. Unreliable failure detectors for reliable distributed systems. JACM 43(2), 1996. (from knowledge)
32. N. Hayashibara, X. Défago, R. Yared, T. Katayama. The φ accrual failure detector. SRDS 2004. (from knowledge)
33. A. Das, I. Gupta, A. Motivala. SWIM: scalable weakly-consistent infection-style process group membership protocol. DSN 2002. (from knowledge)
34. A. Demers et al. Epidemic algorithms for replicated database maintenance. PODC 1987. (from knowledge)
35. R. Karp, C. Schindelhauer, S. Shenker, B. Vöcking. Randomized rumor spreading. FOCS 2000. (from knowledge)
36. R. van Renesse, D. Dumitriu, V. Gough, C. Thomas. Efficient reconciliation and flow control for anti-entropy protocols. LADIS 2008. (from knowledge)
37. M. Shapiro, N. Preguiça, C. Baquero, M. Zawirski. Conflict-free replicated data types. SSS 2011. https://inria.hal.science/inria-00609399 (from knowledge; URL not re-checked)
38. L. Lamport. Time, clocks, and the ordering of events in a distributed system. CACM 21(7), 1978. (from knowledge)
39. S. Kulkarni, M. Demirbas et al. Logical physical clocks. OPODIS 2014. (from knowledge)
40. D. Ongaro, J. Ousterhout. In search of an understandable consensus algorithm. USENIX ATC 2014. https://raft.github.io/raft.pdf (from knowledge; URL not re-checked)
41. L. Lamport. Paxos made simple. 2001. (from knowledge)
42. M. M. Zavlanos, G. J. Pappas. Potential fields for maintaining connectivity of mobile networks. IEEE T-RO 23(4), 2007. (from knowledge)
43. M. M. Zavlanos, M. Egerstedt, G. J. Pappas. Graph-theoretic connectivity control of mobile robot networks. Proc. IEEE 99(9), 2011. (from knowledge)
44. D. Kempe, A. Dobra, J. Gehrke. Gossip-based computation of aggregate information. FOCS 2003. (from knowledge)
45. C. Baquero, P. S. Almeida, R. Menezes, P. Jesus. Extrema propagation: fast distributed estimation of sums and network sizes. IEEE TPDS 23(4), 2012. https://hdl.handle.net/1822/33841
46. P. Flajolet, É. Fusy, O. Gandouet, F. Meunier. HyperLogLog. AofA 2007. (from knowledge)
47. J. Zhou et al. FoundationDB: a distributed unbundled transactional key value store. SIGMOD 2021. DOI 10.1145/3448016.3457559. https://muratbuffalo.blogspot.com/2022/03/foundationdb-distributed-unbundled.html (summary)
48. K. Kingsbury. Jepsen. https://jepsen.io (from knowledge)
49. K. Claessen, J. Hughes. QuickCheck: a lightweight tool for random testing of Haskell programs. ICFP 2000. (from knowledge)
50. A. Zeller, R. Hildebrandt. Simplifying and isolating failure-inducing input. IEEE TSE 28(2), 2002. (from knowledge)
51. A. Groce, C. Zhang, E. Eide, Y. Chen, J. Regehr. Swarm testing. ISSTA 2012. (from knowledge)
