import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, EnvEvent, Score, Vec3 } from '../../src/contracts';
import { createWorld, idsInSphere, randomIds } from '../../src/sim';

const score: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const injected: Score = { version: { issuedTick: 3, origin: 1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'helix' } }] };
interface State { id: number; position: Vec3; version: Score['version'] }
function probe(accel: Vec3 = [0, 0, 0]): AgentBrain {
  return {
    kind: 'static',
    init(input: AgentInit): State { return { id: input.id, position: [0, 0, 0], version: input.score.version }; },
    step(raw: unknown, input: AgentInput): AgentOutput {
      const state = raw as State;
      state.position = [...input.pos];
      return { accel: [...accel], colour: [1, 1, 1], outbox: [{ type: 'HB', from: state.id, sentTick: input.tick, seq: input.tick, slot: state.id, heldSince: 0, version: state.version, pos: [...input.pos] }] };
    },
    belief(raw: unknown): Belief {
      const state = raw as State;
      return { slot: state.id, heldSince: 0, target: state.position, version: state.version, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] };
    },
  };
}
const plane = (tick: number, id = 'p'): EnvEvent => ({ type: 'PARTITION_ON', tick, id, point: [0, 0, 0], normal: [1, 0, 0] });
function world(events: EnvEvent[] = [], acceleration: Vec3 = [0, 0, 0], loss = 0) {
  return createWorld({ seed: 101, score, brain: probe(acceleration), params: makeParams(4, { rRadio: 100, rSense: 100, loss, latencyMin: 1, latencyMax: 1 }), events });
}

describe('fixed partition groups', () => {
  it('blocks cross-group packets even after every drone flies across the plane; off resumes links', () => {
    const instance = world([plane(1)], [4, 0, 0]);
    for (let tick = 1; tick <= 25; tick++) {
      const snapshot = instance.step();
      expect(snapshot.drones.map(d => d.partitionSide)).toEqual([0, 1, 0, 1]);
      for (const event of snapshot.radio) {
        expect(event.partitioned).toBe(2);
        expect(event.delivered).toEqual([event.from < 2 ? event.from + 2 : event.from - 2]);
        expect(event.lost).toBe(0); expect(event.jammed).toBe(0);
      }
      expect(instance.inspect(0)!.input.sensed).toHaveLength(3);
      expect(instance.inspect(0)!.input.inbox.every(m => m.from === 2)).toBe(true);
      if (tick === 25) expect(snapshot.drones.every(d => d.pos[0] > 0)).toBe(true);
    }
    instance.schedule({ type: 'PARTITION_OFF', tick: 26, id: 'p' });
    const restored = instance.step();
    expect(restored.partitions).toEqual([]);
    expect(restored.drones.every(d => d.partitionSide === null)).toBe(true);
    expect(restored.radio[0].delivered).toEqual([1, 2, 3]);
    expect(restored.radio.every(event => event.partitioned === 0)).toBe(true);
    instance.step();
    expect(instance.inspect(0)!.input.inbox.map(m => m.from)).toEqual([1, 2, 3]);
  });
  it('composes active partition restrictions independently, restoring remaining groups when one ends', () => {
    const instance = world([plane(1, 'x'), { type: 'PARTITION_ON', tick: 2, id: 'z', point: [0, 0, 0], normal: [0, 0, 1] }]);
    instance.step();
    const both = instance.step();
    expect(both.partitions.map(p => p.id)).toEqual(['x', 'z']);
    // With several partitions active, partitionSide is the group in the oldest one ('x'), not 'z' ([0, 0, 1, 1]).
    expect(both.drones.map(d => d.partitionSide)).toEqual([0, 1, 0, 1]);
    expect(both.radio.every(event => event.partitioned === 3 && event.delivered.length === 0)).toBe(true);
    instance.schedule({ type: 'PARTITION_OFF', tick: 3, id: 'z' });
    const one = instance.step();
    expect(one.drones.map(d => d.partitionSide)).toEqual([0, 1, 0, 1]);
    expect(one.radio[0].delivered).toEqual([2]);
  });
  it('does not retroactively revoke packets accepted before a partition began', () => {
    const instance = world([plane(2)]);
    expect(instance.step().radio[0].delivered).toEqual([1, 2, 3]);
    instance.step();
    expect(instance.inspect(0)!.input.inbox.map(m => m.from)).toEqual([1, 2, 3]);
    instance.step();
    expect(instance.inspect(0)!.input.inbox.map(m => m.from)).toEqual([2]);
  });
});

