// tests/app/xray/cascadeLayer.test.ts
// #202 (P2-WP-03), E3: the cascade layer draws only with ?p2=cascade AND X-ray, at every render quality level. Without
// the flag it never draws (the default demo is unchanged) and allocates nothing. Opted in, each arrow is a solid 3D
// arrow (instanced cylinder shaft + cone head) sized in metres, in fixed-capacity instance buffers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color, Group, InstancedMesh, Matrix4, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { makeParams } from '../../../src/contracts';
import type { Vec3, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import createLayer, {
  ARROW_HEAD_LENGTH, ARROW_HEAD_RADIUS, ARROW_SHAFT_RADIUS, CASCADE_COMMIT_COLOUR, CASCADE_POP_COLOUR, cascadeOptIn, createCascadeLayer,
} from '../../../src/app/render/layers/CascadeLayer';
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
  const [shafts, heads] = group.children as InstancedMesh[];
  const feed = (s: WorldSnapshot, prev: WorldSnapshot = s) => { layer.ingest!(s); layer.update({ prev, curr: s, alpha: 0, dtReal: 0 }); };
  return { scene, layer, group, shafts, heads, feed };
}
/** Instance `i`'s base, unit direction, length (scale.y) and radius (scale.x). */
function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4(), position = new Vector3(), turn = new Quaternion(), scale = new Vector3();
  mesh.getMatrixAt(i, m); m.decompose(position, turn, scale);
  const dir = new Vector3(0, 1, 0).applyQuaternion(turn);
  return { base: position.toArray(), dir: dir.toArray(), length: scale.y, radius: scale.x, tip: position.clone().addScaledVector(dir, scale.y).toArray() };
}
const close = (a: number[], b: number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 5));
const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => v / 255);
/** Instance colours live in three's linear working space (the renderer shows them as the exact hex). */
const linear = (hex: number, k = 1) => new Color(hex).multiplyScalar(k).toArray();

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

describe('cascade layer: disabled (no ?p2=cascade) is inert', () => {
  it('ingest and update do no work: they never even read the snapshot or frame, and nothing is allocated', () => {
    const { scene, layer, group } = setup(createCascadeLayer({ optIn: false }));
    expect(scene.children).toEqual([group]);
    expect(group.children).toHaveLength(0);         // no meshes, geometry or buffers
    expect(group.visible).toBe(false);
    const untouchable = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
    setViewMode({ xray: true });
    expect(() => layer.ingest!(untouchable as WorldSnapshot)).not.toThrow();
    expect(() => layer.update(untouchable as never)).not.toThrow();
    expect(() => layer.reset!()).not.toThrow();
  });

  it('counts stay 0 through a kill-and-repair stream with X-ray on, at every quality level', () => {
    const { layer, group, feed } = setup(createCascadeLayer({ optIn: false }));
    const before = group.userData.cascade;
    setViewMode({ xray: true });
    for (const level of [0, 1, 4]) {
      layer.setQuality!(level);
      for (let t = 1 + level * 100; t <= 60 + level * 100; t++) {
        const moves: Record<number, D> = {};
        if (t % 3 === 0) moves[t % N] = { slot: (t * 7) % N, target: [t, 35, 0] };   // a change that has arrived
        feed(snap(t, moves));
      }
    }
    expect(group.userData.cascade).toEqual({ drawn: 0, changes: 0, commits: 0, pops: 0, pending: 0, optIn: false });
    expect(group.userData.cascade).toBe(before);    // never even re-published
    expect(group.children).toHaveLength(0);
    expect(group.visible).toBe(false);
    layer.dispose();
  });
});

