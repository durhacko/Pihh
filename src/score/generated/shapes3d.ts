// src/score/generated/shapes3d.ts
// GF-WP-05 (#211): the 3D primitives of a generated scene (canonical spec docs/integrations/gemini-generated-formations.md
// §6.3, §7.3 steps 1-3): ellipsoid, capsule, cylinder, cone (capped frustum) and tapered tube, with explicit transforms
// and mirror-x. Each solid gives a signed analytic depth (> 0 inside), a fixed-resolution triangle mesh that drives
// area weighting only, and samples projected back onto the ANALYTIC surface with analytic normals.
// Pure and deterministic (spec §7.12): imports only ./types (the generated folder imports only itself, #203); no
// Math.random, Date, performance or DOM; arithmetic and Math.sqrt as they are, every other Math.* result snapped to
// 1e-9, and no Math.hypot. Randomness is injected as `next: () => number` in [0, 1) (GF-WP-02's seeded stream).
import type { Geometry3D, Material3D, Part3D, SceneSpec3D, SceneView, Vec3 } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Input types: the ONE adapter point to GF-WP-01's scene types (#203, src/score/generated/types.ts). The stages read
// only these fields, so a validated SceneSpec3D (validateScene, V1-V10 passed) is accepted as it is.
// ---------------------------------------------------------------------------------------------------------------
export type Geometry3DInput = Geometry3D;
export type Part3DInput = Part3D;
export type Material3DInput = Material3D;
export type ReferenceView = SceneView;
export type Scene3DInput = Pick<SceneSpec3D, 'referenceView' | 'materials' | 'parts'>;

// ---------------------------------------------------------------------------------------------------------------
// Compiler constants (versioned by COMPILER_VERSION, spec §7.1; never Params fields).
// ---------------------------------------------------------------------------------------------------------------
/** Spec §7.3 step 1: ellipsoids 32 around x 16 rings; tubes 24 around x 16 per segment; capsules, cylinders, cones 32 around. */
export const MESH = Object.freeze({
  ellipsoidAround: 32, ellipsoidRings: 16,
  tubeAround: 24, tubePerSegment: 16, tubeCapRings: 6,
  around: 32,
  capsuleCapRings: 8,      // rings per hemisphere (not fixed by the spec; a compiler constant)
  coneBands: 16,           // bands along a cone's side: its radius varies, so one band would skew area weighting
  cylinderBands: 1,        // constant radius: one band is exact for area weighting
});
/** Centreline samples per Bézier segment for the tube depth test (distance to the centreline). */
export const TUBE_DEPTH_PER_SEGMENT = 32;
/** Golden-section refinements of the closest centreline point after the polyline search (fixed: deterministic). */
const TUBE_REFINE_STEPS = 60;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
/** Eberly's point-ellipsoid distance: fixed bisection budget (deterministic). */
const ELLIPSOID_ITERATIONS = 160;

export const snap = (v: number): number => Math.round(v * 1e9) / 1e9;
const TAU = 2 * Math.PI;

export interface SurfaceSample { pos: Vec3; normal: Vec3 }
export interface Box3 { min: Vec3; max: Vec3 }

export interface Solid3D {
  /** Part id; a mirror-x copy is `<id>~m`. */
  readonly id: string;
  readonly materialId: string;
  readonly importance: number;
  /** Index of the scene part this solid comes from (a copy shares its original's). */
  readonly partIndex: number;
  /** For a mirror-x copy: its original solid; otherwise null. A copy is never sampled itself (spec §7.3 step 2). */
  readonly mirrorOf: Solid3D | null;
  /** Signed analytic depth in scene units: > 0 inside, 0 on the surface, < 0 outside (spec §7.3 step 3). */
  insideDepth(p: Vec3): number;
  /** `count` area-weighted samples on the analytic surface, with analytic unit normals (spec §7.3 steps 1-2). */
  surface(count: number, next: () => number): SurfaceSample[];
  /** Surface area of the fixed-resolution mesh that drives the area weighting. */
  area(): number;
  /** Conservative axis-aligned box of the analytic solid, in scene units. */
  readonly box: Box3;
}

export interface Warning3D { code: string; partId?: string; detail: string }

// ---------------------------------------------------------------------------------------------------------------
// Small vector helpers (no allocation-free tricks needed: compile-time code, not per tick).
// ---------------------------------------------------------------------------------------------------------------
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
export function normalise(a: Vec3): Vec3 { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; }
const mirror = (a: Vec3): Vec3 => [-a[0], a[1], a[2]];

