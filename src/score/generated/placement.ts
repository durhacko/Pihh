// src/score/generated/placement.ts
// GF-WP-06 (#212): placement P1 (canonical spec docs/integrations/gemini-generated-formations.md §7.6),
// the same transform as expandRecipe step 3 (src/score/expand.ts, whose pieces are reused, not copied):
// uniform scale so the closest pair of slots is slotSpacingMin·1.001, then the centre of the bounds of
// slots ∪ dense moves to (0, 30, 0). William's caps are validation limits on the result, never clamps.
// Pure and deterministic (§7.12): arithmetic and Math.sqrt only.
import { boundsOf, CENTRE, closestPair, SPACING_MARGIN } from '../expand';
import type { Vec3 } from './types';

/** §7.6 table: William's proposed caps (warnings) and the hard limits (rejections), metres. */
export const WIDTH_CAP = 40;
export const HEIGHT_CAP = 25;
export const ALTITUDE_CAP = 5;
export const FLOOR = 2;              // contract §6 design rule
export const WORLD_LIMIT = 120;      // GF-D5 proposed hard limit on any extent

export interface Box { min: Vec3; max: Vec3 }

export interface Placed {
  slots: Vec3[];
  dense: Vec3[];
  bounds: Box;
  /** Metres per normalised unit (stats.scale). */
  scale: number;
  /** World extent of bounds (stats.size). */
  size: Vec3;
  /** World closest pair of slots (stats.closestPair). */
  closestPair: number;
}

export interface PlacementWarning { code: string; detail: string }

export type PlacementCheck =
  | { ok: true; warnings: PlacementWarning[] }
  | { ok: false; code: 'below-floor' | 'too-large-world'; detail: string; warnings: PlacementWarning[] };

/** §7.6 steps 2–3 on FPS-ordered unit-space slots and the unit-space dense cloud (expand.ts step 3, its own helpers). */
export function placeP1(slotsUnit: readonly Vec3[], denseUnit: readonly Vec3[], slotSpacingMin: number): Placed {
  const scale = slotsUnit.length > 1 ? (slotSpacingMin * SPACING_MARGIN) / closestPair(slotsUnit as Vec3[]) : 1;
  const unit = boundsOf([slotsUnit as Vec3[], denseUnit as Vec3[]]);
  const cx = (unit.min[0] + unit.max[0]) / 2;
  const cy = (unit.min[1] + unit.max[1]) / 2;
  const cz = (unit.min[2] + unit.max[2]) / 2;
  const place = (p: Vec3): Vec3 => [
    (p[0] - cx) * scale + CENTRE[0],
    (p[1] - cy) * scale + CENTRE[1],
    (p[2] - cz) * scale + CENTRE[2],
  ];
  const slots = slotsUnit.map(place);
  const dense = denseUnit.map(place);
  const bounds = boundsOf([slots, dense]);
  const size: Vec3 = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  return { slots, dense, bounds, scale, size, closestPair: slots.length > 1 ? closestPair(slots) : Infinity };
}

/** §7.6 table. Rejections: any extent > 120 m (`too-large-world`), then bounds.min.y < 2 m (`below-floor`). */
export function checkPlacement(p: Placed): PlacementCheck {
  const warnings: PlacementWarning[] = [];
  const m = (v: number) => `${Math.round(v * 10) / 10} m`;
  if (p.size[0] > WIDTH_CAP) warnings.push({ code: 'wider-than-proposed-cap', detail: `width ${m(p.size[0])} exceeds William's proposed ${WIDTH_CAP} m (a warning, never a clamp)` });
  if (p.size[1] > HEIGHT_CAP) warnings.push({ code: 'taller-than-proposed-cap', detail: `height ${m(p.size[1])} exceeds William's proposed ${HEIGHT_CAP} m (a warning, never a clamp)` });
  if (p.bounds.min[1] < ALTITUDE_CAP) warnings.push({ code: 'lower-than-proposed-altitude', detail: `lowest point ${m(p.bounds.min[1])} is below William's proposed ${ALTITUDE_CAP} m` });
  const extent = Math.max(p.size[0], p.size[1], p.size[2]);
  if (extent > WORLD_LIMIT) return { ok: false, code: 'too-large-world', detail: `extent ${m(extent)} exceeds the ${WORLD_LIMIT} m limit`, warnings };
  if (p.bounds.min[1] < FLOOR) return { ok: false, code: 'below-floor', detail: `lowest point ${m(p.bounds.min[1])} is below the ${FLOOR} m floor`, warnings };
  return { ok: true, warnings };
}
