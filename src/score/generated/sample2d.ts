// src/score/generated/sample2d.ts
// GF-WP-04 (#207): 2D candidates for the generated-scene compiler. Canonical spec:
// docs/integrations/gemini-generated-formations.md §7.2 steps 4–6, §7.7 and §7.8.
//
// From the region and the cleaned mask of GF-WP-03 (shapes2d.ts) this builds three candidate sources
// (William's FormationCandidate, handoff §4.4):
// - boundary: marching-squares contours of the mask (outer and holes), resampled at δ₀/4 from a fixed
//   start, with points within one cell of an original vector edge snapped onto it;
// - interior: a hexagonal lattice of about max(1,500, 4·n0) points over the filled cells, its offset
//   drawn from the injected seeded stream;
// - feature: points along the feature line of every protected part (priority >= 4): a stroke's
//   centreline, an ellipse's major axis, or the Zhang–Suen skeleton of a polygon's or path's own cells.
// It also builds `dense`, about 2,000 points of the filled region (never derived from candidates).
//
// Selection is GF-WP-06's (spec §7.4). This file only exports the inputs it needs: per-contour arc data,
// feature-line lengths, δ₀, and the heuristic constants (the 35% boundary-and-feature budget and kMin),
// which stay labelled tunable heuristics, not optima.
//
// Pure and deterministic (spec §7.12): imports only its own folder; randomness only from the injected
// `next` (the compiler passes GF-WP-02's `seededStream(sceneHash, 'interior')`; this file never imports prng.ts);
// arithmetic and Math.sqrt as they are, every other Math.* result snapped to 1e-9; no Math.hypot.
// Everything is in the normalised space of shapes2d.ts, z = 0.
import { cellCentre, filledArea, rasterise, PROTECTED_PRIORITY, type Mask2D, type Part2D, type Pt2, type Region2D } from './shapes2d';
import type { SceneSpec2D, Vec3 } from './types';

/** Linear-or-sRGB triple in 0..1, structurally the contract's RGB (src/contracts is not imported here). */
export type RGB = [number, number, number];
export type CandidateSource = 'boundary' | 'interior' | 'feature';

/** William's FormationCandidate with its class. Positions are normalised, z = 0. */
export interface Candidate2D {
  pos: Vec3;
  colour: RGB;
  /** Id of the owning part: the part whose edge a boundary point lies on, or that decides the point. */
  featureId: string;
  /** The owning part's priority (1..5). */
  importance: number;
  source: CandidateSource;
  /** Index of the owning part in `region.parts`. */
  part: number;
  /** Boundary only: index into `contours`. */
  contour?: number;
  /** Boundary only: arc length from the contour's start along its snapped candidates, normalised units. */
  arc?: number;
}

export interface Contour2D {
  /** True for the boundary of a hole (traced clockwise); outer boundaries run counter-clockwise. */
  hole: boolean;
  /** Closed length through the contour's (snapped) boundary candidates, normalised units: the L_c of
   * spec §7.4 step 3. */
  length: number;
  /** The fixed start (spec §7.4 step 3): the traced point at the smallest angle from the contour's
   * centroid, measured counter-clockwise from +x, lowest index on ties, as snapped (= the first candidate). */
  start: Pt2;
  /** This contour's boundary candidates are `candidates[first … first + count − 1]`, in arc order. */
  first: number;
  count: number;
}

export interface FeatureLine2D {
  part: number;
  featureId: string;
  /** How the line was found. */
  kind: 'centreline' | 'major-axis' | 'skeleton' | 'principal-axis';
  /** length_f of spec §7.4 step 2, normalised units (a skeleton is measured along its 8-connected links). */
  length: number;
  /** This part's feature candidates are `candidates[first … first + count − 1]`. */
  first: number;
  count: number;
}

export interface Sample2DOptions {
  n0: number;
  /** A seeded stream with values in [0, 1); the compiler (GF-WP-06) passes GF-WP-02's
   * `seededStream(sceneHash, 'interior')`. Exactly two values are drawn: the lattice offset. */
  next: () => number;
}

