// tests/app/demo.test.ts
// WP-9a (#27): the scripted demo, run headless over the browser's own path: the real controls binder (bindControls)
// on an event target, the demo connected to it by DOM events only (connectDemo), and status refreshed the way
// main.ts refreshes it. These tests check scheduling, determinism and stop/restart only. They make no claim about
// repair, adoption or radio behaviour: both arms fly the static brain until #16 merges (see BRAIN_DEPENDENT_BEATS).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { EnvEvent, MetricsSample, WorldSnapshot } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { createWorld, idsInSphere } from '../../src/sim';
import { bindControls } from '../../src/app/actions';
import { readViewMode, resetViewMode } from '../../src/app/render/colourModes/viewMode';
import { controlContext, createWorlds, DEFAULT_N0, viewModeDisplay, type Pair, type Worlds } from '../../src/app/worlds';
import {
  BRAIN_DEPENDENT_BEATS, connectDemo, DEMO_BEATS, DEMO_N0, DEMO_SEED, DEMO_TICKS, dispatchTick,
  INJECT_DRONE, JAM_CENTRE, JAM_RADIUS, KILL_CENTRE, KILL_RADIUS, LEAD_TICKS, type DemoBeat,
} from '../../src/app/ui/DemoScript';

afterEach(() => resetViewMode());

/** The app's wiring minus WebGL: same binder, context and display adapter; the demo talks to it by events only. */
function rig(seed = 7, beats: readonly DemoBeat[] = DEMO_BEATS) {
  const worlds = createWorlds({ seed });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const host = new EventTarget() as unknown as HTMLElement;
  const controls = bindControls(host, controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); },
    display: viewModeDisplay,
  }));
  const cameras: string[] = [];
  const captions: { tick: number; caption: string }[] = [];
  const ref: { demo?: ReturnType<typeof connectDemo> } = {};   // the first status arrives while connecting
  ref.demo = connectDemo(host, {
    camera: preset => { cameras.push(preset); },
    changed: () => { const caption = ref.demo?.runner.caption; if (caption && caption !== captions.at(-1)?.caption) captions.push({ tick: worlds.tick, caption }); },
  }, beats);
  return { worlds, controls, runner: ref.demo.runner, transport, cameras, captions };
}
type Rig = ReturnType<typeof rig>;

/** Steps both worlds to `until`; every `every` ticks the binder re-sends its status, as main.ts does at ≤ 5 Hz. */
function play(r: Rig, until: number, every = 1, watch?: (snapshots: Pair<WorldSnapshot>) => void) {
  while (r.worlds.tick < until) {
    const snapshots = r.worlds.stepBoth();
    watch?.(snapshots);
    if (r.worlds.tick % every === 0) r.controls.refresh();
  }
}
function finalState(worlds: Worlds) {
  const samples = worlds.samples() as Pair<MetricsSample | null>;
  return { hashes: { encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() }, samples };
}
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('scripted demo constants', () => {
  it('match the default roster, the preloaded score and the 90-second length', () => {
    const { worlds } = rig();
    expect(DEMO_N0).toBe(DEFAULT_N0);
    expect(DEMO_SEED).toBe(101);
    expect(DEMO_TICKS.FORMATION).toBe(worlds.score.movements[1].startTick);
    expect(DEMO_TICKS.NEW_MOVEMENT).toBe(DEMO_TICKS.INJECT + worlds.params.scoreLead);
    expect(DEMO_TICKS.END * 0.05).toBe(90);
    for (const id of BRAIN_DEPENDENT_BEATS) expect(DEMO_BEATS.map(beat => beat.id)).toContain(id);
    // Beats are sent in list order, so each must be due no earlier than the one before it.
    for (let i = 1; i < DEMO_BEATS.length; i++) expect(dispatchTick(DEMO_BEATS[i])).toBeGreaterThanOrEqual(dispatchTick(DEMO_BEATS[i - 1]));
    expect(dispatchTick(DEMO_BEATS.find(beat => beat.id === 'kill')!)).toBe(DEMO_TICKS.KILL - LEAD_TICKS);
    // The injection target sits near the bottom of the sphere and in the last letter of the text, far from the kill.
    const sphere = expandRecipe({ kind: 'sphere' }, DEMO_N0, worlds.params).slots;
    const lowest = [...sphere].sort((a, b) => a.pos[1] - b.pos[1]).slice(0, 8).map(slot => sphere.indexOf(slot));
    expect(lowest).toContain(INJECT_DRONE);
    expect(expandRecipe({ kind: 'text', text: 'ENCORE' }, DEMO_N0, worlds.params).slots[INJECT_DRONE].pos[0]).toBeGreaterThan(28);
  });
});

