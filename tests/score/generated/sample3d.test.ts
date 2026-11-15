// tests/score/generated/sample3d.test.ts
// GF-WP-05 (#211): area-weighted sampling (GF-T11), union-aware filtering (GF-T12), visibility and the Q(p) terms
// (GF-T14), mirror-x candidates and dense points (GF-T15 (2)), counts, colours, dense and determinism.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import type { Vec3 } from '../../../src/contracts';
import type { SceneSpec3D } from '../../../src/score/generated/types';
import { validateScene } from '../../../src/score/generated/validation';
import { buildSolid, buildSolids, type Part3DInput, type Scene3DInput } from '../../../src/score/generated/shapes3d';
import { apportion, candidateTotal, HIDDEN_EPSILON, rankQ, sample3d, viewDirection, type Sample3DResult } from '../../../src/score/generated/sample3d';

/** Test-only seeded stream (the compiler's own is GF-WP-02's sfc32): mulberry32 seeded by FNV-1a of the label.
 *  Repeated in shapes3d.test.ts on purpose: importing a test file would re-register its tests here. */
function testStream(label: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const part = (id: string, shape: Part3DInput['shape'], extra: Partial<Part3DInput> = {}): Part3DInput => ({ id, shape, materialId: 'grey', importance: 3, ...extra });
const scene = (parts: Part3DInput[], referenceView: Scene3DInput['referenceView'] = 'front'): Scene3DInput => ({
  referenceView, parts, materials: [{ id: 'grey', rgb: [0.5, 0.5, 0.55] }, { id: 'ivory', rgb: [0.95, 0.92, 0.8] }, { id: 'pink', rgb: [0.9, 0.5, 0.6] }],
});
const run = (s: Scene3DInput, n0 = 200): Sample3DResult => sample3d(s, buildSolids(s), { n0, referenceView: s.referenceView, stream: testStream });
const toScene = (r: Sample3DResult, p: Vec3): Vec3 => [p[0] / r.stats.normalise, (p[1] + r.stats.offset[1]) / r.stats.normalise, (p[2] + r.stats.offset[2]) / r.stats.normalise];
const len = (v: Vec3) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A full-body elephant facing +z (William's handoff §5.1 parts, completed; legs, ears and tusks mirrored). CL-4-like. */
const ELEPHANT = scene([
  part('body', { type: 'ellipsoid', center: [0, 0.1, -0.1], radii: [0.45, 0.42, 0.7] }, { importance: 5 }),
  part('head', { type: 'ellipsoid', center: [0, 0.32, 0.62], radii: [0.3, 0.3, 0.28] }, { importance: 5 }),
  part('trunk', { type: 'taperedTube', points: [[0, 0.2, 0.85], [0, -0.05, 1.02], [0, -0.32, 1.06], [0, -0.58, 1.0]], startRadius: 0.1, endRadius: 0.04 }, { importance: 5 }),
  part('ear', { type: 'ellipsoid', center: [0.34, 0.36, 0.5], radii: [0.06, 0.26, 0.2], rotationDeg: [0, 20, 0] }, { importance: 4, symmetry: 'mirror-x', materialId: 'pink' }),
  part('tusk', { type: 'cone', center: [0.13, 0.04, 0.88], baseRadius: 0.035, topRadius: 0.005, height: 0.32, rotationDeg: [70, 0, 0] }, { importance: 5, symmetry: 'mirror-x', materialId: 'ivory' }),
  part('front-leg', { type: 'cylinder', center: [0.25, -0.5, 0.3], radius: 0.11, height: 0.6 }, { importance: 4, symmetry: 'mirror-x' }),
  part('back-leg', { type: 'cylinder', center: [0.25, -0.5, -0.5], radius: 0.12, height: 0.6 }, { importance: 4, symmetry: 'mirror-x' }),
  part('tail', { type: 'capsule', center: [0, 0.05, -0.85], radius: 0.025, length: 0.3, rotationDeg: [-30, 0, 0] }, { importance: 4 }),
]);

// ---- GF-T11 helpers: equal-area bands along an axis of an ellipsoid, computed numerically; χ² against uniform.
function equalAreaEdges(radii: Vec3, axis: number, bands: number): number[] {
  const BINS = 20000, TH = 600, PH = 1200;
  const hist = new Float64Array(BINS);
  const ext = radii[axis];
  const r = (t: number, p: number): Vec3 => [radii[0] * Math.sin(t) * Math.cos(p), radii[1] * Math.cos(t), radii[2] * Math.sin(t) * Math.sin(p)];
  for (let i = 0; i < TH; i++) for (let j = 0; j < PH; j++) {
    const t = ((i + 0.5) / TH) * Math.PI, p = ((j + 0.5) / PH) * 2 * Math.PI, dt = Math.PI / TH, dp = (2 * Math.PI) / PH;
    const a = r(t, p), rt = sub(r(t + 1e-6, p), a).map(v => v / 1e-6) as Vec3, rp = sub(r(t, p + 1e-6), a).map(v => v / 1e-6) as Vec3;
    const c: Vec3 = [rt[1] * rp[2] - rt[2] * rp[1], rt[2] * rp[0] - rt[0] * rp[2], rt[0] * rp[1] - rt[1] * rp[0]];
    hist[Math.min(BINS - 1, Math.floor(((a[axis] / ext + 1) / 2) * BINS))] += len(c) * dt * dp;
  }
  const total = hist.reduce((x, y) => x + y, 0);
  const edges: number[] = [];
  let acc = 0, band = 1;
  for (let b = 0; b < BINS && band < bands; b++) { acc += hist[b]; while (band < bands && acc >= (total * band) / bands) { edges.push(-ext + (2 * ext * (b + 1)) / BINS); band++; } }
  return edges;
}
function chiSquare(values: number[], edges: number[]): number {
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) { let k = 0; while (k < edges.length && v >= edges[k]) k++; counts[k]++; }
  const expected = values.length / counts.length;
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
}
const CHI2_11_P01 = 24.725;   // df = 11 (12 bands), p = 0.01

// Default-suite budget (WP §2.3 item 7): the numerically integrated bands (both shapes, every axis) run only with
// P2_WIDE=1. The default smoke uses Archimedes' exact equal-area bands of a sphere (equal-height slabs).
const WIDE = Boolean(process.env.P2_WIDE);
const SLABS = Array.from({ length: 11 }, (_, k) => -1 + (2 * (k + 1)) / 12);

describe('GF-T11: area-weighted sampling passes the equal-area band test; naive polar sampling fails it', () => {
  it(`sphere, exact equal-area slabs along y (default smoke): χ² < ${CHI2_11_P01}; polar-angle sampling fails`, () => {
    const solid = buildSolid(part('e', { type: 'ellipsoid', center: [0, 0, 0], radii: [1, 1, 1] }), 0);
    expect(chiSquare(solid.surface(4000, testStream('gf-t11:smoke')).map(s => s.pos[1]), SLABS)).toBeLessThan(CHI2_11_P01);
    const next = testStream('naive');
    const ys: number[] = [];
    for (let i = 0; i < 4000; i++) ys.push(Math.cos(Math.PI * next()));
    expect(chiSquare(ys, SLABS)).toBeGreaterThan(CHI2_11_P01 * 4);
  });

  const cases: [string, Vec3][] = [['sphere', [1, 1, 1]], ['ellipsoid (1, 0.5, 0.3)', [1, 0.5, 0.3]]];
  for (const [name, radii] of cases) {
    it.runIf(WIDE)(`${name}: 12 equal-area bands along each axis, χ² < ${CHI2_11_P01} (p > 0.01; P2_WIDE)`, () => {
      const solid = buildSolid(part('e', { type: 'ellipsoid', center: [0, 0, 0], radii }), 0);
      const samples = solid.surface(4000, testStream(`gf-t11:${name}`));
      for (let axis = 0; axis < 3; axis++) {
        const edges = equalAreaEdges(radii, axis, 12);
        expect(edges).toHaveLength(11);
        expect(chiSquare(samples.map(s => s.pos[axis]), edges), `axis ${axis}`).toBeLessThan(CHI2_11_P01);
      }
    }, 30_000);
  }

  it.runIf(WIDE)('negative control: uniform polar-angle sampling of the same sphere fails the integrated-band test (P2_WIDE)', () => {
    const next = testStream('naive');
    const ys: number[] = [];
    for (let i = 0; i < 4000; i++) { const theta = Math.PI * next(); ys.push(Math.cos(theta)); void next(); }
    expect(chiSquare(ys, equalAreaEdges([1, 1, 1], 1, 12))).toBeGreaterThan(CHI2_11_P01 * 4);
  }, 30_000);
});

describe('GF-T12: union-aware interior filtering', () => {
  it('two overlapping spheres: no candidate or dense point lies more than ε inside the other sphere', () => {
    const s = scene([part('a', { type: 'ellipsoid', center: [-0.3, 0, 0], radii: [0.5, 0.5, 0.5] }), part('b', { type: 'ellipsoid', center: [0.3, 0, 0], radii: [0.5, 0.5, 0.5] })]);
    const r = run(s);
    const eps = HIDDEN_EPSILON / r.stats.normalise;
    const centres: Vec3[] = [[-0.3, 0, 0], [0.3, 0, 0]];
    for (const c of r.candidates) expect(0.5 - len(sub(toScene(r, c.pos), centres[1 - c.solid]))).toBeLessThanOrEqual(eps + 1e-12);
    r.dense.forEach((p, i) => expect(0.5 - len(sub(toScene(r, p), centres[1 - r.denseSolid[i]]))).toBeLessThanOrEqual(eps + 1e-12));
    // Each sphere's cap inside the other is about 20% of its area (cap height 0.2 of radius 0.5: h/2r).
    for (const id of ['a', 'b']) {
      expect(r.stats.hiddenFraction[id]).toBeGreaterThan(0.15);
      expect(r.stats.hiddenFraction[id]).toBeLessThan(0.25);
    }
  });

  it('a tusk half-embedded in the head keeps its exposed candidates, all outside the head', () => {
    const s = scene([
      part('head', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.4, 0.4, 0.4] }, { importance: 5 }),
      part('tusk', { type: 'cone', center: [0, 0, 0.4], baseRadius: 0.06, topRadius: 0.01, height: 0.5, rotationDeg: [90, 0, 0] }, { importance: 5, materialId: 'ivory' }),
    ]);
    const r = run(s);
    const tusk = r.candidates.filter(c => c.featureId === 'tusk');
    expect(tusk.length).toBeGreaterThan(10);
    expect(r.stats.hiddenFraction.tusk).toBeGreaterThan(0.2);
    expect(r.stats.hiddenFraction.tusk).toBeLessThan(0.8);
    const eps = HIDDEN_EPSILON / r.stats.normalise;
    for (const c of tusk) expect(0.4 - len(toScene(r, c.pos))).toBeLessThanOrEqual(eps + 1e-12);
    expect(r.warnings).toEqual([]);
  });

  it('a protected part losing more than 80% warns `feature-mostly-hidden` naming it; an unprotected one does not', () => {
    const inner = (importance: number) => scene([
      part('big', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.6, 0.6, 0.6] }),
      part('nub', { type: 'ellipsoid', center: [0.48, 0, 0], radii: [0.15, 0.15, 0.15] }, { importance }),   // about 10% pokes out
    ]);
    const protectedRun = run(inner(4));
    expect(protectedRun.stats.hiddenFraction.nub).toBeGreaterThan(0.8);
    expect(protectedRun.warnings).toEqual([{ code: 'feature-mostly-hidden', partId: 'nub', detail: expect.any(String) }]);
    expect(protectedRun.candidates.filter(c => c.featureId === 'nub').length).toBeLessThan(protectedRun.stats.raw.nub * 0.2);   // never reinstated
    expect(run(inner(3)).warnings).toEqual([]);
  });

  it('tangent and coincident parts keep their exposed points', () => {
    const tangent = run(scene([part('a', { type: 'ellipsoid', center: [-0.5, 0, 0], radii: [0.5, 0.5, 0.5] }), part('b', { type: 'ellipsoid', center: [0.5, 0, 0], radii: [0.5, 0.5, 0.5] })]));
    expect(tangent.stats.hiddenFraction).toEqual({ a: 0, b: 0 });
    const same = run(scene([part('a', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.5, 0.4, 0.3] }), part('b', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.5, 0.4, 0.3] })]));
    expect(same.stats.hiddenFraction).toEqual({ a: 0, b: 0 });
  });
});

