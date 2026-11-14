# Encore requirements

Purpose: the only place where functional (FR-xx) and non-functional (NFR-xx) requirements are defined, each with an observable acceptance check and an owning area. Status: accepted at gate G0; every threshold is a target until a run record shows it. Owner: project lead (contract owner).

- IDs are stable: never renumber or reuse. Other documents cite IDs and do not restate them.
- Types, parameter names and defaults: [contracts](../design/contracts-and-algorithms.md). Information rules I1–I8: [architecture](../design/system-architecture.md). Metric formulas and scenarios: [evaluation](../validation/evaluation-and-tests.md). Event facts: [brief](../competition/BRIEF.md).
- If this file disagrees with the contract, the contract wins and this file gets fixed.

## 1. Product

Encore is a browser simulation of a drone light show in which `n0` drones fly a shared, versioned score, and each drone decides for itself from its own sensing and the radio messages it actually receives. When drones are lost, nearby survivors give up less important slots to take more important ones they can see are empty, so the damage ends up as thinner detail instead of holes in the outline. A new composition injected into one drone spreads by radio gossip, and the app shows what jamming and partitions really do, next to a static pre-uploaded baseline and with measured numbers.

**Key demonstration.** Two worlds (Encore brains, static brains) run from the same seed, score and event script.

1. Regional kill during a hold: Encore refills important slots from the rim inward and normalised priority-weighted coverage (nPWC) returns to ≥ 0.95, sustained 3 s. The static world keeps the hole.
2. Full jam, no kills: no drone changes slot. Radio silence is not treated as death.
3. Injection into one drone with a partition on: two versions fly at once and the belief view shows it. After reconnection one remains.

Slots are in farthest-point order, so priorities are interleaved in space: Encore should visibly do better on a regional kill and look similar to the baseline on a random kill. We say so.

## 2. Functional requirements

Areas: **core-agent** (`src/agent`), **core-sim** (`src/sim`, `src/contracts`), **score** (`src/score`), **observer** (`src/observer`, `src/cli`), **app-render** (`src/app/render/**`), **app-ui** (`src/app/ui/**`, `src/app/main.ts`), **ops** (README, build, submission). Each requirement is due at the gate of its work package in the [development plan](../planning/development-plan.md).

### Agent isolation

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-01 | MUST | A brain's `step` reads only its own state and `AgentInput` and returns only `AgentOutput` (I1, I2). It imports only `src/contracts` and `src/score` | Import-boundary check. Locality test: changing a drone A cannot sense or hear leaves A's output identical | core-agent |
| FR-02 | MUST | Brains use no `Math.random`, `Date`, `performance`, DOM or module-level mutable state. State is plain JSON with its own seeded stream | Source-scan test. A JSON round trip of state mid-run leaves the final `stateHash()` unchanged | core-agent |
| FR-03 | MUST | Observer, renderer and UI decide nothing. The app changes a world only via `schedule(EnvEvent)` (I6) | `stateHash()` equal with and without the observer attached (T14) | core-sim |

### Radio and sensing

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-04 | MUST | Radio is a one-hop broadcast to live drones within `rRadio`: blocked by a jam sphere (either end) or a partition plane, lost with probability `loss`, else delivered after `latencyMin…latencyMax` ticks. Never relayed | Unit test per rule. Each `RadioEvent` accounts for every in-range receiver | core-sim |
| FR-05 | MUST | Only two message types: `HB` (optionally carrying a claim) and `SCORE` | No run's radio log holds another type | core-agent |
| FR-06 | MUST | Sensing gives anonymous `{rel, vel}` of live drones within `rSense`, regardless of jams and partitions | A jammed drone still senses neighbours; `Sensed` has no id | core-sim |
| FR-07 | MUST | `KILL` removes a drone from sensing and radio that tick. The world clamps `aMax` and `vMax`, and counts collisions (`dCollide`) and near-misses (`dNear`) with no physical effect | Unit tests; counts appear in `MetricsSample` | core-sim |

### Composition and score

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-08 | MUST | `expandRecipe` is pure and deterministic: exactly `n0` slots, farthest-point priority order, spacing ≥ `slotSpacingMin` | Per recipe kind: length, spacing, identical output on a second call (T17) | score |
| FR-09 | MUST | Recipe kinds `text` (A–Z, 0–9, space), `sphere` and `helix` | Each is recognisable at default `n0` from the audience camera | score |
| FR-10 | MUST | A prefix of the slots is a thinner, evenly spread version of the shape | Demo formations stay readable with the first 90% and 70% of slots (screenshots kept) | score |
| FR-11 | MUST | Slot persistence: the holder of index `i` flies slot `i` of the current movement. A formation change needs no messages | G1 null run (no kills, one formation change, 60 s): zero slot changes | core-agent |

