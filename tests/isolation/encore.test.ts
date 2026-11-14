import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { AgentBrain, AgentInput, Score, WorldConfig, WorldSnapshot } from '../../src/contracts';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { createWorld } from '../../src/sim';

const SCORE: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [
    { startTick: 0, transitionTicks: 200, recipe: { kind: 'sphere' } },
    { startTick: 500, transitionTicks: 160, recipe: { kind: 'helix' } },
  ],
};

function worldConfig(seed = 101, n0 = 40, checked = false): WorldConfig {
  return {
    seed, params: makeParams(n0), score: structuredClone(SCORE),
    brain: checked ? inputCheckedEncore() : encoreBrain,
  };
}

function inputCheckedEncore(): AgentBrain {
  const brain: AgentBrain = encoreBrain;
  function checkFrozen(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (!Object.isFrozen(value)) throw new Error('Encore received mutable input');
    Object.values(value).forEach(checkFrozen);
  }
  function checkInput(input: AgentInput): void {
    if (Object.keys(input).sort().join(',') !== 'inbox,pos,sensed,tick,vel') {
      throw new Error('AgentInput exposes fields outside the local contract');
    }
    for (const sensed of input.sensed) {
      if (Object.keys(sensed).sort().join(',') !== 'rel,vel') throw new Error('Encore sensing exposes non-anonymous data');
    }
    checkFrozen(input);
  }
  return {
    kind: brain.kind,
    init(init) { return brain.init(init); },
    step(state, input) { checkInput(input); return brain.step(state, input); },
    belief(state) { return brain.belief(state); },
  };
}

function configCopy(config: WorldConfig): WorldConfig {
  const { brain, ...data } = config;
  return { ...structuredClone(data), brain };
}

function bodyData(snapshot: WorldSnapshot) {
  return snapshot.drones.map(({ id, alive, pos, vel, colour }) => ({ id, alive, pos, vel, colour }));
}

describe('real Encore isolation', () => {
  it('Encore T02: a distant kill cannot change local frozen inputs, output or private state over two ticks', () => {
    const config = worldConfig(101, 200, true);
    config.params = makeParams(200, { loss: 0, latencyMin: 1, latencyMax: 1 });
    const control = createWorld(config, { freezeInputs: true });
    const changed = createWorld(configCopy(config), { freezeInputs: true });
    const launch = control.step();
    expect(changed.step()).toEqual(launch);
    const observer = launch.drones[0];
    const distant = [...launch.drones].reverse().find(drone =>
      Math.hypot(...drone.pos.map((value, axis) => value - observer.pos[axis])) >
        Math.max(config.params.rRadio, 2 * config.params.rSense) + 1);
    expect(distant).toBeDefined();
    const killTick = launch.tick + 1;
    changed.schedule({ type: 'KILL', tick: killTick, ids: [distant!.id] });
    for (let offset = 0; offset < 2; offset++) {
      const clearSnapshot = control.step();
      const killedSnapshot = changed.step();
      expect(killedSnapshot.tick).toBe(killTick + offset);
      expect(clearSnapshot.drones[distant!.id].alive).toBe(true);
      expect(killedSnapshot.drones[distant!.id].alive).toBe(false);
      expect(changed.inspect(observer.id)).not.toBeNull();
      expect(changed.inspect(observer.id)).toEqual(control.inspect(observer.id));
    }
  }, 30_000);

  it('Encore T03: reversing decision order preserves snapshots and state hashes through tick 400', () => {
    const config = worldConfig();
    config.params.loss = 0.3;
    const ascending = createWorld(config, { freezeInputs: true });
    const descending = createWorld(configCopy(config), { reverseStepOrder: true, freezeInputs: true });
    for (let tick = 1; tick <= 400; tick++) {
      const first = ascending.step();
      const reversed = descending.step();
      if (tick % 100 === 0) {
        expect(reversed).toEqual(first);
        expect(descending.stateHash()).toBe(ascending.stateHash());
      }
    }
  }, 30_000);

  it('Encore T04: replaying the same seed and event script preserves checkpoints; a new seed changes real agent state', () => {
    const config = worldConfig();
    config.params.loss = 0.3;
    config.events = [
      { type: 'KILL', tick: 120, ids: [3, 14, 25] },
      { type: 'JAM_ON', tick: 180, id: 'local', centre: [0, 15, 0], radius: 8 },
      { type: 'JAM_OFF', tick: 260, id: 'local' },
    ];
    const first = createWorld(config, { freezeInputs: true });
    const replay = createWorld(configCopy(config), { freezeInputs: true });
    const otherConfig = configCopy(config);
    otherConfig.seed = 102;
    const otherSeed = createWorld(otherConfig, { freezeInputs: true });
    let changedActualState = false;
    for (let tick = 1; tick <= 400; tick++) {
      const original = first.step();
      const repeated = replay.step();
      otherSeed.step();
      if (tick % 100 === 0) {
        expect(repeated).toEqual(original);
        expect(replay.stateHash()).toBe(first.stateHash());
        const initialState = first.inspect(0)?.state;
        const changedState = otherSeed.inspect(0)?.state;
        expect(initialState).toBeDefined();
        expect(changedState).toBeDefined();
        changedActualState ||= JSON.stringify(initialState) !== JSON.stringify(changedState);
      }
    }
    expect(changedActualState, 'a changed hash seed field alone does not validate seeded real-agent state').toBe(true);
  }, 30_000);

  it('Encore T05: a no-kill full jam preserves body motion and slot ownership while blocking real radio', () => {
    const config = worldConfig();
    const clear = createWorld(config, { freezeInputs: true });
    const jamConfig = configCopy(config);
    jamConfig.events = [{ type: 'JAM_ON', tick: 1, id: 'all', centre: [0, 30, 0], radius: 1000 }];
    const jammed = createWorld(jamConfig, { freezeInputs: true });
    let blockedReceivers = 0;
    let broadcasts = 0;
    for (let tick = 1; tick <= 400; tick++) {
      const control = clear.step();
      const blocked = jammed.step();
      expect(blocked.jams).toHaveLength(1);
      // Beliefs and message traffic may differ; actual no-kill flight should not.
      expect(bodyData(blocked)).toEqual(bodyData(control));
      for (const drone of blocked.drones) expect(drone.belief.slot).toBe(drone.id);
      for (const message of blocked.radio) {
        broadcasts++;
        blockedReceivers += message.jammed;
        expect(message.delivered).toEqual([]);
      }
    }
    expect(broadcasts).toBeGreaterThan(0);
    expect(blockedReceivers).toBeGreaterThan(0);
  }, 30_000);
});
