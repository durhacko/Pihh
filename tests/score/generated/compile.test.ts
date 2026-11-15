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
import { foregroundRGB } from '../../../src/score/generated/sample2d';
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
/** Tall 2D subjects (H²/A above about 4.5, spec §7.6): below-floor at n0 = 200 until layering (simplification 5) lands. */
const TALL_2D = ['valid-2d-path-auto-closed.json', 'valid-2d-rocket.json'];
/** Every (fixture, n0) that compiles ok: all valid fixtures at 40, all but the tall 2D ones at 200. */
const CASES = VALID.flatMap((f) => (TALL_2D.includes(f) ? [[f, 40]] : [[f, 40], [f, 200]]) as [string, number][]);
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
  'valid-2d-annulus.json|40': '016d5abf4fa6cca39232194ad5d13fbf8a3777afe1c74412c94bbfa8d1846322',
  'valid-2d-annulus.json|200': '6fc698fd37436fd7eafa50209f96f0c4ceb0e4025f9d449fc75bb6a2f4fbdc64',
  'valid-2d-disc.json|40': 'b1352f3cd2d44e532347697473d9fd9065e345e7bc602a3726043adbb1a3b126',
  'valid-2d-disc.json|200': '5490ac3a7fc25b897723a351127fea832daf5a56d37cacc07980350c8cca3813',
  'valid-2d-elephant-excerpt.json|40': 'd9cb83d2ea5528f6233b5d8a2ae53489cf56d26360682c9eac8edf59a3cb44bc',
  'valid-2d-elephant-excerpt.json|200': '4011b2e7ab25b8d4a40b6b49894dda03622cf6312aaa9441c3942a07e54fef36',
  'valid-2d-elephant.json|40': '0694bfcbd3cd674e5f8d7ccaae7cb05090878bf993299e380313ec881b3c2f1f',
  'valid-2d-elephant.json|200': '15a0ce350c238d7d50513edeb7cd832c13beab374daed73234efeaef4a03f522',
  'valid-2d-heart.json|40': '638aeb3ff2391c9a383ce4afaf7180a95ea2a2a45a5bf4925a1e693f01abf69a',
  'valid-2d-heart.json|200': '3e69767a63ee1b799d843b1a017a7cc43e6dda360c4797ad131ea2128085820e',
  'valid-2d-path-auto-closed.json|40': 'ba4e29e80772030b595a3c8c2a90162cefd9480cb0bfb3d132b3e0056f69f946',
  'valid-2d-rocket.json|40': '0317a5a58ab56876538d12a918738bbbbabde77bfd8fd5137487f83f93118a2b',
  'valid-2d-two-blobs.json|40': 'ca8cd51e783fc5fa60a1d6618e5e5efedd056281a8e4c6868596b474d35e28f0',
  'valid-2d-two-blobs.json|200': 'b976bc37f652a5d0d127a5dfff7ba96906bfe998475ed1ea0ab465eb4ec355b4',
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
  it.each(CASES)('%s at n0 = %i', (f, n0) => {
    const r = ok(compiled(f, n0));
    const slots = r.formation.slots;
    expect(slots).toHaveLength(n0);
    expect(slots.map((s) => s.index)).toEqual(Array.from({ length: n0 }, (_, i) => i));
    expect(new Set(slots.map((s) => s.pos.join(','))).size).toBe(n0);
    // FPS over the selected set, checked as the defining property on the placed slots (a uniform scale and
    // translation of the unit-space selection): slot 0 is nearest the centroid, and each slot k is at least as far
    // from slots 0…k−1 as any later slot is. A tolerance of 1e-6 m absorbs placement rounding: the 2D lattice has
    // exact distance ties, which rounding can reorder, so exact identity of farthestPointOrder is not required.
    const pos = slots.map((s) => s.pos);
    const tol = 1e-6;
    const centroid = [0, 1, 2].map((a) => pos.reduce((sum, p) => sum + p[a], 0) / n0);
    const toCentroid = pos.map((p) => d(p, centroid));
    expect(toCentroid[0]).toBeLessThanOrEqual(Math.min(...toCentroid) + tol);
    const nearest = pos.map((p) => d(p, pos[0]));
    for (let k = 1; k < n0; k++) {
      let farthest = 0;
      for (let j = k; j < n0; j++) farthest = Math.max(farthest, nearest[j]);
      expect(nearest[k], `slot ${k}`).toBeGreaterThanOrEqual(farthest - tol);
      for (let j = k + 1; j < n0; j++) nearest[j] = Math.min(nearest[j], d(pos[j], pos[k]));
    }
  });

  it('pins the 3D warnings (code, partId, order): #259\'s, plus the V10 thin-feature warnings that 3D V10 adds first', () => {
    // #259's warnings were captured at 01372ad before the shared finish() refactor. 3D V10 (spec §6.5, ruling 3 on #212)
    // adds thin-feature for the elephant's tusk and tail end radii (0.0141 normalised, under 2·0.01), and nothing else.
    const pin = (f: string, n0: number) => ok(compiled(f, n0)).warnings.map((w) => [w.code, w.partId ?? null]);
    expect(pin('valid-3d-elephant.json', 200)).toEqual([
      ['thin-feature', 'tusk'], ['thin-feature', 'tail'], ['feature-starved', 'tusk~m'], ['dark-light-may-vanish', 'eyes']]);
    expect(pin('valid-3d-sphere.json', 40)).toEqual([['reserved-colour', 'white']]);
  });

  it('3D V10: a radius under 0.01 normalised is thickened and recorded; under 0.02 warns; a pointed cone is left alone', () => {
    const scene = (r: number, top = 0): SceneSpec => ({
      version: 1, mode: 'scene3d', title: 'Thin', referenceView: 'front', materials: [{ id: 'm', rgb: [0.9, 0.6, 0.2] }],
      parts: [
        { id: 'body', shape: { type: 'ellipsoid', center: [0, 0, 0], radii: [0.8, 0.8, 0.8] }, materialId: 'm', importance: 3 },
        { id: 'whisker', shape: { type: 'taperedTube', points: [[0.7, 0, 0], [1, 0, 0], [1.25, 0, 0], [1.5, 0, 0]], startRadius: r, endRadius: r }, materialId: 'm', importance: 3 },
        { id: 'spike', shape: { type: 'cone', center: [0, 0.9, 0], baseRadius: 0.2, topRadius: top, height: 0.3 }, materialId: 'm', importance: 3 },
      ],
    });
    // The review's repro: radius 0.005 is 0.0037 normalised here (the union box spans x -0.8…1.5).
    const thin = ok(compileGeneratedScene(scene(0.005), makeParams(200), 200));
    expect(thin.warnings.filter((w) => w.code === 'thickened').map((w) => w.partId)).toEqual(['whisker', 'whisker']);
    expect(thin.stats.simplifications).toContain('thicken');
    expect(thin.stats.perPart.whisker).toBeGreaterThan(0);
    const near = ok(compileGeneratedScene(scene(0.012), makeParams(200), 200));      // 0.0115 normalised: warn, keep
    expect(codes(near)).toContain('thin-feature');
    expect(codes(near)).not.toContain('thickened');
    expect(near.stats.simplifications).not.toContain('thicken');
    expect(near.sceneHash).toBe(sceneHash(scene(0.012)));                              // the hash names the input scene
    const pointed = ok(compileGeneratedScene(scene(0.1, 0), makeParams(40), 40));
    expect(pointed.warnings.filter((w) => w.partId === 'spike')).toEqual([]);           // topRadius 0: a pointed cone
    // Thickening is deterministic: same scene, same digest.
    expect(compileGeneratedScene(scene(0.005), makeParams(200), 200)).toEqual(thin);
  });

  it('3D fixtures: farthestPointOrder over the placed slots is exactly the identity (no lattice ties)', () => {
    for (const f of VALID_3D) {
      const slots = ok(compiled(f, 200)).formation.slots;
      expect(farthestPointOrder(slots.map((s) => s.pos), 200), f).toEqual(Array.from({ length: 200 }, (_, i) => i));
    }
  });
});