/** Row-major 3x3. R = Rz · Ry · Rx (spec §6.1): X first, then Y, then Z, on fixed axes; degrees. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export function rotationMatrix(deg: Vec3 | undefined): Mat3 {
  const [rx, ry, rz] = (deg ?? [0, 0, 0]).map(d => (d * Math.PI) / 180);
  const cx = snap(Math.cos(rx)), sx = snap(Math.sin(rx));
  const cy = snap(Math.cos(ry)), sy = snap(Math.sin(ry));
  const cz = snap(Math.cos(rz)), sz = snap(Math.sin(rz));
  // Rz·Ry·Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const mul = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulT = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** cos/sin of 2πj/n, snapped, for j = 0..n (j = n repeats j = 0 exactly). */
function ring(n: number): { c: number[]; s: number[] } {
  const c: number[] = [], s: number[] = [];
  for (let j = 0; j <= n; j++) { const a = (TAU * (j % n)) / n; c.push(snap(Math.cos(a))); s.push(snap(Math.sin(a))); }
  return { c, s };
}

// ---------------------------------------------------------------------------------------------------------------
// Meshes: triangles in a solid's LOCAL frame, each tagged with a patch id that says how to project a point in it
// onto the analytic surface. `param` carries per-vertex patch parameters where projection needs them (tubes).
// ---------------------------------------------------------------------------------------------------------------
interface Mesh { tri: Float64Array; patch: Uint8Array; param: Float64Array; cumulative: Float64Array; total: number }
class MeshBuilder {
  private tri: number[] = []; private patch: number[] = []; private param: number[] = [];
  add(a: Vec3, b: Vec3, c: Vec3, patch: number, pa: [number, number] = [0, 0], pb: [number, number] = [0, 0], pc: [number, number] = [0, 0]): void {
    this.tri.push(...a, ...b, ...c); this.patch.push(patch); this.param.push(...pa, ...pb, ...pc);
  }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, patch: number, pa?: [number, number], pb?: [number, number], pc?: [number, number], pd?: [number, number]): void {
    // a-b-c-d around the quad; split along a-c.
    this.add(a, b, c, patch, pa, pb, pc);
    this.add(a, c, d, patch, pa, pc, pd);
  }
  build(): Mesh {
    const tri = Float64Array.from(this.tri);
    const n = this.patch.length;
    const cumulative = new Float64Array(n);
    let total = 0;
    for (let k = 0; k < n; k++) {
      const o = k * 9;
      const ab: Vec3 = [tri[o + 3] - tri[o], tri[o + 4] - tri[o + 1], tri[o + 5] - tri[o + 2]];
      const ac: Vec3 = [tri[o + 6] - tri[o], tri[o + 7] - tri[o + 1], tri[o + 8] - tri[o + 2]];
      total += len(cross(ab, ac)) / 2;
      cumulative[k] = total;
    }
    return { tri, patch: Uint8Array.from(this.patch), param: Float64Array.from(this.param), cumulative, total };
  }
}

