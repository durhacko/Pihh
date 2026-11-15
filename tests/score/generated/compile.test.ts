// GF-WP-06 (#212): compileGeneratedScene. Tests GF-T16–GF-T19 and GF-T41 of
// docs/validation/gemini-formation-evaluation.md §5, and the compiler's parts of GF-T08, GF-T09 and GF-T15,
// on the 3D path (the 2D path arrives with GF-WP-04, #207, and is a typed rejection until then).
// Heavier sweeps run under P2_WIDE=1 (PHASE2_WORK_PACKAGES §2.3 item 7).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { makeParams, type Formation, type Vec3 } from '../../../src/contracts';
import { farthestPointOrder } from '../../../src/score/fps';
import {
  COMPILER_VERSION, compileGeneratedScene, colourWarningsFor, denseCoverage, linearLuminance, MAX_N0, MIN_SLOT_SPACING, repairReport, sceneHash, sfc32, slotsDigest,
  validateScene, type CompileResult, type SceneSpec,
} from '../../../src/score/generated';
import { checkPlacement, placeP1, WORLD_LIMIT } from '../../../src/score/generated/placement';
import {
  BISECTION_STEPS, DELTA_LOW, FEATURE_BUDGET_SHARE, initialSpacing, K_MIN, reservationTargets, selectSlots,
  type SelectionCandidate, type SelectionInput,
} from '../../../src/score/generated/selection';

const WIDE = process.env.P2_WIDE === '1';
const fixtureDir = new URL('../../fixtures/scenes/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8')) as SceneSpec;
const VALID = readdirSync(fixtureDir).filter((f) => f.startsWith('valid-') && f.endsWith('.json')).sort();
const VALID_3D = VALID.filter((f) => f.startsWith('valid-3d-'));
const VALID_2D = VALID.filter((f) => f.startsWith('valid-2d-'));
type Ok = Extract<CompileResult, { ok: true }>;
type Fail = Extract<CompileResult, { ok: false }>;

