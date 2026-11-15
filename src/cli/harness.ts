// src/cli/harness.ts
// P2-WP-01: one headless run of any (score, events) pair, with the invariant checkers attached.
// Run as a library (P2-WP-02, -07, -08 and -10 build on it). It replays an established scenario exactly as runOne
// does: the same world, the same brain from brainFor, every score registered and every event recorded before the
// first step. The checker and the observer only read snapshots, so the stateHash and summary equal runOne's.
// The record is `kind: 'p2-exploratory'` (PHASE2_EVALUATION §10) and is never written as an evaluation record.
import type { EnvEvent, Params, RunRecord, Score, WorldSnapshot, MetricsSample } from '../contracts';
import { createInvariantChecker, type InvariantCheckerOptions, type InvariantReport } from '../observer/invariants';
import { createWorld } from '../sim';
import { BRAINS, brainFor, type Arm, type BrainMap } from './brains';
import { getObserverFactory, type ObserverFactory } from './observer';
import { paramsHash } from './run';

export interface CustomRun {
  label: string;
  seed: number;
  params: Params;
  score: Score;
  events: EnvEvent[];
  ticks: number;
  arm: Arm;
  git?: string;
}

export interface ExploratoryRecord extends RunRecord {
  label: string;
  kind: 'p2-exploratory';
}

export interface CustomHooks {
  /** Called with each snapshot before the observer and the checker read it. Must not mutate it. */
  onSnapshot?(snapshot: WorldSnapshot): void;
  /** false: no checker (report is null). Otherwise options passed to createInvariantChecker. Default: all checks. */
  invariants?: false | Pick<InvariantCheckerOptions, 'checks' | 'thresholds'>;
  brains?: BrainMap;
  makeObserver?: ObserverFactory;
}

export function runCustom(run: CustomRun, hooks: CustomHooks = {}): { record: ExploratoryRecord; report: InvariantReport | null } {
  const { params } = run;
  if (!Number.isInteger(run.ticks) || run.ticks < 0) throw new RangeError(`ticks must be a non-negative integer, got ${run.ticks}`);
  const brain = brainFor(hooks.brains ?? BRAINS, run.arm);
  // createWorld deep-copies params, score and events, as in runOne.
  const world = createWorld({ seed: run.seed, params, brain, score: run.score, events: run.events });
  const observer = (hooks.makeObserver ?? getObserverFactory())(params);
  const checker = hooks.invariants === false ? null
    : createInvariantChecker({ params, arm: run.arm, ...(hooks.invariants ?? {}) });
  observer.registerScore(run.score);
  checker?.registerScore(run.score);
  for (const event of run.events) {
    if (event.type === 'INJECT_SCORE') { observer.registerScore(event.score); checker?.registerScore(event.score); }
    observer.recordEvent(event);
    checker?.recordEvent(event);
  }

  const series: MetricsSample[] = [];
  for (let t = 0; t < run.ticks; t++) {
    const snapshot = world.step();
    hooks.onSnapshot?.(snapshot);
    const sample = observer.sample(snapshot);
    if (sample !== null) series.push(sample);
    checker?.ingest(snapshot);
  }

  const record: ExploratoryRecord = {
    v: 1,
    git: run.git ?? 'unknown',
    paramsHash: paramsHash(params),
    scenario: run.label,
    arm: run.arm,
    seed: run.seed,
    n0: params.n0,
    events: structuredClone(run.events),
    series,
    summary: observer.summary(),
    stateHash: world.stateHash(),
    label: run.label,
    kind: 'p2-exploratory',
  };
  return { record, report: checker ? checker.report() : null };
}