/** Stratified, seeded, area-weighted: triangle by cumulative area, then the √u barycentric point (spec §7.3 step 2). */
function sampleMesh(mesh: Mesh, count: number, next: () => number, project: (local: Vec3, patch: number, param: [number, number]) => SurfaceSample): SurfaceSample[] {
  const out: SurfaceSample[] = [];
  if (count <= 0 || mesh.total <= 0) return out;
  const n = mesh.patch.length;
  for (let i = 0; i < count; i++) {
    const target = ((i + next()) / count) * mesh.total;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (mesh.cumulative[mid] < target) lo = mid + 1; else hi = mid; }
    const k = lo, o = k * 9, q = k * 6;
    const s = Math.sqrt(next()), r2 = next();
    const wa = 1 - s, wb = s * (1 - r2), wc = s * r2;
    const t = mesh.tri;
    const local: Vec3 = [wa * t[o] + wb * t[o + 3] + wc * t[o + 6], wa * t[o + 1] + wb * t[o + 4] + wc * t[o + 7], wa * t[o + 2] + wb * t[o + 5] + wc * t[o + 8]];
    const p = mesh.param;
    const param: [number, number] = [wa * p[q] + wb * p[q + 2] + wc * p[q + 4], wa * p[q + 1] + wb * p[q + 3] + wc * p[q + 5]];
    out.push(project(local, mesh.patch[k], param));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Signed distances (exact for ellipsoid, capsule, cylinder and cone; arithmetic and sqrt only).
// ---------------------------------------------------------------------------------------------------------------
/** Root of Σ (r_i z_i / (g + r_i))² = 1 for g > -r_min, by bisection (Eberly, "Distance from a point to an ellipse, an
 *  ellipsoid, or a hyperellipsoid"). Inputs sorted e0 >= e1 >= e2 > 0 and y_i >= 0. */
function ellipsoidDistanceSorted(e: Vec3, y: Vec3): number {
  const [e0, e1, e2] = e, [y0, y1, y2] = y;
  if (y2 > 0) {
    if (y1 > 0) {
      if (y0 > 0) {
        const z0 = y0 / e0, z1 = y1 / e1, z2 = y2 / e2;
        const g = z0 * z0 + z1 * z1 + z2 * z2 - 1;
        if (g !== 0) {
          const r0 = (e0 / e2) * (e0 / e2), r1 = (e1 / e2) * (e1 / e2);
          const sbar = rootOf3(r0, r1, z0, z1, z2, g);
          const x0 = (r0 * y0) / (sbar + r0), x1 = (r1 * y1) / (sbar + r1), x2 = y2 / (sbar + 1);
          const d = Math.sqrt((x0 - y0) ** 2 + (x1 - y1) ** 2 + (x2 - y2) ** 2);
          return g < 0 ? -d : d;
        }
        return 0;
      }
      return ellipseDistance2(e1, e2, y1, y2);       // y0 = 0: the nearest point has x0 = 0
    }
    if (y0 > 0) return ellipseDistance2(e0, e2, y0, y2);
    return y2 - e2;                                   // on the e2 axis
  }
  // y2 = 0: in the e0-e1 plane
  const denom0 = e0 * e0 - e2 * e2, denom1 = e1 * e1 - e2 * e2;
  const n0 = e0 * y0, n1 = e1 * y1;
  if (n0 < denom0 && n1 < denom1) {
    const xd0 = n0 / denom0, xd1 = n1 / denom1;
    const xde0 = xd0 * xd0, xde1 = xd1 * xd1;
    const discr = 1 - xde0 - xde1;
    if (discr > 0) {
      // The nearest surface point is off the plane: interior point near the e2 axis.
      const x0 = e0 * xd0, x1 = e1 * xd1, x2 = e2 * Math.sqrt(discr);
      const d = Math.sqrt((x0 - y0) ** 2 + (x1 - y1) ** 2 + x2 * x2);
      return -d;
    }
  }
  return ellipseDistance2(e0, e1, y0, y1);
}
/** Distance to the ellipse with semi-axes a >= b in a plane, signed for the ellipsoid (inside negative). */
function ellipseDistance2(a: number, b: number, y0: number, y1: number): number {
  if (a < b) return ellipseDistance2(b, a, y1, y0);
  if (y1 > 0) {
    if (y0 > 0) {
      const z0 = y0 / a, z1 = y1 / b;
      const g = z0 * z0 + z1 * z1 - 1;
      if (g !== 0) {
        const r0 = (a / b) * (a / b);
        const sbar = rootOf2(r0, z0, z1, g);
        const x0 = (r0 * y0) / (sbar + r0), x1 = y1 / (sbar + 1);
        const d = Math.sqrt((x0 - y0) ** 2 + (x1 - y1) ** 2);
        return g < 0 ? -d : d;
      }
      return 0;
    }
    return y1 - b;
  }
  const numer0 = a * y0, denom0 = a * a - b * b;
  if (numer0 < denom0) {
    const xd0 = numer0 / denom0;
    const x0 = a * xd0, x1 = b * Math.sqrt(Math.max(0, 1 - xd0 * xd0));
    return -Math.sqrt((x0 - y0) ** 2 + x1 * x1);
  }
  return y0 - a;
}
function rootOf2(r0: number, z0: number, z1: number, g: number): number {
  const n0 = r0 * z0;
  let s0 = z1 - 1, s1 = g < 0 ? 0 : Math.sqrt(n0 * n0 + z1 * z1) - 1, s = 0;
  for (let i = 0; i < ELLIPSOID_ITERATIONS; i++) {
    s = (s0 + s1) / 2;
    if (s === s0 || s === s1) break;
    const ratio0 = n0 / (s + r0), ratio1 = z1 / (s + 1);
    const v = ratio0 * ratio0 + ratio1 * ratio1 - 1;
    if (v > 0) s0 = s; else if (v < 0) s1 = s; else break;
  }
  return s;
}
function rootOf3(r0: number, r1: number, z0: number, z1: number, z2: number, g: number): number {
  const n0 = r0 * z0, n1 = r1 * z1;
  let s0 = z2 - 1, s1 = g < 0 ? 0 : Math.sqrt(n0 * n0 + n1 * n1 + z2 * z2) - 1, s = 0;
  for (let i = 0; i < ELLIPSOID_ITERATIONS; i++) {
    s = (s0 + s1) / 2;
    if (s === s0 || s === s1) break;
    const ratio0 = n0 / (s + r0), ratio1 = n1 / (s + r1), ratio2 = z2 / (s + 1);
    const v = ratio0 * ratio0 + ratio1 * ratio1 + ratio2 * ratio2 - 1;
    if (v > 0) s0 = s; else if (v < 0) s1 = s; else break;
  }
  return s;
}
/** Signed distance (inside negative) from local point q to the ellipsoid with radii r. */
export function ellipsoidSignedDistance(r: Vec3, q: Vec3): number {
  const order = [0, 1, 2].sort((i, j) => r[j] - r[i] || i - j);
  const e: Vec3 = [r[order[0]], r[order[1]], r[order[2]]];
  const y: Vec3 = [Math.abs(q[order[0]]), Math.abs(q[order[1]]), Math.abs(q[order[2]])];
  return ellipsoidDistanceSorted(e, y);
}

/** Capped cone (frustum) of half-height h, bottom radius r1 at y = -h, top radius r2 at y = +h (Quílez's exact SDF). */
function cappedConeSignedDistance(q: Vec3, h: number, r1: number, r2: number): number {
  const qx = Math.sqrt(q[0] * q[0] + q[2] * q[2]), qy = q[1];
  const k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
  const k2d = k2x * k2x + k2y * k2y;
  const t = Math.max(0, Math.min(1, ((k1x - qx) * k2x + (k1y - qy) * k2y) / k2d));
  const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

// ---------------------------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------------------------
interface SolidCore {
  depthLocal(q: Vec3): number;
  mesh: Mesh;
  project(local: Vec3, patch: number, param: [number, number]): SurfaceSample;   // local position + local normal
  boxLocalToScene(rot: Mat3, centre: Vec3): Box3;
}

function boxOfPoints(points: Vec3[], pad: number[]): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  points.forEach((p, i) => { for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a] - pad[i]); max[a] = Math.max(max[a], p[a] + pad[i]); } });
  return { min, max };
}
/** Box of a disc of radius r centred at c with unit normal n: half-extent r·√(1 − n_a²) along axis a. */
function discBox(c: Vec3, n: Vec3, r: number): Box3 {
  const h = [0, 1, 2].map(a => r * Math.sqrt(Math.max(0, 1 - n[a] * n[a])));
  return { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] };
}
const unionBox = (a: Box3, b: Box3): Box3 => ({
  min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
  max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
});

