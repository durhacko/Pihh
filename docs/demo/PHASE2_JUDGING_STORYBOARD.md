# Phase 2 judging storyboard

> **STATUS: PROPOSED — NOT IMPLEMENTED.** None of the beats below exists in the app, the CLI or the rehearsed demo. This is a proposal for later integration into the demo. It does **not** replace [`DEMO_PLAN.md`](DEMO_PLAN.md), which Haris owns (#7, per its banner) and which remains the only pitch and rehearsal plan. Whether any beat reaches the judged path is decision D7 ([roadmap](../planning/PHASE2_ROADMAP.md#decisions-for-arnav)).

Purpose: where Phase 2 capabilities could appear in the existing 90-second and 3-minute demos, what the judge sees, the data behind it, the exact wording, and the fallback. Status: proposal, issue #110. Audit base: `origin/main` 26b438a (first audited at 7a50a69); changes since the first audit are noted once in [PHASE2_ARCHITECTURE §1](../design/PHASE2_ARCHITECTURE.md#1-scope-sources-and-status-labels). Owner: Arnav (Phase 2 architecture, issue #110).

This file is canonical only for the demo beats `P2-B1`…`P2-B6`. Capabilities `C1`–`C9` and proposed requirements are in [PHASE2_ARCHITECTURE](../design/PHASE2_ARCHITECTURE.md). Gates `P2-G0`–`P2-G6`, decisions `D1`–`D7`, risks and the cut order are in [PHASE2_ROADMAP](../planning/PHASE2_ROADMAP.md). Work packages `P2-WP-nn` are in [PHASE2_WORK_PACKAGES](../development/PHASE2_WORK_PACKAGES.md). Tests `P2-Tnn`, invariants `INV-*`, the repro format, scenarios `M0`–`M6`, `X1`–`X3` and `FZ1` are in [PHASE2_EVALUATION](../validation/PHASE2_EVALUATION.md). The canonical script is [experience §9](../design/experience-and-demo.md#9-scripted-demo); ticks here are from DEMO_PLAN's [Known-good demo path](DEMO_PLAN.md#known-good-demo-path), which lists how the build differs.

## 1. Rules for Phase 2 on the demo path

1. **At most two Phase 2 items on the judged demo path** (decision D7). The judged path is the 90-second script plus the 60–90 s table pitch in [`DEMO_PLAN.md`](DEMO_PLAN.md). The candidates are `P2-B1` (C2) and `P2-B2` (C1); the roadmap recommends `P2-B1` if rehearsed by 07:30, and for `P2-B2` only the repro and headless results, not the live readout. Every other beat belongs to the 3-minute script, to hands-on time at the table, or to after the hackathon.
2. **Everything is off by default.** Each Phase 2 view sits behind its own opt-in switch. It draws only in X-ray, and the default view looks exactly as it does today. The switch mechanism belongs to the work package. A URL flag read by the self-registering layer itself is suggested because it needs no `main.ts` edit.
3. **The script does not change.** `DemoScript.ts`, its ticks, seed `101` and its events stay as they are. A Phase 2 beat may only add something to look at during an existing beat. Phase 2 code is renderer-side or observer-side, so the scripted run's `stateHash` must be identical with the beat on and off (`P2-G5`).
4. **Performance budget.** Each addition costs at most 0.5 ms per tick per world at `n0` = 200, timed opt-in with `P2_PERF=1` (`P2-T10`, `P2-T18`; method in [PHASE2_EVALUATION §12](../validation/PHASE2_EVALUATION.md#12-performance-criteria)). The frame budget is [experience §10](../design/experience-and-demo.md#10-performance): "both worlds ≤ 3 ms" (SHOULD). Browser checks reuse the #118 harness (`scripts/perf/run.mjs`, [QA](QA.md)) rather than a new timing framework. The 0.5 ms covers simulation-side `ingest` only, not the extra draw calls. X-ray is already the slow mode: the only recorded browser run (software rendering, [`assets/qa/perf.md`](../../assets/qa/perf.md)) gives 14.24 sim ticks/s for "single view + X-ray" against 19.98 without, and the beat timings assume 20. So each X-ray beat (`P2-B1`, `P2-B2`) also needs the harness's "single view + X-ray" and "split view + X-ray" rows with the layer on and off, on the presentation laptop; the beat is dropped if sim ticks/s falls measurably below the layer-off value.
5. **Time box and cut order.** The beats follow the global trigger, the rungs and the 07:30 merge close in the [roadmap](../planning/PHASE2_ROADMAP.md#emergency-cut-order); a global cut means no Phase 2 beat is shown. Mapped to beats, the order is `P2-B4` and the minimal `P2-B6` (rung 2), `P2-B3` (rung 3), the live readout in `P2-B2` (rung 4), `P2-B1` (rung 5), and the repro in `P2-B2` last (rung 6). Anything not merged, tested and browser-checked by 07:30 stays on its branch. Tag `demo-good-<n>` before every Phase 2 merge.
6. **Base work is never presented as Phase 2.** These are all base work: gossip (#105), paced targets (#96), the composer and console (#112), the timeline (#109), the Encore brain in the app (#107), the scripted demo (#104, #119), the app shell that mounts the composer, inspector and ghost slots (#113), the CLI Encore arm (#116), the perf harness (#118) and the evidence matrix (#122).

## 2. Base the beats stand on

Status at `26b438a`: (a) implemented and tested on main · (b) implemented, not integrated · (c) open PR or active · (d) documented only · (e) not present. **Re-check before any rehearsal**: #113 decides whether the composer and inspector are visible at all.

| Base item | Status at `26b438a` | Needed by |
|---|---|---|
| Encore brain in the app (#107) | (a) | `P2-B1`, `P2-B2`, `P2-B4`, `P2-B6` |
| Scripted 90 s demo, `src/app/ui/DemoScript.ts` (#104; constants #119) | (a): headless tests; DEMO_PLAN says "scripted, not yet rehearsed by a person" | `P2-B1`, `P2-B2` |
| Score gossip (#105) | (a); incoming scores are checked only for version and non-empty `movements` | `P2-B4` |
| Paced targets (#96, `[contract]`) | (a): `pacedSlotPos` in `src/agent/steer.ts` | `P2-B3` (L1 restates the pacing rule) |
| Composer, `validateDraft` (returns `warnings[]`), console (#112) | (b): merged, not mounted by `main.ts`; mounting is #113 (c) | `P2-B3` |
| Inspector and truth box | (b): `connectInspector` is never called; mounting is #113 (c) | `P2-B6` |
| 3-minute script | (d) [experience §9](../design/experience-and-demo.md#9-scripted-demo); `demo run 180` in the console replies "planned" | `P2-B3`, `P2-B4`, `P2-B6` |
| CLI Encore arm (#116) | (a): `ARMS` = static, encore in `src/cli/brains.ts` | `P2-B2` (the fuzzer runs the Encore arm) |
| Evidence matrix (#122) | (c); `results/` holds only `README.md` | Every spoken number |
| Animated holds | (e) | `P2-B5` |

## 3. Where the beats slot

Script facts (seed 101, `n0` = 200): X-ray on at 12 s (tick 240), a regional `KILL` of 20 drones over the first **E** at 20 s (tick 400), the sphere at 48 s (tick 963), `JAM_ON` at 61 s (tick 1220), injection into drone 151 at 64 s (tick 1280), `JAM_OFF` at 73 s (tick 1460), and X-ray off at 82 s (tick 1640).

| Beat | Track, capability | Slot | Added time | Judged path? |
|---|---|---|---|---|
| `P2-B1` Repair cascade trail | H, C2 | 90 s script, 20–48 s (ticks 400–963), X-ray already on | 0 s (overlay) plus one spoken sentence of 5 s or less | Candidate (D7; recommended) |
| `P2-B2` "How do you know it works?" | H, C1 | The readout is passive during X-ray (12–82 s). The repro goes in pitch beat 5, "Learning" (15 s), or in Q&A | 15 s | Candidate (D7; repro only recommended) |
| `P2-B3` Composer linter warning | H, C3 | Hands-on time at the table (FR-36: the judge types a word), or 3-minute script step 8 | 20 s | No |
| `P2-B4` Dual injection across a partition | H stretch, C6 | 3-minute script, steps 6–7 | 45–60 s | No |
| `P2-B5` Kill during a spinning sphere | P, C7 + C8 | A future script revision; not this hackathon | 30 s | No (post-hackathon) |
| `P2-B6` Knowledge versus truth inspector | P (minimal form: H stretch only with a D1 exception), C5 | 3-minute script step 3 | 20 s | No |

## 4. Beats

Claim wording is checked against [requirements §5](../specification/requirements.md#5-claims-we-must-not-make) and the "How we word it" column in [evidence §2](../context/evidence-and-assumptions.md#2-assumptions). Under the claims table, every spoken number must come from a `RunRecord`, from a file in the repo, or from the HUD's observer count for the run on screen ("Quote only the displayed run's recorded counts", [DEMO_PLAN](DEMO_PLAN.md#anticipated-questions)); check it there first. X, Y and N stand for numbers read from that source.

**Headless demo-script check (before D7).** Roadmap D7 and `P2-G5` require the canonical script run headless with the `INV-*` checkers (also `P2-T02`'s last clause). The proposed runner is `tests/observer/demoScriptInvariants.test.ts` in `P2-WP-01`: it drives `createWorlds` with the `DemoScript` intents, as `tests/app/demo.test.ts` does, feeds both worlds' snapshots to `createInvariantChecker`, and prints the violations. It is not yet in `P2-WP-01`'s allowed files (open question 1). The same run records the `P2-B1` trail numbers below.

### P2-B1 Repair cascade trail

| Field | Proposal |
|---|---|
| Slot and duration | The existing regional-kill beat, 20–48 s, with X-ray on as the script leaves it. The overlay adds no time. The presenter adds one sentence |
| On screen | Encore view only: an arrow from each drone's old `belief.target` to its new one, fading over 120 ticks (6 s). The only measurement of this beat ([DEMO_PLAN](DEMO_PLAN.md#known-good-demo-path), headless at `9f78902`) is 8 claims by 30 s, so expect about 8 arrows between 21 s and 30 s, gone again from about 36 s. Whether any of them chain (a drone moving into a slot another has just vacated) is unmeasured; the final wording comes from the measured row below, and says "chain" only if depth > 1 was observed. The static arm draws none. `P2-WP-03` picks colours that reuse no existing meaning (cyan claims, amber in-transit, magenta `SCORE`, vermilion vacancy, white selection; [experience §3](../design/experience-and-demo.md#3-view-layers)) |
| Data source | Per tick, diffs of `WorldSnapshot.drones[i].belief.slot` and `belief.target`, received through `Layer.ingest`. Optional caption: the real `RadioEvent`s with `claimSlot` equal to the new slot in the preceding `claimWindow` ("claim heard by k drones"). That is the same log the radio X-ray uses (I8) |
| Measured (before D7) | From the headless demo-script check, seed 101, Encore arm: arrows (`changes`), commits / pops, chain depth (longest run of commits each into the slot the previous one vacated), first and last commit tick. **Pending: not yet run.** Until then the beat is not shown |
| Say | Spoken inside the measured commit window (about 21–30 s), not after the arrows fade: "Each arrow is a slot change one drone decided from what it sensed and heard. Nearby survivors move to more important slots; low-priority detail is given up and the image thins. Repair is local and greedy: only survivors that sense the gap move." Add "each move frees a slot the next drone fills" only if chain depth > 1 was measured |
| Never say | "Self-healing restores the image", "heals any damage", "optimal" |
| Evidence a judge can inspect | `P2-T06`: the arrow count equals the observer's `slotChanges` delta, there is no arrow without a belief change, and the static arm draws none. The same seed replayed headless gives the same `stateHash` with the layer on and off |
| Visible decentralisation | Agent knowledge: the arrows come from each drone's own `belief`. Observer truth: the HUD's nPWC for both arms and the death markers. Repair stops where no survivor senses the gap ([contract §8.5](../design/contracts-and-algorithms.md#85-known-limits-state-these-dont-hide-them), limit 1) |
| Fallback | Switch the trail off and run the base beat unchanged. Off stage, show a labelled clip recorded from a rehearsed build, if one exists, and the `P2-T06` test output |
| Trigger | Presenter, by enabling the switch before pressing **D**. Arnav answers algorithm follow-ups (DEMO_PLAN's Q&A owner) |
| Prerequisites | `P2-WP-03`; `P2-WP-01` (the headless demo-script check D7 requires); `P2-T06`, `P2-T18`; the measured row filled in; the X-ray perf rows of §1 rule 4; gates `P2-G0` (H) and `P2-G5` ([roadmap](../planning/PHASE2_ROADMAP.md#gates)); browser-checked by 07:30 |

### P2-B2 "How do you know it works?"

| Field | Proposal |
|---|---|
| Slot and duration | **Readout:** a small X-ray legend, passive from 12 s to 82 s ("Checked on this run, not proofs", with each check's state, or the first violation's tick and drone). **Repro:** 15 s in pitch beat 5, "Learning", or as a Q&A answer, shown in a terminal |
| On screen | The three checks a layer can run from snapshots (`INV-DUP`, `INV-MONO`, `INV-QUIET` derived); the other three are CLI-only (`P2-WP-06`). The legend is too dense to read in seconds, so it stays off the judged path (D7 recommendation). For the repro, the terminal shows the shrink line (`shrink.fromUnits → toUnits`, runs to discovery) and the `--replay` output (same `INV` at the same first tick), not the raw `p2-repro/1` JSON ([format](../validation/PHASE2_EVALUATION.md#62-fuzz-campaign-fz1-track-h)) |
| Data source | **Readout:** the invariant checkers running over the per-tick snapshots (truth, I6). **Repro:** the file `P2-WP-02` writes from an `FZ1` campaign |
| Honest content | The counterexample shown is **a real known limit, not a staged bug**. In 17 of 200 runs of the G1 sweep at 40 drones, a four-hop repair chain committed 20.2–21.7 s after the kill, past the 20 s quiet window ([CURRENT_STATE](../CURRENT_STATE.md#g1-result-honestly)). Calibration test `P2-T05` requires the fuzzer to rediscover this through `INV-QUIET` unaided; re-confirm the miss on current main first (the `it.fails` case in `tests/g1/g1.beyond.test.ts`). The sweep found this case, not the fuzzer: a pass of `P2-T05` shows the tool works (its shrunk repro is the G1 clumped kill again), not a new discovery. **If `P2-T05` has not passed, the repro part is not shown** |
| Live risk | The demo kills 20 drones at `n0` = 200, more than the G1 test, so a live `INV-QUIET` violation is plausible. The headless demo-script check (§4 intro) runs before D7. If it violates, keep the readout off or present it as this known limit |
| Say | "We wrote our stated limits down as machine-checked properties. As a calibration, the fuzzer rediscovered, unaided, the late-repair case our sweep had already found, in N runs, and shrank an M-event schedule to a single k-drone kill. On these runs it found no unexcused duplicate, monotonicity or silence violation: checked properties, not proofs." A no-violation count is quoted only with the rule-of-three wording of [PHASE2_EVALUATION §11](../validation/PHASE2_EVALUATION.md#11-statistics) |
| Never say | "Proven", "guaranteed", "always converges", "bug-free", "our fuzzer found" the late-repair case |
| Evidence a judge can inspect | The repro file; `P2-T01`–`P2-T05` (checkers on synthetic histories, clean on S0–S5, fuzzer determinism, ddmin 1-minimality, calibration); `P2-T10` (readout cost and `stateHash` identity) |
| Visible decentralisation | The checkers are observer-side and decide nothing. The fuzzer is the environment: it emits only `EnvEvent`s from launch geometry, never adapted to brain state |
| Fallback | Readout misbehaves: switch it off. Repro: a printed CLI output, or a README table of the campaign (schedules run, violations by invariant, with commands) |
| Trigger | The presenter switches to the terminal. Arnav answers follow-ups |
| Prerequisites | `P2-WP-01`, `P2-WP-02`, `P2-WP-06`; the CLI Encore arm (base, #116); `P2-T01`–`P2-T05`, `P2-T10`, `P2-T18`; gates `P2-G0` (H), `P2-G5`. The readout appears only after `P2-T02` is clean and only with the X-ray perf rows of §1 rule 4 |

Prior art: deterministic simulation testing (FoundationDB, Zhou et al., SIGMOD 2021); history checking (Jepsen); shrinking (QuickCheck, Claessen and Hughes 2000; ddmin, Zeller and Hildebrandt 2002); swarm testing (Groce et al., ISSTA 2012). None of this is new. Name a source in the pitch only after reading it ([evidence §1.2](../context/evidence-and-assumptions.md#12-prior-art)).

### P2-B3 Composer linter warning

| Field | Proposal |
|---|---|
| Slot and duration | 20 s of hands-on time after the 90 s script: the judge types a word (FR-36) in the composer before injecting. The 90 s script injects through a control intent and never opens the composer |
| On screen | Composer warnings, next to the existing ones. Illustrative strings, numbers invented: "k predicted conflicts under ideal paced flight (no avoidance)", "k radio islands", "k slots no neighbour can repair"; replace them with output from the committed `P2-T08` report. **Inject** stays enabled. Expect large counts: one scratch run found 183 ideal-path pairs below `dCollide` at launch and 25 in A → B, against 14 measured collisions per S0 run ([choreography RFC §9.2](../design/ANIMATED_CHOREOGRAPHY_RFC.md#92-l1-predicted-conflicts-under-ideal-paced-flight-no-avoidance)), so a judge may see many predicted conflicts and few collisions |
| Data source | Linter checks L1–L5 in `src/cli/lint.ts` ([choreography RFC §9](../design/ANIMATED_CHOREOGRAPHY_RFC.md#92-l1-predicted-conflicts-under-ideal-paced-flight-no-avoidance)), imported by the composer and appended to `validateDraft().warnings` (`P2-WP-05`). Operator-side, authoring time only |
| Say | "These are predicted conflicts under ideal paced flight with no avoidance, not a collision forecast. Collisions are counted from true positions: X and Y in this run." X and Y are the HUD's observer counts for the run on screen |
| Never say | "Collision-free", "safe", "verified show", "fewer warnings means fewer collisions" |
| Evidence a judge can inspect | `P2-T07` (L1 closed form equals brute-force sampling); `P2-T08` (calibration report of predicted against measured S0 collisions; never a forecast claim, not a pass line); `P2-T09` (a warning never blocks injection) |
| Visible decentralisation | The linter runs before the score exists in the swarm. After injection, the score still enters **one** drone (I7) and spreads only along real `SCORE` lines in X-ray |
| Fallback | Ignore the warning and inject: it cannot block. Off screen, show the committed lint report under `results/phase2/lint/` (`P2-T08`), or run `npx tsx src/cli/lintReport.ts --n0 200` (the CLI entry; `src/cli/lint.ts` is the pure library and has none) |
| Trigger | The judge, with the presenter |
| Prerequisites | `P2-WP-04`, `P2-WP-05`; #113 mounts the composer; `P2-T07`–`P2-T09`; gate `P2-G5` |

Prior art: offline show safety checks (Skybrush Studio safety checks; Intel Shooting Star as reported). Composition is the theme only as reported to the team.

### P2-B4 Dual injection across a partition: two colours, then one

| Field | Proposal |
|---|---|
| Slot and duration | 3-minute script, steps 6–7, extended. `PARTITION_ON`, then inject different recipes into one drone on each side, then `PARTITION_OFF`. About 45–60 s. **Shown only if C6 is done (`P2-WP-10`, `P2-T14`) and the beat is rehearsed** |
| On screen | Belief colours. Each group shows its own new colour, and the partition tint marks the groups. After reconnection, the later `issuedTick` colour spreads everywhere and the legend count of the other colour falls to zero |
| Data source | `belief.version` (agent knowledge) through the existing belief layer; `partitionSide` and `MetricsSample.versions` (observer truth); real `SCORE` `RadioEvent`s in X-ray |
| Say | "Cut-off drones keep flying the score they have; new scores do not cross a jam or partition. After reconnection the later issue time wins everywhere; ties go to the higher origin. Churn in this run: X slot changes, measured. Collisions in this run: X (Encore) and Y (static), counted from true positions." Every S5-type claim states the collision cost: the S5 minimum matrix measured 103 collisions for Encore against 14 for static (#123, recorded on `main` after the audit base) |
| Never say | "Consensus", "merges the two scores", "jam-proof" |
| Assumptions to state | AS-01: "Drones share a time reference, and drift is not modelled". The order is last-writer-wins on a physical clock with an id tiebreak (Shapiro et al. 2011), not a Lamport clock. Contract §8.5 limits 7–9 apply (an injection pauses healing for `tStable`) |
| Evidence a judge can inspect | `X3` exploratory output under `results/phase2/x3/`, with `paramsHash`, labelled exploratory, including its collisions against static; `P2-T14`; `INV-CONVERGE`; [contract §9](../design/contracts-and-algorithms.md#9-score-dissemination-and-partitions-adr-005-adr-008) |
| Visible decentralisation | Two versions fly at once because nothing global reconciles them. They converge only through delivered messages |
| Fallback | Read the version counts from the HUD or legend. If the beat fails, show the `X3` table. Never stage the merge |
| Trigger | Presenter, by hand (**P**, then **I** on a drone on each side, then **P**), or from the console once #113 mounts it |
| Prerequisites | `P2-WP-10`; `P2-T14`; gate `P2-G5`. `X3` uses fixed ticks, recipes and drones, so it says little about a hand-driven run: record the rehearsed beat's event log, replay it headless (the base T13 path) with the `INV-*` checkers, and require `INV-CONVERGE` to hold and churn to stay within the `X3` bound on that log. The two injections must carry different versions: equal versions with different content never converge. The static arm ignores both injections, and that is reported as a capability difference (FR-24) |

### P2-B5 Kill during a spinning sphere, healed while spinning (Track P, future)

| Field | Proposal |
|---|---|
| Slot and duration | A future script revision, after the hackathon. A regional kill during a sphere hold that spins at 0.2 rad/s about the vertical axis. About 30 s. **Not shown at DurHack**: no animated hold exists (e) |
| On screen | The hole refills from its rim while the sphere keeps spinning (`P2-B1` trail in the co-moving frame). The static arm, flying the same animated score, keeps the hole |
| Data source | Belief diffs as in `P2-B1`; observer occupancy at `slotPosAt(tick)` (`P2-CC-06`) |
| Say (only after `P2-G3`) | "Survivors judge vacancies relative to the moving formation; settled in our tests within X s on scenario `M2`, measured, not guaranteed." Today AS-10 limits the claim: "Repair is tested for failures during a hold" |
| Evidence | `M1`/`M2` records; `P2-T26`–`P2-T28`, `P2-T31` (no regression from 183/200) |
| Visible decentralisation | The inspector shows a drone's relative settle test (`Belief.why`), so judges see the drone's view next to the observer's slot rings |
| Fallback | None live. Point to [ADAPTIVE_RECOVERY_AND_SAFETY_RFC](../design/ADAPTIVE_RECOVERY_AND_SAFETY_RFC.md) and [ANIMATED_CHOREOGRAPHY_RFC](../design/ANIMATED_CHOREOGRAPHY_RFC.md) |
| Prerequisites | `P2-WP-20`–`P2-WP-23`, `P2-WP-25`–`P2-WP-29`, `P2-WP-31`; `P2-CC-01`…`P2-CC-07` (CC-04 depends on CC-03; CC-07 is `Belief.why`, for the inspector view); gates `P2-G1`, `P2-G2` (a) and (b) (b blocks any animated formation in a judged demo), `P2-G3`; decisions D2, D5 |

### P2-B6 Knowledge versus truth inspector (Track P; a minimal form is a Track H stretch only with a D1 exception)

| Field | Proposal |
|---|---|
| Slot and duration | 3-minute script step 3. With a drone selected, kill its neighbour. The dead peer first appears under "believed alive, truth: dead", then, once unheard for `tSuspect`, leaves it and is no longer believed alive, while the observer box says dead. About 20 s |
| On screen | The inspector's three peer groups for the selected drone, as defined in `P2-WP-09` (including "silent, not dead", which covers live peers only). No group shows a "suspected" dead peer; the peer simply drops out (open question 3). The truth column stays in the inspector's Observer section, marked "not visible to this drone". **Track P:** a reason line produced by the brain, for example "cannot heal: target changed 2.1 s ago" |
| Data source | **Minimal form:** `inspect().state.peers`, read generically and guarded so a missing field hides the section, plus `inspectorTruth` (`P2-WP-09`). **Full form:** `Belief.why` (`P2-CC-07`, `P2-WP-29`). The app never re-derives brain logic |
| Say | Minimal form, peer belief against truth only: "This is who drone 17 believes is alive, from the heartbeats it hears. Its neighbour is dead, but it still counts it until the heartbeats have been missing long enough. The Observer box is the truth, which the drone cannot see." AS-02: "A drone never learns who it sees". The vacancy-inference sentence ("a slot it senses empty plus missing heartbeats") belongs to the full form only, which shows `Belief.why` |
| Never say | "Detects dead drones" |
| Evidence a judge can inspect | `P2-T13`, `P2-T34`; the inspector isolation tests |
| Visible decentralisation | This is the clearest view of rule I1 against rule I6 in the app |
| Fallback | Base inspector fields only (`Belief`, `log`). If #113 has not mounted the inspector, skip the beat |
| Prerequisites | #113 mounts the inspector; minimal form: `P2-WP-09`, whose two hooks (`Inspector.ts`, `inspectorTruth.ts`) need Arnav's D1 exception, else Track P; full form: `P2-WP-29` and decision D2 |

## 5. Judging-criteria alignment

Statuses from [BRIEF](../competition/BRIEF.md#3-judging): J1 ✅, J2 ✅, J3 ✅, J4 ❓, T1 ❓, P7 ✅ for the title and prize only, with no brief captured. Use the wording rule for the brief and the theme: "Addresses the brief and theme as reported to the team; neither wording is verified online" (issue #1).

| Criterion (status) | Beats | What it shows |
|---|---|---|
| J1 Creativity/Innovation ✅ | `P2-B1` | The repair mechanism made visible. No new algorithm |
| J1 Polish/Completion ✅ | `P2-B1` | Core beat unchanged; one optional overlay checked against observer counts |
| J1 Technical Competence/Execution ✅ | `P2-B2`, `P2-B6` | Machine-checked properties on real histories; agent knowledge kept apart from observer truth |
| J1 Research/Learning ✅ | `P2-B2`, `P2-B3`, `P2-B4` | Counterexamples published against ourselves; measured churn and its collision cost. `C3` as a finding, numbers from the committed `P2-T08` report: "on ideal paced paths, A → B has k near-crossings; the reactive steering layer turns these into m measured collisions" |
| J2 "usefulness" ✅ | none yet | No usefulness claim for the linter until `P2-T08` shows predicted and measured counts moving together across transitions (open question 2) |
| J3 in person; J4 table timer ❓ (default 300 s, unannounced) | All | Up to two beats fit the judged path. The rest are optional for longer conversations |
| T1 "Composition" ❓ (#1) | `P2-B3`, `P2-B4` | Composing a score and its consequences; competing compositions. Wording unverified |
| P7 Neptune North: title and prize ✅, brief ❌; EV-08 unverified | `P2-B1`, `P2-B2`, `P2-B4`, `P2-B6` | Decentralised decisions, partial knowledge, interrupted radio, as the team understood the brief. No fit claim |

## 6. Anticipated judge questions

DEMO_PLAN's [question table](DEMO_PLAN.md#anticipated-questions) stays primary. These are the Phase 2 additions.

| Question | Honest answer |
|---|---|
| Is there a central controller? | "No central controller during the show; score and roster are authored and preloaded." "Logically separate agents in one process, isolation enforced by tests." Phase 2 adds nothing that decides: the linter is operator-side at authoring time, the checkers and fuzzer are observer and environment, and the trail draws only the drones' own decisions |
| Are collisions solved? | No. "Collisions and near-misses are counted from true positions: X and Y in this run." Both arms share the same steering (ADR-009). `P2-B3` reports predicted conflicts under ideal paced flight with no avoidance, not a collision forecast, and `P2-T08` compares them with measurement. Stronger avoidance (C9, an avoidance-first budget, then a CBF-style filter; prior art ORCA and CBF) comes after the hackathon, and even then it is measured, not guaranteed |
| What is novel here? | The positioning sentence first: "Encore invents no new algorithm…". Then one distinctive combination, not an invention ([candidates §8](../ideation/PHASE2_CANDIDATES.md#8-literature-and-prior-art)): "A drone treats a slot as vacant only if it senses it empty and hears no heartbeat holding it, so radio silence alone never triggers repair; `INV-SILENCE` checks that on every CLI-checked run." Then the prior art: the Phase 2 techniques are established (deterministic simulation testing, Jepsen-style history checking, ddmin, swarm testing, offline show checks); we applied them to our own simulation and publish the counterexamples that go against us |
| What happens with more drones? | Unknown beyond what was run: G1 at 40 drones, one run at 120 with partial repair ([CURRENT_STATE](../CURRENT_STATE.md#g1-result-honestly)); the `n0` = 200 matrix is pending (#122); base scaling test T15 ([evaluation §6](../validation/evaluation-and-tests.md#6-automated-tests)) is not in `tests/`. Repair is local (NFR-02), but dissemination time grows with radio hop count (L2 predicts hop diameter). App cost: quote only the #118 harness's recorded run ([`assets/qa/perf.md`](../../assets/qa/perf.md)) with its caveats |
| What if the radio fails entirely? | A deaf drone never claims and keeps flying its score, exactly as the static baseline does ([contract §8.2](../design/contracts-and-algorithms.md#82-canheal-when-a-drone-is-allowed-to-judge-vacancies)). The G1 "silence is not death" test passes with 0 slot changes. New scores do not spread, and sensing-based separation still works. `INV-SILENCE` checks this property on every CLI-checked run |
| Is the late-repair repro a bug? | It is a stated limit: repair is slow by design, per hop ([contract §8.5](../design/contracts-and-algorithms.md#85-known-limits-state-these-dont-hide-them), limit 3). The fuzzer exists to find such cases before judges do |

## 7. Do not show

- Anything from Track P presented as working: spinning holds, healing in motion, avoidance changes, `Belief.why`. Also no mock-ups or renderer-only fakes of them ("never fake healing in the renderer").
- Base work (§1 rule 6) labelled as Phase 2.
- A fuzzer running live, or any random fault scheduler in the app (N15). Fuzzing is offline at `n0` = 40.
- The invariant readout before `P2-T02` is clean and before the canonical script has been checked headless.
- Exploratory curves, oracle bounds or swept counts (C4) spoken as results or wins. The oracle is only ever an "oracle upper bound" (instant global knowledge), never a competitor.
- `P2-B4` before `P2-T14` has passed.
- A linter that blocks injection, or any "verified safe" badge.
- Inspector reasons re-derived in the app.
- Any external service, network call or sponsor integration (NFR-04; decision D3; [integration boundaries §9](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#9-the-no-network-rule-and-decision-d3)).
- Any edit to `DemoScript.ts` timing, events or captions for Phase 2's sake.
- Numbers that are not in a `RunRecord`, a file in the repo, or the HUD's observer count for the run on screen.

## 8. Hand-over to the demo owner

1. Arnav decides D7: none, one or both of `P2-B1` and `P2-B2` on the judged path.
2. If a beat is accepted, the demo owner (Haris, per the DEMO_PLAN banner; [CURRENT_STATE](../CURRENT_STATE.md) notes that Arnav's orchestrator now owns the open issues) adds it to [`DEMO_PLAN.md`](DEMO_PLAN.md) in a PR, with a rehearsal row (build, seed, `stateHash` with the beat on and off, fps on the presentation laptop) and its fallback row.
3. Until both steps happen, this storyboard is design only, and no caption, video or Devpost text mentions a Phase 2 beat. One exception is proposed, because judges read Devpost and the roadmap already lets the README cite merged Phase 2 artefacts: a single gated line under [Devpost "What we learned"](DEVPOST.md#what-we-learned), traced to its records like the other placeholders (NFR-09): `[IF P2-T05 passed and P2-WP-01/02 on main: our stated limits are machine-checked properties; the fuzzer rediscovered our known late-repair case unaided and shrank it to a k-drone kill (checked properties on these runs, not proofs)]` (open question 4).

## 9. Open questions

1. **Owner of the headless demo-script check.** `P2-WP-01`'s allowed files and steps do not yet include `tests/observer/demoScriptInvariants.test.ts`, and the roadmap's Track H graph has no WP-01 → WP-03 demo-inclusion edge. Until the work-package doc adds them, the D7 / `P2-G5` condition has no owner.
2. **Does L1 track measured collisions?** The only data point (183 and 25 predicted against 14 measured) cuts against it. If `P2-T08` shows no co-movement across transitions, `P2-B3` stays a Research/Learning finding only, or leaves hands-on time.
3. **A fourth peer group for `P2-B6`.** "No longer heard (suspected), truth: dead" would show the suspect transition directly; it is a `P2-WP-09` change. Without it, the beat shows the peer dropping out.
4. **Devpost line.** Whether the gated line in §8 item 3 goes into DEVPOST.md is for the submission text owner (#125) and Arnav, not this storyboard.
