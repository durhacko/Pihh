// tests/app/xray/cascadeLayer.test.ts
// #202 (P2-WP-03): the cascade layer draws only with ?p2=cascade AND X-ray AND quality level 0. Without the flag it
// never draws (the default demo is unchanged), but it keeps ingesting. Fixed-capacity buffers, no reallocation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, LineSegments, PerspectiveCamera, Scene } from 'three';
import { makeParams } from '../../../src/contracts';
import type { Vec3, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import createLayer, { CASCADE_COMMIT_COLOUR, CASCADE_POP_COLOUR, cascadeOptIn, createCascadeLayer } from '../../../src/app/render/layers/CascadeLayer';
import { createLayers } from '../../../src/app/render/layers';
import { resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';
import { DEMO_BEATS, demoViewAt, dispatchTick } from '../../../src/app/ui/DemoScript';
import type { Layer } from '../../../src/app/render/Layer';

afterEach(() => { resetViewMode(); vi.unstubAllGlobals(); });

const N = 40;
const params = makeParams(N);
interface D { slot?: number; target?: Vec3; pos?: Vec3 }
function snap(tick: number, overrides: Record<number, D> = {}): WorldSnapshot {
  const base = makeFakeSnapshot(tick, N);
  return {
    ...base, radio: [],
    drones: base.drones.map((d, i) => {
      const o = overrides[i] ?? {};
      const target = o.target ?? [i, 30, 0] as Vec3;
      return { ...d, alive: true, diedTick: null, pos: o.pos ?? [...target] as Vec3, belief: { ...d.belief, slot: o.slot ?? i, target } };
    }),
  };
}
/** Drone 5 commits to slot 2 at `tick` and is already on its new target (it arrived): one drawable arrow. */
function arrived(tick: number): WorldSnapshot { return snap(tick, { 5: { slot: 2, target: [20, 30, 0] } }); }

function setup(layer: Layer = createCascadeLayer({ optIn: true })) {
  const scene = new Scene();
  layer.init({ scene, camera: new PerspectiveCamera(), params });
  const group = scene.children[0] as Group;
  const [shafts, heads] = group.children as LineSegments[];
  const feed = (s: WorldSnapshot, prev: WorldSnapshot = s) => { layer.ingest!(s); layer.update({ prev, curr: s, alpha: 0, dtReal: 0 }); };
  return { scene, layer, group, shafts, heads, feed };
}

describe('cascade layer: opt-in flag', () => {
  it('parses ?p2=<name>[,<name>…] for exactly "cascade"', () => {
    expect(cascadeOptIn('')).toBe(false);
    expect(cascadeOptIn('?p2=cascade')).toBe(true);
    expect(cascadeOptIn('?q=low&p2=inv,cascade')).toBe(true);
    expect(cascadeOptIn('?p2=cascades')).toBe(false);
    expect(cascadeOptIn('?cascade=1')).toBe(false);
  });

  it('the registered default layer reads the flag once from location in init, and is off without a location', () => {
    expect(createLayers().map(layer => layer.id)).toContain('cascade');
    const off = setup(createLayer());               // node: no location
    expect(off.group.userData.cascade.optIn).toBe(false);
    vi.stubGlobal('location', { search: '?p2=cascade' });
    const on = setup(createLayer());
    expect(on.group.userData.cascade.optIn).toBe(true);
    vi.stubGlobal('location', { search: '' });       // read once: a later URL change does not switch it
    setViewMode({ xray: true });
    on.feed(snap(1)); on.feed(arrived(2));
    expect(on.group.visible).toBe(true);
  });
});

describe('cascade layer: enabled', () => {
  it('draws one arrow (shaft + two-stroke head) per arrived change, in the commit colour, only in X-ray', () => {
    const { group, shafts, heads, feed } = setup();
    feed(snap(1));
    feed(arrived(2));
    expect(group.visible).toBe(false);              // X-ray off
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 1, commits: 1, pops: 0, pending: 0 });
    setViewMode({ xray: true });
    feed(arrived(3), arrived(2));
    expect(group.visible).toBe(true);
    expect(group.userData.cascade).toMatchObject({ drawn: 1, changes: 1 });
    expect(shafts.geometry.drawRange.count).toBe(2);
    expect(heads.geometry.drawRange.count).toBe(4);
    const p = shafts.geometry.getAttribute('position');
    expect([p.getX(0), p.getY(0), p.getZ(0)]).toEqual([5, 30, 0]);   // the previous target
    expect([p.getX(1), p.getY(1), p.getZ(1)]).toEqual([20, 30, 0]);  // the new one
    const h = heads.geometry.getAttribute('position');
    for (const v of [0, 2]) expect([h.getX(v), h.getY(v), h.getZ(v)]).toEqual([20, 30, 0]);   // both strokes at the tip
    const c = shafts.geometry.getAttribute('color');
    const brightness = 1 - 1 / 120;                 // shown at tick 2, drawn at tick 3
    expect(c.getX(0)).toBeCloseTo(((CASCADE_COMMIT_COLOUR >> 16) & 255) / 255 * brightness, 5);
    expect(c.getY(0)).toBeCloseTo(((CASCADE_COMMIT_COLOUR >> 8) & 255) / 255 * brightness, 5);
  });

  it('a pop uses the pop colour; the two colours are distinct from the existing X-ray meanings', () => {
    const { shafts, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    feed(snap(2, { 1: { slot: 9, target: [-3, 30, 0] } }));
    const c = shafts.geometry.getAttribute('color');
    expect(c.getZ(0)).toBeCloseTo((CASCADE_POP_COLOUR & 255) / 255, 5);
    const taken = [0xffb547, 0xff5a1f, 0xff4fd8, 0xffffff, 0xd55e00, 0xf0e442];   // amber, vermilion, magenta, white, jam, partition
    expect(taken).not.toContain(CASCADE_COMMIT_COLOUR);
    expect(taken).not.toContain(CASCADE_POP_COLOUR);
    expect(CASCADE_COMMIT_COLOUR).not.toBe(CASCADE_POP_COLOUR);
  });

  it('draws nothing for unchanged drones (the static arm) and nothing while a changed drone is still in flight', () => {
    const { group, feed } = setup();
    setViewMode({ xray: true });
    for (let t = 1; t <= 50; t++) feed(snap(t));
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 0 });
    expect(group.visible).toBe(false);
    feed(snap(51, { 5: { slot: 2, target: [20, 30, 0], pos: [5, 30, 0] } }));    // committed, not there yet: tether
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 1, pending: 1 });
    expect(group.visible).toBe(false);
  });

  it('quality above 0 and setVisible(false) hide it; it keeps counting and comes back at level 0', () => {
    const { layer, group, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    layer.setQuality!(1);
    feed(arrived(2));
    expect(group.visible).toBe(false);
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 1 });
    layer.setQuality!(0);
    feed(arrived(3));
    expect(group.visible).toBe(true);
    layer.setVisible(false);
    expect(group.visible).toBe(false);
    feed(arrived(4));
    expect(group.visible).toBe(false);
  });

  it('reuses its fixed-capacity buffers across updates and caps the arrows at capacity', () => {
    const { group, shafts, heads, feed } = setup(createCascadeLayer({ optIn: true, capacity: 3 }));
    setViewMode({ xray: true });
    const position = shafts.geometry.getAttribute('position');
    const colour = heads.geometry.getAttribute('color');
    feed(snap(1));
    const moves: Record<number, D> = {};
    for (let i = 10; i < 16; i++) moves[i] = { slot: i + 20, target: [i, 40, 0] };   // six drones change and arrive
    feed(snap(2, moves));
    expect(shafts.geometry.getAttribute('position')).toBe(position);
    expect(heads.geometry.getAttribute('color')).toBe(colour);
    expect(position.count).toBe(6);                 // 3 arrows × 2 vertices, allocated once
    expect(group.userData.cascade).toMatchObject({ changes: 6, drawn: 3 });
    for (let t = 3; t < 10; t++) feed(snap(t, moves));
    expect(shafts.geometry.getAttribute('position')).toBe(position);
  });

  it('reset clears the trail; dispose removes it from the scene', () => {
    const { scene, layer, group, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1)); feed(arrived(2));
    layer.reset!();
    expect(group.visible).toBe(false);
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 0 });
    layer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

