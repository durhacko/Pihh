import { describe, expect, it } from 'vitest';
import type { DroneSnap, WorldSnapshot } from '../../src/contracts';
import { interpolateDrone, SnapshotBuffer } from '../../src/app/render/SnapshotBuffer';

function drone(x: number, alive = true): DroneSnap {
  return {
    id: 0, alive, diedTick: alive ? null : 2, pos: [x, 30, 0], vel: [1, 0, 0], colour: [x / 10, 0, 1], partitionSide: null,
    belief: { slot: 0, heldSince: 0, target: [0, 30, 0], version: { issuedTick: 0, origin: -1 }, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] },
  };
}
function snapshot(tick: number, x: number, alive = true): WorldSnapshot {
  return { tick, drones: [drone(x, alive)], radio: [], jams: [], partitions: [], collisions: [], nearMisses: [] };
}

describe('SnapshotBuffer', () => {
  it('starts from one snapshot without interpolating from an invented state', () => {
    const initial = snapshot(0, 4);
    const frame = new SnapshotBuffer(initial).frame(0.5);
    expect(frame.prev).toBe(initial);
    expect(frame.curr).toBe(initial);
    expect(interpolateDrone(frame.prev.drones[0], frame.curr.drones[0], frame.alpha).pos).toEqual([4, 30, 0]);
  });
  it('interpolates position and colour while preserving current discrete fields', () => {
    const initial = snapshot(1, 0);
    const current = snapshot(2, 10, false);
    const frozen = JSON.stringify([initial, current]);
    const buffer = new SnapshotBuffer(initial);
    buffer.push(current);
    const frame = buffer.frame(0.25, 1 / 60);
    const shown = interpolateDrone(frame.prev.drones[0], frame.curr.drones[0], frame.alpha);
    expect(shown.pos).toEqual([2.5, 30, 0]);
    expect(shown.colour).toEqual([0.25, 0, 1]);
    expect(shown.alive).toBe(false);
    expect(shown.diedTick).toBe(2);
    expect(shown.belief).toBe(current.drones[0].belief);
    expect(frame.dtReal).toBe(1 / 60);
    expect(JSON.stringify([initial, current])).toBe(frozen);
  });
  it('advances previous and current once for each pushed tick', () => {
    const buffer = new SnapshotBuffer(snapshot(0, 0));
    const second = snapshot(1, 2);
    const third = snapshot(2, 4);
    buffer.push(second);
    buffer.push(third);
    expect(buffer.frame(0).prev).toBe(second);
    expect(buffer.frame(0).curr).toBe(third);
  });
  it('clamps interpolation and handles resets without flying back through old state', () => {
    const buffer = new SnapshotBuffer(snapshot(100, 10));
    const reset = snapshot(0, 0);
    buffer.push(reset);
    expect(buffer.frame(-3).alpha).toBe(0);
    expect(buffer.frame(4).alpha).toBe(1);
    expect(buffer.frame(0.5).prev).toBe(reset);
    expect(buffer.frame(0.5).curr).toBe(reset);
  });
  it('does not interpolate a new drone from a different id', () => {
    const current = { ...drone(7), id: 1 };
    expect(interpolateDrone(drone(0), current, 0.5).pos).toEqual(current.pos);
    expect(interpolateDrone(undefined, current, 0.5).pos).toEqual(current.pos);
  });
});
