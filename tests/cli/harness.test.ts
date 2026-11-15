// P2-WP-01: runCustom replays an established scenario exactly as runOne does.
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import { BRAINS } from '../../src/cli/brains';
import { runCustom } from '../../src/cli/harness';
import { getObserverFactory } from '../../src/cli/observer';
import { runOne } from '../../src/cli/run';
import { buildScenario, type ScenarioId } from '../../src/cli/scenarios';

const WIDE = process.env.P2_WIDE === '1';
const TIMEOUT = 60_000; // Heavy world stepping: headroom for CPU contention under parallel load.

function compare(id: ScenarioId, arm: 'encore' | 'static', seed: number, ticks: number | undefined) {
  const params = makeParams(40);
  const scenario = buildScenario(id, seed, params);
  const base = runOne({ scenario: id, seed, arm, params, brains: BRAINS, makeObserver: getObserverFactory(), ticks });
  const { record, report } = runCustom({
    label: `${id}-${arm}-s${seed}`, seed, params, score: scenario.score, events: scenario.events,
    ticks: ticks ?? scenario.ticks, arm,
  });
  expect(record.stateHash).toBe(base.stateHash);
  expect(record.summary).toEqual(base.summary);
  expect(record.series).toEqual(base.series);
  expect(record.events).toEqual(base.events);
  expect(record.paramsHash).toBe(base.paramsHash);
  expect(record.kind).toBe('p2-exploratory');
  expect(record.label).toBe(`${id}-${arm}-s${seed}`);
  expect(report).not.toBeNull();
}

describe('runCustom (P2-WP-01)', () => {
  it('equals runOne on a short S2 run (n0 40, Encore, 300 ticks): stateHash, summary and series', () => {
    compare('S2', 'encore', 101, 300);
  }, TIMEOUT);

  it('rejects a bad tick count and an unregistered arm', () => {
    const params = makeParams(40);
    const s = buildScenario('S0', 1, params);
    expect(() => runCustom({ label: 'x', seed: 1, params, score: s.score, events: s.events, ticks: -1, arm: 'encore' })).toThrow(RangeError);
    expect(() => runCustom({ label: 'x', seed: 1, params, score: s.score, events: s.events, ticks: 5, arm: 'encore' }, { brains: {} })).toThrow(/no registered brain/);
  });

  it.runIf(WIDE)('P2_WIDE: equals runOne for S0, S2 and S5 at n0 40, both arms, full length', () => {
    for (const id of ['S0', 'S2', 'S5'] as const) for (const arm of ['static', 'encore'] as const) compare(id, arm, 1, undefined);
  }, 600_000);
});
