// src/score/generated/shapes2d.ts
// GF-WP-03 (#206): the 2D primitives of a generated scene (ellipse, polygon, closed cubic Bézier path,
// thick stroke), their union and subtraction in array order, and the internal 512² mask. Canonical
// spec: docs/integrations/gemini-generated-formations.md §7.2 steps 1–3, with V8 and V10 of §6.5.
//
// Pure and deterministic (spec §7.12): arithmetic and Math.sqrt are used as they are, every other
// Math.* result is snapped to 1e-9 (as src/score/shapes.ts does), Math.hypot is not used, and there is
// no randomness. The mask is internal only: it is never written as an image or shown to anyone.
//
// The scene's union box is normalised first (spec §7.2 step 2): it is scaled uniformly about its centre
// so its longer side spans [-1.1, 1.1]. V10 thickening runs after that, in normalised units, and is not
// followed by a second normalisation: a thickened stroke or radius can push the returned union box up to
// 0.01 (half the minimum stroke width, or the minimum radius) beyond [-1.1, 1.1], still inside the
// [-1.2, 1.2] mask. Everything this module returns (parts, outlines, mask) is in that normalised space,
// so thresholds are relative and a half-size copy of a scene gives the same mask.
//
// Only `buildRegion2D` touches the scene types of GF-WP-01 (#203). Everything else works on the local
// input types below, so the module does not depend on the scene types' exact names.

import type { SceneSpec2D } from './types';

export type Pt2 = [number, number];
export interface Box2 { min: Pt2; max: Pt2 }

/** The four geometries of spec §6.2 `Geometry2D`, as plain local input types. */
export type Geom2D =
  | { type: 'ellipse'; center: Pt2; radii: Pt2; rotationDeg?: number }
  | { type: 'polygon'; points: Pt2[] }                  // implicitly closed; simple (checked by V6)
  | { type: 'path'; points: Pt2[] }                     // closed cubic Bézier chain, 3k+1 points
  | { type: 'stroke'; points: Pt2[]; width: number };   // open cubic Bézier chain, 3k+1 points; full width

export interface PartInput2D {
  id: string;
  operation: 'union' | 'subtract';
  priority: number;          // 1..5; >= PROTECTED_PRIORITY is protected (spec §6.2)
  geometry: Geom2D;
}

/** Same shape as the compiler's `CompileWarning` (spec §7.1). */
export interface ShapeWarning { code: string; partId?: string; detail: string }

export interface Part2D {
  id: string;
  priority: number;
  operation: 'union' | 'subtract';
  /** The part's geometry in normalised space, after V10 thickening. */
  geometry: Geom2D;
  /** Bounding box of the part in normalised space. */
  bbox: Box2;
  contains(p: Pt2): boolean;
  containsXY(x: number, y: number): boolean;
  /** The part's boundary as one closed loop (first point not repeated), spacing at most `step`. */
  outline(step: number): Pt2[];
  /** Polygon and path: the flattened ring the inside test uses (even-odd). */
  ring?: Pt2[];
  /** Stroke: the flattened centreline the inside test uses. */
  centreline?: Pt2[];
}

export interface Region2D {
  parts: Part2D[];
  /** Normalised-space point test: parts apply in array order (union sets, subtract clears). */
  contains(p: Pt2): boolean;
  /**
   * Box of the union parts in normalised space, after V10 thickening. The scene was normalised so its
   * longer side spans [-1.1, 1.1] before thickening, which is not re-normalised, so a thickened part can
   * reach up to 0.01 beyond that range on any side.
   */
  bbox: Box2;
  /** normalised = (scene − centre) · scale (`stats.normalise` of spec §7.1 is `scale`). */
  normalise: { scale: number; centre: Pt2 };
  /** V10 warnings (`thickened`, `thin-feature`). */
  warnings: ShapeWarning[];
}

export interface Mask2D {
  size: number;
  /** Side of one cell in normalised units. */
  cell: number;
  /** Lower-left corner of the mask in normalised space. Cell (i, j) has its centre at `cellCentre`. */
  origin: Pt2;
  /** Row-major, `bits[j * size + i]`, 1 = filled. */
  bits: Uint8Array;
  /** Copied from the region, so mask areas can be converted back to scene units. */
  normalise: { scale: number; centre: Pt2 };
}

export interface Components {
  count: number;
  /** Largest component's share of all filled cells; 0 for an empty mask. */
  largestShare: number;
  /** Per cell: 0 when empty, otherwise the component label 1..count, numbered in row-major scan order. */
  labels: Int32Array;
  /** `sizes[label - 1]` is that component's number of cells. */
  sizes: number[];
}

