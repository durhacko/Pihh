// tests/g1/helpers.ts
// Shared by the G1 tests (issue #17): run a REAL world (src/sim) and measure from its snapshots.
// Everything measured here is computed inline from WorldSnapshot with the formulas of
// docs/validation/evaluation-and-tests.md section 2. No brain state is read: only DroneSnap
// (alive, pos, belief) and RadioEvent. Not a test file: vitest collects only *.test.ts.
import { expect } from 'vitest';
import { DT, makeParams } from '../../src/contracts';
import type { AgentBrain, EnvEvent, Formation, Params, Recipe, Score, Vec3, WorldSnapshot } from '../../src/contracts';
import { currentMovement, expandRecipe, makeScore } from '../../src/score';
import { createWorld, randomIds } from '../../src/sim';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { staticBrain } from '../../src/agent/staticBrain';

// ---------- the experiment ----------

export const LOSS = 0.2;                                         // section 8.6: 20 % packet loss
export const TEXT: Recipe = { kind: 'text', text: 'ENCORE' };
export const SPHERE: Recipe = { kind: 'sphere' };
export const LONG_HOLD = 100000;                                 // a hold longer than any run here

/**
 * Protocol timers and gaps tuned for G1. Allowed keys: tVacant, tSuspect, claimWindow, claimGap, tStable,
 * tSettle, holdGrace, yieldTicks. EMPTY = the contract defaults of makeParams(n0). Every entry must be
 * reported in the pull request with its reason.
 */
export const OVERRIDES: Partial<Params> = {};
export const ALLOWED_OVERRIDES = ['tVacant', 'tSuspect', 'claimWindow', 'claimGap', 'tStable', 'tSettle', 'holdGrace', 'yieldTicks'];

export const g1Params = (n0: number): Params => makeParams(n0, { loss: LOSS, ...OVERRIDES });
export const sec = (seconds: number): number => Math.round(seconds / DT);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const f3 = (x: number | null): string => (x === null ? 'null' : x.toFixed(4));

// ---------- run, and measure from snapshots ----------

export interface RunConfig { seed: number; params: Params; score: Score; brain: AgentBrain; events?: EnvEvent[] }

/** Runs a real world for `ticks` ticks. snaps[t - 1] is the snapshot of tick t. */
export function runWorld(config: RunConfig, ticks: number): WorldSnapshot[] {
  const world = createWorld({ seed: config.seed, params: config.params, score: config.score, brain: config.brain, events: config.events ?? [] });
  const snaps: WorldSnapshot[] = [];
  for (let t = 0; t < ticks; t++) snaps.push(world.step());
  return snaps;
}

/** The reference formation: the preloaded score's current movement at this tick. */
export function formationAt(score: Score, tick: number, params: Params): Formation {
  return expandRecipe(currentMovement(score, tick).movement.recipe, params.n0, params);
}

export interface Coverage { alive: number; occ: boolean[]; coverage: number; pwc: number; npwc: number | null }

/**
 * Evaluation doc section 2. occ_i = 1 if any live drone's TRUE position is within rOcc of slot i, whatever
 * slot it believes it holds. w_i = 2(n0 - i) / (n0(n0 + 1)). pwc = sum w_i occ_i. npwc = pwc / P*(M),
 * P*(M) = sum of w_i for i < M (the best M survivors could do with a global reassignment).
 */
export function coverageOf(snap: WorldSnapshot, score: Score, params: Params): Coverage {
  const n0 = params.n0;
  const w = (i: number): number => (2 * (n0 - i)) / (n0 * (n0 + 1));
  const live = snap.drones.filter(d => d.alive);
  const formation = formationAt(score, snap.tick, params);
  const occ = formation.slots.map(slot => live.some(d => dist(d.pos, slot.pos) <= params.rOcc));
  let pwc = 0;
  let occupied = 0;
  for (let i = 0; i < n0; i++) if (occ[i]) { pwc += w(formation.slots[i].index); occupied++; }
  let best = 0;
  for (let i = 0; i < live.length; i++) best += w(i);
  return { alive: live.length, occ, coverage: occupied / n0, pwc, npwc: live.length === 0 ? null : pwc / best };
}

/**
 * Evaluation doc section 2, shape fidelity: the distance from each point of the reference formation's dense
 * cloud to the nearest live drone; mean and max, in metres. It does not use the slot order, so it is the
 * check on npwc that does not depend on our own priority labels. Lower is better.
 */
