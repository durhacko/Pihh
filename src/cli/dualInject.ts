// src/cli/dualInject.ts
// P2-WP-10 · X3: dual injection across a partition, and the churn bound (PHASE2_EVALUATION §6.1, P2-T14).
// Two different scores, one injected on each side of plane P while the partition is on; after PARTITION_OFF the
// swarm must converge on the later version by last-writer-wins on (issuedTick, origin) (contract §9; textbook LWW
// on a physical clock, not a Lamport clock and not new). Both scores share the EVAL base, so limit 9 is not
// exercised. Each group flies away to its own score and sees the other group's slots as empty and silent (limit 7
// on both sides), so churn is expected; it is measured and bounded, never hidden.
//
// Exploratory, read-only: runs through runCustom (P2-WP-01) and the observer; nothing writes an evaluation record.
// Usage (offline, only while matrix-quiet): npx tsx src/cli/dualInject.ts [--seeds 101-105] [--n0 200] [--arm encore]
import { pathToFileURL } from 'node:url';
import { DT, makeParams } from '../contracts';
import type { EnvEvent, Params, Score, ScoreVersion, Vec3, WorldSnapshot } from '../contracts';
import { composeNext, expandRecipe, newerVersion } from '../score';
import { versionKey } from '../observer/measure';
import type { InvariantReport } from '../observer/invariants';
import type { Arm } from './brains';
import { runCustom } from './harness';
import { buildEvalScore, PARTITION_ID, PLANE_P, RECIPE_A, SCENARIO_TICKS } from './scenarios';

export const X3_TICKS = Object.freeze({ PARTITION_ON: 300, INJECT_A: 400, INJECT_B: 420, PARTITION_OFF: 700 });
export const X3_RECIPES = Object.freeze({ A: { kind: 'text', text: 'BRAVO' } as const, B: { kind: 'text', text: 'DELTA' } as const });
/** §6.1: the injection targets are the lowest ids whose formation-A slot has x < -10, and x > +10. */
export const X3_X_SPLIT = 10;
/** §3.4: an oscillation is a return to a slot left within the last W ticks. */
export const OSCILLATION_WINDOW = 200;

/**
 * The numeric `slotChanges` cap of the X3 churn bound (§6.1, P2-T14). It is NOT chosen here: it is fixed from the
 * dev seeds 101-105 and written into PHASE2_EVALUATION §6.1 by a docs PR before the eval seeds 1-5 run. Until then
 * it is null and only the structural part of the bound is asserted.
 */
export const X3_SLOT_CHANGES_CAP: number | null = null;

export interface X3Scenario { label: string; seed: number; params: Params; score: Score; events: EnvEvent[]; ticks: number;
  targets: { a: number; b: number }; versions: { a: ScoreVersion; b: ScoreVersion; winner: ScoreVersion } }

/** X3 exactly as §6.1 defines it. Pure: the same (seed, params) gives a deep-equal scenario. */
export function buildX3(seed: number, params: Params): X3Scenario {
  const n0 = params.n0;
  const score = buildEvalScore(params);
  const slotsA: Vec3[] = expandRecipe(RECIPE_A, n0, params).slots.map((s) => s.pos);
  const ids = Array.from({ length: n0 }, (_, i) => i);
  const a = ids.find((i) => (slotsA[i] as Vec3)[0] < -X3_X_SPLIT);
  const b = ids.find((i) => (slotsA[i] as Vec3)[0] > X3_X_SPLIT);
  if (a === undefined || b === undefined) throw new Error(`X3 at n0=${n0}: no formation-A slot with x < -${X3_X_SPLIT} or x > +${X3_X_SPLIT}`);
  const scoreA = composeNext(score, X3_TICKS.INJECT_A, X3_RECIPES.A, a, n0, params);
  const scoreB = composeNext(score, X3_TICKS.INJECT_B, X3_RECIPES.B, b, n0, params);   // both on the EVAL base
  const events: EnvEvent[] = [
    { type: 'PARTITION_ON', tick: X3_TICKS.PARTITION_ON, id: PARTITION_ID, point: [...PLANE_P.point], normal: [...PLANE_P.normal] },
    { type: 'INJECT_SCORE', tick: X3_TICKS.INJECT_A, droneId: a, score: scoreA },
    { type: 'INJECT_SCORE', tick: X3_TICKS.INJECT_B, droneId: b, score: scoreB },
    { type: 'PARTITION_OFF', tick: X3_TICKS.PARTITION_OFF, id: PARTITION_ID },
  ];
  const winner = newerVersion(scoreB.version, scoreA.version) ? scoreB.version : scoreA.version;
  return {
    label: `X3-s${seed}`, seed, params,
    score: JSON.parse(JSON.stringify(score)) as Score, events: JSON.parse(JSON.stringify(events)) as EnvEvent[], ticks: SCENARIO_TICKS,
    targets: { a, b }, versions: { a: scoreA.version, b: scoreB.version, winner },
  };
}

