# Contracts and algorithms

> **CONTRACT file. Owner: Arnav.** Change it only through a `[contract]` PR (see [`AGENTS.md`](../../AGENTS.md)). The TypeScript blocks here are copied verbatim into `src/contracts/` by issue WP-0b; after that, the code is the source of truth for types and this file for behaviour.

Purpose: everything two work packages must agree on. Types (§1–§5), the composition format (§6), the drone protocol and healing algorithm (§7–§9), motion (§10), the static baseline (§11), and what is deliberately left out (§12). Component boundaries are in [`system-architecture.md`](system-architecture.md); reasons are in [`../planning/decisions-and-risks.md`](../planning/decisions-and-risks.md).

Conventions: metres, seconds, ticks (`DT = 0.05 s`). y is up; formations stand in the XY plane centred near (0, 30, 0); the audience looks from +z. Drone ids are `0 … n0-1`. All contract data is plain JSON-serialisable (no classes, Maps or typed arrays).

## 1. Parameters

One object, passed to the world and to every brain. Defaults are starting values: tune on dev seeds, then freeze before evaluation runs ([`../validation/evaluation-and-tests.md`](../validation/evaluation-and-tests.md)).

```ts
// src/contracts/params.ts
export const DT = 0.05;                 // seconds per tick (20 Hz)
export const OPERATOR = -1;             // sender id of an operator uplink

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];   // 0..1

export interface Params {
  n0: number;              // launch roster size                        200
  // geometry (m)
  slotSpacingMin: number;  // min distance between slots of a formation  1.5
  rOcc: number;            // "at the slot" tolerance                    0.6
  dAvoid: number;          // separation steering starts below this      1.4  (must be < slotSpacingMin)
  dCollide: number;        // collision is counted below this            0.4
  dNear: number;           // near-miss is counted below this            0.8
  rSense: number;          // sensing range                              8
  rRadio: number;          // radio range                                15
  rClaim: number;          // max distance to a slot a drone may claim   6    (must be <= rSense - rOcc)
  // motion
  vMax: number;            // m/s                                        8
  aMax: number;            // m/s^2                                      8
  // radio
  latencyMin: number;      // ticks                                      1
  latencyMax: number;      // ticks                                      2
  loss: number;            // packet loss probability per receiver       0.05
  // protocol (ticks)
  hbPeriod: number;        // heartbeat and scan period                  5    (4 Hz)
  tDeaf: number;           // no radio heard for this long => deaf       40
  tVacant: number;         // slot sensed empty for this long            40
  tSuspect: number;        // no heartbeat holding the slot for this long 60
  claimWindow: number;     // contention window before commit            20
  claimGap: number;        // claim only if v + claimGap < own slot      6    (= max(2, ceil(0.03 * n0)))
  tStable: number;         // own target unchanged for this long         120
  tSettle: number;         // at own slot and slow for this long         20
  holdGrace: number;       // wait after a movement's hold starts        40
  yieldTicks: number;      // physical yield: slot seen occupied this long 20
  historyMax: number;      // max remembered previous slots              8
  scoreLead: number;       // new movement starts this long after injection 60
  scoreResendMin: number;  // min gap between SCORE sends per drone      40
  scoreJitter: number;     // random delay before a SCORE send (0..n-1)  10
  transitLanes: boolean;   // SHOULD feature, see section 10             false
}
export const DEFAULT_PARAMS: Params;                                   // the values above, for n0 = 200
export function makeParams(n0: number, overrides?: Partial<Params>): Params;   // sets n0 and claimGap = max(2, ceil(0.03 * n0))
```

Always build parameters with `makeParams(n0)` when the roster is not 200: `claimGap` depends on `n0` (it is 2 at `n0 = 40`), and a stale value silently disables claims.

## 2. Score and formation types

