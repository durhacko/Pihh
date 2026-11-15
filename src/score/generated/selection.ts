// src/score/generated/selection.ts
// GF-WP-06 (#212): shared selection of exactly n0 candidates with closest pair ≥ δ (canonical spec
// docs/integrations/gemini-generated-formations.md §7.4): initial spacing δ₀, protected reservations
// (kMin), the 2D boundary quota on contours, the fill (2D: farthest-point; 3D: greedy Q(p) with the
// rear-side floor, §7.3 step 5), and the one canonical spacing search over δ in three phases.
// Ordering (FPS, §7.5) and placement (§7.6) happen after this.
//
// Everything is in normalised scene units (the longer side of the union box spans [-1.1, 1.1], §7.2
// step 2), so a scene and its half-size copy select alike. Pure and deterministic (§7.12): index-order
// iteration, ties to the lowest index, arithmetic and Math.sqrt only, no randomness, no clock.
import { apportion, REAR_FLOOR, rankQ } from './sample3d';
import type { Vec3 } from './types';

/** §7.4 step 2: a protected part is reserved only if uniform fill would give it fewer than this. */
export const K_MIN = 3;
/** §7.2 step 6: boundary points and protected reservations share one budget of this share of n0. */
export const FEATURE_BUDGET_SHARE = 0.35;
/** §7.4 step 1: δ₀ = 0.9 · √(A / (n0 · 0.866)); 0.866·s² is the area per point of a hexagonal packing. */
export const DELTA_FACTOR = 0.9;
export const HEX_AREA_PER_POINT = 0.866;
/** §7.4 step 5: bisection of δ over [0.35·δ₀, δ₀] for 10 steps. */
export const DELTA_LOW = 0.35;
export const BISECTION_STEPS = 10;

export type CandidateClass = 'boundary' | 'interior' | 'feature' | 'surface';

export interface SelectionCandidate {
  readonly pos: Vec3;
  /** Index into `parts`. */
  readonly part: number;
  readonly source: CandidateClass;
  /** 1..5 (spec §6.2 priority / §6.3 importance). */
  readonly importance: number;
  /** 3D only: V(p) = max(0, n · v_ref) (§7.3 step 4). */
  readonly visibility?: number;
  /** 2D boundary only: arc length from its contour's fixed start (§7.4 step 3). */
  readonly arc?: number;
}

export interface SelectionPart {
  readonly id: string;
  readonly importance: number;
  /** importance ≥ 4 (§6.2, §6.3); in 2D a union part only. */
  readonly protected: boolean;
  /** The part's share of the filled area (2D) or of the exposed surface (3D), Σ over parts = 1. */
  readonly share: number;
  /** 2D only: length of the part's feature line (§7.4 step 2, length_f). */
  readonly featureLength?: number;
}

/** 2D: one contour's boundary candidates are candidates[first … first + count − 1], in arc order (§7.4 step 3). */
export interface SelectionContour { readonly length: number; readonly first: number; readonly count: number }

export interface SelectionInput {
  readonly mode: 'silhouette2d' | 'scene3d';
  readonly candidates: readonly SelectionCandidate[];
  readonly parts: readonly SelectionPart[];
  /** A of §7.4 step 1, in normalised units: filled area (2D) or exposed surface area (3D). */
  readonly area: number;
  readonly n0: number;
  /** 2D only: the contours (outer, holes, components) for the boundary quota. */
  readonly contours?: readonly SelectionContour[];
}

/** The three phases of §7.4 step 5, in order; each later one is a permitted simplification (§7.11 steps 3, 4). */
export type SelectionPhase = 'full' | 'reservations-relaxed' | 'boundary-dropped';

export type SelectionOutcome =
  | {
    ok: true;
    /** Candidate indices in selection order (not yet FPS-ordered). */
    selected: number[];
    delta: number;
    delta0: number;
    phase: SelectionPhase;
    /** Per part: the reservation target served in the successful phase (0 if not reserved). */
    reserved: number[];
    /** Selected slots with V = 0, and the floor that was asked for (3D; 0 in 2D). */
    rear: { selected: number; floor: number };
    /** 2D: the boundary quota q asked for and the boundary slots placed by the quota step, per contour. */
    boundary: { quota: number; perContour: number[]; placed: number[] };
  }
  | { ok: false; code: 'empty-geometry' | 'too-few-candidates' | 'infeasible-count'; detail: string };

/** §7.4 step 1. */
export function initialSpacing(area: number, n0: number): number {
  return DELTA_FACTOR * Math.sqrt(area / (n0 * HEX_AREA_PER_POINT));
}

/**
 * §7.4 step 2: reservation targets per part for one phase. A protected part with n0·share < kMin gets
 * m_f = min(kMin, ⌊length_f / δ⌋ + 1) in 2D; in 3D there is no feature line, so m_f = kMin (spec difference:
 * the points come from the part's own surface candidates). 'reservations-relaxed' and later phases ask one
 * slot each. The shared budget ⌊35%·n0⌋ serves parts in decreasing w_f = importance·share / Σ(importance·share),
 * ties by part index; a part gets its full target or what is left of the budget.
 */
