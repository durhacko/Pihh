import type { Formation, Params, SlotStatus, Vec3, WorldSnapshot } from '../contracts';

export function versionKey(version: { issuedTick: number; origin: number }): string {
  return `${version.issuedTick}:${version.origin}`;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Ground-truth measurements are observer-only; slot ownership is never an occupancy test. */
export function measureFormation(snapshot: WorldSnapshot, formation: Formation, params: Params) {
  const live = snapshot.drones.filter(drone => drone.alive);
  const owners = new Map<number, number>();
  const versions: Record<string, number> = {};
  for (const drone of live) {
    owners.set(drone.belief.slot, (owners.get(drone.belief.slot) ?? 0) + 1);
    const key = versionKey(drone.belief.version);
    versions[key] = (versions[key] ?? 0) + 1;
  }
  let occupied = 0;
  let pwc = 0;
  const status: SlotStatus[] = formation.slots.map(slot => {
    if (live.some(drone => distanceSquared(slot.pos, drone.pos) <= params.rOcc ** 2)) {
      occupied++;
      pwc += 2 * (params.n0 - slot.index) / (params.n0 * (params.n0 + 1));
      return 'occupied';
    }
    const count = owners.get(slot.index) ?? 0;
    return count > 1 ? 'contested' : count === 1 ? 'inTransit' : 'vacant';
  });
  const capacity = live.length * (2 * params.n0 - live.length + 1) / (params.n0 * (params.n0 + 1));
  let sumDistance = 0;
  let maxDistance = 0;
  if (live.length) for (const point of formation.dense) {
    let nearest = Infinity;
    for (const drone of live) nearest = Math.min(nearest, distanceSquared(point, drone.pos));
    const distance = Math.sqrt(nearest);
    sumDistance += distance;
    maxDistance = Math.max(maxDistance, distance);
  }
  return {
    alive: live.length, status, coverage: occupied / params.n0,
    pwc, npwc: capacity === 0 ? null : pwc / capacity,
    capacityLoss: 1 - capacity, coordLoss: capacity - pwc,
    // Approved contract #48: no nearest drone means no defined fidelity.
    sfMean: live.length && formation.dense.length ? sumDistance / formation.dense.length : null,
    sfMax: live.length && formation.dense.length ? maxDistance : null,
    dupSlots: [...owners.values()].filter(count => count > 1).length,
    versions,
  };
}
