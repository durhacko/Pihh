// FE-B2 #93 (UI-03, UI-04, UI-05): the Composer and the Console share one inject path into the one action controller.
// Headless: real worlds, real controller, real observers; no DOM, no WebGL.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, type Group, type InstancedMesh } from 'three';
import { OPERATOR, type EnvEvent, type MetricsSample, type ScoreMsg } from '../../../src/contracts';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { versionKey } from '../../../src/app/render/colourModes/belief';
import { readViewMode, resetViewMode } from '../../../src/app/render/colourModes/viewMode';
import createPreviewLayer, { connectPreview } from '../../../src/app/render/layers/PreviewLayer';
import { adoption, dispatchInject, Drafts, injectFromComposer, parseContext, setPreview, validateDraft } from '../../../src/app/ui/Composer';
import { parse } from '../../../src/app/ui/commands';
import { createConsoleEngine, type ConsoleContext, type ConsoleLine } from '../../../src/app/ui/Console';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';

afterEach(() => { resetViewMode(); vi.restoreAllMocks(); });

function setup(seed = 11, n0 = 40, brains?: Parameters<typeof createWorlds>[0]['brains']) {
  const worlds = createWorlds({ seed, n0, brains });
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
  const handle = vi.spyOn(controller, 'handle');
  const schedule = { encore: vi.spyOn(worlds.worlds.encore, 'schedule'), static: vi.spyOn(worlds.worlds.static, 'schedule') };
  const events = new EventTarget();
  const ctx: ConsoleContext = {
    controller, store: new Store(), drafts: new Drafts(), params: worlds.params,
    snapshots: () => worlds.latest()!, samples: () => worlds.samples(), events,
  };
  const lines: ConsoleLine[] = [];
  const engine = createConsoleEngine(ctx, line => lines.push(line));
  return { worlds, controller, handle, schedule, ctx, events, lines, engine, step(n = 1) { for (let i = 0; i < n; i++) worlds.stepBoth(); } };
}
const injects = (log: EnvEvent[]) => log.filter((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');

describe('Composer and Console: one inject path', () => {
  it('the Composer button and the console line produce identical EnvEvents, into both worlds', async () => {
    const composer = setup();
    const console = setup();
    const fromComposer = await injectFromComposer(composer.ctx, 'd1', 5);
    await console.engine.run('inject --drone 5 --draft d1');
    expect(fromComposer.status).toBe('done');
    const a = composer.controller.getEventLog();
    const b = console.controller.getEventLog();
    expect(a).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ type: 'INJECT_SCORE', droneId: 5 });
    for (const fx of [composer, console]) {
      expect(fx.schedule.encore).toHaveBeenCalledTimes(1);
      expect(fx.schedule.static).toHaveBeenCalledTimes(1);
      expect(fx.schedule.encore.mock.calls[0][0]).toEqual(fx.schedule.static.mock.calls[0][0]);
      expect(fx.schedule.encore.mock.calls[0][0]).toEqual(a[0]);
    }
    expect(console.lines.map(line => line.kind)).toEqual(['input', 'validated', 'scheduled']);
  });

  it('the injected score enters only the chosen drone’s inbox, in both arms', async () => {
    const fx = setup();
    const outcome = await injectFromComposer(fx.ctx, 'd1', 5);
    const event = injects(fx.controller.getEventLog())[0];
    expect(outcome.sent).toMatchObject({ droneId: 5, tick: event.tick });
    const received: { arm: string; id: number; tick: number; from: number }[] = [];
    while (fx.worlds.tick < event.tick + 4) {
      fx.step();
      for (const arm of ['encore', 'static'] as const) {
        for (let id = 0; id < fx.worlds.params.n0; id++) {
          for (const message of fx.worlds.worlds[arm].inspect(id)?.input.inbox ?? []) {
            if (message.type === 'SCORE') received.push({ arm, id, tick: fx.worlds.tick, from: (message as ScoreMsg).from });
          }
        }
      }
    }
    // The uplink is the only OPERATOR SCORE: one per arm, at the event tick, into drone 5. The Encore brain gossips it
    // on (#105), so other Encore drones may receive copies, but only from drones. The static brain never relays.
    const uplinks = received.filter(r => r.from === OPERATOR);
    expect(uplinks).toEqual([{ arm: 'encore', id: 5, tick: event.tick, from: OPERATOR }, { arm: 'static', id: 5, tick: event.tick, from: OPERATOR }]);
    expect(received.filter(r => r.from !== OPERATOR).every(r => r.arm === 'encore' && r.from >= 0 && r.from < fx.worlds.params.n0)).toBe(true);
    expect(received.filter(r => r.arm === 'static')).toEqual([uplinks[1]]);
  });

  it('invalid drafts never dispatch, from either path', async () => {
    const fx = setup();
    fx.ctx.drafts.update({ text: 'ÉTÉ!' });
    expect(validateDraft(fx.ctx.drafts.current, fx.ctx.params).ok).toBe(false);
    const outcome = await injectFromComposer(fx.ctx, fx.ctx.drafts.current.id, 5);
    expect(outcome.status).toBe('failed');
    await fx.engine.run('inject --drone 5');
    fx.ctx.drafts.update({ text: 'OK', name: '   ' });
    await fx.engine.run('inject --drone 5');
    await fx.engine.run('form text "ß"');
    expect(fx.handle).not.toHaveBeenCalled();
    expect(fx.schedule.encore).not.toHaveBeenCalled();
    expect(fx.controller.getEventLog()).toEqual([]);
    expect(fx.ctx.drafts.list).toHaveLength(2);
    expect(fx.lines.filter(line => line.kind === 'error')).toHaveLength(3);
  });

  it('a failed later step undoes the plan’s own selection', async () => {
    const fx = setup();
    await fx.engine.run('inject --drone 5 --draft d1');
    await fx.engine.run('inject --drone 9 --draft d2');   // same tick: the controller refuses a second composition
    expect(fx.controller.status().selectedId).toBe(5);
    expect(injects(fx.controller.getEventLog())).toHaveLength(1);
    expect(fx.lines.at(-1)?.kind).toBe('error');
  });

  it('inject --pick waits for a stage click and sends nothing when cancelled', async () => {
    const fx = setup();
    const cancelled = fx.engine.run('inject --pick');
    expect(fx.ctx.store.state.pick?.purpose).toBe('inject');
    fx.ctx.store.state.pick!.resolve(null);   // Escape
    await cancelled;
    expect(fx.controller.getEventLog()).toEqual([]);
    const picked = fx.engine.run('inject --pick');
    // A real stage click on a drone: the shell (#113) resolves store.pick with that drone.
    fx.ctx.store.state.pick!.resolve({ droneId: 12, point: [0, 0, 0] });
    await picked;
    expect(injects(fx.controller.getEventLog()).map(e => e.droneId)).toEqual([12]);
    expect(fx.ctx.store.state.pick).toBeNull();
  });
});

