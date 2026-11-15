// tests/app/demo.test.ts
// WP-9a (#27): the scripted demo, run headless over the browser's own path: the real controls binder (bindControls)
// on an event target, the demo connected to it by DOM events only (connectDemo), and status refreshed the way
// main.ts refreshes it. These tests check scheduling, determinism and stop/restart, plus one measured timing: the
// repair caption lands between the Encore arm's first claim and its first slot commit. Other repair, adoption and
// radio behaviour (see BRAIN_DEPENDENT_BEATS) is not asserted here.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { EnvEvent, MetricsSample, WorldSnapshot } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { createWorld, idsInSphere } from '../../src/sim';
import { bindControls } from '../../src/app/actions';
import { readViewMode, resetViewMode } from '../../src/app/render/colourModes/viewMode';
import { controlContext, createWorlds, DEFAULT_N0, viewModeDisplay, type Pair, type ShellHooks, type Worlds } from '../../src/app/worlds';
import { createSelectionArm } from '../../src/app/ui/popovers';
import {
  BRAIN_DEPENDENT_BEATS, brainNote, connectDemo, DEMO_BEATS, DEMO_N0, DEMO_SEED, DEMO_TICKS, demoViewAt, dispatchTick,
  INJECT_DRONE, JAM_CENTRE, JAM_RADIUS, KILL_CENTRE, KILL_RADIUS, LEAD_TICKS, type DemoBeat,
} from '../../src/app/ui/DemoScript';

afterEach(() => resetViewMode());

