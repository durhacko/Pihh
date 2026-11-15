// tests/sim/grid.test.ts
// The performance rewrite of SpatialGrid (flat cells over the occupied box, Map fallback for a huge box) must return
// exactly what the plain scan returns: every live id with distanceSquared(pos, q) <= radius^2, in id order, whatever the
// cell size. Checked against a brute-force reference on seeded random positions, including spreads so wide that the
// flat layout falls back to the Map.
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { AgentBrain, Vec3 } from '../../src/contracts';
import { makeScore } from '../../src/score';
import { createWorld } from '../../src/sim';
import { staticBrain } from '../../src/agent/staticBrain';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { SpatialGrid } from '../../src/sim/grid';
import { distanceSquared } from '../../src/sim/math';
import { createRandom } from '../../src/sim/random';

/** Brute force: every live id at distance <= radius. No distance is <= a negative (or NaN) radius. */
function reference(positions: readonly Vec3[], live: readonly number[], pos: Vec3, radius: number): number[] {
  if (!(radius >= 0)) return [];
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

  it('a cell size of 0, negative, NaN or Infinity still terminates and returns the brute-force ids', () => {
    const positions = cloud(6, 60, 20);
    const live = positions.map((_, id) => id);
    for (const cellSize of [0, -1, Number.NaN, Infinity]) {
      const grid = new SpatialGrid(positions, live, cellSize);
      for (const radius of [0, 0.8, 5]) {
        expect(grid.within(positions[3], radius), `cell ${cellSize} r ${radius}`).toEqual(reference(positions, live, positions[3], radius));
      }
    }
  });
});

describe('SpatialGrid guards (#140): adversarial cell sizes, radii and query points terminate and equal brute force', () => {
  // Before #140 a tiny positive cell size (1e-20 m) made cell indices exceed 2^53, so `x++` stopped advancing in the
  // Map fallback and within() never returned; an infinite radius did the same there; and a tiny negative radius
  // could return a drone sitting exactly on the query point. Each case below has a 10 s timeout, so a stall fails.
  const RADII = [-Infinity, -1e300, -5, -1e-30, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE, 1e-300, 1e-30, 0.8, 15, 1e6, 1e300, Infinity, Number.NaN];
  const show = cloud(11, 120, 60, [0, 30, 0]);
  const outliers: Vec3[] = [...cloud(12, 80, 30), [1e7, 0, 0], [-3e6, 4e6, 2e6], [0, 0, -9e6]];
  const queries = (positions: readonly Vec3[]): Vec3[] => [
    positions[0], positions[5], [0, 30, 0], [-1e9, 1e9, 0], [1e300, -1e300, 1e300], [Infinity, 0, 0], [0, Number.NaN, 0],
  ];
  const check = (positions: readonly Vec3[], cellSizes: readonly number[]) => {
    const live = positions.map((_, id) => id).filter((id) => id % 5 !== 2);
    for (const cellSize of cellSizes) {
      const grid = new SpatialGrid(positions, live, cellSize);
      for (const [q, pos] of queries(positions).entries()) {
        for (const radius of RADII) {
          expect(grid.within(pos, radius), `cell ${cellSize} r ${radius} q ${q}`).toEqual(reference(positions, live, pos, radius));
        }
      }
    }
  };

  it('tiny positive cell sizes (1e-20, 1e-300, Number.MIN_VALUE) on a show-sized cloud', () => {
    check(show, [1e-9, 1e-20, 1e-300, Number.MIN_VALUE]);
  }, 10_000);

  it('tiny positive cell sizes on a cloud with far outliers (the Map fallback)', () => {
    check(outliers, [1e-20, 1e-300, Number.MIN_VALUE]);
  }, 10_000);

  it('real-sized and huge cell sizes, in both layouts', () => {
    check(show, [0.8, 15, 1e6, 1e300]);
    check(outliers, [8, 15, 1e300]);
  }, 10_000);

  it('invalid cell sizes (0, negative, NaN, Infinity) with adversarial radii', () => {
    check(show, [0, -1, Number.NaN, Infinity, -Infinity]);
  }, 10_000);

  it('a negative radius returns [] even with a drone exactly on the query point; -0 counts as 0', () => {
    const positions: Vec3[] = [[1, 2, 3], [1, 2, 3.5]];
    for (const cellSize of [0.5, 1e-20]) {
      const grid = new SpatialGrid(positions, [0, 1], cellSize);
      expect(grid.within([1, 2, 3], -1e-30), `cell ${cellSize}`).toEqual([]);
      expect(grid.within([1, 2, 3], -1), `cell ${cellSize}`).toEqual([]);
      expect(grid.within([1, 2, 3], Number.NaN), `cell ${cellSize}`).toEqual([]);
      expect(grid.within([1, 2, 3], -0), `cell ${cellSize}`).toEqual([0]);
      expect(grid.within([1, 2, 3], 0.5), `cell ${cellSize}`).toEqual([0, 1]);
    }
  });

  it('all drones at the origin (extent 0) with a tiny cell size', () => {
    const positions: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const grid = new SpatialGrid(positions, [0, 1, 2], 1e-300);
    expect(grid.within([0, 0, 0], 0)).toEqual([0, 1, 2]);
    expect(grid.within([0, 0, 0], Infinity)).toEqual([0, 1, 2]);
    expect(grid.within([1, 0, 0], 0.5)).toEqual([]);
  });
});

describe('the world with dCollide = dNear = 0 (contact grid cell size 0; #115 review)', () => {
  // The run must terminate and reproduce a pinned state. With d < 0 never true, there are no collisions and no
  // near-misses. The hashes were first computed on origin/main 571c8e4 (static 0f12949fd481e213, encore
  // 865c98b2951dcbbe), before the per-radius grids. #64 / #82 then passes `sensed` in geometric order instead of id
  // order, which changes the summation order in steer and so the last bits of every trajectory: these are the
  // values with geometric sensing.
  it.each([
    ['static', staticBrain, '7caa1da974548a9d'],
    ['encore', encoreBrain, 'edc2959a73629b7e'],
  ] as const)('%s brain: 20 ticks terminate, no contacts, and the stateHash matches the pinned value', (_name, brain, mainHash) => {
    const params = makeParams(30, { dCollide: 0, dNear: 0 });
    const world = createWorld({ seed: 5, params, score: makeScore([{ kind: 'sphere' }], 30, params), brain: brain as AgentBrain, events: [] });
    let contacts = 0;
    for (let t = 0; t < 20; t++) { const s = world.step(); contacts += s.collisions.length + s.nearMisses.length; }
    expect(contacts).toBe(0);
    expect(world.stateHash()).toBe(mainHash);
  });
});
