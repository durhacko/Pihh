import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { DroneSnap, Formation, WorldSnapshot } from '../../src/contracts';
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
  it('does not claim perfect fidelity for an empty swarm', () => {
    const measured = measureFormation(snapshot([drone(0, 0, 0, false)]), formation, params);
    expect(measured.alive).toBe(0);
    expect(measured.coverage).toBe(0);
    expect(measured.npwc).toBe(0);
    expect(measured.sfMean).toBeNull();
    expect(measured.sfMax).toBeNull();
    expect(JSON.parse(JSON.stringify(measured))).toEqual(measured);
  });
});