```ts
// src/contracts/score.ts
export interface ScoreVersion { issuedTick: number; origin: number }   // origin = drone that received the uplink; preloaded score = {0, OPERATOR}

export type Recipe =
  | { kind: 'text'; text: string; palette?: [RGB, RGB] }      // 5x7 bitmap font, A-Z 0-9 space
  | { kind: 'sphere'; palette?: [RGB, RGB] }
  | { kind: 'helix'; palette?: [RGB, RGB] };                  // double helix

// All three recipe kinds are MUST: the show needs typed text and two parametric 3D shapes.
export interface Movement {
  startTick: number;        // show clock tick at which drones start flying to this formation
  transitionTicks: number;  // hold begins at startTick + transitionTicks
  recipe: Recipe;
}
export interface Score { version: ScoreVersion; movements: Movement[] }   // sorted by startTick, first has startTick 0 or earlier than now

export interface Slot { index: number; pos: Vec3; colour: RGB }           // index 0 = most important
export interface Formation {
  slots: Slot[];            // exactly n0, priority order
  dense: Vec3[];            // the dense target shape (about 2000 points), for label-independent metrics
  bounds: { min: Vec3; max: Vec3 };
}
```

## 3. Messages

Two message types. Both are **one-hop broadcasts**: the radio medium never relays, and brains never re-flood.

```ts
// src/contracts/messages.ts
export interface Heartbeat {
  type: 'HB';
  from: number; seq: number; sentTick: number;
  slot: number;              // the slot I hold
  heldSince: number;         // tick at which I took it (0 for the launch slot)
  version: ScoreVersion;     // the score I am flying
  pos: Vec3;                 // my position when sent
  claim?: { slot: number; rank: number };   // present while I am claiming: target slot, and my current slot as the bid
}
export interface ScoreMsg {
  type: 'SCORE';
  from: number;              // a drone id, or OPERATOR for the uplink
  seq: number; sentTick: number;
  score: Score;              // the whole score; it is small
}
export type Message = Heartbeat | ScoreMsg;
```

How the directive's message list maps onto these two:

| Needed | Carried by |
|---|---|
| Heartbeat | `HB` |
| Slot claim | `HB.claim`, repeated on every heartbeat during the window |
| Recovery notification | The first `HB` after a commit: new `slot` and `heldSince` |
| Score update | `SCORE` |
| Vacancy observation | **Not sent.** A drone claims only vacancies it senses itself (§8). Flooding them was rejected, see ADR-007 |
| Membership summary | **Not sent in the MVP.** The peer table is built from heartbeats heard directly. Deferred, see §12 |

Freshness: a peer-table entry not refreshed for `tSuspect` is *suspected*; after 200 ticks it is dropped. A `SCORE` is adopted only if its version is newer (§9). Latency is bounded by the medium, so messages carry no expiry.

## 4. The agent boundary

```ts
// src/contracts/agent.ts
export interface Sensed { rel: Vec3; vel: Vec3 }   // relative position and relative velocity. Anonymous: no id, no slot

export interface AgentInput {
  tick: number;                    // synced show clock (assumption AS-01)
  pos: Vec3; vel: Vec3;            // own body
  inbox: readonly Message[];       // delivered this tick, sorted by (sentTick, from, seq)
  sensed: readonly Sensed[];       // live drones within rSense
}
export interface AgentOutput {
  accel: Vec3;                     // desired acceleration; the world clamps it
  colour: RGB;                     // light
  outbox: Message[];               // broadcasts to send this tick
}
export interface AgentInit {
  id: number; n0: number; initialSlot: number;   // preloaded launch roster entry
  score: Score;                                   // preloaded score
  params: Params;
  seed: number;                                   // per-agent RNG seed = hash(runSeed, id)
}
/** What a brain believes. Read by the observer, renderer and inspector only. Never fed to another brain. */
export interface Belief {
  slot: number; heldSince: number;
  target: Vec3;                    // where I am flying: slot `slot` of my own score's current movement
  version: ScoreVersion;
  deaf: boolean;
  canHeal: boolean;
  claiming: number | null;
  peersKnown: number;              // peer-table entries heard within tSuspect
  log: string[];                   // last <= 20 decisions, e.g. "t=812 commit slot 14 (was 163)"
}
export interface AgentBrain<S = unknown> {
  kind: 'encore' | 'static';
  init(init: AgentInit): S;                        // S must be plain JSON data
  step(state: S, input: AgentInput): AgentOutput;  // may mutate and keep `state`; must not keep `input`
  belief(state: S): Belief;
}
```

