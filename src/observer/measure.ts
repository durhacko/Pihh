import type { Formation, Params, SlotStatus, Vec3, WorldSnapshot } from '../contracts';

export function versionKey(version: { issuedTick: number; origin: number }): string {
  return `${version.issuedTick}:${version.origin}`;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Cell size of the drone grid, in metres. Any value gives the same results; this one is fast at n0 200. */
const CELL = 2;
/** Largest number of cells the flat grid may allocate; a bigger occupied box falls back to scanning every drone. */
const FLAT_MAX_CELLS = 1 << 20;
/** Margin, in metres, by which the nearest search stops conservatively, so rounding can never stop it early. */
const STOP_MARGIN = 1e-6;

/**
 * Live drone positions bucketed in cubes of CELL metres, as a flat array over their bounding box. Performance only:
 * it answers exactly the same questions as a scan over every live drone ("is any drone within r of p?", "what is the
 * smallest distanceSquared from p to a drone?"), computing distanceSquared(p, drone.pos) with the same expression,
 * so the results are bit-identical. The nearest search visits rings of cells around p and stops only when every
 * unvisited drone is provably at least as far away as the best found. build() returns null when the box would be too
 * large: the caller then scans every drone, as before.
 */
class DroneGrid {
  private cells: (Vec3[] | undefined)[] = [];
  private lo = [Infinity, Infinity, Infinity];
  private hi = [-Infinity, -Infinity, -Infinity];
  private dy = 0;
  private dz = 0;

  static build(positions: readonly Vec3[]): DroneGrid | null {
    const grid = new DroneGrid();
    for (const p of positions) {
      for (let a = 0; a < 3; a++) {
        const c = Math.floor(p[a] / CELL);
        grid.lo[a] = Math.min(grid.lo[a], c);
        grid.hi[a] = Math.max(grid.hi[a], c);
      }
    }
    const dx = grid.hi[0] - grid.lo[0] + 1;
    grid.dy = grid.hi[1] - grid.lo[1] + 1;
    grid.dz = grid.hi[2] - grid.lo[2] + 1;
    const total = dx * grid.dy * grid.dz;
    if (!Number.isFinite(total) || total > FLAT_MAX_CELLS) return null;
    grid.cells = new Array(total);
    for (const p of positions) {
      const i = grid.key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL));
      const cell = grid.cells[i];
      if (cell) cell.push(p);
      else grid.cells[i] = [p];
    }
    return grid;
  }

  /** Index of a cell inside the box [lo, hi] (callers clip to the box first). */
  private key(x: number, y: number, z: number): number {
    return ((x - this.lo[0]) * this.dy + (y - this.lo[1])) * this.dz + (z - this.lo[2]);
  }

  /** True iff some drone has distanceSquared(p, drone) <= r2, where r2 = r ** 2. */
  anyWithin(p: Vec3, r: number, r2: number): boolean {
    const lx = Math.max(this.lo[0], Math.floor((p[0] - r) / CELL)), hx = Math.min(this.hi[0], Math.floor((p[0] + r) / CELL));
    const ly = Math.max(this.lo[1], Math.floor((p[1] - r) / CELL)), hy = Math.min(this.hi[1], Math.floor((p[1] + r) / CELL));
    const lz = Math.max(this.lo[2], Math.floor((p[2] - r) / CELL)), hz = Math.min(this.hi[2], Math.floor((p[2] + r) / CELL));
    for (let x = lx; x <= hx; x++) for (let y = ly; y <= hy; y++) for (let z = lz; z <= hz; z++) {
      const cell = this.cells[this.key(x, y, z)];
      if (cell === undefined) continue;
      for (const q of cell) if (distanceSquared(p, q) <= r2) return true;
    }
    return false;
  }

  /** The smallest distanceSquared(p, drone) over all drones (the grid is not empty). */
  nearestSquared(p: Vec3): number {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
    let best = Infinity;
    for (let k = 0; ; k++) {
      for (let x = Math.max(this.lo[0], cx - k); x <= Math.min(this.hi[0], cx + k); x++) {
        const ex = Math.abs(x - cx) === k;
        for (let y = Math.max(this.lo[1], cy - k); y <= Math.min(this.hi[1], cy + k); y++) {
          const edge = ex || Math.abs(y - cy) === k;
          for (let z = Math.max(this.lo[2], cz - k); z <= Math.min(this.hi[2], cz + k); z++) {
            if (!edge && Math.abs(z - cz) !== k) { z = Math.max(z, cz + k - 1); continue; }   // interior: done in an earlier ring
            const cell = this.cells[this.key(x, y, z)];
            if (cell === undefined) continue;
            for (const q of cell) best = Math.min(best, distanceSquared(p, q));
          }
        }
      }
      // Every cell of the occupied box has been visited: best is exact.
      if (cx - k <= this.lo[0] && cx + k >= this.hi[0] && cy - k <= this.lo[1] && cy + k >= this.hi[1] && cz - k <= this.lo[2] && cz + k >= this.hi[2]) return best;
      // An unvisited cell differs from p's cell by at least k + 1 on some axis, so its drones are at least k * CELL away.
      const bound = k * CELL - STOP_MARGIN;
      if (bound > 0 && best <= bound * bound) return best;
    }
  }
}

/** Ground-truth measurements are observer-only; slot ownership is never an occupancy test. */
export function measureFormation(snapshot: WorldSnapshot, formation: Formation, params: Params) {
  const live = snapshot.drones.filter(drone => drone.alive);
  const grid = live.length ? DroneGrid.build(live.map(drone => drone.pos)) : null;
  const owners = new Map<number, number>();
  const versions: Record<string, number> = {};
  for (const drone of live) {
    owners.set(drone.belief.slot, (owners.get(drone.belief.slot) ?? 0) + 1);
    const key = versionKey(drone.belief.version);
    versions[key] = (versions[key] ?? 0) + 1;
  }
  let occupied = 0;
  let pwc = 0;
  const rOccSq = params.rOcc ** 2;
  const status: SlotStatus[] = formation.slots.map(slot => {
    const isOccupied = grid
      ? grid.anyWithin(slot.pos, params.rOcc, rOccSq)
      : live.some(drone => distanceSquared(slot.pos, drone.pos) <= rOccSq);
    if (isOccupied) {
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
    if (grid) nearest = grid.nearestSquared(point);
    else for (const drone of live) nearest = Math.min(nearest, distanceSquared(point, drone.pos));
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