export type MaskCheck =
  | { ok: true; mask: Mask2D; components: Components; warnings: ShapeWarning[]; droppedCells: number }
  | { ok: false; code: 'empty-geometry'; detail: string };

// Compiler constants (spec §7.1: module constants versioned by COMPILER_VERSION, never Params fields).
export const MASK_SIZE = 512;
export const MASK_HALF_EXTENT = 1.2;            // the mask covers [-1.2, 1.2]² (spec §7.2 step 2)
export const NORMALISED_HALF_EXTENT = 1.1;      // the union box's longer side spans [-1.1, 1.1]
export const PATH_SAMPLES_PER_SEGMENT = 16;     // spec §7.2 step 1
export const STROKE_SAMPLES_PER_SEGMENT = 32;   // spec §7.2 step 1
export const PROTECTED_PRIORITY = 4;            // spec §6.2
export const SPECK_SHARE = 0.005;               // V8: components under 0.5% of the filled cells
export const MIN_STROKE_WIDTH = 0.02;           // V10, normalised units
export const MIN_RADIUS = 0.01;                 // V10, normalised units
/** Fine sampling of curves for arc-length tables and outlines (not used by the inside tests). */
export const ARC_TABLE_SAMPLES = 64;
export const ELLIPSE_OUTLINE_SAMPLES = 256;
const CAP_SAMPLES = 16;
/** Shorter than this (normalised units, where shapes are of order 1) a direction is rounding noise. */
const DEGENERATE_LENGTH = 1e-12;
/** Box culling margin, so float rounding at the very edge of a part never changes a result. */
const CULL_MARGIN = 1e-6;

const snap = (v: number): number => Math.round(v * 1e9) / 1e9;

function trig(deg: number): { c: number; s: number } {
  const r = (deg * Math.PI) / 180;
  return { c: snap(Math.cos(r)), s: snap(Math.sin(r)) };
}

// ---------------------------------------------------------------- Bézier curves (GF-T06)

/** Cubic Bézier in Bernstein form (William's B(t)). B(0) = P0 and B(1) = P3 exactly. */
export function bezierBernstein(p0: Pt2, p1: Pt2, p2: Pt2, p3: Pt2, t: number): Pt2 {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return [
    b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
  ];
}

const lerp = (a: number, b: number, t: number): number => (1 - t) * a + t * b;

/** The same curve by de Casteljau's construction, for cross-checking. Also exact at t = 0 and t = 1. */
export function bezierDeCasteljau(p0: Pt2, p1: Pt2, p2: Pt2, p3: Pt2, t: number): Pt2 {
  const out: Pt2 = [0, 0];
  for (let d = 0; d < 2; d++) {
    const a = lerp(p0[d], p1[d], t);
    const b = lerp(p1[d], p2[d], t);
    const c = lerp(p2[d], p3[d], t);
    out[d] = lerp(lerp(a, b, t), lerp(b, c, t), t);
  }
  return out;
}

function chainSegments(points: readonly Pt2[], caller: string): number {
  const k = (points.length - 1) / 3;
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`${caller}: a cubic chain needs 3k+1 points with k >= 1, got ${points.length}`);
  }
  return k;
}

/** Point at chain parameter t in [0, k]; segment i covers [i, i + 1]. */
function evalChain(points: readonly Pt2[], t: number, k: number): Pt2 {
  let i = Math.floor(t);
  if (i > k - 1) i = k - 1;
  if (i < 0) i = 0;
  const b = 3 * i;
  return bezierBernstein(points[b], points[b + 1], points[b + 2], points[b + 3], t - i);
}

/**
 * A cubic chain flattened at a fixed count per segment (no adaptive tolerance): k·n + 1 points.
 * Segment joints and the end are the control points themselves, exactly.
 */
export function flattenCubic(points: readonly Pt2[], segmentsPerCurve: number): Pt2[] {
  const k = chainSegments(points, 'flattenCubic');
  if (!Number.isInteger(segmentsPerCurve) || segmentsPerCurve < 1) {
    throw new RangeError(`flattenCubic: segmentsPerCurve must be a positive integer, got ${segmentsPerCurve}`);
  }
  const out: Pt2[] = [];
  for (let i = 0; i < k; i++) {
    const b = 3 * i;
    out.push([points[b][0], points[b][1]]);
    for (let j = 1; j < segmentsPerCurve; j++) {
      out.push(bezierBernstein(points[b], points[b + 1], points[b + 2], points[b + 3], j / segmentsPerCurve));
    }
  }
  const last = points[3 * k];
  out.push([last[0], last[1]]);
  return out;
}

export interface ArcSample { t: number; p: Pt2 }