### Healing and motion

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-12 | MUST | A drone treats a slot as vacant only if it may heal, has itself sensed nobody within `rOcc` of it for `tVacant`, and has heard no heartbeat holding it for `tSuspect`. Silence alone never moves a drone | G1 jam run (full jam 5 s to 40 s, no kills): zero slot changes | core-agent |
| FR-13 | MUST | `canHeal` needs all five contract conditions (§8.2). Otherwise timers and claims are dropped | Unit test per condition. No commit during a transition. A deaf drone never claims | core-agent |
| FR-14 | MUST | A drone claims only a vacancy it senses itself within `rClaim` that beats its own slot by more than `claimGap`. The claim rides in `HB.claim` for `claimWindow`; the least important bidder wins | Every commit lowers the committer's index by more than `claimGap`. G1 clumped kill: commits ≤ 3 × kills | core-agent |
| FR-15 | MUST | Duplicates: the earlier holder keeps the slot; without radio, physical yield after `yieldTicks`. The loser pops its history stack. There is no unassigned state | G1 clumped kill, within 30 s: no slot double-held for more than 3 s, no commits in the last 10 s. `dupSlots` always reported | core-agent |
| FR-16 | MUST | Regional kill in hold, radio connected: Encore recovers (nPWC ≥ 0.95 sustained 3 s) and ends above the static arm, on the share of seeds pre-registered in the evaluation doc | Paired run records, same seed and kill ids. Recovery time, or "not recovered", reported per seed | core-agent |
| FR-17 | MUST | Both arms use the same `steer` (separation below `dAvoid`) | `collisions` and `nearMisses` reported for both arms. Zero is not required | core-agent |
| FR-18 | SHOULD | `transitLanes`, only if transitions gridlock | Counts compared on and off, same seeds | core-agent |

### Dissemination and partitions

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-19 | MUST | A new score enters through one drone's inbox (`INJECT_SCORE`). Every other drone gets it only from delivered `SCORE` messages (I7) | Radio connected: `versions` collapses to one key. Adoption time reported | core-sim |
| FR-20 | MUST | A drone adopts only a newer `{issuedTick, origin}`. Heartbeats carry the version; hearing an older one schedules a `SCORE` send, rate-limited by `scoreResendMin` and `scoreJitter` | `newerVersion` unit test. A stale drone back in range adopts | core-agent |
| FR-21 | MUST | Cut-off drones keep flying the score they have. A partition leaves two versions flying until contact returns. No healing while nearby versions disagree | `versions` has two keys during the partition, one after `PARTITION_OFF` | core-agent |
| FR-22 | SHOULD | Scores injected on both sides of a partition: the later `issuedTick` wins after reconnection | Headless test | core-agent |

### Baseline

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-23 | MUST | Static brain (`src/agent/staticBrain.ts`): keeps `initialSlot`, same `steer`, sends nothing, ignores its inbox, keeps flying under jams and failures | Static records: `msgs.hb`, `msgs.score` and `slotChanges` are all 0 | core-agent |
| FR-24 | MUST | The two worlds share seed, score, parameters and events; kills are resolved to explicit ids first. The static arm ignoring an injected score is reported as a capability difference, not a win | `events` identical in both arms' `RunRecord`s | core-sim |

### Metrics

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-25 | MUST | The observer emits a `MetricsSample` every 5 ticks per world | HUD values equal a headless recomputation | observer |
| FR-26 | MUST | The CLI runs scenario × seed × arm headless and writes `RunRecord`s | A re-run reproduces `stateHash` and `summary` | observer |
| FR-27 | MUST | Comparison table, paired by seed over at least 5 seeds, for the evaluation doc's scenarios: no event, random kill, regional kill, radio cut, inject + partition + reconnect. Parameters frozen first | Generated from records with one `paramsHash`; published whatever the result | observer |

### 3D views (`src/app/render/**`, one file per layer)

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-28 | MUST | Audience view: lit drones, orbit camera, Encore above and static below (fallback: a one-key toggle) | Text legible at default `n0`; both arms show the same kill | app-render |
| FR-29 | MUST | Radio layer drawn from the real `RadioEvent` log (I8), with jam spheres and partition groups | Every spark maps to a logged event; none crosses an active jam or partition | app-render |
| FR-30 | MUST | Belief layer: drones coloured by `belief.version` | Colour counts match `versions` | app-render |
| FR-31 | MUST | Ghost layer: unoccupied target slots are marked | Marks match `coverage` | app-render |
| FR-32 | SHOULD | Inspector: click a drone to see only what it knows, from its `Belief` and `world.inspect`; state shown as a generic JSON tree | Values equal that brain's state; any ground truth shown is labelled as observer data | app-ui |
| FR-33 | MUST | HUD for both arms: alive, nPWC, `dupSlots`, versions, messages, collisions, near-misses | Matches FR-25 | app-ui |

