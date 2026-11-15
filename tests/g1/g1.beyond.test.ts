// tests/g1/g1.beyond.test.ts
// Issue #17, OUTSIDE the pass criteria of gate G1 (the gate itself is ./g1.test.ts). Same real world, same
// helpers, same five conditions; these runs exist to show how far the G1 result reaches:
//   1. the clumped kill of section 8.6 on EVERY one of the 40 possible kill centres (seed 1), because the
//      gate only sees the few centres its seeds happen to draw. Four of the five conditions hold on all 40.
//      The fifth, "no commits in the last 10 s", does NOT: it is recorded below with it.fails, never hidden;
//   2. the inline npwc, coverage, duplicate slots and slot changes against the project's observer;
//   3. one scaled run: n0 = 120 with makeParams(120), 20 % loss, a regional kill of 12;
//   4. opt-in (G1_WIDE=1): all 40 centres on each of seeds 1..5 (200 runs), and the scaled run for 60 s. Printed only.
import { afterAll, describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '../../src/contracts';
import { createObserver } from '../../src/observer';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { staticBrain } from '../../src/agent/staticBrain';
import {
  analyseKill, centreFor, clumpedKill, coverageOf, describeKill, dupSlotCount, expectSetUp, f3, KILL_HEADER, killRow, killSetUp, runArm, sec, shapeFidelityOf, slotChangesOf,
} from './helpers';
import type { ClumpedKill, KillSetUp } from './helpers';

const report: string[] = [];
afterAll(() => { if (report.length) console.log('\n' + report.join('\n') + '\n'); });

type Condition = 'dupOk' | 'quietOk' | 'countOk' | 'lowerOk' | 'npwcOk';
const median = (sorted: number[]): number => (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;

function summarise(runs: ClumpedKill[]): string[] {
  const count = (key: Condition): number => runs.filter(r => r.verdict[key]).length;
  const deltas = runs.map(r => (r.encore.npwcEnd ?? 0) - (r.fixed.npwcEnd ?? 0)).sort((a, b) => a - b);
  const ends = runs.map(r => r.encore.npwcEnd ?? 0).sort((a, b) => a - b);
  const lastCommit = runs.map(r => r.lastCommitSec ?? 0).sort((a, b) => a - b);
  const total = (pick: (r: ClumpedKill) => number): number => runs.reduce((sum, r) => sum + pick(r), 0);
  const versus = (pick: (a: ClumpedKill['encore']) => number | null): string => {
    const d = runs.map(r => (pick(r.encore) ?? 0) - (pick(r.fixed) ?? 0));
    const sorted = [...d].sort((a, b) => a - b);
    return `Encore lower (better) in ${d.filter(x => x < -1e-9).length}, equal in ${d.filter(x => Math.abs(x) <= 1e-9).length}, higher (worse) in ${d.filter(x => x > 1e-9).length}; median difference ${median(sorted).toFixed(3)} m, worst ${sorted[sorted.length - 1].toFixed(3)} m`;
  };
  return [
    `  all five conditions: ${runs.filter(r => r.verdict.all).length} of ${runs.length} runs. Per condition: dup<=3s ${count('dupOk')}, quiet last 10 s ${count('quietOk')}, commits<=3xkills ${count('countOk')}, commits lower ${count('lowerOk')}, npwc>static ${count('npwcOk')}`,
    `  runs that miss a condition (seed:centre): ${runs.filter(r => !r.verdict.all).map(r => `${r.seed}:${r.centre}`).join(', ') || 'none'}`,
    `  final npwc Encore: min ${ends[0].toFixed(4)}, median ${median(ends).toFixed(4)}, max ${ends[ends.length - 1].toFixed(4)}; delta to static: min ${deltas[0].toFixed(4)}, median ${median(deltas).toFixed(4)}, max ${deltas[deltas.length - 1].toFixed(4)}`,
    `  label-independent shape fidelity at the end, Encore against static: sfMax ${versus(a => a.sfMaxEnd)}`,
    `  label-independent shape fidelity at the end, Encore against static: sfMean ${versus(a => a.sfMeanEnd)}`,
    `  time from the kill to the last commit, s: median ${median(lastCommit).toFixed(2)}, max ${lastCommit[lastCommit.length - 1].toFixed(2)} (the quiet condition allows 20.00)`,
    `  totals: commits ${total(r => r.commits.length)}, pops ${total(r => r.pops.length)}, duplicate-slot seconds ${total(r => r.dup.slotSeconds).toFixed(2)}, max slot changes per drone ${Math.max(...runs.map(r => r.maxPerDrone))}, slot changes in the last 10 s ${total(r => r.lateChanges.length)}, collisions after the kill ${total(r => r.collisionsAfterKill)}, near-misses after the kill ${total(r => r.nearMissesAfterKill)}`,
  ];
}

describe('beyond G1: the clumped kill on every kill centre (n0 = 40, seed 1, 20 % loss)', () => {
  const runs: ClumpedKill[] = [];

  it('runs all 40 centres; on every one: no duplicate over 3 s, commits <= 3 x kills, every commit lowers the index, npwc ends above static', () => {
    for (let centre = 0; centre < 40; centre++) runs.push(clumpedKill(1, 40, 5, centre));
    report.push(
      'Beyond G1: clumped kill on every kill centre (n0 40, seed 1, 5 kills, 20 % loss, 30 s after the kill; E = Encore, S = static):',
      KILL_HEADER, ...runs.map(killRow), ...summarise(runs),
    );
    // What happens after the 30 s window on the centres that were not quiet in time: the same run, 60 s long.
    for (const r of runs.filter(x => !x.verdict.quietOk)) {
      const long = clumpedKill(1, 40, 5, r.centre, 60);
      report.push(`  centre ${r.centre} run for 60 s: commits ${long.commits.length}, last commit ${long.lastCommitSec?.toFixed(2)} s after the kill, slot changes after that ${long.changes.filter(c => c.tick > (long.commits[long.commits.length - 1]?.tick ?? 0)).length}, slot changes in the last 30 s ${long.changes.filter(c => c.tick > long.endTick - sec(30)).length}, npwc end ${f3(long.encore.npwcEnd)}`);
    }
    for (const r of runs) {
      expectSetUp(r);
      const where = `centre ${r.centre}`;
      expect(r.verdict.dupOk, `${where}: no slot held by two live drones for more than 3 s`).toBe(true);
      expect(r.verdict.countOk, `${where}: commits <= 3 x kills`).toBe(true);
      expect(r.verdict.lowerOk, `${where}: every commit lowers the slot index`).toBe(true);
      expect(r.verdict.npwcOk, `${where}: final npwc above static`).toBe(true);
    }
  }, 600000);

  // KNOWN MISS, recorded and not hidden. Measured with paced targets (#96, main 571c8e4): 38 of the 40 centres
  // are quiet in the last 10 s; the latest last commit comes 20.20 s after the kill, 0.2 s inside the last 10 s
  // of the 30 s window. Before pacing it was 35 of 40: centres 7, 15, 21, 23 and 36, at 20.20 to 20.95 s. Cause (traced): a chain of four waves in
  // which one drone hops twice; its second hop waits tStable (6 s) + tVacant (2 s) + claimWindow (1 s) after
  // its first commit (contract section 8.5, limit 3: slow by design). Run for 60 s, each of the five is
  // quiet from that commit on. The gate (./g1.test.ts) did not draw these (seed, centre) pairs.
  // it.fails: this test passes only while the assertion fails. If the brain or the timers change so that
  // all 40 are quiet in time, it turns red: then delete `.fails` and update the numbers in the PR and docs.
  it.fails('KNOWN MISS: on every one of the 40 centres there is no commit in the last 10 s (measured: 38 of 40)', () => {
    expect(runs).toHaveLength(40);
    expect(runs.filter(r => !r.verdict.quietOk).map(r => r.centre)).toEqual([]);
  });

  // Bounds, not the exact list: ADR-002 does not promise identical floats on another host, and one
  // heartbeat phase more or less moves a commit by 0.25 s. Measured at 571c8e4: 2 centres, latest 20.20 s (before pacing: 5, 20.95 s).
  it('the miss is small: at most 8 of the 40 centres are late (measured: 2), and no chain ends later than 22 s after the kill (measured: 20.20 s)', () => {
    expect(runs).toHaveLength(40);
    expect(runs.filter(r => !r.verdict.quietOk).length).toBeLessThanOrEqual(8);
    for (const r of runs) expect(r.lastCommitSec ?? 0, `centre ${r.centre}: seconds from the kill to the last commit`).toBeLessThan(22);
  });
});

describe('beyond G1: the inline measurements agree with the observer (seed 1)', () => {
  it('npwc, pwc, coverage, shape fidelity, duplicate slots and slot changes match the observer sample at every fifth tick', () => {
    const s = killSetUp(1, 40, 5, centreFor(1, 40));
    const snaps = runArm(s, encoreBrain);
    const observer = createObserver(s.params);
    observer.registerScore(s.score);
    for (const e of s.events) observer.recordEvent(e);
    let samples = 0;
    let lastSlotChanges = 0;
    for (const snap of snaps) {
      const sample = observer.sample(snap);
      if (sample === null) continue;
      samples++;
      const mine = coverageOf(snap, s.score, s.params);
      expect(sample.alive).toBe(mine.alive);
      expect(sample.coverage).toBeCloseTo(mine.coverage, 12);
      expect(sample.pwc).toBeCloseTo(mine.pwc, 12);
      expect(sample.npwc).toBeCloseTo(mine.npwc ?? -1, 12);
      expect(sample.dupSlots).toBe(dupSlotCount(snap, 40));
      const sf = shapeFidelityOf(snap, s.score, s.params);
      expect(sample.sfMean).toBeCloseTo(sf.sfMean ?? -1, 12);
      expect(sample.sfMax).toBeCloseTo(sf.sfMax ?? -1, 12);
      lastSlotChanges = sample.slotChanges;
    }
    expect(samples).toBe(Math.floor(s.endTick / 5));
    expect(lastSlotChanges).toBe(slotChangesOf(snaps).filter(c => c.tick <= s.endTick - (s.endTick % 5)).length);
    expect(lastSlotChanges).toBeGreaterThan(0);
  }, 120000);
});

describe('beyond G1: one scaled run, n0 = 120 with makeParams(120), a regional kill of 12 (seed 1, 20 % loss)', () => {
  let setUp: KillSetUp;
  let encore: WorldSnapshot[] = [];
  let fixed: WorldSnapshot[] = [];

  // Its own test, so that vitest's reported duration of this line divided by the tick count printed
  // below is the mean wall-clock time per tick of the Encore world (snapshot copies included).
  it('TIMED: steps the Encore world to 30 s after the kill', () => {
    setUp = killSetUp(1, 120, 12, centreFor(1, 120));
    expect(setUp.params.claimGap).toBe(4);
    encore = runArm(setUp, encoreBrain);
    expect(encore).toHaveLength(setUp.endTick);
  }, 600000);

  it('TIMED: steps the static world to the same tick', () => {
    fixed = runArm(setUp, staticBrain);
    expect(fixed).toHaveLength(setUp.endTick);
  }, 600000);

  it('measures the same quantities as the G1 clumped kill, and prints them', () => {
    const r = analyseKill(setUp, encore, fixed);
    report.push(
      `Beyond G1: scaled run. Ticks per world: ${setUp.endTick} (divide the two TIMED durations above by this).`,
      ...describeKill(r), KILL_HEADER, killRow(r),
    );
    expectSetUp(r);
    // Not part of the gate. The four conditions that say "nothing went wrong" are asserted; whether the
    // chain is quiet within 20 s is printed above (measured: last commit 19.55 s after the kill).
    expect(r.verdict.dupOk, 'no slot held by two live drones for more than 3 s').toBe(true);
    expect(r.verdict.countOk, 'commits <= 3 x kills').toBe(true);
    expect(r.verdict.lowerOk, 'every commit lowers the slot index').toBe(true);
    expect(r.verdict.npwcOk, 'final npwc above static').toBe(true);
  }, 300000);
});

// Opt-in, printed only:  G1_WIDE=1 npx vitest run tests/g1/g1.beyond.test.ts -t "wide"
describe.skipIf(!process.env.G1_WIDE)('beyond G1 (opt-in, G1_WIDE=1): wide sweep, every kill centre on seeds 1 to 5', () => {
  it('runs 200 clumped kills and prints how many meet each condition', () => {
    const all: ClumpedKill[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const runs: ClumpedKill[] = [];
      for (let centre = 0; centre < 40; centre++) runs.push(clumpedKill(seed, 40, 5, centre));
      for (const r of runs) expectSetUp(r);
      report.push(`Beyond G1, wide sweep, seed ${seed}, all 40 centres:`, ...summarise(runs));
      all.push(...runs);
    }
    report.push('Beyond G1, wide sweep, seeds 1 to 5 x 40 centres:', ...summarise(all));
  }, 1800000);

  it('runs the scaled kill (n0 = 120, 12 kills, seed 1) for 60 s instead of 30 s and prints where the repair stops', () => {
    const long = clumpedKill(1, 120, 12, centreFor(1, 120), 60);
    expectSetUp(long);
    report.push(
      `Beyond G1, scaled run for 60 s: commits ${long.commits.length}, pops ${long.pops.length}, last commit ${long.lastCommitSec?.toFixed(2)} s after the kill, npwc end ${f3(long.encore.npwcEnd)} (static ${f3(long.fixed.npwcEnd)}), duplicate-slot seconds ${long.dup.slotSeconds.toFixed(2)}, slot changes in the last 10 s ${long.lateChanges.length}, slots empty at the end: ${long.emptyAtEnd.join(', ')}`,
    );
  }, 600000);
});
