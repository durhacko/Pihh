// tests/app/wiring.test.ts
// WP-3b pass 2 (#6): the app's real ControlContext (controlContext from src/app/worlds.ts) driving the real
// controls adapter (#22) against two real worlds. Headless: no DOM, no WebGL.
import { describe, expect, it, vi } from 'vitest';
import type { AgentBrain, ScoreVersion, WorldSnapshot } from '../../src/contracts';
import { createObserver } from '../../src/observer';
import { createActionController, type ControlIntent } from '../../src/app/actions';
import { ARMS, controlContext, createWorlds, type ShellHooks, type Worlds } from '../../src/app/worlds';

function shell(worlds: Worlds, extra: Partial<ShellHooks> = {}): ShellHooks {
  const transport = { playing: true, speed: 1 };
  return {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: seed => { worlds.reset(seed); worlds.stepBoth(); },
    ...extra,
  };
}
function setup(n0 = 40, seed = 77) {
  const worlds = createWorlds({ seed, n0 });
  worlds.stepBoth();
  const controller = createActionController(controlContext(worlds, shell(worlds)));
  const ok = (intent: ControlIntent) => {
    const result = controller.handle(intent);
    expect(result.message).not.toMatch(/not connected/);
    expect(result.ok).toBe(true);
    return result;
  };
  return { worlds, controller, ok };
}

describe('radio faults through the controls adapter', () => {
  it('reports radio faults and composition as available', () => {
    const { controller } = setup();
    expect(controller.status().radioFaults).toBe(true);
    expect(controller.status().composition).toBe(true);
  });

  it('a JAM_ON scheduled through the adapter reaches both worlds, and the toggle turns it off in both', () => {
    const { worlds, ok } = setup();
    ok({ type: 'select', id: 5 });
    const on = ok({ type: 'jam', radius: 6 }).event!;
    expect(on.type).toBe('JAM_ON');
    const snaps = worlds.stepBoth();
    for (const arm of ARMS) expect(snaps[arm].jams).toEqual([{ id: 'operator-jam', centre: (on as { centre: number[] }).centre, radius: 6 }]);
    expect(ok({ type: 'jam' }).event!.type).toBe('JAM_OFF');
    const off = worlds.stepBoth();
    for (const arm of ARMS) expect(off[arm].jams).toEqual([]);
  });

  it('partition and packet loss reach both worlds', () => {
    const { worlds, ok } = setup();
    ok({ type: 'partition' });
    ok({ type: 'loss', loss: 0.5 });
    const snaps = worlds.stepBoth();
    for (const arm of ARMS) {
      expect(snaps[arm].partitions.map(p => p.id)).toEqual(['operator-partition']);
      expect(snaps[arm].drones.every(d => d.partitionSide !== null)).toBe(true);
    }
    expect(snaps.encore.drones.map(d => d.partitionSide)).toEqual(snaps.static.drones.map(d => d.partitionSide));
  });

  it('an injection into the selected drone is accepted by both worlds, which keep stepping in lockstep', () => {
    const { worlds, ok } = setup();
    ok({ type: 'select', id: 3 });
    const event = ok({ type: 'inject', recipe: { kind: 'helix' } }).event!;
    expect(event).toMatchObject({ type: 'INJECT_SCORE', tick: worlds.tick + 1, droneId: 3 });
    const snaps = worlds.stepBoth();
    expect(snaps.encore.tick).toBe(snaps.static.tick);
  });
});

/** Test-only brain: stays put and adopts any SCORE it receives, so a drone really believes an injected score. */
interface AdopterState { version: ScoreVersion }
const adopter: AgentBrain<AdopterState> = {
  kind: 'encore',
  init: init => ({ version: { ...init.score.version } }),
  step(state, input) {
    for (const message of input.inbox) if (message.type === 'SCORE') state.version = { ...message.score.version };
    return { accel: [0, 0, 0], colour: [1, 1, 1], outbox: [] };
  },
  belief: state => ({ slot: 0, heldSince: 0, target: [0, 0, 0], version: { ...state.version }, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] }),
};