describe('review fixes: picks, preconditions, resets', () => {
  it('a selection change never answers a waiting pick: only a stage click resolving store.pick does (#112 review)', async () => {
    const fx = setup();
    const regional = fx.engine.run('fault kill-region --pick');
    expect(fx.ctx.store.state.pick?.purpose).toBe('killRegion');
    const pending = fx.ctx.store.state.pick!;
    // Every way a selection can change without a stage click: the controller (Select button, keys), its status event,
    // and the presentation store.
    fx.controller.selectDrone(7);
    fx.events.dispatchEvent(new CustomEvent('encore:control-status', { detail: fx.controller.status() }));
    fx.ctx.store.set({ selected: { id: 7, arm: 'encore' } });
    await Promise.resolve();
    expect(fx.ctx.store.state.pick).toBe(pending);              // still waiting
    expect(fx.controller.getEventLog()).toEqual([]);            // no region kill around drone 7
    // The real click then answers it, with the clicked drone.
    pending.resolve({ droneId: 20, point: [0, 0, 0] });
    await regional;
    const kill = fx.controller.getEventLog().find(e => e.type === 'KILL') as Extract<EnvEvent, { type: 'KILL' }>;
    expect(kill.ids).toContain(20);
    expect(fx.controller.status().selectedId).toBe(20);
  });

  it('a pending pick is cancelled, never answered, by a command that selects a drone itself', async () => {
    const fx = setup();
    const regional = fx.engine.run('fault kill-region --pick');
    expect(fx.ctx.store.state.pick?.purpose).toBe('killRegion');
    await fx.engine.run('fault kill --drone 7');
    await regional;
    const kills = fx.controller.getEventLog().filter(e => e.type === 'KILL');
    expect(kills).toEqual([{ type: 'KILL', tick: expect.any(Number), ids: [7] }]);   // no region kill around drone 7
    expect(fx.lines.some(line => /pick cancelled/.test(line.text))).toBe(true);
    // Each log entry is reported exactly once, as the console's own.
    expect(fx.lines.filter(line => line.kind === 'scheduled').map(line => line.text)).toEqual([expect.not.stringContaining('from the controls')]);
  });

  it('a toggle re-checks its precondition after the pick: `fault jam --pick` never lifts a jam set meanwhile', async () => {
    const fx = setup();
    fx.controller.handle({ type: 'select', id: 3 });
    const jam = fx.engine.run('fault jam --pick');
    fx.controller.handle({ type: 'jam' });                     // J pressed while the console waits for a click
    fx.ctx.store.state.pick!.resolve({ droneId: 9, point: [0, 0, 0] });
    await jam;
    expect(fx.controller.getEventLog().map(e => e.type)).toEqual(['JAM_ON']);
    expect(fx.lines.at(-1)?.text).toMatch(/already in effect/);
  });

  it('a reset followed at once by a new event is still a reset: the old event is never reported as applied', async () => {
    const fx = setup();
    await fx.engine.run('fault kill --drone 3');
    fx.controller.handle({ type: 'reset', seed: 11 });         // R …
    fx.controller.handle({ type: 'kill-random' });              // … then a button, inside one poll window
    fx.step(3);
    fx.engine.poll();
    const applied = fx.lines.filter(line => line.kind === 'applied').map(line => line.text);
    expect(applied.some(text => /0\/1 targeted/.test(text))).toBe(false);
    expect(fx.lines.some(line => line.kind === 'scheduled' && /from the controls/.test(line.text))).toBe(true);
  });
});