Rules for brains (enforced by tests): import only `src/contracts` and `src/score`; no `Math.random`, `Date`, `performance`, DOM or module-level mutable state (a memo cache of pure `expandRecipe` results is allowed); randomness only from the seeded stream kept in `S`; iterate arrays in index order.

## 5. World, events, snapshot, metrics

```ts
// src/contracts/world.ts
export type EnvEvent =
  | { type: 'KILL'; tick: number; ids: number[] }
  | { type: 'JAM_ON'; tick: number; id: string; centre: Vec3; radius: number }
  | { type: 'JAM_OFF'; tick: number; id: string }
  | { type: 'PARTITION_ON'; tick: number; id: string; point: Vec3; normal: Vec3 }   // splits the swarm into two groups, fixed at this tick
  | { type: 'PARTITION_OFF'; tick: number; id: string }
  | { type: 'INJECT_SCORE'; tick: number; droneId: number; score: Score }
  | { type: 'SET_LOSS'; tick: number; loss: number };

export interface WorldConfig {
  seed: number; params: Params;
  brain: AgentBrain;               // encore or static: the only difference between the two arms
  score: Score;                    // preloaded
  events?: EnvEvent[];             // scripted; more can be scheduled live
}
export interface DroneSnap {
  id: number; alive: boolean; diedTick: number | null;
  pos: Vec3; vel: Vec3; colour: RGB;
  partitionSide: 0 | 1 | null;     // group in the active partition, null if none
  belief: Belief;                  // from brain.belief(), copied
}
export interface RadioEvent {      // one per broadcast, from the medium's real log
  tick: number; from: number; type: 'HB' | 'SCORE';
  claimSlot: number | null;        // HB.claim?.slot
  delivered: number[];             // receiver ids scheduled for delivery
  lost: number; jammed: number; partitioned: number;   // in-range receivers that did not get it, by reason
}
export interface WorldSnapshot {
  tick: number;
  drones: DroneSnap[];             // all n0, index = id
  radio: RadioEvent[];             // broadcasts sent this tick
  jams: { id: string; centre: Vec3; radius: number }[];
  partitions: { id: string; point: Vec3; normal: Vec3 }[];
  collisions: [number, number][];  // pairs that entered d < dCollide this tick
  nearMisses: [number, number][];  // pairs that entered d < dNear this tick
}
export interface World {
  readonly config: WorldConfig;
  step(): WorldSnapshot;                        // advance one tick
  schedule(e: EnvEvent): void;                  // tick must be > current tick
  inspect(id: number): { input: AgentInput; output: AgentOutput; state: unknown } | null;  // that drone's last step, deep-copied. For a dead drone: its final step. null only before its first step
  stateHash(): string;                          // hash of bodies + brain states, for replay tests
}
// src/sim exports:
//   createWorld(config: WorldConfig, test?: { reverseStepOrder?: boolean; freezeInputs?: boolean }): World
//   idsInSphere(snapshot: WorldSnapshot, centre: Vec3, radius: number): number[]      // live drones, ascending id
//   randomIds(seed: number, liveIds: number[], count: number): number[]
```

World behaviour that other packages rely on:

- **Launch:** drone `i` starts at rest on a ground grid (`y = 0`, 1.5 m pitch) with `initialSlot = i`.
- **Kill:** the drone becomes `alive: false` at that tick and is removed from sensing and radio immediately (it falls out of the show). Messages it had already sent are still delivered. A drone that fails by hovering dark in place is not modelled (§12).
- **Radio:** for each broadcast, every live drone within `rRadio` of the sender at send time is a candidate. It is `jammed` if sender or receiver is inside an active jam sphere at send time, `partitioned` if the two drones are in different groups of an active partition, `lost` with probability `loss`, otherwise delivered after a uniform `latencyMin…latencyMax` ticks.
- **Partition:** at `PARTITION_ON` the world puts every drone in group 0 or 1 by which side of the plane it is on. Until `PARTITION_OFF` the groups cannot hear each other, **wherever the drones then fly**. (A purely geometric plane would leak: drones flying to new slots would carry the new score across it within seconds.) A jam sphere, by contrast, is geometric: it silences whoever is inside it at the time.
- **Injection:** `INJECT_SCORE` puts one `ScoreMsg` with `from: OPERATOR` into that drone's inbox. Nothing else.
- **Same kills in both arms:** the app and CLI resolve "kill this region" or "kill 10%" to explicit ids first, then schedule the same `KILL` into both worlds. Scripted scenarios resolve against launch slots (drone `i` holds slot `i`), so the region is contiguous in both arms. Live clicks resolve against the Encore world's positions; after an earlier repair those ids may no longer be contiguous in the static world, which is why every evaluation scenario has a single kill event.

