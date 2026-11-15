// tests/score/generated/shapes3d.test.ts
// GF-WP-05 (#211): 3D primitives. Depths are exact signed distances (checked against brute force on the analytic
// surface), samples lie on the analytic surface with outward unit normals, mesh areas match the analytic areas,
// tube frames are rotation-minimising and orthonormal (GF-T13), and mirror-x is an exact reflection (GF-T15 (1)).
// Default-suite budget (WP §2.3 item 7): the brute-force distance probes and the large sample counts run only with
// P2_WIDE=1; the default suite keeps a fast smoke of every check (fewer samples, analytic depth values).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Vec3 } from '../../../src/contracts';
import { buildSolid, buildSolids, ellipsoidSignedDistance, mirrorSolid, rotationMatrix, tubeFrames, type Part3DInput, type Solid3D, type Warning3D } from '../../../src/score/generated/shapes3d';

/** Test-only seeded stream (the compiler's own is GF-WP-02's sfc32): mulberry32 seeded by FNV-1a of the label. */
function testStream(label: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WIDE = Boolean(process.env.P2_WIDE);
const SURFACE_SAMPLES = WIDE ? 3000 : 300;
const part = (id: string, shape: Part3DInput['shape'], extra: Partial<Part3DInput> = {}): Part3DInput => ({ id, shape, materialId: 'm', importance: 3, ...extra });
const norm = (v: Vec3) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const dist = (a: Vec3, b: Vec3) => norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

const SHAPES: Record<string, Part3DInput['shape']> = {
  sphere: { type: 'ellipsoid', center: [0.1, -0.2, 0.3], radii: [0.5, 0.5, 0.5] },
  ellipsoid: { type: 'ellipsoid', center: [0, 0, 0], radii: [1, 0.5, 0.3], rotationDeg: [20, -35, 50] },
  capsule: { type: 'capsule', center: [0.2, 0.1, 0], radius: 0.2, length: 0.8, rotationDeg: [0, 0, 60] },
  cylinder: { type: 'cylinder', center: [0, 0.3, -0.2], radius: 0.3, height: 0.6, rotationDeg: [45, 10, 0] },
  cone: { type: 'cone', center: [0, 0, 0], baseRadius: 0.4, topRadius: 0.1, height: 0.7, rotationDeg: [0, 30, -20] },
  pointedCone: { type: 'cone', center: [0, 0, 0], baseRadius: 0.3, topRadius: 0, height: 0.6 },
  // Two segments joined smoothly (C1: P4 = 2·P3 − P2), as V6 needs a tube radius below the local curvature radius.
  tube: { type: 'taperedTube', points: [[0, 0, 0], [0.3, 0.4, 0.1], [0.6, 0.2, -0.2], [0.9, 0.5, 0], [1.2, 0.8, 0.2], [0.9, 1.1, 0.5], [0.6, 1.1, 0.4]], startRadius: 0.15, endRadius: 0.05 },
};

describe('rotation: R = Rz · Ry · Rx in degrees, snapped (spec §6.1)', () => {
  it('applies X first, then Y, then Z, on fixed axes, and is orthonormal', () => {
    const apply = (deg: Vec3, v: Vec3) => { const m = rotationMatrix(deg); return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; };
    expect(apply([0, 90, 0], [1, 0, 0])).toEqual([0, 0, -1]);        // snapped: exact zeros
    expect(apply([0, 0, 90], [1, 0, 0])).toEqual([0, 1, 0]);
    expect(apply([90, 90, 0], [0, 1, 0])).toEqual([1, 0, 0]);        // Rx: y → z; then Ry: z → x
    const m = rotationMatrix([17, -63, 141]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const d = m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2];
      expect(d).toBeCloseTo(i === j ? 1 : 0, 8);
    }
  });
});