export interface Sample2DResult {
  /** Boundary (by contour, in arc order), then feature (by part), then interior (lattice rows). */
  candidates: Candidate2D[];
  /** About DENSE_TARGET points of the filled region, z = 0 (spec §7.8). */
  dense: Vec3[];
  contours: Contour2D[];
  features: FeatureLine2D[];
  stats: {
    /** shapes2d's normalise scale (`stats.normalise` of spec §7.1). */
    normalise: number;
    /** Filled area of the mask, normalised units² (the A of spec §7.4 step 1). */
    filledArea: number;
    /** δ₀ = 0.9·√(A / (n0·0.866)), the upper bracket of the spacing search (spec §7.4 step 1). */
    delta0: number;
    /** Spacing of the boundary samples, δ₀/4 (spec §7.2 step 4). */
    boundaryStep: number;
    /** Σ contour lengths. */
    perimeter: number;
    counts: Record<CandidateSource, number>;
    interiorSpacing: number;
    denseSpacing: number;
  };
}

// Compiler constants (module constants versioned by COMPILER_VERSION, never Params fields, spec §7.1).
/** Spec §7.2 step 6: boundary points and protected reservations share 35%·n0 (a heuristic, William). */
export const BOUNDARY_FEATURE_SHARE = 0.35;
/** Spec §7.4 step 2: minimum slots a small protected part is reserved (a heuristic). */
export const K_MIN = 3;
/** Spec §7.2 step 5: the interior lattice has about max(INTERIOR_MIN, INTERIOR_PER_N0·n0) points. */
export const INTERIOR_MIN = 1500;
export const INTERIOR_PER_N0 = 4;
/** Spec §7.8: about 2,000 dense points (test band 1,500–2,500); DENSE_MAX is the hard cap
 * (tests/score/expand.test.ts caps dense at 2,500 too). */
export const DENSE_TARGET = 2000;
export const DENSE_MAX = 2500;
const DENSE_RETRIES = 4;
const DENSE_FLOOR_TARGET = 200;
/** Spec §7.4 step 1: hexagonal packing at spacing s needs about 0.866·s² per point; δ₀ factor 0.9. */
export const HEX_PACKING = 0.866;
export const DELTA0_FACTOR = 0.9;
/** Spec §7.2 step 4: contours are resampled at δ₀ / BOUNDARY_STEP_DIVISOR. */
export const BOUNDARY_STEP_DIVISOR = 4;
/** A lattice is accepted within this share of its target count; otherwise its spacing is rescaled. */
const LATTICE_TOLERANCE = 0.03;
const LATTICE_TRIES = 8;
/** Snap-edge buckets are this many cells wide; the 3×3 around a sample covers the one-cell snap limit. */
const SNAP_BUCKET_CELLS = 4;
/** A snap target must separate inside from outside at this offset (cells) along the edge normal. */
const SNAP_SIDE_PROBE = 0.25;
const ROW = Math.sqrt(3) / 2;
const snap = (v: number): number => Math.round(v * 1e9) / 1e9;

export const interiorTarget = (n0: number): number => Math.max(INTERIOR_MIN, INTERIOR_PER_N0 * n0);
export const delta0 = (area: number, n0: number): number => DELTA0_FACTOR * Math.sqrt(area / (n0 * HEX_PACKING));