function ellipsoidCore(radii: Vec3): SolidCore {
  const [a, b, c] = radii;
  const mb = new MeshBuilder();
  const around = ring(MESH.ellipsoidAround);
  const rings = MESH.ellipsoidRings;
  const vertex = (i: number, j: number): Vec3 => {   // i: 0 (south pole, y = -b) .. rings (north pole)
    const phi = Math.PI * (i / rings) - Math.PI / 2;
    const cp = snap(Math.cos(phi)), sp = snap(Math.sin(phi));
    return [a * cp * around.c[j], b * sp, c * cp * around.s[j]];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < MESH.ellipsoidAround; j++) {
    const v00 = vertex(i, j), v01 = vertex(i, j + 1), v11 = vertex(i + 1, j + 1), v10 = vertex(i + 1, j);
    if (i === 0) mb.add(v00, v11, v10, 0);                 // south cap: v00 = v01 = pole
    else if (i === rings - 1) mb.add(v00, v01, v10, 0);    // north cap: v10 = v11 = pole
    else mb.quad(v00, v01, v11, v10, 0);
  }
  return {
    depthLocal: q => -ellipsoidSignedDistance(radii, q),
    mesh: mb.build(),
    project(local) {
      // The unit-sphere point is normalised before the radii scale it (spec §7.3 step 1).
      const u = normalise([local[0] / a, local[1] / b, local[2] / c]);
      const pos: Vec3 = [a * u[0], b * u[1], c * u[2]];
      return { pos, normal: normalise([pos[0] / (a * a), pos[1] / (b * b), pos[2] / (c * c)]) };
    },
    boxLocalToScene(rot, centre) {
      // Exact box of a rotated ellipsoid: half-extent_i = sqrt(Σ_j (R_ij r_j)²).
      const h = [0, 1, 2].map(i => Math.sqrt((rot[i * 3] * a) ** 2 + (rot[i * 3 + 1] * b) ** 2 + (rot[i * 3 + 2] * c) ** 2));
      return { min: [centre[0] - h[0], centre[1] - h[1], centre[2] - h[2]], max: [centre[0] + h[0], centre[1] + h[1], centre[2] + h[2]] };
    },
  };
}

const PATCH_SIDE = 0, PATCH_CAP_LOW = 1, PATCH_CAP_HIGH = 2, PATCH_FLAT = 3;