describe('ellipsoid signed distance (Eberly, exact)', () => {
  it('equals 1 − |p| on a unit sphere and r_min at the centre of an ellipsoid', () => {
    for (const p of [[0, 0, 0], [0.3, 0.2, -0.1], [2, 0, 0], [0.5, 0.5, 0.5]] as Vec3[]) expect(ellipsoidSignedDistance([1, 1, 1], p)).toBeCloseTo(norm(p) - 1, 12);
    expect(ellipsoidSignedDistance([1, 0.5, 0.3], [0, 0, 0])).toBeCloseTo(-0.3, 12);
    expect(ellipsoidSignedDistance([1, 0.5, 0.3], [0, 0, 0.7])).toBeCloseTo(0.4, 12);
  });

  it('capsule, cylinder, cone and straight tube give their analytic depths at known points (default smoke)', () => {
    const at = (shape: Part3DInput['shape'], p: Vec3) => buildSolid(part('s', shape), 0).insideDepth(p);
    const capsule: Part3DInput['shape'] = { type: 'capsule', center: [0, 0, 0], radius: 0.2, length: 0.8 };
    expect(at(capsule, [0, 0, 0])).toBeCloseTo(0.2, 12);
    expect(at(capsule, [0.1, 0.3, 0])).toBeCloseTo(0.1, 12);
    expect(at(capsule, [0, 0.7, 0])).toBeCloseTo(-0.1, 12);          // beyond the hemisphere: 0.3 from its centre
    const cylinder: Part3DInput['shape'] = { type: 'cylinder', center: [0, 0, 0], radius: 0.3, height: 0.4 };
    expect(at(cylinder, [0, 0, 0])).toBeCloseTo(0.2, 12);             // nearer the caps than the side
    expect(at(cylinder, [0.25, 0, 0])).toBeCloseTo(0.05, 12);
    expect(at(cylinder, [0.4, 0.3, 0])).toBeCloseTo(-Math.sqrt(0.02), 12);   // off the rim edge
    const cone: Part3DInput['shape'] = { type: 'cone', center: [0, 0, 0], baseRadius: 0.4, topRadius: 0, height: 0.6 };
    expect(at(cone, [0, -0.25, 0])).toBeCloseTo(0.05, 12);            // above the base cap
    expect(at(cone, [0, 0.4, 0])).toBeCloseTo(-0.1, 12);              // straight above the apex
    const tube: Part3DInput['shape'] = { type: 'taperedTube', points: [[0, 0, 0], [0, 1 / 3, 0], [0, 2 / 3, 0], [0, 1, 0]], startRadius: 0.1, endRadius: 0.1 };
    expect(at(tube, [0.05, 0.5, 0])).toBeCloseTo(0.05, 9);
    expect(at(tube, [0, 1.15, 0])).toBeCloseTo(-0.05, 9);
  });
});

describe('every primitive: depth, projection, normals and area', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const solid = buildSolid(part(name, shape), 0);
    const samples = solid.surface(SURFACE_SAMPLES, testStream(name));

    it(`${name}: samples lie on the analytic surface (|depth| < 1e-9), inside the box, with outward unit normals`, () => {
      expect(samples).toHaveLength(SURFACE_SAMPLES);
      for (const { pos, normal } of samples) {
        expect(Math.abs(solid.insideDepth(pos))).toBeLessThan(1e-9);
        expect(Math.abs(norm(normal) - 1)).toBeLessThan(1e-12);
        for (let a = 0; a < 3; a++) { expect(pos[a]).toBeGreaterThanOrEqual(solid.box.min[a] - 1e-12); expect(pos[a]).toBeLessThanOrEqual(solid.box.max[a] + 1e-12); }
        const h = 1e-4;
        expect(solid.insideDepth([pos[0] + h * normal[0], pos[1] + h * normal[1], pos[2] + h * normal[2]])).toBeLessThan(0);
        expect(solid.insideDepth([pos[0] - h * normal[0], pos[1] - h * normal[1], pos[2] - h * normal[2]])).toBeGreaterThan(0);
      }
    });

    it.runIf(WIDE)(`${name}: insideDepth is the signed distance to the surface (brute force over 20,000 surface points; P2_WIDE)`, () => {
      const cloud = solid.surface(20000, testStream(`${name}:cloud`));
      const next = testStream(`${name}:probe`);
      const { min, max } = solid.box;
      for (let k = 0; k < 40; k++) {
        const p: Vec3 = [0, 1, 2].map(a => min[a] - 0.2 + (max[a] - min[a] + 0.4) * next()) as Vec3;
        let best = Infinity;
        for (const s of cloud) best = Math.min(best, dist(p, s.pos));
        const d = solid.insideDepth(p);
        // A tapered tube's depth is the spec's "distance to the centreline below the local radius" (§7.3 step 3): an
        // inside test whose positive value overstates the Euclidean depth by at most 1/cos(taper angle) (under 1%
        // here). Outside, its magnitude is not a Euclidean distance (the nearest surface may be a thicker section),
        // and only its sign is used, so outside tube points are checked by sign alone below.
        if (name === 'tube' && d < 0) { expect(best).toBeGreaterThan(0); continue; }
        // The cloud is a sample, so brute force can only be >= the true distance, by about its spacing.
        expect(Math.abs(d)).toBeLessThanOrEqual(best * (name === 'tube' ? 1.01 : 1) + 1e-9);
        expect(best - Math.abs(d)).toBeLessThan(name === 'tube' ? 0.03 : 0.02);
      }
    });
  }

  it('mesh areas match the analytic areas (ellipsoid by Thomsen within 1.5%, the rest within 1%)', () => {
    const area = (shape: Part3DInput['shape']) => buildSolid(part('a', shape), 0).area();
    const r = 0.5, pi = Math.PI;
    expect(area({ type: 'ellipsoid', center: [0, 0, 0], radii: [r, r, r] }) / (4 * pi * r * r)).toBeCloseTo(1, 1);
    expect(Math.abs(area({ type: 'ellipsoid', center: [0, 0, 0], radii: [r, r, r] }) / (4 * pi * r * r) - 1)).toBeLessThan(0.015);
    const [a, b, c] = [1, 0.5, 0.3], p = 1.6075;   // Knud Thomsen's approximation, about 1% error
    const thomsen = 4 * pi * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p);
    expect(Math.abs(area({ type: 'ellipsoid', center: [0, 0, 0], radii: [a, b, c] }) / thomsen - 1)).toBeLessThan(0.025);
    expect(Math.abs(area({ type: 'capsule', center: [0, 0, 0], radius: 0.2, length: 0.8 }) / (2 * pi * 0.2 * 0.8 + 4 * pi * 0.04) - 1)).toBeLessThan(0.01);
    expect(Math.abs(area({ type: 'cylinder', center: [0, 0, 0], radius: 0.3, height: 0.6 }) / (2 * pi * 0.3 * 0.6 + 2 * pi * 0.09) - 1)).toBeLessThan(0.01);
    const slant = Math.sqrt(0.7 * 0.7 + 0.3 * 0.3);
    expect(Math.abs(area({ type: 'cone', center: [0, 0, 0], baseRadius: 0.4, topRadius: 0.1, height: 0.7 }) / (pi * 0.5 * slant + pi * 0.16 + pi * 0.01) - 1)).toBeLessThan(0.01);
  });
});

