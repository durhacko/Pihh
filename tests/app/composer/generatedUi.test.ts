// tests/app/composer/generatedUi.test.ts
// #213: the generated source beyond fixture preview: honest source labels, live generation through the client
// (re-validated, compiled in the worker), clear validation and rejection messages, and Accept disabled until GF-WP-07.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeParams } from '../../../src/contracts';
import type { SceneSpec } from '../../../src/score/generated';
import { gatewayUnavailable, type GenerateClient, type GenerateOutcome } from '../../../src/app/live/generate';
import { previewLabel } from '../../../src/app/render/layers/PreviewLayer';
import {
  createGeneratedSource, D3_UNAVAILABLE, NOT_CONNECTED, OFFLINE_FIXTURE, provenanceText, rejectionReason, sourceText, statusText, type FixtureEntry,
} from '../../../src/app/ui/GeneratedSource';
import { Store } from '../../../src/app/ui/store';
import { createFormationClient, type CompileReply, type WorkerLike } from '../../../src/app/workers/formationClient';
import { handleCompileRequest } from '../../../src/app/workers/formation.worker';

const params = makeParams(40);
const read = (file: string) => JSON.parse(readFileSync(`tests/fixtures/scenes/${file}`, 'utf8')) as SceneSpec;
const fixture = (id: string): FixtureEntry => ({ id, file: `valid-${id}.json`, load: async () => read(`valid-${id}.json`) });

function rig(live?: GenerateClient) {
  let onMessage: ((e: MessageEvent<CompileReply>) => void) | null = null;
  const worker: WorkerLike = {
    postMessage: (m) => { queueMicrotask(() => onMessage?.({ data: handleCompileRequest(m) } as MessageEvent<CompileReply>)); },
    addEventListener: (type: 'message' | 'error' | 'messageerror', listener: never) => { if (type === 'message') onMessage = listener; },
    terminate: () => {},
  };
  const store = new Store();
  const accepted: unknown[] = [];
  const source = createGeneratedSource({ params, client: createFormationClient(() => worker), store, fixtures: [fixture('3d-sphere')], live, onAccept: (s) => accepted.push(s) });
  return { source, store, accepted };
}
const liveReturning = (outcome: GenerateOutcome, calls: unknown[] = []): GenerateClient => ({ generate: async (req) => { calls.push(req); return outcome; } });

describe('honest source labels', () => {
  it('fixtures read "offline fixture"; without a live client the tab offers no live call and says D3 is not granted', async () => {
    const { source } = rig();
    expect(source.liveAvailable).toBe(false);
    expect(sourceText(source.status)).toBe(`Source: ${OFFLINE_FIXTURE}`);
    await source.generate('a cat', 'scene3d');                // no client: nothing happens
    expect(source.status.state).toBe('idle');
    await source.select('3d-sphere');
    expect(sourceText(source.status)).toBe('Source: offline fixture');
    expect(D3_UNAVAILABLE).toBe('live Gemini unavailable (D3 not granted)');
    // While a gateway request runs, the source is the gateway (pending), never "offline fixture".
    expect(sourceText({ state: 'generating', fixtureId: 'live', prompt: 'a cat', mode: 'scene3d' })).toBe('Source: gateway (pending)');
  });

  it('the shipped gateway\'s answer is shown with its own reason, once, never as a scene', async () => {
    const unavailable: GenerateOutcome = { ok: false, kind: 'unavailable', status: 503, code: 'PROVIDER_UNAVAILABLE', message: gatewayUnavailable('MODULE_DISABLED'), details: [{ path: '', reason: 'MODULE_DISABLED' }] };
    const { source, store } = rig(liveReturning(unavailable));
    await source.generate('a cat', 'scene3d');
    expect(source.status.state).toBe('rejected');
    expect(statusText(source.status, 40)).toBe('Live generation did not run: live Gemini unavailable (gateway: MODULE_DISABLED)');
    expect(store.state.preview).toBe(null);
  });

  it('a gateway preview\'s stage label never says fixture; it names the provider (#283 review)', async () => {
    const fake: GenerateOutcome = { ok: true, scene: read('valid-3d-two-spheres.json'), model: 'offline-fake', provider: 'offline-fake provider (not Gemini)', gemini: false, mode: 'scene3d', latencyMs: 5 };
    const { source, store } = rig(liveReturning(fake));
    await source.generate('two spheres', 'scene3d');
    expect(source.preview(true)).toBe(true);
    expect(source.previewOn()).toBe(true);
    const preview = store.state.preview!;
    expect(preview).toMatchObject({ source: 'generated', provider: 'offline-fake provider (not Gemini)' });
    const label = previewLabel(preview);
    expect(label).toBe('PREVIEW · target arrangement (preview), not flown · generated “Two Overlapping Spheres” · offline-fake provider (not Gemini) · local only, nothing is sent');
    expect(label).not.toMatch(/fixture/i);
    expect(provenanceText(source.status)).toMatch(/· offline-fake provider \(not Gemini\)$/);   // the label alone: no "live live"
    expect(provenanceText(source.status)).not.toMatch(/\blive\b/);
    source.preview(false);
    expect(store.state.preview).toBe(null);
  });

  it('an empty prompt is refused locally: nothing is sent', async () => {
    const calls: unknown[] = [];
    const { source } = rig(liveReturning({ ok: false, kind: 'unavailable', status: 0, code: 'UNREACHABLE', message: 'x', details: [] }, calls));
    await source.generate('   ', 'scene3d');
    expect(calls).toEqual([]);
    expect(source.status.state === 'rejected' && source.status.code).toBe('empty-prompt');
    expect(statusText(source.status, 40)).toContain('Type a prompt first.');
  });

  it('a newer request, a cancel or dispose aborts the in-flight gateway request', async () => {
    const signals: AbortSignal[] = [];
    const hanging: GenerateClient = { generate: (req) => new Promise((resolve) => {
      signals.push(req.signal!);
      req.signal!.addEventListener('abort', () => resolve({ ok: false, kind: 'cancelled', status: -2, code: 'CANCELLED', message: '', details: [] }));
    }) };
    const { source } = rig(hanging);
    const first = source.generate('one', 'scene3d');
    const second = source.generate('two', 'scene3d');
    expect(signals[0].aborted).toBe(true);                        // superseded
    expect(source.status.state).toBe('generating');
    source.cancel();
    expect(signals[1].aborted).toBe(true);                        // cancelled
    expect(source.status.state).toBe('idle');
    await Promise.all([first, second]);
    expect(source.status.state).toBe('idle');                     // a cancelled outcome never becomes a rejection
    const third = source.generate('three', 'scene3d');
    source.dispose();
    expect(signals[2].aborted).toBe(true);                        // disposed
    await third;
  });

  it('a scene from the gateway\'s offline-fake provider compiles and previews, labelled not Gemini', async () => {
    const calls: unknown[] = [];
    const fake: GenerateOutcome = { ok: true, scene: read('valid-3d-two-spheres.json'), model: 'offline-fake', provider: 'offline-fake provider (not Gemini)', gemini: false, mode: 'scene3d', latencyMs: 5 };
    const { source, store } = rig(liveReturning(fake, calls));
    await source.generate('two spheres', 'scene3d', 'tok');
    expect(calls).toEqual([{ prompt: 'two spheres', mode: 'scene3d', token: 'tok', signal: expect.any(AbortSignal) }]);
    expect(source.status.state).toBe('ready');
    expect(sourceText(source.status)).toBe('Source: offline-fake provider (not Gemini)');
    expect(statusText(source.status, 40)).toMatch(/^Generated scene “Two Overlapping Spheres” \(offline-fake provider \(not Gemini\)\) \(3D\): 40 of 40 slots/);
    expect(statusText(source.status, 40)).not.toMatch(/live Gemini/);
    expect(source.preview(true)).toBe(true);
    expect(store.state.preview?.formation?.slots).toHaveLength(40);
  });
});

