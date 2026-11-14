// tests/app/wiring.test.ts
// WP-3b pass 2 (#6): the app's real ControlContext (controlContext from src/app/worlds.ts) driving the real
// controls adapter (#22) against two real worlds. Headless: no DOM, no WebGL.
import { describe, expect, it } from 'vitest';
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