describe('adoption reads observer data only', () => {
  it('shows exactly what MetricsSample.versions says', () => {
    const sample = (tick: number, versions: Record<string, number>, alive = 10): MetricsSample => ({
      tick, alive, coverage: 0, pwc: 0, npwc: null, sfMean: null, sfMax: null, dupSlots: 0, versions,
      msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0,
    });
    const sent = { key: '40:5', tick: 40 };
    expect(adoption({ encore: sample(35, { '40:5': 9 }), static: null }, sent).state).toBe('scheduled');   // before the tick: not counted
    const measured = adoption({ encore: sample(45, { '40:5': 7 }), static: sample(45, {}) }, sent);
    expect(measured).toEqual({ state: 'measured', sampleTick: 45, encore: { count: 7, alive: 10, share: 0.7 }, static: { count: 0, alive: 10, share: 0 } });
  });

  it('in the real app worlds the bar and the observed line show exactly the observer’s counts; static stays at 0', async () => {
    const fx = setup();
    const { sent } = await injectFromComposer(fx.ctx, 'd1', 5);
    while ((fx.worlds.samples().encore?.tick ?? 0) < sent!.tick + 20) fx.step();
    const samples = fx.worlds.samples();
    const reading = adoption(samples, sent!);
    expect(reading.state).toBe('measured');
    expect(reading.static?.count).toBe(0);   // the static arm never adopts
    const count = samples.encore!.versions[sent!.key] ?? 0;
    expect(reading.encore).toEqual({ count, alive: samples.encore!.alive, share: count / samples.encore!.alive });
    fx.engine.poll();
    const observed = fx.lines.filter(line => line.kind === 'observed');
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed[0].text).toContain(`Encore ${count}/${samples.encore!.alive} live drones hold it · static 0/${samples.static!.alive}`);
  });
});

describe('adoption with the real Encore brain', () => {
  it('never counts a holder that did not receive the score; the static arm never adopts', async () => {
    // Score gossip is real (#105): every observer count of the injected version is bounded by the drones that actually
    // received a SCORE carrying it, and the count must really spread beyond the uplinked drone (not pass trivially).
    const fx = setup(11, 40, { encore: encoreBrain });
    const { sent } = await injectFromComposer(fx.ctx, 'd1', 5);
    const received = new Set<number>();
    let samples = 0;
    let lastSampleTick = -1;
    let most = 0;
    while (fx.worlds.tick < sent!.tick + 300) {
      fx.step();
      for (let id = 0; id < fx.worlds.params.n0; id++) {
        for (const message of fx.worlds.worlds.encore.inspect(id)?.input.inbox ?? []) {
          if (message.type === 'SCORE' && versionKey(message.score.version) === sent!.key) received.add(id);
        }
      }
      const { encore, static: baseline } = fx.worlds.samples();
      if (!encore || encore.tick === lastSampleTick || encore.tick < sent!.tick) continue;
      lastSampleTick = encore.tick; samples++;
      const holders = encore.versions[sent!.key] ?? 0;
      expect(holders).toBeLessThanOrEqual(received.size);
      expect(baseline?.versions[sent!.key] ?? 0).toBe(0);
      most = Math.max(most, holders);
    }
    expect(received.has(5)).toBe(true);   // the uplink itself was delivered
    expect(samples).toBeGreaterThan(50);
    expect(most, 'remote adoption: drones other than the uplinked one must hold it').toBeGreaterThan(1);
  }, 30_000);
});

