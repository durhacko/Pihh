import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { DroneSnap, Formation, Params, Vec3, WorldSnapshot } from '../../src/contracts';
import { createRandom } from '../../src/sim/random';
import { measureFormation } from '../../src/observer/measure';

const params = makeParams(3);
const formation: Formation = {
  slots: [0, 1, 2].map(index => ({ index, pos: [3 * index, 30, 0], colour: [1, 0, 0] })),
  dense: [[0, 30, 0], [3, 30, 0], [6, 30, 0]],
  bounds: { min: [0, 30, 0], max: [6, 30, 0] },
};
function drone(id: number, x: number, slot: number, alive = true): DroneSnap {
  return {
    id, alive, diedTick: alive ? null : 1, pos: [x, 30, 0], vel: [0, 0, 0], colour: [1, 0, 0], partitionSide: null,
    belief: { slot, heldSince: 0, target: [slot * 3, 30, 0], version: { issuedTick: 0, origin: -1 }, deaf: false,
      canHeal: false, claiming: null, peersKnown: 0, log: [] },
  };
}
function snapshot(drones: DroneSnap[]): WorldSnapshot {
  return { tick: 5, drones, radio: [], jams: [], partitions: [], collisions: [], nearMisses: [] };
}

describe('observer formation measurements', () => {
  it('uses true positions independently of claimed slot, and splits capacity/coordination loss', () => {
    const measured = measureFormation(snapshot([drone(0, 0, 0), drone(1, 3, 0), drone(2, 6, 2, false)]), formation, params);
    expect(measured.coverage).toBeCloseTo(2 / 3);
    expect(measured.pwc).toBeCloseTo(5 / 6);
    expect(measured.npwc).toBeCloseTo(1);
    expect(measured.capacityLoss).toBeCloseTo(1 / 6);
    expect(measured.coordLoss).toBeCloseTo(0);
    expect(measured.dupSlots).toBe(1);
    expect(measured.status).toEqual(['occupied', 'occupied', 'vacant']);
    expect(measured.sfMean).toBeCloseTo(1);
    expect(measured.sfMax).toBeCloseTo(3);
  });
  it('distinguishes contested, in-transit, and vacant from true occupancy', () => {
    const measured = measureFormation(snapshot([drone(0, 20, 2), drone(1, 21, 2), drone(2, 22, 1)]), formation, params);
    expect(measured.status).toEqual(['vacant', 'inTransit', 'contested']);
    expect(measured.coverage).toBe(0);
    expect(measured.npwc).toBe(0);
  });
  it('counts versions over live drones only and never mutates snapshots/formations', () => {
    const snap = snapshot([drone(0, 0, 0), drone(1, 3, 1), drone(2, 6, 2, false)]);
    snap.drones[1].belief.version = { issuedTick: 20, origin: 1 };
    const before = JSON.stringify({ snap, formation });
    const measured = measureFormation(snap, formation, params);
    expect(measured.versions).toEqual({ '0:-1': 1, '20:1': 1 });
    expect(JSON.stringify({ snap, formation })).toBe(before);
  });
  it('matches the plain all-drones scan EXACTLY (perf rewrite: drone grid + ring search), incl. the huge-box fallback', () => {
    // The pre-optimisation implementation, verbatim in its arithmetic: every slot and every dense point against every live drone.
    const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    function referenceFor(snap: WorldSnapshot, f: Formation, p: Params) {
      const live = snap.drones.filter(d => d.alive);
      const status = f.slots.map(slot => live.some(d => d2(slot.pos, d.pos) <= p.rOcc ** 2));
      let sum = 0, max = 0;
      if (live.length) for (const point of f.dense) {
        let nearest = Infinity;
        for (const d of live) nearest = Math.min(nearest, d2(point, d.pos));
        const dist = Math.sqrt(nearest);
        sum += dist;
        max = Math.max(max, dist);
      }
      return { occupied: status, sum, max };
    }
    const rng = createRandom(5);
    const rand = (spread: number, c: number) => c + (rng() - 0.5) * spread;
    for (const [n, spread, outlier] of [[40, 6, false], [200, 60, false], [200, 4, false], [120, 30, true]] as const) {
      const p = makeParams(n);
      const pts = (k: number, s: number): Vec3[] => Array.from({ length: k }, () => [rand(s, 0), rand(s, 30), rand(s, 0)] as Vec3);
      const f: Formation = {
        slots: pts(n, spread).map((pos, index) => ({ index, pos, colour: [1, 1, 1] })),
        dense: pts(600, spread * 1.2),
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      };
      const dronePos = pts(n, spread);
      // Every third drone sits ON a slot (or within rOcc of one), so 'occupied' is exercised both ways.
      for (let i = 0; i < n; i += 3) dronePos[i] = [f.slots[i].pos[0] + 0.3, f.slots[i].pos[1], f.slots[i].pos[2]];
      if (outlier) dronePos[1] = [5e6, -2e6, 3e6];   // a box too big for the flat grid: falls back to the full scan
      const snap = snapshot(dronePos.map((pos, id) => ({ ...drone(id, 0, id % n, id % 11 !== 5), pos })));
      const got = measureFormation(snap, f, p);
      const want = referenceFor(snap, f, p);
      expect(got.status.map(s => s === 'occupied'), `n ${n} spread ${spread}`).toEqual(want.occupied);
      expect(got.sfMean, `n ${n} spread ${spread}`).toBe(want.sum / f.dense.length);   // bit-identical, not toBeCloseTo
      expect(got.sfMax, `n ${n} spread ${spread}`).toBe(want.max);
    }
  });
  it('does not claim perfect fidelity for an empty swarm', () => {
    const measured = measureFormation(snapshot([drone(0, 0, 0, false)]), formation, params);
    expect(measured.alive).toBe(0);
    expect(measured.coverage).toBe(0);
    expect(measured.npwc).toBeNull();
    expect(measured.sfMean).toBeNull();
    expect(measured.sfMax).toBeNull();
    expect(JSON.parse(JSON.stringify(measured))).toEqual(measured);
  });
});