function capsuleCore(r: number, length: number): SolidCore {
  const h = length / 2;
  const mb = new MeshBuilder();
  const around = ring(MESH.around), n = MESH.around, capRings = MESH.capsuleCapRings;
  for (let j = 0; j < n; j++) {
    mb.quad([r * around.c[j], -h, r * around.s[j]], [r * around.c[j + 1], -h, r * around.s[j + 1]], [r * around.c[j + 1], h, r * around.s[j + 1]], [r * around.c[j], h, r * around.s[j]], PATCH_SIDE);
  }
  const capVertex = (sign: number, i: number, j: number): Vec3 => {   // i: 0 equator .. capRings pole
    const phi = (Math.PI / 2) * (i / capRings);
    const cp = snap(Math.cos(phi)), sp = snap(Math.sin(phi));
    return [r * cp * around.c[j], sign * (h + r * sp), r * cp * around.s[j]];
  };
  for (const [sign, patch] of [[1, PATCH_CAP_HIGH], [-1, PATCH_CAP_LOW]] as const) {
    for (let i = 0; i < capRings; i++) for (let j = 0; j < n; j++) {
      const a0 = capVertex(sign, i, j), a1 = capVertex(sign, i, j + 1), b1 = capVertex(sign, i + 1, j + 1), b0 = capVertex(sign, i + 1, j);
      if (i === capRings - 1) mb.add(a0, a1, b0, patch); else mb.quad(a0, a1, b1, b0, patch);
    }
  }
  return {
    depthLocal(q) { const y = Math.max(-h, Math.min(h, q[1])); return r - Math.sqrt(q[0] * q[0] + (q[1] - y) ** 2 + q[2] * q[2]); },
    mesh: mb.build(),
    project(local, patch) {
      if (patch === PATCH_SIDE) {
        const radial = normalise([local[0], 0, local[2]]);
        return { pos: [r * radial[0], Math.max(-h, Math.min(h, local[1])), r * radial[2]], normal: radial };
      }
      const centre: Vec3 = [0, patch === PATCH_CAP_HIGH ? h : -h, 0];
      const d = normalise(sub(local, centre));
      return { pos: add(centre, scale(d, r)), normal: d };
    },
    boxLocalToScene(rot, centre) {
      const axis = mul(rot, [0, 1, 0]);
      const top = add(centre, scale(axis, h)), bottom = sub(centre, scale(axis, h));
      return boxOfPoints([top, bottom], [r, r]);
    },
  };
}

/** Capped frustum: bottom radius rb at y = -hh, top radius rt at y = +hh (cylinder: rb = rt). */
function frustumCore(rb: number, rt: number, height: number, bands: number): SolidCore {
  const hh = height / 2;
  const mb = new MeshBuilder();
  const around = ring(MESH.around), n = MESH.around;
  const radiusAt = (y: number) => rb + ((rt - rb) * (y + hh)) / height;
  for (let k = 0; k < bands; k++) {
    const y0 = -hh + (height * k) / bands, y1 = -hh + (height * (k + 1)) / bands;
    const r0 = radiusAt(y0), r1 = radiusAt(y1);
    for (let j = 0; j < n; j++) {
      const a0: Vec3 = [r0 * around.c[j], y0, r0 * around.s[j]], a1: Vec3 = [r0 * around.c[j + 1], y0, r0 * around.s[j + 1]];
      const b1: Vec3 = [r1 * around.c[j + 1], y1, r1 * around.s[j + 1]], b0: Vec3 = [r1 * around.c[j], y1, r1 * around.s[j]];
      if (r1 === 0) mb.add(a0, a1, b0, PATCH_SIDE);
      else if (r0 === 0) mb.add(a0, b1, b0, PATCH_SIDE);
      else mb.quad(a0, a1, b1, b0, PATCH_SIDE);
    }
  }
  for (const [y, r, up] of [[-hh, rb, false], [hh, rt, true]] as const) {
    if (r <= 0) continue;
    for (let j = 0; j < n; j++) {
      const c: Vec3 = [0, y, 0], p0: Vec3 = [r * around.c[j], y, r * around.s[j]], p1: Vec3 = [r * around.c[j + 1], y, r * around.s[j + 1]];
      if (up) mb.add(c, p1, p0, PATCH_FLAT); else mb.add(c, p0, p1, PATCH_FLAT);
    }
  }
  // Side normal of a frustum: radial tilted by the slope; (rb - rt)/height up for a cone narrowing upwards.
  const slope = (rb - rt) / height;
  return {
    depthLocal: q => -cappedConeSignedDistance(q, hh, rb, rt),
    mesh: mb.build(),
    project(local, patch) {
      if (patch === PATCH_FLAT) return { pos: [local[0], local[1], local[2]], normal: [0, local[1] > 0 ? 1 : -1, 0] };   // flat caps are exact
      const y = Math.max(-hh, Math.min(hh, local[1]));
      const radial = normalise([local[0], 0, local[2]]);
      const r = radiusAt(y);
      return { pos: [r * radial[0], y, r * radial[2]], normal: normalise([radial[0], slope, radial[2]]) };
    },
    boxLocalToScene(rot, centre) {
      const axis = mul(rot, [0, 1, 0]);
      return unionBox(discBox(sub(centre, scale(axis, hh)), axis, rb), discBox(add(centre, scale(axis, hh)), axis, rt));
    },
  };
}