/** '#RRGGBB' (any case) → [RR, GG, BB] / 255; an [r, g, b] array passes through (spec §6.2, §7.7, no linearisation until GF-D6). */
export function foregroundRGB(fg: SceneSpec2D['foreground']): RGB {
  if (typeof fg === 'string') {
    const m = /^#([0-9a-fA-F]{6})$/.exec(fg);
    if (!m) throw new RangeError(`sample2d: foreground ${fg} is not #RRGGBB`);
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  return [fg[0], fg[1], fg[2]];
}

// ---------------------------------------------------------------- polylines

const dist = (a: Pt2, b: Pt2): number => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
const xyOf = (c: Candidate2D): Pt2 => [c.pos[0], c.pos[1]];

function polylineLength(pts: readonly Pt2[], closed: boolean): number {
  let L = 0;
  for (let k = 0; k + 1 < pts.length; k++) L += dist(pts[k], pts[k + 1]);
  if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

/** Points at arc steps of at most `step` along a polyline, both ends included (open) or once round (closed). */
function resample(pts: readonly Pt2[], step: number, closed: boolean): { p: Pt2; s: number }[] {
  const m = pts.length;
  if (m === 0) return [];
  const edges = closed ? m : m - 1;
  const cum = new Float64Array(edges + 1);
  for (let e = 0; e < edges; e++) cum[e + 1] = cum[e] + dist(pts[e], pts[(e + 1) % m]);
  const total = cum[edges];
  if (!(total > 0)) return [{ p: [pts[0][0], pts[0][1]], s: 0 }];
  const n = Math.max(closed ? 3 : 1, Math.ceil(total / step));
  const out: { p: Pt2; s: number }[] = [];
  let e = 0;
  for (let q = 0; q < (closed ? n : n + 1); q++) {
    const s = q === n ? total : (total * q) / n;
    while (e < edges - 1 && cum[e + 1] <= s) e++;
    const a = pts[e];
    const b = pts[(e + 1) % m];
    const span = cum[e + 1] - cum[e];
    const f = span > 0 ? Math.min(1, (s - cum[e]) / span) : 0;
    out.push({ p: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], s });
  }
  return out;
}

/** A monotone stand-in for the angle of (dx, dy) in [0, 2π), with range [0, 4); arithmetic only. */
function pseudoAngle(dx: number, dy: number): number {
  const d = Math.abs(dx) + Math.abs(dy);
  if (d === 0) return 0;
  const p = dx / d;
  return dy >= 0 ? 1 - p : 3 + p;
}

function nearestOnSegment(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return [a[0] + t * dx, a[1] + t * dy];
}

// ---------------------------------------------------------------- contours (marching squares)

export interface Loop2D {
  /** Edge midpoints between filled and empty cell centres, filled side on the left. */
  points: Pt2[];
  /** Shoelace area: positive for an outer boundary (counter-clockwise), negative for a hole. */
  area: number;
}

/**
 * Closed contours of the mask's filled cells (spec §7.2 step 4). Each square of four cell centres
 * contributes segments from edge midpoint to edge midpoint, directed with the filled side on the left;
 * diagonal (saddle) squares keep their filled corners apart, consistent with the 4-connected components
 * of shapes2d.ts. Loops come in the order their first segment is met in a row-major scan.
 */
export function traceContours(mask: Mask2D): Loop2D[] {
  const n = mask.size;
  const W = n + 2;
  const filled = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < n && j < n && mask.bits[j * n + i] === 1;
  const hKey = (i: number, j: number): number => 2 * ((j + 1) * W + (i + 1));       // between (i, j) and (i+1, j)
  const vKey = (i: number, j: number): number => 2 * ((j + 1) * W + (i + 1)) + 1;   // between (i, j) and (i, j+1)
  const pos = (key: number): Pt2 => {
    const base = Math.floor(key / 2);
    const i = (base % W) - 1;
    const j = Math.floor(base / W) - 1;
    return key % 2 === 0 ? cellCentre(mask, i + 0.5, j) : cellCentre(mask, i, j + 0.5);
  };
  const next = new Map<number, number>();
  const order: number[] = [];
  const s: boolean[] = [false, false, false, false];
  for (let j = -1; j < n; j++) {
    for (let i = -1; i < n; i++) {
      // Corners counter-clockwise: a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1); edge k joins corner k to k+1.
      s[0] = filled(i, j); s[1] = filled(i + 1, j); s[2] = filled(i + 1, j + 1); s[3] = filled(i, j + 1);
      if (s[0] === s[1] && s[1] === s[2] && s[2] === s[3]) continue;
      const edges = [hKey(i, j), vKey(i + 1, j), hKey(i, j + 1), vKey(i, j)];
      for (let k = 0; k < 4; k++) {
        if (!s[k] || s[(k + 1) % 4]) continue;          // edge k leaves a filled run: the segment starts here
        let m = k;
        while (s[(m + 3) % 4]) m = (m + 3) % 4;         // back to the start of that filled run
        next.set(edges[k], edges[(m + 3) % 4]);          // and ends on the edge entering the run
        order.push(edges[k]);
      }
    }
  }
  const used = new Set<number>();
  const loops: Loop2D[] = [];
  for (const start of order) {
    if (used.has(start)) continue;
    const points: Pt2[] = [];
    let key: number | undefined = start;
    while (key !== undefined && !used.has(key)) {
      used.add(key);
      points.push(pos(key));
      key = next.get(key);
    }
    if (key !== start) throw new Error('traceContours: an open contour (internal invariant broken)');
    let area = 0;
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    loops.push({ points, area: area / 2 });
  }
  return loops;
}

// ---------------------------------------------------------------- feature lines

/** Zhang–Suen thinning of a binary image (w × h, row-major, y up). Returns the skeleton in place. */
function zhangSuen(img: Uint8Array, w: number, h: number): void {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  // Only a pixel with an empty 8-neighbour can be removed (removal needs B <= 6), so each pass checks
  // just the current border: the same result as scanning every pixel, at a cost near the area rather
  // than area × thickness. A pixel joins the border when a neighbour is removed.
  const inBorder = new Uint8Array(img.length);
  let active: number[] = [];
  const addIfBorder = (k: number): void => {
    if (!img[k] || inBorder[k]) return;
    const x = k % w;
    const y = (k - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && !at(x + dx, y + dy)) { inBorder[k] = 1; active.push(k); return; }
      }
    }
  };
  for (let k = 0; k < img.length; k++) addIfBorder(k);
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = [];
      for (const k of active) {
        const x = k % w;
        const y = (k - x) / w;
        // P2 … P9 clockwise from north (y + 1 is north).
        const p = [at(x, y + 1), at(x + 1, y + 1), at(x + 1, y), at(x + 1, y - 1), at(x, y - 1), at(x - 1, y - 1), at(x - 1, y), at(x - 1, y + 1)];
        const b = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let q = 0; q < 8; q++) if (p[q] === 0 && p[(q + 1) % 8] === 1) a++;
        if (a !== 1) continue;
        if (pass === 0 ? (p[0] * p[2] * p[4] !== 0 || p[2] * p[4] * p[6] !== 0)
          : (p[0] * p[2] * p[6] !== 0 || p[0] * p[4] * p[6] !== 0)) continue;
        remove.push(k);
      }
      for (const k of remove) img[k] = 0;
      if (remove.length > 0) {
        changed = true;
        active = active.filter((k) => img[k] === 1);
        for (const k of remove) {
          const x = k % w;
          const y = (k - x) / w;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h) addIfBorder(ny * w + nx);
            }
          }
        }
      }
    }
  }
}

