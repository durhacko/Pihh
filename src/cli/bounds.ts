// src/cli/bounds.ts
// P2-WP-08: per run, the observed recovery times against the oracle upper bound, and end-of-tick collision counts
// against swept closest-approach counts. Exploratory (PHASE2_EVALUATION §10): never a base matrix record, never in
// RunRecord.summary. It replays each scenario through runCustom (same world and brain as runOne), so the stateHash and
// summary are the base run's; the swept counter and the oracle only read snapshots.
//
//   npx tsx src/cli/bounds.ts --scenario S1,S2,S4 --seeds 1-5 --arms static,encore --out <dir> [--n0 200]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldSnapshot } from '../contracts';
import { DT, makeParams } from '../contracts';
import { createSweptCounter, type SweptTick } from '../observer/swept';
import { isArm, type Arm } from './brains';
import { runCustom } from './harness';
import { tOracleForRun } from './oracle';
import { buildScenario, isScenarioId, type ScenarioId } from './scenarios';

export interface BoundsRow {
  scenario: ScenarioId;
  arm: Arm;
  seed: number;
  n0: number;
  killTick: number | null;
  /** First KILL to the first sample with npwc ≥ 0.95, s; null if never; undefined without a KILL. */
  tFirst95: number | null | undefined;
  /** summary.tRec: undefined without a KILL (not applicable), null when censored. */
  tRec: number | null | undefined;
  /** Oracle upper bound (instant global knowledge), s; null unless exactly one KILL (or unreachable in the horizon). */
  tOracle: number | null;
  collisions: number;
  collisionsSwept: number;
  nearMisses: number;
  nearMissesSwept: number;
  stateHash: string;
}

export interface BoundsOptions {
  scenario: ScenarioId;
  arm: Arm;
  seed: number;
  n0: number;
  /** Override the scenario's run length (tests use short runs). */
  ticks?: number;
  /** Per tick: the world's end-of-tick entries and the swept entries, for bucketing analyses. */
  onTick?(snapshot: WorldSnapshot, swept: SweptTick): void;
}

export function boundsRun(options: BoundsOptions): BoundsRow {
  const params = makeParams(options.n0);
  const scenario = buildScenario(options.scenario, options.seed, params);
  const ticks = options.ticks ?? scenario.ticks;
  const kill = scenario.events.find(e => e.type === 'KILL')?.tick ?? null;
  const swept = createSweptCounter(params);
  let atKill: WorldSnapshot | null = null;
  let collisions = 0;
  let nearMisses = 0;
  const { record } = runCustom(
    { label: options.scenario, seed: options.seed, params, score: scenario.score, events: scenario.events, ticks, arm: options.arm },
    {
      invariants: false,
      onSnapshot(snapshot) {
        const tick = swept.ingest(snapshot);
        collisions += snapshot.collisions.length;
        nearMisses += snapshot.nearMisses.length;
        options.onTick?.(snapshot, tick);
        if (snapshot.tick === kill) atKill = structuredClone(snapshot);
      },
    },
  );
  let tFirst95: number | null | undefined;
  if (kill !== null) {
    const first = record.series.find(s => s.tick >= kill && s.npwc !== null && s.npwc >= 0.95);
    tFirst95 = first ? (first.tick - kill) * DT : null;
  }
  const oracle = kill === null ? null : tOracleForRun(scenario.events, atKill, scenario.score, params, ticks - kill);
  const totals = swept.totals();
  return {
    scenario: options.scenario, arm: options.arm, seed: options.seed, n0: options.n0, killTick: kill,
    tFirst95, tRec: Object.hasOwn(record.summary, 'tRec') ? record.summary.tRec : undefined,
    tOracle: oracle ? oracle.tOracle : null,
    collisions, collisionsSwept: totals.collisionsSwept,
    nearMisses, nearMissesSwept: totals.nearMissesSwept,
    stateHash: record.stateHash,
  };
}

function fmt(value: number | null | undefined): string {
  if (value === undefined) return 'n/a';
  if (value === null) return 'null';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function boundsTable(rows: readonly BoundsRow[]): string {
  const head = '| Scenario | Arm | Seed | n0 | tFirst95 (s) | tRec (s) | tOracle (s, oracle upper bound) | Collisions (tick ends) | Collisions (swept) | Near-misses (tick ends) | Near-misses (swept) |';
  const lines = rows.map(r => `| ${r.scenario} | ${r.arm} | ${r.seed} | ${r.n0} | ${fmt(r.tFirst95)} | ${fmt(r.tRec)} | ${fmt(r.tOracle)} | ${r.collisions} | ${r.collisionsSwept} | ${r.nearMisses} | ${r.nearMissesSwept} |`);
  return [head, `|${'---|'.repeat(11)}`, ...lines].join('\n');
}

/** The repo's results/ folder, anchored to this module's own location (src/cli/bounds.ts), never to the working
 *  directory: an absolute `--out <repo>/results/…` run from elsewhere is still refused. */
export const REPO_RESULTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');

/** True when `out` is the repo's results/ folder or inside it (whole path segments, so results-x is outside).
 *  results/ is locked for Phase 2 output until the lock lifts (P2-WP-08: results/phase2/bounds/ later). */
export function insideRepoResults(out: string): boolean {
  const rel = relative(REPO_RESULTS, resolve(out));
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) return false;
  return !/^([A-Za-z]:|[\\/])/.test(rel);
}

function parseSeeds(text: string): number[] {
  const seeds: number[] = [];
  for (const part of text.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad --seeds part '${part}'`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a || b - a > 100) throw new Error(`bad --seeds range '${part}'`);
    for (let s = a; s <= b; s++) seeds.push(s);
  }
  return seeds;
}

function main(argv: readonly string[]): number {
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ?? '';
    if (!key.startsWith('--') || argv[i + 1] === undefined) throw new Error('usage: bounds.ts --scenario S1,S2,S4 --seeds 1-5 --arms static,encore --out <dir> [--n0 200]');
    opts.set(key.slice(2), argv[i + 1]!);
  }
  const scenarios = (opts.get('scenario') ?? 'S1,S2,S4').split(',').map(s => s.trim());
  for (const s of scenarios) if (!isScenarioId(s)) throw new Error(`unknown scenario ${s}`);
  const arms = (opts.get('arms') ?? 'static,encore').split(',').map(s => s.trim());
  for (const a of arms) if (!isArm(a)) throw new Error(`unknown arm ${a}`);
  const seeds = parseSeeds(opts.get('seeds') ?? '1-5');
  const n0 = Number(opts.get('n0') ?? '200');
  const out = opts.get('out');
  if (out && insideRepoResults(out)) throw new Error('--out must not be inside results/ (locked)');
  const rows: BoundsRow[] = [];
  for (const scenario of scenarios as ScenarioId[]) for (const arm of arms as Arm[]) for (const seed of seeds) {
    rows.push(boundsRun({ scenario, arm, seed, n0 }));
  }
  const table = boundsTable(rows);
  process.stdout.write(`Exploratory (P2-WP-08): tOracle is an ORACLE UPPER BOUND (instant global knowledge), never an arm.\n${table}\n`);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'bounds.json'), `${JSON.stringify(rows, null, 2)}\n`);
    writeFileSync(join(out, 'bounds.md'), `${table}\n`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && /[\\/]src[\\/]cli[\\/]bounds\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