describe('scripted demo run', () => {
  // One full unattended run, shared by the checks below (a 200-drone, two-world, 90 s run costs ~10 s headless).
  let r: Rig;
  let first: ReturnType<typeof finalState> & { log: EnvEvent[] };
  let viewAtEnd: ReturnType<typeof readViewMode>;
  let injected: Pair<boolean> | null = null;
  let jammedAtOn = 0;
  const leadIds: number[][] = [];
  const seen: Partial<Record<number, Pair<WorldSnapshot>>> = {};
  const watched = [DEMO_TICKS.KILL - 1, DEMO_TICKS.KILL, DEMO_TICKS.JAM_ON, DEMO_TICKS.JAM_OFF - 1, DEMO_TICKS.JAM_OFF];
  beforeAll(() => {
    r = rig();
    expect(r.runner.start()).toBe(true);
    play(r, DEMO_TICKS.END, 1, snapshots => {
      const tick = snapshots.encore.tick;
      if (watched.includes(tick)) seen[tick] = structuredClone(snapshots);
      // Kill ids resolve from positions when the beat is sent, up to LEAD_TICKS early: they must not drift.
      if (tick >= DEMO_TICKS.KILL - LEAD_TICKS && tick < DEMO_TICKS.KILL) leadIds.push(idsInSphere(snapshots.encore, KILL_CENTRE, KILL_RADIUS));
      if (tick === DEMO_TICKS.JAM_ON) jammedAtOn = snapshots.encore.drones.filter(d => d.alive && dist(d.pos, JAM_CENTRE) <= JAM_RADIUS).length;
      if (tick === DEMO_TICKS.INJECT) {
        const has = (arm: 'encore' | 'static') => r.worlds.worlds[arm].inspect(INJECT_DRONE)!.input.inbox.some(m => m.type === 'SCORE' && m.from === OPERATOR);
        injected = { encore: has('encore'), static: has('static') };
      }
    });
    first = { ...finalState(r.worlds), log: r.controls.getEventLog() };
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

    // KILL: 20 drones (10% of n0), all from the first E of the text, the same ids all through the lead window,
    // dead in both arms on its tick.
    const kill = log[0] as Extract<EnvEvent, { type: 'KILL' }>;
    expect(kill.ids).toHaveLength(20);
    const text = expandRecipe({ kind: 'text', text: 'ENCORE' }, DEMO_N0, r.worlds.params).slots;
    for (const id of kill.ids) expect(text[id].pos[0]).toBeLessThan(-28);
    expect(leadIds).toHaveLength(LEAD_TICKS);
    for (const ids of leadIds) expect(ids).toEqual(kill.ids);
    for (const arm of ['encore', 'static'] as const) {
      expect(seen[DEMO_TICKS.KILL - 1]![arm].drones.every(d => d.alive)).toBe(true);
      for (const id of kill.ids) expect(seen[DEMO_TICKS.KILL]![arm].drones[id]).toMatchObject({ alive: false, diedTick: DEMO_TICKS.KILL });
      expect(seen[DEMO_TICKS.KILL]![arm].drones.filter(d => d.alive)).toHaveLength(180);
      // JAM: the fixed sphere is active in both arms from JAM_ON up to JAM_OFF.
      expect(seen[DEMO_TICKS.JAM_ON]![arm].jams).toEqual([{ id: 'operator-jam', centre: JAM_CENTRE, radius: JAM_RADIUS }]);
      expect(seen[DEMO_TICKS.JAM_OFF - 1]![arm].jams).toHaveLength(1);
      expect(seen[DEMO_TICKS.JAM_OFF]![arm].jams).toEqual([]);
    }
    // The jam covers the top cap: a minority of the swarm (18 drones with today's static brain).
    expect(jammedAtOn).toBeGreaterThan(10);
    expect(jammedAtOn).toBeLessThan(30);
    // INJECT_SCORE: an OPERATOR score in the target drone's inbox in both arms on its tick; the target was alive,
    // low in the sphere and outside the jam.
    expect(injected).toEqual({ encore: true, static: true });
    const target = seen[DEMO_TICKS.JAM_OFF - 1]!.encore.drones[INJECT_DRONE];
    expect(target.alive).toBe(true);
    expect(target.pos[1]).toBeLessThan(22);
    expect(dist(target.pos, JAM_CENTRE)).toBeGreaterThan(JAM_RADIUS);
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
    // Second run on the same controls, from the demo's own reset, hearing status only every 7 ticks.
    expect(r.runner.restart()).toBe(true);
    expect(r.worlds.tick).toBe(1);
    play(r, DEMO_TICKS.END, 7);
    r.controls.refresh();   // tick 1800 is not a multiple of 7: the next status would arrive a few ticks later
    expect(r.runner.state).toBe('finished');
    expect(r.runner.problems).toEqual([]);
    expect({ ...finalState(r.worlds), log: r.controls.getEventLog() }).toEqual(first);
  }, 120_000);
});