describe('observers', () => {
  it('samples both worlds every fifth tick and keeps every sample', () => {
    const worlds = createWorlds({ seed: 5, n0: 40 });
    expect(worlds.samples()).toEqual({ encore: null, static: null });
    while (worlds.tick < 50) worlds.stepBoth();
    for (const arm of ARMS) {
      expect(worlds.series()[arm].map(s => s.tick)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
      expect(worlds.samples()[arm]).toEqual(worlds.series()[arm][9]);
      expect(worlds.samples()[arm]!.alive).toBe(40);
    }
  });

  it('records every adapter-scheduled event with both observers, once', () => {
    const worlds = createWorlds({ seed: 5, n0: 40 });
    worlds.stepBoth();
    const spies = ARMS.map(arm => vi.spyOn(worlds.observers[arm], 'recordEvent'));
    const controller = createActionController(controlContext(worlds, shell(worlds)));
    controller.handle({ type: 'select', id: 2 });
    const event = controller.handle({ type: 'kill-selected' }).event!;
    for (const spy of spies) expect(spy).toHaveBeenCalledExactlyOnceWith(event);
  });

  it('an injection registers its score on both observers before the injection tick, and sampling never throws across it', () => {
    const worlds = createWorlds({ seed: 9, n0: 30, brains: { encore: adopter, static: adopter } });
    const seen: WorldSnapshot[] = [worlds.stepBoth().encore];
    const controller = createActionController(controlContext(worlds, shell(worlds)));
    const registered: { arm: string; tick: number; version: ScoreVersion }[] = [];
    for (const arm of ARMS) {
      const original = worlds.observers[arm].registerScore.bind(worlds.observers[arm]);
      worlds.observers[arm].registerScore = score => { registered.push({ arm, tick: worlds.tick, version: score.version }); original(score); };
    }
    controller.handle({ type: 'select', id: 4 });
    const event = controller.handle({ type: 'inject', recipe: { kind: 'sphere' } }).event!;
    if (event.type !== 'INJECT_SCORE') throw new Error('expected an injection');
    expect(registered.map(r => r.arm).sort()).toEqual(['encore', 'static']);
    for (const r of registered) { expect(r.tick).toBeLessThan(event.tick); expect(r.version).toEqual(event.score.version); }
    while (worlds.tick < 30) seen.push(worlds.stepBoth().encore);   // throws if a believed score were unregistered
    expect(seen.at(-1)!.drones[4].belief.version).toEqual(event.score.version);
    expect(worlds.samples().encore!.versions[`${event.score.version.issuedTick}:${event.score.version.origin}`]).toBe(1);
    // Negative control: an observer that only knows the preloaded score does throw on the same snapshots.
    const bare = createObserver(worlds.params);
    bare.registerScore(worlds.score);
    expect(() => { for (const snapshot of seen) bare.sample(snapshot); }).toThrow(/Register score/);
  });

  it('a reset (through the adapter) builds fresh observers with the preloaded score registered', () => {
    const worlds = createWorlds({ seed: 5, n0: 40 });
    worlds.stepBoth();
    const before = worlds.observers;
    const controller = createActionController(controlContext(worlds, shell(worlds)));
    expect(controller.handle({ type: 'reset', seed: 6 }).ok).toBe(true);
    expect(worlds.observers.encore).not.toBe(before.encore);
    expect(worlds.observers.static).not.toBe(before.static);
    expect(worlds.series()).toEqual({ encore: [], static: [] });
    while (worlds.tick < 10) worlds.stepBoth();   // sample() throws without a registered preloaded score
    expect(worlds.series().encore.map(s => s.tick)).toEqual([5, 10]);
    expect(worlds.series().static.map(s => s.tick)).toEqual([5, 10]);
  });
});
