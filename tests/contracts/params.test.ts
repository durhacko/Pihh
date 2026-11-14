// tests/contracts/params.test.ts
// Application tests for issue #12: parameter constants, makeParams, and the two fixtures.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, OPERATOR, makeParams } from '../../src/contracts';
import type { AgentInit, AgentInput, Heartbeat, Score } from '../../src/contracts';
import { dummyBrain } from '../fixtures/dummyBrain';
import { makeFakeSnapshot } from '../fixtures/fakeSnapshot';

describe('makeParams', () => {
  it('sets claimGap to 2 at n0 = 40', () => {
    const p = makeParams(40);
    expect(p.n0).toBe(40);
    expect(p.claimGap).toBe(2);
  });

  it('gives DEFAULT_PARAMS at n0 = 200', () => {
    expect(makeParams(200)).toEqual(DEFAULT_PARAMS);
    expect(DEFAULT_PARAMS.n0).toBe(200);
    expect(DEFAULT_PARAMS.claimGap).toBe(6);
    expect(DEFAULT_PARAMS.transitLanes).toBe(false);
  });

  it('returns a fresh object, so editing a result cannot change the defaults', () => {
    const p = makeParams(200);
    expect(p).not.toBe(DEFAULT_PARAMS);
    p.loss = 0.9;
    expect(DEFAULT_PARAMS.loss).toBe(0.05);
  });

  it('lets an override win, including over the computed claimGap', () => {
    const p = makeParams(40, { loss: 0.2, claimGap: 9 });
    expect(p.loss).toBe(0.2);
    expect(p.claimGap).toBe(9);
    expect(p.n0).toBe(40);
    expect(p.rRadio).toBe(DEFAULT_PARAMS.rRadio);
  });
});

describe('geometry invariants', () => {
  for (const n0 of [40, 200]) {
    it(`hold at n0 = ${n0}`, () => {
      const p = makeParams(n0);
      expect(p.dAvoid).toBeLessThan(p.slotSpacingMin);
      expect(p.rClaim).toBeLessThanOrEqual(p.rSense - p.rOcc);
    });
  }
});

describe('fixtures', () => {
  const score: Score = {
    version: { issuedTick: 0, origin: OPERATOR },
    movements: [{ startTick: 0, transitionTicks: 200, recipe: { kind: 'sphere' } }],
  };

  it('dummyBrain initialises, steps and reports a belief', () => {
    const params = makeParams(40);
    const init: AgentInit = { id: 7, n0: 40, initialSlot: 7, score, params, seed: 1234 };
    const state = dummyBrain.init(init);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);   // plain JSON

    const peerHb: Heartbeat = {
      type: 'HB', from: 2, seq: 0, sentTick: 1,
      slot: 2, heldSince: 0, version: score.version, pos: [3, 0, 0],
    };
    const tick = 7 % params.hbPeriod;                           // this drone's heartbeat tick
    const input: AgentInput = { tick, pos: [1.5, 0, 3], vel: [0, 0, 0], inbox: [peerHb], sensed: [] };
    const out = dummyBrain.step(state, input);

    expect(out.accel).toHaveLength(3);
    for (const a of out.accel) expect(Number.isFinite(a)).toBe(true);
    expect(out.accel[0]).toBe(0);
    expect(out.accel[1]).toBeGreaterThan(0);                    // climbs towards the point 20 m above launch
    expect(out.accel[2]).toBe(0);
    expect(out.colour).toHaveLength(3);
    expect(out.outbox).toHaveLength(1);
    const hb = out.outbox[0];
    expect(hb).toMatchObject({ type: 'HB', from: 7, seq: 0, sentTick: tick, slot: 7, heldSince: 0, pos: [1.5, 0, 3] });

    const off = dummyBrain.step(state, { ...input, tick: tick + 1, inbox: [] });
    expect(off.outbox).toHaveLength(0);                         // not a heartbeat tick

    const belief = dummyBrain.belief(state);
    expect(belief.slot).toBe(7);
    expect(belief.target).toEqual([1.5, 20, 3]);
    expect(belief.version).toEqual(score.version);
    expect(belief.peersKnown).toBe(1);
    expect(belief.deaf).toBe(false);
    expect(belief.claiming).toBeNull();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);   // still plain JSON after stepping
  });

  it('makeFakeSnapshot gives n0 drones, one of them dead, and real-looking radio events', () => {
    const snap = makeFakeSnapshot(0, 50);
    expect(snap.tick).toBe(0);
    expect(snap.drones).toHaveLength(50);
    snap.drones.forEach((d, i) => expect(d.id).toBe(i));
    expect(snap.drones.filter((d) => !d.alive).map((d) => d.id)).toEqual([3]);
    expect(snap.drones[3]).toMatchObject({ alive: false, diedTick: 0 });
    expect(snap.radio.length).toBeGreaterThanOrEqual(2);
    expect(snap.radio.length).toBeLessThanOrEqual(3);
    for (const r of snap.radio) {
      expect(r.tick).toBe(0);
      expect(r.from).not.toBe(3);
      expect(r.delivered).not.toContain(3);
    }
    expect(snap.jams).toEqual([]);
    expect(snap.partitions).toEqual([]);
    expect(snap.collisions).toEqual([]);
    expect(snap.nearMisses).toEqual([]);
    for (const d of snap.drones.filter((x) => x.alive)) {
      const r = Math.hypot(d.pos[0], d.pos[1] - 30, d.pos[2]);
      expect(r).toBeCloseTo(15, 9);
    }
  });

  it('makeFakeSnapshot is deterministic and moves slowly with the tick', () => {
    expect(makeFakeSnapshot(0, 50)).toEqual(makeFakeSnapshot(0, 50));
    expect(makeFakeSnapshot(17, 50)).toEqual(makeFakeSnapshot(17, 50));
    const a = makeFakeSnapshot(0, 50).drones[10];
    const b = makeFakeSnapshot(1, 50).drones[10];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    const moved = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.2);
  });
});