/** Length of an 8-connected skeleton: half a cell per orthogonal link end, half a diagonal (√2) per
 * diagonal link end, a diagonal counted only when neither shared orthogonal cell is set (no staircase
 * double count). Every link is seen from both ends, so each end adds half. */
function skeletonLength(img: Uint8Array, w: number, h: number, cell: number): number {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  const diag = Math.SQRT2 * cell;
  let len = 0;
  for (let k = 0; k < img.length; k++) {
    if (!img[k]) continue;
    const x = k % w;
    const y = (k - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy)) len += cell / 2;
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (at(x + dx, y + dy) && !at(x + dx, y) && !at(x, y + dy)) len += diag / 2;
    }
  }
  return len;
}

/** Greedy subset of `pts` (in their given order) with every pair at least `step` apart. */
function spaced(pts: readonly Pt2[], step: number): Pt2[] {
  const out: Pt2[] = [];
  const s2 = step * step;
  for (const p of pts) {
    let ok = true;
    for (const q of out) {
      if ((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) < s2) { ok = false; break; }
    }
    if (ok) out.push(p);
  }
  return out;
}

/** The principal axis of a point set through its centroid, as a segment spanning the set (sqrt only). */
function principalAxis(pts: readonly Pt2[]): Pt2[] {
  if (pts.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const half = (sxx - syy) / 2;
  const lambda = (sxx + syy) / 2 + Math.sqrt(half * half + sxy * sxy);
  let ux = sxy;
  let uy = lambda - sxx;
  if (ux === 0 && uy === 0) { ux = lambda - syy; uy = sxy; }
  if (ux === 0 && uy === 0) { ux = 1; uy = 0; }
  const len = Math.sqrt(ux * ux + uy * uy);
  ux /= len;
  uy /= len;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const t = (p[0] - cx) * ux + (p[1] - cy) * uy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [[cx + lo * ux, cy + lo * uy], [cx + hi * ux, cy + hi * uy]];
}

/** The feature line of a protected part (approved default: centreline, major axis, or skeleton). */
function featureLine(part: Part2D, region: Region2D, mask: Mask2D, step: number): { kind: FeatureLine2D['kind']; points: Pt2[]; length: number } {
  const g = part.geometry;
  if (g.type === 'stroke' && part.centreline) {
    const line = part.centreline;
    return { kind: 'centreline', points: resample(line, step, false).map((r) => r.p), length: polylineLength(line, false) };
  }
  if (g.type === 'ellipse') {
    const r = ((g.rotationDeg ?? 0) * Math.PI) / 180;
    const c = snap(Math.cos(r));
    const s = snap(Math.sin(r));
    const major = g.radii[0] >= g.radii[1];
    const a = major ? g.radii[0] : g.radii[1];
    const dir: Pt2 = major ? [c, s] : [-s, c];
    const ends: Pt2[] = [[g.center[0] - a * dir[0], g.center[1] - a * dir[1]], [g.center[0] + a * dir[0], g.center[1] + a * dir[1]]];
    return { kind: 'major-axis', points: resample(ends, step, false).map((q) => q.p), length: 2 * a };
  }
  // Polygon or path: the skeleton of the part's own cells (its shape, before other parts apply).
  const o = mask.origin;
  const i0 = Math.max(0, Math.floor((part.bbox.min[0] - o[0]) / mask.cell) - 1);
  const i1 = Math.min(mask.size - 1, Math.ceil((part.bbox.max[0] - o[0]) / mask.cell) + 1);
  const j0 = Math.max(0, Math.floor((part.bbox.min[1] - o[1]) / mask.cell) - 1);
  const j1 = Math.min(mask.size - 1, Math.ceil((part.bbox.max[1] - o[1]) / mask.cell) + 1);
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const img = new Uint8Array(Math.max(0, w * h));
  // shapes2d's own scanline fill of this one part: bit for bit containsXY at each cell centre, without
  // a point-in-polygon test per cell against every ring vertex.
  const own = rasterise({ ...region, parts: [part] }, mask.size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) img[y * w + x] = own.bits[(j0 + y) * mask.size + (i0 + x)];
  }
  zhangSuen(img, w, h);
  const skeleton: Pt2[] = [];
  for (let k = 0; k < img.length; k++) {
    if (img[k]) skeleton.push(cellCentre(mask, i0 + (k % w), j0 + Math.floor(k / w)));
  }
  if (skeleton.length > 0) {
    // A lone pixel has no links; it still stands for a feature one cell long.
    return { kind: 'skeleton', points: spaced(skeleton, step), length: Math.max(mask.cell, skeletonLength(img, w, h, mask.cell)) };
  }
  const axis = principalAxis(part.ring ?? []);
  return { kind: 'principal-axis', points: resample(axis, step, false).map((q) => q.p), length: axis.length === 2 ? dist(axis[0], axis[1]) : 0 };
}

