// Audit findings E6/E7 (#290): `camera PRESET` must move the rig through the same hook the Lenses popover uses, and
// the controller exposes the authored score (a copy) for the Composer's transition lint (#208).
import { describe, expect, it } from 'vitest';
import type { CameraPreset } from '../../../src/app/ui/commands';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { Drafts } from '../../../src/app/ui/Composer';
import { createConsoleEngine, type ConsoleContext, type ConsoleLine } from '../../../src/app/ui/Console';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';

function setup(camera?: (p: CameraPreset) => void) {
  const worlds = createWorlds({ seed: 11, n0: 40, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); }, display: viewModeDisplay,
  }));
  const ctx: ConsoleContext = { controller, store: new Store(), drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples(), ...(camera ? { hooks: { camera } } : {}) };
  const lines: ConsoleLine[] = [];
  return { worlds, controller, ctx, lines, engine: createConsoleEngine(ctx, line => lines.push(line)) };
}

describe('E6: camera PRESET moves the rig', () => {
  it('calls the camera hook (the rig preset), once per command', async () => {
    const presets: CameraPreset[] = [];
    const fx = setup(p => presets.push(p));
    await fx.engine.run('camera top');
    await fx.engine.run('camera audience');
    expect(presets).toEqual(['top', 'audience']);
    expect(fx.lines.at(-1)).toMatchObject({ kind: 'info', text: 'Camera: audience (visual only).' });
  });

  it('without the hook it says so instead of reporting a move that did not happen', async () => {
    const fx = setup();
    await fx.engine.run('camera quarter');
    expect(fx.lines.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('not connected') });
    expect(fx.ctx.store.state.camera).toBeNull();
  });
});

describe('E7: the controller exposes the authored score', () => {
  it('is the preloaded score, then each scheduled injection’s score, then the reset score; always a copy', async () => {
    const fx = setup();
    const preloaded = fx.controller.authoredScore();
    expect(preloaded).toEqual(fx.worlds.score);
    fx.controller.handle({ type: 'select', id: 5 });
    expect(fx.controller.handle({ type: 'inject', recipe: { kind: 'helix' } }).ok).toBe(true);
    const event = fx.controller.getEventLog().find(e => e.type === 'INJECT_SCORE')!;
    expect(event.type === 'INJECT_SCORE' && fx.controller.authoredScore()).toEqual(event.type === 'INJECT_SCORE' && event.score);
    const copy = fx.controller.authoredScore();
    copy.movements.length = 0;                                       // mutating the copy changes nothing
    expect(fx.controller.authoredScore().movements.length).toBeGreaterThan(0);
    fx.controller.handle({ type: 'reset', seed: 11 });
    expect(fx.controller.authoredScore()).toEqual(preloaded);
  });
});
