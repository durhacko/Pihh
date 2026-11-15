import type { Vec3 } from '../contracts';

/** Largest number of cells the flat layout may allocate; a bigger occupied box falls back to a Map. */
const FLAT_MAX_CELLS = 1 << 20;

/**
 * Rebuilt from pre-decision bodies once per tick. Results always follow id order.
 *
 * Performance: the cells are a flat array over the bounding box of the live positions (no hashing, no string keys),
 * and a query only visits cells inside that box. If the box would need more than FLAT_MAX_CELLS cells (drones very
 * far apart) the grid falls back to a Map keyed by "x,y,z", as before. Either way within() returns exactly the ids
 * the simple version returned: the same candidate test as math.ts distanceSquared(pos, q), in the same order, over a
 * superset of the qualifying ids, then sorted. Cell size changes speed only, never the result.
 *
 * A cell size that is not a positive finite number (e.g. a contact radius of 0 from dCollide = dNear = 0) is replaced
 * by 1 m: it would otherwise make every cell index infinite and within() never terminate. As the result does not
 * depend on the cell size, this changes nothing but termination.
 */
export class SpatialGrid {
  private lo: [number, number, number] = [0, 0, 0];
  private dims: [number, number, number] = [0, 0, 0];
  private flat: (number[] | undefined)[] | null = null;
  private map: Map<string, number[]> | null = null;
  private empty = true;
  private readonly cellSize: number;

  constructor(private positions: readonly Vec3[], live: readonly number[], requestedCellSize: number) {
    const cellSize = requestedCellSize > 0 && Number.isFinite(requestedCellSize) ? requestedCellSize : 1;
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
    const dims: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
    const total = dims[0] * dims[1] * dims[2];
    if (Number.isFinite(total) && total <= FLAT_MAX_CELLS) {
      this.lo = [lo[0], lo[1], lo[2]];
      this.dims = dims;
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
    if (this.empty) return ids;
    const cs = this.cellSize;
    const px = pos[0], py = pos[1], pz = pos[2];
    let lx = Math.floor((px - radius) / cs), ly = Math.floor((py - radius) / cs), lz = Math.floor((pz - radius) / cs);
    let hx = Math.floor((px + radius) / cs), hy = Math.floor((py + radius) / cs), hz = Math.floor((pz + radius) / cs);
    const r2 = radius * radius;
    const positions = this.positions;
    const flat = this.flat;
    const [ox, oy, oz] = this.lo;
    const [, dy, dz] = this.dims;
    if (flat !== null) {
      // Only cells inside the occupied box can hold anyone.
      lx = Math.max(lx, ox); ly = Math.max(ly, oy); lz = Math.max(lz, oz);
      hx = Math.min(hx, ox + this.dims[0] - 1); hy = Math.min(hy, oy + dy - 1); hz = Math.min(hz, oz + dz - 1);
    }
    for (let x = lx; x <= hx; x++) for (let y = ly; y <= hy; y++) {
      const row = ((x - ox) * dy + (y - oy)) * dz - oz;
      for (let z = lz; z <= hz; z++) {
        const cell = flat !== null ? flat[row + z] : (this.map as Map<string, number[]>).get(`${x},${y},${z}`);
        if (cell === undefined) continue;
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          const q = positions[id];
          // Same as math.ts distanceSquared(pos, q): (a - b) per axis, squared with **, summed x + y + z.
          if ((px - q[0]) ** 2 + (py - q[1]) ** 2 + (pz - q[2]) ** 2 <= r2) ids.push(id);
        }
      }
    }
    return ids.sort((a, b) => a - b);
  }
}
