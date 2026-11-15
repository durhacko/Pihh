// tests/app/composer/generatedInjectFlow.test.ts
// G3 (#213 with d1's #214 and 48's #215): the complete generated path on a REAL controller and real worlds:
// choose a committed fixture → compile in the (fake) worker → preview → Accept (preflight + generated recipe) →
// inject into ONE chosen live drone through d1's injectGeneratedRecipe → exactly one INJECT_SCORE → the observer's
// adoption count rises by gossip (the static arm never adopts) → adopted drones fly the compiled formation →
// replay re-derives the same formation from the scene and its provenance alone.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EnvEvent } from '../../../src/contracts';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { versionKey } from '../../../src/app/render/colourModes/belief';
import { adoption, Drafts, type ComposeContext } from '../../../src/app/ui/Composer';
import { injectGeneratedRecipe } from '../../../src/app/ui/generatedInject';
import { createGeneratedSource, injectAccepted, NOT_CONNECTED, replayText, type FixtureEntry } from '../../../src/app/ui/GeneratedSource';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';
import { createFormationClient, type CompileReply, type WorkerLike } from '../../../src/app/workers/formationClient';
import { handleCompileRequest } from '../../../src/app/workers/formation.worker';
import type { SceneSpec } from '../../../src/score/generated';

const N0 = 40;
const SEED = 11;
const DRONE = 7;
const fixture = (id: string): FixtureEntry => ({ id, file: `valid-${id}.json`, load: async () => JSON.parse(readFileSync(`tests/fixtures/scenes/valid-${id}.json`, 'utf8')) as SceneSpec });
const injects = (log: readonly EnvEvent[]) => log.filter((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');

function live(injectConnected = true) {
  const worlds = createWorlds({ seed: SEED, n0: N0, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); }, display: viewModeDisplay,
  }));
  const store = new Store();
  const ctx: ComposeContext = { controller, store, drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples() };
  let onMessage: ((e: MessageEvent<CompileReply>) => void) | null = null;
  const worker: WorkerLike = {
    postMessage: (m) => { queueMicrotask(() => onMessage?.({ data: handleCompileRequest(m) } as MessageEvent<CompileReply>)); },
    addEventListener: (type: 'message' | 'error' | 'messageerror', listener: never) => { if (type === 'message') onMessage = listener; },
    terminate: () => {},
  };
  const source = createGeneratedSource({ params: worlds.params, store, client: createFormationClient(() => worker), fixtures: ['3d-sphere', '3d-two-spheres'].map(fixture), injectConnected });
  return { worlds, controller, ctx, store, source, step(n = 1) { for (let i = 0; i < n; i++) worlds.stepBoth(); } };
}

describe('G3: the complete generated path on a real controller', () => {
  it('choose → compile → preview → Accept → one INJECT_SCORE into the chosen drone → adoption by gossip → flown → replay', async () => {
    const fx = live();
    await fx.source.select('3d-sphere');
    expect(fx.source.status.state).toBe('ready');
    expect(fx.source.preview(true)).toBe(true);
    expect(fx.store.state.preview?.source).toBe('fixture');

    const acceptance = fx.source.accept();
    expect(acceptance.ok, acceptance.ok ? '' : acceptance.reason).toBe(true);
    if (!acceptance.ok) return;
    const accepted = fx.source.accepted!;
    expect(accepted.recipe.kind).toBe('generated');
    expect(accepted.provenance).toMatchObject({ n0: N0, source: 'fixture', fixture: '3d-sphere' });

    fx.step(20);
    expect(fx.worlds.latest()!.encore.drones[DRONE].alive).toBe(true);    // the one chosen drone is alive
    const before = injects(fx.controller.getEventLog()).length;
    const { outcome, replay } = await injectAccepted(fx.ctx, accepted, DRONE, injectGeneratedRecipe);
    expect(outcome.status, outcome.message).toBe('done');
    expect(outcome.sent).toMatchObject({ droneId: DRONE, name: accepted.title });

    // Exactly ONE operator uplink, into the chosen drone, carrying the accepted generated recipe.
    const sentEvents = injects(fx.controller.getEventLog()).slice(before);
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].droneId).toBe(DRONE);
    expect(sentEvents[0].score.movements.some(m => m.recipe.kind === 'generated' && m.recipe.sceneHash === accepted.recipe.sceneHash)).toBe(true);
    expect(fx.store.state.preview).toBe(null);                    // the preview is done: the swarm flies it now

    // The observer's adoption count rises through gossip; the static baseline never adopts.
    const sent = outcome.sent!;
    expect(sent.key).toBe(versionKey(sentEvents[0].score.version));
    const counts: number[] = [];
    for (let k = 0; k < 40; k++) {
      fx.step(10);
      const reading = adoption(fx.ctx.samples(), sent);
      if (reading.state === 'measured') counts.push(reading.encore?.count ?? 0);
      expect(reading.static?.count ?? 0).toBe(0);
    }
    expect(counts.length).toBeGreaterThan(10);
    expect(Math.max(...counts)).toBeGreaterThan(1);               // more than the one injected drone: gossip spread it
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
    const alive = fx.worlds.latest()!.encore.drones.filter(d => d.alive).length;
    expect(counts[counts.length - 1]).toBeLessThanOrEqual(alive);

    // Flown: adopted drones target the compiled formation's slots (the replay's formation, from scene + provenance).
    expect(replay?.ok, replayText(replay)).toBe(true);
    if (!replay?.ok) return;
    expect(replayText(replay)).toMatch(/^Replay: the scene and its provenance alone re-derive the same formation/);
    const slots = replay.formation.slots;
    const onFormation = fx.worlds.latest()!.encore.drones.filter(d => d.alive && versionKey(d.belief.version) === sent.key
      && slots[d.belief.slot] && slots[d.belief.slot].pos.every((v, a) => Math.abs(v - d.belief.target[a]) < 1e-6));
    expect(onFormation.length).toBeGreaterThan(1);
  }, 60_000);

  it('Accept stays off without the inject path, and a dead target drone is refused with nothing sent', async () => {
    const off = live(false);
    await off.source.select('3d-sphere');
    expect(off.source.accept()).toEqual({ ok: false, reason: NOT_CONNECTED });

    const fx = live();
    await fx.source.select('3d-sphere');
    expect(fx.source.accept().ok).toBe(true);
    fx.controller.handle({ type: 'kill-ids', ids: [DRONE] });
    fx.step(5);
    expect(fx.worlds.latest()!.encore.drones[DRONE].alive).toBe(false);
    const before = injects(fx.controller.getEventLog()).length;
    const { outcome, replay } = await injectAccepted(fx.ctx, fx.source.accepted!, DRONE, injectGeneratedRecipe);
    expect(outcome.status).toBe('failed');
    expect(outcome.sent).toBeUndefined();
    expect(replay).toBe(null);
    expect(injects(fx.controller.getEventLog()).length).toBe(before);
  }, 60_000);

  it('a new selection clears the accepted scene, so Inject never sends a stale one', async () => {
    const fx = live();
    await fx.source.select('3d-sphere');
    expect(fx.source.accept().ok).toBe(true);
    await fx.source.select('3d-two-spheres');
    expect(fx.source.accepted).toBe(null);
  });
});