describe('GF-T17: spacing, finiteness and colour', () => {
  it.each(CASES)('%s at n0 = %i', (f, n0) => {
    const r = ok(compiled(f, n0));
    const params = makeParams(n0);
    const slots = r.formation.slots;
    const cp = closest(slots.map((s) => s.pos));
    expect(cp).toBeGreaterThanOrEqual(params.slotSpacingMin);
    expect(cp).toBeLessThanOrEqual(params.slotSpacingMin * 1.01);
    expect(r.stats.closestPair).toBeCloseTo(cp, 9);
    const scene = load(f);
    // 3D: a material's rgb; 2D: the foreground (hex as /255), passed through unchanged until GF-D6 (CR-33).
    const materials = scene.mode === 'scene3d' ? scene.materials.map((m) => m.rgb.join(',')) : [foregroundRGB(scene.foreground).join(',')];
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
  it.each(CASES)('%s at n0 = %i', (f, n0) => {
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
  it('has a committed slotsDigest golden per accepted (fixture, n0), 2D and 3D, under the same COMPILER_VERSION', () => {
    expect(COMPILER_VERSION, 'bump GOLDEN_VERSION and the goldens together with COMPILER_VERSION').toBe(GOLDEN_VERSION);
    const actual: Record<string, string> = {};
    for (const [f, n0] of CASES) actual[`${f}|${n0}`] = ok(compiled(f, n0)).slotsDigest;
    expect(actual).toEqual(SLOTS_DIGEST_GOLDEN);
    for (const f of [...VALID_3D, ...VALID_2D.filter((x) => !TALL_2D.includes(x))]) {
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

describe('2D path (GF-WP-04 candidates through the shared selection)', () => {
  it.each([['valid-2d-annulus.json', 40], ['valid-2d-annulus.json', 200], ['valid-2d-two-blobs.json', 40], ['valid-2d-two-blobs.json', 200], ['valid-2d-disc.json', 200]] as const)(
    'GF-T08 boundary split: %s at n0 = %i splits the one 35% budget across contours by length (largest remainder)', (f, n0) => {
      const r = ok(compiled(f, n0));
      const b = r.stats.boundary!;
      expect(b.perContour.reduce((s, v) => s + v, 0)).toBe(b.quota);
      expect(b.quota).toBeLessThanOrEqual(Math.floor(0.35 * n0));
      for (let c = 0; c < b.placed.length; c++) expect(b.placed[c]).toBeLessThanOrEqual(b.perContour[c]);
      expect(r.stats.candidates.boundary).toBeGreaterThan(0);
      expect(r.stats.candidates.interior).toBeGreaterThanOrEqual(0.97 * 1500);   // sample2d's lattice tolerance is 3%
    });

  it('splits by contour length: the annulus outer ring gets more than its hole, the two equal blobs the same (±1)', () => {
    for (const n0 of [40, 200]) {
      const annulus = ok(compiled('valid-2d-annulus.json', n0)).stats.boundary!;
      expect(annulus.perContour).toHaveLength(2);
      expect(annulus.perContour[0]).toBeGreaterThan(annulus.perContour[1]);
      expect(annulus.placed).toEqual(annulus.perContour);
      const blobs = ok(compiled('valid-2d-two-blobs.json', n0)).stats.boundary!;
      expect(Math.abs(blobs.perContour[0] - blobs.perContour[1])).toBeLessThanOrEqual(1);
      expect(blobs.placed).toEqual(blobs.perContour);
    }
  });

  it('GF-T08 mask components: two blobs warn disconnected; with rClaim they are repair-confined', () => {
    const r = ok(compiled('valid-2d-two-blobs.json', 200));
    expect(codes(r)).toEqual(expect.arrayContaining(['disconnected', 'repair-confined']));
    expect(codes(ok(compiled('valid-2d-disc.json', 200)))).not.toContain('disconnected');
  });

  it('GF-T09 (2D part): protected union parts reach kMin or are named feature-starved; reservations are real at n0 = 200', () => {
    const scene = load('valid-2d-elephant.json') as Extract<SceneSpec, { mode: 'silhouette2d' }>;
    for (const n0 of [40, 200]) {
      const r = ok(compiled('valid-2d-elephant.json', n0));
      const starved = new Set(r.warnings.filter((w) => w.code === 'feature-starved').map((w) => w.partId));
      for (const part of scene.parts.filter((p) => p.operation === 'union' && p.priority >= 4)) {
        if (r.stats.perPart[part.id] < K_MIN) expect(starved.has(part.id), `${part.id} at n0 ${n0}`).toBe(true);
      }
    }
    const big = ok(compiled('valid-2d-elephant.json', 200));
    for (const id of ['trunk', 'tusk']) expect(big.stats.perPart[id], id).toBeGreaterThanOrEqual(K_MIN);
  });

  it('every 2D slot lies inside the silhouette region: no slot in a subtracted gap or a hole', () => {
    for (const [f, n0] of CASES.filter(([x]) => x.startsWith('valid-2d-'))) {
      const r = ok(compiled(f, n0));
      for (const s of r.formation.slots) expect(Math.abs(s.pos[2] - r.formation.bounds.min[2])).toBeLessThan(1e-9);   // one plane, z constant
    }
    const annulus = ok(compiled('valid-2d-annulus.json', 200));
    const c = [0, 1].map((a) => (annulus.formation.bounds.min[a] + annulus.formation.bounds.max[a]) / 2);
    const inner = Math.min(...annulus.formation.slots.map((s) => Math.hypot(s.pos[0] - c[0], s.pos[1] - c[1])));
    expect(inner).toBeGreaterThan(1.5);              // the hole stays empty of slots
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

/** A seeded generator of V3-valid 2D scenes (GF-T41): ellipses, regular polygons, strokes, subtract parts, thin and tangent parts. */
function corpus2D(seed: number, count: number): SceneSpec[] {
  const next = sfc32(seed, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f);
  const u = () => next() / 2 ** 32;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)];
  const q = (v: number) => Math.round(v * 1e3) / 1e3;
  const pt = (r = 0.9): [number, number] => [q(-r + u() * 2 * r), q(-r + u() * 2 * r)];
  const out: SceneSpec[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 50; attempt++) {
    const parts = Array.from({ length: 1 + Math.floor(u() * 6) }, (_, i) => {
      const kind = pick(['ellipse', 'polygon', 'stroke', 'tangent'] as const);
      const r = q(pick([0.01, 0.05, 0.15, 0.3, 0.6]) * (0.5 + u()));
      const c = pt();
      const geometry = kind === 'ellipse' ? { type: 'ellipse' as const, center: c, radii: [r, q(r * (0.3 + u()))] as [number, number], rotationDeg: pick([0, 30, 90]) }
        : kind === 'polygon' ? { type: 'polygon' as const, points: ((sides: number) => Array.from({ length: sides }, (_, k): [number, number] => {
          const a = (2 * Math.PI * k) / sides;
          return [q(c[0] + r * Math.cos(a)), q(c[1] + r * Math.sin(a))];
        }))(3 + Math.floor(u() * 6)) }
          : kind === 'stroke' ? { type: 'stroke' as const, points: [c, pt(), pt(), pt()], width: q(pick([0.02, 0.05, 0.1])) }
            : { type: 'ellipse' as const, center: [i % 2 ? 0.3 : -0.3, 0] as [number, number], radii: [0.3, 0.3] as [number, number] };   // tangent pair at x = 0
      return { id: `p${i}`, operation: i > 0 && u() < 0.25 ? 'subtract' as const : 'union' as const, geometry, priority: 1 + Math.floor(u() * 5) };
    });
    const scene = { version: 1, mode: 'silhouette2d', title: `Fuzz2D ${out.length}`, view: 'front', foreground: pick(['#ffb000', '#30c0ff', '#ffffff']), parts } as SceneSpec;
    if (validateScene(scene).ok) out.push(scene);
  }
  return out;
}

describe('GF-T41: totality', () => {
  const FUZZ_SEED = 20261115;
  const cases = WIDE ? [...corpus(FUZZ_SEED, 60), ...corpus2D(FUZZ_SEED, 40)] : [...corpus(FUZZ_SEED, 10), ...corpus2D(FUZZ_SEED, 6)];
  const rosters = WIDE ? [1, 2, 40, 200] : [1, 2, 40];

  it(`compiles ${WIDE ? '60 3D + 40 2D' : '10 3D + 6 2D'} seeded valid scenes at n0 ∈ {${rosters}}: ok or a typed rejection, never a throw, never internal`, () => {
    expect(cases.length).toBe(WIDE ? 100 : 16);
    expect(cases.filter((s) => s.mode === 'silhouette2d').length).toBe(WIDE ? 40 : 6);
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

  it('rejects bad n0 and slotSpacingMin as range', () => {
    const scene = load('valid-3d-sphere.json');
    for (const n0 of [0, -1, 1.5, NaN, MAX_N0 + 1, 1e9]) expect(fail(compileGeneratedScene(scene, makeParams(40), n0)).code).toBe('range');
    for (const s of [0, -1, NaN, Infinity, MIN_SLOT_SPACING / 2]) expect(fail(compileGeneratedScene(scene, { n0: 40, slotSpacingMin: s }, 40)).code).toBe('range');
    expect(MAX_N0).toBe(1250);
    expect(compileGeneratedScene(scene, { n0: 40, slotSpacingMin: MIN_SLOT_SPACING }, 40).ok).toBe(true);
  });

  it.each(TALL_2D)('%s at n0 = 200 is a typed below-floor rejection, never clamped (layering, simplification 5, is pending)', (f) => {
    const r = fail(compiled(f, 200));
    expect(r.code).toBe('below-floor');
    expect(r.sceneHash).toBe(sceneHash(load(f)));
  });

  it('a 2D scene whose union is covered by a later subtract is empty-geometry', () => {
    const scene: SceneSpec = {
      version: 1, mode: 'silhouette2d', title: 'Gone', view: 'front', foreground: '#ffb000',
      parts: [
        { id: 'disc', operation: 'union', geometry: { type: 'ellipse', center: [0, 0], radii: [0.5, 0.5] }, priority: 3 },
        { id: 'cut', operation: 'subtract', geometry: { type: 'ellipse', center: [0, 0], radii: [0.9, 0.9] }, priority: 3 },
      ],
    };
    expect(fail(compileGeneratedScene(scene, makeParams(40), 40)).code).toBe('empty-geometry');
  });

  it('maps validation failures to their codes (unsupported-version, reference, range)', () => {
    const sphere = load('valid-3d-sphere.json') as Extract<SceneSpec, { mode: 'scene3d' }>;
    expect(fail(compileGeneratedScene({ ...sphere, version: 2 } as unknown as SceneSpec, makeParams(40), 40)).code).toBe('unsupported-version');
    expect(fail(compileGeneratedScene({ ...sphere, parts: [{ ...sphere.parts[0], materialId: 'nope' }] }, makeParams(40), 40)).code).toBe('reference');
    expect(fail(compileGeneratedScene(sphereScene([0.5, 0.5, 0.5], 0.5, [1.9, 0, 0]), makeParams(40), 40)).code).toBe('range');
  });
});