// P2-T18 (PHASE2_EVALUATION §12): opt-in only, printed, never stored. S2, n0 200, 1800 ticks, Encore arm, recorded
// once; then only the addition is timed: ingest per tick, and the layer's per-frame update (opted in, X-ray on)
// against a stub scene. One discarded warm-up pass, then 5; pass if the median per-pass mean is <= 0.5 ms/tick.
describe.skipIf(!process.env.P2_PERF)('P2-T18: cascade cost at n0 200 (P2_PERF=1)', () => {
  it('ingest and the per-frame update each stay within 0.5 ms/tick/world', async () => {
    const { performance } = await import('node:perf_hooks');
    const { buildScenario } = await import('../../../src/cli/scenarios');
    const { createWorlds } = await import('../../../src/app/worlds');
    const wide = makeParams(200);
    const scenario = buildScenario('S2', 1, wide);
    const worlds = createWorlds({ seed: 1, params: wide, score: scenario.score, events: scenario.events });
    const stream: WorldSnapshot[] = [];
    for (let t = 1; t <= scenario.ticks; t++) stream.push(worlds.stepBoth().encore);
    const time = (label: string, pass: () => number[]) => {
      pass();                                        // warm-up, discarded
      const means: number[] = [];
      let worst = 0;
      for (let p = 0; p < 5; p++) {
        const per = pass();
        means.push(per.reduce((a, b) => a + b, 0) / per.length);
        for (let w = 0; w + 100 <= per.length; w += 100) worst = Math.max(worst, per.slice(w, w + 100).reduce((a, b) => a + b, 0) / 100);
      }
      const median = [...means].sort((a, b) => a - b)[2];
      console.log(`P2-T18 ${label}: median of 5 per-pass means ${median.toFixed(4)} ms/tick (passes ${means.map(m => m.toFixed(4)).join(', ')}); worst 100-tick window ${worst.toFixed(4)} ms/tick`);
      return median;
    };
    const ingest = time('ingest', () => {
      const scene = new Scene();
      const layer = createCascadeLayer({ optIn: true });
      layer.init({ scene, camera: new PerspectiveCamera(), params: wide });
      return stream.map(s => { const t0 = performance.now(); layer.ingest!(s); return performance.now() - t0; });
    });
    setViewMode({ xray: true });
    let changes = 0, drawnMax = 0;
    const update = time('update (opted in, X-ray)', () => {
      const scene = new Scene();
      const layer = createCascadeLayer({ optIn: true });
      layer.init({ scene, camera: new PerspectiveCamera(), params: wide });
      const group = scene.children[0] as Group;
      const out = stream.map((s, i) => {
        layer.ingest!(s);
        const t0 = performance.now();
        layer.update({ prev: stream[Math.max(0, i - 1)], curr: s, alpha: 0.5, dtReal: 0 });
        const dt = performance.now() - t0;
        drawnMax = Math.max(drawnMax, group.userData.cascade.drawn);
        return dt;
      });
      changes = group.userData.cascade.changes;
      return out;
    });
    console.log(`P2-T18 stream: S2 seed 1, ${stream.length} ticks, ${changes} observed slot changes (observer: ${worlds.observers.encore.summary().slotChanges}), at most ${drawnMax} arrows in one frame`);
    expect(changes).toBe(worlds.observers.encore.summary().slotChanges);
    expect(ingest).toBeLessThanOrEqual(0.5);
    expect(update).toBeLessThanOrEqual(0.5);
  }, 300_000);
});

describe('cascade layer: the scripted demo without and with the flag', () => {
  // At every demo beat, with the overlays the script has set by then, a fresh arrived change is offered to the layer.
  for (const optIn of [false, true]) {
    it(`${optIn ? 'with' : 'without'} ?p2=cascade: visible exactly when ${optIn ? 'X-ray is on' : 'never'}, still ingesting`, () => {
      for (const beat of DEMO_BEATS) {
        const tick = Math.max(2, dispatchTick(beat));
        const { layer, group, feed } = setup(createCascadeLayer({ optIn }));
        const view = demoViewAt(tick);
        setViewMode(view);
        feed(snap(tick - 1));
        feed(arrived(tick));
        expect(group.userData.cascade.changes, beat.id).toBe(1);
        expect(group.visible, beat.id).toBe(optIn && view.xray);
        layer.dispose();
      }
    });
  }
});
