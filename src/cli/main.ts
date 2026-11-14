// src/cli/main.ts
// Headless batch runner and report (evaluation doc §5).
//   npm run eval -- --scenario S2 --seeds 1-5 --arms static,encore --n0 200 --out results/
//   npm run eval -- --report results/ [--report-out results/RESULTS.md]
// Writes one RunRecord JSON per (scenario, arm, seed) and prints a one-line summary for each.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from '../contracts';
import { BRAINS, brainFor, isArm, type Arm } from './brains';
import { getObserverFactory } from './observer';
import { buildReport } from './report';
import { runOne } from './run';
import { isScenarioId, SCENARIO_IDS, type ScenarioId } from './scenarios';

const USAGE = `Usage:
  npm run eval -- --scenario S0,S2 --seeds 1-5 --arms static,encore [--n0 200] [--out results/]
  npm run eval -- --report results/ [--report-out results/RESULTS.md]
Scenarios: ${SCENARIO_IDS.join(', ')} (or "min" = S0,S1,S2,S3,S5; "all"). Seeds: "1-5", "1,3,7" or "101-105".`;

export interface CliArgs {
  scenarios: ScenarioId[]; seeds: number[]; arms: Arm[]; n0: number; out: string;
  report: string | null; reportOut: string | null;
}

function fail(message: string): never {
  throw new Error(`${message}\n\n${USAGE}`);
}

export function parseSeeds(text: string): number[] {
  const seeds: number[] = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) fail(`Bad seed list '${text}'`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo) fail(`Bad seed range '${part}'`);
    for (let s = lo; s <= hi; s++) seeds.push(s);
  }
  if (seeds.length === 0) fail('No seeds given');
  return [...new Set(seeds)];
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (!flag.startsWith('--')) fail(`Unexpected argument '${flag}'`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) fail(`Flag ${flag} needs a value`);
    opts.set(flag.slice(2), next);
    i++;
  }
  for (const key of opts.keys()) {
    if (!['scenario', 'seeds', 'arms', 'n0', 'out', 'report', 'report-out'].includes(key)) fail(`Unknown flag --${key}`);
  }
  const report = opts.get('report') ?? null;
  const reportOut = opts.get('report-out') ?? null;
  const n0 = Number(opts.get('n0') ?? '200');
  if (!Number.isInteger(n0) || n0 < 1) fail(`Bad --n0 '${opts.get('n0')}'`);
  const out = opts.get('out') ?? 'results';
  if (report !== null) return { scenarios: [], seeds: [], arms: [], n0, out, report, reportOut };

  const scenarioText = opts.get('scenario') ?? fail('Missing --scenario');
  const scenarios = scenarioText === 'all' ? [...SCENARIO_IDS]
    : scenarioText === 'min' ? (['S0', 'S1', 'S2', 'S3', 'S5'] as ScenarioId[])
      : scenarioText.split(',').map((s) => s.trim()).map((s) => (isScenarioId(s) ? s : fail(`Unknown scenario '${s}'`)));
  const seeds = parseSeeds(opts.get('seeds') ?? fail('Missing --seeds'));
  const arms = (opts.get('arms') ?? 'static,encore').split(',').map((s) => s.trim()).map((a) => (isArm(a) ? a : fail(`Unknown arm '${a}'`)));
  return { scenarios, seeds, arms: [...new Set(arms)], n0, out, report, reportOut };
}

/** The commit the runs come from; "-dirty" if tracked or untracked source differs from it. */
function gitDescribe(): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
}

export function recordFileName(r: Pick<RunRecord, 'scenario' | 'n0' | 'arm' | 'seed'>): string {
  return `${r.scenario}_n${r.n0}_${r.arm}_s${r.seed}.json`;
}

function f3(x: number | null | undefined): string {
  return typeof x === 'number' ? x.toFixed(3) : String(x ?? '—');
}

export function summaryLine(r: RunRecord): string {
  const s = r.summary;
  return `${r.scenario} n0=${r.n0} ${r.arm.padEnd(6)} seed=${r.seed} npwcEnd=${f3(s.npwcEnd)} npwcEndA=${f3(s.npwcEndA)} ` +
    `sfMaxEndA=${f3(s.sfMaxEndA)} tRec=${!('tRec' in s) ? 'n/a' : s.tRec === null ? 'censored' : f3(s.tRec)} slotChanges=${s.slotChanges ?? '—'} ` +
    `collisions=${s.collisions ?? '—'} stateHash=${r.stateHash}`;
}

function runReport(dir: string, outFile: string | null): void {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const records = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunRecord).filter((r) => r.v === 1);
  const md = buildReport(records);
  if (outFile) {
    writeFileSync(outFile, md);
    console.log(`Wrote ${outFile} from ${records.length} records`);
  } else {
    console.log(md);
  }
}

function runBatch(args: CliArgs): void {
  // Fail before running anything if an arm has no brain, so a long batch never stops half way.
  for (const arm of args.arms) brainFor(BRAINS, arm);
  const makeObserver = getObserverFactory();
  const git = gitDescribe();
  mkdirSync(args.out, { recursive: true });
  for (const scenario of args.scenarios) {
    for (const seed of args.seeds) {
      for (const arm of args.arms) {
        const record = runOne({ scenario, seed, arm, n0: args.n0, brains: BRAINS, makeObserver, git });
        writeFileSync(join(args.out, recordFileName(record)), `${JSON.stringify(record)}\n`);
        console.log(summaryLine(record));
      }
    }
  }
}

export function main(argv: readonly string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(argv);
  if (args.report !== null) runReport(args.report, args.reportOut);
  else runBatch(args);
}

const invokedDirectly = process.argv[1] !== undefined && /[\\/]src[\\/]cli[\\/]main\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
