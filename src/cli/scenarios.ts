// src/cli/scenarios.ts
// The evaluation scenarios S0-S5 (docs/validation/evaluation-and-tests.md §3) as a pure builder.
// The world may not import src/score; the CLI may, so the preloaded score and the injected score are built here.
// Kills resolve to EXPLICIT ids from formation-A slot positions with launch slot = id, never from live
// positions, so both arms receive a deep-equal `events` array (§4). No clock, no Math.random: every draw comes
// from a stream seeded by (seed, scenario).
import { OPERATOR } from '../contracts';
import type { EnvEvent, Params, Recipe, Score, Vec3 } from '../contracts';
import { composeNext, expandRecipe, launchPos, transitionTicksBetween } from '../score';
import { agentSeed, randomIds } from '../sim';

export const SCENARIO_IDS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_TICKS = 1800;
export const RECIPE_A: Recipe = { kind: 'text', text: 'ENCORE' };
export const RECIPE_B: Recipe = { kind: 'sphere' };
export const RECIPE_INJECT: Recipe = { kind: 'text', text: 'BRAVO' };
/**
 * Movement A starts before launch so that its hold plus holdGrace begins by A_HOLD_READY_BY. It was -200 until #80;
 * paced targets need a launch flight window, and -40 leaves A's hold + holdGrace = 363 <= 380 at n0 = 200.
 */
export const A_START_TICK = -40;
export const B_START_TICK = 900;
/** Latest tick by which A's hold plus holdGrace must have begun (kills and partitions start at 300-400). */
export const A_HOLD_READY_BY = 380;
/** Latest tick by which B's hold must begin, so `end` (1700-1799) is a hold window. */
export const B_HOLD_BY = 1300;

/** Plane P (§3): through [0, 30, 0] with normal [1, 0, 0]. */
export const PLANE_P = { point: [0, 30, 0] as Vec3, normal: [1, 0, 0] as Vec3 };
export const PARTITION_ID = 'P';
export const JAM_ID = 'J';
export const JAM_CENTRE: Vec3 = [0, 30, 0];
export const JAM_RADIUS = 12;
/** S4: the kill centre is drawn from formation-A slots within this distance of plane P. */
export const S4_PLANE_BAND = 5;
/** S5: the injection target is the lowest id whose formation-A slot has x below this. */
export const S5_X_MAX = -10;

export interface Scenario {
  id: ScenarioId;
  seed: number;
  score: Score;          // the preloaded EVAL score
  events: EnvEvent[];    // plain JSON, sorted by tick; identical for both arms
  ticks: number;
}

