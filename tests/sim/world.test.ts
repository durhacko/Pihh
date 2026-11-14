import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { makeParams } from '../../src/contracts';
import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Message, Params, Score, Sensed, Vec3 } from '../../src/contracts';
import { launchPos } from '../../src/score';
import { agentSeed, createWorld } from '../../src/sim';
import { launchPosition } from '../../src/sim/math';
import { dummyBrain } from '../fixtures/dummyBrain';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
interface State { id: number; slot: number; seed: number; heard: number[]; ticks: number; position: Vec3; version: Score['version'] }
function fixture(options: { send?: boolean; accel?: (id: number, tick: number) => Vec3 } = {}): AgentBrain {
  return {
    kind: 'static',
    init(init: AgentInit): State { return { id: init.id, slot: init.initialSlot, seed: init.seed, heard: [], ticks: 0, position: [0, 0, 0], version: init.score.version }; },
    step(raw: unknown, input: AgentInput): AgentOutput {
      const state = raw as State;
      state.ticks++;
      state.position = [...input.pos];
      state.heard.push(...input.inbox.map(message => message.from));
      return {
        accel: options.accel?.(state.id, input.tick) ?? [0, 0, 0], colour: [0.1, 0.2, 0.3],
        outbox: options.send === false ? [] : [{ type: 'HB', from: state.id, seq: input.tick, sentTick: input.tick, slot: state.slot, heldSince: 0, version: state.version, pos: [...input.pos] }],
      };
    },
    belief(raw: unknown): Belief {
      const state = raw as State;
      return { slot: state.slot, heldSince: 0, target: state.position, version: state.version, deaf: false, canHeal: false, claiming: null, peersKnown: state.heard.length, log: [] };
    },
  };
}
function config(n0 = 4, overrides: Partial<Params> = {}, brain = fixture()) {
  return { seed: 101, params: makeParams(n0, overrides), score, brain };
}

describe('world tick and isolation', () => {
  it('keeps its private launch grid identical to launchPos in src/score', () => {
    // src/sim may not import src/score, so math.ts holds a copy; this pins the two together.
    for (const n0 of [40, 200]) for (let id = 0; id < n0; id++) expect(launchPosition(id, n0)).toEqual(launchPos(id, n0));
  });
  it('launches at rest on a 1.5m grid, first advances to tick 1, and clamps motion', () => {
    const world = createWorld(config(4, { aMax: 2, vMax: 1 }, fixture({ accel: () => [1000, -1000, 1000], send: false })));
    expect(world.inspect(0)).toBeNull();
    const first = world.step();
    expect(first.tick).toBe(1);
    expect(world.inspect(0)!.input.pos).toEqual(launchPosition(0, 4));
    expect(world.inspect(0)!.input.vel).toEqual([0, 0, 0]);
    expect(Math.hypot(...first.drones[0].vel)).toBeLessThanOrEqual(2 * 0.05);
    for (let tick = 0; tick < 100; tick++) for (const drone of world.step().drones) {
      expect(Math.hypot(...drone.vel)).toBeLessThanOrEqual(1 + 1e-12);
      expect(drone.pos[1]).toBeGreaterThanOrEqual(0);
    }
  });
  it('senses only in-range live neighbours and passes anonymous relative vectors', () => {
    const world = createWorld(config(9, { rSense: 1.6 }));
    world.step();
    const sensed = world.inspect(4)!.input.sensed;
    expect(sensed).toHaveLength(4);
    for (const peer of sensed) {
      expect(Object.keys(peer).sort()).toEqual(['rel', 'vel']);
      expect(Math.hypot(...peer.rel)).toBeLessThanOrEqual(1.6);
      expect(peer.vel).toEqual([0, 0, 0]);
    }
  });
  it('snapshots, inspect, config and scheduled events do not alias live state', () => {
    const world = createWorld(config());
    const snapshot = world.step();
    const baseline = world.stateHash();
    snapshot.drones[0].pos[0] = 999;
    snapshot.drones[0].belief.target[0] = 888;
    const inspection = world.inspect(0)!;
    inspection.input.pos[0] = 777;
    (inspection.state as State).slot = 123;
    inspection.output.colour[0] = 999;
    expect(world.stateHash()).toBe(baseline);
    expect(() => { world.config.params.vMax = 900; }).toThrow();
    const event = { type: 'KILL' as const, tick: 2, ids: [1] };
    world.schedule(event);
    event.ids[0] = 2;
    expect(world.step().drones.map(d => d.alive)).toEqual([true, false, true, true]);
  });
  it('deep-freezes every input when requested', () => {
    const brain = fixture();
    const step = brain.step;
    brain.step = (state, input) => {
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(input.pos)).toBe(true);
      expect(Object.isFrozen(input.sensed)).toBe(true);
      if (input.sensed.length) expect(Object.isFrozen(input.sensed[0].rel)).toBe(true);
      if (input.inbox.length) expect(Object.isFrozen(input.inbox[0])).toBe(true);
      return step(state, input);
    };
    const world = createWorld(config(4, {}, brain), { freezeInputs: true });
    world.step(); world.step(); world.step();
  });
  it('a brain mutating its own detached input cannot mutate bodies or another brain input', () => {
    const brain = fixture({ send: false });
    const normalStep = brain.step;
    brain.step = (state, input) => {
      const output = normalStep(state, input);
      input.pos[0] = 999;
      input.vel[0] = 999;
      for (const peer of input.sensed) { peer.rel[0] = 999; peer.vel[0] = 999; }
      return output;
    };
    const world = createWorld(config(4, {}, brain));
    expect(world.step().drones.map(d => d.pos)).toEqual(Array.from({ length: 4 }, (_, id) => launchPosition(id, 4)));
  });
  it('inspect().input is what the brain was given, even if the brain then mutates its input', () => {
    const given = new Map<number, AgentInput>();
    const brain = fixture();
    const normalStep = brain.step;
    brain.step = (state, input) => {
      given.set((state as State).id, structuredClone(input));
      const output = normalStep(state, input);
      input.pos[0] = 999; input.vel[0] = 999;
      for (const peer of input.sensed) { peer.rel[0] = 999; peer.vel[0] = 999; }
      (input.sensed as Sensed[]).length = 0;
      (input.inbox as Message[]).length = 0;
      return output;
    };
    const world = createWorld(config(4, { loss: 0, latencyMin: 1, latencyMax: 1 }, brain));
    world.step(); world.step();
    for (let id = 0; id < 4; id++) {
      const recorded = world.inspect(id)!.input;
      expect(recorded.inbox).toHaveLength(3);
      expect(recorded.sensed).toHaveLength(3);
      expect(recorded).toEqual(given.get(id));
    }
  });
  it('accepts a class-instance brain: stored by reference, prototype methods kept, caller object not frozen', () => {
    class Climber implements AgentBrain {
      readonly kind = 'static' as const;
      private readonly inner = fixture({ send: false, accel: () => [0, 1, 0] });
      init(init: AgentInit): unknown { return this.inner.init(init); }
      step(state: unknown, input: AgentInput): AgentOutput { return this.inner.step(state, input); }
      belief(state: unknown): Belief { return this.inner.belief(state); }
    }
    const brain = new Climber();
    const world = createWorld(config(4, {}, brain));
    expect(world.config.brain).toBe(brain);
    expect(Object.isFrozen(brain)).toBe(false);
    const snapshot = world.step();
    expect(snapshot.drones.every(d => d.vel[1] > 0)).toBe(true);
    expect(snapshot.drones.map(d => d.belief.target)).toEqual(Array.from({ length: 4 }, (_, id) => launchPosition(id, 4)));
  });
  it('rejects scheduling into the past and invalid packet-loss events', () => {
    const world = createWorld(config());
    expect(() => world.schedule({ type: 'KILL', tick: 0, ids: [] })).toThrow();
    expect(() => world.schedule({ type: 'SET_LOSS', tick: 1, loss: 1.3 })).toThrow('Invalid packet loss');
  });
});

