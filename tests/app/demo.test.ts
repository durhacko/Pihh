// tests/app/demo.test.ts
// WP-9a (#27): the scripted demo, run headless through the real controls adapter against two real worlds.
// These tests check scheduling, determinism and stop/restart only. They make no claim about repair, adoption or
// radio behaviour: both arms fly the static brain until #16 merges (see BRAIN_DEPENDENT_BEATS).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { EnvEvent, MetricsSample, WorldSnapshot } from '../../src/contracts';
import { createWorld } from '../../src/sim';
import { createActionController } from '../../src/app/actions';
import { readViewMode, resetViewMode } from '../../src/app/render/colourModes/viewMode';
import { controlContext, createWorlds, DEFAULT_N0, viewModeDisplay, type Pair, type Worlds } from '../../src/app/worlds';
import {
  BRAIN_DEPENDENT_BEATS, createDemoRunner, DEMO_BEATS, DEMO_N0, DEMO_SEED, DEMO_TICKS, dispatchTick,
  INJECT_DRONE, JAM_CENTRE, JAM_RADIUS, KILL_CENTRE, KILL_RADIUS, LEAD_TICKS,
} from '../../src/app/ui/DemoScript';

afterEach(() => resetViewMode());

/** The app's wiring, minus the DOM: same controller, same context, same display adapter. */
function rig(seed = 7) {
  const worlds = createWorlds({ seed });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); },
    display: viewModeDisplay,
  }));
  const cameras: string[] = [];
  const captions: { tick: number; caption: string }[] = [];
  const runner = createDemoRunner({
    send: intent => controller.handle(intent),
    status: () => controller.status(),
    view: () => readViewMode(),
    camera: preset => { cameras.push(preset); },
    changed: () => { if (runner.caption !== captions.at(-1)?.caption) captions.push({ tick: worlds.tick, caption: runner.caption }); },
  });
  return { worlds, controller, runner, transport, cameras, captions };
}
type Rig = ReturnType<typeof rig>;

/** Steps both worlds to `until`, polling the runner every `every` ticks (the browser hears status at ~5 Hz). */
function play(r: Rig, until: number, every = 1, watch?: (snapshots: Pair<WorldSnapshot>) => void) {
  while (r.worlds.tick < until) {
    const snapshots = r.worlds.stepBoth();
    watch?.(snapshots);
    if (r.worlds.tick % every === 0) r.runner.poll();
  }
}
function finalState(worlds: Worlds) {
  const samples = worlds.samples() as Pair<MetricsSample | null>;
  return { hashes: { encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() }, samples };
}

describe('scripted demo constants', () => {
  it('match the default roster, the preloaded score and the 90-second length', () => {
    const { worlds } = rig();
    expect(DEMO_N0).toBe(DEFAULT_N0);
    expect(DEMO_TICKS.FORMATION).toBe(worlds.score.movements[1].startTick);
    expect(DEMO_TICKS.NEW_MOVEMENT).toBe(DEMO_TICKS.INJECT + worlds.params.scoreLead);
    expect(DEMO_TICKS.END * 0.05).toBe(90);
    for (const id of BRAIN_DEPENDENT_BEATS) expect(DEMO_BEATS.map(beat => beat.id)).toContain(id);
    // Beats are sent in list order, so each must be due no earlier than the one before it.
    for (let i = 1; i < DEMO_BEATS.length; i++) expect(dispatchTick(DEMO_BEATS[i])).toBeGreaterThanOrEqual(dispatchTick(DEMO_BEATS[i - 1]));
    expect(dispatchTick(DEMO_BEATS.find(beat => beat.id === 'kill')!)).toBe(DEMO_TICKS.KILL - LEAD_TICKS);
  });
});