describe('GF-T14: visibility from the reference view, and the Q(p) terms', () => {
  it('reference views are the CameraRig presets, unit length, audience on +z', () => {
    expect(viewDirection('side')).toEqual([1, 0, 0]);
    for (const v of ['front', 'three-quarter', 'side'] as const) expect(len(viewDirection(v))).toBeCloseTo(1, 12);
    const f = viewDirection('front');
    expect(f[2]).toBeGreaterThan(0.95);
    expect(f[1]).toBeLessThan(0);
  });

  it('V = max(0, n · v_ref); with equal I and D terms a camera-facing candidate ranks above a back-facing one', () => {
    const r = run(scene([part('ball', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.5, 0.5, 0.5] })]));
    const v = viewDirection('front');
    let front = 0, back = 0;
    for (const c of r.candidates) {
      const d = c.normal[0] * v[0] + c.normal[1] * v[1] + c.normal[2] * v[2];
      expect(c.visibility).toBe(Math.max(0, d));
      if (c.visibility > 0) front++; else back++;
    }
    expect(front).toBeGreaterThan(1500); expect(back).toBeGreaterThan(1500);   // half a sphere each way
    const facing = r.candidates.find(c => c.visibility > 0.9)!, away = r.candidates.find(c => c.visibility === 0)!;
    expect(rankQ(facing, 1)).toBeGreaterThan(rankQ(away, 1));
    expect(rankQ({ importance: 5, visibility: 0 }, 1)).toBeGreaterThan(rankQ({ importance: 1, visibility: 0 }, 1));
    expect(rankQ({ importance: 3, visibility: 0.5 }, 9)).toBe(rankQ({ importance: 3, visibility: 0.5 }, 2));   // D capped at 2
  });
});

