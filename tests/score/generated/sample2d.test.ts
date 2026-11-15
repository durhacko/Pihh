// tests/score/generated/sample2d.test.ts
// GF-WP-04 (#207): the candidate-level parts of GF-T09 and GF-T10
// (docs/validation/gemini-formation-evaluation.md §5.2), plus the package's acceptance criteria:
// every candidate inside the region, a thin stroke of width 0.05 still yields feature candidates,
// candidate order a deterministic function of the scene (and the seeded stream), dense 2000 ± 500.
import { describe, it, expect } from 'vitest';
import {
  sample2d, traceContours, foregroundRGB, delta0, interiorTarget,
  BOUNDARY_STEP_DIVISOR, DENSE_TARGET, INTERIOR_MIN,
  type Sample2DResult, type Candidate2D,
} from '../../../src/score/generated/sample2d';
import { buildRegion2D, rasterise, checkConnectivity, type Mask2D, type Pt2, type Region2D } from '../../../src/score/generated/shapes2d';
import type { SceneSpec2D, Shape2D, Geometry2D, ColourSpec } from '../../../src/score/generated/types';

const WIDE = process.env.P2_WIDE === '1';

// A seeded generator for the injected stream and for test data (mulberry32).
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

const part = (id: string, geometry: Geometry2D, operation: 'union' | 'subtract' = 'union', priority = 3): Shape2D =>
  ({ id, operation, priority, geometry });
const disc = (id: string, center: [number, number], r: number, operation: 'union' | 'subtract' = 'union', priority = 3): Shape2D =>
  part(id, { type: 'ellipse', center, radii: [r, r] }, operation, priority);
const scene = (parts: Shape2D[], foreground: ColourSpec = '#FFFFFF'): SceneSpec2D =>
  ({ version: 1, mode: 'silhouette2d', title: 'test', view: 'side', foreground, parts });

interface Prepared { scene: SceneSpec2D; region: Region2D; mask: Mask2D }
function prepare(s: SceneSpec2D): Prepared {
  const region = buildRegion2D(s);
  const check = checkConnectivity(rasterise(region), region);
  if (!check.ok) throw new Error(`fixture is empty: ${check.detail}`);
  return { scene: s, region, mask: check.mask };
}
const run = (p: Prepared, n0 = 200, seed = 7): Sample2DResult => sample2d(p.scene, p.region, p.mask, { n0, next: rng(seed) });
const of = (r: Sample2DResult, source: Candidate2D['source']): Candidate2D[] => r.candidates.filter((c) => c.source === source);
const xy = (c: { pos: [number, number, number] } | [number, number, number]): Pt2 => ('pos' in c ? [c.pos[0], c.pos[1]] : [c[0], c[1]]);

/** Within half a mask cell of the region: the point or one of 16 points around it at that radius is inside. */
function nearRegion(region: Region2D, p: Pt2, radius: number): boolean {
  if (region.contains(p)) return true;
  for (let k = 0; k < 16; k++) {
    const a = (2 * Math.PI * k) / 16;
    if (region.contains([p[0] + radius * Math.cos(a), p[1] + radius * Math.sin(a)])) return true;
  }
  return false;
}

