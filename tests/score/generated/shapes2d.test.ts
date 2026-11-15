// tests/score/generated/shapes2d.test.ts
// GF-WP-03 (#206): GF-T06, GF-T07 and the mask half of GF-T08
// (docs/validation/gemini-formation-evaluation.md §5.2), plus the package's own acceptance criteria.
import { describe, it, expect } from 'vitest';
import {
  bezierBernstein, bezierDeCasteljau, flattenCubic, sampleCubicByArcLength, buildRegion, buildRegion2D,
  rasterise, components, checkConnectivity, filledArea, cellCentre,
  MASK_SIZE, MIN_STROKE_WIDTH, MIN_RADIUS, NORMALISED_HALF_EXTENT,
  type Pt2, type PartInput2D, type Geom2D, type Mask2D,
} from '../../../src/score/generated/shapes2d';

// A seeded generator for test data (mulberry32), so the "random" segments are fixed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSegments(count: number, seed: number): [Pt2, Pt2, Pt2, Pt2][] {
  const next = rng(seed);
  const coord = (): number => Math.round((next() * 3 - 1.5) * 1e4) / 1e4;   // the 1e-4 grid of V5's range
  const out: [Pt2, Pt2, Pt2, Pt2][] = [];
  for (let i = 0; i < count; i++) out.push([[coord(), coord()], [coord(), coord()], [coord(), coord()], [coord(), coord()]]);
  return out;
}

const part = (id: string, geometry: Geom2D, operation: 'union' | 'subtract' = 'union', priority = 3): PartInput2D =>
  ({ id, operation, priority, geometry });
const disc = (id: string, center: Pt2, r: number, operation: 'union' | 'subtract' = 'union', priority = 3): PartInput2D =>
  part(id, { type: 'ellipse', center, radii: [r, r] }, operation, priority);

/** Filled area in scene units² (the mask is in normalised space). */
const sceneArea = (mask: Mask2D): number => filledArea(mask) / (mask.normalise.scale * mask.normalise.scale);
const relErr = (got: number, want: number): number => Math.abs(got - want) / want;
const maskOf = (parts: PartInput2D[]): Mask2D => rasterise(buildRegion(parts));
const sameBits = (a: Mask2D, b: Mask2D): boolean => a.bits.length === b.bits.length && a.bits.every((v, k) => v === b.bits[k]);

