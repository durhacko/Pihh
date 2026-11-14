// tests/app/robustness.test.ts
// Follow-ups from the #84 review: the loop survives a throw, both observers see a tick even if one throws,
// and a reset clears the HUD at once. Headless.
import { describe, expect, it } from 'vitest';
import { DT } from '../../src/contracts';
import { HudModel } from '../../src/app/ui/Hud';
import { createFrameLoop, createWorlds, hudPayload, MAX_STEPS_PER_FRAME, type FrameHooks } from '../../src/app/worlds';

function harness(options: { failAdvanceAt?: number[]; failRender?: boolean; failOnError?: boolean } = {}) {
  const transport = { playing: true, speed: 1 };
  const log = { advances: 0, renders: 0, requests: 0, errors: [] as unknown[], phases: [] as string[] };
  const hooks: FrameHooks = {
    advance() { log.advances++; if (options.failAdvanceAt?.includes(log.advances)) throw new Error(`tick ${log.advances} failed`); },
    render() { log.renders++; if (options.failRender) throw new Error('render failed'); },
    onError(error, phase) { log.errors.push(error); log.phases.push(phase); if (options.failOnError) throw new Error('reporting failed too'); },
    request() { log.requests++; },
  };
  const loop = createFrameLoop(transport, hooks, 0);
  let now = 0;
  const frames = (count: number, ms: number) => { for (let i = 0; i < count; i++) { now += ms; loop.frame(now); } };
  return { transport, log, frames };
}

describe('frame loop', () => {
  it('steps at DT, at most MAX_STEPS_PER_FRAME per frame, and requests every frame', () => {
    const { log, frames } = harness();
    frames(20, 50);          // one second of exact 50 ms frames
    expect(log.advances).toBe(Math.round(1 / DT));
    expect(log.requests).toBe(20);
    frames(1, 2000);         // a long stall counts as at most 0.1 s: 2 ticks, never a burst of fake ticks
    expect(log.advances).toBe(22);
  });

  it('at high speed a frame never runs more than MAX_STEPS_PER_FRAME ticks', () => {
    const { transport, log, frames } = harness();
    transport.speed = 4;
    frames(1, 100);          // 0.1 s × 4 = 8 ticks wanted
    expect(log.advances).toBe(MAX_STEPS_PER_FRAME);
  });

  it('a tick that throws pauses the transport, reports once, and keeps the loop alive so a reset can resume it', () => {
    const { transport, log, frames } = harness({ failAdvanceAt: [7] });
    frames(30, 50);   // one tick per frame
    expect(log.errors).toHaveLength(1);
    expect(String(log.errors[0])).toContain('tick 7 failed');
    expect(log.phases).toEqual(['tick']);   // the worlds may be half-stepped: the app requires a reset
    expect(transport.playing).toBe(false);
    expect(log.advances).toBe(7);        // nothing stepped while paused
    expect(log.requests).toBe(30);       // but every frame asked for the next one
    expect(log.renders).toBe(29);        // and kept drawing the paused show
    transport.playing = true;            // what reset/play does
    frames(10, 50);
    expect(log.advances).toBe(17);
  });

  it('a render that throws, and even a reporter that throws, never stop the loop', () => {
    const { transport, log, frames } = harness({ failRender: true, failOnError: true });
    frames(5, 50);
    expect(transport.playing).toBe(false);
    expect(log.errors).toHaveLength(5);
    expect(new Set(log.phases)).toEqual(new Set(['render']));   // worlds intact: play may resume
    expect(log.requests).toBe(5);
  });
});

describe('stepBoth with a failing observer', () => {
  it('samples BOTH observers before rethrowing, and the worlds stay consistent', () => {
    const worlds = createWorlds({ seed: 3, n0: 30 });
    const original = worlds.observers.encore.sample.bind(worlds.observers.encore);
    // Like a real failure (e.g. an unregistered score): the observer has taken the tick's evidence, then throws.
    worlds.observers.encore.sample = snapshot => { const sample = original(snapshot); if (snapshot.tick === 5) throw new Error('encore observer failed'); return sample; };
    for (let t = 1; t <= 4; t++) worlds.stepBoth();
    expect(() => worlds.stepBoth()).toThrow('encore observer failed');
    expect(worlds.tick).toBe(5);
    expect(worlds.latest()!.static.tick).toBe(5);
    expect(worlds.series().static.map(s => s.tick)).toEqual([5]);   // the static observer still got tick 5
    expect(worlds.series().encore).toEqual([]);
    for (let t = 6; t <= 10; t++) worlds.stepBoth();                 // and both keep going
    expect(worlds.series().static.map(s => s.tick)).toEqual([5, 10]);
  });
});

describe('HUD after a reset', () => {
  it('hudPayload carries no samples right after reset, so the HUD drops the old run at once', () => {
    const worlds = createWorlds({ seed: 3, n0: 30 });
    while (worlds.tick < 20) worlds.stepBoth();
    const model = new HudModel();
    model.update(hudPayload(worlds, { fps: 60, layout: 'encore' }));
    expect(model.present().encore?.tick).toBe('20');
    worlds.reset(4);
    worlds.stepBoth();
    const payload = hudPayload(worlds, { fps: 60, layout: 'encore' });
    expect(payload.encore).toBeNull();
    expect(payload.static).toBeNull();
    model.update(payload);
    expect(model.present().encore).toBeNull();
    expect(model.present().status).toBe('Waiting for both observer samples');
  });
});