// ---------------------------------------------------------------- lattices

const isFilled = (mask: Mask2D, x: number, y: number): boolean => {
  const i = Math.floor((x - mask.origin[0]) / mask.cell);
  const j = Math.floor((y - mask.origin[1]) / mask.cell);
  return i >= 0 && j >= 0 && i < mask.size && j < mask.size && mask.bits[j * mask.size + i] === 1;
};

function filledBounds(mask: Mask2D): { min: Pt2; max: Pt2 } {
  const n = mask.size;
  let i0 = n;
  let j0 = n;
  let i1 = -1;
  let j1 = -1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!mask.bits[j * n + i]) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
    }
  }
  return { min: [mask.origin[0] + i0 * mask.cell, mask.origin[1] + j0 * mask.cell],
    max: [mask.origin[0] + (i1 + 1) * mask.cell, mask.origin[1] + (j1 + 1) * mask.cell] };
}

/**
 * Hexagonal lattice points with spacing s and offset fractions (u, v) of a step, kept where the mask
 * cell is filled AND the region contains the point: point (r, c) is at y = by + (v + r)·h and
 * x = bx + (u + shift_r + c − 1)·s, with (bx, by) the filled box's corner.
 * Enumerated per filled cell, so the cost follows the filled area, not the box (two far-apart dots
 * would otherwise walk millions of empty lattice points). Each point is assigned to the cell its own
 * coordinates fall in (the same floor arithmetic as `isFilled`), so none is counted twice or missed,
 * and the result is sorted back into row-then-column order.
 */
function latticeAt(mask: Mask2D, region: Region2D, box: { min: Pt2; max: Pt2 }, filled: Int32Array, s: number, u: number, v: number): Pt2[] {
  const h = s * ROW;
  const [bx, by] = box.min;
  const n = mask.size;
  const found: { r: number; c: number; p: Pt2 }[] = [];
  for (const idx of filled) {
    const i = idx % n;
    const j = (idx - i) / n;
    const y0 = mask.origin[1] + j * mask.cell;
    const x0 = mask.origin[0] + i * mask.cell;
    const r0 = Math.max(0, Math.floor((y0 - by) / h - v) - 1);
    const r1 = Math.ceil((y0 + mask.cell - by) / h - v) + 1;
    for (let r = r0; r <= r1; r++) {
      const y = by + (v + r) * h;
      if (Math.floor((y - mask.origin[1]) / mask.cell) !== j) continue;
      const shift = (r % 2) * 0.5;
      const c0 = Math.max(0, Math.floor((x0 - bx) / s - u - shift + 1) - 1);
      const c1 = Math.ceil((x0 + mask.cell - bx) / s - u - shift + 1) + 1;
      for (let c = c0; c <= c1; c++) {
        const x = bx + (u + shift + c) * s - s;
        if (x < bx || Math.floor((x - mask.origin[0]) / mask.cell) !== i) continue;
        if (isFilled(mask, x, y) && region.contains([x, y])) found.push({ r, c, p: [x, y] });
      }
    }
  }
  found.sort((a, b) => a.r - b.r || a.c - b.c);
  return found.map((f) => f.p);
}

