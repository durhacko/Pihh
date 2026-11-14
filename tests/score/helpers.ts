// tests/score/helpers.ts
// Small geometry helpers for the score tests, written independently of src/score.
import type { Vec3 } from '../../src/contracts';

export function d2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt(d2(a, b));
}

export function closestPair(points: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) best = Math.min(best, d2(points[i], points[j]));
  }
  return Math.sqrt(best);
}

export function centroid(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length];
}

export function boxOf(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  return { min, max };
}

/** Index of the point nearest the centroid (lowest index on a tie). */
export function nearestToCentroid(points: Vec3[]): number {
  const c = centroid(points);
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    if (d2(points[i], c) < d2(points[first], c)) first = i;
  }
  return first;
}

/** Farthest-point order by brute force: no running minimum, every distance recomputed each round. */
export function bruteFarthestOrder(points: Vec3[], k: number): number[] {
  const order = [nearestToCentroid(points)];
  while (order.length < k) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < points.length; i++) {
      let near = Infinity;
      for (const o of order) near = Math.min(near, d2(points[i], points[o]));
      if (near > bestD) { bestD = near; best = i; }
    }
    order.push(best);
  }
  return order;
}

/** Largest distance from any point of `cloud` to its nearest centre. */
export function coverRadius(cloud: Vec3[], centres: Vec3[]): number {
  let worst = 0;
  for (const p of cloud) {
    let near = Infinity;
    for (const c of centres) near = Math.min(near, d2(p, c));
    worst = Math.max(worst, near);
  }
  return Math.sqrt(worst);
}

/** Seeded PRNG for the tests (mulberry32): returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random k-subset of 0..n-1 (partial Fisher-Yates), from the given stream. */
export function randomSubset(n: number, k: number, rand: () => number): number[] {
  const ids = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (n - i));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  return ids.slice(0, k);
}
