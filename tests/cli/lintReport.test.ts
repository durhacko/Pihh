// Score lint report CLI (P2-WP-04): deterministic EVAL report at n0 40, rejection exit code, the calibration windowing
// (P2-T08) on hand-built data, and the pass-through capturing observer. The real S0 calibration run is opt-in (P2_WIDE=1).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { MetricsSample, Observer, Score, Vec3 } from '../../src/contracts';
import { BRAINS } from '../../src/cli/brains';
import { L1_LABEL } from '../../src/cli/lint';
import type { ScoreTransition } from '../../src/cli/lint';
import {
  buildLintReport, calibrate, calibrationWindows, capturingObserver, main, parseLintArgs,
} from '../../src/cli/lintReport';
import type { PairEvent } from '../../src/cli/lintReport';
import { getObserverFactory } from '../../src/cli/observer';
import { runOne } from '../../src/cli/run';
import { buildEvalScore } from '../../src/cli/scenarios';

const P40 = makeParams(40);
const dir = mkdtempSync(join(tmpdir(), 'lint-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('buildLintReport on EVAL at n0 40', () => {
  const report = buildLintReport(buildEvalScore(P40), P40, { git: 'test' });

  it('is deterministic', () => {
    expect(buildLintReport(buildEvalScore(P40), P40, { git: 'test' })).toBe(report);
  });

  it('covers launch → A and A → B with every check, in the required wording', () => {
    expect(report).toContain('## Movement 0: launch → A');
    expect(report).toContain('## Movement 1: A → B');
    for (const check of ['L1', 'L2', 'L3', 'L4', 'L5']) expect(report).toMatch(new RegExp(`^\\| ${check} \\| (info|warn) \\|`, 'm'));
    expect(report).toContain(L1_LABEL);
    expect(report).not.toMatch(/\bpass(ed)?\b|will collide|collision guarantee/i);
  });
});

describe('main (CLI)', () => {
  const run = (argv: string[]): { code: number; out: string } => {
    let out = '';
    const code = main(argv, (s) => { out += s; });
    return { code, out };
  };

  it('writes the report to --out and stdout, exit 0 even with warnings', () => {
    const file = join(dir, 'eval.md');
    const { code, out } = run(['--n0', '40', '--out', file]);
    expect(code).toBe(0);
    expect(out).toContain('| L1 |');
    expect(readFileSync(file, 'utf8')).toBe(out);
  });

  it('rejects a structurally invalid score file with exit 2 and no findings', () => {
    const file = join(dir, 'bad.json');
    const bad: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [
      { startTick: 100, transitionTicks: 400, recipe: { kind: 'sphere' } },
      { startTick: 0, transitionTicks: 400, recipe: { kind: 'helix' } },
    ] };
    writeFileSync(file, JSON.stringify(bad));
    const { code, out } = run(['--n0', '40', '--score', file]);
    expect(code).toBe(2);
    expect(out).toMatch(/^REJECTED: movements must be sorted by startTick/);
    expect(out).not.toContain('| L1 |');
  });

  it('rejects a file that is not JSON', () => {
    const file = join(dir, 'garbage.json');
    writeFileSync(file, '{ not json');
    expect(run(['--score', file]).code).toBe(2);
  });

  it('lints a valid score file', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify(buildEvalScore(P40)));
    const { code, out } = run(['--n0', '40', '--score', file]);
    expect(code).toBe(0);
    expect(out).toContain('## Movement 0: movement 0');
  });

  it('parses and rejects arguments', () => {
    expect(parseLintArgs([])).toEqual({ n0: 200, calibrate: false, score: null, out: null });
    expect(parseLintArgs(['--n0', '40', '--calibrate'])).toMatchObject({ n0: 40, calibrate: true });
    expect(() => parseLintArgs(['--n0', '0'])).toThrow(RangeError);
    expect(() => parseLintArgs(['--n0'])).toThrow(RangeError);
    expect(() => parseLintArgs(['--bogus'])).toThrow(/Unknown argument/);
    expect(() => parseLintArgs(['--calibrate', '--score', 'x.json'])).toThrow(/EVAL score only/);
  });
});