describe('clear validation and rejection messages', () => {
  it('a returned scene that fails validation lists its issues by code and path, and is never compiled', async () => {
    const bad = { ...read('valid-3d-sphere.json'), parts: [] };
    const { source } = rig(liveReturning({ ok: true, scene: bad, model: 'offline-fake', provider: 'offline-fake provider (not Gemini)', gemini: false, mode: 'scene3d', latencyMs: 1 }));
    await source.generate('nothing', 'scene3d');
    expect(source.status.state).toBe('rejected');
    if (source.status.state !== 'rejected') return;
    expect(source.status.issues!.length).toBeGreaterThan(0);
    expect(source.status.issues![0]).toMatch(/^[a-z-]+ at \/\S*: /);
    expect(statusText(source.status, 40)).toContain('was rejected');
    expect(statusText(source.status, 40)).toContain(rejectionReason(source.status.code));
  });

  it('every compiler and gateway code has a plain-language reason; unknown codes still say what they are', () => {
    for (const code of ['parse', 'schema', 'range', 'geometry', 'complexity', 'empty-geometry', 'infeasible-count', 'dense-coverage', 'below-floor', 'too-large-world', 'internal', 'PROVIDER_UNAVAILABLE', 'UNAUTHORIZED', 'TIMEOUT']) {
      expect(rejectionReason(code)).not.toMatch(/^Rejected \(/);
    }
    expect(rejectionReason('something-new')).toBe('Rejected (something-new).');
  });

  it('a 2D request answered with a 3D scene is refused with a clear reason', async () => {
    const { source } = rig(liveReturning({ ok: true, scene: read('valid-3d-sphere.json'), model: 'offline-fake', provider: 'offline-fake provider (not Gemini)', gemini: false, mode: 'silhouette2d', latencyMs: 1 }));
    await source.generate('a disc', 'silhouette2d');
    expect(source.status.state === 'rejected' && source.status.detail).toBe('The gateway returned a scene3d for a silhouette2d request.');
  });
});

describe('provenance line (agreed with #214)', () => {
  it('reads sceneHash · compiler · slots · fixture <id> from the worker\'s own compile', async () => {
    const { source } = rig();
    await source.select('3d-sphere');
    if (source.status.state !== 'ready') throw new Error('expected ready');
    const r = source.status.result;
    expect(provenanceText(source.status)).toBe(`sceneHash ${r.sceneHash.slice(0, 12)}… · compiler v${r.compilerVersion} · slots ${r.slotsDigest.slice(0, 12)}… · fixture 3d-sphere`);
    expect(provenanceText({ state: 'idle' })).toBe(null);
  });
});

describe('Accept is enabled only when the inject path is connected (G3)', () => {
  it('without the inject path: refuses with NOT_CONNECTED and never calls the hand-off', async () => {
    const { source, accepted } = rig();
    await source.select('3d-sphere');
    expect(source.injectConnected).toBe(false);
    expect(source.accept()).toEqual({ ok: false, reason: NOT_CONNECTED });
    expect(source.accepted).toBe(null);
    expect(accepted).toEqual([]);
  });
});