/**
 * `count + 1` points spaced evenly by arc length along a cubic chain, from its first to its last
 * control point. `t` is the chain parameter in [0, k] and never decreases. Arc length comes from a
 * table of ARC_TABLE_SAMPLES chords per segment; t is interpolated linearly inside a table interval.
 */
export function sampleCubicByArcLength(points: readonly Pt2[], count: number): ArcSample[] {
  const k = chainSegments(points, 'sampleCubicByArcLength');
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`sampleCubicByArcLength: count must be a positive integer, got ${count}`);
  }
  const n = k * ARC_TABLE_SAMPLES;
  const ts = new Float64Array(n + 1);
  const cum = new Float64Array(n + 1);
  const first = points[0];
  const last = points[3 * k];
  let prev: Pt2 = first;
  for (let i = 1; i <= n; i++) {
    const t = i / ARC_TABLE_SAMPLES;
    const p = i === n ? last : evalChain(points, t, k);
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    ts[i] = t;
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    prev = p;
  }
  const total = cum[n];
  const out: ArcSample[] = [{ t: 0, p: [first[0], first[1]] }];
  let i = 0;
  for (let m = 1; m < count; m++) {
    const s = (total * m) / count;
    while (i < n - 1 && cum[i + 1] <= s) i++;
    const span = cum[i + 1] - cum[i];
    const f = span > 0 ? (s - cum[i]) / span : 0;
    const t = ts[i] + f * (ts[i + 1] - ts[i]);
    out.push({ t, p: evalChain(points, t, k) });
  }
  out.push({ t: k, p: [last[0], last[1]] });
  return out;
}

// ---------------------------------------------------------------- polylines

/** x where edge a→b crosses the horizontal line y. The one expression both inside tests use. */
function crossX(ax: number, ay: number, bx: number, by: number, y: number): number {
  return ((bx - ax) * (y - ay)) / (by - ay) + ax;
}

/** Even-odd crossing test against an implicitly closed ring. */
function insideEvenOdd(ring: readonly Pt2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if ((a[1] > y) !== (b[1] > y) && x < crossX(a[0], a[1], b[0], b[1], y)) inside = !inside;
  }
  return inside;
}

/** Squared distance from (px, py) to the segment a–b. */
function segDist2(px: number, py: number, a: Pt2, b: Pt2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = a[0] + t * dx - px;
  const qy = a[1] + t * dy - py;
  return qx * qx + qy * qy;
}

function boxOf(points: readonly Pt2[], pad = 0): Box2 {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { min: [x0 - pad, y0 - pad], max: [x1 + pad, y1 + pad] };
}

function ellipseBox(center: Pt2, radii: Pt2, rotationDeg: number): Box2 {
  const { c, s } = trig(rotationDeg);
  const [a, b] = radii;
  const hx = Math.sqrt(a * c * (a * c) + b * s * (b * s));
  const hy = Math.sqrt(a * s * (a * s) + b * c * (b * c));
  return { min: [center[0] - hx, center[1] - hy], max: [center[0] + hx, center[1] + hy] };
}

