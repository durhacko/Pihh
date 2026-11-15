// P2-WP-08: the oracle time bound tOracle (PHASE2_EVALUATION §3.2) and the world's discrete reach.
import { describe, expect, it } from 'vitest';
import { DT, makeParams } from '../../src/contracts';
import type { AgentBrain, AgentInit, AgentOutput, Belief, EnvEvent, Params, Score, Vec3, WorldSnapshot } from '../../src/contracts';
import { bestPwc, oracleRecoveryBound, reachTable, singleKillTick, tOracleForRun } from '../../src/cli/oracle';
import { expandRecipe } from '../../src/score';
import { createWorld } from '../../src/sim';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };

function driven(accel: (tick: number) => Vec3): AgentBrain {
  return {
    kind: 'static',
    init(init: AgentInit) { return { id: init.id, version: init.score.version }; },
    step(_raw: unknown, input): AgentOutput { return { accel: accel(input.tick), colour: [0, 0, 0], outbox: [] }; },
    belief(raw: unknown): Belief {
      const s = raw as { id: number; version: Score['version'] };
      return { slot: s.id, heldSince: 0, target: [0, 0, 0], version: s.version, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] };
    },
  };
}

describe('reach_d(u): the discrete reach of the world step', () => {
  it('equals one drone driven from rest at full aMax through createWorld, within 1e-9 m, u ≤ 200', () => {
    const params = makeParams(1);
    const world = createWorld({ seed: 1, params, score, brain: driven(() => [params.aMax, 0, 0]) });
    const start = world.step().drones[0]!.pos;   // tick 1 position; reach counts from here with speed after tick 1
    const table = reachTable(params.aMax * DT, 200, params);   // speed at tick 1 = aMax·DT
    for (let u = 1; u <= 200; u++) {
      const p = world.step().drones[0]!.pos;
      expect(Math.abs(Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]) - table[u]!)).toBeLessThan(1e-9);
    }
  });

  it('bounds a drone from a moving start under any bounded acceleration', () => {
    const params = makeParams(1);
    // Deterministic "random" bounded accelerations; the drone climbs first so the ground clamp never applies.
    const accel = (tick: number): Vec3 => tick <= 15 ? [0, params.aMax, 0] : [Math.cos(tick * 1.7) * params.aMax, Math.sin(tick * 0.9) * params.aMax * 0.6, Math.sin(tick * 2.3) * params.aMax * 0.6];
    const world = createWorld({ seed: 1, params, score, brain: driven(accel) });
    let snap: WorldSnapshot = world.step();
    for (let t = 1; t < 20; t++) snap = world.step();
    const x0 = snap.drones[0]!.pos;
    const v0 = Math.hypot(...snap.drones[0]!.vel);
    const table = reachTable(v0, 120, params);
    for (let u = 1; u <= 120; u++) {
      const p = world.step().drones[0]!.pos;
      expect(Math.hypot(p[0] - x0[0], p[1] - x0[1], p[2] - x0[2])).toBeLessThanOrEqual(table[u]! + 1e-9);
    }
  });
});

/** A hand-built snapshot: drone d at positions[d] (null = dead), with velocity vel[d]. */
function snapshot(tick: number, positions: (Vec3 | null)[], vel: Vec3[] = []): WorldSnapshot {
  return {
    tick,
    drones: positions.map((pos, id) => ({
      id, alive: pos !== null, diedTick: pos === null ? tick : null, pos: pos ?? [0, 0, 0], vel: vel[id] ?? [0, 0, 0], colour: [0, 0, 0],
      partitionSide: null, belief: { slot: id, heldSince: 0, target: [0, 0, 0], version: score.version, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] },
    })),
    radio: [], jams: [], partitions: [], collisions: [], nearMisses: [],
  };
}

