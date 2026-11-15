// tests/app/composer/generated.test.ts
// GF-WP-10 (#265, preview only): the Composer's generated source. Committed fixtures only, labelled "fixture" and
// never "Gemini"; compile through the worker client; a stale reply never replaces a newer preview; a rejection shows
// its typed reason; the stage draws the precomputed slots; nothing is injected; the no-formation preview path is
// unchanged; the flag is off by default.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Group, InstancedMesh, Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three';
import { makeParams, type Recipe } from '../../../src/contracts';
import { expandRecipe } from '../../../src/score';
import type { SceneSpec } from '../../../src/score/generated';
import createPreviewLayer, { connectPreview, previewLabel } from '../../../src/app/render/layers/PreviewLayer';
import { generatedFlag } from '../../../src/app/ui/Composer';
import {
  createGeneratedSource, fixtureEntries, generatedOptIn, NOT_CONNECTED, PLACEHOLDER_RECIPE, statusText, type FixtureEntry,
} from '../../../src/app/ui/GeneratedSource';
import { Store } from '../../../src/app/ui/store';
import { createFormationClient, type CompileReply, type CompileRequest, type WorkerLike } from '../../../src/app/workers/formationClient';
import { handleCompileRequest } from '../../../src/app/workers/formation.worker';

const WIDE = Boolean(process.env.P2_WIDE);
const params = makeParams(40);
const fixture = (id: string): FixtureEntry => {
  const file = `valid-${id}.json`;
  return { id, file, load: async () => JSON.parse(readFileSync(`tests/fixtures/scenes/${file}`, 'utf8')) as SceneSpec };
};

/** A client over a fake worker that replies when told (or at once with `auto`). */
function rig(auto = true) {
  const posted: CompileRequest[] = [];
  let onMessage: ((e: MessageEvent<CompileReply>) => void) | null = null;
  const worker: WorkerLike = {
    postMessage: (m) => { posted.push(m); if (auto) queueMicrotask(() => onMessage?.({ data: handleCompileRequest(m) } as MessageEvent<CompileReply>)); },
    addEventListener: (type: 'message' | 'error' | 'messageerror', listener: never) => { if (type === 'message') onMessage = listener; },
    terminate: () => {},
  };
  const store = new Store();
  const client = createFormationClient(() => worker);
  // 'bad' is a committed invalid scene (V5 range), genuinely rejected by the compiler; 2D compiles since #212's 2D path.
  const bad: FixtureEntry = { id: 'bad', file: 'invalid-range-centre.json', load: async () => JSON.parse(readFileSync('tests/fixtures/scenes/invalid-range-centre.json', 'utf8')) as SceneSpec };
  const source = createGeneratedSource({ params, client, store, fixtures: [...['3d-sphere', '3d-two-spheres', '2d-disc', '3d-primitives'].map(fixture), bad] });
  return { store, client, source, posted, reply: (k: number) => onMessage?.({ data: handleCompileRequest(posted[k]) } as MessageEvent<CompileReply>) };
}

describe('opt-in and labels', () => {
  it('is off by default: `?p2=generated` turns it on; other flags and no location do not', () => {
    expect(generatedFlag(null)).toBe(false);
    expect(generatedFlag('')).toBe(false);
    expect(generatedFlag('?p2=cascade')).toBe(false);
    expect(generatedFlag('?p2=cascade,generated')).toBe(true);
    expect(generatedFlag()).toBe(false);                       // Node: no location
    for (const s of ['', '?p2=generated', '?p2=x, generated', '?p2=generatedx']) expect(generatedOptIn(s)).toBe(generatedFlag(s));
  });

  it('lists exactly the committed valid fixtures, each labelled fixture; no string anywhere says Gemini', () => {
    const entries = fixtureEntries();
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const e of entries) expect(e.file).toMatch(/^valid-(2d|3d)-[a-z0-9-]+\.json$/);
    // Comments and identifiers (`origin.gemini`) may name Gemini, to say what is NOT it; no string the tab shows may.
    // The honest provider labels come only from src/app/live/generate.ts (#213, tested there).
    const code = readFileSync('src/app/ui/GeneratedSource.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const literals = code.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g) ?? [];
    expect(literals.length).toBeGreaterThan(20);
    expect(literals.filter(s => /gemini/i.test(s))).toEqual([]);
    expect(NOT_CONNECTED).toBe('Injection is not connected on this page.');
  });
});