export function shapeFidelityOf(snap: WorldSnapshot, score: Score, params: Params): { sfMean: number | null; sfMax: number | null } {
  const live = snap.drones.filter(d => d.alive);
  const dense = formationAt(score, snap.tick, params).dense;
  if (live.length === 0 || dense.length === 0) return { sfMean: null, sfMax: null };
  let sum = 0;
  let max = 0;
  for (const point of dense) {
    let nearest = Infinity;
    for (const d of live) nearest = Math.min(nearest, dist(point, d.pos));
    sum += nearest;
    if (nearest > max) max = nearest;
  }
  return { sfMean: sum / dense.length, sfMax: max };
}

export interface SlotChange { tick: number; id: number; from: number; to: number; commit: boolean; log: string }

/**
 * Every tick at which a live drone's belief.slot differs from the tick before (before tick 1: its launch
 * slot, which is its id). `commit` = the new belief.heldSince is this tick (section 8.3: commit sets
 * heldSince = now; popHistory restores the original, older heldSince).
 */
export function slotChangesOf(snaps: WorldSnapshot[]): SlotChange[] {
  const out: SlotChange[] = [];
  const before = snaps[0].drones.map(d => d.id);
  for (const snap of snaps) {
    for (const d of snap.drones) {
      if (d.alive && d.belief.slot !== before[d.id]) {
        out.push({
          tick: snap.tick, id: d.id, from: before[d.id], to: d.belief.slot,
          commit: d.belief.heldSince === snap.tick, log: d.belief.log[d.belief.log.length - 1] ?? '',
        });
      }
      before[d.id] = d.belief.slot;
    }
  }
  return out;
}

export interface Duplicates { longestTicks: number; longestSlot: number; slotSeconds: number }

/** Slots named as belief.slot by two or more live drones: the longest unbroken run for one slot, and slot-seconds. */
export function duplicatesOf(snaps: WorldSnapshot[], n0: number): Duplicates {
  const run = new Array<number>(n0).fill(0);
  let longestTicks = 0;
  let longestSlot = -1;
  let slotTicks = 0;
  for (const snap of snaps) {
    const believers = new Array<number>(n0).fill(0);
    for (const d of snap.drones) if (d.alive) believers[d.belief.slot]++;
    for (let v = 0; v < n0; v++) {
      if (believers[v] >= 2) {
        run[v]++;
        slotTicks++;
        if (run[v] > longestTicks) { longestTicks = run[v]; longestSlot = v; }
      } else run[v] = 0;
    }
  }
  return { longestTicks, longestSlot, slotSeconds: slotTicks * DT };
}

/** Evaluation doc section 2, dupSlots: slots named as belief.slot by two or more live drones at this tick. */
export function dupSlotCount(snap: WorldSnapshot, n0: number): number {
  const believers = new Array<number>(n0).fill(0);
  for (const d of snap.drones) if (d.alive) believers[d.belief.slot]++;
  return believers.filter(count => count >= 2).length;
}

export function maxChangesPerDrone(changes: SlotChange[]): number {
  const count = new Map<number, number>();
  for (const c of changes) count.set(c.id, (count.get(c.id) ?? 0) + 1);
  return Math.max(0, ...count.values());
}

/** Share of in-range receivers that the medium's own log reports as lost, over broadcasts sent in [from, to). */
export function lossRate(snaps: WorldSnapshot[], from = 1, to = Infinity): number {
  let lost = 0;
  let delivered = 0;
  for (const s of snaps) if (s.tick >= from && s.tick < to) for (const r of s.radio) { lost += r.lost; delivered += r.delivered.length; }
  return lost / (lost + delivered);
}

/**
 * The first tick by which every drone can have canHeal (section 8.2), for a movement whose hold begins at
 * `holdStart` and whose target last changed at `targetSince`: past the hold grace (1), target unchanged
 * for tStable (2), then settled for tSettle (3), then one more heartbeat period so that every drone has
 * had a scan tick. An upper bound by construction; the tests still assert it on the beliefs.
 */
export function healReadyTick(holdStart: number, targetSince: number, p: Params): number {
  return Math.max(holdStart + p.holdGrace, targetSince + p.tStable) + p.tSettle + p.hbPeriod;
}

