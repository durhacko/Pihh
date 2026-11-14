# Feasibility and scope

Purpose: say whether the chosen design can be built by Sunday morning, where it is most likely to fail, and exactly what is in and out of the MVP. Status: **desk assessment at Sat 14 Nov ~19:00 GMT; no code has run. Revisit after gate G1.** Owner: Architect / Integrator role.

The design assessed is the one in [system architecture](../design/system-architecture.md) and [contracts](../design/contracts-and-algorithms.md). Requirement IDs and acceptance criteria live only in [requirements](../specification/requirements.md); this document draws the boundary, it does not define requirements.

## 1. Verdict

Feasible as a simulation, **on condition that G1 passes**. Everything except healing is routine engineering. Healing is a new combination of timers and local rules that has only been reasoned about, so it is tested first, headless, before any rendering work depends on it.

## 2. Constraints

| Constraint | Fact | Consequence |
|---|---|---|
| Time | 16 h to the hard deadline (BRIEF S3), 13.5 h to feature freeze (08:30), 4.5 h to G1 (23:30) | No second design attempt. One fallback step per gate, decided in advance |
| People | Three, working overnight; lanes in the [development plan](../planning/development-plan.md) | One owner per directory; the contract freezes early so work runs in parallel |
| Skills | TypeScript and Three.js experience is not recorded | Plain data, pure functions, no framework beyond Vite, Three.js and vitest |
| Hardware | None confirmed (BRIEF H2) | Simulation only; nothing in the demo needs a network |
| Rules | Libraries listed, AI use credited, no pre-event work (BRIEF R3, R4, R5) | README sections are MUST |
| Evidence | The sponsor brief and theme wording are team-reported, not verified ([evidence](../context/evidence-and-assumptions.md)) | Scope serves the four verified judging criteria (J1) first |

## 3. Feasibility by area

| Area | Rating | Why |
|---|---|---|
| Contracts and score expansion (`src/contracts`, `src/score`) | Easy | Types are already written; expansion is pure functions (bitmap font, lattice, farthest-point sampling) |
| World: bodies, sensing, disc radio, events (`src/sim`) | Easy to medium | Standard; the risk is determinism discipline (seeded streams, fixed order) |
| Static brain (`src/agent/staticBrain.ts`) | Easy | A few lines on top of the shared `steer` |
| Score gossip, jam and partition | Medium | Small protocol; a partition that stays split is the correct outcome, so there is little to get wrong |
| Rendering and layers (`src/app/render/**`) | Medium | Instanced meshes are simple; the X-ray layer must draw only real radio events (I8) |
| Observer, run records, CLI | Medium | Simple code, but every later claim depends on it |
| Transitions | Risky | Slot order is unrelated between formations, so most drones cross the middle at once; `steer` is one function with no planning |
| **Local-claim healing** | **Riskiest** | See §4 |
| Integration by three people overnight | Risky | Mitigated by the frozen contract and import rules |

## 4. The riskiest thing, and how G1 tests it first

**Risk:** the healing rules produce false vacancies, lasting duplicates or endless churn, or settle but do not beat the static arm.

Why it may fail:

- Five timers interact (`tVacant`, `tSuspect`, `claimWindow`, `tStable`, `holdGrace`), and none has been tuned.
- Sensing is anonymous, so the only evidence of a hole is "nobody within `rOcc` of that point".
- A claimant must fly through a lattice with `slotSpacingMin` 1.5 m while steering away below `dAvoid` 1.4 m. It may stall or trip the physical yield.
- Priorities are interleaved in space. A random kill should look alike in both arms; only a regional kill should show a visible gain. If the regional gain is small, the headline comparison is weak.