// The completed elephant of the shapes2d tests (William's handoff §4.2 excerpt, completed by hand).
const ELEPHANT: Shape2D[] = [
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
const elephant = prepare(scene(ELEPHANT));
const discP = prepare(scene([disc('d', [0, 0], 0.5)]));
const annulus = prepare(scene([disc('outer', [0, 0], 0.5), disc('hole', [0, 0], 0.25, 'subtract')]));

describe('traceContours (marching squares)', () => {
  const handMask = (size: number, on: [number, number][]): Mask2D => {
    const bits = new Uint8Array(size * size);
    for (const [i, j] of on) bits[j * size + i] = 1;
    return { size, cell: 1, origin: [0, 0], bits, normalise: { scale: 1, centre: [0, 0] } };
  };
  const block = (i0: number, j0: number, k: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let j = j0; j < j0 + k; j++) for (let i = i0; i < i0 + k; i++) out.push([i, j]);
    return out;
  };

  it('a k×k block is one counter-clockwise loop through edge midpoints, area k² − 1/2', () => {
    const loops = traceContours(handMask(8, block(2, 2, 3)));
    expect(loops).toHaveLength(1);
    expect(loops[0].area).toBeCloseTo(8.5, 12);
  });

  it('cells touching only at a corner give two loops (4-connectivity, as shapes2d components)', () => {
    expect(traceContours(handMask(6, [[1, 1], [2, 2]]))).toHaveLength(2);
    expect(traceContours(handMask(6, [[2, 1], [1, 2]]))).toHaveLength(2);
  });

  it('a block with a hole gives an outer loop and a clockwise hole', () => {
    const on = block(1, 1, 5).filter(([i, j]) => !(i === 3 && j === 3));
    const loops = traceContours(handMask(8, on));
    expect(loops).toHaveLength(2);
    expect(loops.filter((l) => l.area > 0)).toHaveLength(1);
    expect(loops.filter((l) => l.area < 0)[0].area).toBeCloseTo(-0.5, 12);
  });

  it('filled cells on the mask border still close their loop', () => {
    const loops = traceContours(handMask(4, block(0, 0, 4)));
    expect(loops).toHaveLength(1);
    expect(loops[0].area).toBeCloseTo(15.5, 12);
  });
});

describe('boundary candidates', () => {
  it('a disc has one outer contour whose candidates are snapped onto the circle', () => {
    const r = run(discP);
    expect(r.contours).toHaveLength(1);
    expect(r.contours[0].hole).toBe(false);
    const R = 0.5 * discP.region.normalise.scale;
    for (const c of of(r, 'boundary')) expect(Math.abs(Math.sqrt(c.pos[0] ** 2 + c.pos[1] ** 2) - R)).toBeLessThan(1e-4 * R);
    expect(Math.abs(r.contours[0].length - 2 * Math.PI * R) / (2 * Math.PI * R)).toBeLessThan(0.02);
  });

  it('samples δ₀/4 apart in arc (up to the snapping slack), from arc 0 at the fixed start, in arc order', () => {
    for (const p of [discP, elephant]) {
      const r = run(p);
      expect(r.stats.boundaryStep).toBeCloseTo(r.stats.delta0 / BOUNDARY_STEP_DIVISOR, 15);
      for (const c of r.contours) {
        const b = r.candidates.slice(c.first, c.first + c.count);
        expect(b[0].arc).toBe(0);
        for (let k = 1; k < b.length; k++) {
          const gap = (b[k].arc ?? 0) - (b[k - 1].arc ?? 0);
          expect(gap).toBeGreaterThan(0);
          // Resampled at most a step apart, then each point moved by at most one cell when snapped.
          expect(gap).toBeLessThanOrEqual(r.stats.boundaryStep + 2 * p.mask.cell);
        }
        expect(c.length / c.count).toBeLessThanOrEqual(r.stats.boundaryStep);
      }
    }
  });

  it('the start is the traced point at the smallest angle from the contour centroid', () => {
    for (const p of [discP, elephant]) {
      const r = run(p);
      for (const [ci, c] of r.contours.entries()) {
        const pts = r.candidates.slice(c.first, c.first + c.count).map(xy);
        const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
        const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
        const ang = (q: Pt2): number => { const a = Math.atan2(q[1] - cy, q[0] - cx); return a < 0 ? a + 2 * Math.PI : a; };
        // Snapping moves points by up to a cell, and the test's centroid is of the resampled points.
        const slack = (4 * p.mask.cell) / Math.min(...pts.map((q) => Math.sqrt((q[0] - cx) ** 2 + (q[1] - cy) ** 2)));
        const a0 = ang(c.start);
        for (const q of pts) expect(ang(q), `contour ${ci}`).toBeGreaterThanOrEqual(a0 - slack);
      }
    }
  });

  it('an annulus has an outer contour and a hole, its hole candidates on the inner circle, owned by the subtract part', () => {
    const r = run(annulus);
    expect(r.contours.map((c) => c.hole).sort()).toEqual([false, true]);
    const hole = r.contours.find((c) => c.hole);
    if (!hole) throw new Error('no hole');
    const R = 0.25 * annulus.region.normalise.scale;
    for (const c of r.candidates.slice(hole.first, hole.first + hole.count)) {
      expect(Math.abs(Math.sqrt(c.pos[0] ** 2 + c.pos[1] ** 2) - R)).toBeLessThan(1e-4 * R);
      expect(c.featureId).toBe('hole');
    }
  });

  it('contour ranges list exactly the boundary candidates of each contour, in order', () => {
    const r = run(elephant);
    let k = 0;
    for (const [ci, c] of r.contours.entries()) {
      expect(c.first).toBe(k);
      for (let q = c.first; q < c.first + c.count; q++) {
        expect(r.candidates[q].source).toBe('boundary');
        expect(r.candidates[q].contour).toBe(ci);
      }
      k += c.count;
    }
    expect(k).toBe(r.stats.counts.boundary);
    expect(r.stats.perimeter).toBeCloseTo(r.contours.reduce((s, c) => s + c.length, 0), 12);
  });
});