/** The §3.2 definition, written out directly: linear scans, no shortcuts. */
function bruteForce(snap: WorldSnapshot, params: Params, horizon: number): number | null {
  const n0 = params.n0;
  const slots = expandRecipe(score.movements[0]!.recipe, n0, params).slots;
  const live = snap.drones.filter(d => d.alive);
  const w = (s: number) => (2 * (n0 - s)) / (n0 * (n0 + 1));
  const occupied = slots.map(slot => live.some(d => (d.pos[0] - slot.pos[0]) ** 2 + (d.pos[1] - slot.pos[1]) ** 2 + (d.pos[2] - slot.pos[2]) ** 2 <= params.rOcc ** 2));
  let pwc = slots.reduce((sum, slot, s) => sum + (occupied[s] ? w(slot.index) : 0), 0);
  const target = 0.95 * bestPwc(live.length, n0);
  if (pwc >= target) return 0;
  const taus: { tau: number; w: number }[] = [];
  slots.forEach((slot, s) => {
    if (occupied[s]) return;
    let best = Infinity;
    for (const d of live) {
      let reach = 0;
      const speed = Math.hypot(...d.vel);
      for (let u = 0; u <= horizon; u++) {
        if (u > 0) reach += Math.min(params.vMax, speed + u * params.aMax * DT) * DT;
        const need = Math.max(0, Math.hypot(slot.pos[0] - d.pos[0], slot.pos[1] - d.pos[1], slot.pos[2] - d.pos[2]) - params.rOcc);
        if (reach >= need) { best = Math.min(best, u); break; }
      }
    }
    taus.push({ tau: best, w: w(slot.index) });
  });
  taus.sort((a, b) => a.tau - b.tau);
  for (const t of taus) { if (t.tau === Infinity) return null; pwc += t.w; if (pwc >= target) return t.tau * DT; }
  return null;
}

describe('tOracle', () => {
  const params = makeParams(6);
  const slots = expandRecipe(score.movements[0]!.recipe, 6, params).slots;
  const at = (s: number, dx = 0): Vec3 => [slots[s]!.pos[0] + dx, slots[s]!.pos[1], slots[s]!.pos[2]];

  it('matches a brute force of the §3.2 definition on hand-built snapshots at n0 6', () => {
    const cases: [string, (Vec3 | null)[], Vec3[]][] = [
      ['two dead, others on slots 2–5, slots 0–1 empty', [null, null, at(2), at(3), at(4), at(5)], []],
      ['one dead, one drone 9 m off its slot, moving', [at(0), null, at(2, 9), at(3), at(4), at(5)], [[0, 0, 0], [0, 0, 0], [-3, 0, 0]]],
      ['one dead, everyone far away', [at(0, 20), at(1, -15), null, at(3, 30), at(4, 12), at(5, -25)], []],
    ];
    for (const [what, positions, vel] of cases) {
      const snap = snapshot(400, positions, vel);
      const got = oracleRecoveryBound(snap, score, params, 600).tOracle;
      expect(got, what).toBe(bruteForce(snap, params, 600));
      expect(got, what).not.toBeNull();
    }
  });

  it('is 0 when pwc already meets 0.95·P*(M), and null when the target is out of reach in the horizon', () => {
    expect(oracleRecoveryBound(snapshot(400, [at(0), at(1), at(2), at(3), at(4), null]), score, params, 100).tOracle).toBe(0);
    const far = snapshot(400, [[1000, 50, 0], [1000, 50, 1], null, null, null, null]);
    expect(oracleRecoveryBound(far, score, params, 40).tOracle).toBeNull();
  });

  it('is null on any run without exactly one KILL', () => {
    const snap = snapshot(400, [null, null, at(2), at(3), at(4), at(5)]);
    const one: EnvEvent[] = [{ type: 'KILL', tick: 400, ids: [0, 1] }];
    const two: EnvEvent[] = [...one, { type: 'KILL', tick: 600, ids: [2] }];
    expect(singleKillTick(one)).toBe(400);
    expect(singleKillTick(two)).toBeNull();
    expect(singleKillTick([])).toBeNull();
    expect(tOracleForRun(two, snap, score, params, 600)).toBeNull();
    expect(tOracleForRun([], snap, score, params, 600)).toBeNull();
    expect(tOracleForRun(one, snapshot(401, [null, null, at(2), at(3), at(4), at(5)]), score, params, 600)).toBeNull();   // wrong tick
    expect(tOracleForRun(one, snap, score, params, 600)?.tOracle).toBe(bruteForce(snap, params, 600));
  });
});
