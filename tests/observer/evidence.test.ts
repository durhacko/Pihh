import { describe, expect, it } from 'vitest';
import type { DroneSnap, WorldSnapshot } from '../../src/contracts';
import { TickEvidence } from '../../src/observer/evidence';

function drone(id: number, slot = id, alive = true): DroneSnap {
  return { id, alive, diedTick: alive ? null : 2, pos: [0, 0, 0], vel: [0, 0, 0], colour: [1, 0, 0], partitionSide: null,
    belief: { slot, heldSince: 0, target: [0, 30, 0], version: { issuedTick: 0, origin: -1 }, deaf: false,
      canHeal: false, claiming: null, peersKnown: 0, log: [] } };
}
function snapshot(tick: number, drones = [drone(0), drone(1)]): WorldSnapshot {
  return { tick, drones, radio: [], collisions: [], nearMisses: [], jams: [], partitions: [] };
}

describe('per-tick observer evidence', () => {
  it('counts broadcasts and contact entries once, including non-sample ticks', () => {
    const evidence = new TickEvidence();
    const first = snapshot(1);
    first.radio = [{ tick: 1, from: 0, type: 'HB', claimSlot: null, delivered: [1], lost: 2, jammed: 3, partitioned: 4 }];
    first.collisions = [[0, 1]];
    first.nearMisses = [[0, 1]];
    expect(evidence.ingest(first)).toBe(true);
    expect(evidence.ingest(first)).toBe(false);
    evidence.ingest(snapshot(2));
    expect(evidence.totals).toEqual({ msgs: { hb: 1, score: 0, delivered: 1, lost: 2, blocked: 7 }, collisions: 1, nearMisses: 1 });
  });
  it('counts real slot changes but not death, and snapshots do not alias retained evidence', () => {
    const evidence = new TickEvidence();
    evidence.ingest(snapshot(1));
    const next = snapshot(2, [drone(0, 1), drone(1, 0, false)]);
    evidence.ingest(next);
    expect(evidence.slotChanges).toEqual([{ tick: 2, id: 0 }]);
    expect(evidence.finalLive).toEqual([{ id: 0, version: '0:-1' }]);
    next.drones[0].belief.version.issuedTick = 99;
    expect(evidence.finalLive).toEqual([{ id: 0, version: '0:-1' }]);
    expect(evidence.timeline[1].versions).toEqual({ '0:-1': 1 });
  });
  it('records each observed drone/version adoption only once', () => {
    const evidence = new TickEvidence();
    evidence.ingest(snapshot(1));
    const next = snapshot(2);
    next.drones[0].belief.version = { issuedTick: 2, origin: 0 };
    evidence.ingest(next);
    evidence.ingest({ ...next, tick: 3 });
    expect(evidence.adoptions.filter(adoption => adoption.version === '2:0')).toEqual([{ tick: 2, id: 0, version: '2:0' }]);
  });
  it('rejects missing ticks and reuse after reset instead of fabricating cumulative metrics', () => {
    const evidence = new TickEvidence();
    expect(() => evidence.ingest(snapshot(2))).toThrow('every simulation tick');
    evidence.ingest(snapshot(1));
    expect(() => evidence.ingest(snapshot(0))).toThrow('new observer');
  });
});