describe('scripted demo stop and restart', () => {
  it('stop halts the script and resets the show, so nothing it already sent ahead still lands', () => {
    const r = rig(55);
    r.runner.start();
    play(r, DEMO_TICKS.KILL - 30);   // inside the kill's lead window: the KILL for tick 400 is already scheduled
    expect(r.controls.getEventLog().map(event => [event.type, event.tick])).toEqual([['KILL', DEMO_TICKS.KILL]]);
    expect(readViewMode().xray).toBe(true);
    r.runner.stop();
    expect(r.runner.state).toBe('stopped');
    expect(r.runner.caption).toMatch(/Demo stopped/);
    expect(r.worlds.seed).toBe(DEMO_SEED);
    expect(r.worlds.tick).toBe(1);
    expect(r.controls.getEventLog()).toEqual([]);
    expect(readViewMode()).toMatchObject({ xray: false, beliefColours: false });
    play(r, DEMO_TICKS.KILL + 20);
    expect(r.worlds.latest()!.encore.drones.every(d => d.alive)).toBe(true);   // the pending KILL was discarded
    expect(r.controls.getEventLog()).toEqual([]);
    expect(r.worlds.tick).toBe(DEMO_TICKS.KILL + 20);   // the show itself keeps running
  }, 60_000);

  it('restart begins again from the demo seed with the overlays off, and reaches the same state', () => {
    const r = rig(55);
    r.runner.start();
    play(r, DEMO_TICKS.KILL + 20);
    const atKill = { ...finalState(r.worlds), log: r.controls.getEventLog() };
    expect(readViewMode().xray).toBe(true);
    expect(r.runner.restart()).toBe(true);
    expect(r.runner.state).toBe('running');
    expect(r.worlds.tick).toBe(1);
    expect(readViewMode()).toMatchObject({ xray: false, beliefColours: false });
    play(r, DEMO_TICKS.KILL + 20);
    expect({ ...finalState(r.worlds), log: r.controls.getEventLog() }).toEqual(atKill);
  }, 60_000);

  it('a reset from outside the demo stops it, even straight after start or to the same seed', () => {
    const early = rig();
    early.runner.start();
    early.controls.handle({ type: 'reset', seed: 7 });   // before any periodic status, ticks restart from 1
    play(early, 3);
    expect(early.runner.state).toBe('stopped');
    expect(early.runner.caption).toMatch(/reset outside the demo/);

    const later = rig();
    later.runner.start();
    play(later, 100);
    later.controls.handle({ type: 'reset', seed: DEMO_SEED });
    later.controls.refresh();
    expect(later.runner.state).toBe('stopped');
  });
});

describe('scripted demo problems reach the panel over the browser path', () => {
  it('a failed beat is reported, not swallowed', () => {
    // No drone is selected, so an inject beat must fail exactly as the button would.
    const r = rig(7, [{ id: 'inject', tick: 40, action: { kind: 'control', intent: { type: 'inject', recipe: { kind: 'helix' }, at: 40 } }, caption: 'x' }]);
    r.runner.start();
    play(r, 45);
    expect(r.controls.getEventLog()).toEqual([]);
    expect(r.runner.problems).toEqual(['The inject step failed: Select a live drone first.']);
  });
  it('a beat whose exact tick has passed lands next tick and marks the run off-script', () => {
    const r = rig(7, [{ id: 'kill', tick: 100, action: { kind: 'control', intent: { type: 'kill-region', centre: KILL_CENTRE, radius: KILL_RADIUS, at: 100 } }, caption: 'x' }]);
    r.runner.start();
    play(r, 120, 120);   // after start, status next arrives at tick 120: past the beat's tick
    expect(r.controls.getEventLog().map(event => [event.type, event.tick])).toEqual([['KILL', 121]]);
    expect(r.runner.problems[0]).toMatch(/off-script/);
  });
});

describe('actions hook used by the demo', () => {
  it('a jam toggle pressed while a timed JAM_ON is pending follows tick order, not log order', () => {
    const r = rig();
    expect(r.controls.handle({ type: 'jam', centre: JAM_CENTRE, radius: JAM_RADIUS, at: 60 }).event).toMatchObject({ type: 'JAM_ON', tick: 60 });
    play(r, 20);
    r.controls.handle({ type: 'select', id: 0 });
    // At tick 21 no jam is on yet, so J turns one on; it does not schedule an OFF that would land before the ON.
    expect(r.controls.handle({ type: 'jam' }).event).toMatchObject({ type: 'JAM_ON', tick: 21 });
  });
  it('rejects a non-finite or malformed region centre and a timed action in the past', () => {
    const r = rig();
    play(r, 10);
    expect(r.controls.handle({ type: 'kill-region', centre: [Number.NaN, 0, 0], radius: 5 }).ok).toBe(false);
    expect(r.controls.handle({ type: 'jam', centre: [1, 2] as unknown as [number, number, number], radius: 5 }).ok).toBe(false);
    expect(r.controls.handle({ type: 'kill-region', centre: KILL_CENTRE, radius: 5, at: 10 }).ok).toBe(false);
    expect(r.controls.getEventLog()).toEqual([]);
  });
});