/** Indices of the filled cells, row-major. */
function filledCells(mask: Mask2D): Int32Array {
  let count = 0;
  for (let k = 0; k < mask.bits.length; k++) count += mask.bits[k];
  const out = new Int32Array(count);
  let q = 0;
  for (let k = 0; k < mask.bits.length; k++) if (mask.bits[k]) out[q++] = k;
  return out;
}

/** A lattice of about `target` points: the spacing starts from the filled area and is rescaled by
 * √(count / target) until the count is within LATTICE_TOLERANCE (or the tries run out: the closest wins). */
function hexLattice(mask: Mask2D, region: Region2D, area: number, target: number, u: number, v: number): { points: Pt2[]; spacing: number } {
  const box = filledBounds(mask);
  const filled = filledCells(mask);
  let s = Math.sqrt(area / (HEX_PACKING * target));
  let best: { points: Pt2[]; spacing: number } | null = null;
  for (let t = 0; t < LATTICE_TRIES; t++) {
    const points = latticeAt(mask, region, box, filled, s, u, v);
    if (!best || Math.abs(points.length - target) < Math.abs(best.points.length - target)) best = { points, spacing: s };
    if (Math.abs(points.length - target) <= LATTICE_TOLERANCE * target) break;
    s = points.length > 0 ? s * Math.sqrt(points.length / target) : s / 2;
  }
  return best ?? { points: [], spacing: s };
}

/** Adds (in place, row-major) the centre of every filled, contained cell with no point within `radius`. */
function coverFilledCells(mask: Mask2D, region: Region2D, points: Pt2[], radius: number): void {
  if (!(radius > 0)) return;
  const r2 = radius * radius;
  // Only occupied buckets exist (a Map), and a bucket is never smaller than a cell, so memory follows
  // the number of points, not mask area / radius² (a scene of two tiny dots has a tiny radius).
  const size = Math.max(radius, mask.cell);
  const span = Math.ceil((mask.size * mask.cell) / size) + 3;
  const bucketOf = (v: number, o: number): number => Math.floor((v - o) / size) + 1;
  const grid = new Map<number, Pt2[]>();
  const add = (p: Pt2): void => {
    const key = bucketOf(p[1], mask.origin[1]) * span + bucketOf(p[0], mask.origin[0]);
    const list = grid.get(key);
    if (list) list.push(p);
    else grid.set(key, [p]);
  };
  for (const p of points) add(p);
  const covered = (p: Pt2): boolean => {
    const bi = bucketOf(p[0], mask.origin[0]);
    const bj = bucketOf(p[1], mask.origin[1]);
    for (let j = bj - 1; j <= bj + 1; j++) {
      for (let i = bi - 1; i <= bi + 1; i++) {
        for (const q of grid.get(j * span + i) ?? []) if ((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]) <= r2) return true;
      }
    }
    return false;
  };
  for (let j = 0; j < mask.size; j++) {
    for (let i = 0; i < mask.size; i++) {
      if (!mask.bits[j * mask.size + i]) continue;
      const c = cellCentre(mask, i, j);
      if (!covered(c) && region.contains(c)) { points.push(c); add(c); }
    }
  }
}

// ---------------------------------------------------------------- sampling

/** The part deciding a point (the last part containing it, any operation), or -1. */
function decider(region: Region2D, p: Pt2): number {
  for (let k = region.parts.length - 1; k >= 0; k--) if (region.parts[k].containsXY(p[0], p[1])) return k;
  return -1;
}

/** The last UNION part containing a point inside the region, or -1. */
function unionOwner(region: Region2D, p: Pt2): number {
  for (let k = region.parts.length - 1; k >= 0; k--) {
    const part = region.parts[k];
    if (part.containsXY(p[0], p[1])) return part.operation === 'union' ? k : -1;
  }
  return -1;
}

/**
 * Candidates and dense points for a 2D scene. `region` and `mask` are GF-WP-03's for the same
 * (canonical) scene, the mask after `checkConnectivity` (specks dropped). Throws a RangeError for an
 * empty mask or a non-positive-integer n0; the compiler maps that to a typed rejection (spec §7.11).
 */
