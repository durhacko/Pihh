// src/score/generated/sample3d.ts
// GF-WP-05 (#211): 3D candidates for the generated-scene compiler (canonical spec §7.3 steps 2-5, §7.7, §7.8).
// Area-weighted surface samples of the original parts (a mirror-x copy receives the exact x-negation of its original's
// samples), union-aware filtering, analytic normals, visibility from the reference view, per-material colour, and the
// dense reference drawn from the exposed surface. Selection itself (Q(p) greedy fill, the rear-side floor, the spacing
// search) is GF-WP-06; this file supplies its inputs and the Q(p) term definitions.
// Pure and deterministic (spec §7.12): imports only src/score and src/contracts; randomness is injected per label.
import type { RGB, Vec3 } from '../../contracts';
import { normalise, type ReferenceView, type Scene3DInput, type Solid3D, type Warning3D } from './shapes3d';

/** ε of spec §7.3 step 3, as a fraction of the normalised extent (spec §7.2 step 2). */
export const HIDDEN_EPSILON = 0.01;
/** Spec §7.2 step 2: the union box's longer side is scaled to span [-1.1, 1.1]. */
export const NORMALISED_HALF_EXTENT = 1.1;
/** Spec §7.3 step 3: a protected part losing more than this share gets `feature-mostly-hidden`. */
export const MOSTLY_HIDDEN = 0.8;
export const PROTECTED_IMPORTANCE = 4;
/** Spec §7.8: the dense reference has about 2,000 points (band 1,500-2,500). */
export const DENSE_TARGET = 2000;
/** Spec §7.3 step 5 (heuristic defaults, tuned by the ladder): Q(p) = αI + βV + γD, D capped at 2. */
export const Q_WEIGHTS = Object.freeze({ alpha: 0.35, beta: 0.35, gamma: 0.3, distanceCap: 2 });
/** Spec §7.3 step 5: at least this share of selected slots with V = 0 (applied by GF-WP-06's selection). */
export const REAR_FLOOR = 0.15;

/** Spec §7.3 step 2: about clamp(20·n0, 2,000, 5,000) surface candidates. */
export function candidateTotal(n0: number): number { return Math.max(2000, Math.min(5000, 20 * n0)); }

/**
 * Unit vector from the formation centre towards the camera (spec §6.1), copied from the CameraRig presets:
 * front (0, −24, 95), three-quarter (55, 15, 75), side (1, 0, 0); audience on +z. Normalised with sqrt only.
 */
export function viewDirection(view: ReferenceView): Vec3 {
  switch (view) {
    case 'front': return normalise([0, -24, 95]);
    case 'three-quarter': return normalise([55, 15, 75]);
    case 'side': return [1, 0, 0];
  }
}

/** William's Candidate3D plus the class fields GF-WP-04's Candidate uses (source 'surface'). Positions normalised. */
export interface Candidate3D {
  pos: Vec3;
  normal: Vec3;
  colour: RGB;
  featureId: string;          // the solid's id (`~m` for a mirror copy)
  importance: number;
  source: 'surface';
  /** V(p) = max(0, n · v_ref) (spec §7.3 step 4); no ray-cast self-occlusion in compiler v1. */
  visibility: number;
  /** Index into the solids array. */
  solid: number;
}

export interface Sample3DOptions {
  n0: number;
  referenceView: ReferenceView;
  /** A fresh seeded stream per label (the compiler passes `label => seededStream(sceneHash, label)`, GF-WP-02). */
  stream: (label: string) => () => number;
}

export interface Sample3DResult {
  candidates: Candidate3D[];
  /** Area-weighted points of the EXPOSED surface (after filtering), normalised; never derived from candidates. */
  dense: Vec3[];
  /** Parallel to `dense`: the solid each point lies on. */
  denseSolid: number[];
  warnings: Warning3D[];
  stats: {
    /** Uniform scale applied to scene units (spec §7.2 step 2). */
    normalise: number;
    /** Normalised = scene · normalise − offset. offset[0] is 0: x = 0 stays the mirror plane (spec §6.1, §6.3). */
    offset: Vec3;
    /** Raw (pre-filter) candidates per solid id. */
    raw: Record<string, number>;
    /** Share of each solid's raw candidates removed as interior (spec §7.1 `hiddenFraction`). */
    hiddenFraction: Record<string, number>;
    /** Estimated exposed surface area in normalised units (Σ area · kept share), the A of spec §7.4 step 1. */
    exposedArea: number;
  };
}

/** Q(p) of spec §7.3 step 5 for one candidate, given D = its distance to the current selection divided by δ. */
export function rankQ(candidate: Pick<Candidate3D, 'importance' | 'visibility'>, distanceOverDelta: number): number {
  const { alpha, beta, gamma, distanceCap } = Q_WEIGHTS;
  return alpha * (candidate.importance / 5) + beta * candidate.visibility + gamma * Math.min(distanceCap, Math.max(0, distanceOverDelta));
}

/** Largest-remainder split of `total` by `weights`, ties to the lower index. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ r: e - Math.floor(e), i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

const insideBox = (p: Vec3, s: Solid3D) =>
  p[0] >= s.box.min[0] && p[0] <= s.box.max[0] && p[1] >= s.box.min[1] && p[1] <= s.box.max[1] && p[2] >= s.box.min[2] && p[2] <= s.box.max[2];

/** True if `p` (scene units) lies more than `eps` inside any solid other than `self` (spec §7.3 step 3, no exceptions). */
function hidden(p: Vec3, self: number, solids: Solid3D[], eps: number): boolean {
  for (let j = 0; j < solids.length; j++) {
    if (j === self || !insideBox(p, solids[j])) continue;
    if (solids[j].insideDepth(p) > eps) return true;
  }
  return false;
}

