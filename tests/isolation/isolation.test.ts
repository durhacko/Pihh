import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { AgentBrain, AgentInput, Score, World, WorldConfig, WorldSnapshot } from '../../src/contracts';
import { createWorld } from '../../src/sim';
import { staticBrain } from '../../src/agent/staticBrain';
import { probeBrain } from './probeBrain';

const SCORE: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [
    { startTick: 0, transitionTicks: 160, recipe: { kind: 'sphere' } },
    { startTick: 220, transitionTicks: 120, recipe: { kind: 'helix' } },
  ],
};

function config(brain: AgentBrain, seed = 101, n0 = 40): WorldConfig {
  return { seed, params: makeParams(n0), score: structuredClone(SCORE), brain };
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (!Object.isFrozen(value)) throw new Error('World supplied a mutable input object');
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function assertLocalInput(input: AgentInput): void {
  if (Object.keys(input).sort().join('|') !== 'inbox|pos|sensed|tick|vel') {
    throw new Error('AgentInput exposes fields outside the local contract');
  }
  for (const sensed of input.sensed) {
    if (Object.keys(sensed).sort().join('|') !== 'rel|vel' || sensed.rel.length !== 3 || sensed.vel.length !== 3) {
      throw new Error('Sensed neighbour contains an identity or malformed vector');
    }
  }
  assertDeepFrozen(input);
}

/** Instrument the public input boundary without altering a production brain's decisions. */
function checkedBrain<S>(brain: AgentBrain<S>): AgentBrain<S> {
  return {
    kind: brain.kind,
    init(init) { return brain.init(init); },
    step(state, input) {
      assertLocalInput(input);
      return brain.step(state, input);
    },
    belief(state) { return brain.belief(state); },
  };
}

function advance(world: World, ticks: number): WorldSnapshot {
  let snapshot: WorldSnapshot | undefined;
  for (let tick = 0; tick < ticks; tick++) snapshot = world.step();
  if (!snapshot) throw new Error('advance requires at least one tick');
  return snapshot;
}

const brains: [string, AgentBrain][] = [
  ['radio probe', probeBrain],
  ['real static baseline', staticBrain],
];

describe.each(brains)('%s isolation and replay', (_name, brain) => {
  it('T02: a kill outside radio and sensing range cannot change a local decision at that tick or the next', () => {
    const base = config(checkedBrain(brain), 101, 200);
    base.params = makeParams(200, { loss: 0, latencyMin: 1, latencyMax: 1 });
    const control = createWorld(base, { freezeInputs: true });
    const killed = createWorld(structuredCloneConfig(base), { freezeInputs: true });
    const before = control.step();
    expect(killed.step()).toEqual(before);
    const observer = before.drones[0];
    const distant = [...before.drones].reverse().find(drone => drone.alive &&
      Math.hypot(...drone.pos.map((component, index) => component - observer.pos[index])) >
        // Also exclude a two-hop sensing path over this two-tick assertion window.
        Math.max(base.params.rRadio, 2 * base.params.rSense) + 1);
    expect(distant, 'scenario must contain a genuinely out-of-range drone').toBeDefined();
    const killTick = before.tick + 1;
    killed.schedule({ type: 'KILL', tick: killTick, ids: [distant!.id] });
    for (let offset = 0; offset < 2; offset++) {
      const intactSnapshot = control.step();
      const killedSnapshot = killed.step();
      expect(killedSnapshot.tick).toBe(killTick + offset);
      expect(intactSnapshot.drones[distant!.id].alive).toBe(true);
      expect(killedSnapshot.drones[distant!.id].alive).toBe(false);
      expect(control.inspect(observer.id)).not.toBeNull();
      expect(killed.inspect(observer.id)).toEqual(control.inspect(observer.id));
    }
  });

  it('T03: reversing decision order preserves snapshots and stateHash through tick 400', () => {
    const base = config(brain);
    base.params.loss = 0.3;
    const ascending = createWorld(base, { freezeInputs: true });
    const descending = createWorld(structuredCloneConfig(base), { reverseStepOrder: true, freezeInputs: true });
    for (let tick = 1; tick <= 400; tick++) {
      const first = ascending.step();
      const second = descending.step();
      if (tick % 100 === 0) {
        expect(second).toEqual(first);
        expect(descending.stateHash()).toBe(ascending.stateHash());
      }
    }
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.

  it('T04: replaying the same seed and event script preserves hashes at every checkpoint', () => {
    const base = config(brain);
    base.params.loss = 0.3;
    base.events = [
      { type: 'KILL', tick: 120, ids: [3, 14, 25] },
      { type: 'JAM_ON', tick: 180, id: 'local', centre: [0, 15, 0], radius: 8 },
      { type: 'JAM_OFF', tick: 260, id: 'local' },
    ];
    const first = createWorld(base, { freezeInputs: true });
    const replay = createWorld(structuredCloneConfig(base), { freezeInputs: true });
    for (let checkpoint = 100; checkpoint <= 400; checkpoint += 100) {
      expect(advance(replay, 100)).toEqual(advance(first, 100));
      expect(replay.stateHash(), `checkpoint ${checkpoint}`).toBe(first.stateHash());
    }
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
});

function structuredCloneConfig(base: WorldConfig): WorldConfig {
  return {
    ...structuredClone({ seed: base.seed, params: base.params, score: base.score, events: base.events }),
    brain: base.brain,
  };
}

it('T04: changing the run seed changes a seeded radio-active run', () => {
  const first = createWorld(config(probeBrain, 101));
  const second = createWorld(config(probeBrain, 102));
  const firstSnapshot = advance(first, 400);
  const secondSnapshot = advance(second, 400);
  // Different seed metadata alone is insufficient: actual brain behavior must differ.
  expect(secondSnapshot.drones).not.toEqual(firstSnapshot.drones);
  expect(second.stateHash()).not.toBe(first.stateHash());
}, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.

it('T05: a full-show jam leaves the real static baseline bodies and private state unchanged', () => {
  const base = config(staticBrain);
  const clear = createWorld(base, { freezeInputs: true });
  const jamConfig = structuredCloneConfig(base);
  jamConfig.events = [{ type: 'JAM_ON', tick: 1, id: 'all', centre: [0, 30, 0], radius: 1000 }];
  const jammed = createWorld(jamConfig, { freezeInputs: true });
  for (let tick = 1; tick <= 400; tick++) {
    const control = clear.step();
    const underJam = jammed.step();
    expect(underJam.jams).toHaveLength(1);
    expect(underJam.drones).toEqual(control.drones);
    expect(underJam.radio).toEqual([]);
    if (tick % 100 === 0) expect(jammed.stateHash()).toBe(clear.stateHash());
  }
}, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
