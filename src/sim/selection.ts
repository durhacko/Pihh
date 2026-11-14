import type { Vec3, WorldSnapshot } from '../contracts';
import { distanceSquared } from './math';
import { createRandom } from './random';

export function idsInSphere(snapshot: WorldSnapshot, centre: Vec3, radius: number): number[] {
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid selection radius');
  return snapshot.drones.filter(drone => drone.alive && distanceSquared(drone.pos, centre) <= radius ** 2).map(drone => drone.id).sort((a, b) => a - b);
}

/** Canonicalise caller order, draw without replacement, return explicit stable ids. */
export function randomIds(seed: number, liveIds: number[], count: number): number[] {
  if (!Number.isInteger(count) || count < 0) throw new Error('Selection count must be a nonnegative integer');
  const ids = [...new Set(liveIds)].sort((a, b) => a - b);
  const rng = createRandom(seed);
  const size = Math.min(count, ids.length);
  for (let index = 0; index < size; index++) {
    const swap = index + Math.floor(rng() * (ids.length - index));
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
  }
  return ids.slice(0, size).sort((a, b) => a - b);
}
