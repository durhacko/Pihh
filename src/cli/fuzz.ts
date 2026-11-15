// src/cli/fuzz.ts — the fault-schedule fuzzer, campaign FZ1 (P2-WP-02; PHASE2_EVALUATION §6.2). Deterministic
// simulation testing with swarm testing and delta debugging: established practice, not new work.
//
//   npx tsx src/cli/fuzz.ts --campaign FZ1 --seed <u32> --runs <N> --out <dir> [--n0 40] [--ticks 1200] [--compare]
//   npx tsx src/cli/fuzz.ts --calibrate --seed <u32> --runs <N> [--out <dir>]        (P2-T05's calibration profile)
//   npx tsx src/cli/fuzz.ts --replay <file>
//
// Each run: a seeded schedule of faults (from score geometry only: no decision reads live state, so the same events
// would be fair to static), one Encore run through runCustom with the invariant checkers, and on a violation a ddmin
// shrink over atomic units and a p2-repro/1 file. There is no default --out and nothing is written outside it.
// Results are "checked properties on these runs, not proofs"; a find tagged with a known limit is not a counterexample.
import { execFileSync } from 'node:child_process';
import { makeParams } from '../contracts';
import type { EnvEvent, Params, Recipe, Score, Vec3 } from '../contracts';
import { composeNext, currentMovement, expandRecipe, makeScore } from '../score';
import { agentSeed, randomIds } from '../sim';
import { createRandom } from '../sim/random';
import { INVARIANT_DEFAULTS, INVARIANT_IDS, type InvariantId, type InvariantReport, type InvariantThresholds, type Violation } from '../observer/invariants';
import type { Arm } from './brains';
import { ddmin } from './ddmin';
import { runCustom, type ExploratoryRecord } from './harness';
import { canonicalJson } from '../score/canonical';
import { readRepro, REPRO_VERSION, writeRepro, type Repro } from './repro';
import { paramsHash } from './run';
import { nearestSlotIds, PLANE_P } from './scenarios';

// ------------------------------------------------------------------------------------------------ configuration

export const FZ1 = 'FZ1';
export const FZ1_N0 = 40;
export const FZ1_TICKS = 1200;
export const FZ1_LOSS = 0.2;               // G1's (tests/g1/helpers.ts LOSS)
/** RESTATED from tests/g1/helpers.ts (src/ never imports tests/); fuzz.test.ts pins it. A hold longer than any run. */
export const LONG_HOLD = 100000;
export const FZ1_RECIPE: Recipe = { kind: 'text', text: 'ENCORE' };
export const SHRINK_BUDGET = 300;          // §6.2: re-runs per shrink
export const RUN_BUDGET = 400;             // §6.2: an estimate, the cap for a campaign and for calibration
export const MAX_KILLED = 10;              // §6.2: at most 10 ids per run
const GENERATOR_SALT = 0x0f2100;           // the generator's own stream, apart from the world's and the brains'
const CALIBRATION_SALT = 0x0f2200;

/**
 * RESTATED from tests/g1/helpers.ts healReadyTick (fuzz.test.ts pins it): the first tick at which every drone may
 * heal after a hold starts.
 */
export function healReadyTick(holdStart: number, targetSince: number, p: Params): number {
  return Math.max(holdStart + p.holdGrace, targetSince + p.tStable) + p.tSettle + p.hbPeriod;
}

export interface Fz1Setup {
  campaign: string;
  n0: number;
  ticks: number;
  params: Params;
  score: Score;
  holdStart: number;
  /** Events are drawn in [tReady, ticks - tTail]. */
  tReady: number;
  tTail: number;
  thresholds: InvariantThresholds;
}