```ts
// src/contracts/metrics.ts
export interface MetricsSample {       // one per 5 ticks, per world
  tick: number; alive: number;
  coverage: number;                    // occupied slots / n0
  pwc: number; npwc: number;           // priority-weighted coverage, and normalised by what M survivors could reach
  sfMean: number; sfMax: number;       // shape fidelity, metres (label-independent)
  dupSlots: number;                    // slots claimed by 2+ live drones
  versions: Record<string, number>;    // "issuedTick:origin" -> live drones believing it
  msgs: { hb: number; score: number; delivered: number; lost: number; blocked: number };   // cumulative
  collisions: number; nearMisses: number; slotChanges: number;                               // cumulative
}
export interface RunRecord {
  v: 1; git: string; paramsHash: string;
  scenario: string; arm: 'encore' | 'static'; seed: number; n0: number;
  events: EnvEvent[];
  series: MetricsSample[];
  summary: Record<string, number | null>;   // keys defined in the evaluation doc
  stateHash: string;
}
```

```ts
// src/observer exports (one observer per world)
export type SlotStatus = 'occupied' | 'inTransit' | 'vacant' | 'contested';
export interface Observer {
  registerScore(score: Score): void;                     // call for the preloaded score and for every score scheduled with INJECT_SCORE
  sample(snapshot: WorldSnapshot): MetricsSample | null; // call every tick; returns a sample every 5 ticks
  slotStatus(snapshot: WorldSnapshot): { formation: Formation; inHold: boolean; status: SlotStatus[] };   // the reference formation at this tick, and each slot's status by index
  summary(): Record<string, number | null>;
}
// createObserver(params: Params): Observer
```

**Reference formation.** Each world is measured against the newest registered score that at least one live drone **in that world** believes, at the current movement by the clock. So the static world is always measured against its preloaded score, and is not marked down for a new score it could never receive; that capability difference is reported through the adoption metrics instead. "Occupied" is defined once, in the observer: a live drone within `rOcc` of the slot position. `inTransit`: not occupied, and exactly one live drone's `belief.slot` names it. `contested`: two or more do. `vacant`: none does. The app draws these and never recomputes them.

Metric formulas, tolerances and summary keys are defined once, in [`../validation/evaluation-and-tests.md`](../validation/evaluation-and-tests.md). The inspector shows `inspect().state` generically as a JSON tree and must not import `src/agent`, so a change to brain state cannot break it.

## 6. Composition: from recipe to slots

`src/score` exports pure, deterministic functions:

```ts
expandRecipe(recipe: Recipe, n0: number, params: Params): Formation     // memoised on JSON(recipe)+n0
currentMovement(score: Score, tick: number): { index: number; movement: Movement; holdStart: number; inHold: boolean }
newerVersion(a: ScoreVersion, b: ScoreVersion): boolean                 // (issuedTick, origin) lexicographic
composeNext(score: Score, tick: number, recipe: Recipe, origin: number, n0: number, params: Params): Score
launchPos(id: number, n0: number): Vec3
```