describe('the stage preview is local only', () => {
  it('schedules nothing, from the Composer or the console', async () => {
    const fx = setup();
    setPreview(fx.ctx, true);
    expect(fx.ctx.store.state.preview?.label).toBe('Durhack');
    await fx.engine.run('preview off');
    await fx.engine.run('preview on');
    await fx.engine.run('form sphere --colors #FFB000 #00C2A8');
    expect(fx.ctx.store.state.preview?.recipe.kind).toBe('sphere');
    expect(fx.handle).not.toHaveBeenCalled();
    expect(fx.controller.getEventLog()).toEqual([]);
  });

  it('PreviewLayer draws one hollow ring per slot over a dimming quad, and nothing without a preview', () => {
    const fx = setup();
    const scene = new Scene();
    const layer = createPreviewLayer();
    const disconnect = connectPreview(fx.ctx.store);
    layer.init({ scene, camera: new PerspectiveCamera(), params: fx.worlds.params });
    const group = scene.children[0] as Group;
    const frame = { prev: fx.worlds.latest()!.encore, curr: fx.worlds.latest()!.encore, alpha: 0, dtReal: 0 };
    layer.update(frame);
    expect(group.visible).toBe(false);
    setPreview(fx.ctx, true);
    layer.update(frame);
    expect(group.visible).toBe(true);
    expect((group.getObjectByName('rings') as InstancedMesh).count).toBe(fx.worlds.params.n0);
    expect(group.getObjectByName('dim')!.renderOrder).toBeLessThan(group.getObjectByName('rings')!.renderOrder);
    fx.ctx.store.set({ preview: null });
    layer.update(frame);
    expect(group.visible).toBe(false);
    disconnect(); layer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(fx.controller.getEventLog()).toEqual([]);
  });
});

describe('console stream', () => {
  it('separates validated, scheduled, applied lines, and reports events from other paths', async () => {
    const fx = setup();
    await fx.engine.run('fault kill --drone 3');
    expect(fx.lines.map(line => line.kind)).toEqual(['input', 'validated', 'scheduled']);
    fx.engine.poll();
    expect(fx.lines.some(line => line.kind === 'applied')).toBe(false);   // scheduled is not applied
    fx.step();
    fx.engine.poll();
    expect(fx.lines.at(-1)).toMatchObject({ kind: 'applied', text: expect.stringContaining('1/1 targeted drones are down') });
    fx.controller.handle({ type: 'kill-random' });                          // a button, not the console
    fx.engine.poll();
    expect(fx.lines.at(-1)).toMatchObject({ kind: 'scheduled', text: expect.stringContaining('from the controls') });
  });

  it('never drops a command: step without a transport hook, unknown commands and later commands all answer', async () => {
    const fx = setup();
    await fx.engine.run('step');
    await fx.engine.run('fualt kill');
    await fx.engine.run('show save');
    expect(fx.lines.filter(line => line.kind !== 'input').map(line => [line.kind, line.text.split('.')[0]])).toEqual([
      ['error', 'step is not available yet (#92)'],
      ['error', expect.stringContaining('Unknown command')],
      ['later', expect.stringContaining('planned, not built')],
    ]);
    const stepped = setup();
    stepped.ctx.hooks = { step: () => stepped.step() };
    const before = stepped.worlds.tick;
    await stepped.engine.run('step');
    expect(stepped.worlds.tick).toBe(before + 1);
  });

  it('view lenses act explicitly; `view show off` means belief colours on', async () => {
    const fx = setup();
    await fx.engine.run('view show off');
    expect(readViewMode().beliefColours).toBe(true);
    expect(fx.ctx.store.state.lenses.colour).toBe('belief');
    await fx.engine.run('view beliefs off');
    expect(readViewMode().beliefColours).toBe(false);
    await fx.engine.run('view xray on');
    await fx.engine.run('view xray on');                                    // already on: stays on
    expect(readViewMode().xray).toBe(true);
    await fx.engine.run('view zones off');
    expect(fx.ctx.store.state.lenses.zones).toBe(false);
    expect(fx.controller.getEventLog()).toEqual([]);
  });

  it('a reset clears pending events instead of reporting them as applied', async () => {
    const fx = setup();
    await fx.engine.run('fault kill --drone 3');
    await fx.engine.run('reset --seed 4');
    fx.step(3);
    fx.engine.poll();
    expect(fx.lines.some(line => line.kind === 'applied')).toBe(false);
  });
});

