import type { Vec3 } from '../contracts';
import { distanceSquared } from './math';

/** Rebuilt from pre-decision bodies once per tick. Results always follow id order. */
export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(private positions: readonly Vec3[], live: readonly number[], private cellSize: number) {
    for (const id of live) {
      const p = positions[id];
      const key = this.key(...p.map(v => Math.floor(v / cellSize)) as Vec3);
      const cell = this.cells.get(key);
      if (cell) cell.push(id);
      else this.cells.set(key, [id]);
    }
  }
  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  within(pos: Vec3, radius: number): number[] {
    const low = pos.map(v => Math.floor((v - radius) / this.cellSize));
    const high = pos.map(v => Math.floor((v + radius) / this.cellSize));
    const ids: number[] = [];
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
      for (const id of this.cells.get(this.key(x, y, z)) ?? []) {
        if (distanceSquared(pos, this.positions[id]) <= radius * radius) ids.push(id);
      }
    }
    return ids.sort((a, b) => a - b);
  }
}