**Expansion.** (1) Generate a dense candidate cloud for the shape: about `4·n0` points for slot selection, and about 2000 for `dense`. Text uses a built-in 5×7 bitmap font table (no canvas, so Node and browser agree), supersampling each lit cell 3×3. Sphere uses a Fibonacci lattice. Helix samples two strands. (2) Pick `n0` slots by **farthest-point sampling**: slot 0 is the candidate nearest the centroid; each next slot is the candidate farthest from all slots chosen so far (ties: lowest candidate index). (3) Scale the shape uniformly about its centre, up or down, so that the closest pair of slots is `slotSpacingMin` (times 1.001, so rounding cannot leave it below), then translate it so the centre of `bounds` is (0, 30, 0). Local slot density is therefore the same at every `n0`. Choose each shape's proportions so that `bounds.min.y ≥ 2` at `n0` 40 and 200 (a squat helix, not a tall one). (4) Colour each slot from the palette as a gradient along x.

Why farthest-point order: **any prefix `0…k-1` is an evenly spread k-drone version of the shape.** Low indices carry the coarse outline; high indices add density. So "priority" means "how much of the outline this slot carries", and sacrificing the highest indices thins the image instead of holing it.

**Slot persistence.** Every formation has exactly `n0` slots, so a slot index means something in every formation. The drone holding index `i` flies to slot `i` of whatever formation is current. Changing formation needs no reassignment and no messages.

**Timing.** `currentMovement` returns the last movement with `startTick <= tick`. `holdStart = startTick + transitionTicks`. Authoring sets `transitionTicks = ceil((maxSlotDisplacement / (0.5·vMax) + 3 s) / DT)`.

**New compositions.** `composeNext` builds the score the operator injects: version `{issuedTick: tick, origin}`, and movements = the old score's current movement (unchanged) followed by the new recipe starting at `tick + scoreLead`. Because the version is the injection tick, the operator's most recent composition always wins.

**Shared vocabulary vs live knowledge.** Every drone can compute every slot position of every formation from the score alone. That is the vocabulary. It tells a drone nothing about which drones are alive, where they are, or which slots are filled.

## 7. Drone private state

```ts
// src/agent/state.ts (not a contract: owned by the agent package; shown for the inspector and tests)
interface EncoreState {
  id: number; n0: number; params: Params;
  slot: number; heldSince: number;
  history: { slot: number; heldSince: number }[];   // previous slots, most recent last; launch slot is the home
  score: Score; mvIndex: number;
  lastTargetChange: number;     // tick my slot or formation last changed
  settledSince: number | null;
  lastRx: number;               // tick of last radio message from another drone
  peers: ({ slot: number; heldSince: number; version: ScoreVersion; claim: { slot: number; rank: number } | null; heard: number } | null)[];  // by id
  slotHeard: number[];          // by slot: last tick I heard a heartbeat holding it (init 0)
  emptySince: (number | null)[];// by slot: since when I have sensed it empty (null = not empty / not watched)
  claim: { slot: number; start: number } | null;
  yieldSince: number | null;
  scoreSendAt: number | null; lastScoreSent: number;
  seq: number; rng: number;     // message counter; seeded PRNG state
  log: string[];
}
```

## 8. Healing: local claims (ADR-007)

The idea in one paragraph: a drone that **sees** an empty slot nearby that is more important than its own, and has heard nobody holding it, announces a claim in its heartbeat for one second. If several drones claim the same slot, the one whose current slot is **least important** wins. The winner flies in; the slot it left is less important, and may in turn be claimed by an even less important neighbour. Holes therefore move outward and downward in priority until they sit in slots nobody nearby wants. No drone ever needs a global view.

### 8.1 Three levels of knowledge about another drone

| Level | Meaning | What it permits |
|---|---|---|
| Last-known | An entry in `peers` | Nothing. It may be stale |
| Suspected | No heartbeat holding slot `v` heard for `tSuspect` | Nothing by itself. **Radio silence is never treated as death** |
| Locally observed vacancy | Suspected **and** I have sensed nobody within `rOcc` of slot `v`'s position for `tVacant` **and** I may heal (`canHeal`) | I may claim `v` |

Ground truth (who is really dead) exists only in the world and the observer.

### 8.2 `canHeal`: when a drone is allowed to judge vacancies

All must hold, evaluated on the drone's own data:

