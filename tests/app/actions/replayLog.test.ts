// GF-WP-11 (#214), GF-T36: a saved event log with a GENERATED injection replays to the same stateHash. The run is
// driven live through the controller (a generated recipe from a committed fixture injected into one drone, then a
// kill), its event log is saved as a ReplayLogFile, read back, checked, and rebuilt from the seed alone (reset and
// deterministic reproduction). No model is involved.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeParams, type GeneratedRecipe } from '../../../src/contracts';
import { makeGeneratedRecipe } from '../../../src/score';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { Drafts, type ComposeContext } from '../../../src/app/ui/Composer';
import { injectGeneratedRecipe } from '../../../src/app/ui/generatedInject';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';
import { checkReplayLog, makeReplayLog, parseReplayLog, replayParamsHash, serializeReplayLog } from '../../../src/cli/generated';
import { canonicalJson } from '../../../src/score/canonical';
import { paramsHash } from '../../../src/cli/run';

const SEED = 11;
/** A real generated recipe: the first committed valid fixture scene that compiles at n0 40 (fixed by file order). */
const GENERATED: GeneratedRecipe = (() => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/scenes');
  for (const file of readdirSync(dir).filter(f => f.startsWith('valid-')).sort()) {
    const made = makeGeneratedRecipe(JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as unknown, 40, makeParams(40));
    if (made.ok) return made.recipe;
  }
  throw new Error('no committed fixture compiles at n0 40');
})();
const N0 = 40;
const END = 320;

function live() {
  const worlds = createWorlds({ seed: SEED, n0: N0, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); }, display: viewModeDisplay,
  }));
  const ctx: ComposeContext = { controller, store: new Store(), drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples() };
  return { worlds, controller, ctx };
}
const hashes = (w: ReturnType<typeof createWorlds>) => ({ encore: w.worlds.encore.stateHash(), static: w.worlds.static.stateHash() });

async function recordedRun() {
  const run = live();
  for (let i = 0; i < 40; i++) run.worlds.stepBoth();
  expect((await injectGeneratedRecipe(run.ctx, GENERATED, 7, GENERATED.scene.title)).status).toBe('done');
  for (let i = 0; i < 60; i++) run.worlds.stepBoth();
  expect(run.controller.handle({ type: 'kill-ids', ids: [12, 13] }).ok).toBe(true);
  while (run.worlds.tick < END) run.worlds.stepBoth();
  return { run, log: makeReplayLog(SEED, run.worlds.params, run.controller.getEventLog()), end: hashes(run.worlds) };
}

describe('GF-T36: event-log replay', () => {
  it('a saved log, read back and rebuilt from the seed alone, reaches the same stateHash in both arms', async () => {
    const { log, end } = await recordedRun();
    expect(log.events.map(e => e.type)).toEqual(['INJECT_SCORE', 'KILL']);
    const injected = log.events[0]!;
    expect(injected.type === 'INJECT_SCORE' && injected.score.movements.at(-1)!.recipe).toMatchObject({ kind: 'generated', sceneHash: GENERATED.sceneHash });
    const stored = parseReplayLog(serializeReplayLog(log));               // THE file form: keys in their original order
    const checked = checkReplayLog(stored, makeParams(N0));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const replay = createWorlds({ seed: checked.log.seed, n0: checked.log.n0, brains: { encore: encoreBrain }, events: checked.log.events });
    while (replay.tick < END) replay.stepBoth();
    expect(hashes(replay)).toEqual(end);
    const again = createWorlds({ seed: checked.log.seed, n0: checked.log.n0, brains: { encore: encoreBrain }, events: checked.log.events });
    while (again.tick < END) again.stepBoth();
    expect(hashes(again)).toEqual(end);                                     // deterministic reproduction, twice
  }, 60_000);

  it('the file form keeps key order: a key-sorted (canonicalJson) file is NOT the same run (#285)', async () => {
    const { log, end } = await recordedRun();
    const replayFrom = (text: string) => {
      const checked = checkReplayLog(parseReplayLog(text), makeParams(N0));
      if (!checked.ok) throw new Error(checked.detail);
      const w = createWorlds({ seed: checked.log.seed, n0: checked.log.n0, brains: { encore: encoreBrain }, events: checked.log.events });
      while (w.tick < END) w.stepBoth();
      return hashes(w);
    };
    expect(replayFrom(serializeReplayLog(log))).toEqual(end);                // the writer's form reproduces the run
    const sorted = replayFrom(canonicalJson(log));                             // same events, keys sorted
    // The world's stateHash depends on key order, so a sorted file is a different replay. This pins why
    // serializeReplayLog must never switch to canonicalJson.
    expect(sorted.encore).not.toBe(end.encore);
    expect(serializeReplayLog(log)).toBe(`${JSON.stringify(log, null, 2)}
`);
  }, 60_000);

  it('the log matters: without its events the run diverges', async () => {
    const { end } = await recordedRun();
    const bare = createWorlds({ seed: SEED, n0: N0, brains: { encore: encoreBrain } });
    while (bare.tick < END) bare.stepBoth();
    expect(hashes(bare).encore).not.toBe(end.encore);
  }, 60_000);

  it('the params hash equals src/cli/run.ts paramsHash (no node:crypto needed)', () => {
    for (const n0 of [40, 200]) expect(replayParamsHash(makeParams(n0))).toBe(paramsHash(makeParams(n0)));
  });

  it('refuses a log from other params or with malformed events, instead of adapting it', async () => {
    const { log } = await recordedRun();
    const p = makeParams(N0);
    const reason = (input: unknown) => { const r = checkReplayLog(input, p); return r.ok ? 'ok' : r.reason; };
    expect(reason(log)).toBe('ok');
    expect(reason({ ...log, n0: 200 })).toBe('params');
    expect(reason({ ...log, paramsHash: '0'.repeat(64) })).toBe('params');
    expect(reason({ ...log, format: 2 })).toBe('format');
    expect(reason({ ...log, seed: 1.5 })).toBe('format');
    expect(reason({ ...log, events: [...log.events].reverse() })).toBe('event');                       // out of tick order
    expect(reason({ ...log, events: [{ type: 'TELEPORT', tick: 5 }] })).toBe('event');                  // never a reposition
    expect(reason({ ...log, events: [{ ...log.events[0], droneId: 99 }] })).toBe('event');
    expect(reason(null)).toBe('format');
  }, 60_000);
});