export function reservationTargets(input: SelectionInput, delta: number, phase: SelectionPhase): number[] {
  const { parts, n0 } = input;
  const targets = parts.map(() => 0);
  let budget = Math.floor(FEATURE_BUDGET_SHARE * n0);
  const total = parts.reduce((s, p) => s + p.importance * p.share, 0);
  const order = parts
    .map((p, i) => ({ i, w: total > 0 ? (p.importance * p.share) / total : 0 }))
    .filter(({ i }) => parts[i].protected && n0 * parts[i].share < K_MIN)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const { i } of order) {
    if (budget <= 0) break;
    const part = parts[i];
    const full = input.mode === 'silhouette2d' && part.featureLength !== undefined
      ? Math.min(K_MIN, Math.floor(part.featureLength / delta) + 1) : K_MIN;
    const want = phase === 'full' ? full : 1;
    targets[i] = Math.min(want, budget);
    budget -= targets[i];
  }
  return targets;
}

/**
 * §7.4 step 3, the boundary quota for one δ: q = min(⌊35%·n0⌋ − reserved, ⌊perimeter / δ⌋), split across the
 * contours in proportion to length by largest remainder, ties to the lower contour index. One budget, applied
 * once: `reserved` is the number of reservation slots actually placed.
 */
export function boundaryQuota(contours: readonly SelectionContour[], n0: number, delta: number, reserved: number): { quota: number; perContour: number[] } {
  const perimeter = contours.reduce((s, c) => s + c.length, 0);
  const budget = Math.max(0, Math.floor(FEATURE_BUDGET_SHARE * n0) - reserved);
  const quota = Math.max(0, Math.min(budget, Math.floor(perimeter / delta)));
  return { quota, perContour: apportion(quota, contours.map((c) => c.length)) };
}

interface Run { ok: boolean; selected: number[]; rear: number; boundary: { quota: number; perContour: number[]; placed: number[] } }

/** One selection at a fixed δ and phase. Returns ok only if it reaches exactly n0. */
function runAt(input: SelectionInput, delta: number, phase: SelectionPhase, targets: number[], rearFloor: number): Run {
  const { candidates, n0 } = input;
  const count = candidates.length;
  const nearest2 = new Float64Array(count).fill(Infinity);   // squared distance to the nearest selected point
  const taken = new Uint8Array(count);
  const selected: number[] = [];
  const delta2 = delta * delta;
  const twoD = input.mode === 'silhouette2d';
  let rear = 0;
  const boundary = { quota: 0, perContour: [] as number[], placed: [] as number[] };

  const add = (c: number) => {
    taken[c] = 1;
    selected.push(c);
    if (candidates[c].visibility === 0) rear++;
    const p = candidates[c].pos;
    for (let i = 0; i < count; i++) {
      const q = candidates[i].pos;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const dz = q[2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearest2[i]) nearest2[i] = d2;
    }
  };
  const eligible = (i: number) => taken[i] === 0 && nearest2[i] >= delta2;
  /** The eligible candidate with the highest Q(p) (§7.3 step 5) among those `admit` allows; ties to the lowest index. */
  const bestQ = (admit: (i: number) => boolean): number => {
    let best = -1;
    let bestQ = -Infinity;
    for (let i = 0; i < count; i++) {
      if (!eligible(i) || !admit(i)) continue;
      const d = nearest2[i] === Infinity ? Infinity : Math.sqrt(nearest2[i]) / delta;
      const q = rankQ({ importance: candidates[i].importance, visibility: candidates[i].visibility ?? 0 }, d);
      if (q > bestQ) { bestQ = q; best = i; }
    }
    return best;
  };
  /** 2D farthest-point pick (§7.4 step 4): the eligible candidate farthest from the selection; ties to the lowest index. */
  const farthest = (admit: (i: number) => boolean): number => {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < count; i++) {
      if (!eligible(i) || !admit(i)) continue;
      if (nearest2[i] > bestD) { bestD = nearest2[i]; best = i; }
    }
    return best;
  };

  // §7.4 step 2: reservations first, served in w_f order (reservationTargets already capped them to the budget).
  // 3D: greedy Q on the part's own candidates; 2D: farthest-point along the part's feature candidates.
  const serve = targets.map((t, i) => ({ i, t })).filter(({ t }) => t > 0)
    .sort((a, b) => {
      const pa = input.parts[a.i];
      const pb = input.parts[b.i];
      return pb.importance * pb.share - pa.importance * pa.share || a.i - b.i;
    });
  for (const { i: part, t } of serve) {
    for (let k = 0; k < t && selected.length < n0; k++) {
      const c = twoD
        ? farthest((j) => candidates[j].part === part && candidates[j].source === 'feature')
        : bestQ((j) => candidates[j].part === part);
      if (c < 0) break;              // the part ends below its target; the compiler reports feature-starved
      add(c);
    }
  }

  if (twoD) {
    // §7.4 step 3: the boundary quota, at arc steps L_c / q_c from each contour's fixed start; a position is taken
    // only if it is ≥ δ from everything selected, otherwise the next candidate in arc order is tried.
    const contours = input.contours ?? [];
    if (phase !== 'boundary-dropped' && contours.length > 0) {
      const quota = boundaryQuota(contours, n0, delta, selected.length);
      boundary.quota = quota.quota;
      boundary.perContour = quota.perContour;
      contours.forEach((contour, ci) => {
        const q = quota.perContour[ci];
        let placed = 0;
        let cursor = contour.first;
        const end = contour.first + contour.count;
        for (let j = 0; j < q && selected.length < n0; j++) {
          const target = (j * contour.length) / q;
          while (cursor < end && (candidates[cursor].arc ?? 0) < target) cursor++;
          let c = cursor;
          while (c < end && !eligible(c)) c++;
          if (c >= end) break;
          add(c);
          placed++;
          cursor = c + 1;
        }
        boundary.placed.push(placed);
      });
    }
    // §7.4 step 4, 2D: farthest-point selection over the remaining candidates, seeded with the points chosen.
    while (selected.length < n0) {
      const c = farthest(() => true);
      if (c < 0) return { ok: false, selected, rear, boundary };
      add(c);
    }
    return { ok: true, selected, rear, boundary };
  }

  // §7.4 step 4, 3D: greedy Q(p) with the rear-side floor. Rear (V = 0) picks are interleaved: the next pick must be
  // a rear one while the rear count is below ⌊floor share · (picks + 1)⌋, or when the slots left are no more than the
  // rear deficit. If no V = 0 candidate is eligible then, any candidate is (the floor is a heuristic, §7.9; the
  // compiler warns rear-floor-unmet).
  while (selected.length < n0) {
    const deficit = rearFloor - rear;
    const behind = rear < Math.floor(REAR_FLOOR * (selected.length + 1));
    let c = -1;
    if (deficit > 0 && (behind || n0 - selected.length <= deficit)) c = bestQ((j) => candidates[j].visibility === 0);
    if (c < 0) c = bestQ(() => true);
    if (c < 0) return { ok: false, selected, rear, boundary };
    add(c);
  }
  return { ok: true, selected, rear, boundary };
}

