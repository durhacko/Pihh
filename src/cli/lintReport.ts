// Score lint report CLI (P2-WP-04): `npx tsx src/cli/lintReport.ts --n0 200 [--calibrate] [--score file.json] [--out report.md]`.
// Lints the EVAL score (or a score from a JSON file) with checks L1-L5 of src/cli/lint.ts and prints a Markdown report.
// Invalid structure is REJECTED (exit code 2, no findings); risk is WARNED (findings, exit code 0). Nothing here is a
// pass line or a collision guarantee.
// `--calibrate` (EVAL only) runs S0 static once with runOne and sets L1's predictions against the collisions measured
// in each transition window (P2-T08). It is a calibration table, never a forecast.
// File output lives here, never in lint.ts. No network.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeParams } from '../contracts';
import type { MetricsSample, Observer, Params, RunRecord, Score, Vec3, WorldSnapshot } from '../contracts';
import { BRAINS } from './brains';
import { closestApproach, L1_LABEL, LintInputError, lintScore, PACE_SETTLE_TICKS, scoreTransitions } from './lint';
import type { LintFinding, MovementLint, ScoreTransition } from './lint';
import { getObserverFactory, type ObserverFactory } from './observer';
import { paramsHash, runOne } from './run';
import { buildEvalScore } from './scenarios';

export const CALIBRATION_SCENARIO = 'S0';
export const CALIBRATION_ARM = 'static';
export const CALIBRATION_SEED = 1;

// ---------------------------------------------------------------------------------------------------------------
// Calibration (P2-T08)
// ---------------------------------------------------------------------------------------------------------------

export interface PairEvent { tick: number; i: number; j: number }

export interface CalibrationWindow {
  movement: number;
  fromTick: number;          // inclusive: the transition's begin
  toTick: number;            // exclusive: its holdStart (paced flight plus the PACE_SETTLE_TICKS settle)
  predictedCollide: number;  // L1 pairs with dmin < dCollide
  predictedNear: number;     // L1 pairs with dmin < dNear
  seriesCollisions: number;  // from the cumulative series[].collisions, window rounded to the 5-tick sample grid
  collisionEvents: number;   // exact, from the snapshots
  collisionPairs: number;    // distinct pairs among those events
  tp: number;                // predicted (dmin < dCollide) and collided in the window
  fp: number;                // predicted, did not collide
  fn: number;                // collided, not predicted
  nearMissPairs: number;     // distinct pairs that entered d < dNear in the window
  nearTp: number;            // predicted dmin < dNear and measured near-miss
  nearFp: number;
  nearFn: number;
  /** Predicted dmin (m) of every pair that collided, ascending: how far below or above dCollide the forecast-free model put them. */
  collidedDmin: number[];
}

export interface Calibration {
  scenario: string; arm: string; seed: number; n0: number;
  git: string; paramsHash: string; stateHash: string;
  totalCollisions: number;           // the record's final cumulative count
  windows: CalibrationWindow[];
  outsideCollisions: number;         // events in no transition window (holds)
}

const pairKey = (i: number, j: number): string => (i < j ? `${i}-${j}` : `${j}-${i}`);

/** Cumulative series value at the last sample with tick <= t (0 before the first sample). */
function cumulativeAt(series: readonly MetricsSample[], t: number, key: 'collisions' | 'nearMisses'): number {
  let v = 0;
  for (const s of series) { if (s.tick <= t) v = s[key]; else break; }
  return v;
}

/**
 * Pure: L1's predictions per paced transition against the collisions and near misses measured in its window.
 * Pair (i, j) of drones is pair (i, j) of slots because the static arm keeps launch slot = id in S0 (no kills).
 */