describe('every candidate lies inside the region (package acceptance)', () => {
  it.each([[40], [200]])('elephant, n0 = %i: interior and feature inside, boundary within half a cell', (n0) => {
    const r = run(elephant, n0);
    for (const c of r.candidates) {
      if (c.source === 'boundary') expect(nearRegion(elephant.region, xy(c), elephant.mask.cell / 2)).toBe(true);
      else expect(elephant.region.contains(xy(c))).toBe(true);
      expect(c.pos[2]).toBe(0);
    }
  });
});

describe('feature candidates (GF-T09, candidate level)', () => {
  const r = run(elephant);
  const line = (id: string) => r.features.find((f) => f.featureId === id);

  it('every protected part has a feature line with candidates; unprotected parts have none', () => {
    for (const id of ['body', 'head', 'trunk', 'tusk', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br']) {
      expect(line(id)?.count, id).toBeGreaterThan(0);
    }
    for (const id of ['ear', 'tail', 'gap']) expect(line(id), id).toBeUndefined();
  });

  it('a thin stroke of width 0.05 (the tusk) still yields feature candidates along its centreline', () => {
    const tusk = line('tusk');
    expect(tusk?.kind).toBe('centreline');
    const part = elephant.region.parts.find((p) => p.id === 'tusk');
    if (!tusk || !part?.centreline) throw new Error('no tusk');
    for (const c of r.candidates.slice(tusk.first, tusk.first + tusk.count)) {
      expect(c.featureId).toBe('tusk');
      expect(c.importance).toBe(4);
      const cl = part.centreline;
      let best = Infinity;
      for (const q of cl) best = Math.min(best, Math.sqrt((q[0] - c.pos[0]) ** 2 + (q[1] - c.pos[1]) ** 2));
      expect(best).toBeLessThan(0.05);   // within one flattening step of the centreline
    }
  });

  it('feature line kinds and lengths: centreline, major axis, skeleton', () => {
    expect(line('trunk')?.kind).toBe('centreline');
    expect(line('body')?.kind).toBe('major-axis');
    expect(line('body')?.length).toBeCloseTo(2 * 0.62 * elephant.region.normalise.scale, 9);
    for (const id of ['leg_fl', 'leg_fr', 'leg_bl', 'leg_br']) expect(line(id)?.kind).toBe('skeleton');
  });

  it('a leg skeleton runs down the leg: its points spread far more in y than in x', () => {
    const leg = line('leg_fl');
    if (!leg) throw new Error('no leg');
    const pts = r.candidates.slice(leg.first, leg.first + leg.count).map(xy);
    const spread = (k: 0 | 1): number => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
    expect(spread(1)).toBeGreaterThan(4 * spread(0));
  });

  it('an ellipse feature line lies on its major axis', () => {
    const body = line('body');
    if (!body) throw new Error('no body');
    const s = elephant.region.normalise;
    const cy = (0.1 - s.centre[1]) * s.scale;
    for (const c of r.candidates.slice(body.first, body.first + body.count)) expect(Math.abs(c.pos[1] - cy)).toBeLessThan(1e-9);
  });

  it('a protected sliver too thin for the mask still gets a feature line along its axis', () => {
    const p = prepare(scene([disc('base', [0, 0], 0.5), part('wire', { type: 'polygon', points: [[-0.4, 0.7], [0.4, 0.7], [0.4, 0.7008], [-0.4, 0.7008]] }, 'union', 4)]));
    const res = run(p);
    const wire = res.features.find((f) => f.featureId === 'wire');
    expect(wire?.kind === 'skeleton' || wire?.kind === 'principal-axis').toBe(true);
    if (!wire) return;
    const yc = (0.7004 - p.region.normalise.centre[1]) * p.region.normalise.scale;
    for (const c of res.candidates.slice(wire.first, wire.first + wire.count)) expect(Math.abs(c.pos[1] - yc)).toBeLessThan(p.mask.cell);
  });
});

describe('interior candidates and ownership', () => {
  it.each([[40], [200], [500]])('n0 = %i: about max(1,500, 4·n0) interior points', (n0) => {
    const r = run(elephant, n0);
    const want = interiorTarget(n0);
    expect(Math.abs(r.stats.counts.interior - want) / want).toBeLessThan(0.1);
  });

  it('interior points belong to the union part that decides them', () => {
    const p = prepare(scene([disc('a', [-0.2, 0], 0.4), disc('b', [0.2, 0], 0.4)]));
    const r = run(p);
    const parts = p.region.parts;
    for (const c of of(r, 'interior')) {
      const inB = parts[1].contains(xy(c));
      expect(c.featureId).toBe(inB ? 'b' : 'a');
    }
  });

  it('δ₀ = 0.9·√(A / (n0·0.866)) from the filled area', () => {
    const r = run(elephant, 200);
    expect(r.stats.delta0).toBeCloseTo(0.9 * Math.sqrt(r.stats.filledArea / (200 * 0.866)), 15);
    expect(delta0(4, 100)).toBeCloseTo(0.9 * Math.sqrt(4 / 86.6), 15);
    expect(interiorTarget(100)).toBe(INTERIOR_MIN);
  });
});

describe('negative space (GF-T10, candidate level)', () => {
  it('no interior, feature or dense point lies inside the subtracted gap between the legs', () => {
    const r = run(elephant);
    const gapIndex = elephant.region.parts.findIndex((p) => p.id === 'gap');
    const gap = elephant.region.parts[gapIndex];
    const cut = (p: Pt2): boolean => gap.contains(p) && !elephant.region.parts.slice(gapIndex + 1).some((q) => q.contains(p));
    for (const c of r.candidates) if (c.source !== 'boundary') expect(cut(xy(c))).toBe(false);
    for (const d of r.dense) expect(cut(xy(d))).toBe(false);
    // The gap's edges are boundary: some boundary candidates are owned by the gap.
    expect(of(r, 'boundary').some((c) => c.featureId === 'gap')).toBe(true);
  });
});

describe('dense (spec §7.8)', () => {
  const thin = prepare(scene([part('s', { type: 'stroke', points: [[-0.8, 0], [-0.3, 0.3], [0.3, -0.3], [0.8, 0]], width: 0.08 })]));

  it.each([['disc', discP], ['annulus', annulus], ['elephant', elephant], ['thin stroke', thin]])('%s: 2,000 ± 500 points, all inside, z = 0', (_n, p) => {
    const r = run(p);
    expect(Math.abs(r.dense.length - DENSE_TARGET)).toBeLessThanOrEqual(500);
    for (const d of r.dense) {
      expect(p.region.contains(xy(d))).toBe(true);
      expect(d[2]).toBe(0);
    }
  });

  it('is built from the region alone: the same for any n0 and any stream', () => {
    expect(run(elephant, 40, 1).dense).toEqual(run(elephant, 200, 99).dense);
  });
});

describe('determinism and the injected stream', () => {
  it('the same scene and stream give identical results', () => {
    expect(run(elephant, 200, 5)).toEqual(run(elephant, 200, 5));
  });

  it('a different stream moves only the interior lattice', () => {
    const a = run(elephant, 200, 5);
    const b = run(elephant, 200, 6);
    expect(a.candidates.filter((c) => c.source !== 'interior')).toEqual(b.candidates.filter((c) => c.source !== 'interior'));
    expect(of(a, 'interior')).not.toEqual(of(b, 'interior'));
  });

  it('draws exactly two values from next(), and rejects values outside [0, 1)', () => {
    let calls = 0;
    const base = rng(3);
    sample2d(discP.scene, discP.region, discP.mask, { n0: 200, next: () => { calls++; return base(); } });
    expect(calls).toBe(2);
    expect(() => sample2d(discP.scene, discP.region, discP.mask, { n0: 200, next: () => 1 })).toThrow(RangeError);
  });

  it('rejects a bad n0 and an empty mask', () => {
    expect(() => run(discP, 0)).toThrow(RangeError);
    expect(() => run(discP, 1.5)).toThrow(RangeError);
    const empty: Mask2D = { ...discP.mask, bits: new Uint8Array(discP.mask.bits.length) };
    expect(() => sample2d(discP.scene, discP.region, empty, { n0: 200, next: rng(1) })).toThrow(RangeError);
  });
});

describe('colour (spec §7.7)', () => {
  it('a hex foreground becomes /255 on every candidate, with no linearisation', () => {
    const p = prepare(scene([disc('d', [0, 0], 0.5)], '#ffB000'));
    for (const c of run(p).candidates) expect(c.colour).toEqual([1, 176 / 255, 0]);
  });

  it('an [r, g, b] foreground passes through; a malformed string is refused', () => {
    expect(foregroundRGB([0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    expect(() => foregroundRGB('#FFF')).toThrow(RangeError);
  });
});

describe.runIf(WIDE)('P2_WIDE: invariants over a seeded corpus of random scenes', () => {
  it('inside, deterministic, dense band, interior count, at n0 40, 100, 150 and 200', () => {
    const next = rng(2026);
    const coord = (): number => Math.round((next() * 2 - 1) * 1e4) / 1e4;
    let scenes = 0;
    for (let k = 0; k < 14; k++) {   // sized to stay well inside the 15 s P2_WIDE cap on a loaded machine
      const parts: Shape2D[] = [disc('core', [0, 0], 0.35 + 0.2 * next())];
      const extra = 2 + Math.floor(next() * 5);
      for (let q = 0; q < extra; q++) {
        const kind = Math.floor(next() * 4);
        const pr = 1 + Math.floor(next() * 5);
        const c: [number, number] = [coord() * 0.7, coord() * 0.7];
        if (kind === 0) parts.push(part(`e${q}`, { type: 'ellipse', center: c, radii: [0.05 + 0.3 * next(), 0.05 + 0.3 * next()], rotationDeg: Math.round(next() * 360) }, 'union', pr));
        else if (kind === 1) parts.push(part(`s${q}`, { type: 'stroke', points: [c, [coord(), coord()], [coord(), coord()], [coord(), coord()]], width: 0.03 + 0.1 * next() }, 'union', pr));
        else if (kind === 2) parts.push(part(`p${q}`, { type: 'polygon', points: [c, [c[0] + 0.3, c[1]], [c[0] + 0.15, c[1] + 0.3 * next() + 0.05]] }, 'union', pr));
        else parts.push(disc(`h${q}`, c, 0.05 + 0.1 * next(), 'subtract'));
      }
      let p: Prepared;
      try { p = prepare(scene(parts)); } catch { continue; }
      scenes++;
      for (const n0 of [40, 100, 150, 200]) {
        const r = run(p, n0, k);
        expect(run(p, n0, k)).toEqual(r);
        for (const c of r.candidates) {
          if (c.source === 'boundary') expect(nearRegion(p.region, xy(c), p.mask.cell / 2)).toBe(true);
          else expect(p.region.contains(xy(c))).toBe(true);
        }
        expect(Math.abs(r.dense.length - DENSE_TARGET)).toBeLessThanOrEqual(500);
        expect(Math.abs(r.stats.counts.interior - interiorTarget(n0)) / interiorTarget(n0)).toBeLessThan(0.1);
      }
    }
    expect(scenes).toBeGreaterThan(9);
  }, 15000);
});
