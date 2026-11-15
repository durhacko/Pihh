import type { Sensed, Vec3 } from '../contracts';
import { lengthSquared, subtract } from './math';

interface Kinematics { readonly pos: Vec3; readonly vel: Vec3 }

/** Ties on distance are rare; break them on the entry's own values, never on where it came from. */
function tieBreak(a: Sensed, b: Sensed): number {
  return a.rel[0] - b.rel[0] || a.rel[1] - b.rel[1] || a.rel[2] - b.rel[2]
    || a.vel[0] - b.vel[0] || a.vel[1] - b.vel[1] || a.vel[2] - b.vel[2];
}

/**
 * What a drone at `own` senses of `peers` (already filtered to live drones within rSense, self excluded).
 * Sensing is anonymous: entries carry no id, and their order must not carry one either. Entries are
 * sorted by distance, then relative position x, y, z, then relative velocity x, y, z. That is a total
 * order on the entry values, so it does not depend on the order (the ids) in which peers are passed:
 * two drones that swap ids but keep their positions and velocities give an identical list.
 */
export function senseFrom(own: Kinematics, peers: readonly Kinematics[]): Sensed[] {
  const entries: Sensed[] = new Array(peers.length);
  const d2 = new Float64Array(peers.length);
  const order: number[] = new Array(peers.length);
  for (let i = 0; i < peers.length; i++) {
    const rel = subtract(peers[i].pos, own.pos);
    entries[i] = { rel, vel: subtract(peers[i].vel, own.vel) };
    d2[i] = lengthSquared(rel);
    order[i] = i;
  }
  order.sort((i, j) => d2[i] - d2[j] || tieBreak(entries[i], entries[j]));
  return order.map(i => entries[i]);
}
