// tests/sim/grid.test.ts
// The performance rewrite of SpatialGrid (flat cells over the occupied box, Map fallback for a huge box) must return
// exactly what the plain scan returns: every live id with distanceSquared(pos, q) <= radius^2, in id order, whatever the
// cell size. Checked against a brute-force reference on seeded random positions, including spreads so wide that the
// flat layout falls back to the Map.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/contracts';
import { SpatialGrid } from '../../src/sim/grid';
import { distanceSquared } from '../../src/sim/math';
import { createRandom } from '../../src/sim/random';

function reference(positions: readonly Vec3[], live: readonly number[], pos: Vec3, radius: number): number[] {
  return live.filter((id) => distanceSquared(pos, positions[id]) <= radius * radius).sort((a, b) => a - b);
}

function cloud(seed: number, n: number, spread: number, offset: Vec3 = [0, 0, 0]): Vec3[] {
  const rng = createRandom(seed);
  return Array.from({ length: n }, () => [offset[0] + (rng() - 0.5) * spread, offset[1] + (rng() - 0.5) * spread, offset[2] + (rng() - 0.5) * spread] as Vec3);
}

describe('SpatialGrid.within equals a brute-force scan', () => {
  // The Map fallback walks every cell in a query's range (as the original grid did), so it gets coarse cells only.
  const cases: { name: string; positions: Vec3[]; cellSizes: number[]; radii: number[] }[] = [
    { name: 'a show-sized cloud (flat cells)', positions: cloud(1, 200, 60, [0, 30, 0]), cellSizes: [0.8, 2, 8, 15, 40], radii: [0.4, 0.8, 1.5, 8, 15, 50] },
    { name: 'a tight cluster with many drones per cell', positions: cloud(2, 200, 3), cellSizes: [0.8, 2, 8, 15, 40], radii: [0.4, 0.8, 1.5, 8, 15, 50] },
    { name: 'negative and positive coordinates', positions: cloud(3, 150, 40, [-25, 5, 25]), cellSizes: [0.8, 2, 8, 15, 40], radii: [0.4, 0.8, 1.5, 8, 15, 50] },
    { name: 'a cloud plus far outliers (the Map fallback)', positions: [...cloud(4, 120, 30), [1e7, 0, 0], [-3e6, 4e6, 2e6], [0, 0, -9e6]], cellSizes: [8, 15], radii: [0.8, 8, 15] },
  ];
  for (const { name, positions, cellSizes, radii } of cases) {
    it(name, () => {
      const rng = createRandom(99);
      const live = positions.map((_, id) => id).filter((id) => id % 7 !== 3);   // some dead drones are skipped
      for (const cellSize of cellSizes) {
        const grid = new SpatialGrid(positions, live, cellSize);
        for (let q = 0; q < 60; q++) {
          // Query from live positions, dead positions and arbitrary points, at radii smaller and larger than a cell.
          const pos: Vec3 = q % 3 === 0 ? positions[q % positions.length] : [(rng() - 0.5) * 80, (rng() - 0.5) * 80 + 30, (rng() - 0.5) * 80];
          for (const radius of radii) {
            expect(grid.within(pos, radius), `cell ${cellSize} r ${radius} q ${q}`).toEqual(reference(positions, live, pos, radius));
          }
        }
      }
    });
  }

  it('an empty grid returns nothing', () => {
    expect(new SpatialGrid([[0, 0, 0]], [], 5).within([0, 0, 0], 100)).toEqual([]);
  });

  it('includes a drone exactly at the radius (<=), and its own position at radius 0', () => {
    const positions: Vec3[] = [[0, 0, 0], [3, 4, 0]];
    const grid = new SpatialGrid(positions, [0, 1], 2);
    expect(grid.within([0, 0, 0], 5)).toEqual([0, 1]);
    expect(grid.within([3, 4, 0], 0)).toEqual([1]);
  });
});