### Controls and scripted demo (`src/app/ui/**`, DOM only)

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| FR-34 | MUST | Controls: kill region, jam on/off, inject a recipe into the selected drone, play/pause, reset from seed. SHOULD: partition on/off, random 10% kill, single step | One click or key each; the same `EnvEvent` goes to both worlds | app-ui |
| FR-35 | MUST | Scripted demo on one key: form, regional kill, recover, jam, inject, reconnect. `Reset` restarts it | Three runs end with the same `stateHash`; fits the [demo plan](../demo/DEMO_PLAN.md) slot | app-ui |
| FR-36 | SHOULD | A judge types their own word for the injected recipe | Unsupported characters are rejected | app-ui |
| FR-37 | SHOULD | "What is simulated" panel | One click from the HUD | app-ui |
| FR-38 | STRETCH | Contract §12 items: gossiped membership, tail reassignment, oracle bound, animated holds | After G5, via a `[contract]` PR | all |

## 3. Non-functional requirements

| ID | Level | Requirement | Acceptance | Area |
|---|---|---|---|---|
| NFR-01 | MUST | Performance: both worlds live at 20 Hz simulation, at the frame-rate target of architecture §6 and never below its floor | Measured on a team laptop at G2 on a single view with both worlds stepping; re-measured at G5 with split view and X-ray on. Recorded in [CURRENT_STATE](../CURRENT_STATE.md) | app-render |
| NFR-02 | MUST | Scaling: sensing and radio use a uniform spatial grid. No brain solves a global assignment | Tick time at `n0` and at half of it, reported | core-sim |
| NFR-03 | MUST | Determinism: same seed, parameters and event script give the same run on the same JavaScript engine | Replay test on `stateHash()` at fixed ticks (T04), within one host | core-sim |
| NFR-04 | MUST | Offline: static files, no server, no network at runtime | The built app runs with networking off | ops |
| NFR-05 | MUST | Headless tests: the core has no DOM dependency; unit and G1 tests run in Node with one command | Suite passes before every merge to `main` | ops |
| NFR-06 | MUST | README lists every public framework and library used (BRIEF R3) | Section matches `package.json` | ops |
| NFR-07 | MUST | README credits AI/LLM use explicitly: which tools, for what (BRIEF R4) | Section present | ops |
| NFR-08 | MUST | Submission: feature freeze 08:30, backup video 09:00, Devpost submitted by 10:15, hard deadline Sun 15 Nov 11:00 GMT (BRIEF S3). Repo public or access granted (R2) | Devpost timestamp; [submission checklist](../demo/SUBMISSION_CHECKLIST.md) complete | ops |
| NFR-09 | MUST | Every number said or written traces to a `RunRecord`. The limits in contract §8.5 appear in the README | Spot check of README and pitch | ops |

## 4. User stories

- **Judge:** I kill a region myself and watch the Encore side close its outline while the static side keeps the hole.
- **Judge:** I switch on the radio and belief layers, or click a drone, and see it acts only on what it sensed and heard.
- **Judge:** I inject a new formation into one drone, watch it spread and stall at a partition, and see the same metrics for both arms, including where Encore is no better.
- **Presenter:** one key runs the demo, `Reset` recovers from any mistake, and a recorded video is the last fallback.
- **Presenter:** every sentence I say has safe wording in section 5 and a number from a run record.
- **Developer agent:** I build my area against the contract; each requirement names a check that tells me when I am done.

## 5. Claims we must not make

| Do not say | Say instead |
|---|---|
| "Collision-free" | "Collisions and near-misses are counted from true positions: X and Y in this run" |
| "Self-healing restores the image" | "Nearby survivors move to more important slots; low-priority detail is given up and the image thins" |
| "Always converges", "guaranteed" | "Settled in our tests within X s. An argument, not a proof, and we measure it" |
| "Detects dead drones" | "Infers a vacancy from a slot it senses empty plus missing heartbeats. It can be wrong, and then it yields" |
| "Heals any damage" | "Repair is local and greedy: a wiped region heals inward from its rim; an island nobody senses is not detected" |
| "Jam-proof" | "Cut-off drones keep flying the score they have; new scores do not cross a jam or partition" |
| "Beats the baseline" | "Ahead on regional kills by X over N seeds; similar on random kills" |
| "Distributed system", "runs on drones" | "Logically separate agents in one process, isolation enforced by tests. A simulation, not flight software" |
| "No central anything" | "No central controller during the show; score and roster are authored and preloaded" |
| "Optimal", "novel algorithm" | "A simple local rule built from known ideas: gossip, local failure suspicion, priority claims" |
| "Secure" | "Drones are assumed honest; any drone can inject a score" |
| "Meets the Neptune North brief", "matches the theme" | "Addresses the brief and theme as reported to the team; neither wording is verified online" |