export interface X3Result {
  label: string; arm: Arm; seed: number; n0: number; stateHash: string;
  /** Observer summary keys (§6.1), as runCustom's record carries them. */
  tVersion: number | null; splitSec: number | null; slotChanges: number | null; collisions: number | null; nearMisses: number | null;
  /** §3.5: PARTITION_OFF to the last losing-side drone adopting the winner, s; null if one never adopts. */
  tLoserSwitch: number | null;
  /** §3.4: dupSlots summed over every tick (holds and transitions), slot·s. Ignores versions: read with care. */
  dupOwnSec: number;
  /** §3.4: returns into a slot left within W ticks, and the distinct drones that did it. */
  oscillations: number; oscillationDrones: number;
  /** Live drones at the end, and how many end on the winning version. */
  liveEnd: number; liveEndOnWinner: number; winner: string;
  /** Churn, structural part of the bound: pops after PARTITION_OFF and commits during the partition. */
  popsAfterHeal: number; commitsDuringPartition: number; structuralOk: boolean;
  /** Per drone: the first tick from which it stays on the winning version (null if it never does). */
  switchTick: (number | null)[];
  /** Which side of plane P each drone was on at PARTITION_ON (0 = the BRAVO side, x < 0). */
  side: (0 | 1 | null)[];
  invariants: InvariantReport | null;
}