describe('radio medium', () => {
  it('loss 0 delivers to every other in-range live receiver after exactly the configured latency', () => {
    const world = createWorld(config(4, { loss: 0, latencyMin: 2, latencyMax: 2 }));
    const first = world.step();
    expect(first.radio).toHaveLength(4);
    expect(first.radio[0].delivered).toEqual([1, 2, 3]);
    expect(world.inspect(0)!.input.inbox).toEqual([]);
    world.step();
    expect(world.inspect(0)!.input.inbox).toEqual([]);
    world.step();
    expect(world.inspect(0)!.input.inbox.map(m => [m.sentTick, m.from])).toEqual([[1, 1], [1, 2], [1, 3]]);
  });
  it('loss 1 and out-of-range links deliver nothing', () => {
    for (const overrides of [{ loss: 1 }, { loss: 0, rRadio: 0.1 }]) {
      const world = createWorld(config(4, overrides));
      for (let tick = 0; tick < 5; tick++) {
        const snap = world.step();
        expect(snap.radio.every(event => event.delivered.length === 0)).toBe(true);
        expect(world.inspect(0)!.input.inbox).toEqual([]);
      }
    }
  });
  it('draws per-receiver loss and uniform latency within 1..2 ticks', () => {
    const world = createWorld(config(20, { loss: 0.3, rRadio: 100 }));
    let delivered = 0;
    let lost = 0;
    const latencies = new Set<number>();
    for (let tick = 0; tick < 35; tick++) {
      const snap = world.step();
      for (const event of snap.radio) { delivered += event.delivered.length; lost += event.lost; }
      for (const message of world.inspect(0)!.input.inbox) latencies.add(snap.tick - message.sentTick);
    }
    expect(delivered + lost).toBeGreaterThan(10000);
    expect(delivered / (delivered + lost)).toBeGreaterThan(0.67);
    expect(delivered / (delivered + lost)).toBeLessThan(0.73);
    expect([...latencies].sort()).toEqual([1, 2]);
  });
  it('kills immediately remove sensing/transmission, but already sent messages survive sender death', () => {
    const world = createWorld(config(4, { loss: 0, latencyMin: 2, latencyMax: 2 }));
    world.step();
    world.schedule({ type: 'KILL', tick: 2, ids: [1] });
    const death = world.step();
    expect(death.drones[1].alive).toBe(false);
    expect(death.drones[1].diedTick).toBe(2);
    expect(death.radio.map(m => m.from)).not.toContain(1);
    expect(world.inspect(0)!.input.sensed).toHaveLength(2);
    const final = world.inspect(1);
    world.step();
    expect(world.inspect(0)!.input.inbox.some(m => m.from === 1)).toBe(true);
    expect(world.inspect(1)).toEqual(final);
    world.step();
    expect(world.inspect(0)!.input.inbox.some(m => m.from === 1)).toBe(false);
  });
  it('jam blocks into, out of and within a sphere; no replay of blocked messages after off', () => {
    const world = createWorld(config(4, { loss: 0, latencyMin: 1, latencyMax: 1 }));
    world.schedule({ type: 'JAM_ON', tick: 1, id: 'local', centre: launchPosition(0, 4), radius: 0.1 });
    const snap = world.step();
    expect(snap.radio[0].jammed).toBe(3);
    expect(snap.radio[1].jammed).toBe(1);
    world.schedule({ type: 'JAM_OFF', tick: 2, id: 'local' });
    expect(world.step().radio[0].delivered).toEqual([1, 2, 3]);
    expect(world.inspect(0)!.input.inbox).toHaveLength(0);
    world.step();
    expect(world.inspect(0)!.input.inbox).toHaveLength(3);
  });
  it('shared packets are deeply immutable, so one receiver cannot alter another receiver or sender', () => {
    const brain = fixture();
    const normalStep = brain.step;
    brain.step = (state, input) => {
      if (input.inbox.length) {
        const message = input.inbox[0];
        if (message.type === 'HB') {
          expect(() => { message.version = { issuedTick: 999, origin: 999 }; }).toThrow();
          expect(() => { message.pos[0] = 999; }).toThrow();
          expect(message.version).toEqual(score.version);
        }
      }
      return normalStep(state, input);
    };
    const world = createWorld(config(4, { loss: 0, latencyMin: 1, latencyMax: 1 }, brain));
    world.step(); world.step(); world.step();
  });
});