describe('scheduled loss, jam and injection', () => {
  it('SET_LOSS changes send-time loss at exactly its tick without cancelling packets in flight', () => {
    const instance = world([{ type: 'SET_LOSS', tick: 3, loss: 1 }, { type: 'SET_LOSS', tick: 5, loss: 0 }]);
    instance.step(); instance.step();
    const blocked = instance.step();
    expect(blocked.radio.every(event => event.lost === 3 && event.delivered.length === 0)).toBe(true);
    expect(instance.inspect(0)!.input.inbox).toHaveLength(3);
    instance.step();
    expect(instance.inspect(0)!.input.inbox).toEqual([]);
    expect(instance.step().radio[0].delivered).toEqual([1, 2, 3]);
    instance.step(); expect(instance.inspect(0)!.input.inbox).toHaveLength(3);
    expect(instance.config.params.loss).toBe(0);
  });
  it('jam wins the exclusive drop-reason count, blocks all directions and never changes sensing', () => {
    const instance = world([plane(1), { type: 'JAM_ON', tick: 1, id: 'all', centre: [0, 0, 0], radius: 100 }]);
    const snapshot = instance.step();
    for (const event of snapshot.radio) {
      expect(event.jammed).toBe(3); expect(event.partitioned).toBe(0); expect(event.lost).toBe(0); expect(event.delivered).toEqual([]);
    }
    expect(instance.inspect(0)!.input.sensed).toHaveLength(3);
    instance.schedule({ type: 'JAM_OFF', tick: 2, id: 'all' });
    expect(instance.step().radio[0].partitioned).toBe(2);
    instance.step(); expect(instance.inspect(0)!.input.inbox.map(m => m.from)).toEqual([2]);
  });
  it('injects OPERATOR score into exactly one inbox at the exact tick, never as a medium broadcast', () => {
    const instance = world([plane(1), { type: 'JAM_ON', tick: 1, id: 'all', centre: [0, 0, 0], radius: 100 }, { type: 'INJECT_SCORE', tick: 3, droneId: 1, score: injected }]);
    instance.step(); instance.step();
    const snapshot = instance.step();
    for (let id = 0; id < 4; id++) {
      const inbox = instance.inspect(id)!.input.inbox;
      if (id === 1) expect(inbox).toEqual([{ type: 'SCORE', from: OPERATOR, seq: 0, sentTick: 3, score: injected }]);
      else expect(inbox).toEqual([]);
      expect(snapshot.drones[id].belief.version).toEqual(score.version);
    }
    expect(snapshot.radio.every(event => event.from >= 0 && event.type === 'HB')).toBe(true);
    instance.step(); expect(instance.inspect(1)!.input.inbox).toEqual([]);
  });
  it('detaches injection data, sorts multiple operator inputs and drops uplinks to dead receivers', () => {
    const instance = world();
    const recipe = structuredClone(injected);
    instance.schedule({ type: 'INJECT_SCORE', tick: 1, droneId: 0, score: recipe });
    recipe.version.issuedTick = 999;
    instance.schedule({ type: 'INJECT_SCORE', tick: 1, droneId: 0, score: injected });
    instance.schedule({ type: 'KILL', tick: 1, ids: [1] });
    instance.schedule({ type: 'INJECT_SCORE', tick: 1, droneId: 1, score: injected });
    instance.step();
    const inbox = instance.inspect(0)!.input.inbox;
    expect(inbox.map(m => m.seq)).toEqual([0, 1]);
    expect(inbox[0].type === 'SCORE' && inbox[0].score.version.issuedTick).toBe(3);
    expect(instance.inspect(1)).toBeNull();
  });
  it('rejects invalid loss, empty partition normals and invalid injection targets before stepping', () => {
    const instance = world();
    expect(() => instance.schedule({ type: 'SET_LOSS', tick: 1, loss: NaN })).toThrow();
    expect(() => instance.schedule({ type: 'PARTITION_ON', tick: 1, id: 'p', point: [0, 0, 0], normal: [0, 0, 0] })).toThrow();
    expect(() => instance.schedule({ type: 'INJECT_SCORE', tick: 1, droneId: 4, score })).toThrow();
  });
});

describe('explicit shared kill selection helpers', () => {
  it('idsInSphere includes only live in-radius drones, in ascending id, without mutating snapshot', () => {
    const instance = world([{ type: 'KILL', tick: 1, ids: [1] }]);
    const snapshot = instance.step();
    snapshot.drones.reverse();
    const before = structuredClone(snapshot);
    expect(idsInSphere(snapshot, [0, 0, 0], 2)).toEqual([0, 2, 3]);
    expect(idsInSphere(snapshot, snapshot.drones[0].pos, 0)).toEqual([3]);
    expect(snapshot).toEqual(before);
    expect(() => idsInSphere(snapshot, [0, 0, 0], -1)).toThrow();
  });
  it('randomIds is deterministic, unique, stable across input ordering, and never mutates caller ids', () => {
    const ids = Array.from({ length: 100 }, (_, id) => id);
    const first = randomIds(101, ids, 10);
    expect(randomIds(101, [...ids].reverse(), 10)).toEqual(first);
    expect(randomIds(101, ids, 10)).toEqual(first);
    expect(randomIds(102, ids, 10)).not.toEqual(first);
    expect(new Set(first).size).toBe(10);
    expect(first.every(id => ids.includes(id))).toBe(true);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, id) => id));
    expect(randomIds(1, [2, 1, 2], 20)).toEqual([1, 2]);
    expect(randomIds(1, ids, 0)).toEqual([]);
    expect(() => randomIds(1, ids, -1)).toThrow();
  });
});