/** The `count` slot indices nearest slot `c` (c included, distance 0); ties by the lower index. Ascending. */
export function nearestSlots(formation: Formation, c: number, count: number): number[] {
  const centre = formation.slots[c].pos;
  return formation.slots
    .map(s => ({ index: s.index, d: dist(s.pos, centre) }))
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .slice(0, count)
    .map(e => e.index)
    .sort((a, b) => a - b);
}

/** The kill centre of a seed: one slot drawn from the seeded stream, as scenario S2 does. Fixed before any run. */
export function centreFor(seed: number, n0: number): number {
  return randomIds(seed, Array.from({ length: n0 }, (_, i) => i), 1)[0];
}

// ---------- test 1: null run ----------

export interface NullRun {
  seed: number; ticks: number; changes: SlotChange[];
  healTicksHold1: number; healTicksHold2: number;       // ticks of each hold on which EVERY drone reported canHeal
  claims: number;                                       // heartbeats that carried a claim
  loss: number; npwcEndHold1: number | null; npwcEnd: number | null; collisions: number;
}

export function nullRun(seed: number): NullRun {
  const params = g1Params(40);
  const score = makeScore([TEXT, SPHERE], 40, params, sec(20));    // text, hold 20 s, then one formation change
  const ticks = sec(60);
  const second = score.movements[1];
  const hold1 = score.movements[0].startTick + score.movements[0].transitionTicks;
  const hold2 = second.startTick + second.transitionTicks;
  // The run must contain both holds, each long enough for every drone to become able to heal.
  expect(healReadyTick(hold1, 0, params)).toBeLessThan(second.startTick - sec(5));
  expect(healReadyTick(hold2, second.startTick, params)).toBeLessThan(ticks - sec(5));

  const snaps = runWorld({ seed, params, score, brain: encoreBrain }, ticks);
  const allHeal = (s: WorldSnapshot): boolean => s.drones.every(d => d.belief.canHeal);
  return {
    seed, ticks, changes: slotChangesOf(snaps),
    healTicksHold1: snaps.filter(s => s.tick >= hold1 && s.tick < second.startTick && allHeal(s)).length,
    healTicksHold2: snaps.filter(s => s.tick >= hold2 && allHeal(s)).length,
    claims: snaps.reduce((sum, s) => sum + s.radio.filter(r => r.claimSlot !== null).length, 0),
    loss: lossRate(snaps),
    npwcEndHold1: coverageOf(snaps[second.startTick - 2], score, params).npwc,
    npwcEnd: coverageOf(snaps[ticks - 1], score, params).npwc,
    collisions: snaps.reduce((sum, s) => sum + s.collisions.length, 0),
  };
}

export function expectNullRun(r: NullRun): void {
  expect(r.healTicksHold1, 'ticks in hold 1 on which every drone could heal').toBeGreaterThanOrEqual(sec(5));
  expect(r.healTicksHold2, 'ticks in hold 2 on which every drone could heal').toBeGreaterThanOrEqual(sec(5));
  expect(r.loss, 'measured packet loss').toBeGreaterThan(0.18);
  expect(r.loss, 'measured packet loss').toBeLessThan(0.22);
  expect(r.changes, 'slot changes in a run without failures').toEqual([]);                   // section 8.6, test 1
}

export function describeNullRuns(label: string, runs: NullRun[]): string {
  return `G1 null run, ${label}: slot changes ${runs.map(r => r.changes.length).join(', ')}; claims announced ${runs.map(r => r.claims).join(', ')}; `
    + `ticks with every drone able to heal, hold 1: ${runs.map(r => r.healTicksHold1).join(', ')}, hold 2: ${runs.map(r => r.healTicksHold2).join(', ')}; `
    + `measured loss ${runs.map(r => r.loss.toFixed(3)).join(', ')}; npwc end of hold 1 ${runs.map(r => f3(r.npwcEndHold1)).join(', ')}, end ${runs.map(r => f3(r.npwcEnd)).join(', ')}; `
    + `collisions counted ${runs.map(r => r.collisions).join(', ')}`;
}

// ---------- test 2: clumped kill ----------

export interface KillSetUp {
  seed: number; n0: number; centre: number; params: Params; score: Score; formation: Formation;
  killTick: number; endTick: number; killed: number[]; events: EnvEvent[];
}

/**
 * One movement (text) in a long hold. The kill comes at the first tick by which every drone can heal; the
 * run ends `windowSec` later. Section 8.6 says 30 s; a longer window is used only to look at what happens next.
 */