/** §6.2's configuration: n0 40, 1200 ticks, makeParams(n0, { loss: 0.2 }), the G1 score (killSetUp's shape). */
export function fz1Setup(n0 = FZ1_N0, ticks = FZ1_TICKS): Fz1Setup {
  const params = makeParams(n0, { loss: FZ1_LOSS });
  const score = makeScore([FZ1_RECIPE], n0, params, LONG_HOLD);
  const first = score.movements[0] as Score['movements'][number];
  const holdStart = first.startTick + first.transitionTicks;
  const thresholds = { ...INVARIANT_DEFAULTS };
  const tReady = healReadyTick(holdStart, 0, params);
  const tTail = thresholds.Q + 100;
  if (ticks - tTail < tReady) throw new RangeError(`ticks ${ticks} leave no event window: need at least tReady ${tReady} + tTail ${tTail}`);
  return { campaign: FZ1, n0, ticks, params, score, holdStart, tReady, tTail, thresholds };
}

// ---------------------------------------------------------------------------------------- generator (swarm testing)

export const KINDS = ['randomKill', 'clumpedKill', 'jam', 'partition', 'loss', 'injection'] as const;
export type Kind = (typeof KINDS)[number];

const RADII = [3, 6, 12];
const NORMALS: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [Math.SQRT1_2, 0, Math.SQRT1_2]];
const LOSSES = [0, 0.05, 0.2, 0.4];
const INJECT_RECIPES: Recipe[] = [{ kind: 'sphere' }, { kind: 'helix' }, { kind: 'text', text: 'DUR' }];

/** The order events are listed in at one tick: kills first, then windows, loss and injections. */
const TYPE_ORDER: Record<EnvEvent['type'], number> = { KILL: 0, JAM_ON: 1, JAM_OFF: 2, PARTITION_ON: 3, PARTITION_OFF: 4, SET_LOSS: 5, INJECT_SCORE: 6 };

/** Sorts events by tick, then type order; stable for equal keys. Returns a new array. */
export function sortEvents(events: readonly EnvEvent[]): EnvEvent[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || TYPE_ORDER[a.e.type] - TYPE_ORDER[b.e.type] || a.i - b.i).map(x => x.e);
}

/** The slot positions of the movement current at `tick` in the newest score the schedule issued at or before it. */
function slotsAt(scores: { tick: number; score: Score }[], tick: number, setup: Fz1Setup): Vec3[] {
  let score = setup.score;
  for (const s of scores) if (s.tick <= tick) score = s.score;
  return expandRecipe(currentMovement(score, tick).movement.recipe, setup.n0, setup.params).slots.map(s => [s.pos[0], s.pos[1], s.pos[2]] as Vec3);
}

/**
 * One FZ1 schedule (§6.2 "Generator"), from (campaignSeed, run) alone. Each kind is included with probability 1/2
 * (redrawn if none), with 1–3 events each, at ticks uniform in [tReady, ticks - tTail]. Events are resolved in tick
 * order from the score geometry and the schedule itself, never from live state. Every injection has a version no
 * other score in the schedule has, and every jam and partition pair has its own id (P2-T03).
 */