describe('calibrationWindows (P2-T08 windowing, hand-built data)', () => {
  // Three drones: 0 and 1 swap head-on (predicted dmin 0), 2 flies far away in parallel.
  const transition: ScoreTransition = {
    movement: 0, paced: true, superseded: false, reason: null, begin: 0, end: 100, span: 100, holdStart: 160, cutTick: null,
    from: [[0, 5, 0], [10, 5, 0], [0, 50, 0]] as Vec3[],
    to: [[10, 5, 0], [0, 5, 0], [10, 50, 0]] as Vec3[],
  };
  const sample = (tick: number, collisions: number): MetricsSample => ({
    tick, alive: 3, coverage: 1, pwc: 1, npwc: 1, sfMean: 0, sfMax: 0, dupSlots: 0, versions: {},
    msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions, nearMisses: 0, slotChanges: 0,
  });
  const collisions: PairEvent[] = [{ tick: 50, i: 1, j: 0 }, { tick: 120, i: 1, j: 2 }, { tick: 170, i: 0, j: 2 }];
  const near: PairEvent[] = [{ tick: 48, i: 0, j: 1 }];
  const series = [sample(5, 0), sample(50, 1), sample(120, 2), sample(155, 2), sample(160, 2), sample(170, 3)];
  const { windows, outside } = calibrationWindows([transition], makeParams(3), series, collisions, near);

  it('counts predicted-and-collided, predicted-only and collided-only pairs within [begin, holdStart)', () => {
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      movement: 0, fromTick: 0, toTick: 160, predictedCollide: 1, predictedNear: 1,
      seriesCollisions: 2, collisionEvents: 2, collisionPairs: 2, tp: 1, fp: 0, fn: 1,
      nearMissPairs: 1, nearTp: 1, nearFp: 0, nearFn: 0,
    });
    expect(windows[0]!.collidedDmin[0]).toBe(0);
    expect(outside).toBe(1);
  });

  it('ends a window where the next movement takes over, so overlapping movements never count an event twice', () => {
    const second: ScoreTransition = { ...transition, movement: 1, begin: 120, end: 300, span: 180, holdStart: 360, cutTick: null };
    const events: PairEvent[] = [{ tick: 50, i: 0, j: 1 }, { tick: 130, i: 0, j: 1 }];
    const r = calibrationWindows([{ ...transition, cutTick: 120 }, second], makeParams(3), series, events, []);
    expect(r.windows.map((w) => [w.fromTick, w.toTick, w.collisionEvents])).toEqual([[0, 120, 1], [120, 360, 1]]);
    expect(r.windows.reduce((s, w) => s + w.collisionEvents, 0) + r.outside).toBe(events.length);
  });

  it('skips transitions that are not paced', () => {
    expect(calibrationWindows([{ ...transition, paced: false }], makeParams(3), series, collisions, near).windows).toEqual([]);
  });
});

describe('capturingObserver', () => {
  it('passes every call through unchanged and records collision and near-miss pairs', () => {
    const calls: string[] = [];
    const fake: Observer = {
      registerScore: () => { calls.push('register'); },
      recordEvent: () => { calls.push('event'); },
      sample: () => { calls.push('sample'); return null; },
      slotStatus: () => { calls.push('status'); return { formation: { slots: [], dense: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }, inHold: false, status: [] }; },
      summary: () => { calls.push('summary'); return { x: 1 }; },
    };
    const c: PairEvent[] = [];
    const n: PairEvent[] = [];
    const obs = capturingObserver(() => fake, c, n)(P40);
    obs.registerScore(buildEvalScore(P40));
    obs.recordEvent({ type: 'SET_LOSS', tick: 1, loss: 0 });
    const snap = { tick: 7, drones: [], radio: [], jams: [], partitions: [], collisions: [[1, 2]] as [number, number][], nearMisses: [[1, 2], [3, 4]] as [number, number][] };
    expect(obs.sample(snap)).toBeNull();
    expect(obs.summary()).toEqual({ x: 1 });
    expect(calls).toEqual(['register', 'event', 'sample', 'summary']);
    expect(c).toEqual([{ tick: 7, i: 1, j: 2 }]);
    expect(n).toEqual([{ tick: 7, i: 1, j: 2 }, { tick: 7, i: 3, j: 4 }]);
  });
});

describe.runIf(process.env.P2_WIDE === '1')('P2_WIDE: the real S0 static calibration run', () => {
  it('the capturing observer changes nothing in the record (n0 40), and the exact counts agree with the series', () => {
    const plain = runOne({ scenario: 'S0', seed: 1, arm: 'static', params: P40, brains: BRAINS, makeObserver: getObserverFactory() });
    const c: PairEvent[] = [];
    const n: PairEvent[] = [];
    const wrapped = runOne({ scenario: 'S0', seed: 1, arm: 'static', params: P40, brains: BRAINS, makeObserver: capturingObserver(getObserverFactory(), c, n) });
    expect(wrapped).toEqual(plain);
    expect(c.length).toBe(plain.series[plain.series.length - 1]!.collisions);
    expect(n.length).toBe(plain.series[plain.series.length - 1]!.nearMisses);
  }, 120_000);

  it('n0 200: one window per EVAL transition; window and outside events add up to the run total', () => {
    const cal = calibrate(makeParams(200), 'test');
    expect(cal.windows.map((w) => w.movement)).toEqual([0, 1]);
    const inWindows = cal.windows.reduce((s, w) => s + w.collisionEvents, 0);
    expect(inWindows + cal.outsideCollisions).toBe(cal.totalCollisions);
    for (const w of cal.windows) expect(w.tp + w.fn).toBe(w.collisionPairs);
    console.log(JSON.stringify(cal.windows));
  }, 120_000);
});
