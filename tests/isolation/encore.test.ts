import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { Score, WorldConfig, WorldSnapshot } from '../../src/contracts';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { createWorld } from '../../src/sim';

const SCORE: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [
    { startTick: 0, transitionTicks: 200, recipe: { kind: 'sphere' } },
    { startTick: 500, transitionTicks: 160, recipe: { kind: 'helix' } },
  ],
};

function worldConfig(seed = 101, n0 = 40): WorldConfig {
  return { seed, params: makeParams(n0), score: structuredClone(SCORE), brain: encoreBrain };
}

function configCopy(config: WorldConfig): WorldConfig {
  const { brain, ...data } = config;
  return { ...structuredClone(data), brain };
}

function bodyData(snapshot: WorldSnapshot) {
  return snapshot.drones.map(({ id, alive, pos, vel, colour }) => ({ id, alive, pos, vel, colour }));
}

// T02 (locality), T03 (order) and T04 (replay) run against the real Encore brain in the shared brains table in
// isolation.test.ts, with the #65 hardening. This file keeps only what is Encore-specific.
describe('real Encore isolation', () => {
  it('Encore T04: a new seed changes real Encore agent state, not only a seed field (replay itself: isolation.test.ts)', () => {
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

  it('Encore jam continuity (beyond T05, which is static-only): a no-kill full jam preserves body motion and slot ownership while blocking real radio', () => {
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