/**
 * §7.4 step 5, the one canonical spacing search (a heuristic that assumes feasibility is monotone in δ). Per phase:
 * test 0.35·δ₀ first; if it fails the phase fails. Otherwise bisect over [0.35·δ₀, δ₀] for 10 steps and keep the
 * largest tested δ that reaches n0. Phases in order: full quotas, reservations relaxed to one slot each, boundary
 * quota zero (2D only; in 3D there is no boundary quota, so that phase would repeat the second and is skipped).
 * No phase: infeasible-count.
 */
export function selectSlots(input: SelectionInput): SelectionOutcome {
  const { candidates, n0, area } = input;
  if (candidates.length === 0 || !(area > 0)) {
    return { ok: false, code: 'empty-geometry', detail: `no candidates or no area (candidates ${candidates.length}, area ${area})` };
  }
  if (candidates.length < n0) {
    return { ok: false, code: 'too-few-candidates', detail: `${candidates.length} candidates for ${n0} slots` };
  }
  const twoD = input.mode === 'silhouette2d';
  const delta0 = initialSpacing(area, n0);
  const rearFloor = twoD ? 0 : Math.ceil(REAR_FLOOR * n0);
  const phases: SelectionPhase[] = twoD ? ['full', 'reservations-relaxed', 'boundary-dropped'] : ['full', 'reservations-relaxed'];
  for (const phase of phases) {
    const lo = DELTA_LOW * delta0;
    const attempt = (delta: number) => {
      const targets = reservationTargets(input, delta, phase);
      return { run: runAt(input, delta, phase, targets, rearFloor), targets };
    };
    let best = attempt(lo);
    if (!best.run.ok) continue;
    let bestDelta = lo;
    let l = lo;
    let h = delta0;
    for (let step = 0; step < BISECTION_STEPS; step++) {
      const mid = (l + h) / 2;
      const tried = attempt(mid);
      if (tried.run.ok) { best = tried; bestDelta = mid; l = mid; } else h = mid;
    }
    return {
      ok: true, selected: best.run.selected, delta: bestDelta, delta0, phase, reserved: best.targets,
      rear: { selected: best.run.rear, floor: rearFloor }, boundary: best.run.boundary,
    };
  }
  return { ok: false, code: 'infeasible-count', detail: `no spacing in [${DELTA_LOW}·δ₀, δ₀] reaches ${n0} slots (δ₀ = ${delta0})` };
}
