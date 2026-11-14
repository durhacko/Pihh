// src/cli/run.ts
// One headless run: one scenario, one seed, one arm -> one RunRecord (contract §5, evaluation doc §5).
// The brain map and the observer factory are parameters, so tests can pass a stub observer and new brains
// plug in through src/cli/brains.ts. No wall-clock value enters the record (it would break replay equality).
import { createHash } from 'node:crypto';
import { makeParams } from '../contracts';
import type { MetricsSample, Params, RunRecord } from '../contracts';
import { createWorld } from '../sim';
import { brainFor, type Arm, type BrainMap } from './brains';
import type { ObserverFactory } from './observer';
import { buildScenario, type ScenarioId } from './scenarios';

export interface RunOptions {
  scenario: ScenarioId;
  seed: number;
  arm: Arm;
  n0?: number;               // default 200, or params.n0 when params are given
  params?: Params;           // default makeParams(n0); the frozen evaluation params
  brains: BrainMap;
  makeObserver: ObserverFactory;
  git?: string;              // commit the run was made from; default 'unknown'
  ticks?: number;            // TESTS ONLY: stop early. Evaluation runs always use the scenario's length
}

/** JSON with object keys sorted at every level, so equal params always hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** sha256 of the canonical JSON of `params`, hex. */
export function paramsHash(params: Params): string {
  return createHash('sha256').update(canonicalJson(params)).digest('hex');
}

export function resolveParams(n0: number | undefined, params: Params | undefined): Params {
  const size = n0 ?? params?.n0 ?? 200;
  const resolved = params ?? makeParams(size);
  if (resolved.n0 !== size) throw new RangeError(`n0 (${size}) does not match params.n0 (${resolved.n0})`);
  return resolved;
}

export function runOne(options: RunOptions): RunRecord {
  const params = resolveParams(options.n0, options.params);
  const brain = brainFor(options.brains, options.arm);
  const scenario = buildScenario(options.scenario, options.seed, params);
  const ticks = options.ticks ?? scenario.ticks;
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > scenario.ticks) throw new RangeError(`ticks must be an integer in 0..${scenario.ticks}, got ${ticks}`);

  // createWorld deep-copies params, score and events, so the record's copies cannot be changed by the run.
  const world = createWorld({ seed: options.seed, params, brain, score: scenario.score, events: scenario.events });
  // Every score is registered exactly once, before the first step, so it is known before any live drone can
  // believe it (the observer throws otherwise). slotStatus() is never called: the batch runner does not need it.
  const observer = options.makeObserver(params);
  observer.registerScore(scenario.score);
  for (const event of scenario.events) {
    if (event.type === 'INJECT_SCORE') observer.registerScore(event.score);
    observer.recordEvent(event);
  }

  const series: MetricsSample[] = [];
  for (let t = 0; t < ticks; t++) {
    const sample = observer.sample(world.step());
    if (sample !== null) series.push(sample);
  }

  return {
    v: 1,
    git: options.git ?? 'unknown',
    paramsHash: paramsHash(params),
    scenario: scenario.id,
    arm: options.arm,
    seed: options.seed,
    n0: params.n0,
    events: scenario.events,
    series,
    summary: observer.summary(),
    stateHash: world.stateHash(),
  };
}