/** The app's wiring minus WebGL: same binder, context and display adapter; the demo talks to it by events only. */
function rig(seed = 7, beats: readonly DemoBeat[] = DEMO_BEATS, shell: Partial<ShellHooks> = {}) {
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
    ...shell,
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

  it('the repair beat turns X-ray off so the hole and its refill show; the jam turns it back on (#134)', () => {
    expect(DEMO_TICKS.REPAIR).toBe(460);   // measured: first claim 455, first commit 475, first hole slot filled 495
    expect(DEMO_BEATS.find(beat => beat.id === 'repair')).toMatchObject({ tick: DEMO_TICKS.REPAIR, action: { kind: 'view', xray: false, beliefColours: false } });
    expect(demoViewAt(DEMO_TICKS.XRAY - 1)).toEqual({ xray: false, beliefColours: false });
    expect(demoViewAt(DEMO_TICKS.KILL)).toEqual({ xray: true, beliefColours: false });
    for (const tick of [DEMO_TICKS.REPAIR, DEMO_TICKS.FORMATION, DEMO_TICKS.JAM_ON - 1]) expect(demoViewAt(tick)).toEqual({ xray: false, beliefColours: false });
    expect(demoViewAt(DEMO_TICKS.JAM_ON)).toEqual({ xray: true, beliefColours: true });
    expect(demoViewAt(DEMO_TICKS.FINAL)).toEqual({ xray: false, beliefColours: false });
    // The stop and restart tests below read X-ray on at KILL - 30 and KILL + 20: both before the repair beat.
    expect(DEMO_TICKS.REPAIR).toBeGreaterThan(DEMO_TICKS.KILL + 20);
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
  const xrayChanges: [number, boolean][] = [];
  const firstClaim: Pair<number | null> = { encore: null, static: null };
  const firstCommit: Pair<number | null> = { encore: null, static: null };
  let previous: Pair<WorldSnapshot> | null = null;
  const selectedAt: Record<string, number | null> = {};
  const watched = [DEMO_TICKS.KILL - 1, DEMO_TICKS.KILL, DEMO_TICKS.JAM_ON, DEMO_TICKS.INJECT, DEMO_TICKS.JAM_OFF - 1, DEMO_TICKS.JAM_OFF];
  beforeAll(() => {
    r = rig();
    expect(r.runner.start()).toBe(true);
    let xray = readViewMode().xray;
    play(r, DEMO_TICKS.END, 1, snapshots => {
      const tick = snapshots.encore.tick;
      if (watched.includes(tick)) seen[tick] = structuredClone(snapshots);
      // play() refreshes status after this callback, so a view beat sent on tick t shows here on tick t + 1.
      if (readViewMode().xray !== xray) { xray = !xray; xrayChanges.push([tick - 1, xray]); }
      if (tick > DEMO_TICKS.KILL && tick < DEMO_TICKS.FORMATION) for (const arm of ['encore', 'static'] as const) {
        firstClaim[arm] ??= snapshots[arm].radio.some(event => event.claimSlot !== null) ? tick : null;
        firstCommit[arm] ??= previous && snapshots[arm].drones.some(d => d.alive && d.belief.slot !== previous![arm].drones[d.id].belief.slot) ? tick : null;
      }
      previous = snapshots;
      // Kill ids resolve from positions when the beat is sent, up to LEAD_TICKS early: they must not drift.
      if (tick >= DEMO_TICKS.KILL - LEAD_TICKS && tick < DEMO_TICKS.KILL) leadIds.push(idsInSphere(snapshots.encore, KILL_CENTRE, KILL_RADIUS));
      if (tick === DEMO_TICKS.JAM_ON) jammedAtOn = snapshots.encore.drones.filter(d => d.alive && dist(d.pos, JAM_CENTRE) <= JAM_RADIUS).length;
      // The selection right after the injection is sent (still its target) and while it spreads (cleared, #134).
      if (tick === DEMO_TICKS.INJECT - LEAD_TICKS + 2) selectedAt.send = readViewMode().selectedDroneId;
      if (tick === DEMO_TICKS.INJECT + 2) selectedAt.spread = readViewMode().selectedDroneId;
      if (tick === DEMO_TICKS.JAM_OFF + 2) selectedAt.jamOff = readViewMode().selectedDroneId;
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
    // The jam starts on the FORMED sphere (paced targets, #96, arrive before the hold): every live drone in both arms
    // is within rOcc of its own target, so the jam covers a cap of the formation, not whoever is passing mid-flight.
    for (const arm of ['encore', 'static'] as const) {
      const live = seen[DEMO_TICKS.JAM_ON]![arm].drones.filter(d => d.alive);
      expect(live.filter(d => dist(d.pos, d.belief.target) > r.worlds.params.rOcc).map(d => d.id)).toEqual([]);
    }
    // The jam covers the top cap: a minority of the swarm (measured 18 of 180, either brain).
    expect(jammedAtOn).toBeGreaterThan(10);
    expect(jammedAtOn).toBeLessThan(30);
    // INJECT_SCORE: an OPERATOR score in the target drone's inbox in both arms on its tick; at that tick the target
    // was alive, low in the sphere and outside the jam, in both arms.
    expect(injected).toEqual({ encore: true, static: true });
    for (const arm of ['encore', 'static'] as const) {
      const target = seen[DEMO_TICKS.INJECT]![arm].drones[INJECT_DRONE];
      expect(target.alive).toBe(true);
      expect(target.pos[1]).toBeLessThan(22);
      expect(dist(target.pos, JAM_CENTRE)).toBeGreaterThan(JAM_RADIUS);
    }
    // View beats went through the display intents; the run ends on the audience view with overlays off.
    expect(viewAtEnd).toMatchObject({ xray: false, beliefColours: false, selectedDroneId: null });
    expect(r.cameras).toEqual(['audience', 'audience']);
    expect(r.transport.speed).toBe(1);
  });

  it('deselects as the injection lands, so X-ray draws the whole spread; the injection still goes to its target (#134)', () => {
    expect(first.log.find(event => event.type === 'INJECT_SCORE')).toMatchObject({ tick: DEMO_TICKS.INJECT, droneId: INJECT_DRONE });
    expect(selectedAt.send).toBe(INJECT_DRONE);   // selected while the injection is sent, so it targets 151
    expect(selectedAt.spread).toBeNull();          // nothing selected while the new score spreads ...
    expect(selectedAt.jamOff).toBeNull();          // ... or when it crosses into the drones that were cut off
    const order = DEMO_BEATS.map(beat => beat.id);
    expect(order.indexOf('deselect')).toBeGreaterThan(order.indexOf('inject'));
    expect(dispatchTick(DEMO_BEATS.find(beat => beat.id === 'deselect')!)).toBeGreaterThan(dispatchTick(DEMO_BEATS.find(beat => beat.id === 'inject')!));
  });

  it('shows each caption on its own beat tick, never early, even for events sent ahead', () => {
    const captioned = DEMO_BEATS.filter(beat => beat.caption);
    expect(r.captions.map(entry => entry.caption)).toEqual(captioned.map(beat => beat.caption));
    expect(r.captions.map(entry => entry.tick)).toEqual(captioned.map(beat => beat.tick));
  });

  it('X-ray is off from the repair caption until the jam, through the real display intents (#134)', () => {
    expect(xrayChanges).toEqual([[DEMO_TICKS.XRAY, true], [DEMO_TICKS.REPAIR, false], [DEMO_TICKS.JAM_ON, true], [DEMO_TICKS.FINAL, false]]);
  });

  it('the repair caption lands after the Encore arm first claims and before it first commits (measured 455 / 475)', () => {
    expect(r.worlds.worlds.encore.config.brain.kind).toBe('encore');   // re-measure REPAIR if the app flies another brain
    expect(firstClaim.encore).not.toBeNull();
    expect(firstClaim.encore!).toBeLessThanOrEqual(DEMO_TICKS.REPAIR);
    expect(firstCommit.encore!).toBeGreaterThan(DEMO_TICKS.REPAIR);
    expect(firstCommit.encore!).toBeLessThan(DEMO_TICKS.REPAIR + 2 * 20);   // the refill starts while the caption is read
    expect(firstClaim.static).toBeNull();
    expect(firstCommit.static).toBeNull();
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
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
});

describe('scripted demo problems reach the panel over the browser path', () => {
  it('a failed beat is reported, not swallowed', () => {
    // No drone is selected, so an inject beat must fail exactly as the button would.
    const r = rig(7, [{ id: 'inject', tick: 40, action: { kind: 'control', intent: { type: 'inject', recipe: { kind: 'helix' }, at: 40 } }, caption: 'x' }]);
    r.runner.start();
    play(r, 45);
    expect(r.controls.getEventLog()).toEqual([]);
    expect(r.runner.problems).toEqual(['The inject step failed: Select a live drone first.']);
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
  it('a beat whose exact tick has passed lands next tick and marks the run off-script', () => {
    const r = rig(7, [{ id: 'kill', tick: 100, action: { kind: 'control', intent: { type: 'kill-region', centre: KILL_CENTRE, radius: KILL_RADIUS, at: 100 } }, caption: 'x' }]);
    r.runner.start();
    play(r, 120, 120);   // after start, status next arrives at tick 120: past the beat's tick
    expect(r.controls.getEventLog().map(event => [event.type, event.tick])).toEqual([['KILL', 121]]);
    expect(r.runner.problems[0]).toMatch(/off-script/);
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
});

describe('injection target and brain note', () => {
  it('the target is selected again in the same poll that sends the injection', () => {
    const inject = DEMO_BEATS.findIndex(beat => beat.id === 'inject');
    const target = DEMO_BEATS[inject - 1];
    expect(target.action).toEqual({ kind: 'control', intent: { type: 'select', id: INJECT_DRONE } });
    expect(dispatchTick(target)).toBe(dispatchTick(DEMO_BEATS[inject]));
  });

  it('a presenter click before the injection is sent cannot retarget it', () => {
    const beats = DEMO_BEATS.filter(beat => ['select', 'target', 'inject'].includes(beat.id))
      .map(beat => ({ ...beat, tick: beat.tick - DEMO_TICKS.JAM_ON + 20, action: beat.action?.kind === 'control' && beat.action.intent.type === 'inject' ? { kind: 'control' as const, intent: { ...beat.action.intent, at: DEMO_TICKS.INJECT - DEMO_TICKS.JAM_ON + 20 } } : beat.action }));
    const r = rig(7, beats);
    r.runner.start();
    play(r, 25);
    expect(readViewMode().selectedDroneId).toBe(INJECT_DRONE);
    r.controls.handle({ type: 'select', id: 3 });   // a presenter clicks another drone
    play(r, 90);
    expect(r.runner.problems).toEqual([]);
    expect(r.controls.getEventLog()).toMatchObject([{ type: 'INJECT_SCORE', droneId: INJECT_DRONE }]);
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.

  it('a static-pane selection whose status fires the due select / target / inject beats leaves them in Encore', () => {
    // The shell's wiring (main.ts): the selection's arm comes from createSelectionArm, and faults centred on a
    // static-pane selection refuse. selectDrone emits its status synchronously, so connectDemo runs the due beats
    // while the presenter's within('static', ...) is still on the stack.
    const arm = createSelectionArm();
    const selected: { id: number; arm: 'encore' | 'static' }[] = [];
    const beats = DEMO_BEATS.filter(beat => ['select', 'target', 'inject'].includes(beat.id))
      .map(beat => ({ ...beat, tick: beat.tick - DEMO_TICKS.JAM_ON + 20, action: beat.action?.kind === 'control' && beat.action.intent.type === 'inject' ? { kind: 'control' as const, intent: { ...beat.action.intent, at: DEMO_TICKS.INJECT - DEMO_TICKS.JAM_ON + 20 } } : beat.action }));
    const r = rig(7, beats, {
      selectionWorld: () => selected.at(-1)?.arm ?? 'encore',
      display: { ...viewModeDisplay, setSelected: id => { const a = arm.current(id); viewModeDisplay.setSelected(id); if (id !== null) selected.push({ id, arm: a }); } },
    });
    r.runner.start();
    while (r.worlds.tick < 25) r.worlds.stepBoth();   // the beats are due, but no status has polled them yet
    expect(selected).toEqual([]);
    arm.within('static', 3, () => r.controls.selectDrone(3));   // a static-pane click: its status runs the beats
    expect(selected[0]).toEqual({ id: 3, arm: 'static' });
    expect(selected.slice(1).map(s => s.id)).toContain(INJECT_DRONE);
    expect(selected.slice(1).every(s => s.arm === 'encore')).toBe(true);   // the demo's own selections stay Encore
    play(r, 90);
    expect(r.runner.problems).toEqual([]);
    expect(r.controls.getEventLog()).toMatchObject([{ type: 'INJECT_SCORE', droneId: INJECT_DRONE }]);
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.

  it('the Encore-only note follows the brains the live worlds fly, not a build-time constant', () => {
    const repair = DEMO_BEATS.find(beat => beat.id === 'repair')!;
    const formation = DEMO_BEATS.find(beat => beat.id === 'formation')!;
    const r = rig();
    const status = r.controls.status();
    expect(status.brains).toEqual({ encore: r.worlds.worlds.encore.config.brain.kind, static: r.worlds.worlds.static.config.brain.kind });
    const both = { brains: { encore: 'static' as const, static: 'static' as const } };
    expect(brainNote(both, repair)).toBe('Static brain in both arms: no difference shows yet.');
    expect(brainNote(both, formation)).toBe('');   // not an Encore-only beat
    expect(brainNote({ brains: { encore: 'encore', static: 'static' } }, repair)).toBe('');   // the Encore brain is in
    expect(brainNote(undefined, repair)).toBe('');
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
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.
  it('rejects a non-finite or malformed region centre and a timed action in the past', () => {
    const r = rig();
    play(r, 10);
    expect(r.controls.handle({ type: 'kill-region', centre: [Number.NaN, 0, 0], radius: 5 }).ok).toBe(false);
    expect(r.controls.handle({ type: 'jam', centre: [1, 2] as unknown as [number, number, number], radius: 5 }).ok).toBe(false);
    expect(r.controls.handle({ type: 'kill-region', centre: KILL_CENTRE, radius: 5, at: 10 }).ok).toBe(false);
    expect(r.controls.getEventLog()).toEqual([]);
  });
});