describe('cascade layer: enabled', () => {
  it('draws one solid arrow per arrived change, from the previous target to the new one, in the commit colour, only in X-ray', () => {
    const { group, shafts, heads, feed } = setup();
    feed(snap(1));
    feed(arrived(2));
    expect(group.visible).toBe(false);              // X-ray off
    expect(group.userData.cascade).toMatchObject({ drawn: 0, changes: 1, commits: 1, pops: 0, pending: 0 });
    setViewMode({ xray: true });
    feed(arrived(3), arrived(2));
    expect(group.visible).toBe(true);
    expect(group.userData.cascade).toMatchObject({ drawn: 1, changes: 1 });
    expect(shafts).toBeInstanceOf(InstancedMesh);
    expect([shafts.count, heads.count]).toEqual([1, 1]);
    // From the previous target (5, 30, 0) to the new one (20, 30, 0): 15 m along +x.
    const s = instance(shafts, 0), h = instance(heads, 0);
    close(s.base, [5, 30, 0]);
    close(s.dir, [1, 0, 0]);
    close(h.tip, [20, 30, 0]);                      // the head's tip is the new target
    close(s.tip, h.base);                           // the shaft ends where the head begins
    expect(h.length).toBeCloseTo(ARROW_HEAD_LENGTH, 5);
    expect(h.radius).toBeCloseTo(ARROW_HEAD_RADIUS, 5);
    expect(s.radius).toBeCloseTo(ARROW_SHAFT_RADIUS, 5);
    const c = new Color(), brightness = 1 - 1 / 120;  // shown at tick 2, drawn at tick 3
    shafts.getColorAt(0, c);
    close(c.toArray(), linear(CASCADE_COMMIT_COLOUR, brightness));
    heads.getColorAt(0, c);
    close(c.toArray(), linear(CASCADE_COMMIT_COLOUR, brightness));
  });

  it('is many pixels wide at the audience camera, unlike a 1 px heartbeat line', () => {
    // Audience camera: 95 m away, fov 50 (CameraRig). Half the 900 px canvas is one pane in split view.
    const pxPerMetre = 450 / (2 * 95 * Math.tan((50 / 2) * Math.PI / 180));
    expect(2 * ARROW_SHAFT_RADIUS * pxPerMetre).toBeGreaterThanOrEqual(3);
    expect(2 * ARROW_HEAD_RADIUS * pxPerMetre).toBeGreaterThanOrEqual(8);
  });

  it('a short arrow keeps its head within 40% of its length and its shaft thinner than its head', () => {
    const { shafts, heads, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    feed(snap(2, { 5: { slot: 2, target: [7, 30, 0] } }));   // 2 m
    const s = instance(shafts, 0), h = instance(heads, 0);
    expect(h.length).toBeCloseTo(0.8, 5);
    expect(h.radius).toBeLessThanOrEqual(0.4 + 1e-6);   // float32 matrices
    expect(s.radius).toBeLessThan(h.radius);
    close(h.tip, [7, 30, 0]);
  });

  it('a pop uses the pop colour; the two colours are distinct from the existing X-ray meanings and the cyan claims', () => {
    const { shafts, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    feed(snap(2, { 1: { slot: 9, target: [-3, 30, 0] } }));
    const c = new Color(); shafts.getColorAt(0, c);
    close(c.toArray(), linear(CASCADE_POP_COLOUR));
    const taken = [0xffb547, 0xff5a1f, 0xff4fd8, 0xffffff, 0xd55e00, 0xf0e442];   // amber, vermilion, magenta, white, jam, partition
    expect(taken).not.toContain(CASCADE_COMMIT_COLOUR);
    expect(taken).not.toContain(CASCADE_POP_COLOUR);
    expect(CASCADE_COMMIT_COLOUR).not.toBe(CASCADE_POP_COLOUR);
    // Away from the claim-heartbeat cyan (radioTrace: 0.12, 0.95, 1): the commit green carries little blue.
    const [r, g, b] = rgb(CASCADE_COMMIT_COLOUR);
    expect(g).toBeGreaterThan(0.9);
    expect(b).toBeLessThan(0.3);
    expect(Math.hypot(r - 0.12, g - 0.95, b - 1)).toBeGreaterThan(0.75);
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

  it('stays on at every quality level (an automatic step-down never hides it); setVisible(false) hides it', () => {
    const { layer, group, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    for (const [i, level] of [1, 2, 3, 4].entries()) {
      layer.setQuality!(level);
      feed(arrived(2 + i));
      expect(group.visible, `level ${level}`).toBe(true);
      expect(group.userData.cascade).toMatchObject({ drawn: 1, quality: level });
    }
    layer.setVisible(false);
    expect(group.visible).toBe(false);
    feed(arrived(10));
    expect(group.visible).toBe(false);
    layer.setVisible(true);
    feed(arrived(11));
    expect(group.visible).toBe(true);
  });

  it('reuses its fixed-capacity instance buffers across updates and caps the arrows at capacity', () => {
    const { group, shafts, heads, feed } = setup(createCascadeLayer({ optIn: true, capacity: 3 }));
    setViewMode({ xray: true });
    const matrices = shafts.instanceMatrix, colours = heads.instanceColor;
    expect(matrices.count).toBe(3);
    expect(colours?.count).toBe(3);
    feed(snap(1));
    const moves: Record<number, D> = {};
    for (let i = 10; i < 16; i++) moves[i] = { slot: i + 20, target: [i, 40, 0] };   // six drones change and arrive
    feed(snap(2, moves));
    expect(shafts.instanceMatrix).toBe(matrices);
    expect(heads.instanceColor).toBe(colours);
    expect([shafts.count, heads.count]).toEqual([3, 3]);
    expect(group.userData.cascade).toMatchObject({ changes: 6, drawn: 3 });
    for (let t = 3; t < 10; t++) feed(snap(t, moves));
    expect(shafts.instanceMatrix).toBe(matrices);
  });

  it('reset clears the trail; dispose removes it from the scene', () => {
    const { scene, layer, group, shafts, feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1)); feed(arrived(2));
    layer.reset!();
    expect(group.visible).toBe(false);
    expect(shafts.count).toBe(0);
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
    it(`${optIn ? 'with' : 'without'} ?p2=cascade: visible exactly when ${optIn ? 'X-ray is on, still ingesting while hidden' : 'never, and inert'}`, () => {
      for (const beat of DEMO_BEATS) {
        const tick = Math.max(2, dispatchTick(beat));
        const { layer, group, feed } = setup(createCascadeLayer({ optIn }));
        const view = demoViewAt(tick);
        setViewMode(view);
        feed(snap(tick - 1));
        feed(arrived(tick));
        expect(group.userData.cascade.changes, beat.id).toBe(optIn ? 1 : 0);
        expect(group.visible, beat.id).toBe(optIn && view.xray);
        layer.dispose();
      }
    });
  }
});