/** Arc length of segment points between parameters t0 and t1, by a fine independent polyline. */
function arcBetween(seg: [Pt2, Pt2, Pt2, Pt2], t0: number, t1: number, steps = 4000): number {
  let len = 0;
  let prev = bezierBernstein(...seg, t0);
  for (let s = 1; s <= steps; s++) {
    const p = bezierBernstein(...seg, t0 + ((t1 - t0) * s) / steps);
    len += Math.sqrt((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2);
    prev = p;
  }
  return len;
}

// A local elephant in profile (William's 2D example, handoff §4.2, completed by hand): body, head, ear
// path, trunk and tusk strokes, four legs, a tail, and a subtracted gap between the legs.
const ELEPHANT: PartInput2D[] = [
  part('body', { type: 'ellipse', center: [0, 0.1], radii: [0.62, 0.38] }, 'union', 5),
  part('head', { type: 'ellipse', center: [0.62, 0.3], radii: [0.26, 0.24], rotationDeg: -15 }, 'union', 5),
  part('ear', { type: 'path', points: [[0.5, 0.45], [0.38, 0.6], [0.3, 0.2], [0.48, 0.12], [0.6, 0.06], [0.62, 0.3], [0.5, 0.45]] }, 'union', 3),
  part('trunk', { type: 'stroke', points: [[0.8, 0.22], [0.98, 0.0], [0.92, -0.35], [0.98, -0.55]], width: 0.12 }, 'union', 5),
  part('tusk', { type: 'stroke', points: [[0.74, 0.12], [0.86, 0.02], [0.96, 0.0], [1.04, 0.06]], width: 0.05 }, 'union', 4),
  part('leg_fl', { type: 'polygon', points: [[0.3, -0.15], [0.48, -0.15], [0.47, -0.7], [0.31, -0.7]] }, 'union', 4),
  part('leg_fr', { type: 'polygon', points: [[0.12, -0.15], [0.28, -0.15], [0.27, -0.7], [0.13, -0.7]] }, 'union', 4),
  part('leg_bl', { type: 'polygon', points: [[-0.5, -0.15], [-0.32, -0.15], [-0.33, -0.7], [-0.49, -0.7]] }, 'union', 4),
  part('leg_br', { type: 'polygon', points: [[-0.3, -0.15], [-0.14, -0.15], [-0.15, -0.7], [-0.29, -0.7]] }, 'union', 4),
  part('tail', { type: 'stroke', points: [[-0.6, 0.2], [-0.72, 0.1], [-0.74, -0.05], [-0.7, -0.2]], width: 0.04 }, 'union', 2),
  part('gap', { type: 'polygon', points: [[-0.12, -0.2], [0.1, -0.2], [0.1, -0.75], [-0.12, -0.75]] }, 'subtract', 3),
];

describe('GF-T06 Bézier evaluation', () => {
  const segments = randomSegments(20, 6);

  it('B(0) = P0 and B(1) = P3 exactly, in both forms', () => {
    for (const s of segments) {
      for (const f of [bezierBernstein, bezierDeCasteljau]) {
        const a = f(...s, 0);
        const b = f(...s, 1);
        expect(a[0] === s[0][0] && a[1] === s[0][1]).toBe(true);
        expect(b[0] === s[3][0] && b[1] === s[3][1]).toBe(true);
      }
    }
  });

  it('the Bernstein form and de Casteljau agree within 1e-12 on 20 seeded segments', () => {
    const ts = rng(66);
    let worst = 0;
    for (const s of segments) {
      for (let k = 0; k < 50; k++) {
        const t = k < 11 ? k / 10 : ts();
        const a = bezierBernstein(...s, t);
        const b = bezierDeCasteljau(...s, t);
        worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('arc-length sampling is monotone in t and evenly spaced within 10% along each segment', () => {
    const count = 16;
    for (const s of segments) {
      const samples = sampleCubicByArcLength(s, count);
      expect(samples).toHaveLength(count + 1);
      expect(samples[0].t).toBe(0);
      expect(samples[count].t).toBe(1);
      expect(samples[count].p).toEqual(s[3]);
      for (let m = 1; m <= count; m++) expect(samples[m].t).toBeGreaterThan(samples[m - 1].t);
      const total = arcBetween(s, 0, 1, 20000);
      for (let m = 1; m <= count; m++) {
        const piece = arcBetween(s, samples[m - 1].t, samples[m].t);
        expect(relErr(piece, total / count)).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('flattenCubic gives k·n + 1 points with exact joints, and rejects a chain that is not 3k + 1', () => {
    const chain: Pt2[] = [[0, 0], [0.2, 0.4], [0.5, 0.4], [0.7, 0], [0.9, -0.4], [1.1, -0.2], [1.3, 0.1]];
    const flat = flattenCubic(chain, 16);
    expect(flat).toHaveLength(2 * 16 + 1);
    expect(flat[0]).toEqual(chain[0]);
    expect(flat[16]).toEqual(chain[3]);
    expect(flat[32]).toEqual(chain[6]);
    expect(() => flattenCubic(chain.slice(0, 6), 16)).toThrow(RangeError);
    expect(() => flattenCubic(chain, 0)).toThrow(RangeError);
    expect(() => sampleCubicByArcLength(chain.slice(0, 3), 4)).toThrow(RangeError);
  });

  it('a multi-segment chain is sampled across its segments with the chain parameter', () => {
    const chain: Pt2[] = [[0, 0], [0.2, 0.4], [0.5, 0.4], [0.7, 0], [0.9, -0.4], [1.1, -0.2], [1.3, 0.1]];
    const samples = sampleCubicByArcLength(chain, 20);
    expect(samples[20].t).toBe(2);
    expect(samples[20].p).toEqual(chain[6]);
    for (let m = 1; m <= 20; m++) expect(samples[m].t).toBeGreaterThan(samples[m - 1].t);
  });
});

describe('GF-T07 union and subtract on the 512² mask', () => {
  it('a disc of radius 0.5 covers π/16 of the [-1, 1]² area within 1%', () => {
    const mask = maskOf([disc('d', [0, 0], 0.5)]);
    expect(mask.size).toBe(MASK_SIZE);
    expect(relErr(sceneArea(mask) / 4, Math.PI / 16)).toBeLessThan(0.01);
  });

  it('a disc minus a concentric disc of radius 0.25 gives the annulus area within 1%, as one component', () => {
    const mask = maskOf([disc('outer', [0, 0], 0.5), disc('hole', [0, 0], 0.25, 'subtract')]);
    expect(relErr(sceneArea(mask), Math.PI * (0.25 - 0.0625))).toBeLessThan(0.01);
    expect(components(mask).count).toBe(1);
  });

  it('parts apply in array order: a later union refills a cut-out, and an early subtract cuts nothing', () => {
    const big = disc('big', [0, 0], 0.5);
    const hole = disc('hole', [0, 0], 0.25, 'subtract');
    const plug = disc('plug', [0, 0], 0.1);
    const plugged = maskOf([big, hole, plug]);
    expect(relErr(sceneArea(plugged), Math.PI * (0.25 - 0.0625 + 0.01))).toBeLessThan(0.01);
    const subtractFirst = maskOf([hole, big]);
    expect(relErr(sceneArea(subtractFirst), Math.PI * 0.25)).toBeLessThan(0.01);
  });

  it('reversing a union-only list gives an identical mask', () => {
    const parts = [
      disc('a', [-0.2, 0], 0.4),
      part('b', { type: 'polygon', points: [[0, -0.3], [0.6, -0.2], [0.5, 0.4]] }),
      part('c', { type: 'stroke', points: [[-0.6, 0.5], [-0.2, 0.7], [0.2, 0.2], [0.6, 0.6]], width: 0.1 }),
      part('d', { type: 'path', points: [[0, 0.3], [0.3, 0.6], [0.5, 0.1], [0.2, -0.1], [-0.1, -0.3], [-0.3, 0.1], [0, 0.3]] }),
    ];
    expect(sameBits(maskOf(parts), maskOf([...parts].reverse()))).toBe(true);
  });
});

describe('analytic areas (package acceptance)', () => {
  it('a rotated ellipse matches πab within 1%', () => {
    const mask = maskOf([part('e', { type: 'ellipse', center: [0.1, -0.2], radii: [0.6, 0.3], rotationDeg: 30 })]);
    expect(relErr(sceneArea(mask), Math.PI * 0.6 * 0.3)).toBeLessThan(0.01);
  });

  it('a square matches its area within 1%', () => {
    const mask = maskOf([part('sq', { type: 'polygon', points: [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]] })]);
    expect(relErr(sceneArea(mask), 0.64)).toBeLessThan(0.01);
  });

  it('a straight stroke matches length·width plus its round caps within 1%', () => {
    const mask = maskOf([part('s', { type: 'stroke', points: [[-0.5, 0], [-0.2, 0], [0.2, 0], [0.5, 0]], width: 0.2 })]);
    expect(relErr(sceneArea(mask), 1 * 0.2 + Math.PI * 0.01)).toBeLessThan(0.01);
  });

  it('a closed path traced around a square matches the square within 1%', () => {
    const c = 0.4;
    const third = (a: number, b: number, k: number): number => a + ((b - a) * k) / 3;
    const corners: Pt2[] = [[-c, -c], [c, -c], [c, c], [-c, c]];
    const pts: Pt2[] = [corners[0]];
    for (let e = 0; e < 4; e++) {
      const a = corners[e];
      const b = corners[(e + 1) % 4];
      pts.push([third(a[0], b[0], 1), third(a[1], b[1], 1)], [third(a[0], b[0], 2), third(a[1], b[1], 2)], [b[0], b[1]]);
    }
    const mask = maskOf([part('p', { type: 'path', points: pts })]);
    expect(relErr(sceneArea(mask), 0.64)).toBeLessThan(0.01);
  });
});

describe('GF-T08 connected regions on the mask (the WP-03 half)', () => {
  const blobs = (n: number): PartInput2D[] => [disc('a', [-0.8, 0], 0.15), disc('b', [0, 0], 0.15), disc('c', [0.8, 0], 0.15)].slice(0, n);

  it.each([1, 2, 3])('%i separated blob(s): that many components, and more than one warns `disconnected`', (n) => {
    const region = buildRegion(blobs(n));
    const mask = rasterise(region);
    expect(components(mask).count).toBe(n);
    const check = checkConnectivity(mask, region);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.components.count).toBe(n);
    expect(check.warnings.some((w) => w.code === 'disconnected')).toBe(n > 1);
  });

  it('reports the largest component share', () => {
    const c = components(maskOf([disc('big', [-0.3, 0], 0.4), disc('small', [0.6, 0], 0.2)]));
    expect(c.count).toBe(2);
    expect(c.largestShare).toBeGreaterThan(0.75);
    expect(c.largestShare).toBeLessThan(0.85);   // 0.16 / (0.16 + 0.04) = 0.8
  });

  it('drops a speck under 0.5% (V8) with a warning, so the silhouette is one component again', () => {
    const region = buildRegion([disc('body', [0, 0], 0.5), disc('fleck', [0.8, 0.5], 0.03)]);
    const mask = rasterise(region);
    expect(components(mask).count).toBe(2);
    const check = checkConnectivity(mask, region);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.components.count).toBe(1);
    expect(check.droppedCells).toBeGreaterThan(0);
    expect(check.warnings.map((w) => w.code)).toEqual(['speck-dropped']);
    expect(check.warnings[0].partId).toBe('fleck');
    expect(components(mask).count).toBe(2);   // the input mask is untouched
  });

  it('keeps a speck of a protected part and names the part', () => {
    const region = buildRegion([disc('body', [0, 0], 0.5), disc('eye', [0.8, 0.5], 0.03, 'union', 5)]);
    const check = checkConnectivity(rasterise(region), region);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.droppedCells).toBe(0);
    expect(check.components.count).toBe(2);
    expect(check.warnings.find((w) => w.code === 'speck-kept')?.partId).toBe('eye');
    expect(check.warnings.some((w) => w.code === 'disconnected')).toBe(true);
  });

  it('a scene that fills nothing is the rejection `empty-geometry`', () => {
    const region = buildRegion([disc('d', [0, 0], 0.3), disc('all', [0, 0], 0.6, 'subtract')]);
    const check = checkConnectivity(rasterise(region), region);
    expect(check).toMatchObject({ ok: false, code: 'empty-geometry' });
  });
});

describe('normalisation (spec §7.2 step 2)', () => {
  it('scales the union box so its longer side spans [-1.1, 1.1], ignoring subtract parts', () => {
    const region = buildRegion([
      part('e', { type: 'ellipse', center: [0.3, 0.2], radii: [0.5, 0.2] }),
      disc('far', [1.4, 1.4], 0.05, 'subtract'),
    ]);
    expect(region.normalise.scale).toBeCloseTo(2.2, 12);
    expect(region.normalise.centre[0]).toBeCloseTo(0.3, 12);
    expect(region.normalise.centre[1]).toBeCloseTo(0.2, 12);
    expect(region.bbox.min[0]).toBeCloseTo(-NORMALISED_HALF_EXTENT, 12);
    expect(region.bbox.max[0]).toBeCloseTo(NORMALISED_HALF_EXTENT, 12);
    expect(region.bbox.max[1]).toBeCloseTo(0.44, 12);
  });

  it('a half-size copy of a scene gives the identical mask', () => {
    const half = (p: Pt2): Pt2 => [p[0] * 0.5, p[1] * 0.5];
    const shrink = (g: Geom2D): Geom2D => {
      switch (g.type) {
        case 'ellipse': return { ...g, center: half(g.center), radii: half(g.radii) };
        case 'polygon': return { ...g, points: g.points.map(half) };
        case 'path': return { ...g, points: g.points.map(half) };
        case 'stroke': return { ...g, points: g.points.map(half), width: g.width * 0.5 };
      }
    };
    const small = ELEPHANT.map((p) => ({ ...p, geometry: shrink(p.geometry) }));
    expect(sameBits(maskOf(ELEPHANT), maskOf(small))).toBe(true);
  });
});

describe('V10 feature size', () => {
  const withStroke = (width: number): ReturnType<typeof buildRegion> => buildRegion([
    part('base', { type: 'polygon', points: [[-1, -0.1], [1, -0.1], [1, 0.1], [-1, 0.1]] }),
    part('hair', { type: 'stroke', points: [[-0.5, 0.3], [-0.2, 0.35], [0.2, 0.35], [0.5, 0.3]], width }, 'union', 4),
  ]);

  it('thickens a stroke below the minimum width to the minimum, with a warning', () => {
    const region = withStroke(0.005);   // 0.0055 normalised (scale 1.1)
    const hair = region.parts[1].geometry;
    expect(hair.type === 'stroke' && hair.width).toBe(MIN_STROKE_WIDTH);
    expect(region.warnings).toEqual([expect.objectContaining({ code: 'thickened', partId: 'hair' })]);
  });

  it('warns `thin-feature` below twice the minimum, without changing the width', () => {
    const region = withStroke(0.03);    // 0.033 normalised
    const hair = region.parts[1].geometry;
    expect(hair.type === 'stroke' && hair.width).toBeCloseTo(0.033, 12);
    expect(region.warnings.map((w) => w.code)).toEqual(['thin-feature']);
  });

  it('thickens an ellipse radius below the minimum', () => {
    const region = buildRegion([disc('base', [0, 0], 0.5), part('tusk', { type: 'ellipse', center: [0.2, 0.6], radii: [0.3, 0.002] })]);
    const tusk = region.parts[1].geometry;
    expect(tusk.type === 'ellipse' && tusk.radii[1]).toBe(MIN_RADIUS);
    expect(region.warnings.map((w) => w.code)).toEqual(['thickened']);
  });

  it('a stroke of width 0.05 in a scene about 2 units across stays visible on the mask', () => {
    const region = withStroke(0.05);
    const mask = rasterise(region);
    // The centreline passes x = 0 at y = 0.3375 (t = 0.5, by symmetry).
    const [x, y] = [-region.normalise.centre[0] * region.normalise.scale, (0.3375 - region.normalise.centre[1]) * region.normalise.scale];
    const i = Math.floor((x - mask.origin[0]) / mask.cell);
    const j = Math.floor((y - mask.origin[1]) / mask.cell);
    expect(mask.bits[j * mask.size + i]).toBe(1);
  });
});

describe('determinism and consistency', () => {
  it('repeated builds and rasterisations give byte-identical masks', () => {
    const a = maskOf(ELEPHANT);
    const b = maskOf(ELEPHANT);
    expect(sameBits(a, b)).toBe(true);
    const region = buildRegion(ELEPHANT);
    expect(sameBits(rasterise(region), rasterise(region))).toBe(true);
  });

  it('the mask is exactly region.contains at every cell centre (elephant fixture)', () => {
    const region = buildRegion(ELEPHANT);
    const mask = rasterise(region);
    let mismatches = 0;
    let filled = 0;
    for (let j = 0; j < mask.size; j++) {
      for (let i = 0; i < mask.size; i++) {
        const bit = mask.bits[j * mask.size + i];
        filled += bit;
        if ((bit === 1) !== region.contains(cellCentre(mask, i, j))) mismatches++;
      }
    }
    expect(filled).toBeGreaterThan(10000);
    expect(mismatches).toBe(0);
  });

  it('the elephant is one connected silhouette and its leg gap is empty', () => {
    const region = buildRegion(ELEPHANT);
    const mask = rasterise(region);
    const check = checkConnectivity(mask, region);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.components.count).toBe(1);
    const gap = region.parts.find((p) => p.id === 'gap');
    expect(gap).toBeDefined();
    if (!gap) return;
    for (let j = 0; j < mask.size; j++) {
      for (let i = 0; i < mask.size; i++) {
        const c = cellCentre(mask, i, j);
        if (gap.contains(c) && !region.parts.slice(region.parts.indexOf(gap) + 1).some((p) => p.contains(c))) {
          expect(mask.bits[j * mask.size + i]).toBe(0);
        }
      }
    }
  });
});

describe('outlines and part data', () => {
  it('an ellipse outline lies on the ellipse with spacing at most the step', () => {
    const region = buildRegion([part('e', { type: 'ellipse', center: [0, 0], radii: [0.5, 0.25], rotationDeg: 40 })]);
    const e = region.parts[0];
    const g = e.geometry;
    if (g.type !== 'ellipse') throw new Error('expected an ellipse');
    const step = 0.05;
    const out = e.outline(step);
    const th = (40 * Math.PI) / 180;
    for (const p of out) {
      const lx = Math.cos(th) * (p[0] - g.center[0]) + Math.sin(th) * (p[1] - g.center[1]);
      const ly = Math.cos(th) * (p[1] - g.center[1]) - Math.sin(th) * (p[0] - g.center[0]);
      expect(Math.abs((lx / g.radii[0]) ** 2 + (ly / g.radii[1]) ** 2 - 1)).toBeLessThan(2e-3);
    }
    for (let k = 0; k < out.length; k++) {
      const a = out[k];
      const b = out[(k + 1) % out.length];
      expect(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)).toBeLessThanOrEqual(step + 1e-12);
    }
  });

  it('a straight stroke outline is at half the width from its centreline (caps within their chord sagitta)', () => {
    const region = buildRegion([part('s', { type: 'stroke', points: [[-0.5, 0], [-0.2, 0], [0.2, 0], [0.5, 0]], width: 0.2 })]);
    const s = region.parts[0];
    const g = s.geometry;
    if (g.type !== 'stroke' || !s.centreline) throw new Error('expected a stroke with a centreline');
    const line = s.centreline;
    for (const p of s.outline(0.02)) {
      let best = Infinity;
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k];
        const b = line[k + 1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
        best = Math.min(best, Math.sqrt((a[0] + t * (b[0] - a[0]) - p[0]) ** 2 + (a[1] + t * (b[1] - a[1]) - p[1]) ** 2));
      }
      expect(best).toBeLessThanOrEqual(g.width / 2 + 1e-9);
      expect(best).toBeGreaterThan(g.width / 2 * 0.99);
    }
  });

  it('only strokes carry a centreline; polygons and paths carry their ring', () => {
    const region = buildRegion(ELEPHANT);
    for (const p of region.parts) {
      expect(p.centreline !== undefined).toBe(p.geometry.type === 'stroke');
      expect(p.ring !== undefined).toBe(p.geometry.type === 'polygon' || p.geometry.type === 'path');
    }
  });
});

describe('adapter and input errors', () => {
  it('buildRegion2D reads a scene-shaped object and matches buildRegion on its parts', () => {
    const scene = { version: 1, mode: 'silhouette2d', title: 'Elephant', view: 'side', foreground: '#FFFFFF', parts: ELEPHANT };
    expect(sameBits(rasterise(buildRegion2D(scene)), maskOf(ELEPHANT))).toBe(true);
  });

  it('rejects a scene with no union part, a malformed chain and a non-finite number', () => {
    expect(() => buildRegion([disc('d', [0, 0], 0.3, 'subtract')])).toThrow(RangeError);
    expect(() => buildRegion([part('p', { type: 'path', points: [[0, 0], [1, 0], [1, 1]] })])).toThrow(RangeError);
    expect(() => buildRegion([disc('d', [Number.NaN, 0], 0.3)])).toThrow(RangeError);
    expect(() => buildRegion([part('s', { type: 'stroke', points: [[0, 0], [0.1, 0], [0.2, 0], [0.3, 0]], width: 0 })])).toThrow(RangeError);
    expect(() => rasterise(buildRegion([disc('d', [0, 0], 0.3)]), 0)).toThrow(RangeError);
  });
});
