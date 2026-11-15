// P2-WP-08: swept closest-approach collision and near-miss accounting (PHASE2_EVALUATION §3.3).
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { AgentBrain, AgentInit, AgentOutput, Belief, Score, Vec3, WorldSnapshot } from '../../src/contracts';
import { closestApproachSquared, createSweptCounter } from '../../src/observer/swept';
import { createWorld } from '../../src/sim';
import { runCustom } from '../../src/cli/harness';
import { buildScenario } from '../../src/cli/scenarios';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };

/** A snapshot with only what the counter reads (tick, drones[].id/alive/pos). */
function snap(tick: number, positions: (Vec3 | null)[]): WorldSnapshot {
  return {
    tick,
    drones: positions.map((pos, id) => ({ id, alive: pos !== null, diedTick: null, pos: pos ?? [0, 0, 0], vel: [0, 0, 0], colour: [0, 0, 0], partitionSide: null, belief: {} as Belief })),
    radio: [], jams: [], partitions: [], collisions: [], nearMisses: [],
  };
}

/** Two scripted drones driven by a fixed acceleration (as tests/sim/world.test.ts T12). */
function scripted(accel: (id: number) => Vec3): AgentBrain {
  return {
    kind: 'static',
    init(init: AgentInit) { return { id: init.id, version: init.score.version }; },
    step(raw: unknown): AgentOutput { return { accel: accel((raw as { id: number }).id), colour: [0, 0, 0], outbox: [] }; },
    belief(raw: unknown): Belief {
      const s = raw as { id: number; version: Score['version'] };
      return { slot: s.id, heldSince: 0, target: [0, 0, 0], version: s.version, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] };
    },
  };
}

describe('closest approach', () => {
  it('finds the interior minimum and never exceeds either endpoint', () => {
    expect(closestApproachSquared([1, 0, 0], [-1, 0, 0])).toBe(0);
    expect(closestApproachSquared([1, 0.3, 0], [-1, 0.3, 0])).toBeCloseTo(0.09, 12);
    expect(closestApproachSquared([2, 0, 0], [1, 0, 0])).toBe(1);   // receding segment: the endpoint
    expect(closestApproachSquared([0.5, 0, 0], [0.5, 0, 0])).toBe(0.25);   // no relative motion
  });
});

describe('swept counter', () => {
  const params = makeParams(2);

  it('counts two drones passing through each other between tick ends (swept 1, end-of-tick 0)', () => {
    const counter = createSweptCounter(params);
    counter.ingest(snap(10, [[0, 0, 0], [0.5, 0, 0]]));          // primes (not tick 1): separation 0.5 ≥ dCollide 0.4
    const tick = counter.ingest(snap(11, [[0.5, 0, 0], [0, 0, 0]]));   // swapped: endpoints 0.5 apart, crossed at 0
    expect(tick.collisions).toEqual([[0, 1]]);
    expect(tick.nearMisses).toEqual([]);                           // already within dNear at the tick start: no new entry
    expect(counter.totals()).toEqual({ collisionsSwept: 1, nearMissesSwept: 0 });
    const far = createSweptCounter(params);
    far.ingest(snap(10, [[0, 0, 0], [1.0, 0, 0]]));
    expect(far.ingest(snap(11, [[0.6, 0, 0], [0.4, 0, 0]]))).toEqual({ tick: 11, collisions: [[0, 1]], nearMisses: [[0, 1]] });
  });

  it('T12 head-on at 2 m/s closing speed through the world: one collision and one near-miss, swept and end-of-tick', () => {
    const world = createWorld({ seed: 101, params: makeParams(2, { aMax: 20, vMax: 1 }), score, brain: scripted(id => [id === 0 ? 20 : -20, 0, 0]) });
    const counter = createSweptCounter(makeParams(2, { aMax: 20, vMax: 1 }));
    let collisions = 0;
    let near = 0;
    for (let t = 0; t < 25; t++) {
      const s = world.step();
      collisions += s.collisions.length;
      near += s.nearMisses.length;
      counter.ingest(s);
    }
    expect([collisions, near]).toEqual([1, 1]);
    expect(counter.totals()).toEqual({ collisionsSwept: 1, nearMissesSwept: 1 });
  });

  it('never counts dead drones, and refuses a gap in the ticks', () => {
    const counter = createSweptCounter(params);
    counter.ingest(snap(10, [[0, 0, 0], [0.5, 0, 0]]));
    expect(counter.ingest(snap(11, [[0.5, 0, 0], null]))).toEqual({ tick: 11, collisions: [], nearMisses: [] });
    expect(() => counter.ingest(snap(13, [[0, 0, 0], [1, 0, 0]]))).toThrow(/consecutive/);
  });

  it('is never below the end-of-tick counts on a real short run, in both arms (n0 40, S0, 300 ticks)', () => {
    const p = makeParams(40);
    const scenario = buildScenario('S0', 1, p);
    for (const arm of ['static', 'encore'] as const) {
      const counter = createSweptCounter(p);
      let ends = 0;
      let endsNear = 0;
      runCustom({ label: 'S0', seed: 1, params: p, score: scenario.score, events: scenario.events, ticks: 300, arm }, {
        invariants: false,
        onSnapshot(s) {
          const t = counter.ingest(s);
          ends += s.collisions.length;
          endsNear += s.nearMisses.length;
          // every end-of-tick entry is also a swept entry in the same tick (dmin ≤ |r1| < d)
          for (const pair of s.collisions) expect(t.collisions).toContainEqual(pair[0] < pair[1] ? pair : [pair[1], pair[0]]);
          for (const pair of s.nearMisses) expect(t.nearMisses).toContainEqual(pair[0] < pair[1] ? pair : [pair[1], pair[0]]);
        },
      });
      const totals = counter.totals();
      expect(totals.collisionsSwept).toBeGreaterThanOrEqual(ends);
      expect(totals.nearMissesSwept).toBeGreaterThanOrEqual(endsNear);
    }
  }, 60_000);
});
