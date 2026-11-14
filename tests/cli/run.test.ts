import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { EnvEvent, MetricsSample, Observer, Score, WorldSnapshot } from '../../src/contracts';
import { staticBrain } from '../../src/agent/staticBrain';
import { BRAINS, brainFor } from '../../src/cli/brains';
import { getObserverFactory } from '../../src/cli/observer';
import { ARRIVAL_MIN, canonicalJson, onSlotFraction, paramsHash, runOne } from '../../src/cli/run';
import { buildEvalScore, buildScenario } from '../../src/cli/scenarios';
import { createWorld } from '../../src/sim';

interface StubLog { scores: Score[]; events: EnvEvent[]; ticks: number[] }

/** Implements Observer and records every call; returns a minimal sample every 5 ticks. */
function stubObserver(log: StubLog): Observer {
  return {
    registerScore(score) { log.scores.push(structuredClone(score)); },
    recordEvent(event) { log.events.push(structuredClone(event)); },
    sample(snapshot: WorldSnapshot): MetricsSample | null {
      log.ticks.push(snapshot.tick);
      if (snapshot.tick % 5 !== 0) return null;
      const alive = snapshot.drones.filter((d) => d.alive).length;
      return {
        tick: snapshot.tick, alive, coverage: 0, pwc: 0, npwc: null, sfMean: null, sfMax: null, dupSlots: 0, versions: {},
        msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0,
      };
    },
    slotStatus() { throw new Error('not used by the runner'); },
    summary() { return { stubTicks: log.ticks.length }; },
  };
}

function newLog(): StubLog {
  return { scores: [], events: [], ticks: [] };
}

/** These tests step a 200-drone world for 400-1400 ticks; under the parallel full suite that exceeds the 5 s default. */
const SIM_TIMEOUT = 30_000;

describe('runOne', () => {
  it('produces a replayable RunRecord: equal stateHash and summary on a second run, events equal to the scenario', () => {
    const logA = newLog();
    const logB = newLog();
    const a = runOne({ scenario: 'S2', seed: 1, arm: 'static', n0: 200, brains: BRAINS, makeObserver: () => stubObserver(logA), git: 'test', ticks: 450 });
    const b = runOne({ scenario: 'S2', seed: 1, arm: 'static', n0: 200, brains: BRAINS, makeObserver: () => stubObserver(logB), git: 'test', ticks: 450 });
    expect(a.stateHash).toBe(b.stateHash);
    expect(a).toEqual(b);
    expect(a.v).toBe(1);
    expect(a.events).toEqual(buildScenario('S2', 1, makeParams(200)).events);
    expect(a.paramsHash).toBe(paramsHash(makeParams(200)));
    expect(a.series.map((s) => s.tick)).toEqual(Array.from({ length: 90 }, (_, i) => (i + 1) * 5));
    expect(a.series.at(-1)?.alive).toBe(180);   // 20 killed at tick 400
    expect(logA.ticks).toHaveLength(450);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    const c = runOne({ scenario: 'S2', seed: 2, arm: 'static', n0: 200, brains: BRAINS, makeObserver: () => stubObserver(newLog()), ticks: 450 });
    expect(c.stateHash).not.toBe(a.stateHash);
  }, SIM_TIMEOUT);

  it('calls recordEvent once per scripted event and registerScore for the preloaded and the injected score', () => {
    const log = newLog();
    const scenario = buildScenario('S5', 1, makeParams(200));
    runOne({ scenario: 'S5', seed: 1, arm: 'static', n0: 200, brains: BRAINS, makeObserver: () => stubObserver(log), ticks: 10 });
    expect(log.events).toEqual(scenario.events);
    const inject = scenario.events.find((e) => e.type === 'INJECT_SCORE') as Extract<EnvEvent, { type: 'INJECT_SCORE' }>;
    expect(log.scores).toEqual([scenario.score, inject.score]);
  });

  it('gives both arms deep-equal events; only the brain differs', () => {
    // A stand-in "encore" arm that flies like static: same everything else, so the runs must match exactly.
    const brains = { static: staticBrain, encore: { ...staticBrain, kind: 'encore' as const } };
    const s = runOne({ scenario: 'S1', seed: 4, arm: 'static', n0: 200, brains, makeObserver: () => stubObserver(newLog()), ticks: 420 });
    const e = runOne({ scenario: 'S1', seed: 4, arm: 'encore', n0: 200, brains, makeObserver: () => stubObserver(newLog()), ticks: 420 });
    expect(e.events).toEqual(s.events);
    expect(e.paramsHash).toBe(s.paramsHash);
    expect(e.stateHash).toBe(s.stateHash);
    expect(e.arm).toBe('encore');
  }, SIM_TIMEOUT);

  it('guards physical arrival: static drones are on their slots at the first KILL, and a slow swarm fails loudly', () => {
    const params = makeParams(200);
    const world = createWorld({ seed: 1, params, brain: staticBrain, score: buildEvalScore(params) });
    let snap = world.step();
    expect(onSlotFraction(snap, buildEvalScore(params), params)).toBeLessThan(0.05);   // tick 1: still on the launch grid
    while (snap.tick < 400) snap = world.step();
    expect(onSlotFraction(snap, buildEvalScore(params), params)).toBeGreaterThanOrEqual(ARRIVAL_MIN);
    // aMax does not enter the authoring formula, so the score still builds, but the drones arrive too late.
    const slow = makeParams(200, { aMax: 0.2 });
    expect(() => runOne({ scenario: 'S1', seed: 1, arm: 'static', params: slow, brains: BRAINS, makeObserver: () => stubObserver(newLog()), ticks: 400 }))
      .toThrow(/first KILL \(tick 400\).*within rOcc/);
    // S0 has no KILL, so the guard does not apply.
    expect(() => runOne({ scenario: 'S0', seed: 1, arm: 'static', params: slow, brains: BRAINS, makeObserver: () => stubObserver(newLog()), ticks: 400 }))
      .not.toThrow();
  }, SIM_TIMEOUT);

  it('works with the real observer', () => {
    const r = runOne({ scenario: 'S0', seed: 1, arm: 'static', n0: 200, brains: BRAINS, makeObserver: getObserverFactory(), ticks: 100 });
    expect(r.series).toHaveLength(20);
    expect(r.series[0]?.alive).toBe(200);
    expect(Object.keys(r.summary).length).toBeGreaterThan(0);
  });

  it('fails clearly for an arm with no brain, and for mismatched n0', () => {
    expect(() => brainFor({ static: staticBrain }, 'encore')).toThrow(/#16.*src\/cli\/brains\.ts/);
    expect(() => runOne({ scenario: 'S0', seed: 1, arm: 'encore', brains: { static: staticBrain }, makeObserver: () => stubObserver(newLog()), ticks: 1 }))
      .toThrow(/no registered brain/);
    expect(() => runOne({ scenario: 'S0', seed: 1, arm: 'static', n0: 100, params: makeParams(200), brains: BRAINS, makeObserver: () => stubObserver(newLog()), ticks: 1 }))
      .toThrow(/does not match/);
  });
});

describe('paramsHash', () => {
  it('hashes canonical JSON: key order does not matter, values do', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    const p = makeParams(200);
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as typeof p;
    expect(paramsHash(reordered)).toBe(paramsHash(p));
    expect(paramsHash(makeParams(200, { loss: 0.1 }))).not.toBe(paramsHash(p));
    expect(paramsHash(p)).toMatch(/^[0-9a-f]{64}$/);
  });
});
