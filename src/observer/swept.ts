// src/observer/swept.ts
// P2-WP-08: `collisionsSwept` and `nearMissesSwept` (PHASE2_EVALUATION §3.3), contract §10's closest-approach
// SHOULD, done observer-side with no world change. The world counts contact entries at tick ends (world.ts step 7),
// so two drones that pass through each other between tick ends are never counted there. Here each pair's straight
// per-tick displacement (the world's semi-implicit Euler moves every body by vel·DT in a line) is checked for its
// closest approach inside the tick. Read-only: snapshots in, counts out. Not part of RunRecord.summary.
import type { Params, Vec3, WorldSnapshot } from '../contracts';
import { DT } from '../contracts';
import { launchPos } from '../score';

export interface SweptTick {
  tick: number;
  /** Pairs [i, j], i < j, whose contact (< dCollide) begins inside this tick. */
  collisions: [number, number][];
  /** The same with dNear. */
  nearMisses: [number, number][];
}

export interface SweptCounter {
  /** Feed every snapshot in order, starting at tick 1 (or at any tick: the first one ingested then only primes). */
  ingest(snapshot: WorldSnapshot): SweptTick;
  totals(): { collisionsSwept: number; nearMissesSwept: number };
}

/** Closest-approach squared distance of the segment r(s) = r0 + s·Δ, s ∈ [0, 1]. Never above |r0|² or |r1|². */
export function closestApproachSquared(r0: Vec3, r1: Vec3): number {
  const d: Vec3 = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const r0sq = r0[0] * r0[0] + r0[1] * r0[1] + r0[2] * r0[2];
  const r1sq = r1[0] * r1[0] + r1[1] * r1[1] + r1[2] * r1[2];
  if (dd === 0) return Math.min(r0sq, r1sq);
  const s = Math.min(1, Math.max(0, -(r0[0] * d[0] + r0[1] * d[1] + r0[2] * d[2]) / dd));
  const m: Vec3 = [r0[0] + s * d[0], r0[1] + s * d[1], r0[2] + s * d[2]];
  // Rounding can put the interior point a hair above an endpoint; the true minimum never is (swept ≥ end-of-tick).
  return Math.min(m[0] * m[0] + m[1] * m[1] + m[2] * m[2], r0sq, r1sq);
}

function separationSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function createSweptCounter(params: Params): SweptCounter {
  const dC2 = params.dCollide ** 2;
  const dN2 = params.dNear ** 2;
  // A pair farther apart than this at t − 1 cannot come within dNear during the tick: each body moves ≤ vMax·DT.
  const range = Math.max(params.dCollide, params.dNear) + 2 * params.vMax * DT;
  let previous: { tick: number; pos: (Vec3 | null)[] } | null = null;
  let collisionsSwept = 0;
  let nearMissesSwept = 0;

  return {
    ingest(snapshot) {
      const pos: (Vec3 | null)[] = snapshot.drones.map(d => (d.alive ? [d.pos[0], d.pos[1], d.pos[2]] as Vec3 : null));
      let before: (Vec3 | null)[] | null = null;
      if (previous) {
        if (snapshot.tick !== previous.tick + 1) throw new RangeError(`swept counter: ticks must be consecutive (${previous.tick} then ${snapshot.tick})`);
        before = previous.pos;
      } else if (snapshot.tick === 1) {
        // Positions at tick 0 are the launch pad (world.ts: every body starts at launchPosition = launchPos).
        before = snapshot.drones.map(d => launchPos(d.id, params.n0));
      }
      previous = { tick: snapshot.tick, pos };
      const result: SweptTick = { tick: snapshot.tick, collisions: [], nearMisses: [] };
      if (!before) return result;

      // Grid over start-of-tick positions of drones alive at both ends of the tick.
      const ids: number[] = [];
      for (let id = 0; id < pos.length; id++) if (pos[id] && before[id]) ids.push(id);
      const cells = new Map<string, number[]>();
      const cellOf = (p: Vec3) => [Math.floor(p[0] / range), Math.floor(p[1] / range), Math.floor(p[2] / range)];
      for (const id of ids) {
        const key = cellOf(before[id]!).join(',');
        const cell = cells.get(key);
        if (cell) cell.push(id); else cells.set(key, [id]);
      }
      const range2 = range * range;
      for (const i of ids) {
        const a0 = before[i]!;
        const a1 = pos[i]!;
        const [cx, cy, cz] = cellOf(a0);
        for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
          const cell = cells.get(`${x},${y},${z}`);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b0 = before[j]!;
            if (separationSquared(a0, b0) > range2) continue;
            const b1 = pos[j]!;
            const r0: Vec3 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
            const r1: Vec3 = [b1[0] - a1[0], b1[1] - a1[1], b1[2] - a1[2]];
            const r0sq = separationSquared(a0, b0);
            const min2 = closestApproachSquared(r0, r1);
            if (r0sq >= dC2 && min2 < dC2) result.collisions.push([i, j]);
            if (r0sq >= dN2 && min2 < dN2) result.nearMisses.push([i, j]);
          }
        }
      }
      collisionsSwept += result.collisions.length;
      nearMissesSwept += result.nearMisses.length;
      return result;
    },
    totals() {
      return { collisionsSwept, nearMissesSwept };
    },
  };
}