/** `count` points spaced evenly by length around an implicitly closed ring; count >= 3 and spacing <= step. */
function resampleClosed(ring: readonly Pt2[], step: number): Pt2[] {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError(`outline: step must be positive, got ${step}`);
  const m = ring.length;
  const cum = new Float64Array(m + 1);
  for (let e = 0; e < m; e++) {
    const a = ring[e];
    const b = ring[(e + 1) % m];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    cum[e + 1] = cum[e] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = cum[m];
  if (!(total > 0)) return [[ring[0][0], ring[0][1]]];
  const n = Math.max(3, Math.ceil(total / step));
  const out: Pt2[] = [];
  let e = 0;
  for (let q = 0; q < n; q++) {
    const s = (total * q) / n;
    while (e < m - 1 && cum[e + 1] <= s) e++;
    const a = ring[e];
    const b = ring[(e + 1) % m];
    const span = cum[e + 1] - cum[e];
    const f = span > 0 ? (s - cum[e]) / span : 0;
    out.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
  }
  return out;
}

/**
 * Boundary loop of a thick polyline: the left offset, a round cap, the right offset back, a round cap.
 * Exact for straight runs and the caps; on tight bends the offsets are an approximation (used only to
 * snap boundary samples, never by the inside test).
 */
function strokeLoop(line: readonly Pt2[], r: number): Pt2[] {
  const n = line.length;
  const normals: (Pt2 | null)[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    // Below DEGENERATE_LENGTH the difference is rounding noise (a zero-length Bézier segment flattens
    // to points one ulp apart), and its direction is meaningless.
    normals[i] = len > DEGENERATE_LENGTH ? [-dy / len, dx / len] : null;
  }
  // A zero-length stretch takes the nearest real normal: carry forward, then back-fill the start.
  // Only a centreline that is a single point (a dot: the two caps make a circle) keeps [0, 1].
  for (let i = 1; i < n; i++) if (!normals[i]) normals[i] = normals[i - 1];
  for (let i = n - 2; i >= 0; i--) if (!normals[i]) normals[i] = normals[i + 1];
  const normal = (i: number): Pt2 => normals[i] ?? [0, 1];
  const cap = (centre: Pt2, from: Pt2): Pt2[] => {
    // Half-turn clockwise from `from` (a unit normal) through the outward tangent.
    const pts: Pt2[] = [];
    for (let j = 1; j < CAP_SAMPLES; j++) {
      const { c, s } = trig((180 * j) / CAP_SAMPLES);
      const vx = from[0] * c + from[1] * s;
      const vy = from[1] * c - from[0] * s;
      pts.push([centre[0] + r * vx, centre[1] + r * vy]);
    }
    return pts;
  };
  const loop: Pt2[] = [];
  for (let i = 0; i < n; i++) loop.push([line[i][0] + r * normal(i)[0], line[i][1] + r * normal(i)[1]]);
  loop.push(...cap(line[n - 1], normal(n - 1)));
  for (let i = n - 1; i >= 0; i--) loop.push([line[i][0] - r * normal(i)[0], line[i][1] - r * normal(i)[1]]);
  const back = normal(0);
  loop.push(...cap(line[0], [-back[0], -back[1]]));
  return loop;
}

// ---------------------------------------------------------------- parts and region

function sceneBox(g: Geom2D): Box2 {
  switch (g.type) {
    case 'ellipse': return ellipseBox(g.center, g.radii, g.rotationDeg ?? 0);
    case 'polygon': return boxOf(g.points);
    case 'path': return boxOf(flattenCubic(g.points, PATH_SAMPLES_PER_SEGMENT));
    case 'stroke': return boxOf(flattenCubic(g.points, STROKE_SAMPLES_PER_SEGMENT), g.width / 2);
  }
}

function checkGeometry(g: Geom2D, id: string): void {
  const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);
  const pts = (ps: readonly Pt2[]): boolean =>
    Array.isArray(ps) && ps.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]));
  let ok: boolean;
  switch (g?.type) {
    case 'ellipse':
      ok = pts([g.center, g.radii]) && g.radii[0] > 0 && g.radii[1] > 0 &&
        (g.rotationDeg === undefined || finite(g.rotationDeg));
      break;
    case 'polygon': ok = pts(g.points) && g.points.length >= 3; break;
    case 'path': ok = pts(g.points); if (ok) chainSegments(g.points, `part ${id}`); break;
    case 'stroke':
      ok = pts(g.points) && finite(g.width) && g.width > 0;
      if (ok) chainSegments(g.points, `part ${id}`);
      break;
    default: ok = false;
  }
  if (!ok) throw new RangeError(`buildRegion: part ${id} has invalid geometry`);
}

function makePart(input: PartInput2D, g: Geom2D): Part2D {
  const base = { id: input.id, priority: input.priority, operation: input.operation, geometry: g };
  switch (g.type) {
    case 'ellipse': {
      const { c, s } = trig(g.rotationDeg ?? 0);
      const [cx, cy] = g.center;
      const a2 = g.radii[0] * g.radii[0];
      const b2 = g.radii[1] * g.radii[1];
      const containsXY = (x: number, y: number): boolean => {
        const dx = x - cx;
        const dy = y - cy;
        const lx = c * dx + s * dy;
        const ly = c * dy - s * dx;
        return (lx * lx) / a2 + (ly * ly) / b2 <= 1;
      };
      const outline = (step: number): Pt2[] => {
        const ring: Pt2[] = [];
        for (let j = 0; j < ELLIPSE_OUTLINE_SAMPLES; j++) {
          const t = trig((360 * j) / ELLIPSE_OUTLINE_SAMPLES);
          const lx = g.radii[0] * t.c;
          const ly = g.radii[1] * t.s;
          ring.push([cx + c * lx - s * ly, cy + s * lx + c * ly]);
        }
        return resampleClosed(ring, step);
      };
      return { ...base, bbox: ellipseBox(g.center, g.radii, g.rotationDeg ?? 0),
        containsXY, contains: (p) => containsXY(p[0], p[1]), outline };
    }
    case 'polygon':
    case 'path': {
      const ring = g.type === 'polygon' ? g.points.map((p): Pt2 => [p[0], p[1]])
        : flattenCubic(g.points, PATH_SAMPLES_PER_SEGMENT);
      const containsXY = (x: number, y: number): boolean => insideEvenOdd(ring, x, y);
      const outline = (step: number): Pt2[] =>
        resampleClosed(g.type === 'polygon' ? ring : flattenCubic(g.points, ARC_TABLE_SAMPLES), step);
      return { ...base, bbox: boxOf(ring), ring, containsXY, contains: (p) => containsXY(p[0], p[1]), outline };
    }
    case 'stroke': {
      const line = flattenCubic(g.points, STROKE_SAMPLES_PER_SEGMENT);
      const r = g.width / 2;
      const r2 = r * r;
      const containsXY = (x: number, y: number): boolean => {
        for (let i = 0; i + 1 < line.length; i++) if (segDist2(x, y, line[i], line[i + 1]) <= r2) return true;
        return false;
      };
      return { ...base, bbox: boxOf(line, r), centreline: line, containsXY,
        contains: (p) => containsXY(p[0], p[1]), outline: (step) => resampleClosed(strokeLoop(line, r), step) };
    }
  }
}