1. The current movement is in hold: `tick >= holdStart + holdGrace`.
2. My own target has not changed for `tStable` (my slot and formation are the same as 6 s ago).
3. I have been within `rOcc` of my slot, slower than 0.5 m/s, for `tSettle`.
4. Every heartbeat I heard in the last `tDeaf` ticks carried my score version.
5. I am not deaf: I heard at least one message from another drone within `tDeaf`.

If `canHeal` is false: clear all `emptySince` timers and drop any claim. **A deaf drone therefore never claims.** It keeps flying its score, which is exactly what the static baseline does.

### 8.3 Per-tick logic

```text
step(s, in):
  now = in.tick

  # 1. Inbox (already sorted)
  for m in in.inbox:
    if m.from != OPERATOR: s.lastRx = now
    if m.type == SCORE:
      if newerVersion(m.score.version, s.score.version): adopt(m.score)            # section 9
      elif same version and s.scoreSendAt != null: s.scoreSendAt = null            # someone nearby just sent it
    if m.type == HB:
      s.peers[m.from] = {slot, heldSince, version, claim, heard: now}
      s.slotHeard[m.slot] = now
      if newerVersion(s.score.version, m.version): scheduleScoreSend()             # they are stale
      if m.slot == s.slot and (m.heldSince, m.from) < (s.heldSince, s.id):         # duplicate: earlier holder keeps
        popHistory("lost duplicate to " + m.from)
      if s.claim and m.claim and m.claim.slot == s.claim.slot
         and (m.claim.rank, -m.from) > (s.slot, -s.id):                            # better bid heard
        s.claim = null

  # 2. Target
  mv = currentMovement(s.score, now)
  if mv.index != s.mvIndex: s.mvIndex = mv.index; targetChanged()
  target = expandRecipe(mv.movement.recipe, n0, params).slots[s.slot].pos
  update s.settledSince from |in.pos - target| < rOcc and |in.vel| < 0.5

  # 3. Physical yield (works without radio). Only in hold: during a transition, drones passing through my slot are not holders
  if mv.inHold and s.history is not empty and |in.pos - target| > rOcc:
    seen = any sensed drone within rOcc of target
    s.yieldSince = seen ? (s.yieldSince ?? now) : null
    if s.yieldSince != null and now - s.yieldSince >= yieldTicks: popHistory("slot already occupied")

  # 4. Scan and claim, on my heartbeat ticks only (now % hbPeriod == id % hbPeriod)
  if scan tick:
    if not canHeal(): s.emptySince = all null; s.claim = null
    else:
      for v != s.slot with |slotPos(v) - in.pos| <= rClaim:
        empty = no sensed drone within rOcc of slotPos(v)
        s.emptySince[v] = empty ? (s.emptySince[v] ?? now) : null
      vacant(v) := s.emptySince[v] != null and now - s.emptySince[v] >= tVacant
                   and now - s.slotHeard[v] >= tSuspect
      if s.claim:
        if not vacant(s.claim.slot): s.claim = null
        elif now - s.claim.start >= claimWindow: commit(s.claim.slot)
      if not s.claim and I did not commit this tick:
        V = { v : vacant(v) and v + claimGap < s.slot
                  and no peer heard within claimWindow is claiming v with a better bid }
        if V not empty: s.claim = { slot: min(V), start: now }

  # 5. Send
  if heartbeat tick: send HB { slot, heldSince, version, pos, claim: s.claim ? {slot: s.claim.slot, rank: s.slot} : absent }
  if s.scoreSendAt != null and now >= s.scoreSendAt: send SCORE; s.lastScoreSent = now; s.scoreSendAt = null

  # 6. Move and light: section 10
```

```text
commit(v):       history.push({slot: s.slot, heldSince: s.heldSince})  (drop the oldest if longer than historyMax)
                 s.slot = v; s.heldSince = now; s.claim = null; targetChanged(); log
popHistory(why): if history is empty: log "anomaly" and keep the slot
                 else: {slot, heldSince} = history.pop(); s.slot = slot; s.heldSince = heldSince; s.claim = null; targetChanged(); log
targetChanged(): s.lastTargetChange = now; s.settledSince = null; s.yieldSince = null; s.emptySince = all null
```

A bid is `(rank, -id)`, compared lexicographically: the higher current slot index wins; on a tie the lower id wins.