export function calibrationWindows(
  transitions: readonly ScoreTransition[], params: Params, series: readonly MetricsSample[],
  collisions: readonly PairEvent[], nearMisses: readonly PairEvent[],
): { windows: CalibrationWindow[]; outside: number } {
  const windows: CalibrationWindow[] = [];
  const inWindow = new Array<boolean>(collisions.length).fill(false);
  transitions.forEach((t, idx) => {
    if (!t.paced) return;
    const fMax = t.cutTick === null ? 1 : (t.cutTick - t.begin) / t.span;
    const dmin = new Map<string, number>();
    let predictedCollide = 0;
    let predictedNear = 0;
    const n = t.from.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = closestApproach(t.from[i] as Vec3, t.to[i] as Vec3, t.from[j] as Vec3, t.to[j] as Vec3, fMax).dmin;
        dmin.set(pairKey(i, j), d);
        if (d < params.dCollide) predictedCollide++;
        if (d < params.dNear) predictedNear++;
      }
    }
    // The window ends at holdStart, or earlier when the next movement takes over the targets (a cut flight, or a
    // next movement that starts during the settle), so windows never overlap and no event is counted twice.
    const next = transitions[idx + 1];
    const fromTick = t.begin;
    const toTick = next === undefined ? t.holdStart : Math.min(t.holdStart, next.begin);
    const hit = new Set<string>();
    let events = 0;
    collisions.forEach((e, idx) => {
      if (e.tick >= fromTick && e.tick < toTick) { events++; hit.add(pairKey(e.i, e.j)); inWindow[idx] = true; }
    });
    const near = new Set<string>();
    for (const e of nearMisses) if (e.tick >= fromTick && e.tick < toTick) near.add(pairKey(e.i, e.j));
    let tp = 0, fp = 0, nearTp = 0, nearFp = 0;
    for (const [key, d] of dmin) {
      if (d < params.dCollide) { if (hit.has(key)) tp++; else fp++; }
      if (d < params.dNear) { if (near.has(key)) nearTp++; else nearFp++; }
    }
    const collidedDmin = [...hit].map((k) => dmin.get(k) ?? NaN).sort((a, b) => a - b);
    windows.push({
      movement: t.movement, fromTick, toTick, predictedCollide, predictedNear,
      seriesCollisions: cumulativeAt(series, toTick - 1, 'collisions') - cumulativeAt(series, fromTick - 1, 'collisions'),
      collisionEvents: events, collisionPairs: hit.size,
      tp, fp, fn: hit.size - tp,
      nearMissPairs: near.size, nearTp, nearFp, nearFn: near.size - nearTp,
      collidedDmin,
    });
  });
  return { windows, outside: inWindow.filter((x) => !x).length };
}

/** An observer factory that passes everything through and also records each snapshot's collision and near-miss pairs. */
export function capturingObserver(base: ObserverFactory, collisions: PairEvent[], nearMisses: PairEvent[]): ObserverFactory {
  return (params) => {
    const inner: Observer = base(params);
    return {
      registerScore: (score) => inner.registerScore(score),
      recordEvent: (event) => inner.recordEvent(event),
      sample: (snapshot: WorldSnapshot) => {
        for (const [i, j] of snapshot.collisions) collisions.push({ tick: snapshot.tick, i, j });
        for (const [i, j] of snapshot.nearMisses) nearMisses.push({ tick: snapshot.tick, i, j });
        return inner.sample(snapshot);
      },
      slotStatus: (snapshot) => inner.slotStatus(snapshot),
      summary: () => inner.summary(),
    };
  };
}