// ---- Tapered tube (spec §6.3): cubic Bézier chain centreline, radius linear in the curve parameter, hemispherical caps.
function bezier(p: Vec3[], seg: number, t: number): Vec3 {
  const [a, b, c, d] = [p[3 * seg], p[3 * seg + 1], p[3 * seg + 2], p[3 * seg + 3]];
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1], w0 * a[2] + w1 * b[2] + w2 * c[2] + w3 * d[2]];
}
function bezierDerivative(p: Vec3[], seg: number, t: number): Vec3 {
  const [a, b, c, d] = [p[3 * seg], p[3 * seg + 1], p[3 * seg + 2], p[3 * seg + 3]];
  const u = 1 - t, w0 = 3 * u * u, w1 = 6 * u * t, w2 = 3 * t * t;
  return [w0 * (b[0] - a[0]) + w1 * (c[0] - b[0]) + w2 * (d[0] - c[0]), w0 * (b[1] - a[1]) + w1 * (c[1] - b[1]) + w2 * (d[1] - c[1]), w0 * (b[2] - a[2]) + w1 * (c[2] - b[2]) + w2 * (d[2] - c[2])];
}
/** Global curve parameter u in [0, 1] → (segment, t). */
function locate(segments: number, u: number): [number, number] {
  const x = Math.max(0, Math.min(1, u)) * segments;
  const seg = Math.min(segments - 1, Math.floor(x));
  return [seg, x - seg];
}
export interface TubeFrame { u: number; pos: Vec3; tangent: Vec3; normal: Vec3; binormal: Vec3 }

/** Rotation-minimising frames by double reflection (Wang et al. 2008) at `perSegment` steps per segment. */
export function tubeFrames(points: Vec3[], perSegment = MESH.tubePerSegment): TubeFrame[] {
  const segments = (points.length - 1) / 3;
  const steps = segments * perSegment;
  const frames: TubeFrame[] = [];
  let prevTangent: Vec3 = [0, 1, 0];
  for (let m = 0; m <= steps; m++) {
    const u = m / steps;
    const [seg, t] = locate(segments, u);
    const pos = bezier(points, seg, t);
    let tangent = normalise(bezierDerivative(points, seg, t));
    if (len(tangent) === 0) tangent = m === 0 ? normalise(sub(points[points.length - 1], points[0])) : prevTangent;
    if (len(tangent) === 0) tangent = [0, 1, 0];
    let normal: Vec3;
    if (m === 0) {
      // Initial normal: the world axis least aligned with the tangent (ties to the lower axis), made orthogonal.
      const absT = tangent.map(Math.abs);
      const axis = absT[0] <= absT[1] && absT[0] <= absT[2] ? 0 : absT[1] <= absT[2] ? 1 : 2;
      const e: Vec3 = [0, 0, 0]; e[axis] = 1;
      normal = normalise(sub(e, scale(tangent, dot(e, tangent))));
    } else {
      const prev = frames[m - 1];
      const v1 = sub(pos, prev.pos);
      const c1 = dot(v1, v1);
      let rL = prev.normal, tL = prev.tangent;
      if (c1 > 0) { rL = sub(prev.normal, scale(v1, (2 / c1) * dot(v1, prev.normal))); tL = sub(prev.tangent, scale(v1, (2 / c1) * dot(v1, prev.tangent))); }
      const v2 = sub(tangent, tL);
      const c2 = dot(v2, v2);
      normal = c2 > 0 ? sub(rL, scale(v2, (2 / c2) * dot(v2, rL))) : rL;
      normal = normalise(sub(normal, scale(tangent, dot(normal, tangent))));   // re-orthonormalise (rounding only)
    }
    const binormal = normalise(cross(tangent, normal));
    normal = cross(binormal, tangent);
    frames.push({ u, pos, tangent, normal, binormal });
    prevTangent = tangent;
  }
  return frames;
}