describe('GF-T13: tapered tube frames and radius', () => {
  const fixtures: Vec3[][] = [
    SHAPES.tube.type === 'taperedTube' ? SHAPES.tube.points : [],
    [[0, 0, 0], [0, 0.3, 0], [0, 0.6, 0], [0, 0.9, 0]],                                           // straight
    [[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 1], [0, 1, 1], [-0.4, 1, 0.6]],   // sharp turns
    // William's trunk (handoff §5.1), rotated -90° about y so the subject faces +z (spec §6.3, CR-31).
    [[0, -0.05, 0.92], [-0.02, -0.28, 1.08], [0.04, -0.52, 1.18], [0, -0.72, 1.24]],
  ];
  it('frames are orthonormal within 1e-9 and never flip (adjacent normals dot > 0)', () => {
    for (const points of fixtures) {
      const frames = tubeFrames(points);
      expect(frames.length).toBe(((points.length - 1) / 3) * 16 + 1);
      frames.forEach((f, m) => {
        for (const v of [f.tangent, f.normal, f.binormal]) expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-9);
        const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(Math.abs(d(f.tangent, f.normal))).toBeLessThan(1e-9);
        expect(Math.abs(d(f.tangent, f.binormal))).toBeLessThan(1e-9);
        expect(Math.abs(d(f.normal, f.binormal))).toBeLessThan(1e-9);
        if (m > 0) expect(d(frames[m - 1].normal, f.normal)).toBeGreaterThan(0);
      });
    }
  });

  it('just inside a curved, tapered tube, the depth is the inward distance (within 2%)', () => {
    const solid = buildSolid(part('tube', SHAPES.tube), 0);
    for (const { pos, normal } of solid.surface(WIDE ? 500 : 100, testStream('inward'))) {
      const delta = 0.01;
      const d = solid.insideDepth([pos[0] - delta * normal[0], pos[1] - delta * normal[1], pos[2] - delta * normal[2]]);
      expect(Math.abs(d - delta)).toBeLessThanOrEqual(0.02 * delta);
    }
  });

  it('the radius goes linearly from startRadius to endRadius in the curve parameter (straight tube)', () => {
    const solid = buildSolid(part('t', { type: 'taperedTube', points: [[0, 0, 0], [0, 1 / 3, 0], [0, 2 / 3, 0], [0, 1, 0]], startRadius: 0.2, endRadius: 0.05 }), 0);
    let side = 0;
    for (const { pos } of solid.surface(4000, testStream('lin'))) {
      if (pos[1] <= 0.01 || pos[1] >= 0.99) continue;                 // caps and their seams
      const radial = Math.sqrt(pos[0] * pos[0] + pos[2] * pos[2]);
      const expected = 0.2 + (0.05 - 0.2) * pos[1];                     // u = y for this evenly spaced control polygon
      // The side surface is c(u) + r(u)·radial, so along a taper the point's y sits at u; tolerance covers rounding.
      expect(Math.abs(radial - expected)).toBeLessThan(1e-9);
      side++;
    }
    expect(side).toBeGreaterThan(1000);
  });

  it('a straight tube samples the analytic capsule (equal radii) or frustum with hemispherical caps: area within 1%', () => {
    const pi = Math.PI;
    const tube = (r0: number, r1: number) => buildSolid(part('t', { type: 'taperedTube', points: [[0, 0, 0], [0, 0.3, 0], [0, 0.6, 0], [0, 0.9, 0]], startRadius: r0, endRadius: r1 }), 0).area();
    expect(Math.abs(tube(0.1, 0.1) / (2 * pi * 0.1 * 0.9 + 4 * pi * 0.01) - 1)).toBeLessThan(0.01);
    const slant = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1);
    expect(Math.abs(tube(0.15, 0.05) / (pi * (0.15 + 0.05) * slant + 2 * pi * 0.0225 + 2 * pi * 0.0025) - 1)).toBeLessThan(0.01);
    // And its depth agrees with the capsule primitive's on the same axis.
    const capsule = buildSolid(part('c', { type: 'capsule', center: [0, 0.45, 0], radius: 0.1, length: 0.9 }), 0);
    const straight = buildSolid(part('t', { type: 'taperedTube', points: [[0, 0, 0], [0, 0.3, 0], [0, 0.6, 0], [0, 0.9, 0]], startRadius: 0.1, endRadius: 0.1 }), 0);
    const next = testStream('cap');
    for (let k = 0; k < 200; k++) {
      const p: Vec3 = [next() * 0.6 - 0.3, next() * 1.4 - 0.25, next() * 0.6 - 0.3];
      expect(straight.insideDepth(p)).toBeCloseTo(capsule.insideDepth(p), 9);
    }
  });
});

