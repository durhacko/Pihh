import type { Vec3 } from '../contracts';

/** Largest number of cells the flat layout may allocate; a bigger occupied box falls back to a Map. */
const FLAT_MAX_CELLS = 1 << 20;

/**
 * Smallest cell size, as a fraction of the largest coordinate magnitude of the live positions: cell indices then stay
 * within ±2^32, far inside the safe-integer range, so `x++` always advances and index arithmetic is exact. Real params
 * never come near it (a 100 m show floors cells at about 2e-8 m).
 */
const MIN_CELL_FRACTION = 2 ** -32;

/**
 * Rebuilt from pre-decision bodies once per tick. Results always follow id order.
 *
 * Performance: the cells are a flat array over the bounding box of the live positions (no hashing, no string keys),
 * and a query only visits cells inside that box. If the box would need more than FLAT_MAX_CELLS cells (drones very
 * far apart) the grid falls back to a Map keyed by "x,y,z", as before. Either way within() returns exactly the ids
 * the simple version returned: the same candidate test as math.ts distanceSquared(pos, q), in the same order, over a
 * superset of the qualifying ids, then sorted. Cell size changes speed only, never the result.
 *
 * Guards (#140). None of them changes a result; they only make every query terminate quickly:
 * - A cell size that is not a positive finite number (e.g. a contact radius of 0 from dCollide = dNear = 0) is
 *   replaced by 1 m; one that is positive but tiny next to the coordinates (1e-20 m) is raised to
 *   MIN_CELL_FRACTION × the largest coordinate magnitude. Either would otherwise give infinite or non-integer cell
 *   indices, and a loop that never ends.
 * - A query range is clamped to the occupied box in both layouts, so a huge or infinite radius visits only occupied
 *   cells. In the Map layout, when the clamped range still has more cells than the Map has entries, the query scans
 *   the entries instead of the range: the work is bounded by the number of live drones whatever the radius.
 * - A negative or NaN radius returns []: no distance is <= a negative radius (as brute force `d <= radius` says).
 */
export class SpatialGrid {
  private lo: [number, number, number] = [0, 0, 0];
  private hi: [number, number, number] = [-1, -1, -1];
  private dims: [number, number, number] = [0, 0, 0];
  private flat: (number[] | undefined)[] | null = null;
  private map: Map<string, number[]> | null = null;
  private empty = true;
  private readonly cellSize: number;

  constructor(private positions: readonly Vec3[], live: readonly number[], requestedCellSize: number) {
    let cellSize = requestedCellSize > 0 && Number.isFinite(requestedCellSize) ? requestedCellSize : 1;
    let extent = 0;
    for (const id of live) {
      const p = positions[id];
      for (let a = 0; a < 3; a++) { const m = Math.abs(p[a]); if (m > extent) extent = m; }
    }
    if (Number.isFinite(extent)) cellSize = Math.max(cellSize, extent * MIN_CELL_FRACTION);
    this.cellSize = cellSize;
    if (live.length === 0) return;
    this.empty = false;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const id of live) {
      const p = positions[id];
      for (let a = 0; a < 3; a++) {
        const c = Math.floor(p[a] / cellSize);
        if (c < lo[a]) lo[a] = c;
        if (c > hi[a]) hi[a] = c;
      }
    }
    this.lo = [lo[0], lo[1], lo[2]];
    this.hi = [hi[0], hi[1], hi[2]];
    const dims: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
    this.dims = dims;
    const total = dims[0] * dims[1] * dims[2];
    if (Number.isFinite(total) && total <= FLAT_MAX_CELLS) {
      const flat: (number[] | undefined)[] = new Array(total);
      for (const id of live) {
        const p = positions[id];
        const i = ((Math.floor(p[0] / cellSize) - lo[0]) * dims[1] + (Math.floor(p[1] / cellSize) - lo[1])) * dims[2] + (Math.floor(p[2] / cellSize) - lo[2]);
        const cell = flat[i];
        if (cell) cell.push(id);
        else flat[i] = [id];
      }
      this.flat = flat;
    } else {
      const map = new Map<string, number[]>();
      for (const id of live) {
        const p = positions[id];
        const key = `${Math.floor(p[0] / cellSize)},${Math.floor(p[1] / cellSize)},${Math.floor(p[2] / cellSize)}`;
        const cell = map.get(key);
        if (cell) cell.push(id);
        else map.set(key, [id]);
      }
      this.map = map;
    }
  }

  within(pos: Vec3, radius: number): number[] {
    const ids: number[] = [];
    if (this.empty || !(radius >= 0)) return ids;   // negative or NaN: nobody is within
    const cs = this.cellSize;
    const px = pos[0], py = pos[1], pz = pos[2];
    const r2 = radius * radius;
    const positions = this.positions;
    const [ox, oy, oz] = this.lo;
    const [ux, uy, uz] = this.hi;
    // Only cells inside the occupied box can hold anyone (this also bounds an infinite radius). When radius^2
    // overflows to Infinity (radius above ~1.3e154), the distance test admits every drone at a finite squared
    // distance, even outside the radius, so the whole box is visited to give exactly what brute force gives.
    const all = r2 === Infinity;
    const lx = all ? ox : Math.max(Math.floor((px - radius) / cs), ox), ly = all ? oy : Math.max(Math.floor((py - radius) / cs), oy), lz = all ? oz : Math.max(Math.floor((pz - radius) / cs), oz);
    const hx = all ? ux : Math.min(Math.floor((px + radius) / cs), ux), hy = all ? uy : Math.min(Math.floor((py + radius) / cs), uy), hz = all ? uz : Math.min(Math.floor((pz + radius) / cs), uz);
    // An empty range on any axis means nobody. Written so that NaN bounds (a NaN query coordinate, which brute force
    // never matches either) also return here: otherwise an outer loop could walk a huge range around an empty inner one.
    if (!(lx <= hx && ly <= hy && lz <= hz)) return ids;
    const flat = this.flat;
    if (flat !== null) {
      const [, dy, dz] = this.dims;
      for (let x = lx; x <= hx; x++) for (let y = ly; y <= hy; y++) {
        const row = ((x - ox) * dy + (y - oy)) * dz - oz;
        for (let z = lz; z <= hz; z++) {
          const cell = flat[row + z];
          if (cell !== undefined) collect(cell, positions, px, py, pz, r2, ids);
        }
      }
    } else {
      const map = this.map as Map<string, number[]>;
      if ((hx - lx + 1) * (hy - ly + 1) * (hz - lz + 1) > map.size) {
        // More cells in range than occupied cells: scan the occupied ones (bounded by the live count).
        for (const cell of map.values()) collect(cell, positions, px, py, pz, r2, ids);
      } else {
        for (let x = lx; x <= hx; x++) for (let y = ly; y <= hy; y++) for (let z = lz; z <= hz; z++) {
          const cell = map.get(`${x},${y},${z}`);
          if (cell !== undefined) collect(cell, positions, px, py, pz, r2, ids);
        }
      }
    }
    return ids.sort((a, b) => a - b);
  }
}

/** Pushes every id in `cell` within r2 of (px, py, pz). */
function collect(cell: readonly number[], positions: readonly Vec3[], px: number, py: number, pz: number, r2: number, ids: number[]): void {
  for (let i = 0; i < cell.length; i++) {
    const id = cell[i];
    const q = positions[id];
    // Same as math.ts distanceSquared(pos, q): (a - b) per axis, squared with **, summed x + y + z.
    if ((px - q[0]) ** 2 + (py - q[1]) ** 2 + (pz - q[2]) ** 2 <= r2) ids.push(id);
  }
}