export function sample2d(scene: SceneSpec2D, region: Region2D, mask: Mask2D, opts: Sample2DOptions): Sample2DResult {
  const { n0 } = opts;
  if (!Number.isInteger(n0) || n0 < 1) throw new RangeError(`sample2d: n0 must be a positive integer, got ${n0}`);
  const area = filledArea(mask);
  if (!(area > 0)) throw new RangeError('sample2d: the mask is empty');
  const colour = foregroundRGB(scene.foreground);
  const d0 = delta0(area, n0);
  const step = d0 / BOUNDARY_STEP_DIVISOR;
  const candidates: Candidate2D[] = [];
  const push = (p: Pt2, source: CandidateSource, part: number, extra: Partial<Candidate2D> = {}): void => {
    const owner = region.parts[part];
    candidates.push({ pos: [p[0], p[1], 0], colour: [colour[0], colour[1], colour[2]], featureId: owner ? owner.id : '',
      importance: owner ? owner.priority : 1, source, part, ...extra });
  };

  // Original vector edges for snapping (spec §7.2 step 4): every part's outline, finer than a cell,
  // bucketed (SNAP_BUCKET_CELLS cells per bucket) so each sample scans only the edges near it.
  const edges: { a: Pt2; b: Pt2; part: number }[] = [];
  region.parts.forEach((part, k) => {
    const loop = part.outline(mask.cell / 2);
    for (let e = 0; e < loop.length; e++) edges.push({ a: loop[e], b: loop[(e + 1) % loop.length], part: k });
  });
  const bucket = SNAP_BUCKET_CELLS * mask.cell;
  const nb = Math.ceil(mask.size / SNAP_BUCKET_CELLS);
  const bucketOf = (v: number, o: number): number => Math.min(nb - 1, Math.max(0, Math.floor((v - o) / bucket)));
  const buckets: number[][] = Array.from({ length: nb * nb }, () => []);
  edges.forEach((edge, idx) => {
    const bi0 = bucketOf(Math.min(edge.a[0], edge.b[0]), mask.origin[0]);
    const bi1 = bucketOf(Math.max(edge.a[0], edge.b[0]), mask.origin[0]);
    const bj0 = bucketOf(Math.min(edge.a[1], edge.b[1]), mask.origin[1]);
    const bj1 = bucketOf(Math.max(edge.a[1], edge.b[1]), mask.origin[1]);
    for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) buckets[bj * nb + bi].push(idx);
  });
  const snapLimit2 = mask.cell * mask.cell;
  const side = SNAP_SIDE_PROBE * mask.cell;
  /** Edges near p, in ascending edge index (so ties still go to the first part and edge). */
  const nearEdges = (p: Pt2): number[] => {
    const bi = bucketOf(p[0], mask.origin[0]);
    const bj = bucketOf(p[1], mask.origin[1]);
    const found: number[] = [];
    for (let j = Math.max(0, bj - 1); j <= Math.min(nb - 1, bj + 1); j++) {
      for (let i = Math.max(0, bi - 1); i <= Math.min(nb - 1, bi + 1); i++) found.push(...buckets[j * nb + i]);
    }
    found.sort((x, y) => x - y);
    return found.filter((v, k) => k === 0 || found[k - 1] !== v);
  };
  /** True when q on edge a–b is real region boundary: the region differs on the two sides of the edge
   * there. An outline that lies outside the union, or inside a later hole, is not snapped to. */
  const onBoundary = (q: Pt2, a: Pt2, b: Pt2): boolean => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return false;
    const nx = (-dy / len) * side;
    const ny = (dx / len) * side;
    return region.contains([q[0] + nx, q[1] + ny]) !== region.contains([q[0] - nx, q[1] - ny]);
  };

  // Boundary: contours from a fixed start, resampled at δ₀/4, snapped within one cell of a vector edge.
  const contours: Contour2D[] = [];
  let perimeter = 0;
  for (const loop of traceContours(mask)) {
    const pts = loop.points;
    let cx = 0;
    let cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length;
    cy /= pts.length;
    let startAt = 0;
    let best = Infinity;
    for (let k = 0; k < pts.length; k++) {
      const a = pseudoAngle(pts[k][0] - cx, pts[k][1] - cy);
      if (a < best) { best = a; startAt = k; }
    }
    const rotated = pts.slice(startAt).concat(pts.slice(0, startAt));
    const first = candidates.length;
    // The traced staircase overestimates curved lengths (about 5% on a circle), so arc and length are
    // measured along the snapped points, which lie on the original vector edges.
    let arc = 0;
    let prev: Pt2 | null = null;
    for (const { p } of resample(rotated, step, true)) {
      let snapped: Pt2 = p;
      let snapPart = -1;
      let bestD2 = snapLimit2;
      for (const idx of nearEdges(p)) {
        const edge = edges[idx];
        const q = nearestOnSegment(p, edge.a, edge.b);
        const d2 = (q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]);
        if (d2 <= bestD2 && (snapPart < 0 || d2 < bestD2) && onBoundary(q, edge.a, edge.b)) {
          bestD2 = d2; snapped = q; snapPart = edge.part;
        }
      }
      let owner = snapPart >= 0 ? snapPart : decider(region, p);
      if (owner < 0) {
        // Just outside every part: the part deciding the nearest filled cell around it.
        const ci = Math.floor((p[0] - mask.origin[0]) / mask.cell);
        const cj = Math.floor((p[1] - mask.origin[1]) / mask.cell);
        let near = Infinity;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const i = ci + di;
            const j = cj + dj;
            if (i < 0 || j < 0 || i >= mask.size || j >= mask.size || !mask.bits[j * mask.size + i]) continue;
            const c = cellCentre(mask, i, j);
            const d = dist(c, p);
            if (d < near) { near = d; owner = decider(region, c); }
          }
        }
      }
      if (prev) arc += dist(prev, snapped);
      prev = snapped;
      push(snapped, 'boundary', owner, { contour: contours.length, arc });
    }
    const count = candidates.length - first;
    const length = count > 1 && prev ? arc + dist(prev, xyOf(candidates[first])) : 0;
    perimeter += length;
    contours.push({ hole: loop.area < 0, length, start: xyOf(candidates[first]), first, count });
  }

  // Feature: points along each protected union part's feature line that the region contains.
  const features: FeatureLine2D[] = [];
  region.parts.forEach((part, k) => {
    if (part.operation !== 'union' || part.priority < PROTECTED_PRIORITY) return;
    const line = featureLine(part, region, mask, step);
    const first = candidates.length;
    for (const p of line.points) if (region.contains(p)) push(p, 'feature', k);
    features.push({ part: k, featureId: part.id, kind: line.kind, length: line.length, first, count: candidates.length - first });
  });

  // Interior: a seeded hexagonal lattice over the filled cells.
  const u = opts.next();
  const v = opts.next();
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) throw new RangeError('sample2d: next() must return values in [0, 1)');
  const interior = hexLattice(mask, region, area, interiorTarget(n0), u, v);
  for (const p of interior.points) push(p, 'interior', unionOwner(region, p));

  // Dense: from the region alone (spec §7.8), a fixed-offset lattice, never from candidates or slots,
  // then a row-major coverage pass so a part thinner than the lattice spacing (or a kept speck) is not
  // missed: any filled cell with no dense point within one spacing adds its centre.
  // Coverage can push the count over the §7.8 cap (many long thin parts), so the lattice target is
  // lowered by the excess and the pair rebuilt; a deterministic stride thin is the last resort.
  let denseTarget = DENSE_TARGET;
  let dense = hexLattice(mask, region, area, denseTarget, 0.5, 0.5);
  coverFilledCells(mask, region, dense.points, dense.spacing);
  for (let t = 0; t < DENSE_RETRIES && dense.points.length > DENSE_MAX; t++) {
    denseTarget = Math.max(DENSE_FLOOR_TARGET, denseTarget - (dense.points.length - DENSE_TARGET));
    dense = hexLattice(mask, region, area, denseTarget, 0.5, 0.5);
    coverFilledCells(mask, region, dense.points, dense.spacing);
  }
  if (dense.points.length > DENSE_MAX) {
    const all = dense.points;
    dense = { points: Array.from({ length: DENSE_MAX }, (_, k) => all[Math.floor((k * all.length) / DENSE_MAX)]), spacing: dense.spacing };
  }

  const counts: Record<CandidateSource, number> = { boundary: 0, interior: 0, feature: 0 };
  for (const c of candidates) counts[c.source]++;
  return {
    candidates,
    dense: dense.points.map((p): Vec3 => [p[0], p[1], 0]),
    contours,
    features,
    stats: { normalise: region.normalise.scale, filledArea: area, delta0: d0, boundaryStep: step, perimeter, counts,
      interiorSpacing: interior.spacing, denseSpacing: dense.spacing },
  };
}