const ok = (r: CompileResult): Ok => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.detail}`);
  return r;
};
const fail = (r: CompileResult): Fail => {
  if (r.ok) throw new Error('expected a rejection');
  return r;
};
const d = (a: readonly number[], b: readonly number[]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
function closest(points: readonly (readonly number[])[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) best = Math.min(best, d(points[i], points[j]));
  return best;
}
const codes = (r: CompileResult) => [...new Set(r.warnings.map((w) => w.code))].sort();

/** Compile once per (fixture, n0) for the whole file: the formation is deterministic (GF-T19 checks that). */
const memo = new Map<string, CompileResult>();
function compiled(name: string, n0: number): CompileResult {
  const key = `${name}|${n0}`;
  if (!memo.has(key)) memo.set(key, compileGeneratedScene(load(name), makeParams(n0), n0));
  return memo.get(key)!;
}

/** A straight tapered tube along x or y: wide, tall and oversized scenes on demand. */
function tube(axis: 'x' | 'y', r: number): SceneSpec {
  const p = (t: number): Vec3 => (axis === 'x' ? [t, 0, 0] : [0, t, 0]);
  return {
    version: 1, mode: 'scene3d', title: 'Tube', referenceView: 'front', materials: [{ id: 'm', rgb: [0.9, 0.7, 0.2] }],
    parts: [{ id: 'tube', shape: { type: 'taperedTube', points: [p(-1.5), p(-0.5), p(0.5), p(1.5)], startRadius: r, endRadius: r }, materialId: 'm', importance: 3 }],
  };
}
const sphereScene = (rgb: [number, number, number], radius = 0.8, center: Vec3 = [0, 0, 0]): SceneSpec => ({
  version: 1, mode: 'scene3d', title: 'Ball', referenceView: 'front', materials: [{ id: 'paint', rgb }],
  parts: [{ id: 'ball', shape: { type: 'ellipsoid', center, radii: [radius, radius, radius] }, materialId: 'paint', importance: 3 }],
});

// Goldens (GF-T19, CR-18): slotsDigest of every valid 3D fixture at n0 40 and 200 under COMPILER_VERSION.
// A change here with the same COMPILER_VERSION is compiler drift: bump COMPILER_VERSION and GOLDEN_VERSION
// together, deliberately, and say why in the PR.
const GOLDEN_VERSION = 1;
const SLOTS_DIGEST_GOLDEN: Record<string, string> = {
  'valid-3d-elephant-excerpt-x.json|40': 'b51e2db2efd29a940b231389520166e95cbc206a1c38011631e984efef435305',
  'valid-3d-elephant-excerpt-x.json|200': '543f67e6ff94b382bf07b67594e31e6309355e5cc0ceb07c2104e8b80b26a286',
  'valid-3d-elephant.json|40': 'f8c89576dadc217fbd626b76ff3feb43b77c46374df3fb5d66efa9027dac97fa',
  'valid-3d-elephant.json|200': '48065e91da575eac11c648136e7e9114aa91142d1bdda69b7e2ce967c752b500',
  'valid-3d-mirrored-pair.json|40': '01a3f8a0f6d250871a0ab3d5b0260aa83f6abebdb3fe630fee473ea155eec7f0',
  'valid-3d-mirrored-pair.json|200': '671b7b1b727e9413b1b808c569f5bca6cb9694045633d03fc3085c646a6f49c5',
  'valid-3d-primitives.json|40': '150a7d320dc561503156da25b50572aebdd9e6719448ceccf734e3806bc4ff9f',
  'valid-3d-primitives.json|200': '17d7f700b9df845a8d01d2aa3116f43c3f0d823dc556d2ffd8b283befc0ba69b',
  'valid-3d-sphere.json|40': 'faf938417ad3802cf21783029fcaf2467d5d72c43fef89141bb1b8b35c0ad7d9',
  'valid-3d-sphere.json|200': 'ce0667dbcf11b9b177675f0991581c46d2a463f61bf5b60a4819daca4748f2f2',
  'valid-3d-straight-tube.json|40': '2af72816825bddb87589f29f7b25246d304da4071d0cb29705799e64ee3eadbd',
  'valid-3d-straight-tube.json|200': 'e6a3dc3d379454a4a1ba82694a8b424f00eba0404c8cd2b3764ecd11dfb2dfea',
  'valid-3d-two-spheres.json|40': 'd1726a7ed222dba8e193efda90053735fc4c5461c9b343ac3f4f6e16ec446a99',
  'valid-3d-two-spheres.json|200': '09fbe1f5db79a980e3dd8e18776be99c46c0590d134c3d77d9b804fa59e4e349',
};

describe('GF-T16: exactly n0 slots in farthest-point order', () => {
  it.each(VALID_3D.flatMap((f) => [[f, 40], [f, 200]] as const))('%s at n0 = %i', (f, n0) => {
    const r = ok(compiled(f, n0));
    const slots = r.formation.slots;
    expect(slots).toHaveLength(n0);
    expect(slots.map((s) => s.index)).toEqual(Array.from({ length: n0 }, (_, i) => i));
    expect(new Set(slots.map((s) => s.pos.join(','))).size).toBe(n0);
    // FPS over the selected set (the placed slots are a uniform scale and translation of it): the order is the identity.
    expect(farthestPointOrder(slots.map((s) => s.pos), n0)).toEqual(Array.from({ length: n0 }, (_, i) => i));
  });
});

describe('GF-T17: spacing, finiteness and colour', () => {
  it.each(VALID_3D.flatMap((f) => [[f, 40], [f, 200]] as const))('%s at n0 = %i', (f, n0) => {
    const r = ok(compiled(f, n0));
    const params = makeParams(n0);
    const slots = r.formation.slots;
    const cp = closest(slots.map((s) => s.pos));
    expect(cp).toBeGreaterThanOrEqual(params.slotSpacingMin);
    expect(cp).toBeLessThanOrEqual(params.slotSpacingMin * 1.01);
    expect(r.stats.closestPair).toBeCloseTo(cp, 9);
    const materials = (load(f) as Extract<SceneSpec, { mode: 'scene3d' }>).materials.map((m) => m.rgb.join(','));
    for (const s of slots) {
      for (const v of [...s.pos, ...s.colour]) expect(Number.isFinite(v)).toBe(true);
      for (const c of s.colour) expect(c >= 0 && c <= 1).toBe(true);
      expect(materials).toContain(s.colour.join(','));          // passed through unchanged until GF-D6 (CR-33)
    }
  });

  it('reads the reserved-colour and pure-blue rules on the sRGB value and luminance on the linear value', () => {
    expect(colourWarningsFor([0.5, 0.55, 0.9], 'periwinkle')).toEqual([]);               // linear ~[0.21, 0.26, 0.79]
    expect(colourWarningsFor([0.1, 0.2, 0.9], 'blue').map((w) => w.code)).toEqual(['dim-colour']);
    expect(colourWarningsFor([1, 1, 1], 'white').map((w) => w.code)).toEqual(['reserved-colour']);   // William's #FFFFFF
    expect(colourWarningsFor([0.95, 0.35, 0.1], 'vermilion').map((w) => w.code)).toEqual(['reserved-colour']);
    expect(linearLuminance([0.1, 0.1, 0.1])).toBeLessThan(0.02);
    expect(colourWarningsFor([0.1, 0.1, 0.1], 'charcoal').map((w) => w.code)).toEqual(['dark-light-may-vanish']);
    expect(linearLuminance([1, 1, 1])).toBeCloseTo(1, 9);
    const dark = ok(compileGeneratedScene(sphereScene([0.1, 0.1, 0.1]), makeParams(40), 40));
    expect(dark.warnings).toContainEqual(expect.objectContaining({ code: 'dark-light-may-vanish', partId: 'paint' }));
    expect(dark.formation.slots.every((s) => s.colour.join(',') === '0.1,0.1,0.1')).toBe(true);
  });
});

describe('GF-T18: bounds, altitude and caps as validation, never clamps', () => {
  it.each(VALID_3D.flatMap((f) => [[f, 40], [f, 200]] as const))('%s at n0 = %i', (f, n0) => {
    const r = ok(compiled(f, n0));
    const { slots, dense, bounds } = r.formation;
    expect(dense.length).toBeGreaterThanOrEqual(1500);
    expect(dense.length).toBeLessThanOrEqual(2500);
    for (const p of [...slots.map((s) => s.pos), ...dense]) {
      for (let a = 0; a < 3; a++) expect(p[a] >= bounds.min[a] && p[a] <= bounds.max[a]).toBe(true);
    }
    expect(bounds.min[1]).toBeGreaterThanOrEqual(2);
    for (const s of slots) expect(Math.min(...dense.map((q) => d(s.pos, q)))).toBeLessThan(makeParams(n0).slotSpacingMin);
    const centre = [0, 1, 2].map((a) => (bounds.min[a] + bounds.max[a]) / 2);
    for (const [a, c] of [[0, 0], [1, 30], [2, 0]]) expect(centre[a]).toBeCloseTo(c, 9);
  });

  it('a scene wider than 40 m warns and keeps the spacing; a tall one is below-floor; an oversized one is too-large-world', () => {
    const wide = ok(compileGeneratedScene(tube('x', 0.1), makeParams(200), 200));
    expect(wide.stats.size[0]).toBeGreaterThan(40);
    expect(codes(wide)).toContain('wider-than-proposed-cap');
    expect(closest(wide.formation.slots.map((s) => s.pos))).toBeCloseTo(1.5 * 1.001, 9);
    expect(fail(compileGeneratedScene(tube('y', 0.1), makeParams(200), 200)).code).toBe('below-floor');
    const huge = fail(compileGeneratedScene(tube('x', 0.02), makeParams(200), 200));
    expect(huge.code).toBe('too-large-world');
    expect(huge.sceneHash).toBe(sceneHash(tube('x', 0.02)));
  });

  it('checkPlacement: each limit of the §7.6 table on synthetic points', () => {
    const at = (pts: Vec3[]) => checkPlacement(placeP1(pts, [], 1.5));
    const line = (n: number, step: number, axis: number): Vec3[] => Array.from({ length: n }, (_, i) => { const p: Vec3 = [0, 0, 0]; p[axis] = i * step; return p; });
    expect(at(line(20, 1, 0))).toEqual({ ok: true, warnings: [] });                          // 28.5 m wide
    expect(at(line(30, 1, 0)).warnings.map((w) => w.code)).toEqual(['wider-than-proposed-cap']);
    const tall = at(line(18, 1, 1));                                                          // 25.5 m tall, lowest 17.2 m
    expect(tall.warnings.map((w) => w.code)).toEqual(['taller-than-proposed-cap']);
    const lower = at(line(36, 1, 1));                                                         // 52.5 m tall, lowest 3.7 m
    expect(lower).toMatchObject({ ok: true });
    expect(lower.warnings.map((w) => w.code)).toEqual(['taller-than-proposed-cap', 'lower-than-proposed-altitude']);
    expect(at(line(40, 1, 1))).toMatchObject({ ok: false, code: 'below-floor' });
    expect(at(line(Math.ceil(WORLD_LIMIT / 1.5) + 2, 1, 2))).toMatchObject({ ok: false, code: 'too-large-world' });
  });
});

describe('§7.9 post-placement checks: never a breached ok', () => {
  it('denseCoverage finds the slot farthest from dense', () => {
    expect(denseCoverage([[0, 0, 0], [10, 0, 0]], [[0, 0, 1], [9, 0, 0], [11, 0, 0]])).toEqual({ slot: 0, distance: 1 });
    expect(denseCoverage([[0, 0, 0]], [])).toEqual({ slot: 0, distance: Infinity });
  });

  it('a tiny protected part keeps dense nearby (sample3d gives every kept original some dense draws)', () => {
    // The review's repro: before the sample3d fix the eye's one slot was 2.36 m from dense at n0 = 200.
    for (const r of [0.012, 0.015]) {
      const scene: SceneSpec = {
        version: 1, mode: 'scene3d', title: 'Eye', referenceView: 'front', materials: [{ id: 'm', rgb: [0.6, 0.6, 0.6] }],
        parts: [
          { id: 'body', shape: { type: 'ellipsoid', center: [0, 0, 0], radii: [1, 1, 1] }, materialId: 'm', importance: 3 },
          { id: 'eye', shape: { type: 'ellipsoid', center: [0, 0, 1.3], radii: [r, r, r] }, materialId: 'm', importance: 5 },
        ],
      };
      const res = ok(compileGeneratedScene(scene, makeParams(200), 200));
      expect(res.stats.perPart.eye, `r = ${r}`).toBeGreaterThan(0);
      expect(denseCoverage(res.formation.slots.map((s) => s.pos), res.formation.dense).distance).toBeLessThan(1.5);
    }
  });

  it.runIf(WIDE)('P2_WIDE: a sphere at n0 = 1000 outgrows the fixed ~2000-point dense band: a typed dense-coverage rejection', () => {
    const r = compileGeneratedScene(sphereScene([0.9, 0.6, 0.2]), makeParams(1000), 1000);
    if (r.ok) expect(denseCoverage(r.formation.slots.map((s) => s.pos), r.formation.dense).distance).toBeLessThan(1.5);
    else expect(r.code).toBe('dense-coverage');
  }, 120_000);
});

describe('GF-T19: determinism', () => {
  it('has a committed slotsDigest golden per valid 3D fixture at n0 40 and 200, under the same COMPILER_VERSION', () => {
    expect(COMPILER_VERSION, 'bump GOLDEN_VERSION and the goldens together with COMPILER_VERSION').toBe(GOLDEN_VERSION);
    const actual: Record<string, string> = {};
    for (const f of VALID_3D) for (const n0 of [40, 200]) actual[`${f}|${n0}`] = ok(compiled(f, n0)).slotsDigest;
    expect(actual).toEqual(SLOTS_DIGEST_GOLDEN);
    for (const f of VALID_3D) {
      const r = ok(compiled(f, 200));
      expect(r.slotsDigest).toBe(slotsDigest(r.formation, 200, 1.5));
      expect(r.compilerVersion).toBe(COMPILER_VERSION);
      expect(r.sceneHash).toBe(sceneHash(load(f)));
    }
  });

  it('gives deep-equal results on repeated calls, across key orders and in a fresh module instance', async () => {
    const f = 'valid-3d-primitives.json';
    const first = ok(compiled(f, 200));
    expect(compileGeneratedScene(load(f), makeParams(200), 200)).toEqual(first);
    const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys)
      : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    expect(compileGeneratedScene(reverseKeys(load(f)) as SceneSpec, makeParams(200), 200)).toEqual(first);
    vi.resetModules();
    const fresh = await import('../../../src/score/generated');
    const again = fresh.compileGeneratedScene(load(f), makeParams(200), 200);
    expect(again).toEqual(first);
  });

  it('returns a frozen formation that is structurally the contract Formation', () => {
    const r = ok(compiled('valid-3d-sphere.json', 40));
    const asContract: Formation = r.formation;
    expect(Object.isFrozen(asContract)).toBe(true);
    expect(Object.isFrozen(asContract.slots[0].pos)).toBe(true);
    expect(() => { (asContract.slots as unknown as unknown[]).push(1); }).toThrow(TypeError);
  });

  it('scale invariance on stats, not on the digest (spec difference: §7.12 seeds from sceneHash, which a scaled copy changes)', () => {
    // Every number on a 2e-4 grid, so the half-size copy is still on the 1e-4 quantisation grid.
    const scene = (k: number): SceneSpec => ({
      version: 1, mode: 'scene3d', title: 'Pair', referenceView: 'front', materials: [{ id: 'm', rgb: [0.9, 0.6, 0.2] }],
      parts: [
        { id: 'core', shape: { type: 'ellipsoid', center: [0, 0, 0], radii: [0.8 * k, 0.6 * k, 0.6 * k] }, materialId: 'm', importance: 4 },
        { id: 'ear', shape: { type: 'ellipsoid', center: [0.8 * k, 0.4 * k, 0], radii: [0.3 * k, 0.4 * k, 0.1 * k] }, materialId: 'm', importance: 4, symmetry: 'mirror-x' },
      ],
    });
    const full = ok(compileGeneratedScene(scene(1), makeParams(200), 200));
    const half = ok(compileGeneratedScene(scene(0.5), makeParams(200), 200));
    expect(half.sceneHash).not.toBe(full.sceneHash);
    expect(half.stats.normalise / full.stats.normalise).toBeCloseTo(2, 9);
    expect(codes(half)).toEqual(codes(full));
    expect(Math.abs(half.stats.deltaFinal / full.stats.deltaFinal - 1)).toBeLessThan(0.05);
    expect(Math.abs(half.stats.candidates.surface / full.stats.candidates.surface - 1)).toBeLessThan(0.02);
    for (const id of Object.keys(full.stats.perPart)) {
      expect(Math.abs(half.stats.perPart[id] - full.stats.perPart[id]), id).toBeLessThanOrEqual(Math.max(3, 0.1 * full.stats.perPart[id]));
    }
    for (let a = 0; a < 3; a++) expect(Math.abs(half.stats.size[a] / full.stats.size[a] - 1)).toBeLessThan(0.05);
  });
});

describe('selection (§7.4)', () => {
  const grid = (n: number, step = 1): SelectionCandidate[] => Array.from({ length: n * n }, (_, i) => ({
    pos: [(i % n) * step, Math.floor(i / n) * step, 0], part: 0, source: 'surface', importance: 3, visibility: (i % 3) / 2,
  }));
  const input = (cands: SelectionCandidate[], n0: number, area: number): SelectionInput => ({
    mode: 'scene3d', candidates: cands, n0, area, parts: [{ id: 'p', importance: 3, protected: false, share: 1 }],
  });

  it('δ₀ = 0.9·√(A / (0.866·n0)); the search keeps the largest δ that reaches n0, in [0.35·δ₀, δ₀]', () => {
    expect(initialSpacing(0.866 * 100, 100)).toBeCloseTo(0.9, 12);
    const r = selectSlots(input(grid(20), 100, 19 * 19));
    if (!r.ok) throw new Error(r.detail);
    expect(r.selected).toHaveLength(100);
    expect(new Set(r.selected).size).toBe(100);
    expect(r.delta).toBeGreaterThanOrEqual(DELTA_LOW * r.delta0);
    expect(r.delta).toBeLessThanOrEqual(r.delta0);
    expect(closest(r.selected.map((i) => grid(20)[i].pos))).toBeGreaterThanOrEqual(r.delta - 1e-12);
    expect(BISECTION_STEPS).toBe(10);
  });

  it('honours the rear-side floor when V = 0 candidates are eligible', () => {
    const r = selectSlots(input(grid(20), 60, 19 * 19));
    if (!r.ok) throw new Error(r.detail);
    expect(r.rear.floor).toBe(9);
    expect(r.rear.selected).toBeGreaterThanOrEqual(9);
  });

  it('rejects empty geometry, too few candidates and an infeasible count with typed codes', () => {
    expect(selectSlots(input([], 10, 1))).toMatchObject({ ok: false, code: 'empty-geometry' });
    expect(selectSlots(input(grid(3), 10, 4))).toMatchObject({ ok: false, code: 'too-few-candidates' });
    // 100 candidates on a line of length 0.99, asked at a δ bracket far above their spacing: infeasible.
    const tight: SelectionCandidate[] = Array.from({ length: 100 }, (_, i) => ({ pos: [i * 0.01, 0, 0], part: 0, source: 'surface', importance: 3, visibility: 1 }));
    expect(selectSlots(input(tight, 50, 1000))).toMatchObject({ ok: false, code: 'infeasible-count' });
  });

  it('reserves only small protected parts, at most kMin each, inside the 35%·n0 budget, by decreasing w_f', () => {
    const parts = [
      { id: 'body', importance: 4, protected: true, share: 0.9 },
      { id: 'trunk', importance: 5, protected: true, share: 0.004 },
      { id: 'tusk', importance: 4, protected: true, share: 0.004 },
      { id: 'tail', importance: 2, protected: false, share: 0.002 },
    ];
    const base = { mode: 'scene3d' as const, candidates: [], area: 1, parts };
    expect(reservationTargets({ ...base, n0: 200 }, 0.1, 'full')).toEqual([0, K_MIN, K_MIN, 0]);   // body needs none
    expect(reservationTargets({ ...base, n0: 200 }, 0.1, 'reservations-relaxed')).toEqual([0, 1, 1, 0]);
    expect(reservationTargets({ ...base, n0: 4 }, 0.1, 'full')).toEqual([0, 1, 0, 0]);             // budget ⌊1.4⌋ = 1 to the top w_f (trunk)
    expect(reservationTargets({ ...base, n0: 200, parts: [parts[2], parts[1]] }, 0.1, 'full')).toEqual([K_MIN, K_MIN]);
    expect(FEATURE_BUDGET_SHARE).toBe(0.35);
  });
});

describe('GF-T09 (3D part): protected parts end with ≥ kMin slots or a feature-starved warning naming them', () => {
  it.each([40, 200])('elephant at n0 = %i', (n0) => {
    const r = ok(compiled('valid-3d-elephant.json', n0));
    const scene = load('valid-3d-elephant.json') as Extract<SceneSpec, { mode: 'scene3d' }>;
    const starved = new Set(r.warnings.filter((w) => w.code === 'feature-starved').map((w) => w.partId));
    for (const part of scene.parts.filter((p) => p.importance >= 4)) {
      for (const id of part.symmetry === 'mirror-x' ? [part.id, `${part.id}~m`] : [part.id]) {
        if (r.stats.perPart[id] < K_MIN) expect(starved.has(id), id).toBe(true);
      }
    }
    for (const id of ['body', 'head']) expect(r.stats.perPart[id], `${id} needs no reservation`).toBeGreaterThanOrEqual(K_MIN);
  });
});

describe('GF-T15 (3): mirror-x on a scene symmetric by construction', () => {
  // † Proposed bound NOT met; measured envelope pending the spec owner. GF-T15 (3) proposes Hausdorff ≤ δ_world† and a
  // pair-count gap ≤ 1†. Greedy Q(p) is not reflection-equivariant, and the orchestrator's review measured, on this
  // fixture, Hausdorff/δ_world = 0.846 (n0 40), 0.961 (60), 1.042 (80), 0.941 (100), 1.023 (120), 1.040 (150),
  // 0.999 (200), and a count gap of 2 at n0 120. So this test asserts the measured envelope (≤ 1.1·δ_world, gap ≤ 2)
  // over a spread of rosters; it does not claim GF-T15 (3) delivered.
  it.each([40, 100, 150, 200])('mirrored pair at n0 = %i: Hausdorff(S, mirror S) ≤ 1.1·δ_world and pair counts within 2 (measured envelope)', (n0) => {
    const r = ok(compiled('valid-3d-mirrored-pair.json', n0));
    const slots = r.formation.slots.map((s) => s.pos);
    const cx = (r.formation.bounds.min[0] + r.formation.bounds.max[0]) / 2;
    const mirrored = slots.map((p) => [2 * cx - p[0], p[1], p[2]]);
    const directed = (a: number[][], b: number[][]) => Math.max(...a.map((p) => Math.min(...b.map((q) => d(p, q)))));
    const hausdorff = Math.max(directed(slots as number[][], mirrored), directed(mirrored, slots as number[][]));
    expect(hausdorff).toBeLessThanOrEqual(1.1 * r.stats.deltaFinal * r.stats.scale);
    expect(Math.abs(r.stats.perPart.ear - r.stats.perPart['ear~m'])).toBeLessThanOrEqual(2);
  });
});

describe('GF-T08 (compiler part): slot-graph components with edges ≤ rClaim (§8.11)', () => {
  const at = (positions: Vec3[]) => ({ slots: positions.map((pos, index) => ({ index, pos, colour: [1, 1, 1] as [number, number, number] })) });

  it('reports every component but the largest, and the ones that cannot heal internally', () => {
    const body: Vec3[] = Array.from({ length: 30 }, (_, i) => [i * 2, 30, 0]);
    const eye: Vec3[] = [[100, 30, 0], [102, 30, 0], [104, 30, 0]];
    const lone: Vec3[] = [[-50, 30, 0]];
    const report = repairReport(at([...body, ...eye, ...lone]), 6, 6);
    expect(report.components.map((c) => c.size)).toEqual([30, 3, 1]);
    expect(report.confinedSlots).toBe(4);
    expect(report.islandSlots).toBe(1);
    expect(report.warnings.map((w) => w.code)).toEqual(['repair-confined', 'cannot-heal-internally', 'repair-confined', 'cannot-heal-internally']);
    expect(repairReport(at(body), 6, 6).warnings).toEqual([]);
  });

  it('compileGeneratedScene adds them when params carry rClaim and claimGap, and the formation does not depend on them', () => {
    const apart: SceneSpec = {
      version: 1, mode: 'scene3d', title: 'Apart', referenceView: 'front', materials: [{ id: 'm', rgb: [0.9, 0.6, 0.2] }],
      parts: [
        { id: 'big', shape: { type: 'ellipsoid', center: [-0.6, 0, 0], radii: [0.5, 0.5, 0.5] }, materialId: 'm', importance: 3 },
        { id: 'dot', shape: { type: 'ellipsoid', center: [1.2, 0, 0], radii: [0.08, 0.08, 0.08] }, materialId: 'm', importance: 5 },
      ],
    };
    const withRepair = ok(compileGeneratedScene(apart, makeParams(40), 40));
    expect(codes(withRepair)).toContain('repair-confined');
    const without = ok(compileGeneratedScene(apart, { n0: 40, slotSpacingMin: 1.5 }, 40));
    expect(codes(without)).not.toContain('repair-confined');
    expect(codes(without)).toContain('repair-check-skipped');
    expect(codes(withRepair)).not.toContain('repair-check-skipped');
    expect(without.formation).toEqual(withRepair.formation);
    expect(without.slotsDigest).toBe(withRepair.slotsDigest);
    for (const [rClaim, claimGap] of [[NaN, 6], [6, Infinity], [0, 6], [6, 0], [-1, 6]]) {
      const r = ok(compileGeneratedScene(apart, { n0: 40, slotSpacingMin: 1.5, rClaim, claimGap }, 40));
      expect(codes(r), `${rClaim}, ${claimGap}`).toEqual(expect.arrayContaining(['repair-check-skipped']));
      expect(codes(r)).not.toContain('repair-confined');
      expect(r.slotsDigest).toBe(withRepair.slotsDigest);
    }
  });
});

/** A seeded generator of V3-valid 3D scenes (GF-T41): random primitives, degenerate sizes, tangent parts, mirror cases. */
function corpus(seed: number, count: number): SceneSpec[] {
  const next = sfc32(seed, 0x9e3779b9, 0x243f6a88, 0xb7e15162);
  const u = () => next() / 2 ** 32;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)];
  const q = (v: number) => Math.round(v * 1e3) / 1e3;
  const v3 = (lo: number, hi: number): Vec3 => [q(lo + u() * (hi - lo)), q(lo + u() * (hi - lo)), q(lo + u() * (hi - lo))];
  const size = () => q(pick([0.005, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5]) * (0.5 + u()));
  const out: SceneSpec[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 50; attempt++) {
    const materials = Array.from({ length: 1 + Math.floor(u() * 3) }, (_, i) => ({ id: `m${i}`, rgb: v3(0, 1) as [number, number, number] }));
    const parts = Array.from({ length: 1 + Math.floor(u() * 6) }, (_, i) => {
      const kind = pick(['ellipsoid', 'capsule', 'cylinder', 'cone', 'taperedTube'] as const);
      const center = v3(-0.9, 0.9);
      const rot = u() < 0.5 ? undefined : [pick([0, 30, 45, 90]), pick([0, 60, 90]), pick([0, 15, 180])] as Vec3;
      const shape = kind === 'ellipsoid' ? { type: kind, center, radii: [size(), size(), size()] as Vec3, ...(rot ? { rotationDeg: rot } : {}) }
        : kind === 'capsule' ? { type: kind, center, radius: size(), length: size(), ...(rot ? { rotationDeg: rot } : {}) }
          : kind === 'cylinder' ? { type: kind, center, radius: size(), height: size(), ...(rot ? { rotationDeg: rot } : {}) }
            : kind === 'cone' ? { type: kind, center, baseRadius: size(), topRadius: pick([0, size()]), height: size(), ...(rot ? { rotationDeg: rot } : {}) }
              : { type: kind, points: [center, v3(-0.9, 0.9), v3(-0.9, 0.9), v3(-0.9, 0.9)], startRadius: size(), endRadius: size() };
      const tangent = i > 0 && u() < 0.2;   // a tangent pair: a unit sphere's neighbour touching it on x
      return {
        id: `p${i}`, shape: tangent ? { type: 'ellipsoid' as const, center: [0.4, 0, 0] as Vec3, radii: [0.2, 0.2, 0.2] as Vec3 } : shape,
        materialId: pick(materials).id, importance: 1 + Math.floor(u() * 5), ...(u() < 0.3 ? { symmetry: pick(['mirror-x', 'none'] as const) } : {}),
      };
    });
    const scene = { version: 1, mode: 'scene3d', title: `Fuzz ${out.length}`, referenceView: pick(['front', 'side', 'three-quarter'] as const), materials, parts } as SceneSpec;
    if (validateScene(scene).ok) out.push(scene);
  }
  return out;
}

describe('GF-T41: totality', () => {
  const FUZZ_SEED = 20261115;
  const cases = WIDE ? corpus(FUZZ_SEED, 60) : corpus(FUZZ_SEED, 10);
  const rosters = WIDE ? [1, 2, 40, 200] : [1, 2, 40];

  it(`compiles ${WIDE ? 60 : 10} seeded valid scenes at n0 ∈ {${rosters}}: ok or a typed rejection, never a throw, never internal`, () => {
    expect(cases.length).toBe(WIDE ? 60 : 10);
    const seen: Record<string, number> = {};
    for (const scene of cases) {
      for (const n0 of rosters) {
        let r: CompileResult | undefined;
        expect(() => { r = compileGeneratedScene(scene, makeParams(n0), n0); }).not.toThrow();
        const key = r!.ok ? 'ok' : r!.code;
        seen[key] = (seen[key] ?? 0) + 1;
        expect(key, JSON.stringify(scene)).not.toBe('internal');
        if (r!.ok) {
          expect(r!.formation.slots).toHaveLength(n0);
          if (n0 > 1) expect(closest(r!.formation.slots.map((s) => s.pos))).toBeGreaterThanOrEqual(1.5);
          expect(denseCoverage(r!.formation.slots.map((s) => s.pos), r!.formation.dense).distance).toBeLessThan(1.5);
        }
      }
    }
    expect(seen.ok).toBeGreaterThan(0);
  }, 120_000);

  it.each([
    ['null', null], ['an empty object', {}], ['a string', 'scene'], ['a 2D scene missing parts', { version: 1, mode: 'silhouette2d' }],
  ])('rejects %s with a typed code and never throws', (_name, input) => {
    const r = fail(compileGeneratedScene(input as unknown as SceneSpec, makeParams(40), 40));
    expect(['parse', 'schema']).toContain(r.code);
    expect(r.sceneHash).toBeNull();
  });

  it('rejects bad n0 and slotSpacingMin as range, and 2D as unsupported-mode until GF-WP-04', () => {
    const scene = load('valid-3d-sphere.json');
    for (const n0 of [0, -1, 1.5, NaN, MAX_N0 + 1, 1e9]) expect(fail(compileGeneratedScene(scene, makeParams(40), n0)).code).toBe('range');
    for (const s of [0, -1, NaN, Infinity, MIN_SLOT_SPACING / 2]) expect(fail(compileGeneratedScene(scene, { n0: 40, slotSpacingMin: s }, 40)).code).toBe('range');
    expect(MAX_N0).toBe(1250);
    expect(compileGeneratedScene(scene, { n0: 40, slotSpacingMin: MIN_SLOT_SPACING }, 40).ok).toBe(true);
    for (const f of VALID_2D) {
      const r = fail(compileGeneratedScene(load(f), makeParams(40), 40));
      expect(r.code).toBe('unsupported-mode');
      expect(r.sceneHash).toBe(sceneHash(load(f)));
    }
  });

  it('maps validation failures to their codes (unsupported-version, reference, range)', () => {
    const sphere = load('valid-3d-sphere.json') as Extract<SceneSpec, { mode: 'scene3d' }>;
    expect(fail(compileGeneratedScene({ ...sphere, version: 2 } as unknown as SceneSpec, makeParams(40), 40)).code).toBe('unsupported-version');
    expect(fail(compileGeneratedScene({ ...sphere, parts: [{ ...sphere.parts[0], materialId: 'nope' }] }, makeParams(40), 40)).code).toBe('reference');
    expect(fail(compileGeneratedScene(sphereScene([0.5, 0.5, 0.5], 0.5, [1.9, 0, 0]), makeParams(40), 40)).code).toBe('range');
  });
});