export function killSetUp(seed: number, n0: number, kills: number, centre: number, windowSec = 30): KillSetUp {
  const params = g1Params(n0);
  const score = makeScore([TEXT], n0, params, LONG_HOLD);
  const holdStart = score.movements[0].startTick + score.movements[0].transitionTicks;
  const killTick = healReadyTick(holdStart, 0, params);
  const formation = formationAt(score, killTick, params);
  const killed = nearestSlots(formation, centre, kills);          // drone i holds slot i until the kill (asserted)
  return { seed, n0, centre, params, score, formation, killTick, endTick: killTick + sec(windowSec), killed, events: [{ type: 'KILL', tick: killTick, ids: killed }] };
}

export const runArm = (s: KillSetUp, brain: AgentBrain): WorldSnapshot[] =>
  runWorld({ seed: s.seed, params: s.params, score: s.score, brain, events: s.events }, s.endTick);

export interface Arm {
  npwcBefore: number | null; npwcAfter: number | null; npwcEnd: number | null; npwcLast5s: number; coverageEnd: number;
  sfMeanBefore: number | null; sfMaxBefore: number | null; sfMeanEnd: number | null; sfMaxEnd: number | null;   // label-independent
}
export interface ClumpedKill {
  seed: number; n0: number; centre: number; killTick: number; endTick: number; killed: number[];
  ready: { allCanHeal: boolean; allOnOwnSlot: boolean; noChangeBeforeKill: boolean };
  loss: number;
  changes: SlotChange[]; commits: SlotChange[]; pops: SlotChange[];
  lastCommitSec: number | null;          // seconds from the kill to the last commit
  lateCommits: SlotChange[];             // commits in the last 10 s
  lateChanges: SlotChange[];             // any slot change in the last 10 s
  raising: SlotChange[];                 // commits that do NOT lower the slot index
  dup: Duplicates; maxPerDrone: number;
  emptyAtEnd: number[];                  // slots with no live drone within rOcc at the end
  collisionsAfterKill: number; nearMissesAfterKill: number;
  encore: Arm; fixed: Arm;
  verdict: { dupOk: boolean; quietOk: boolean; countOk: boolean; lowerOk: boolean; npwcOk: boolean; all: boolean };
}

function armOf(snaps: WorldSnapshot[], s: KillSetUp): Arm {
  const end = snaps.length;
  let sum = 0;
  for (let t = end - sec(5) + 1; t <= end; t++) sum += coverageOf(snaps[t - 1], s.score, s.params).npwc ?? 0;
  const last = coverageOf(snaps[end - 1], s.score, s.params);
  const sfBefore = shapeFidelityOf(snaps[s.killTick - 2], s.score, s.params);
  const sfEnd = shapeFidelityOf(snaps[end - 1], s.score, s.params);
  return {
    sfMeanBefore: sfBefore.sfMean, sfMaxBefore: sfBefore.sfMax, sfMeanEnd: sfEnd.sfMean, sfMaxEnd: sfEnd.sfMax,
    npwcBefore: coverageOf(snaps[s.killTick - 2], s.score, s.params).npwc,     // the tick before the kill
    npwcAfter: coverageOf(snaps[s.killTick - 1], s.score, s.params).npwc,      // the kill tick: the drones are gone
    npwcEnd: last.npwc,
    npwcLast5s: sum / sec(5),
    coverageEnd: last.coverage,
  };
}

