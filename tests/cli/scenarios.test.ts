import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { EnvEvent, Vec3 } from '../../src/contracts';
import { composeNext, expandRecipe } from '../../src/score';
import {
  A_HOLD_READY_BY, B_HOLD_BY, buildEvalScore, buildScenario, JAM_CENTRE, JAM_RADIUS, PLANE_P,
  RECIPE_A, RECIPE_INJECT, SCENARIO_IDS, SCENARIO_TICKS, S4_PLANE_BAND,
} from '../../src/cli/scenarios';

const params = makeParams(200);
const slotsA = expandRecipe(RECIPE_A, 200, params).slots.map((s) => s.pos);

function kill(events: EnvEvent[]): Extract<EnvEvent, { type: 'KILL' }> {
  const kills = events.filter((e): e is Extract<EnvEvent, { type: 'KILL' }> => e.type === 'KILL');
  expect(kills).toHaveLength(1);
  return kills[0] as Extract<EnvEvent, { type: 'KILL' }>;
}

function expectExplicitIds(ids: number[], count: number) {
  expect(ids).toHaveLength(count);
  expect(new Set(ids).size).toBe(count);
  for (const id of ids) expect(Number.isInteger(id) && id >= 0 && id < 200).toBe(true);
  expect([...ids].sort((a, b) => a - b)).toEqual(ids);
}

function d2(a: Vec3, b: Vec3) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Independent check: is `ids` the `ids.length` slots nearest some slot c in `ids`? Returns c, or null. */
function nearestCentre(ids: number[]): number | null {
  for (const c of ids) {
    const centre = slotsA[c] as Vec3;
    const order = slotsA.map((p, i) => ({ i, d: d2(p, centre) })).sort((a, b) => a.d - b.d || a.i - b.i);
    const nearest = order.slice(0, ids.length).map((e) => e.i).sort((a, b) => a - b);
    if (JSON.stringify(nearest) === JSON.stringify(ids)) return c;
  }
  return null;
}

describe('EVAL score', () => {
  it('is version {0, OPERATOR}: ENCORE from tick -200, sphere at 900, holds inside the asserted windows', () => {
    const score = buildEvalScore(params);
    expect(score.version).toEqual({ issuedTick: 0, origin: OPERATOR });
    const [a, b] = score.movements;
    expect(a?.recipe).toEqual({ kind: 'text', text: 'ENCORE' });
    expect(a?.startTick).toBe(-200);
    expect(b?.recipe).toEqual({ kind: 'sphere' });
    expect(b?.startTick).toBe(900);
    expect((a?.startTick ?? 0) + (a?.transitionTicks ?? 0) + params.holdGrace).toBeLessThanOrEqual(A_HOLD_READY_BY);
    expect((b?.startTick ?? 0) + (b?.transitionTicks ?? 0)).toBeLessThanOrEqual(B_HOLD_BY);
  });

  it('throws a clear error when A cannot reach its hold in time', () => {
    expect(() => buildEvalScore(makeParams(200, { vMax: 0.5 }))).toThrow(/movement A's holdStart.*more negative/);
  });
});

describe('buildScenario', () => {
  it.each(SCENARIO_IDS)('%s is pure: same inputs give deep-equal plain-JSON output', (id) => {
    const a = buildScenario(id, 3, params);
    const b = buildScenario(id, 3, params);
    expect(a).toEqual(b);
    expect(a.events).not.toBe(b.events);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.ticks).toBe(SCENARIO_TICKS);
    expect(a.score).toEqual(buildEvalScore(params));
    const ticks = a.events.map((e) => e.tick);
    expect([...ticks].sort((x, y) => x - y)).toEqual(ticks);
  });

  it('S0 has no events', () => {
    expect(buildScenario('S0', 1, params).events).toEqual([]);
  });

  it('S1 kills 20 explicit random ids at 400; deterministic per seed, different across seeds', () => {
    const k = kill(buildScenario('S1', 1, params).events);
    expect(k.tick).toBe(400);
    expectExplicitIds(k.ids, 20);
    expect(kill(buildScenario('S1', 1, params).events).ids).toEqual(k.ids);
    expect(kill(buildScenario('S1', 2, params).events).ids).not.toEqual(k.ids);
  });

  it('S2 kills the 20 ids whose formation-A slots are nearest one slot, at 400', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const k = kill(buildScenario('S2', seed, params).events);
      expect(k.tick).toBe(400);
      expectExplicitIds(k.ids, 20);
      expect(nearestCentre(k.ids)).not.toBeNull();
    }
    expect(kill(buildScenario('S2', 1, params).events).ids).not.toEqual(kill(buildScenario('S2', 2, params).events).ids);
  });

  it('S3 cuts the radio with plane P, then a jam, and kills nobody', () => {
    expect(buildScenario('S3', 1, params).events).toEqual([
      { type: 'PARTITION_ON', tick: 400, id: 'P', point: [0, 30, 0], normal: [1, 0, 0] },
      { type: 'PARTITION_OFF', tick: 1000, id: 'P' },
      { type: 'JAM_ON', tick: 1300, id: 'J', centre: JAM_CENTRE, radius: JAM_RADIUS },
      { type: 'JAM_OFF', tick: 1600, id: 'J' },
    ]);
    expect(JAM_CENTRE).toEqual([0, 30, 0]);
    expect(JAM_RADIUS).toBe(12);
    expect(PLANE_P).toEqual({ point: [0, 30, 0], normal: [1, 0, 0] });
  });

  it('S4 partitions at 300, kills a regional 20 centred within 5 m of P at 400, reconnects at 700', () => {
    for (const seed of [1, 2, 3]) {
      const events = buildScenario('S4', seed, params).events;
      expect(events.map((e) => [e.type, e.tick])).toEqual([['PARTITION_ON', 300], ['KILL', 400], ['PARTITION_OFF', 700]]);
      const k = kill(events);
      expectExplicitIds(k.ids, 20);
      const c = nearestCentre(k.ids);
      expect(c).not.toBeNull();
      expect(Math.abs((slotsA[c as number] as Vec3)[0] - 0)).toBeLessThanOrEqual(S4_PLANE_BAND);
    }
  });

  it('S5 injects composeNext(EVAL, 400, BRAVO, d) into d = lowest id whose slot has x < -10', () => {
    const s = buildScenario('S5', 1, params);
    expect(s.events.map((e) => [e.type, e.tick])).toEqual([['PARTITION_ON', 300], ['INJECT_SCORE', 400], ['PARTITION_OFF', 700]]);
    const inject = s.events[1] as Extract<EnvEvent, { type: 'INJECT_SCORE' }>;
    const d = slotsA.findIndex((p) => p[0] < -10);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(inject.droneId).toBe(d);
    expect(inject.score).toEqual(composeNext(s.score, 400, RECIPE_INJECT, d, 200, params));
    expect(inject.score.movements[1]?.startTick).toBe(400 + params.scoreLead);
    expect(buildScenario('S5', 2, params).events).toEqual(s.events);   // no random draw in S5
  });

  it('keeps kills at 10% of n0 when n0 is cut', () => {
    const p100 = makeParams(100);
    expect(kill(buildScenario('S1', 1, p100).events).ids).toHaveLength(10);
    expect(kill(buildScenario('S2', 1, p100).events).ids).toHaveLength(10);
  });

  it('rejects unknown scenarios and bad seeds', () => {
    expect(() => buildScenario('S9' as never, 1, params)).toThrow(/Unknown scenario/);
    expect(() => buildScenario('S0', -1, params)).toThrow(/Seed/);
  });
});