/** Runs X3 on one seed and arm through runCustom, recording the §6.1 keys from snapshots. */
export function runX3(seed: number, n0: number, arm: Arm): X3Result {
  const params = makeParams(n0);
  const x3 = buildX3(seed, params);
  const winner = versionKey(x3.versions.winner);
  const prevSlot = new Int32Array(n0).map((_, i) => i);
  const lastLeft = Array.from({ length: n0 }, () => new Map<number, number>());   // slot -> tick it was left
  const switchTick: (number | null)[] = new Array(n0).fill(null);
  const side: (0 | 1 | null)[] = new Array(n0).fill(null);
  let oscillations = 0, popsAfterHeal = 0, commitsDuringPartition = 0, dupSlotTicks = 0;
  const oscillating = new Set<number>();
  let last: WorldSnapshot | null = null;

  const { record, report } = runCustom(
    { label: x3.label, seed, params, score: x3.score, events: x3.events, ticks: x3.ticks, arm },
    {
      onSnapshot(s) {
        last = s;
        if (s.tick === X3_TICKS.PARTITION_ON) for (const d of s.drones) side[d.id] = d.partitionSide;
        const holders = new Map<number, number>();
        for (const d of s.drones) {
          if (!d.alive) continue;
          holders.set(d.belief.slot, (holders.get(d.belief.slot) ?? 0) + 1);
          if (versionKey(d.belief.version) === winner) { if (switchTick[d.id] === null) switchTick[d.id] = s.tick; }
          else switchTick[d.id] = null;   // "stays on": a later loss of the winner resets it
          const from = prevSlot[d.id] as number, to = d.belief.slot;
          if (to === from) continue;
          if (to < from && s.tick >= X3_TICKS.PARTITION_ON && s.tick < X3_TICKS.PARTITION_OFF) commitsDuringPartition++;
          if (to > from && s.tick >= X3_TICKS.PARTITION_OFF) popsAfterHeal++;
          const left = lastLeft[d.id] as Map<number, number>;
          const at = left.get(to);
          if (at !== undefined && at >= s.tick - OSCILLATION_WINDOW) { oscillations++; oscillating.add(d.id); }
          left.set(from, s.tick);
          prevSlot[d.id] = to;
        }
        for (const count of holders.values()) if (count >= 2) dupSlotTicks++;
      },
    },
  );
  const end = last as WorldSnapshot | null;
  const liveAtEnd = end ? end.drones.filter((d) => d.alive) : [];
  // Losing side: the group whose injected score lost (the side of the earlier injection's target).
  const loserVersion = versionKey(newerVersion(x3.versions.a, x3.versions.b) ? x3.versions.b : x3.versions.a);
  const loserTarget = loserVersion === versionKey(x3.versions.a) ? x3.targets.a : x3.targets.b;
  const loserSide = side[loserTarget];
  let lastLoserSwitch = -Infinity, loserMissing = false;
  for (const d of liveAtEnd) {
    if (side[d.id] !== loserSide) continue;
    const t = switchTick[d.id];
    if (t === null || t === undefined) loserMissing = true; else lastLoserSwitch = Math.max(lastLoserSwitch, t);
  }
  const s = record.summary;
  return {
    label: x3.label, arm, seed, n0, stateHash: record.stateHash,
    tVersion: s.tVersion ?? null, splitSec: s.splitSec ?? null, slotChanges: s.slotChanges ?? null,
    collisions: s.collisions ?? null, nearMisses: s.nearMisses ?? null,
    tLoserSwitch: loserMissing || lastLoserSwitch === -Infinity ? null : Math.max(0, lastLoserSwitch - X3_TICKS.PARTITION_OFF) * DT,
    dupOwnSec: dupSlotTicks * DT,
    oscillations, oscillationDrones: oscillating.size,
    liveEnd: liveAtEnd.length, liveEndOnWinner: liveAtEnd.filter((d) => versionKey(d.belief.version) === winner).length, winner,
    popsAfterHeal, commitsDuringPartition, structuralOk: popsAfterHeal <= commitsDuringPartition,
    switchTick, side, invariants: report,
  };
}

/** One table row, honest labels: exploratory X3, checked properties on this run, not proofs. */
export function formatX3Row(r: X3Result): string {
  const conv = r.invariants?.counts['INV-CONVERGE'] ?? null;
  return [`${r.label} ${r.arm} n0=${r.n0}`, `winner ${r.winner}`, `end ${r.liveEndOnWinner}/${r.liveEnd}`,
    `tVersion ${r.tVersion}`, `tLoserSwitch ${r.tLoserSwitch}`, `splitSec ${r.splitSec}`, `slotChanges ${r.slotChanges}`,
    `dupOwnSec ${r.dupOwnSec.toFixed(2)}`, `oscillations ${r.oscillations} (${r.oscillationDrones} drones)`,
    `pops after heal ${r.popsAfterHeal} <= commits in partition ${r.commitsDuringPartition}: ${r.structuralOk}`,
    `collisions ${r.collisions}`, `INV-CONVERGE ${conv === null ? 'n/a' : conv === 0 ? 'holds' : `${conv} violation(s)`}`].join(' | ');
}

function parseSeeds(spec: string): number[] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec);
  if (!m) throw new Error('--seeds takes N or A-B');
  const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
  if (b < a || b - a > 99) throw new Error('--seeds range must be ascending and at most 100 seeds');
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** CLI entry: prints one row per seed and arm. Exploratory output, never an evaluation record. */
export function main(argv: readonly string[]): void {
  const get = (flag: string, fallback: string) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] as string : fallback; };
  const seeds = parseSeeds(get('--seeds', '101-105'));
  const n0 = Number(get('--n0', '200'));
  const arms = get('--arm', 'encore,static').split(',') as Arm[];
  console.log('X3 (P2-WP-10), EXPLORATORY: checked properties on these runs, not proofs. X3 is S5-shaped: state its collision cost.');
  for (const seed of seeds) for (const arm of arms) console.log(formatX3Row(runX3(seed, n0, arm)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