### 8.4 Why this settles

- **Claims only go down.** A commit moves a drone to a slot at least `claimGap + 1` more important. So a drone can commit at most `n0 / claimGap` times, and can never cycle back by claiming.
- **Only two things move a drone back up:** losing a duplicate, and the physical yield. Both pop one entry off its history, and each drone's history is finite. A popped drone returns with its **original** `heldSince`, so it outranks anyone who took that slot later, and they pop in turn. The launch slot has `heldSince = 0` and is unique per drone, so every live drone always has a home.
- **Radio trouble alone cannot cause a move.** A vacancy needs the slot to be physically empty, and a deaf drone does not claim. The one case where radio trouble *plus movement* does is limit 7 below.

This is an argument, not a proof, and it assumes failures eventually stop. The evaluation measures it: slot changes per drone, duplicate-slot seconds, and commits after the system should be quiet.

### 8.5 Known limits (state these, don't hide them)

1. **Repair is local.** A hole is filled only by drones within `rClaim` of it that sense it. A wiped region heals inward from its rim, layer by layer, and an island with no survivor within sensing range is never detected. The loss ends up spread over the surrounding neighbourhood, not over the whole formation.
2. **It is greedy, not optimal.** The final holes are in locally unimportant slots, which need not be the globally least important ones.
3. **It is slow by design:** about 3 s to detect, 1 s to contend, then flight time, per hop of the chain.
4. **No healing during transitions, inside a jam, or while score versions disagree nearby.**
5. **Duplicates can happen** when two claimants cannot hear each other (partition, or every repeat of the claim lost). They clear on radio contact (earlier holder keeps) or by physical yield. Until then two drones crowd one slot; this is counted, not hidden.
6. **A returning drone causes churn.** If a drone was wrongly taken for dead (for example, a laggard out of radio range), the claimant flies back when the holder reappears.
7. **A partition during a formation change looks like a mass failure to the group left behind.** If one group adopts a new score and flies away while the other group cannot hear it, the second group sees slots that are empty and silent, which is exactly its evidence for failure, and it repairs its old formation. That is correct on what it knows. On reconnection it adopts the new score, the original holders (earlier `heldSince`) keep their slots, and the claimants pop back. The churn is counted in slot changes and duplicate-slot seconds.

### 8.6 The first falsification test (gate G1)

Headless, `n0 = 40` on a text formation, 20% loss, one seed first, then five:

1. **Null run.** No kills, one formation change, 60 s. Pass: zero slot changes.
2. **Clumped kill.** In hold, kill the 5 drones nearest a chosen slot. Pass within 30 s: no slot held by two drones for more than 3 s; no commits in the last 10 s; commits ≤ 3 × kills; every commit lowers the committer's slot index; normalised priority-weighted coverage ends above the static brain's on the same seed and kills.
3. **Silence is not death.** No kills, full radio jam from 5 s to 40 s. Pass: zero slot changes.