/** `encore` and `fixed` are the two arms of the same set-up: same seed, score, params and kill ids; only the brain differs. */
export function analyseKill(s: KillSetUp, encore: WorldSnapshot[], fixed: WorldSnapshot[]): ClumpedKill {
  const { n0, params, killTick, endTick, formation } = s;
  const kills = s.killed.length;
  const justBefore = encore[killTick - 2];
  const changes = slotChangesOf(encore);
  const commits = changes.filter(c => c.commit);
  const lastCommit = commits.length ? commits[commits.length - 1].tick : null;
  const dup = duplicatesOf(encore, n0);
  const a = armOf(encore, s);
  const b = armOf(fixed, s);
  const lateCommits = commits.filter(c => c.tick > endTick - sec(10));
  const raising = commits.filter(c => !(c.to < c.from));
  const last = coverageOf(encore[endTick - 1], s.score, params);
  const afterKill = encore.filter(x => x.tick >= killTick);
  const verdict = {
    dupOk: dup.longestTicks <= sec(3),                           // no slot held by two live drones for more than 3 s
    quietOk: lateCommits.length === 0,                           // no commits in the last 10 s
    countOk: commits.length <= 3 * kills,                        // commits <= 3 x kills
    lowerOk: raising.length === 0,                               // every commit lowers the committer's slot index
    npwcOk: a.npwcEnd !== null && b.npwcEnd !== null && a.npwcEnd > b.npwcEnd,   // strictly above the static brain
    all: false,
  };
  verdict.all = verdict.dupOk && verdict.quietOk && verdict.countOk && verdict.lowerOk && verdict.npwcOk;
  return {
    seed: s.seed, n0, centre: s.centre, killTick, endTick, killed: s.killed,
    ready: {
      allCanHeal: justBefore.drones.every(d => d.belief.canHeal),
      allOnOwnSlot: justBefore.drones.every(d => d.alive && d.belief.slot === d.id && dist(d.pos, formation.slots[d.id].pos) <= params.rOcc),
      noChangeBeforeKill: changes.every(c => c.tick >= killTick),
    },
    loss: lossRate(encore),
    changes, commits, pops: changes.filter(c => !c.commit),
    lastCommitSec: lastCommit === null ? null : (lastCommit - killTick) * DT,
    lateCommits, lateChanges: changes.filter(c => c.tick > endTick - sec(10)), raising,
    dup, maxPerDrone: maxChangesPerDrone(changes),
    emptyAtEnd: last.occ.map((o, i) => (o ? -1 : i)).filter(i => i >= 0),
    collisionsAfterKill: afterKill.reduce((sum, x) => sum + x.collisions.length, 0),
    nearMissesAfterKill: afterKill.reduce((sum, x) => sum + x.nearMisses.length, 0),
    encore: a, fixed: b, verdict,
  };
}

export function clumpedKill(seed: number, n0: number, kills: number, centre: number, windowSec = 30): ClumpedKill {
  const s = killSetUp(seed, n0, kills, centre, windowSec);
  return analyseKill(s, runArm(s, encoreBrain), runArm(s, staticBrain));
}

/** The set-up is what the test says it is: the kill hit drones that could heal and stood on their own slots. */
export function expectSetUp(r: ClumpedKill): void {
  expect(r.ready, `seed ${r.seed}, centre ${r.centre}: state one tick before the kill`).toEqual({ allCanHeal: true, allOnOwnSlot: true, noChangeBeforeKill: true });
  expect(r.loss, 'measured packet loss').toBeGreaterThan(0.18);
  expect(r.loss, 'measured packet loss').toBeLessThan(0.22);
  expect(r.encore.npwcBefore).toBeCloseTo(1, 12);
  expect(r.fixed.npwcBefore).toBeCloseTo(1, 12);
  expect(r.fixed.npwcAfter).toBeCloseTo(r.encore.npwcAfter ?? -1, 12);     // the same kill in both arms
  expect(r.fixed.npwcEnd).toBeCloseTo(r.fixed.npwcAfter ?? -1, 12);        // the static brain keeps the hole
}

/** Section 8.6, test 2: all five conditions. */
export function expectClumpedKillPasses(r: ClumpedKill): void {
  const kills = r.killed.length;
  const where = `seed ${r.seed}, centre ${r.centre}`;
  expect(r.dup.longestTicks * DT, `${where}: longest time one slot was held by two live drones (slot ${r.dup.longestSlot}), s`).toBeLessThanOrEqual(3);
  expect(r.lateCommits, `${where}: commits in the last 10 s`).toEqual([]);
  expect(r.commits.length, `${where}: commits`).toBeLessThanOrEqual(3 * kills);
  for (const c of r.commits) {
    expect(c.to, `${where}: commit of drone ${c.id} at tick ${c.tick}, ${c.from} -> ${c.to}`).toBeLessThan(c.from);
    expect(c.log, 'the brain logged this change as a commit').toContain(`commit slot ${c.to} (was ${c.from})`);
  }
  expect(r.encore.npwcEnd, `${where}: final npwc, Encore`).not.toBeNull();
  expect(r.encore.npwcEnd as number, `${where}: final npwc, Encore against static ${f3(r.fixed.npwcEnd)}`).toBeGreaterThan(r.fixed.npwcEnd as number);
}

