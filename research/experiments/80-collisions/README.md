# #80 spike: transition collisions in S0, static arm

**Throwaway measurement spike** for [#80](https://github.com/durhacko/Pihh/issues/80). Nothing on `main` changes. Every variant lives in [`measure.ts`](measure.ts), in a copy of the static brain and of `steer`. The copies are checked against the shipped brain first: with the switches off, and with `transitLanes` on, they reproduce it bit for bit (`IDENTICAL` at the top of [`run.log`](run.log)).

```bash
npx tsx research/experiments/80-collisions/measure.ts                 # all configs, seed 1, n0 200 (~3 min)
npx tsx research/experiments/80-collisions/measure.ts --only C1,C7    # a subset
```

Base: `origin/main` at `bcccf2f` (contains #64 / #85). Scenario S0, static brain, n0 = 200, 1800 ticks.

## Seeds 1-5 are one run

S0 has no events. Its score does not depend on the seed, and the world's random number generator only drives the radio, which the static brain never uses. So seeds 1 to 5 give **bit-identical runs**: same final state, same counts. I measured all five for C1 to C5, and the script asserts it for seed 1 against seed 2. A "mean over 5 seeds" is therefore one deterministic number, and the tables below are single runs. To measure spread, the runs would need launch jitter or a sensor noise source, and neither exists.

## Phase windows

| window | ticks | what happens |
|---|---|---|
| launch | 1-400 | launch grid → text `ENCORE` (movement A, authored start tick −200) |
| text→sphere | 900-1399 | movement B (sphere) starts at 900 |
| holds | 401-899 and 1400-1800 | A hold, B hold |

## Results (S0, static, n0 200; seed-independent)

Collisions and near-misses are the world's own endpoint counts: a pair entering `d < dCollide` or `d < dNear` at the end of a tick. "On slot" means the share within `rOcc` of the slot, measured with `onSlotFraction` from `src/cli/run.ts`. "A/B 95%" is the first tick at which 95% of drones are on slot, followed by its offset from the score's `holdStart` (negative means early).

| # | configuration | collisions launch / text→sphere / holds = **total** | near-misses launch / t→s / holds = **total** | on slot @400 | on slot @1800 | A 95% (vs holdA) | B 95% (vs holdB) |
|---|---|---|---|---|---|---|---|
| C1 | defaults (baseline) | 49 / 11 / 0 = **60** | 235 / 75 / 0 = **310** | 100% | 100% | 147 (−16) | 1022 (−182) |
| C2 | `transitLanes: true` | 49 / 13 / 0 = **62** | 199 / 82 / 0 = **281** | 100% | 100% | 154 (−9) | 1027 (−177) |
| C3 | TTC sidestep (`r < dAvoid + closing·0.5 s`) | 38 / 14 / 0 = **52** | 158 / 83 / 0 = **241** | 100% | 100% | 153 (−10) | 1028 (−176) |
| C4 | C2 + C3 | 49 / 13 / 0 = **62** | 181 / 64 / 0 = **245** | 100% | 100% | 159 (−4) | 1030 (−174) |
| C5a | `transitionTicks` ×1.5 in the score only | 49 / 11 / 0 = **60** | 235 / 75 / 0 = **310** | 100% | 100% | 147 | 1022 |
| C5b | paced targets, flight = 1.0 × authored (`transitionTicks − 60`) | 8 / 3 / 0 = **11** | 188 / 54 / 0 = **242** | 100% | 100% | 308 (**+145**) | 1150 (−54) |
| C5c | paced targets, flight = 1.5 × authored | 3 / 2 / 0 = **5** | 185 / 55 / 0 = **240** | **0%** ✗ | 100% | 455 (+292) ✗ | 1267 (+63) |
| C5d | C5c, text→sphere only | 49 / 2 / 0 = **51** | 235 / 55 / 0 = **290** | 100% | 100% | 147 | 1267 (+63) |
| C5e | C5b + TTC | 16 / 4 / 0 = **20** | 185 / 69 / 0 = **254** | 100% | 100% | 308 (+145) | 1151 |
| C6 | paced to the score: target arrives at `holdStart` | 30 / 3 / 0 = **33** | 226 / 53 / 0 = **279** | 100% | 100% | 180 (+17) | 1207 (+3) |
| C6b | C6 + TTC | 23 / 3 / 0 = **26** | 206 / 61 / 0 = **267** | 100% | 100% | 181 (+18) | 1208 (+4) |
| C6c | C6 + `transitLanes` (lane chosen from distance to the real slot) | 36 / 3 / 0 = **39** | 232 / 66 / 0 = **298** | 100% | 100% | 187 (+24) | 1210 (+6) |
| C6d | C6, text→sphere only | 49 / 3 / 0 = **52** | 235 / 53 / 0 = **288** | 100% | 100% | 147 | 1207 (+3) |
| **C7** | **C6 + `A_START_TICK` −200 → −60 (holdA 163 → 303)** | **8 / 3 / 0 = 11** | **188 / 53 / 0 = 241** | **100%** | **100%** | **308 (+5)** | **1207 (+3)** |
| C7b | C7 + TTC | 16 / 3 / 0 = **19** | 185 / 61 / 0 = **246** | 100% | 100% | 308 (+5) | 1208 (+4) |

There are no collisions in any hold in any configuration. All of them come from the two transitions, and the launch accounts for 49 of the 60.

### Notes on the requested configurations

- **C2, `transitLanes`:** does not help. Collisions go from 60 to 62 and near-misses from 310 to 281. The three depth layers are only ±2 m. My untested reading of why it fails: the crossings move to where the lane is released, 3 m before the slot, where neighbouring slots are tightly packed.
- **C3, TTC sidestep:** −13% collisions and −22% near-misses at no cost to arrival. Combined with lanes (C4) the gain disappears. Combined with pacing (C5e, C7b) it makes things *worse* (11 → 20 and 11 → 19), because the extra lateral pushes disturb an otherwise orderly paced flow.
- **C5a, "slower transition via authoring":** this is a no-op by construction, and the measurement confirms it with bit-identical trajectories. Both brains aim at the current movement's slot from `startTick` on, so `transitionTicks` only moves `holdStart`. It does not change how anyone flies. Slowing down needs the target itself to move gradually. That is what C5b to C7 do, with `target = lerp(previous slot, new slot, f)`, computed locally by the brain from the score with no radio. For movement A the previous slot is the launch position.
- **C5c, 1.5× slower:** cuts collisions the most (5), but fails the tick-400 arrival guard in `run.ts` (it needs ≥95% on slot at the first KILL in S1, S2 and S4). It is not usable without moving the kills.

### Are the counts real? Swept closest-approach audit

For every pair that came near, the script computes the closest approach *within* each tick, assuming each drone moves in a straight line between tick ends (the integrator is semi-implicit Euler, so this is exact). The tally covers every endpoint collision; the per-run sample cap of 400 is never reached.

| | C1 baseline | C7 |
|---|---|---|
| endpoint-counted collisions | 60 | 11 |
| swept collision entries (closest approach < 0.4 m) | 62 | 11 |
| missed by endpoint sampling | 2 (3%) | 0 |
| endpoint re-entries of the same pair within 20 ticks (chatter) | 0 | 0 |
| relative speed at the counted tick (<1 / <2 / <4 / <8 / ≥8 m/s) | 0 / 1 / 14 / 34 / 11 | 2 / 1 / 7 / 1 / 0 |
| swept minimum below the endpoint distance by > 0.05 m | 0 of 60 | 0 of 11 |
| closest approach per contact: median, count < 0.2 m, count < 0.1 m | 0.30 m, 11, 1 | 0.34 m, 1, 0 |

**Verdict: the collisions are physically real, not sampling artefacts.**

- Every counted collision is a genuine crossing at 2-8+ m/s relative speed, and the pair really does go below 0.4 m.
- There is no double counting: there are no re-entries, and nothing counted at slow, jostling speed.
- Endpoint sampling *under*-counts slightly, missing 2 of 62 in the baseline. That is the documented lower bound in §10.
- Pacing reduces how many contacts happen and also how deep and fast they are.

## Recommendation

**Adopt C7: pace each drone's target to the score's own clock, and move `A_START_TICK` from −200 to −60.** It is the smallest change that cuts collisions the most (**60 → 11, −82%**; near-misses 310 → 241) without hurting arrival:

- 100% on slot at tick 400 and at tick 1800.
- Both formations reach 95% within 5 ticks of the score's `holdStart`, well inside `holdGrace` = 40.
- No contract parameter changes. `transitLanes` stays `false`, and the sidestep keeps its distance trigger.

**Why the second part is needed.** With pacing alone (C6), launch still produces 30 collisions. The authored score claims movement A began at tick −200, so the score's launch window is only 163 ticks. To arrive on time, the paced drones still have to fly near vMax. Moving A's start to −60 gives the launch a 303-tick window, which is exactly the authoring formula's 0.5 vMax flight time. The guard still passes: holdA + holdGrace = 343 ≤ `A_HOLD_READY_BY` 380, and B's hold is unchanged at 1204 ≤ 1300.

**C5b as an alternative.** C5b (pacing by the authored flight time, no score change) gives the same 11 collisions. But drones then reach formation A 145 ticks *after* the score's `holdStart`. The Encore brain's `canHeal` waits for the drone to be settled and for `tStable`, so this probably would not cause false claims, but the score and the physics would disagree. C7 keeps them consistent.

### Exact change

1. **New shared helper**, in `src/agent/steer.ts` or `src/score/timing.ts`, used by **both** brains in place of the raw slot position. This is a `[contract]` change to §10: it changes "Target: my slot of the formation that is current by the clock".

   ```ts
   /** Where slot `slot` of the current movement is "now": a straight-line blend from the same slot index of the
    *  previous movement (the launch position for movement 0), reaching the slot exactly at holdStart. */
   export function pacedSlotPos(score: Score, tick: number, slot: number, n0: number, params: Params): Vec3 {
     const cm = currentMovement(score, tick);
     const to = expandRecipe(cm.movement.recipe, n0, params).slots[slot].pos;
     const from = cm.index === 0 ? launchPos(slot, n0) : expandRecipe(score.movements[cm.index - 1].recipe, n0, params).slots[slot].pos;
     const begin = Math.max(cm.movement.startTick, 0);
     const f = Math.min(1, Math.max(0, (tick - begin) / Math.max(1, cm.holdStart - begin)));
     return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
   }
   ```

   - **Static brain** (`staticBrain.step`): use `pacedSlotPos(s.score, input.tick, s.slot, s.n0, s.params)` as `target`.
   - **Encore brain:** use it for the *steering* target only. Keep `slots[s.slot].pos` for the at-slot, settled and vacancy checks, and keep `targetChanged` triggered on movement index, so `tStable` semantics do not change.
   - The C7 numbers come from `measure.ts`'s `mode: 'score'`, which is this rule. Its only difference is that it keeps the raw slot when unpaced.

2. **`src/cli/scenarios.ts`:** `export const A_START_TICK = -60;` (was −200). The `buildEvalScore` guard already enforces the 380 limit.

3. **Do not adopt** `transitLanes` (C2) or the TTC sidestep (C3). For reference, the TTC change measured in C3 is the following, in `steer`'s neighbour loop:

   ```ts
   const dot = rx * relVel[0] + ry * relVel[1] + rz * relVel[2];
   const sideRange = dot < 0 ? dAvoid + (-dot / r) * 0.5 : dAvoid;   // closingSpeed * 0.5 s
   if (!(r < sideRange) || !(r > 0)) continue;
   if (r < dAvoid) { /* separation, unchanged */ }
   if (dot < 0) { /* sidestep, unchanged */ }
   ```

## Caveats

- **Static arm only.** The Encore brain is not registered in `src/cli/brains.ts` on `main` yet, so C7 is unmeasured on the Encore arm. That arm adds healing slot changes, but those happen in holds, where the target is not paced (f = 1).
- **Timing.** Per #80's acceptance, apply this only *after* G1 has run, because C7 changes the EVAL score (holdA) and every trajectory.
- **Other n0 values.** At other n0, check `buildEvalScore`'s guard. With −60, holdA = −60 + tA, which must stay ≤ 340. At n0 = 200, tA = 363.
- **What is measured.** These are end-of-tick counts from the world, the same counts the observer reports. The swept audit is analysis only. The world's counting is unchanged.