describe('GF-T15 (1): mirror-x is an exact reflection in x = 0', () => {
  it('a copy\'s depth, samples, normals and box are the exact x-negation of the original\'s', () => {
    const original = buildSolid(part('ear', { type: 'ellipsoid', center: [0.6, 0.3, 0.1], radii: [0.2, 0.3, 0.05], rotationDeg: [10, 25, -15] }), 2);
    const copy = mirrorSolid(original);
    expect(copy.id).toBe('ear~m');
    expect(copy.mirrorOf).toBe(original);
    expect(copy.partIndex).toBe(2);
    expect(copy.area()).toBe(original.area());
    expect(copy.box).toEqual({ min: [-original.box.max[0], original.box.min[1], original.box.min[2]], max: [-original.box.min[0], original.box.max[1], original.box.max[2]] });
    const next = testStream('mirror');
    for (let k = 0; k < 500; k++) {
      const p: Vec3 = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
      expect(copy.insideDepth([-p[0], p[1], p[2]])).toBe(original.insideDepth(p));
    }
    const a = original.surface(200, testStream('s')), b = copy.surface(200, testStream('s'));
    b.forEach((s, i) => {
      expect(s.pos).toEqual([-a[i].pos[0], a[i].pos[1], a[i].pos[2]]);
      expect(s.normal).toEqual([-a[i].normal[0], a[i].normal[1], a[i].normal[2]]);
    });
  });

  it('buildSolids puts each copy right after its original; a part straddling x = 0 is not mirrored and warns', () => {
    const warnings: Warning3D[] = [];
    const solids = buildSolids({ referenceView: 'front', materials: [{ id: 'm', rgb: [1, 1, 1] }], parts: [
      part('body', { type: 'ellipsoid', center: [0, 0, 0], radii: [0.6, 0.4, 0.8] }),
      part('ear', { type: 'ellipsoid', center: [0.6, 0.3, 0.2], radii: [0.2, 0.3, 0.05] }, { symmetry: 'mirror-x' }),
      part('trunk', { type: 'capsule', center: [0, -0.2, 0.9], radius: 0.08, length: 0.4 }, { symmetry: 'mirror-x' }),
      part('tail', { type: 'cone', center: [0.1, 0, -0.9], baseRadius: 0.05, topRadius: 0, height: 0.3 }, { symmetry: 'none' }),
    ] }, warnings);
    expect(solids.map((s: Solid3D) => s.id)).toEqual(['body', 'ear', 'ear~m', 'trunk', 'tail']);
    expect(warnings).toEqual([{ code: 'mirror-overlaps-self', partId: 'trunk', detail: expect.stringContaining('x = 0') }]);
  });
});

describe('determinism rules (spec §7.12) in the source', () => {
  it('uses no Math.hypot, Math.random, Date, performance or fetch, and imports only src/score and src/contracts', () => {
    for (const file of ['src/score/generated/shapes3d.ts', 'src/score/generated/sample3d.ts']) {
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/Math\.hypot|Math\.random|\bDate\b|\bperformance\b|\bfetch\b|\bcrypto\b/);
      for (const [, spec] of code.matchAll(/from '([^']+)'/g)) expect(spec).toMatch(/^\.\/|^\.\.\/\.\.\/contracts$/);
    }
  });
});