If test 2 cannot be made to pass by about 23:30, use the fallback ladder in [`decisions-and-risks.md`](../planning/decisions-and-risks.md#fallback-ladder-if-healing-fails-g1).

## 9. Score dissemination and partitions (ADR-005, ADR-008)

- **Adopt** a received score only if its version is newer: `s.score = score; recompute mvIndex; targetChanged(); scheduleScoreSend()`.
- **`scheduleScoreSend()`:** if no send is pending and `now - lastScoreSent >= scoreResendMin`, set `scoreSendAt = now + 1 + (rng % scoreJitter)`. If the same version is heard before then, cancel (someone nearby already sent it).
- **Anti-entropy:** every heartbeat carries the sender's version. A drone that hears an older version schedules a `SCORE` send. A drone that hears a newer one does nothing: the newer drone will hear its heartbeat and send.
- **Late adopters** join by the clock: `currentMovement` puts them straight into whatever movement is current, and `canHeal` keeps them from judging vacancies until they have arrived and settled.

What each kind of convergence means, and what we claim:

| Kind | Claim |
|---|---|
| Score version | Two drones that can exchange messages (directly or through a chain of drones) end up on the same, newest version, with probability 1 under independent loss < 1. **Across a partition or into a jam they do not**: the two groups fly different formations until radio returns. That is the honest behaviour, and the belief view shows it |
| Peer tables | Never claimed to be equal across drones. They are local and decay |
| Formation recovery | Bounded by §8.5. Measured, not guaranteed |
| Collision avoidance | Not guaranteed. Measured |

Two scores injected on opposite sides of a partition: after reconnection the one with the later `issuedTick` wins everywhere (ties: higher origin id).

## 10. Motion

The brain proposes an acceleration; the world enforces limits (clamps `|accel| <= aMax`, integrates velocity, clamps `|vel| <= vMax`, integrates position, keeps `y >= 0`). Both arms use the same steering function (`src/agent/steer.ts`).

```text
steer(pos, vel, target, sensed, params):
  d = target - pos;  dist = |d|
  vDes = normalise(d) * min(vMax, sqrt(aMax * dist))        # slows down on approach
  a = (vDes - vel) * 4                                      # velocity tracking, gain 4 /s
  for n in sensed with r = |n.rel| < dAvoid:
    a += -normalise(n.rel) * aMax * (dAvoid - r) / dAvoid   # separation
    if dot(n.rel, n.vel) < 0:                               # closing: sidestep
      a += normalise(cross(n.rel, [0,1,0])) * 0.3 * aMax    # the other drone sees -rel, so it sidesteps the opposite way
  return a
```

`dAvoid < slotSpacingMin`, so drones at rest on their slots do not push each other. Light colour is the slot's colour.

SHOULD (`transitLanes`): while more than 3 m from the target, aim at `target + [0, 0, ((id % 3) - 1) * 2]` so crossing traffic is spread over three depth layers, then go straight in. Turn it on only if transitions gridlock or collision counts are ugly.

Collisions (`d < dCollide`) and near-misses (`d < dNear`) are **counted from true positions by the world and have no physical effect**. A pair is counted once each time it enters the distance. At `vMax` two drones can close 0.8 m in one tick, so end-of-tick sampling can miss a fast pass: counts are lower bounds unless the world uses the closest approach within the tick (SHOULD). We never claim collision-freedom; we report the counts. This is a simulated proof of concept, not flight-control software.

## 11. Static baseline brain

`src/agent/staticBrain.ts`, `kind: 'static'`. It keeps `slot = initialSlot` for ever, flies `expandRecipe(currentMovement(preloadedScore, tick)).slots[slot]` with the same `steer`, sends nothing, and ignores its inbox (so an injected score has no effect: that is inherent to a pre-uploaded show, and is reported as a capability difference). It does **not** freeze or degrade under jamming or failures: surviving drones keep flying their trajectories.

## 12. Deliberately not in the MVP

| Left out | Why | Revisit if |
|---|---|---|
| Gossiped membership table / per-slot register | Not needed for local repair; adds an O(n0) table, anti-entropy and relays | Local repair proves too weak and there is time (STRETCH) |
| Flooded vacancy or claim messages | Every eligible claimant already senses the vacancy; flooding costs millions of deliveries on a clumped kill and amplifies one false positive | — |
| Long-range "tail" reassignment (least important drone anywhere flies in) | Long crossings, needs the register above | STRETCH |
| Central ground-station baseline | Needs its own radio and fallback model to be fair | STRETCH; if built, label an instant global assignment "oracle upper bound", not a competitor |
| Clock drift, sensing noise, radio fading, collisions that destroy drones | Simplifying assumptions AS-01…AS-04, stated in [`../context/evidence-and-assumptions.md`](../context/evidence-and-assumptions.md) | — |
| Dark-but-hovering failures | Indistinguishable from a live jammed drone by sensing | — |
| Rotating or animated holds | Makes "settled" and vacancy sensing harder | STRETCH (camera auto-orbit gives motion for free) |
| Malicious drones | All drones are assumed honest; any drone can inject a score | — |
| Any physical hardware (drones, microcontrollers, LEDs, sensors, GPS, radios), any network or external service | Out of scope by team decision: Encore is software-only and runs on one laptop ([NFR-10](../specification/requirements.md)) | Never |