describe('#112 review follow-ups', () => {
  const sample = (tick: number, versions: Record<string, number>, alive = 40): MetricsSample => ({
    tick, alive, coverage: 0, pwc: 0, npwc: null, sfMean: null, sfMax: null, dupSlots: 0, versions,
    msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0,
  });

  it('prints only the highest milestone crossed in one sample, once', async () => {
    const fx = setup();
    await fx.engine.run('inject --drone 5 --draft d1');
    const event = injects(fx.controller.getEventLog())[0];
    const key = versionKey(event.score.version);
    let current = sample(event.tick, { [key]: 38 });           // 95 %: crosses 25, 50 and 90 at once
    fx.ctx.samples = () => ({ encore: current, static: sample(event.tick, {}) });
    fx.engine.poll();
    const milestones = () => fx.lines.filter(line => line.kind === 'observed' && /reached/.test(line.text)).map(line => line.text);
    expect(milestones()).toEqual([expect.stringContaining('reached 90 % of live Encore drones (38/40)')]);
    fx.engine.poll();                                            // same sample again: nothing new
    expect(milestones()).toHaveLength(1);
    current = sample(event.tick + 5, { [key]: 40 });
    fx.engine.poll();
    expect(milestones()).toEqual([expect.stringContaining('90 %'), expect.stringContaining('reached 100 % of live Encore drones (40/40)')]);
  });

  it('says honestly how an uplink was applied: inferred from the snapshot and the world rule, not read from an inbox', async () => {
    const fx = setup();
    await fx.engine.run('inject --drone 5 --draft d1');
    const event = injects(fx.controller.getEventLog())[0];
    while (fx.worlds.tick < event.tick) fx.step();
    fx.engine.poll();
    expect(fx.lines.find(line => line.kind === 'applied')?.text).toBe(`INJECT_SCORE at t${event.tick}: delivered to drone 5 (alive at tick ${event.tick}); the world sends uplinks only to that drone.`);
  });

  it('an empty draft store never throws: inject, preview and drafts all answer', async () => {
    const fx = setup();
    fx.ctx.drafts = new Drafts([]);
    const engine = createConsoleEngine(fx.ctx, line => fx.lines.push(line));
    await engine.run('inject --drone 5');
    await engine.run('preview on');
    await engine.run('drafts');
    expect(fx.lines.filter(line => line.kind !== 'input').map(line => line.kind)).toEqual(['error', 'error', 'info']);
    expect(fx.lines.at(-1)?.text).toMatch(/No drafts/);
    expect(setPreview(fx.ctx, true).ok).toBe(false);
    expect(fx.ctx.store.state.preview).toBeNull();
    const plan = parse('inject --drone 5', parseContext(fx.ctx));
    expect(plan.ok && plan.intent.kind === 'inject' ? (await dispatchInject(fx.ctx, plan.intent)).status : 'unparsed').toBe('failed');
    expect(fx.handle).not.toHaveBeenCalled();
  });

  it('sends the draft as it was when the pick started, even if it is edited or renamed while waiting', async () => {
    const fx = setup();
    const parsed = parse('inject --pick --draft d1', parseContext(fx.ctx));
    if (!parsed.ok || parsed.intent.kind !== 'inject') throw new Error('expected an inject plan');
    const pending = dispatchInject(fx.ctx, parsed.intent);
    fx.ctx.drafts.update({ name: 'Renamed', text: 'OTHER' }, 'd1');   // while the stage waits for a click
    fx.ctx.store.state.pick!.resolve({ droneId: 7, point: [0, 0, 0] });
    const outcome = await pending;
    expect(outcome.sent).toMatchObject({ name: 'Durhack', draftId: 'd1', droneId: 7 });
    const event = injects(fx.controller.getEventLog())[0];
    expect(event.score.movements.at(-1)!.recipe).toMatchObject({ kind: 'text', text: 'DURHACK' });
  });
});