/** Runs S0 static once (runOne, seed 1) and calibrates L1 against it. */
export function calibrate(params: Params, git = 'unknown'): Calibration {
  const collisions: PairEvent[] = [];
  const nearMisses: PairEvent[] = [];
  const record: RunRecord = runOne({
    scenario: CALIBRATION_SCENARIO, seed: CALIBRATION_SEED, arm: CALIBRATION_ARM, params, brains: BRAINS,
    makeObserver: capturingObserver(getObserverFactory(), collisions, nearMisses), git,
  });
  const score = buildEvalScore(params);
  const { windows, outside } = calibrationWindows(scoreTransitions(score, params.n0, params), params, record.series, collisions, nearMisses);
  const last = record.series[record.series.length - 1];
  return {
    scenario: record.scenario, arm: record.arm, seed: record.seed, n0: record.n0,
    git: record.git, paramsHash: record.paramsHash, stateHash: record.stateHash,
    totalCollisions: last?.collisions ?? 0, windows, outsideCollisions: outside,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------

const MOVEMENT_NAMES = ['launch → A', 'A → B'];

function movementName(k: number, label: string): string {
  return label === 'EVAL' ? (MOVEMENT_NAMES[k] ?? `movement ${k}`) : `movement ${k}`;
}

function cell(s: string): string {
  return s.replaceAll('|', '\\|');
}

function fmt(v: number | undefined, digits = 3): string {
  return v === undefined ? '' : Number.isFinite(v) ? v.toFixed(digits) : String(v);
}

function findingRow(f: LintFinding): string {
  return `| ${f.check} | ${f.severity} | ${f.count} | ${fmt(f.value)} | ${fmt(f.threshold)} | ${cell(f.detail)} |`;
}

export interface ReportOptions {
  label?: string;            // 'EVAL' (default) or a file name
  git?: string;
  calibration?: Calibration;
}

/** The Markdown report. Deterministic in its inputs: no clock, no host. */
export function buildLintReport(score: Score, params: Params, options: ReportOptions = {}): string {
  const label = options.label ?? 'EVAL';
  const lint: MovementLint[] = lintScore(score, params.n0, params);
  const out: string[] = [];
  out.push(`# Score lint report: ${label} at n0 = ${params.n0}`, '');
  out.push(`- git: \`${options.git ?? 'unknown'}\`; paramsHash: \`${paramsHash(params)}\``);
  out.push('- Checks L1–L5 of docs/design/ANIMATED_CHOREOGRAPHY_RFC.md §9 on slot targets: checks on targets, not proofs. Warnings never block injection.');
  out.push(`- L1 counts ${L1_LABEL}. Pacing is the #96 rule restated in src/cli/lint.ts (settle ${PACE_SETTLE_TICKS} ticks).`, '');
  for (const m of lint) {
    const t = m.transition;
    out.push(`## Movement ${t.movement}: ${movementName(t.movement, label)}`, '');
    out.push(t.paced
      ? `Paced from tick ${t.begin} to ${t.end} (span ${t.span} ticks), hold at ${t.holdStart}${t.cutTick === null ? '' : `, flight cut at ${t.cutTick} by the next movement`}.`
      : `Not paced: ${t.reason ?? ''}.`);
    out.push('', '| Check | Severity | Count | Value | Threshold | Detail |', '|---|---|---|---|---|---|');
    for (const f of m.findings) out.push(findingRow(f));
    const l1 = m.findings.find((f) => f.check === 'L1');
    if (l1?.pairs !== undefined && l1.pairs.length > 0) {
      out.push('', `Worst pairs under ideal paced flight (no avoidance): not a collision forecast.`, '', '| i | j | dmin (m) | tick* |', '|---|---|---|---|');
      for (const p of l1.pairs) out.push(`| ${p.i} | ${p.j} | ${p.dmin.toFixed(3)} | ${p.tick.toFixed(1)} |`);
    }
    out.push('');
  }
  if (options.calibration !== undefined) out.push(...calibrationSection(options.calibration, params, label));
  return out.join('\n');
}

function calibrationSection(c: Calibration, params: Params, label: string): string[] {
  const out: string[] = [];
  out.push('## Calibration (P2-T08): not a pass line, not a forecast', '');
  out.push(`One measured run: ${c.scenario} ${c.arm} seed ${c.seed} at n0 = ${c.n0} (runOne; git \`${c.git}\`, paramsHash \`${c.paramsHash}\`, stateHash \`${c.stateHash}\`). ` +
    `The static arm keeps drone i on slot i, so a drone pair is a slot pair. Windows run from the transition's begin to its holdStart ` +
    `(paced flight plus the ${PACE_SETTLE_TICKS}-tick settle). "Collisions" are pair entries into d < dCollide ${params.dCollide} m, as the world counts them; ` +
    `the series column takes them from the cumulative series[].collisions on the 5-tick sample grid, the events column from each tick's snapshot.`, '');
  out.push('| Window | Ticks | L1 predicted < dCollide | Collisions (series) | Collision events | Colliding pairs | Predicted and collided | Predicted, not collided | Collided, not predicted |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const w of c.windows) {
    out.push(`| ${movementName(w.movement, label)} | ${w.fromTick}–${w.toTick - 1} | ${w.predictedCollide} | ${w.seriesCollisions} | ${w.collisionEvents} | ${w.collisionPairs} | ${w.tp} | ${w.fp} | ${w.fn} |`);
  }
  out.push('', `| Window | L1 predicted < dNear | Near-miss pairs | Predicted and near-missed | Predicted, not near-missed | Near-missed, not predicted |`, '|---|---|---|---|---|---|');
  for (const w of c.windows) {
    out.push(`| ${movementName(w.movement, label)} | ${w.predictedNear} | ${w.nearMissPairs} | ${w.nearTp} | ${w.nearFp} | ${w.nearFn} |`);
  }
  out.push('', `Collisions in the run: ${c.totalCollisions}; outside every transition window: ${c.outsideCollisions}.`, '');
  for (const w of c.windows) {
    if (w.collidedDmin.length === 0) continue;
    out.push(`Predicted dmin of the pairs that collided in ${movementName(w.movement, label)} (m): ${w.collidedDmin.map((d) => d.toFixed(2)).join(', ')}.`);
  }
  out.push('', 'Reading: L1 models every drone exactly on its paced target with no avoidance. The reactive layer of the real drones ' +
    'changes the paths, so a predicted conflict says where that layer has work to do, not what will hit, and a collision can ' +
    'happen between drones L1 did not flag. These figures come from one seed and one arm; they calibrate the wording, they are not a rate.', '');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

export interface LintArgs { n0: number; calibrate: boolean; score: string | null; out: string | null }

export const USAGE = 'Usage: npx tsx src/cli/lintReport.ts [--n0 200] [--calibrate] [--score file.json] [--out report.md]';

export function parseLintArgs(argv: readonly string[]): LintArgs {
  const args: LintArgs = { n0: 200, calibrate: false, score: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    const next = argv[i + 1];
    switch (flag) {
      case '--calibrate': args.calibrate = true; break;
      case '--n0': {
        const n = Number(next);
        if (next === undefined || !Number.isInteger(n) || n < 1) throw new RangeError(`--n0 needs a positive integer, got ${String(next)}`);
        args.n0 = n; i++; break;
      }
      case '--score':
        if (next === undefined) throw new RangeError('--score needs a file');
        args.score = next; i++; break;
      case '--out':
        if (next === undefined) throw new RangeError('--out needs a file');
        args.out = next; i++; break;
      default: throw new RangeError(`Unknown argument '${flag}'. ${USAGE}`);
    }
  }
  if (args.calibrate && args.score !== null) throw new RangeError('--calibrate applies to the EVAL score only; drop --score');
  return args;
}

function gitDescribe(): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim();
    return dirty === '' ? head : `${head}-dirty`;
  } catch {
    return 'unknown';
  }
}

/** Returns the process exit code: 0 for a report (with or without warnings), 2 when the input is rejected. */
export function main(argv: readonly string[], write: (s: string) => void = (s) => process.stdout.write(s)): number {
  if (argv.includes('--help') || argv.includes('-h')) { write(`${USAGE}\n`); return 0; }
  const args = parseLintArgs(argv);
  const params = makeParams(args.n0);
  const git = gitDescribe();
  try {
    let score: Score;
    let label = 'EVAL';
    if (args.score !== null) {
      label = args.score;
      try { score = JSON.parse(readFileSync(args.score, 'utf8')) as Score; } catch (e) { throw new LintInputError(`cannot read ${args.score} as JSON: ${e instanceof Error ? e.message : String(e)}`); }
    } else {
      score = buildEvalScore(params);
    }
    const calibration = args.calibrate ? calibrate(params, git) : undefined;
    const report = buildLintReport(score, params, { label, git, calibration });
    if (args.out !== null) writeFileSync(args.out, `${report}\n`);
    write(`${report}\n`);
    return 0;
  } catch (e) {
    if (e instanceof LintInputError) { write(`REJECTED: ${e.message}\n`); return 2; }
    throw e;
  }
}

const invokedDirectly = process.argv[1] !== undefined && /[\\/]src[\\/]cli[\\/]lintReport\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