export function describeKill(r: ClumpedKill): string[] {
  const move = (c: SlotChange): string => `t+${((c.tick - r.killTick) * DT).toFixed(2)}s drone ${c.id}: ${c.from}->${c.to}`;
  return [
    `G1 clumped kill, seed ${r.seed}, n0 ${r.n0}: centre slot ${r.centre}, kill tick ${r.killTick}, end tick ${r.endTick}, measured loss ${r.loss.toFixed(3)}`,
    `  kills (${r.killed.length}): drones/slots ${r.killed.join(', ')}`,
    `  commits (${r.commits.length}): ${r.commits.map(move).join('; ') || 'none'}`,
    `  pops (${r.pops.length}): ${r.pops.map(move).join('; ') || 'none'}`,
    `  time from the kill to the last commit: ${r.lastCommitSec === null ? 'no commit' : r.lastCommitSec.toFixed(2) + ' s'}`,
    `  npwc Encore: before ${f3(r.encore.npwcBefore)}, just after ${f3(r.encore.npwcAfter)}, end ${f3(r.encore.npwcEnd)} (mean of last 5 s ${f3(r.encore.npwcLast5s)}), coverage end ${f3(r.encore.coverageEnd)}`,
    `  npwc static: before ${f3(r.fixed.npwcBefore)}, just after ${f3(r.fixed.npwcAfter)}, end ${f3(r.fixed.npwcEnd)} (mean of last 5 s ${f3(r.fixed.npwcLast5s)}), coverage end ${f3(r.fixed.coverageEnd)}`,
    `  shape fidelity (label-independent, metres, lower is better): before the kill mean ${f3(r.encore.sfMeanBefore)} max ${f3(r.encore.sfMaxBefore)}; end Encore mean ${f3(r.encore.sfMeanEnd)} max ${f3(r.encore.sfMaxEnd)}; end static mean ${f3(r.fixed.sfMeanEnd)} max ${f3(r.fixed.sfMaxEnd)}`,
    `  duplicate-slot seconds ${r.dup.slotSeconds.toFixed(2)} (longest for one slot ${(r.dup.longestTicks * DT).toFixed(2)} s); max slot changes per drone ${r.maxPerDrone}`,
    `  slots empty at the end: ${r.emptyAtEnd.join(', ')}; slot changes in the last 10 s: ${r.lateChanges.length}; after the kill: collisions ${r.collisionsAfterKill}, near-misses ${r.nearMissesAfterKill}`,
    `  conditions: dup<=3s ${r.verdict.dupOk}, quiet last 10 s ${r.verdict.quietOk}, commits<=3xkills ${r.verdict.countOk}, commits lower ${r.verdict.lowerOk}, npwc>static ${r.verdict.npwcOk} => ${r.verdict.all ? 'PASS' : 'FAIL'}`,
  ];
}

export const KILL_HEADER = 'seed | centre | killed slots        | commits | pops | last commit s | npwc after | npwc end E | npwc end S |   delta | sfMax E | sfMax S | sfMean E | sfMean S | dup slot-s | longest dup s | max/drone | late chg | result';
export function killRow(r: ClumpedKill): string {
  const delta = (r.encore.npwcEnd ?? 0) - (r.fixed.npwcEnd ?? 0);
  return [
    String(r.seed).padStart(4), String(r.centre).padStart(6), r.killed.join(',').padEnd(19), String(r.commits.length).padStart(7),
    String(r.pops.length).padStart(4), (r.lastCommitSec === null ? '-' : r.lastCommitSec.toFixed(2)).padStart(13), f3(r.encore.npwcAfter).padStart(10),
    f3(r.encore.npwcEnd).padStart(10), f3(r.fixed.npwcEnd).padStart(10), ((delta >= 0 ? '+' : '') + delta.toFixed(4)).padStart(7),
    (r.encore.sfMaxEnd ?? 0).toFixed(2).padStart(7), (r.fixed.sfMaxEnd ?? 0).toFixed(2).padStart(7), (r.encore.sfMeanEnd ?? 0).toFixed(3).padStart(8), (r.fixed.sfMeanEnd ?? 0).toFixed(3).padStart(8),
    r.dup.slotSeconds.toFixed(2).padStart(10), (r.dup.longestTicks * DT).toFixed(2).padStart(13), String(r.maxPerDrone).padStart(9),
    String(r.lateChanges.length).padStart(8), r.verdict.all ? 'PASS' : 'FAIL',
  ].join(' | ');
}