describe('compile, preview and stale requests', () => {
  it('a 3D fixture compiles in the worker and previews its precomputed slots, labelled as a not-flown fixture', async () => {
    const { source, store } = rig();
    await source.select('3d-sphere');
    expect(source.status.state).toBe('ready');
    if (source.status.state !== 'ready') return;
    expect(statusText(source.status, 40)).toMatch(/^Fixture “Sphere” \(3D\): 40 of 40 slots/);
    expect(source.preview(true)).toBe(true);
    const preview = store.state.preview!;
    expect(preview.source).toBe('fixture');
    expect(preview.formation!.slots).toHaveLength(40);
    expect(preview.formation!.slots.map(s => s.pos)).toEqual(source.status.result.formation.slots.map(s => s.pos));
    expect(preview.recipe).toEqual(PLACEHOLDER_RECIPE);          // a placeholder, never expanded for this preview
    expect(previewLabel(preview)).toBe('PREVIEW · target arrangement (preview), not flown · fixture “Sphere” · local only, nothing is sent');
    for (const text of [statusText(source.status, 40), previewLabel(preview)]) expect(text).not.toMatch(/gemini|live/i);
    source.preview(false);
    expect(store.state.preview).toBe(null);
  });

  it('a stale reply never replaces a newer preview: the newest selection wins whatever order replies arrive in', async () => {
    const { source, posted, reply } = rig(false);
    const first = source.select('3d-sphere');
    await new Promise(r => setTimeout(r, 0));                   // first is compiling (posted)
    const second = source.select('3d-two-spheres');
    await new Promise(r => setTimeout(r, 0));
    expect(posted.map(p => p.requestId)).toEqual(['fc:1', 'fc:2']);
    reply(1);
    await second;
    reply(0);                                                    // the older reply arrives late
    await first;
    expect(source.status.state === 'ready' && source.status.fixtureId).toBe('3d-two-spheres');
    expect(source.status.state === 'ready' && source.status.requestId).toBe('fc:2');
  });

  it('a selection superseded while its file is still loading never compiles', async () => {
    const posted: CompileRequest[] = [];
    const slow: FixtureEntry = { ...fixture('3d-sphere'), id: 'slow', load: () => new Promise(r => setTimeout(() => r(JSON.parse(readFileSync('tests/fixtures/scenes/valid-3d-sphere.json', 'utf8'))), 20)) };
    const client = createFormationClient(() => ({ postMessage: (m: CompileRequest) => { posted.push(m); }, addEventListener: () => {}, terminate: () => {} }));
    const source = createGeneratedSource({ params, client, store: new Store(), fixtures: [slow, fixture('3d-two-spheres')] });
    const a = source.select('slow');
    void source.select('3d-two-spheres');
    await a;
    expect(posted.map(p => p.scene.title)).toEqual(['Two Overlapping Spheres']);
  });

  it('a compile rejection shows its typed reason and clears any older fixture preview from the stage', async () => {
    const { source, store } = rig();
    await source.select('3d-sphere');
    source.preview(true);
    expect(store.state.preview?.source).toBe('fixture');
    await source.select('bad');
    expect(source.status.state).toBe('rejected');
    if (source.status.state !== 'rejected') return;
    expect(source.status.code.length).toBeGreaterThan(0);
    expect(statusText(source.status, 40)).toContain(`was rejected: ${source.status.code}.`);
    expect(store.state.preview).toBe(null);
    expect(source.preview(true)).toBe(false);                   // nothing to preview
  });

  it('a 2D fixture compiles and previews like a 3D one (#212 2D path)', async () => {
    const { source, store } = rig();
    await source.select('2d-disc');
    expect(source.status.state).toBe('ready');
    expect(source.preview(true)).toBe(true);
    expect(store.state.preview?.source).toBe('fixture');
  });

  it('while previewing, a newer compile refreshes the stage to the newest fixture', async () => {
    const { source, store } = rig();
    await source.select('3d-sphere');
    source.preview(true);
    await source.select('3d-primitives');
    expect(store.state.preview?.label).toBe('Primitive Stack');
  });

  // #272 review 1: a preview the operator turned off never comes back when an in-flight compile finishes.
  it('Hide during a compile cancels it: the reply is ignored and the stage stays clear', async () => {
    const { source, store, reply } = rig(false);
    const a = source.select('3d-sphere'); await new Promise(r => setTimeout(r, 0)); reply(0); await a;
    source.preview(true);
    const b = source.select('3d-two-spheres'); await new Promise(r => setTimeout(r, 0));
    expect(source.status.state).toBe('compiling');
    source.preview(false);                                      // Hide (also what leaving the tab or a kind button does)
    expect(source.status.state).toBe('idle');
    reply(1); await b;
    expect(store.state.preview).toBe(null);
    expect(source.status.state).toBe('idle');
  });

  it('Escape (or the console) clearing the stage during a compile: the finished compile does not re-show it', async () => {
    const { source, store, reply } = rig(false);
    const a = source.select('3d-sphere'); await new Promise(r => setTimeout(r, 0)); reply(0); await a;
    source.preview(true);
    const b = source.select('3d-two-spheres'); await new Promise(r => setTimeout(r, 0));
    store.set({ preview: null });                                // Escape, behind the tab's back
    reply(1); await b;
    expect(source.status.state).toBe('ready');                   // the compile still lands in the tab
    expect(store.state.preview).toBe(null);                      // but the stage stays clear
  });

  it('a draft preview set during a compile is never replaced by the fixture (the stage matches what Inject sends)', async () => {
    const { source, store, reply } = rig(false);
    const a = source.select('3d-sphere'); await new Promise(r => setTimeout(r, 0)); reply(0); await a;
    source.preview(true);
    const b = source.select('3d-two-spheres'); await new Promise(r => setTimeout(r, 0));
    store.set({ preview: { recipe: { kind: 'helix' }, label: 'draft' } });   // the operator previews a draft instead
    reply(1); await b;
    expect(store.state.preview).toEqual({ recipe: { kind: 'helix' }, label: 'draft' });
  });

  it('the tab redraws when the stage preview changes elsewhere (its button label never goes stale)', async () => {
    const { source, store } = rig();
    await source.select('3d-sphere');
    source.preview(true);
    let redraws = 0;
    source.subscribe(() => { redraws++; });
    store.set({ preview: null });
    expect(redraws).toBe(1);
    expect(source.previewOn()).toBe(false);
  });

  it('dispose drops the fixture preview and the worker', async () => {
    const { source, store } = rig();
    await source.select('3d-sphere');
    source.preview(true);
    source.dispose();
    expect(store.state.preview).toBe(null);
  });
});

