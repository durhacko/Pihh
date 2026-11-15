// src/score/expand.ts
// Recipe -> Formation (contract section 6). Pure and deterministic; results are memoised.
import type { Formation, Params, Recipe, RGB, Slot, Vec3 } from '../contracts';
import { dist2, farthestPointOrder } from './fps';
import { defaultPalette, denseCloud, selectionCloud } from './shapes';

const CANDIDATES_PER_SLOT = 4;
const DENSE_POINTS = 2000;
export const CENTRE: Vec3 = [0, 30, 0];
export const SPACING_MARGIN = 1.001;      // so rounding cannot leave the closest pair below slotSpacingMin
const CACHE_MAX = 64;

// Memo cache of pure results: the only module-level mutable state in this package.
// Oldest entries are dropped beyond CACHE_MAX, which only costs a recomputation.
const cache = new Map<string, Formation>();

function distinct(points: Vec3[]): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const p of points) {
    const key = `${p[0]},${p[1]},${p[2]}`;
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  }
  return out;
}

function boundsOf(groups: Vec3[][]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const points of groups) {
    for (const p of points) {
      for (let a = 0; a < 3; a++) {
        const v = p[a] as number;
        if (v < (min[a] as number)) min[a] = v;
        if (v > (max[a] as number)) max[a] = v;
      }
    }
  }
  return { min, max };
}

export function closestPair(points: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist2(points[i] as Vec3, points[j] as Vec3);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

function build(recipe: Recipe, n0: number, slotSpacingMin: number): Formation {
  if (!Number.isInteger(n0) || n0 < 1) throw new RangeError(`expandRecipe: n0 must be a positive integer, got ${n0}`);
  if (!(slotSpacingMin > 0) || !Number.isFinite(slotSpacingMin)) {
    throw new RangeError(`expandRecipe: slotSpacingMin must be positive, got ${slotSpacingMin}`);
  }

  // 1. Candidate cloud: about 4 * n0 distinct points. Ask for more if the shape gives fewer than n0.
  let wanted = CANDIDATES_PER_SLOT * n0;
  let candidates = distinct(selectionCloud(recipe, n0, wanted));
  for (let attempt = 0; candidates.length < n0; attempt++) {
    if (attempt >= 20) throw new Error(`expandRecipe: could not generate ${n0} distinct candidates`);
    wanted *= 2;
    candidates = distinct(selectionCloud(recipe, n0, wanted));
  }
  const denseUnit = denseCloud(recipe, n0, DENSE_POINTS);

  // 2. Farthest-point order: the slot index is the priority.
  const chosen = farthestPointOrder(candidates, n0).map((i) => candidates[i] as Vec3);

  // 3. Uniform scale about the centre so the closest pair of slots is slotSpacingMin (plus the margin),
  //    then move the centre of the bounds to (0, 30, 0). The dense cloud gets the same transform.
  const scale = n0 > 1 ? (slotSpacingMin * SPACING_MARGIN) / closestPair(chosen) : 1;
  const unit = boundsOf([chosen, denseUnit]);
  const cx = (unit.min[0] + unit.max[0]) / 2;
  const cy = (unit.min[1] + unit.max[1]) / 2;
  const cz = (unit.min[2] + unit.max[2]) / 2;
  const place = (p: Vec3): Vec3 => [
    (p[0] - cx) * scale + CENTRE[0],
    (p[1] - cy) * scale + CENTRE[1],
    (p[2] - cz) * scale + CENTRE[2],
  ];
  const positions = chosen.map(place);
  const dense = denseUnit.map(place);
  const bounds = boundsOf([positions, dense]);

  // 4. Colour: a gradient along x, from palette[0] at the left edge to palette[1] at the right edge.
  const [left, right] = recipe.palette ?? defaultPalette(recipe.kind);
  const width = bounds.max[0] - bounds.min[0];
  const slots: Slot[] = positions.map((pos, index) => {
    const t = width > 0 ? (pos[0] - bounds.min[0]) / width : 0.5;
    const colour: RGB = [
      clamp01(left[0] + (right[0] - left[0]) * t),
      clamp01(left[1] + (right[1] - left[1]) * t),
      clamp01(left[2] + (right[2] - left[2]) * t),
    ];
    return { index, pos, colour };
  });

  return { slots, dense, bounds };
}

// The cached formation is shared by every caller, so it is frozen: a caller that tries to edit it
// gets a TypeError instead of silently corrupting what every drone and the observer see.
export function freeze(f: Formation): Formation {
  for (const s of f.slots) { Object.freeze(s.pos); Object.freeze(s.colour); Object.freeze(s); }
  for (const p of f.dense) Object.freeze(p);
  Object.freeze(f.slots);
  Object.freeze(f.dense);
  Object.freeze(f.bounds.min);
  Object.freeze(f.bounds.max);
  Object.freeze(f.bounds);
  return Object.freeze(f);
}

/**
 * Expand a recipe into exactly `n0` slots in priority order, a dense cloud of the same shape, and bounds.
 * `bounds` covers the slots and the dense cloud. The result depends only on the recipe, `n0` and
 * `params.slotSpacingMin`, and is memoised on those. It is frozen: copy it before changing anything.
 */
export function expandRecipe(recipe: Recipe, n0: number, params: Params): Formation {
  const key = `${JSON.stringify(recipe)}|${n0}|${params.slotSpacingMin}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const formation = freeze(build(recipe, n0, params.slotSpacingMin));
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, formation);
  return formation;
}