function inBox(b: Box2, x: number, y: number): boolean {
  return x >= b.min[0] - CULL_MARGIN && x <= b.max[0] + CULL_MARGIN &&
    y >= b.min[1] - CULL_MARGIN && y <= b.max[1] + CULL_MARGIN;
}

/**
 * Normalise the parts (spec §7.2 step 2), apply V10 thickening, and build the region. Throws a
 * RangeError on input a V3–V6-valid scene cannot produce (no union part, a malformed chain, a
 * non-finite number); the compiler turns that into a typed rejection (spec §7.11).
 */
export function buildRegion(inputs: readonly PartInput2D[]): Region2D {
  if (!Array.isArray(inputs)) throw new RangeError('buildRegion: parts must be an array');
  for (const p of inputs) {
    if (p.operation !== 'union' && p.operation !== 'subtract') {
      throw new RangeError(`buildRegion: part ${p.id} has an unknown operation`);
    }
    checkGeometry(p.geometry, p.id);
  }
  const unions = inputs.filter((p) => p.operation === 'union');
  if (unions.length === 0) throw new RangeError('buildRegion: a 2D scene needs at least one union part');

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of unions) {
    const b = sceneBox(p.geometry);
    if (b.min[0] < x0) x0 = b.min[0];
    if (b.min[1] < y0) y0 = b.min[1];
    if (b.max[0] > x1) x1 = b.max[0];
    if (b.max[1] > y1) y1 = b.max[1];
  }
  const side = Math.max(x1 - x0, y1 - y0);
  if (!(side > 0) || !Number.isFinite(side)) throw new RangeError('buildRegion: the union box has no extent');
  const scale = (2 * NORMALISED_HALF_EXTENT) / side;
  const centre: Pt2 = [(x0 + x1) / 2, (y0 + y1) / 2];
  const map = (p: Pt2): Pt2 => [(p[0] - centre[0]) * scale, (p[1] - centre[1]) * scale];

  const warnings: ShapeWarning[] = [];
  const thicken = (id: string, what: string, v: number, min: number): number => {
    if (v < min) {
      warnings.push({ code: 'thickened', partId: id,
        detail: `${what} ${v} is below the mask minimum ${min} (normalised) and was raised to it` });
      return min;
    }
    if (v < 2 * min) {
      warnings.push({ code: 'thin-feature', partId: id, detail: `${what} ${v} is below twice the minimum ${min} (normalised)` });
    }
    return v;
  };

  const normalised = (p: PartInput2D): Geom2D => {
    const g = p.geometry;
    switch (g.type) {
      case 'ellipse':
        return { type: 'ellipse', center: map(g.center), rotationDeg: g.rotationDeg ?? 0,
          radii: [thicken(p.id, 'radius', g.radii[0] * scale, MIN_RADIUS),
            thicken(p.id, 'radius', g.radii[1] * scale, MIN_RADIUS)] };
      case 'polygon': return { type: 'polygon', points: g.points.map(map) };
      case 'path': return { type: 'path', points: g.points.map(map) };
      case 'stroke':
        return { type: 'stroke', points: g.points.map(map),
          width: thicken(p.id, 'stroke width', g.width * scale, MIN_STROKE_WIDTH) };
    }
  };
  const parts = inputs.map((p): Part2D => makePart(p, normalised(p)));

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of parts) {
    if (p.operation !== 'union') continue;
    if (p.bbox.min[0] < bx0) bx0 = p.bbox.min[0];
    if (p.bbox.min[1] < by0) by0 = p.bbox.min[1];
    if (p.bbox.max[0] > bx1) bx1 = p.bbox.max[0];
    if (p.bbox.max[1] > by1) by1 = p.bbox.max[1];
  }

  const contains = (q: Pt2): boolean => {
    // The last part containing the point decides, which is the same as applying parts in array order.
    for (let k = parts.length - 1; k >= 0; k--) {
      const part = parts[k];
      if (inBox(part.bbox, q[0], q[1]) && part.containsXY(q[0], q[1])) return part.operation === 'union';
    }
    return false;
  };

  return { parts, contains, bbox: { min: [bx0, by0], max: [bx1, by1] }, normalise: { scale, centre }, warnings };
}