describe('the stage (PreviewLayer)', () => {
  const layerWith = (store: Store) => {
    const scene = new Scene();
    const layer = createPreviewLayer();
    layer.init({ scene, camera: new PerspectiveCamera(), params });
    const off = connectPreview(store);
    const group = scene.children.find(c => c instanceof Group) as Group;
    const rings = group.children.find(c => c instanceof InstancedMesh) as InstancedMesh;
    const positions = () => Array.from({ length: rings.count }, (_, i) => { const m = new Matrix4(); rings.getMatrixAt(i, m); return new Vector3().setFromMatrixPosition(m).toArray(); });
    return { layer, group, rings, positions, done: () => { off(); layer.dispose(); } };
  };

  it('without a formation the path is unchanged: expandRecipe slots, the same label and userData as before', () => {
    const store = new Store();
    const recipe: Recipe = { kind: 'helix' };
    store.set({ preview: { recipe, label: 'Helix draft' } });
    const { layer, group, rings, positions, done } = layerWith(store);
    layer.update({} as never);
    const expected = expandRecipe(recipe, 40, params).slots.map(s => s.pos);
    expect(rings.count).toBe(40);
    positions().forEach((p, i) => expected[i].forEach((v, a) => expect(p[a]).toBeCloseTo(v, 5)));
    expect(group.userData.preview).toEqual({ slots: 40, label: 'Helix draft' });
    expect(previewLabel(store.state.preview!)).toBe('PREVIEW · “Helix draft” · local only, nothing is sent');
    done();
  });

  it('with a formation it draws those slots as given, not the placeholder recipe, and says so', async () => {
    const { source, store } = rig();
    await source.select('3d-two-spheres');
    source.preview(true);
    const { layer, group, positions, done } = layerWith(store);
    layer.update({} as never);
    const want = store.state.preview!.formation!.slots.map(s => s.pos);
    const sphere = expandRecipe(PLACEHOLDER_RECIPE, 40, params).slots.map(s => s.pos);
    positions().forEach((p, i) => want[i].forEach((v, a) => expect(p[a]).toBeCloseTo(v, 5)));
    expect(positions()[0][0]).not.toBeCloseTo(sphere[0][0], 3);
    expect(group.userData.preview).toEqual({ slots: 40, label: 'Two Overlapping Spheres', source: 'fixture' });
    done();
  });
});

describe('budget', () => {
  it('a 3D fixture compiles for preview at the app roster (n0 200)', () => {
    const reply = handleCompileRequest({ requestId: 'b', scene: JSON.parse(readFileSync('tests/fixtures/scenes/valid-3d-sphere.json', 'utf8')), n0: 200, params: makeParams(200) });
    expect(reply.result.ok && reply.result.formation.slots.length).toBe(200);
  });

  // The acceptance is "a 3D fixture previews within the budget": the sphere is held to GF-WP-06's 200 ms cold budget.
  // Every other 3D fixture must compile, and its time is reported, not gated: whether CL-4+ scenes (the full elephant)
  // meet 200 ms is #259's decision GF-D8, and the compile runs in the worker, off the render loop, either way.
  it.runIf(WIDE)('every 3D fixture compiles at n0 200; the sphere within the 200 ms cold budget (P2_WIDE, median of 3)', async () => {
    const { performance } = await import('node:perf_hooks');
    for (const e of fixtureEntries().filter(f => f.id.startsWith('3d-'))) {
      const scene = JSON.parse(readFileSync(`tests/fixtures/scenes/${e.file}`, 'utf8'));
      const times: number[] = [];
      let ok = false;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        ok = handleCompileRequest({ requestId: 'b', scene, n0: 200, params: makeParams(200) }).result.ok;
        times.push(performance.now() - t0);
      }
      const median = [...times].sort((a, b) => a - b)[1];
      console.log(`${e.file}: ok ${ok}, median ${median.toFixed(1)} ms (${times.map(t => t.toFixed(1)).join(', ')})`);
      expect(ok).toBe(true);
      if (e.id === '3d-sphere') expect(median).toBeLessThan(200);
    }
  }, 120_000);
});