describe('GF-T15 (2): a mirror copy\'s candidates and dense points are the exact x-negation of the original\'s', () => {
  it('on a scene symmetric by construction, per part and in order', () => {
    const r = run(ELEPHANT);
    for (const id of ['ear', 'tusk', 'front-leg', 'back-leg']) {
      const a = r.candidates.filter(c => c.featureId === id), b = r.candidates.filter(c => c.featureId === `${id}~m`);
      expect(a.length, id).toBeGreaterThan(0);
      expect(b.length, id).toBe(a.length);
      b.forEach((c, i) => {
        expect(c.pos).toEqual([-a[i].pos[0], a[i].pos[1], a[i].pos[2]]);
        expect(c.normal).toEqual([-a[i].normal[0], a[i].normal[1], a[i].normal[2]]);
        expect(c.colour).toEqual(a[i].colour);
        expect(c.importance).toBe(a[i].importance);
      });
      const solids = buildSolids(ELEPHANT).map(s => s.id);
      const da = r.dense.filter((_, i) => solids[r.denseSolid[i]] === id), db = r.dense.filter((_, i) => solids[r.denseSolid[i]] === `${id}~m`);
      expect(db).toEqual(da.map(p => [-p[0], p[1], p[2]]));
    }
  });
});

describe('#203 fixtures: every valid 3D scene, validated by validateScene, samples through the adapter', () => {
  const dir = 'tests/fixtures/scenes';
  const files = readdirSync(dir).filter(f => /^valid-3d-.*\.json$/.test(f)).sort();
  it('finds the 3D fixtures', () => expect(files.length).toBeGreaterThanOrEqual(5));
  for (const file of files) {
    it(`${file}: SceneSpec3D in, candidates and dense out (n0 40 and 200)`, () => {
      const verdict = validateScene(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')));
      expect(verdict.ok).toBe(true);
      if (!verdict.ok || verdict.scene.mode !== 'scene3d') throw new Error(`${file} is not a valid 3D scene`);
      const scene: SceneSpec3D = verdict.scene;                    // the #203 type, accepted as it is
      const solids = buildSolids(scene);
      const mirrored = scene.parts.filter(p => p.symmetry === 'mirror-x').length;
      expect(solids.length).toBeGreaterThanOrEqual(scene.parts.length);
      expect(solids.length).toBeLessThanOrEqual(scene.parts.length + mirrored);
      for (const n0 of [40, 200]) {
        const r = sample3d(scene, solids, { n0, referenceView: scene.referenceView, stream: testStream });
        expect(r.candidates.length).toBeGreaterThan(4 * n0);
        expect(r.dense.length).toBeGreaterThanOrEqual(1500);
        expect(r.dense.length).toBeLessThanOrEqual(2500);
        for (const c of r.candidates) {
          expect(c.pos.every(Number.isFinite)).toBe(true);
          expect(Math.abs(len(c.normal) - 1)).toBeLessThan(1e-12);
          expect(c.colour).toEqual(scene.materials.find(m => m.id === scene.parts[solids[c.solid].partIndex].materialId)!.rgb);
        }
      }
    });
  }
});

describe('counts, colours, dense and determinism', () => {
  it('candidate total is clamp(20·n0, 2000, 5000), apportioned by area (largest remainder)', () => {
    expect([40, 100, 200, 250, 400].map(candidateTotal)).toEqual([2000, 2000, 4000, 5000, 5000]);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [0, 2, 1])).toEqual([0, 5, 2]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
    for (const n0 of [40, 200]) {
      const r = run(ELEPHANT, n0);
      const raw = Object.values(r.stats.raw).reduce((a, b) => a + b, 0);
      expect(raw).toBeGreaterThanOrEqual(candidateTotal(n0));
      expect(raw).toBeLessThanOrEqual(candidateTotal(n0) + 8);      // + one per mirrored part (ceil of the pair's half)
      expect(r.candidates.length).toBeGreaterThan(4 * n0);
    }
  });

  it('every candidate: unit normal, its material colour, its part id; positions in the normalised box', () => {
    const r = run(ELEPHANT);
    const material = Object.fromEntries(ELEPHANT.parts.map(p => [p.id, ELEPHANT.materials.find(m => m.id === p.materialId)!.rgb]));
    for (const c of r.candidates) {
      expect(Math.abs(len(c.normal) - 1)).toBeLessThan(1e-12);
      expect(c.colour).toEqual(material[c.featureId.replace(/~m$/, '')]);
      expect(c.source).toBe('surface');
      for (const a of [0, 1, 2]) expect(Math.abs(c.pos[a])).toBeLessThanOrEqual(1.1 + 1e-9);
    }
    expect(r.stats.exposedArea).toBeGreaterThan(0);
  });

  it('dense has 1,500-2,500 points of the exposed surface, none hidden, for every fixture', () => {
    for (const s of [ELEPHANT, scene([part('ball', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.5, 0.5, 0.5] })]),
      scene([part('a', { type: 'ellipsoid', center: [-0.3, 0, 0], radii: [0.5, 0.5, 0.5] }), part('b', { type: 'ellipsoid', center: [0.3, 0, 0], radii: [0.5, 0.5, 0.5] })])]) {
      const r = run(s);
      expect(r.dense.length).toBeGreaterThanOrEqual(1500);
      expect(r.dense.length).toBeLessThanOrEqual(2500);
      expect(r.denseSolid).toHaveLength(r.dense.length);
      const solids = buildSolids(s), eps = HIDDEN_EPSILON / r.stats.normalise;
      r.dense.forEach((p, i) => solids.forEach((solid, j) => { if (j !== r.denseSolid[i]) expect(solid.insideDepth(toScene(r, p))).toBeLessThanOrEqual(eps); }));
    }
  });

  it('the same scene and streams give identical output; another part leaves an original part\'s raw samples alone', () => {
    expect(run(ELEPHANT)).toEqual(run(ELEPHANT));
    const ball = buildSolid(part('ball', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.5, 0.5, 0.5] }), 0);
    expect(ball.surface(50, testStream('surface:ball'))).toEqual(ball.surface(50, testStream('surface:ball')));
  });
});