export function generateSchedule(campaignSeed: number, run: number, setup: Fz1Setup): EnvEvent[] {
  const rng = createRandom(agentSeed(campaignSeed, GENERATOR_SALT + run));
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
  const lo = setup.tReady;
  const hi = setup.ticks - setup.tTail;
  let included: Kind[];
  do { included = KINDS.filter(() => rng() < 0.5); } while (included.length === 0);
  const plan: { kind: Kind; tick: number }[] = [];
  for (const kind of included) {
    const count = int(1, 3);
    for (let i = 0; i < count; i++) plan.push({ kind, tick: int(lo, hi) });
  }
  plan.sort((a, b) => a.tick - b.tick || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

  const n0 = setup.n0;
  const killed = new Set<number>();
  const scores: { tick: number; score: Score }[] = [];
  const injected = new Set<string>();
  let jams = 0;
  let partitions = 0;
  const events: EnvEvent[] = [];
  const alive = () => Array.from({ length: n0 }, (_, i) => i).filter(i => !killed.has(i));
  for (const { kind, tick } of plan) {
    switch (kind) {
      case 'randomKill': {
        const room = MAX_KILLED - killed.size;
        const size = Math.min(int(1, 5), room);
        const ids = room > 0 ? randomIds(Math.floor(rng() * 2 ** 32), alive(), size) : [];
        if (ids.length > 0) { ids.forEach(i => killed.add(i)); events.push({ type: 'KILL', tick, ids: [...ids].sort((a, b) => a - b) }); }
        break;
      }
      case 'clumpedKill': {
        const room = MAX_KILLED - killed.size;
        const centre = int(0, n0 - 1);
        const size = int(2, 6);
        const ids = nearestSlotIds(slotsAt(scores, tick, setup), centre, size).filter(i => !killed.has(i)).slice(0, Math.max(0, room));
        if (ids.length > 0) { ids.forEach(i => killed.add(i)); events.push({ type: 'KILL', tick, ids }); }
        break;
      }
      case 'jam': {
        const centre = pick(slotsAt(scores, tick, setup));
        const radius = pick(RADII);
        const off = Math.min(tick + int(40, 300), hi);
        const id = `fz-j${jams++}`;
        if (off > tick) events.push({ type: 'JAM_ON', tick, id, centre: [...centre] as Vec3, radius }, { type: 'JAM_OFF', tick: off, id });
        break;
      }
      case 'partition': {
        const normal = pick(NORMALS);
        const off = Math.min(tick + int(40, 300), hi);
        const id = `fz-p${partitions++}`;
        if (off > tick) events.push({ type: 'PARTITION_ON', tick, id, point: [...PLANE_P.point] as Vec3, normal: [...normal] as Vec3 }, { type: 'PARTITION_OFF', tick: off, id });
        break;
      }
      case 'loss':
        events.push({ type: 'SET_LOSS', tick, loss: pick(LOSSES) });
        break;
      case 'injection': {
        const candidates = alive();
        if (candidates.length === 0) break;
        const droneId = pick(candidates);
        const key = `${tick}:${droneId}`;
        if (injected.has(key)) break;   // (tick, id) unique, so every version is unique
        injected.add(key);
        const newest = scores.length > 0 ? (scores[scores.length - 1] as { score: Score }).score : setup.score;
        const score = composeNext(newest, tick, pick(INJECT_RECIPES), droneId, n0, setup.params);
        scores.push({ tick, score });
        events.push({ type: 'INJECT_SCORE', tick, droneId, score });
        break;
      }
    }
  }
  return sortEvents(events);
}

/** P2-T05's calibration profile: one clumped kill of size 5 at G1's kill tick (killSetUp timing), no other events. */
export function calibrationSchedule(setup: Fz1Setup, centre: number): EnvEvent[] {
  const killTick = healReadyTick(setup.holdStart, 0, setup.params);
  const slots = expandRecipe(currentMovement(setup.score, killTick).movement.recipe, setup.n0, setup.params).slots.map(s => [s.pos[0], s.pos[1], s.pos[2]] as Vec3);
  return [{ type: 'KILL', tick: killTick, ids: nearestSlotIds(slots, centre, 5) }];
}

// ------------------------------------------------------------------------------------------------ atomic units

export interface Unit { tick: number; order: number; id: string; events: EnvEvent[] }

/**
 * §6.2's atomic units, in (tick, kind, id) order: each id of a KILL, each JAM_ON/JAM_OFF pair, each
 * PARTITION_ON/PARTITION_OFF pair, each SET_LOSS and each INJECT_SCORE. An OFF with no ON stays a unit of its own.
 */
export function toUnits(events: readonly EnvEvent[]): Unit[] {
  const units: Unit[] = [];
  const used = new Set<number>();
  const list = sortEvents(events);
  list.forEach((e, i) => {
    if (used.has(i)) return;
    used.add(i);
    if (e.type === 'KILL') {
      for (const id of e.ids) units.push({ tick: e.tick, order: TYPE_ORDER.KILL, id: String(id).padStart(6, '0'), events: [{ type: 'KILL', tick: e.tick, ids: [id] }] });
      return;
    }
    if (e.type === 'JAM_ON' || e.type === 'PARTITION_ON') {
      const offType = e.type === 'JAM_ON' ? 'JAM_OFF' : 'PARTITION_OFF';
      const j = list.findIndex((o, k) => k > i && !used.has(k) && o.type === offType && o.id === e.id);
      const pair: EnvEvent[] = [e];
      if (j >= 0) { used.add(j); pair.push(list[j] as EnvEvent); }
      units.push({ tick: e.tick, order: TYPE_ORDER[e.type], id: e.id, events: pair });
      return;
    }
    const id = e.type === 'INJECT_SCORE' ? String(e.droneId).padStart(6, '0') : 'id' in e ? String(e.id) : '';
    units.push({ tick: e.tick, order: TYPE_ORDER[e.type], id, events: [e] });
  });
  return units.sort((a, b) => a.tick - b.tick || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The schedule a subset of units stands for: kills at one tick merged (ids ascending), then sorted. */
export function fromUnits(units: readonly Unit[]): EnvEvent[] {
  const kills = new Map<number, number[]>();
  const rest: EnvEvent[] = [];
  for (const u of units) {
    for (const e of u.events) {
      if (e.type === 'KILL') kills.set(e.tick, [...(kills.get(e.tick) ?? []), ...e.ids]);
      else rest.push(e);
    }
  }
  const merged: EnvEvent[] = [...kills].map(([tick, ids]) => ({ type: 'KILL', tick, ids: [...new Set(ids)].sort((a, b) => a - b) }));
  return sortEvents([...merged, ...rest]);
}

// ----------------------------------------------------------------------------------------------- run and shrink

export interface ScheduleRun { record: ExploratoryRecord; report: InvariantReport }

export function runSchedule(setup: Fz1Setup, seed: number, events: EnvEvent[], arm: Arm = 'encore'): ScheduleRun {
  const { record, report } = runCustom(
    { label: setup.campaign, seed, params: setup.params, score: setup.score, events, ticks: setup.ticks, arm },
    { invariants: { thresholds: setup.thresholds } },
  );
  if (report === null) throw new Error('fuzz: the invariant checker did not run');
  return { record, report };
}

const allViolations = (report: InvariantReport): Violation[] => [...report.counterexamples, ...report.knownLimitInstances];
const byTick = (a: Violation, b: Violation) => a.tick - b.tick || INVARIANT_IDS.indexOf(a.inv) - INVARIANT_IDS.indexOf(b.inv);

/** The violation a run is filed under: the earliest counterexample, else the earliest known-limit instance, else null. */
export function targetViolation(report: InvariantReport): Violation | null {
  const pool = report.counterexamples.length > 0 ? report.counterexamples : report.knownLimitInstances;
  return [...pool].sort(byTick)[0] ?? null;
}

/** The earliest violation of `inv` in a report (tagged or not), or null. */
export function firstOf(report: InvariantReport, inv: InvariantId): Violation | null {
  return allViolations(report).filter(v => v.inv === inv).sort(byTick)[0] ?? null;
}

export interface Shrunk { events: EnvEvent[]; fromUnits: number; toUnits: number; tests: number; oneMinimal: boolean }

/**
 * ddmin over the schedule's atomic units: test(subset) re-runs with the same seed, params and score and passes iff the
 * SAME INV fires (its first tick may move). Removing events shifts later radio draws, so the result is an exact run
 * of its own, not a slice of the original.
 */
export function shrinkSchedule(setup: Fz1Setup, seed: number, events: EnvEvent[], inv: InvariantId, budget = SHRINK_BUDGET): Shrunk {
  const units = toUnits(events);
  const result = ddmin(units, subset => firstOf(runSchedule(setup, seed, fromUnits(subset)).report, inv) !== null, budget);
  return { events: fromUnits(result.units), fromUnits: units.length, toUnits: result.units.length, tests: result.tests, oneMinimal: result.oneMinimal };
}

/** The value as the repro file stores it: canonicalJson, so object keys sorted at every level. */
const canonical = <T>(value: T): T => JSON.parse(canonicalJson(value)) as T;

/**
 * Builds the p2-repro/1 record of a shrunk schedule from its own run (its violation and stateHash). That run uses the
 * FILE FORM of params, score and events (keys sorted, as canonicalJson writes them): the world's stateHash depends on
 * object key order, so this is what makes a --replay from the file bit-identical, stateHash included.
 */
export function buildRepro(setup: Fz1Setup, meta: { git: string; campaignSeed: number; run: number; seed: number }, shrunk: Shrunk, inv: InvariantId): Repro {
  const params = canonical(setup.params);
  const score = canonical(setup.score);
  const events = canonical(shrunk.events);
  const final = runSchedule({ ...setup, params, score }, meta.seed, events);
  const v = firstOf(final.report, inv);
  if (v === null) throw new Error(`fuzz: the shrunk schedule no longer fires ${inv}`);
  return {
    v: REPRO_VERSION, git: meta.git, campaign: setup.campaign, campaignSeed: meta.campaignSeed, run: meta.run, arm: 'encore',
    seed: meta.seed, n0: setup.n0, ticks: setup.ticks, params, paramsHash: paramsHash(setup.params),
    score, events, thresholds: { ...setup.thresholds },
    violation: { inv: v.inv, firstTick: v.tick, ids: [...v.ids], ...(v.slot !== undefined ? { slot: v.slot } : {}), knownLimit: v.knownLimit, detail: v.detail },
    shrink: { fromUnits: shrunk.fromUnits, toUnits: shrunk.toUnits, tests: shrunk.tests, oneMinimal: shrunk.oneMinimal },
    stateHash: final.record.stateHash,
  };
}

/** --replay: re-runs a repro and reports whether the same INV fires at the same first tick. */
export function replay(repro: Repro): { same: boolean; inv: InvariantId; expectedTick: number; actualTick: number | null; stateHash: string } {
  const setup: Fz1Setup = {
    campaign: repro.campaign, n0: repro.n0, ticks: repro.ticks, params: repro.params, score: repro.score,
    holdStart: 0, tReady: 0, tTail: 0, thresholds: repro.thresholds,
  };
  const { record, report } = runSchedule(setup, repro.seed, repro.events, repro.arm);
  const v = firstOf(report, repro.violation.inv);
  return { same: v !== null && v.tick === repro.violation.firstTick, inv: repro.violation.inv, expectedTick: repro.violation.firstTick, actualTick: v?.tick ?? null, stateHash: record.stateHash };
}

// ------------------------------------------------------------------------------------------------- campaigns

export interface Find { run: number; seed: number; inv: InvariantId; knownLimit: string | null; firstTick: number; repro: Repro; path: string | null }

export interface CampaignOptions {
  campaignSeed: number;
  runs: number;
  out: string | null;
  setup?: Fz1Setup;
  compare?: boolean;
  shrinkBudget?: number;
  git?: string;
  log?: (line: string) => void;
}

export interface CampaignResult { runs: number; finds: Find[]; compareFlags: number[] }

/** Mean npwc over hold samples in the last 100 ticks (§6.2's comparative check; npwcEnd is null at 1200 ticks). */
export function lateHoldNpwc(record: ExploratoryRecord, setup: Fz1Setup): number | null {
  const from = setup.ticks - 100;
  const xs = record.series.filter(s => s.tick > from && s.tick >= setup.holdStart && s.npwc !== null).map(s => s.npwc as number);
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function partitionOverlapsInjection(events: readonly EnvEvent[]): boolean {
  const injections = events.filter(e => e.type === 'INJECT_SCORE').map(e => e.tick);
  const open = new Map<string, number>();
  const windows: [number, number][] = [];
  for (const e of sortEvents(events)) {
    if (e.type === 'PARTITION_ON') open.set(e.id, e.tick);
    if (e.type === 'PARTITION_OFF' && open.has(e.id)) { windows.push([open.get(e.id) as number, e.tick]); open.delete(e.id); }
  }
  for (const [, on] of open) windows.push([on, Infinity]);
  return injections.some(t => windows.some(([a, b]) => t >= a && t < b));
}

function fileFind(setup: Fz1Setup, opts: CampaignOptions, run: number, seed: number, events: EnvEvent[], v: Violation, finds: Find[]): void {
  const log = opts.log ?? (() => {});
  const shrunk = shrinkSchedule(setup, seed, events, v.inv, opts.shrinkBudget ?? SHRINK_BUDGET);
  const repro = buildRepro(setup, { git: opts.git ?? 'unknown', campaignSeed: opts.campaignSeed, run, seed }, shrunk, v.inv);
  const path = opts.out === null ? null : writeRepro(opts.out, repro);
  finds.push({ run, seed, inv: v.inv, knownLimit: repro.violation.knownLimit, firstTick: repro.violation.firstTick, repro, path });
  log(`run ${run}: ${v.inv}${repro.violation.knownLimit ? ` (known limit: ${repro.violation.knownLimit})` : ' (counterexample)'} at tick ${repro.violation.firstTick}; shrunk ${shrunk.fromUnits} -> ${shrunk.toUnits} units in ${shrunk.tests} re-runs${shrunk.oneMinimal ? '' : ' (budget exhausted: oneMinimal false)'}${path ? `; ${path}` : ''}`);
}

/** FZ1: R runs of the swarm generator; every violating run is shrunk and filed. */
export function runCampaign(opts: CampaignOptions): CampaignResult {
  const setup = opts.setup ?? fz1Setup();
  const log = opts.log ?? (() => {});
  const finds: Find[] = [];
  const compareFlags: number[] = [];
  for (let run = 0; run < opts.runs; run++) {
    const events = generateSchedule(opts.campaignSeed, run, setup);
    const seed = agentSeed(opts.campaignSeed, run);
    const started = Date.now();
    const encore = runSchedule(setup, seed, events);
    if (run === 0) log(`first run wall time: ${Date.now() - started} ms (n0 ${setup.n0}, ${setup.ticks} ticks)`);
    const v = targetViolation(encore.report);
    if (v !== null) fileFind(setup, opts, run, seed, events, v, finds);
    if (opts.compare) {
      const fixed = runSchedule(setup, seed, events, 'static');
      const e = lateHoldNpwc(encore.record, setup);
      const s = lateHoldNpwc(fixed.record, setup);
      const flagged = e !== null && s !== null && e < s - 0.02 && !partitionOverlapsInjection(events);
      if (flagged) compareFlags.push(run);
      log(`run ${run}: compare (exploratory, not an INV): Encore ${e?.toFixed(4) ?? 'null'} vs static ${s?.toFixed(4) ?? 'null'}${flagged ? ' FLAGGED' : ''}`);
    }
  }
  log(`${FZ1} seed ${opts.campaignSeed}: ${opts.runs} runs, ${finds.length} violating (${finds.filter(f => f.knownLimit === null).length} counterexamples, ${finds.filter(f => f.knownLimit !== null).length} known-limit instances). Checked properties on these runs, not proofs.`);
  return { runs: opts.runs, finds, compareFlags };
}

/**
 * P2-T05's calibration profile (§6.2): run r kills the 5 slots nearest a uniform centre at G1's kill tick, with no
 * other events, until the first INV-QUIET violation or `runs`. The find is shrunk and filed like any other.
 */
export function runCalibration(opts: CampaignOptions): { runsToDiscovery: number | null; find: Find | null } {
  const setup = opts.setup ?? fz1Setup();
  const log = opts.log ?? (() => {});
  for (let run = 0; run < opts.runs; run++) {
    const centre = Math.floor(createRandom(agentSeed(opts.campaignSeed, CALIBRATION_SALT + run))() * setup.n0);
    const seed = agentSeed(opts.campaignSeed, run);
    const events = calibrationSchedule(setup, centre);
    const v = firstOf(runSchedule(setup, seed, events).report, 'INV-QUIET');
    if (v !== null) {
      const finds: Find[] = [];
      fileFind({ ...setup, campaign: `${setup.campaign}-CAL` }, opts, run, seed, events, v, finds);
      log(`calibration: INV-QUIET found at run ${run} (centre ${centre}, seed ${seed})`);
      return { runsToDiscovery: run + 1, find: finds[0] ?? null };
    }
  }
  log(`calibration: FZ1 did not rediscover the known miss in ${opts.runs} runs`);
  return { runsToDiscovery: null, find: null };
}

// ------------------------------------------------------------------------------------------------------- CLI

/** A local copy of src/cli/main.ts's private gitDescribe (main.ts is not edited). */
function gitDescribe(): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim();
    return dirty === '' ? head : `${head}-dirty`;
  } catch {
    return 'unknown';
  }
}

export interface FuzzArgs {
  mode: 'campaign' | 'calibrate' | 'replay';
  campaign: string; seed: number; runs: number; out: string | null; n0: number; ticks: number; compare: boolean; replay: string | null;
}

export const USAGE = 'Usage: npx tsx src/cli/fuzz.ts --campaign FZ1 --seed <u32> --runs <N> --out <dir> [--n0 40] [--ticks 1200] [--compare]\n'
  + '       npx tsx src/cli/fuzz.ts --calibrate --seed <u32> --runs <N> [--out <dir>]\n'
  + '       npx tsx src/cli/fuzz.ts --replay <file>';

export function parseFuzzArgs(argv: readonly string[]): FuzzArgs {
  const a: FuzzArgs = { mode: 'campaign', campaign: '', seed: -1, runs: -1, out: null, n0: FZ1_N0, ticks: FZ1_TICKS, compare: false, replay: null };
  const int = (flag: string, v: string | undefined, min: number, max: number) => {
    const n = Number(v);
    if (v === undefined || !Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${flag} needs an integer in [${min}, ${max}], got ${String(v)}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    const next = argv[i + 1];
    switch (flag) {
      case '--campaign': if (next !== FZ1) throw new RangeError(`--campaign: only ${FZ1} exists`); a.campaign = next; i++; break;
      case '--seed': a.seed = int(flag, next, 0, 0xffffffff); i++; break;
      case '--runs': a.runs = int(flag, next, 1, RUN_BUDGET); i++; break;
      case '--out': if (next === undefined) throw new RangeError('--out needs a directory'); a.out = next; i++; break;
      case '--n0': a.n0 = int(flag, next, 2, 400); i++; break;
      case '--ticks': a.ticks = int(flag, next, 1, 100000); i++; break;
      case '--compare': a.compare = true; break;
      case '--calibrate': a.mode = 'calibrate'; break;
      case '--replay': if (next === undefined) throw new RangeError('--replay needs a file'); a.mode = 'replay'; a.replay = next; i++; break;
      default: throw new RangeError(`Unknown argument '${flag}'.\n${USAGE}`);
    }
  }
  if (a.mode === 'replay') return a;
  if (a.seed < 0 || a.runs < 0) throw new RangeError(`--seed and --runs are required.\n${USAGE}`);
  if (a.mode === 'campaign' && (a.campaign !== FZ1 || a.out === null)) throw new RangeError(`--campaign FZ1 and --out are required (there is no default --out).\n${USAGE}`);
  return a;
}

export function main(argv: readonly string[], log: (line: string) => void = line => process.stdout.write(`${line}\n`)): number {
  if (argv.includes('--help') || argv.includes('-h')) { log(USAGE); return 0; }
  const args = parseFuzzArgs(argv);
  if (args.mode === 'replay') {
    const r = replay(readRepro(args.replay as string));
    log(`${r.same ? 'REPRODUCED' : 'NOT REPRODUCED'}: ${r.inv} expected at tick ${r.expectedTick}, got ${r.actualTick ?? 'none'} (stateHash ${r.stateHash})`);
    return r.same ? 0 : 1;
  }
  const setup = fz1Setup(args.n0, args.ticks);
  const opts: CampaignOptions = { campaignSeed: args.seed, runs: args.runs, out: args.out, setup, compare: args.compare, git: gitDescribe(), log };
  if (args.mode === 'calibrate') return runCalibration(opts).find ? 0 : 1;
  runCampaign(opts);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && /[\\/]src[\\/]cli[\\/]fuzz\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}