**How G1 tests it:** the three headless runs in [contracts §8.6](../design/contracts-and-algorithms.md#86-the-first-falsification-test-gate-g1) (null run, clumped kill, silence is not death), on a small roster with heavy packet loss, one seed and then five. They need only `src/contracts`, `src/score`, `src/agent`, `src/sim` and a minimal observer: no app. `claimGap` must be recomputed for the small roster or few drones are eligible to claim. If the clumped-kill run cannot pass by 23:30, take the next step on the fallback ladder in [decisions and risks](../planning/decisions-and-risks.md). Rendering (G2) proceeds in parallel against the static brain, so a G1 failure does not block the 3D slice.

## 5. MVP scope

**MUST** (each needed for G1–G6):

- Contract types and `DEFAULT_PARAMS` in `src/contracts`.
- Score expansion for text and sphere: exactly `n0` slots in farthest-point order.
- Deterministic world: bodies, anonymous sensing, disc radio, `KILL`, `JAM`, `PARTITION`, `INJECT_SCORE`, seeded replay.
- Encore brain: heartbeat, `canHeal` gate, local claims, history stack, physical yield.
- Static brain, and two worlds driven by one seed and one event script.
- Score dissemination from one drone, with version `{issuedTick, origin}`.
- Observer: nPWC, coverage, duplicate slots, collisions and near-misses, message counts, version histogram, run records.
- Headless CLI and the G1 tests.
- App: audience view, X-ray view from real radio events, Encore beside the static arm, metrics readout.
- Controls: regional kill, random kill, jam, partition, inject, pause, reset with seed.
- One scripted demo, an offline build, README (libraries, AI credit), backup video.

**SHOULD:**

- Belief view (colour by score version), ghost slots, drone inspector.
- Helix recipe.
- `transitLanes`, only if transitions gridlock.
- Multi-seed batch with a results table for the pitch.
- In-app "what is simulated" panel.

**STRETCH:** judge-typed text; the "revisit" rows of contract §12 (gossiped register with tail reassignment, oracle upper bound, animated holds).

## 6. Out of scope

See [contracts §12](../design/contracts-and-algorithms.md#12-deliberately-not-in-the-mvp). In addition: real drones or LED hardware, flight-control realism, any server or network, music sync.

## 7. Minimum convincing product

If things go badly, these survive in every version, because they carry the decentralisation claim:

1. Brains see only their `AgentInput` (I1), checked by the import-boundary test.
2. Two arms on the same seed and kills, with measured numbers on screen.
3. A new score enters through one drone and spreads only by delivered messages; a jam or partition visibly holds it back.

| If this fails | Honest reduced version |
|---|---|
| Healing (G1) | Ship dissemination and comms resilience with repair switched off. Say: "repair was attempted; here is what the test showed". Never fake repair with observer knowledge; a central assignment, if shown, is labelled "oracle upper bound" |
| Frame rate (G2) | Lower the `n0` preset to the architecture's floor |
| 3D layers | Audience view plus metrics only; X-ray as a 2D overlay |
| Live app stability | Backup video plus CLI run records |

## 8. Healing alternatives considered

| Alternative | Idea | Why it lost |
|---|---|---|
| Rank from membership | Each drone takes the slot equal to its rank among drones it believes alive | One death shifts every later drone, so the whole image shimmers. It needs a death verdict that radio cannot give; under partition both sides compress into the same top slots |
| Flooded vacancy and claim messages | Witnesses flood "slot empty"; claims relay with a hop limit | Every eligible claimant already senses the hole itself. A clumped kill costs millions of deliveries (estimate), and one false positive spreads swarm-wide |
| Auctions / CBBA | Multi-round bidding with consensus on winners | Multi-round state and quiescence detection are fragile under loss and too large for the time. Only the single bid comparison is borrowed |
| Tail reassignment over a gossiped register | Least important drone anywhere flies to the hole, using a per-slot table | Needs an O(`n0`) table per drone, anti-entropy and relays; long crossings raise near-miss counts; its "unassigned" state had no termination argument. Kept as STRETCH |

**Chosen: local claims.** A claim only moves a drone to a more important slot, radio silence alone never moves anyone, and it needs no message beyond `HB`. The price is that repair is local, greedy and slow ([contracts §8.5](../design/contracts-and-algorithms.md#85-known-limits-state-these-dont-hide-them)).

## 9. Complexity and performance

**All figures are estimates from the default parameters, not measurements.** Measured values are recorded at G2 and G5.

| Item | Estimate |
|---|---|
| Expansion | `n0` × 4·`n0` ≈ 160k distance updates per recipe, once, memoised |
| Sensing | Brute force is `n0`² ≈ 40k pair checks per tick; the spatial grid is an optimisation at this size, not a prerequisite |
| Heartbeats | `n0` × 4 Hz ≈ 800 broadcasts/s, at most ≈ 160k deliveries/s in the Encore world; the static world sends none |
| Brain scan | ≤ ~50 slots within `rClaim` × ≤ ~90 sensed drones, at 4 Hz per drone ≈ 3–4M checks/s worst case |
| Repair time per hop | ≈ 3 s detect + 1 s contend + 1–2 s flight ≈ 5–6 s; a hole two layers deep ≈ 10–15 s |
| Missed claim | 4 repeats per `claimWindow`: all lost with probability ≈ 6×10⁻⁶ at default `loss`, ≈ 0.2% at 20% loss |
| Score spread | ≤ ~0.7 s per radio hop; a few seconds across a connected formation |

Only measurement settles: frame rate for two worlds on the weakest team laptop, and garbage-collection pauses from copying every drone's `Belief` into each snapshot.