describe('replay and accounting', () => {
  it('exports exactly the seed derivation passed into each brain init', () => {
    const world = createWorld(config(4));
    world.step();
    const seeds: number[] = [];
    for (let id = 0; id < 4; id++) {
      const actual = (world.inspect(id)!.state as State).seed;
      expect(actual).toBe(agentSeed(101, id));
      expect(agentSeed(101, id)).toBe(agentSeed(101, id));
      expect(agentSeed(102, id)).not.toBe(actual);
      seeds.push(actual);
    }
    expect(new Set(seeds).size).toBe(4);
  });
  it('same seed and reversed brain order reproduce hashes at tick 400; another seed differs', () => {
    const first = createWorld(config());
    const second = createWorld(config());
    const reverse = createWorld(config(), { reverseStepOrder: true });
    const other = createWorld({ ...config(), seed: 102 });
    for (let tick = 0; tick < 400; tick++) { first.step(); second.step(); reverse.step(); other.step(); }
    expect(first.stateHash()).toBe(second.stateHash());
    expect(first.stateHash()).toBe(reverse.stateHash());
    expect(first.stateHash()).not.toBe(other.stateHash());
    expect((first.inspect(0)!.state as State).seed).not.toBe((other.inspect(0)!.state as State).seed);
  });
  it('counts one near-miss and collision on entry, then excludes dead drones', () => {
    const world = createWorld(config(2, { aMax: 20, vMax: 1 }, fixture({ send: false, accel: id => [id === 0 ? 20 : -20, 0, 0] })));
    let collisions = 0;
    let near = 0;
    for (let tick = 0; tick < 25; tick++) {
      const snap = world.step(); collisions += snap.collisions.length; near += snap.nearMisses.length;
    }
    expect(collisions).toBe(1); expect(near).toBe(1);
    world.schedule({ type: 'KILL', tick: 26, ids: [1] });
    for (let tick = 0; tick < 25; tick++) {
      const snap = world.step(); expect(snap.collisions).toEqual([]); expect(snap.nearMisses).toEqual([]);
    }
  });
  it('prints a 200-drone headless tick benchmark', () => {
    const world = createWorld(config(200, {}, dummyBrain));
    for (let tick = 0; tick < 50; tick++) world.step();
    const start = performance.now();
    for (let tick = 0; tick < 200; tick++) world.step();
    console.log(`200-drone dummyBrain (radio enabled) benchmark: ${((performance.now() - start) / 200).toFixed(3)} ms/tick`);
  }, 15_000); // Bounded headroom for CPU contention across concurrent local check runs.
});