describe('scripted demo run', () => {
  // One full unattended run, shared by the checks below (a 200-drone, two-world, 90 s run costs ~10 s headless).
  let r: Rig;
  let first: ReturnType<typeof finalState> & { log: EnvEvent[] };
  let viewAtEnd: ReturnType<typeof readViewMode>;
  let injected: Pair<boolean> | null = null;
  const seen: Partial<Record<number, Pair<WorldSnapshot>>> = {};
  const watched = [DEMO_TICKS.KILL - 1, DEMO_TICKS.KILL, DEMO_TICKS.JAM_ON, DEMO_TICKS.JAM_OFF - 1, DEMO_TICKS.JAM_OFF];
  beforeAll(() => {
    r = rig();
    expect(r.runner.start()).toBe(true);
    play(r, DEMO_TICKS.END, 1, snapshots => {
      if (watched.includes(snapshots.encore.tick)) seen[snapshots.encore.tick] = structuredClone(snapshots);
      if (snapshots.encore.tick === DEMO_TICKS.INJECT) {
        const has = (arm: 'encore' | 'static') => r.worlds.worlds[arm].inspect(INJECT_DRONE)!.input.inbox.some(m => m.type === 'SCORE' && m.from === OPERATOR);
        injected = { encore: has('encore'), static: has('static') };
      }
    });
    first = { ...finalState(r.worlds), log: r.controller.getEventLog() };
    viewAtEnd = readViewMode();
  }, 120_000);

  it('schedules every beat as a valid EnvEvent into both worlds, on its exact tick', () => {
    expect(r.worlds.seed).toBe(DEMO_SEED);
    expect(r.runner.state).toBe('finished');
    expect(r.runner.problems).toEqual([]);
    const log = first.log;
    expect(log.map(event => [event.type, event.tick])).toEqual([
      ['KILL', DEMO_TICKS.KILL], ['JAM_ON', DEMO_TICKS.JAM_ON], ['INJECT_SCORE', DEMO_TICKS.INJECT], ['JAM_OFF', DEMO_TICKS.JAM_OFF],
    ]);
    // Valid EnvEvents: a fresh world accepts the whole log as scripted events.
    expect(() => createWorld({ seed: 1, params: makeParams(DEMO_N0), score: r.worlds.score, brain: r.worlds.worlds.static.config.brain, events: log })).not.toThrow();

    // KILL: about 10% of n0, all inside the kill sphere just before it lands, dead in both arms on its tick.
    const kill = log[0] as Extract<EnvEvent, { type: 'KILL' }>;
    expect(kill.ids.length / DEMO_N0).toBeGreaterThanOrEqual(0.08);
    expect(kill.ids.length / DEMO_N0).toBeLessThanOrEqual(0.12);
    for (const id of kill.ids) expect(Math.hypot(...seen[DEMO_TICKS.KILL - 1]!.encore.drones[id].pos.map((v, a) => v - KILL_CENTRE[a]))).toBeLessThanOrEqual(KILL_RADIUS);
    for (const arm of ['encore', 'static'] as const) {
      for (const id of kill.ids) expect(seen[DEMO_TICKS.KILL]![arm].drones[id]).toMatchObject({ alive: false, diedTick: DEMO_TICKS.KILL });
      expect(seen[DEMO_TICKS.KILL - 1]![arm].drones.every(d => d.alive)).toBe(true);
      expect(seen[DEMO_TICKS.KILL]![arm].drones.filter(d => d.alive)).toHaveLength(DEMO_N0 - kill.ids.length);
      // JAM: the fixed sphere is active in both arms from JAM_ON up to JAM_OFF.
      expect(seen[DEMO_TICKS.JAM_ON]![arm].jams).toEqual([{ id: 'operator-jam', centre: JAM_CENTRE, radius: JAM_RADIUS }]);
      expect(seen[DEMO_TICKS.JAM_OFF - 1]![arm].jams).toHaveLength(1);
      expect(seen[DEMO_TICKS.JAM_OFF]![arm].jams).toEqual([]);
    }
    // INJECT_SCORE: an OPERATOR score in the target drone's inbox in both arms on its tick; the target was alive
    // and outside the jam sphere.
    expect(injected).toEqual({ encore: true, static: true });
    const target = seen[DEMO_TICKS.JAM_OFF - 1]!.encore.drones[INJECT_DRONE];
    expect(target.alive).toBe(true);
    expect(Math.hypot(...target.pos.map((v, a) => v - JAM_CENTRE[a]))).toBeGreaterThan(JAM_RADIUS);
    // View beats went through the display intents; the run ends on the audience view with overlays off.
    expect(viewAtEnd).toMatchObject({ xray: false, beliefColours: false, selectedDroneId: INJECT_DRONE });
    expect(r.cameras).toEqual(['audience', 'audience']);
    expect(r.transport.speed).toBe(1);
  });

  it('shows each caption on its own beat tick, never early, even for events sent ahead', () => {
    const captioned = DEMO_BEATS.filter(beat => beat.caption);
    expect(r.captions.map(entry => entry.caption)).toEqual(captioned.map(beat => beat.caption));
    expect(r.captions.map(entry => entry.tick)).toEqual(captioned.map(beat => beat.tick));
  });

  it('runs twice from reset to identical state hashes, HUD samples and events, however often status arrives', () => {
    // Second run on the same controller, from the demo's own reset, hearing status only every 7 ticks.
    expect(r.runner.restart()).toBe(true);
    expect(r.worlds.tick).toBe(1);
    play(r, DEMO_TICKS.END, 7);
    r.runner.poll();   // tick 1800 is not a multiple of 7: the next status would arrive a few ticks later
    expect(r.runner.state).toBe('finished');
    expect(r.runner.problems).toEqual([]);
    expect({ ...finalState(r.worlds), log: r.controller.getEventLog() }).toEqual(first);
  }, 120_000);
});

describe('scripted demo stop and restart', () => {
  it('stop halts the script where it is; restart begins again from the demo seed', () => {
    const r = rig(55);
    r.runner.start();
    play(r, DEMO_TICKS.KILL + 20);
    const kill = r.controller.getEventLog();
    const atKill = finalState(r.worlds);
    expect(kill.map(event => event.type)).toEqual(['KILL']);
    r.runner.stop();
    expect(r.runner.state).toBe('stopped');
    play(r, DEMO_TICKS.JAM_ON + 20);
    expect(r.controller.getEventLog()).toEqual(kill);   // no jam after stop
    expect(r.worlds.tick).toBe(DEMO_TICKS.JAM_ON + 20);   // the show itself keeps running

    expect(r.runner.restart()).toBe(true);
    expect(r.runner.state).toBe('running');
    expect(r.worlds.seed).toBe(DEMO_SEED);
    expect(r.worlds.tick).toBe(1);
    expect(r.controller.getEventLog()).toEqual([]);
    play(r, DEMO_TICKS.KILL + 20);
    expect(r.controller.getEventLog()).toEqual(kill);
    expect(finalState(r.worlds)).toEqual(atKill);
  }, 120_000);

  it('a reset from outside the demo stops it', () => {
    const r = rig();
    r.runner.start();
    play(r, 100);
    r.controller.handle({ type: 'reset', seed: DEMO_SEED });
    r.runner.poll();
    expect(r.runner.state).toBe('stopped');
    expect(r.runner.caption).toMatch(/reset outside the demo/);
  });
});