/**
 * Adapter from a (canonical, V3-valid) GF-WP-01 `SceneSpec2D` to the region: the only place this
 * module reads the scene types. `Shape2D` and `Geometry2D` (types.ts) match the local input types
 * field for field.
 */
export function buildRegion2D(scene: SceneSpec2D): Region2D {
  return buildRegion(scene.parts.map((s) => ({ id: s.id, operation: s.operation, priority: s.priority, geometry: s.geometry })));
}

// ---------------------------------------------------------------- mask

export function cellCentre(mask: Pick<Mask2D, 'cell' | 'origin'>, i: number, j: number): Pt2 {
  return [mask.origin[0] + (i + 0.5) * mask.cell, mask.origin[1] + (j + 0.5) * mask.cell];
}

/** Cells whose centres can fall in [lo, hi], widened by one cell so culling never changes a result. */
function cellRange(lo: number, hi: number, o: number, cell: number, size: number): [number, number] {
  return [Math.max(0, Math.floor((lo - o) / cell - 0.5) - 1), Math.min(size - 1, Math.ceil((hi - o) / cell - 0.5) + 1)];
}

/** Consecutive centreline segments grouped for culling in `rasteriseStroke`. */
const STROKE_CHUNK = 16;
/** Safety margin of the chunk bound, far above float error in normalised units (all of order 1). */
const CHUNK_MARGIN = 1e-9;

/**
 * Fill a stroke's cells: each cell in the part's range is tested once, so the cost never grows with
 * how much segment boxes overlap (a short, wide stroke used to cost segments × cells). Two culls, both
 * conservative by r + margin, so the bits are exactly `containsXY`'s (any segment with segDist2 <= r²):
 * - a chunk of segments is skipped when the cell is farther than r + margin from its bounding circle;
 * - inside a kept chunk, a segment is skipped when the cell lies outside the segment's own box grown by
 *   r + margin. A point outside that box is more than r + margin from every point of the segment.
 *   The chunk circle alone kept every segment of a long, wide-swinging stroke whose chunks overlap
 *   most of the mask, which cost about 12–21M segDist2 calls per stroke (#238 review, estimated).
 */
function rasteriseStroke(
  line: readonly Pt2[], r: number, v: number, bits: Uint8Array, size: number,
  i0: number, i1: number, j0: number, j1: number, cx: (i: number) => number, cy: (j: number) => number,
): void {
  const r2 = r * r;
  // Per-segment boxes, grown by r + margin: [minX, minY, maxX, maxY] for segment e at 4e.
  const grow = r + CHUNK_MARGIN;
  const segBox = new Float64Array(4 * Math.max(0, line.length - 1));
  for (let e = 0; e + 1 < line.length; e++) {
    const a = line[e];
    const b = line[e + 1];
    segBox[4 * e] = Math.min(a[0], b[0]) - grow;
    segBox[4 * e + 1] = Math.min(a[1], b[1]) - grow;
    segBox[4 * e + 2] = Math.max(a[0], b[0]) + grow;
    segBox[4 * e + 3] = Math.max(a[1], b[1]) + grow;
  }
  const chunks: { first: number; last: number; x: number; y: number; reach2: number }[] = [];
  for (let s = 0; s + 1 < line.length; s += STROKE_CHUNK) {
    const last = Math.min(line.length - 1, s + STROKE_CHUNK);
    const box = boxOf(line.slice(s, last + 1));
    const x = (box.min[0] + box.max[0]) / 2;
    const y = (box.min[1] + box.max[1]) / 2;
    let rho = 0;
    for (let k = s; k <= last; k++) {
      const dx = line[k][0] - x;
      const dy = line[k][1] - y;
      rho = Math.max(rho, Math.sqrt(dx * dx + dy * dy));
    }
    const reach = rho + r + CHUNK_MARGIN;
    chunks.push({ first: s, last, x, y, reach2: reach * reach });
  }
  for (let j = j0; j <= j1; j++) {
    const y = cy(j);
    for (let i = i0; i <= i1; i++) {
      const x = cx(i);
      let inside = false;
      for (const c of chunks) {
        const dx = x - c.x;
        const dy = y - c.y;
        if (dx * dx + dy * dy > c.reach2) continue;
        for (let e = c.first; e < c.last; e++) {
          const o = 4 * e;
          if (x < segBox[o] || y < segBox[o + 1] || x > segBox[o + 2] || y > segBox[o + 3]) continue;
          if (segDist2(x, y, line[e], line[e + 1]) <= r2) { inside = true; break; }
        }
        if (inside) break;
      }
      if (inside) bits[j * size + i] = v;
    }
  }
}