export function isScenarioId(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

/** Kills stay 10% of n0 whatever n0 is (§5 budget cuts): 20 at n0 = 200. */
export function killCount(n0: number): number {
  return Math.round(n0 / 10);
}

/**
 * The preloaded score EVAL, version {0, OPERATOR}: movement A (text ENCORE) starts at tick A_START_TICK (-40) with its
 * transition measured from the launch grid; movement B (sphere) starts at tick 900 with its transition
 * measured from A. Both by the contract's authoring formula (transitionTicksBetween). Throws if A's hold
 * (plus holdGrace) would start after tick 380 or B's hold after tick 1300.
 */
export function buildEvalScore(params: Params): Score {
  const n0 = params.n0;
  const launch: Vec3[] = [];
  for (let id = 0; id < n0; id++) launch.push(launchPos(id, n0));
  const slotsA = formationA(params);
  const slotsB = expandRecipe(RECIPE_B, n0, params).slots.map((s) => s.pos);
  const tA = transitionTicksBetween(launch, slotsA, params);
  const tB = transitionTicksBetween(slotsA, slotsB, params);
  const holdA = A_START_TICK + tA;
  const holdB = B_START_TICK + tB;
  if (holdA + params.holdGrace > A_HOLD_READY_BY) {
    throw new Error(
      `EVAL score at n0=${n0}: movement A's holdStart (${holdA}) + holdGrace (${params.holdGrace}) = ${holdA + params.holdGrace} ` +
      `> ${A_HOLD_READY_BY}. Per evaluation doc §3, make A_START_TICK (${A_START_TICK}) more negative before the freeze; do not move the event ticks.`,
    );
  }
  if (holdB > B_HOLD_BY) {
    throw new Error(`EVAL score at n0=${n0}: movement B's holdStart (${holdB}) > ${B_HOLD_BY}, so the 'end' window would not be a hold.`);
  }
  return {
    version: { issuedTick: 0, origin: OPERATOR },
    movements: [
      { startTick: A_START_TICK, transitionTicks: tA, recipe: { ...RECIPE_A } },
      { startTick: B_START_TICK, transitionTicks: tB, recipe: { ...RECIPE_B } },
    ],
  };
}

/** Formation-A slot positions by index. Launch slot = id, so index i is drone i's slot. */
function formationA(params: Params): Vec3[] {
  return expandRecipe(RECIPE_A, params.n0, params).slots.map((s) => [s.pos[0], s.pos[1], s.pos[2]] as Vec3);
}

/** A seeded stream for this (seed, scenario), separate from the world's and the brains' streams. */
function streamSeed(seed: number, id: ScenarioId): number {
  // The world uses hashSeed(seed, -1) and brains hashSeed(seed, id >= 0); these salts are far from both.
  return agentSeed(seed, 0x5c0000 + SCENARIO_IDS.indexOf(id));
}

function allIds(n0: number): number[] {
  return Array.from({ length: n0 }, (_, i) => i);
}

function dist2(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** The `count` ids whose formation-A slots are nearest slot `c` (c itself included, distance 0); ties by lower id. Ascending. */
export function nearestSlotIds(slots: readonly Vec3[], c: number, count: number): number[] {
  const centre = slots[c];
  if (centre === undefined) throw new RangeError(`Slot ${c} does not exist`);
  return slots
    .map((pos, id) => ({ id, d2: dist2(pos, centre) }))
    .sort((a, b) => a.d2 - b.d2 || a.id - b.id)
    .slice(0, count)
    .map((e) => e.id)
    .sort((a, b) => a - b);
}

/** Distance from a point to plane P. */
function distanceToPlane(pos: Vec3): number {
  const { point, normal } = PLANE_P;
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  return Math.abs((pos[0] - point[0]) * normal[0] + (pos[1] - point[1]) * normal[1] + (pos[2] - point[2]) * normal[2]) / len;
}

function pickOne(seed: number, candidates: number[], what: string): number {
  const [c] = randomIds(seed, candidates, 1);
  if (c === undefined) throw new Error(`Scenario builder: no candidate for ${what}`);
  return c;
}

function partitionOn(tick: number): EnvEvent {
  return { type: 'PARTITION_ON', tick, id: PARTITION_ID, point: [...PLANE_P.point], normal: [...PLANE_P.normal] };
}

/**
 * Pure: the same (id, seed, params) gives deep-equal output. Returns the preloaded score, the scripted events
 * (plain JSON, sorted by tick) and the run length in ticks.
 */
export function buildScenario(id: ScenarioId, seed: number, params: Params): Scenario {
  if (!isScenarioId(id)) throw new Error(`Unknown scenario '${String(id)}'; expected one of ${SCENARIO_IDS.join(', ')}`);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError(`Seed must be an unsigned 32-bit integer, got ${seed}`);
  const n0 = params.n0;
  if (!Number.isInteger(n0) || n0 < 1) throw new RangeError(`params.n0 must be a positive integer, got ${n0}`);

  const score = buildEvalScore(params);
  const slotsA = formationA(params);
  const kills = killCount(n0);
  const rs = streamSeed(seed, id);
  let events: EnvEvent[];

  switch (id) {
    case 'S0':
      events = [];
      break;
    case 'S1':
      events = [{ type: 'KILL', tick: 400, ids: randomIds(rs, allIds(n0), kills) }];
      break;
    case 'S2': {
      const c = pickOne(rs, allIds(n0), 'S2 kill centre');
      events = [{ type: 'KILL', tick: 400, ids: nearestSlotIds(slotsA, c, kills) }];
      break;
    }
    case 'S3':
      events = [
        partitionOn(400),
        { type: 'PARTITION_OFF', tick: 1000, id: PARTITION_ID },
        { type: 'JAM_ON', tick: 1300, id: JAM_ID, centre: [...JAM_CENTRE], radius: JAM_RADIUS },
        { type: 'JAM_OFF', tick: 1600, id: JAM_ID },
      ];
      break;
    case 'S4': {
      const band = allIds(n0).filter((i) => distanceToPlane(slotsA[i] as Vec3) <= S4_PLANE_BAND);
      const c = pickOne(rs, band, `S4 kill centre (no formation-A slot within ${S4_PLANE_BAND} m of plane P)`);
      events = [
        partitionOn(300),
        { type: 'KILL', tick: 400, ids: nearestSlotIds(slotsA, c, kills) },
        { type: 'PARTITION_OFF', tick: 700, id: PARTITION_ID },
      ];
      break;
    }
    case 'S5': {
      const d = allIds(n0).find((i) => (slotsA[i] as Vec3)[0] < S5_X_MAX);
      if (d === undefined) throw new Error(`S5 at n0=${n0}: no formation-A slot has x < ${S5_X_MAX}, so there is no injection target`);
      events = [
        partitionOn(300),
        { type: 'INJECT_SCORE', tick: 400, droneId: d, score: composeNext(score, 400, RECIPE_INJECT, d, n0, params) },
        { type: 'PARTITION_OFF', tick: 700, id: PARTITION_ID },
      ];
      break;
    }
  }
  // Round-trip through JSON so the array is plain data with no shared or frozen objects.
  return { id, seed, score: JSON.parse(JSON.stringify(score)) as Score, events: JSON.parse(JSON.stringify(events)) as EnvEvent[], ticks: SCENARIO_TICKS };
}
