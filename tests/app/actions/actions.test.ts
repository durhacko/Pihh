import { describe, expect, it, vi } from 'vitest';
import { makeParams, type Score } from '../../../src/contracts';
import { createWorld, idsInSphere } from '../../../src/sim';
import { bindControls, createActionController, type ControlContext } from '../../../src/app/actions';
import { staticBrain } from '../../../src/agent/staticBrain';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
function setup(n0 = 9) {
  const params = makeParams(n0);
  const config = (seed = 101) => ({ seed, params, score, brain: staticBrain });
  let worlds = { encore: createWorld(config()), static: createWorld(config()) };
  let snapshots = { encore: worlds.encore.step(), static: worlds.static.step() };
  const transport = { playing: true, speed: 1, seed: 101 };
  const onScheduledEvent = vi.fn();
  const context: ControlContext = {
    params, getWorlds: () => worlds, getSnapshots: () => snapshots, getScore: () => score, getTransport: () => ({ ...transport }),
    setPlaying: playing => { transport.playing = playing; }, setSpeed: speed => { transport.speed = speed; },
    reset(seed) { transport.seed = seed; worlds = { encore: createWorld(config(seed)), static: createWorld(config(seed)) }; snapshots = { encore: worlds.encore.step(), static: worlds.static.step() }; },
    onScheduledEvent,
  };
  return { context, config, transport, onScheduledEvent, getWorlds: () => worlds, getSnapshots: () => snapshots, step() { snapshots = { encore: worlds.encore.step(), static: worlds.static.step() }; return snapshots; } };
}

describe('real-world control scheduling', () => {
  it('routes a UI intent to one explicit next-tick region kill shared by both actual worlds', () => {
    const fixture = setup(); const host = new EventTarget() as HTMLElement;
    const controls = bindControls(host, fixture.context);
    controls.selectDrone(4);
    const before = fixture.getSnapshots().encore;
    const expected = idsInSphere(before, before.drones[4].pos, 1.6);
    host.dispatchEvent(new CustomEvent('encore:control', { detail: { type: 'kill-region', radius: 1.6 } }));
    expect(controls.getEventLog()).toEqual([{ type: 'KILL', tick: before.tick + 1, ids: expected }]);
    expect(fixture.onScheduledEvent).toHaveBeenCalledExactlyOnceWith(controls.getEventLog()[0]);
    expect(before.drones.every(drone => drone.alive)).toBe(true);
    const after = fixture.step();
    expect(after.encore.drones.filter(drone => !drone.alive).map(drone => drone.id)).toEqual(expected);
    expect(after.static.drones.filter(drone => !drone.alive).map(drone => drone.id)).toEqual(expected);
    controls.dispose();
  });
  it('replays the logged explicit events to the same actual stateHash in both arms', () => {
    const fixture = setup(); const controls = createActionController(fixture.context);
    controls.selectDrone(4); expect(controls.handle({ type: 'kill-region', radius: 1.6 }).ok).toBe(true);
    for (let tick = 1; tick < 40; tick++) fixture.step();
    const replay = createWorld({ ...fixture.config(), events: controls.getEventLog() });
    for (let tick = 0; tick < 40; tick++) replay.step();
    expect(replay.stateHash()).toBe(fixture.getWorlds().encore.stateHash());
    expect(replay.stateHash()).toBe(fixture.getWorlds().static.stateHash());
  });
  it('resolves random 10% once and does not let callers mutate the replay log', () => {
    const fixture = setup(40); const controls = createActionController(fixture.context);
    const result = controls.handle({ type: 'kill-random' }); expect(result.ok).toBe(true);
    const logged = controls.getEventLog()[0]; expect(logged.type).toBe('KILL');
    if (logged.type !== 'KILL') throw new Error('Expected kill');
    expect(logged.ids).toHaveLength(4); expect(new Set(logged.ids).size).toBe(4);
    logged.ids.length = 0;
    const after = fixture.step(); expect(after.encore.drones.filter(drone => !drone.alive)).toHaveLength(4);
    expect(after.encore.drones.map(drone => drone.alive)).toEqual(after.static.drones.map(drone => drone.alive));
  });
  it('rejects unconnected radio/composition controls and invalid selections without scheduling anything', () => {
    const fixture = setup(); const controls = createActionController(fixture.context);
    for (const intent of [{ type: 'jam' }, { type: 'partition' }, { type: 'inject', recipe: { kind: 'sphere' } }, { type: 'select', id: 100 }, { type: 'kill-selected' }] as const) expect(controls.handle(intent).ok).toBe(false);
    expect(controls.getEventLog()).toEqual([]); expect(fixture.onScheduledEvent).not.toHaveBeenCalled();
    expect(controls.status().radioFaults).toBe(false); expect(controls.status().composition).toBe(false);
  });
  it('validates playback inputs and delegates transport/reset without altering a brain', () => {
    const fixture = setup(); const controls = createActionController(fixture.context);
    expect(controls.handle({ type: 'play' }).ok).toBe(true); expect(fixture.transport.playing).toBe(false);
    expect(controls.handle({ type: 'speed', speed: 2 }).ok).toBe(true); expect(fixture.transport.speed).toBe(2);
    expect(controls.handle({ type: 'speed', speed: 99 }).ok).toBe(false);
    expect(controls.handle({ type: 'reset', seed: -1 }).ok).toBe(false);
    expect(controls.handle({ type: 'reset', seed: 202 }).ok).toBe(true); expect(fixture.transport.seed).toBe(202);
    expect(controls.getEventLog()).toEqual([]); expect(controls.status().selectedId).toBeNull();
  });
});