/**
 * Rasterise the region on a size² grid over [-1.2, 1.2]² of normalised space (spec §7.2 step 2).
 * A cell is filled when its centre is inside the region: bit-for-bit what `region.contains` gives at
 * `cellCentre`. Parts apply in array order with bounding-box culling; polygons and paths are filled by
 * scanline with the same crossing arithmetic as the point test.
 */
export function rasterise(region: Region2D, size: number = MASK_SIZE): Mask2D {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`rasterise: size must be a positive integer, got ${size}`);
  const cell = (2 * MASK_HALF_EXTENT) / size;
  const ox = -MASK_HALF_EXTENT;
  const oy = -MASK_HALF_EXTENT;
  const bits = new Uint8Array(size * size);
  const cx = (i: number): number => ox + (i + 0.5) * cell;
  const cy = (j: number): number => oy + (j + 0.5) * cell;

  for (const part of region.parts) {
    const v = part.operation === 'union' ? 1 : 0;
    const [i0, i1] = cellRange(part.bbox.min[0], part.bbox.max[0], ox, cell, size);
    const [j0, j1] = cellRange(part.bbox.min[1], part.bbox.max[1], oy, cell, size);
    if (i0 > i1 || j0 > j1) continue;
    const g = part.geometry;
    if (g.type === 'ellipse') {
      for (let j = j0; j <= j1; j++) {
        const y = cy(j);
        for (let i = i0; i <= i1; i++) if (part.containsXY(cx(i), y)) bits[j * size + i] = v;
      }
    } else if (part.ring) {
      const ring = part.ring;
      const xs: number[] = [];
      for (let j = j0; j <= j1; j++) {
        const y = cy(j);
        xs.length = 0;
        for (let e = 0, f = ring.length - 1; e < ring.length; f = e++) {
          const a = ring[f];
          const b = ring[e];
          if ((a[1] > y) !== (b[1] > y)) xs.push(crossX(a[0], a[1], b[0], b[1], y));
        }
        if (xs.length === 0) continue;
        xs.sort((p, q) => p - q);
        // Inside iff an odd number of crossings lie strictly right of the cell centre (as insideEvenOdd).
        let k = 0;
        for (let i = i0; i <= i1; i++) {
          const x = cx(i);
          while (k < xs.length && xs[k] <= x) k++;
          if ((xs.length - k) % 2 === 1) bits[j * size + i] = v;
        }
      }
    } else if (part.centreline && g.type === 'stroke') {
      rasteriseStroke(part.centreline, g.width / 2, v, bits, size, i0, i1, j0, j1, cx, cy);
    }
  }
  return { size, cell, origin: [ox, oy], bits,
    normalise: { scale: region.normalise.scale, centre: [region.normalise.centre[0], region.normalise.centre[1]] } };
}

/** Filled area of the mask in normalised units². Divide by `normalise.scale²` for scene units². */
export function filledArea(mask: Mask2D): number {
  let n = 0;
  for (let k = 0; k < mask.bits.length; k++) n += mask.bits[k];
  return n * mask.cell * mask.cell;
}

/** 4-connected components of the filled cells (spec §7.2 step 3), labelled in row-major scan order. */
export function components(mask: Mask2D): Components {
  const n = mask.size;
  const { bits } = mask;
  const labels = new Int32Array(n * n);
  const queue = new Int32Array(n * n);
  const sizes: number[] = [];
  let total = 0;
  for (let start = 0; start < n * n; start++) {
    if (!bits[start] || labels[start]) continue;
    const label = sizes.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const c = queue[head++];
      const x = c % n;
      const visit = (q: number): void => {
        if (bits[q] && !labels[q]) { labels[q] = label; queue[tail++] = q; }
      };
      if (x > 0) visit(c - 1);
      if (x < n - 1) visit(c + 1);
      if (c >= n) visit(c - n);
      if (c < n * n - n) visit(c + n);
    }
    sizes.push(tail);
    total += tail;
  }
  let largest = 0;
  for (const s of sizes) if (s > largest) largest = s;
  return { count: sizes.length, largestShare: total > 0 ? largest / total : 0, labels, sizes };
}

