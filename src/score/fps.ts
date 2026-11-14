// src/score/fps.ts
// Step 2 of recipe expansion (contract section 6): farthest-point sampling.
import type { Vec3 } from '../contracts';

export function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Indices of `k` points in farthest-point order. The first is the point nearest the centroid of the
 * cloud; each next one is the point farthest from all points chosen so far. Ties go to the lowest index.
 * Any prefix of the result is therefore an evenly spread version of the whole cloud.
 * The points must be distinct and `k` must not exceed their number.
 */
export function farthestPointOrder(points: readonly Vec3[], k: number): number[] {
  const m = points.length;
  if (k > m) throw new RangeError(`farthestPointOrder: asked for ${k} of ${m} points`);
  if (k <= 0) return [];

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const centroid: Vec3 = [cx / m, cy / m, cz / m];

  let first = 0;
  let firstD = Infinity;
  for (let i = 0; i < m; i++) {
    const d = dist2(points[i] as Vec3, centroid);
    if (d < firstD) { firstD = d; first = i; }
  }

  // nearest[i] = squared distance from point i to the nearest chosen point
  const nearest = new Float64Array(m).fill(Infinity);
  const order = [first];
  let last = first;
  while (order.length < k) {
    const from = points[last] as Vec3;
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < m; i++) {
      const d = dist2(points[i] as Vec3, from);
      const n = d < (nearest[i] as number) ? d : (nearest[i] as number);
      nearest[i] = n;
      if (n > bestD) { bestD = n; best = i; }
    }
    order.push(best);
    last = best;
  }
  return order;
}
