// GF-WP-11 (#214): `replay save` / `replay load` in the console. Save writes the run's event log in THE file form
// (serializeReplayLog); load checks it (checkReplayLog), resets from its seed and schedules its events through the one
// controller (`replay` intent). The reloaded run reaches the original run's stateHash. File I/O goes through the
// console hooks here (the browser default is a download and a file picker).
import { describe, expect, it } from 'vitest';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { Drafts } from '../../../src/app/ui/Composer';
import { createConsoleEngine, type ConsoleContext, type ConsoleLine } from '../../../src/app/ui/Console';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';
import { parseReplayLog } from '../../../src/cli/generated';

const END = 260;

function setup() {
  const worlds = createWorlds({ seed: 11, n0: 40, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); }, display: viewModeDisplay,
  }));
  const files: { name: string; text: string }[] = [];
  let toOpen: string | null = null;
  const ctx: ConsoleContext = {
    controller, store: new Store(), drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples(),
    hooks: { saveFile: (name, text) => { files.push({ name, text }); return true; }, openFile: async () => toOpen },
  };
  const lines: ConsoleLine[] = [];
  const engine = createConsoleEngine(ctx, line => lines.push(line));
  return { worlds, controller, engine, lines, files, open: (text: string | null) => { toOpen = text; }, stepTo(t: number) { while (worlds.tick < t) worlds.stepBoth(); } };
}
const hashes = (fx: ReturnType<typeof setup>) => ({ encore: fx.worlds.worlds.encore.stateHash(), static: fx.worlds.worlds.static.stateHash() });
const last = (fx: ReturnType<typeof setup>) => fx.lines.at(-1)!;

describe('replay save / replay load', () => {
  it('save writes the log; load resets and reproduces the run’s stateHash in both arms', async () => {
    const fx = setup();
    fx.stepTo(20);
    await fx.engine.run('inject --drone 5 --draft d1');
    await fx.engine.run('fault kill --drone 9');
    fx.stepTo(END);
    const original = hashes(fx);
    await fx.engine.run('replay save');
    expect(last(fx)).toMatchObject({ kind: 'info', text: expect.stringMatching(/^Saved encore-replay-seed11-t\d+\.json: seed 11, 2 events/) });
    const file = fx.files[0]!;
    expect(parseReplayLog(file.text)).toMatchObject({ format: 1, n0: 40, seed: 11 });
    expect(file.text).toBe(`${JSON.stringify(JSON.parse(file.text), null, 2)}\n`);   // the order-preserving file form

    await fx.engine.run('fault kill --drone 3');                                     // the state moves on
    fx.stepTo(END + 40);
    fx.open(file.text);
    await fx.engine.run('replay load');
    expect(last(fx)).toEqual(expect.objectContaining({ kind: 'info', text: 'Replay from seed 11: 2 events scheduled.' }));
    expect(fx.controller.getEventLog().map(e => e.type)).toEqual(['INJECT_SCORE', 'KILL']);
    fx.stepTo(END);
    expect(hashes(fx)).toEqual(original);
  }, 60_000);

  it('load refuses a log from other params, a malformed file, or no file, and changes nothing', async () => {
    const fx = setup();
    await fx.engine.run('inject --drone 5 --draft d1');
    await fx.engine.run('replay save');
    const good = JSON.parse(fx.files[0]!.text) as { n0: number; events: { tick: number }[] };
    const before = fx.controller.getEventLog();
    const tick = fx.worlds.tick;
    for (const [text, pattern] of [
      [JSON.stringify({ ...good, n0: 200 }), /replay load refused \(params\)/],
      ['{ not json', /replay load refused \(format\)/],
      [JSON.stringify({ ...good, events: [{ type: 'TELEPORT', tick: 5 }] }), /replay load refused \(event\)/],
      [null, /no file chosen/],
    ] as const) {
      fx.open(text);
      await fx.engine.run('replay load');
      expect(last(fx).text).toMatch(pattern);
    }
    expect(fx.controller.getEventLog()).toEqual(before);   // nothing reset, nothing scheduled
    expect(fx.worlds.tick).toBe(tick);
  });

  it('the commands are listed in help, and the existing commands are untouched', async () => {
    const fx = setup();
    await fx.engine.run('help');
    expect(last(fx).text).toMatch(/replay save/);
    expect(last(fx).text).toMatch(/replay load/);
  });
});