function tubeCore(points: Vec3[], r0: number, r1: number): SolidCore {
  const segments = (points.length - 1) / 3;
  const radiusAt = (u: number) => r0 + (r1 - r0) * u;
  const frames = tubeFrames(points, MESH.tubePerSegment);
  const steps = frames.length - 1;
  const around = ring(MESH.tubeAround), n = MESH.tubeAround;
  const mb = new MeshBuilder();
  const sidePoint = (m: number, j: number): Vec3 => {
    const f = frames[m], r = radiusAt(f.u);
    return add(f.pos, add(scale(f.normal, r * around.c[j]), scale(f.binormal, r * around.s[j])));
  };
  for (let m = 0; m < steps; m++) for (let j = 0; j < n; j++) {
    const pu0 = frames[m].u, pu1 = frames[m + 1].u, pt0 = j / n, pt1 = (j + 1) / n;
    mb.quad(sidePoint(m, j), sidePoint(m, j + 1), sidePoint(m + 1, j + 1), sidePoint(m + 1, j), PATCH_SIDE, [pu0, pt0], [pu0, pt1], [pu1, pt1], [pu1, pt0]);
  }
  const capRings = MESH.tubeCapRings;
  const caps: { patch: number; f: TubeFrame; r: number; out: Vec3 }[] = [
    { patch: PATCH_CAP_LOW, f: frames[0], r: r0, out: scale(frames[0].tangent, -1) },
    { patch: PATCH_CAP_HIGH, f: frames[steps], r: r1, out: frames[steps].tangent },
  ];
  for (const cap of caps) {
    const vertex = (i: number, j: number): Vec3 => {
      const phi = (Math.PI / 2) * (i / capRings), cp = snap(Math.cos(phi)), sp = snap(Math.sin(phi));
      return add(cap.f.pos, add(scale(cap.out, cap.r * sp), add(scale(cap.f.normal, cap.r * cp * around.c[j]), scale(cap.f.binormal, cap.r * cp * around.s[j]))));
    };
    for (let i = 0; i < capRings; i++) for (let j = 0; j < n; j++) {
      const a0 = vertex(i, j), a1 = vertex(i, j + 1), b1 = vertex(i + 1, j + 1), b0 = vertex(i + 1, j);
      if (i === capRings - 1) mb.add(a0, a1, b0, cap.patch); else mb.quad(a0, a1, b1, b0, cap.patch);
    }
  }
  // Depth polyline (finer than the mesh): distance to the centreline below the local radius (spec §7.3 step 3).
  const depthSteps = segments * TUBE_DEPTH_PER_SEGMENT;
  const line: Vec3[] = [];
  for (let m = 0; m <= depthSteps; m++) { const [seg, t] = locate(segments, m / depthSteps); line.push(bezier(points, seg, t)); }
  const frameAt = (u: number): { pos: Vec3; tangent: Vec3; normal: Vec3; binormal: Vec3; speed: number } => {
    const [seg, t] = locate(segments, u);
    const pos = bezier(points, seg, t);
    const d = bezierDerivative(points, seg, t);
    const speed = len(d) * segments;                  // |dc/du|
    const x = Math.max(0, Math.min(1, u)) * steps;
    const m = Math.min(steps - 1, Math.floor(x)), w = x - m;
    let tangent = normalise(d);
    if (len(tangent) === 0) tangent = frames[m].tangent;
    const blend = add(scale(frames[m].normal, 1 - w), scale(frames[m + 1].normal, w));
    const normal = normalise(sub(blend, scale(tangent, dot(blend, tangent))));
    return { pos, tangent, normal, binormal: cross(tangent, normal), speed };
  };
  return {
    depthLocal(q) {
      // Closest centreline point: coarse search over the polyline, then a golden-section search of |c(u) − q|² on the
      // exact curve over the two polyline steps either side (unimodal there for a V6-valid tube). Fixed iterations.
      let best = Infinity, bestM = 0;
      for (let m = 0; m < depthSteps; m++) {
        const a = line[m], ab = sub(line[m + 1], a), l2 = dot(ab, ab);
        const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
        const c = add(a, scale(ab, t)), d = sub(q, c), d2 = dot(d, d);
        if (d2 < best) { best = d2; bestM = m; }
      }
      const at = (u: number) => { const [seg, t] = locate(segments, u); const d = sub(bezier(points, seg, t), q); return dot(d, d); };
      let lo = Math.max(0, (bestM - 1) / depthSteps), hi = Math.min(1, (bestM + 2) / depthSteps);
      let x1 = hi - GOLDEN * (hi - lo), x2 = lo + GOLDEN * (hi - lo), f1 = at(x1), f2 = at(x2);
      for (let k = 0; k < TUBE_REFINE_STEPS; k++) {
        if (f1 <= f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - GOLDEN * (hi - lo); f1 = at(x1); }
        else { lo = x1; x1 = x2; f1 = f2; x2 = lo + GOLDEN * (hi - lo); f2 = at(x2); }
      }
      // The window's ends are candidates too (the closest point may be an end cap's centre).
      let u = (lo + hi) / 2, d2 = at(u);
      for (const end of [Math.max(0, (bestM - 1) / depthSteps), Math.min(1, (bestM + 2) / depthSteps)]) { const e = at(end); if (e < d2) { d2 = e; u = end; } }
      return radiusAt(u) - Math.sqrt(d2);
    },
    mesh: mb.build(),
    project(local, patch, param) {
      if (patch === PATCH_SIDE) {
        const [u, turn] = param;
        const f = frameAt(u);
        const angle = TAU * turn, c = snap(Math.cos(angle)), s = snap(Math.sin(angle));
        const radial = add(scale(f.normal, c), scale(f.binormal, s));
        const r = radiusAt(u);
        // Analytic normal of a tube with varying radius: radial tilted against the taper, dr/ds along the tangent.
        const drds = f.speed > 0 ? (r1 - r0) / f.speed : 0;
        return { pos: add(f.pos, scale(radial, r)), normal: normalise(sub(radial, scale(f.tangent, drds))) };
      }
      const cap = patch === PATCH_CAP_LOW ? caps[0] : caps[1];
      const d = normalise(sub(local, cap.f.pos));
      return { pos: add(cap.f.pos, scale(d, cap.r)), normal: d };
    },
    boxLocalToScene() {
      return boxOfPoints(line, line.map((_, m) => radiusAt(m / depthSteps)));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly: transforms, mirror-x, buildSolids.
// ---------------------------------------------------------------------------------------------------------------
function placed(id: string, part: Part3DInput, partIndex: number, core: SolidCore, rot: Mat3, centre: Vec3): Solid3D {
  const box = core.boxLocalToScene(rot, centre);
  return {
    id, materialId: part.materialId, importance: part.importance, partIndex, mirrorOf: null, box,
    insideDepth: p => core.depthLocal(mulT(rot, sub(p, centre))),
    surface(count, next) {
      return sampleMesh(core.mesh, count, next, core.project).map(s => ({ pos: add(mul(rot, s.pos), centre), normal: normalise(mul(rot, s.normal)) }));
    },
    area: () => core.mesh.total,
  };
}

/** The exact reflection of `original` in the plane x = 0: depth, samples (positions and normals) and box are mirrored. */
export function mirrorSolid(original: Solid3D): Solid3D {
  return {
    id: `${original.id}~m`, materialId: original.materialId, importance: original.importance, partIndex: original.partIndex,
    mirrorOf: original,
    box: { min: [-original.box.max[0], original.box.min[1], original.box.min[2]], max: [-original.box.min[0], original.box.max[1], original.box.max[2]] },
    insideDepth: p => original.insideDepth(mirror(p)),
    surface: (count, next) => original.surface(count, next).map(s => ({ pos: mirror(s.pos), normal: mirror(s.normal) })),
    area: () => original.area(),
  };
}

export function buildSolid(part: Part3DInput, partIndex: number): Solid3D {
  const g = part.shape;
  switch (g.type) {
    case 'ellipsoid': return placed(part.id, part, partIndex, ellipsoidCore(g.radii), rotationMatrix(g.rotationDeg), g.center);
    case 'capsule': return placed(part.id, part, partIndex, capsuleCore(g.radius, g.length), rotationMatrix(g.rotationDeg), g.center);
    case 'cylinder': return placed(part.id, part, partIndex, frustumCore(g.radius, g.radius, g.height, MESH.cylinderBands), rotationMatrix(g.rotationDeg), g.center);
    case 'cone': return placed(part.id, part, partIndex, frustumCore(g.baseRadius, g.topRadius, g.height, MESH.coneBands), rotationMatrix(g.rotationDeg), g.center);
    case 'taperedTube': return placed(part.id, part, partIndex, tubeCore(g.points, g.startRadius, g.endRadius), rotationMatrix(undefined), [0, 0, 0]);
  }
}

/**
 * The scene's solids in part order, each mirror-x copy right after its original (spec §6.3). A part whose box straddles
 * x = 0 is not mirrored and gets `mirror-overlaps-self`. Warnings are appended to `warnings` when given.
 * Input: V3/V5/V6-valid parts (GF-WP-01); this function does not validate.
 */
export function buildSolids(scene: Scene3DInput, warnings?: Warning3D[]): Solid3D[] {
  const solids: Solid3D[] = [];
  scene.parts.forEach((part, index) => {
    const solid = buildSolid(part, index);
    solids.push(solid);
    if (part.symmetry === 'mirror-x') {
      if (solid.box.min[0] < 0 && solid.box.max[0] > 0) warnings?.push({ code: 'mirror-overlaps-self', partId: part.id, detail: `part ${part.id} straddles x = 0 and is not mirrored` });
      else solids.push(mirrorSolid(solid));
    }
  });
  return solids;
}