/**
 * Raw samples per solid: originals are sampled (each from its own stream, so one part's samples do not move when
 * another part changes); a mirror copy gets its original's samples x-negated (spec §7.3 step 2, GF-T15).
 */
function rawSamples(solids: Solid3D[], perOriginal: Map<Solid3D, number>, stream: (label: string) => () => number, label: string) {
  const byOriginal = new Map<Solid3D, { pos: Vec3; normal: Vec3 }[]>();
  for (const solid of solids) if (!solid.mirrorOf) byOriginal.set(solid, solid.surface(perOriginal.get(solid) ?? 0, stream(`${label}:${solid.id}`)));
  return solids.map(solid => {
    if (!solid.mirrorOf) return byOriginal.get(solid)!;
    return byOriginal.get(solid.mirrorOf)!.map(s => ({ pos: [-s.pos[0], s.pos[1], s.pos[2]] as Vec3, normal: [-s.normal[0], s.normal[1], s.normal[2]] as Vec3 }));
  });
}

export function sample3d(scene: Scene3DInput, solids: Solid3D[], opts: Sample3DOptions): Sample3DResult {
  const warnings: Warning3D[] = [];
  const colours = new Map(scene.materials.map(m => [m.id, [m.rgb[0], m.rgb[1], m.rgb[2]] as RGB]));
  // Normalisation (spec §7.2 step 2): the union box's longer side spans 2·1.1. y and z are centred; x is NOT
  // translated, so x = 0 stays the mirror plane and a copy's points stay the exact negation of its original's.
  let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) { min = [Math.min(min[0], s.box.min[0]), Math.min(min[1], s.box.min[1]), Math.min(min[2], s.box.min[2])]; max = [Math.max(max[0], s.box.max[0]), Math.max(max[1], s.box.max[1]), Math.max(max[2], s.box.max[2])]; }
  const side = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const k = side > 0 && Number.isFinite(side) ? (2 * NORMALISED_HALF_EXTENT) / side : 1;
  const offset: Vec3 = [0, ((min[1] + max[1]) / 2) * k, ((min[2] + max[2]) / 2) * k];
  const toUnit = (p: Vec3): Vec3 => [p[0] * k, p[1] * k - offset[1], p[2] * k - offset[2]];
  const eps = HIDDEN_EPSILON / k;                    // ε of the normalised extent, in scene units

  // Candidate budget over original parts by area, a mirrored original's area counted twice; the pair shares it.
  const originals = solids.filter(s => !s.mirrorOf);
  const mirrored = new Set(solids.filter(s => s.mirrorOf).map(s => s.mirrorOf!));
  const budget = apportion(candidateTotal(opts.n0), originals.map(s => s.area() * (mirrored.has(s) ? 2 : 1)));
  const perOriginal = new Map(originals.map((s, i) => [s, mirrored.has(s) ? Math.ceil(budget[i] / 2) : budget[i]]));
  const raw = rawSamples(solids, perOriginal, opts.stream, 'surface');

  const view = viewDirection(opts.referenceView);
  const candidates: Candidate3D[] = [];
  const rawCount: Record<string, number> = {};
  const hiddenFraction: Record<string, number> = {};
  const kept: number[] = [];
  solids.forEach((solid, index) => {
    const colour = colours.get(solid.materialId) ?? [1, 1, 1];
    let keptHere = 0;
    for (const sample of raw[index]) {
      if (hidden(sample.pos, index, solids, eps)) continue;
      keptHere++;
      candidates.push({
        pos: toUnit(sample.pos), normal: sample.normal, colour: [colour[0], colour[1], colour[2]],
        featureId: solid.id, importance: solid.importance, source: 'surface',
        visibility: Math.max(0, sample.normal[0] * view[0] + sample.normal[1] * view[1] + sample.normal[2] * view[2]), solid: index,
      });
    }
    const n = raw[index].length;
    rawCount[solid.id] = n;
    hiddenFraction[solid.id] = n > 0 ? (n - keptHere) / n : 0;
    kept.push(n > 0 ? keptHere / n : 0);
    if (solid.importance >= PROTECTED_IMPORTANCE && n > 0 && hiddenFraction[solid.id] > MOSTLY_HIDDEN) {
      warnings.push({ code: 'feature-mostly-hidden', partId: solid.id, detail: `${Math.round(hiddenFraction[solid.id] * 100)}% of ${solid.id}'s surface lies inside other parts` });
    }
  });

  // Dense (spec §7.8): an area-weighted sample of the exposed surface, from its own streams, filtered like the
  // candidates. Raw draws per original are set so that about DENSE_TARGET survive: Σ area·kept is the exposed area.
  const exposed = solids.reduce((sum, s, i) => sum + s.area() * kept[i], 0);
  const perOriginalDense = new Map(originals.map(s => [s, exposed > 0 ? Math.round((DENSE_TARGET * s.area()) / exposed) : 0]));
  const rawDense = rawSamples(solids, perOriginalDense, opts.stream, 'dense');
  const dense: Vec3[] = [];
  const denseSolid: number[] = [];
  solids.forEach((_, index) => {
    for (const sample of rawDense[index]) {
      if (hidden(sample.pos, index, solids, eps)) continue;
      dense.push(toUnit(sample.pos));
      denseSolid.push(index);
    }
  });

  return { candidates, dense, denseSolid, warnings, stats: { normalise: k, offset, raw: rawCount, hiddenFraction, exposedArea: exposed * k * k } };
}