/** Index of the part that decides the cell (the last part in array order containing it), or -1. */
function ownerOf(region: Region2D, x: number, y: number): number {
  for (let k = region.parts.length - 1; k >= 0; k--) {
    const part = region.parts[k];
    if (inBox(part.bbox, x, y) && part.containsXY(x, y)) return k;
  }
  return -1;
}

/**
 * V8 for a mask rasterised from `region` (spec §6.5, §7.11 simplification 1). An empty mask is the
 * rejection `empty-geometry`. Components under SPECK_SHARE of the filled cells are dropped
 * (`speck-dropped`, naming the part that decides most of its cells), except one that any protected
 * union part (priority >= 4) covers, even partly or under a later part: that speck is kept and warned
 * with the protected part covering most of it (`speck-kept`). Ties go to the lower part index. More
 * than one remaining component warns `disconnected`. The input mask is not modified.
 */
export function checkConnectivity(mask: Mask2D, region: Region2D): MaskCheck {
  const first = components(mask);
  if (first.count === 0) return { ok: false, code: 'empty-geometry', detail: 'the scene fills no cell of the mask' };
  let total = 0;
  for (const s of first.sizes) total += s;
  const limit = SPECK_SHARE * total;
  const isSpeck = first.sizes.map((s) => s < limit);
  // Per speck: how many of its cells each part decides (`owners`), and how many each protected union
  // part covers (`guards`). A protected part counts even where a later part draws over it: the cell is
  // filled, so the protected part is part of what would be dropped (spec §7.11: never drop a protected
  // part's speck, and never drop a protected part without a warning).
  const owners = new Map<number, Map<number, number>>();
  const guards = new Map<number, Map<number, number>>();
  const bump = (m: Map<number, Map<number, number>>, c: number, k: number): void => {
    let counts = m.get(c);
    if (!counts) { counts = new Map(); m.set(c, counts); }
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  const n = mask.size;
  for (let idx = 0; idx < n * n; idx++) {
    const label = first.labels[idx];
    if (!label || !isSpeck[label - 1]) continue;
    const c = label - 1;
    const [x, y] = cellCentre(mask, idx % n, Math.floor(idx / n));
    const owner = ownerOf(region, x, y);
    if (owner >= 0) bump(owners, c, owner);
    for (let k = 0; k < region.parts.length; k++) {
      const part = region.parts[k];
      if (part.operation === 'union' && part.priority >= PROTECTED_PRIORITY && inBox(part.bbox, x, y) &&
        part.containsXY(x, y)) bump(guards, c, k);
    }
  }
  /** The part with the most cells, ties to the lowest index; -1 when there is none. */
  const most = (counts: Map<number, number> | undefined): number => {
    let best = -1;
    let bestN = 0;
    for (const [k, cnt] of counts ?? []) if (cnt > bestN || (cnt === bestN && k < best)) { best = k; bestN = cnt; }
    return best;
  };

  const warnings: ShapeWarning[] = [];
  const drop = new Uint8Array(first.count);
  let droppedCells = 0;
  for (let c = 0; c < first.count; c++) {
    if (!isSpeck[c]) continue;
    const share = `${first.sizes[c]} of ${total} cells`;
    const guard = most(guards.get(c));
    if (guard >= 0) {
      warnings.push({ code: 'speck-kept', partId: region.parts[guard].id,
        detail: `a speck of a protected part (${share}) is kept` });
    } else {
      drop[c] = 1;
      droppedCells += first.sizes[c];
      const owner = most(owners.get(c));
      warnings.push({ code: 'speck-dropped', ...(owner >= 0 ? { partId: region.parts[owner].id } : {}),
        detail: `a speck (${share}, under ${SPECK_SHARE * 100}%) was dropped` });
    }
  }

  const bits = new Uint8Array(mask.bits);
  if (droppedCells > 0) {
    for (let idx = 0; idx < bits.length; idx++) {
      const label = first.labels[idx];
      if (label && drop[label - 1]) bits[idx] = 0;
    }
  }
  const cleaned: Mask2D = { ...mask, bits, origin: [mask.origin[0], mask.origin[1]],
    normalise: { scale: mask.normalise.scale, centre: [mask.normalise.centre[0], mask.normalise.centre[1]] } };
  const after = droppedCells > 0 ? components(cleaned) : first;
  if (after.count === 0) return { ok: false, code: 'empty-geometry', detail: 'only specks remained, and all were dropped' };
  if (after.count > 1) {
    warnings.push({ code: 'disconnected', detail: `the silhouette has ${after.count} separate components` });
  }
  return { ok: true, mask: cleaned, components: after, warnings, droppedCells };
}