// ---------- test 3: silence is not death ----------

export interface JamRun {
  seed: number; jamOn: number; jamOff: number; ticks: number; changes: SlotChange[];
  allCanHealBeforeJam: boolean;
  deliveredInJam: number; jammedInJam: number;      // receivers, over the broadcasts sent while the jam was on
  allDeafInJam: boolean;                            // every drone deaf from tDeaf (+ latency + one period) into the jam, to its end
  claims: number;                                   // heartbeats that carried a claim, whole run
  lossOutsideJam: number;
  allCanHealAtEnd: boolean; npwcEnd: number | null;
}

export function jamRun(seed: number): JamRun {
  const params = g1Params(40);
  const score = makeScore([TEXT], 40, params, LONG_HOLD);
  const holdStart = score.movements[0].startTick + score.movements[0].transitionTicks;
  // Section 8.6: jam from 5 s to 40 s. Counted from the start of the hold, and moved later (same 35 s
  // length) so that it starts only after every drone can heal: otherwise the test would prove nothing.
  const jamOn = Math.max(holdStart + sec(5), healReadyTick(holdStart, 0, params));
  const jamOff = jamOn + sec(35);
  const ticks = jamOff + sec(15);                   // 15 s after the radio returns: stale peer tables must not cause a claim
  const events: EnvEvent[] = [
    { type: 'JAM_ON', tick: jamOn, id: 'g1', centre: [0, 30, 0], radius: 1000 },      // every drone is inside
    { type: 'JAM_OFF', tick: jamOff, id: 'g1' },
  ];
  const snaps = runWorld({ seed, params, score, brain: encoreBrain, events }, ticks);
  const inJam = snaps.filter(s => s.tick >= jamOn && s.tick < jamOff);
  const deafFrom = jamOn + params.tDeaf + params.latencyMax + params.hbPeriod + 1;
  let deliveredInJam = 0;
  let jammedInJam = 0;
  for (const s of inJam) for (const r of s.radio) { deliveredInJam += r.delivered.length; jammedInJam += r.jammed; }
  return {
    seed, jamOn, jamOff, ticks, changes: slotChangesOf(snaps),
    allCanHealBeforeJam: snaps[jamOn - 2].drones.every(d => d.belief.canHeal),
    deliveredInJam, jammedInJam,
    allDeafInJam: inJam.filter(s => s.tick >= deafFrom).every(s => s.jams.length === 1 && s.drones.every(d => d.belief.deaf && !d.belief.canHeal)),
    claims: snaps.reduce((sum, s) => sum + s.radio.filter(r => r.claimSlot !== null).length, 0),
    lossOutsideJam: lossRate(snaps, 1, jamOn),
    allCanHealAtEnd: snaps[ticks - 1].drones.every(d => d.belief.canHeal),
    npwcEnd: coverageOf(snaps[ticks - 1], score, params).npwc,
  };
}

export function expectJamRun(r: JamRun): void {
  expect(r.allCanHealBeforeJam, 'every drone could heal when the jam began').toBe(true);
  expect(r.deliveredInJam, 'messages delivered while the jam was on').toBe(0);
  expect(r.jammedInJam, 'receivers blocked by the jam').toBeGreaterThan(0);
  expect(r.allDeafInJam, 'every drone became deaf inside the jam').toBe(true);
  expect(r.allCanHealAtEnd, 'every drone could heal again after the jam').toBe(true);
  expect(r.lossOutsideJam, 'measured packet loss before the jam').toBeGreaterThan(0.18);
  expect(r.lossOutsideJam, 'measured packet loss before the jam').toBeLessThan(0.22);
  expect(r.changes, 'slot changes in a run without failures').toEqual([]);                   // section 8.6, test 3
}

export function describeJamRuns(label: string, runs: JamRun[]): string {
  return `G1 jam, ${label}: jam ticks ${runs[0].jamOn}..${runs[0].jamOff} of ${runs[0].ticks}; slot changes ${runs.map(r => r.changes.length).join(', ')}; `
    + `claims announced ${runs.map(r => r.claims).join(', ')}; delivered in jam ${runs.map(r => r.deliveredInJam).join(', ')}, blocked ${runs.map(r => r.jammedInJam).join(', ')}; `
    + `npwc end ${runs.map(r => f3(r.npwcEnd)).join(', ')}`;
}
