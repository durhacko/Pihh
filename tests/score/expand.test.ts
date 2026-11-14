// tests/score/expand.test.ts
// Issue #13 (WP-4a), test T17 and more: expandRecipe turns a recipe into n0 priority-ordered slots.
import { describe, expect, it, vi } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { Recipe, RGB, Vec3 } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { farthestPointOrder } from '../../src/score/fps';
import { defaultPalette, denseCloud, selectionCloud, textLayers } from '../../src/score/shapes';
import { FONT, litCells } from '../../src/score/font';
import {
  boxOf, bruteFarthestOrder, closestPair, coverRadius, d2, dist, mulberry32, nearestToCentroid, randomSubset,
} from './helpers';

const KINDS: { name: string; recipe: Recipe }[] = [
  { name: 'text', recipe: { kind: 'text', text: 'ENCORE' } },
  { name: 'sphere', recipe: { kind: 'sphere' } },
  { name: 'helix', recipe: { kind: 'helix' } },
];
const ROSTERS = [40, 100, 200];
const CASES = KINDS.flatMap((k) => ROSTERS.map((n0) => ({ ...k, n0 })));

const positions = (recipe: Recipe, n0: number): Vec3[] =>
  expandRecipe(recipe, n0, makeParams(n0)).slots.map((s) => s.pos);

describe.each(CASES)('expandRecipe: $name at n0 = $n0', ({ recipe, n0 }) => {
  const params = makeParams(n0);
  const f = expandRecipe(recipe, n0, params);
  const pos = f.slots.map((s) => s.pos);

  it('T17: gives exactly n0 slots, indexed 0..n0-1, at unique positions', () => {
    expect(f.slots).toHaveLength(n0);
    f.slots.forEach((s, i) => expect(s.index).toBe(i));
    expect(new Set(pos.map((p) => p.join(','))).size).toBe(n0);
    for (const p of pos) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });

  it('T17: the closest pair of slots is slotSpacingMin: never below, and within 1%', () => {
    const closest = closestPair(pos);
    expect(closest).toBeGreaterThanOrEqual(params.slotSpacingMin);
    expect(closest).toBeLessThanOrEqual(params.slotSpacingMin * 1.01);
  });

  it('centres the bounds on (0, 30, 0), keeps them above y = 2, and they hold every point', () => {
    const centre = [0, 1, 2].map((a) => (f.bounds.min[a] + f.bounds.max[a]) / 2);
    expect(Math.abs(centre[0])).toBeLessThan(1e-6);
    expect(Math.abs(centre[1] - 30)).toBeLessThan(1e-6);
    expect(Math.abs(centre[2])).toBeLessThan(1e-6);
    expect(f.bounds.min[1]).toBeGreaterThanOrEqual(2);
    const box = boxOf([...pos, ...f.dense]);
    expect(f.bounds.min).toEqual(box.min);
    expect(f.bounds.max).toEqual(box.max);
  });

  it('gives a dense cloud of about 2000 points on the same shape', () => {
    expect(f.dense.length).toBeGreaterThanOrEqual(1500);
    expect(f.dense.length).toBeLessThanOrEqual(2500);
    // every slot lies on the shape: no farther from the dense cloud than one slot spacing
    for (const p of pos) expect(coverRadius([p], f.dense)).toBeLessThan(params.slotSpacingMin);
  });

  it('T17: a second call gives deep-equal output, and so does a fresh module with an empty cache', async () => {
    const again = expandRecipe(recipe, n0, makeParams(n0));
    expect(again).toEqual(f);
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);          // plain JSON data

    vi.resetModules();
    const fresh = await import('../../src/score');
    expect(fresh.expandRecipe).not.toBe(expandRecipe);         // really a new module instance
    const cold = fresh.expandRecipe(recipe, n0, makeParams(n0));
    expect(cold).not.toBe(f);
    expect(cold).toEqual(f);
  });

  it('slot 0 is the candidate nearest the centroid, and the rest follow in farthest-point order', () => {
    // Re-derive the whole expansion from the contract, with brute-force code from the test helpers.
    const candidates = selectionCloud(recipe, n0, 4 * n0);
    expect(new Set(candidates.map((p) => p.join(','))).size).toBe(candidates.length);
    expect(candidates.length).toBeGreaterThanOrEqual(4 * n0);
    const order = bruteFarthestOrder(candidates, n0);
    expect(order[0]).toBe(nearestToCentroid(candidates));
    const chosen = order.map((i) => candidates[i]);
    const scale = (params.slotSpacingMin * 1.001) / closestPair(chosen);
    const box = boxOf([...chosen, ...denseCloud(recipe, n0, 2000)]);
    const centre = [0, 1, 2].map((a) => (box.min[a] + box.max[a]) / 2);
    chosen.forEach((p, i) => {
      expect(pos[i][0]).toBeCloseTo((p[0] - centre[0]) * scale, 9);
      expect(pos[i][1]).toBeCloseTo((p[1] - centre[1]) * scale + 30, 9);
      expect(pos[i][2]).toBeCloseTo((p[2] - centre[2]) * scale, 9);
    });
  });

  it('each new slot is no farther from the earlier ones than the slot before it was', () => {
    let previous = Infinity;
    for (let k = 1; k < n0; k++) {
      let near = Infinity;
      for (let j = 0; j < k; j++) near = Math.min(near, d2(pos[k], pos[j]));
      expect(near).toBeLessThanOrEqual(previous * (1 + 1e-9));
      previous = near;
    }
  });

  it.each([4, 2])('prefix property: the first n0/%i slots cover the shape about as well as any subset that size', (div) => {
    // Bound: the largest distance from a dense point to the nearest of the first k slots is at most
    // 1.6 times the best of 40 random k-subsets of the slots (seeded). An order that is not
    // farthest-point (by x, by index of generation) leaves part of the shape uncovered and fails this.
    const k = Math.floor(n0 / div);
    const prefix = coverRadius(f.dense, pos.slice(0, k));
    const rand = mulberry32(20261114 + n0 * 10 + div);
    let bestRandom = Infinity;
    for (let trial = 0; trial < 40; trial++) {
      const subset = randomSubset(n0, k, rand).map((i) => pos[i]);
      bestRandom = Math.min(bestRandom, coverRadius(f.dense, subset));
    }
    expect(prefix).toBeLessThanOrEqual(1.6 * bestRandom);
  });

  it('colours every slot inside 0..1, as the default gradient along x, with no pure blue', () => {
    const [left, right] = defaultPalette(recipe.kind);
    const width = f.bounds.max[0] - f.bounds.min[0];
    for (const s of f.slots) {
      const t = (s.pos[0] - f.bounds.min[0]) / width;
      for (let c = 0; c < 3; c++) {
        expect(s.colour[c]).toBeGreaterThanOrEqual(0);
        expect(s.colour[c]).toBeLessThanOrEqual(1);
        expect(s.colour[c]).toBeCloseTo(left[c] + (right[c] - left[c]) * t, 9);
      }
      expect(Math.max(s.colour[0], s.colour[1])).toBeGreaterThanOrEqual(0.3);
    }
  });
});

describe('expandRecipe: text', () => {
  it("'ENCORE' at n0 = 200 is wider than it is tall, and flat", () => {
    const f = expandRecipe({ kind: 'text', text: 'ENCORE' }, 200, makeParams(200));
    const size = [0, 1, 2].map((a) => f.bounds.max[a] - f.bounds.min[a]);
    expect(size[0]).toBeGreaterThan(size[1]);
    expect(size[2]).toBe(0);
  });

  it('upper-cases lower case, and renders an unknown character as a space', () => {
    expect(positions({ kind: 'text', text: 'encore' }, 40)).toEqual(positions({ kind: 'text', text: 'ENCORE' }, 40));
    expect(positions({ kind: 'text', text: 'A!B' }, 40)).toEqual(positions({ kind: 'text', text: 'A B' }, 40));
    expect(positions({ kind: 'text', text: 'A B' }, 40)).not.toEqual(positions({ kind: 'text', text: 'AB' }, 40));
  });

  it('never returns fewer than n0 slots: a short text gets finer candidates, an empty one a solid block', () => {
    for (const text of ['I', '1', 'HI', '', '   ', '?']) {
      for (const n0 of [40, 200, 500]) {
        const pos = positions({ kind: 'text', text }, n0);
        expect(pos).toHaveLength(n0);
        expect(new Set(pos.map((p) => p.join(','))).size).toBe(n0);
        expect(closestPair(pos)).toBeGreaterThanOrEqual(1.5);
        expect(closestPair(pos)).toBeLessThanOrEqual(1.5 * 1.01);
      }
    }
    expect(positions({ kind: 'text', text: '' }, 40)).toEqual(positions({ kind: 'text', text: '  ' }, 40));
  });

  it('keeps every single character above y = 2 at n0 = 40 and 200 (short texts gain depth layers)', () => {
    for (const ch of Object.keys(FONT)) {
      for (const n0 of [40, 200]) {
        const f = expandRecipe({ kind: 'text', text: ch }, n0, makeParams(n0));
        expect(f.bounds.min[1], `'${ch}' at n0 = ${n0}`).toBeGreaterThanOrEqual(2);
        expect(Math.abs((f.bounds.min[1] + f.bounds.max[1]) / 2 - 30)).toBeLessThan(1e-6);
      }
    }
    expect(textLayers(litCells('ENCORE').length, 200)).toBe(1);   // the demo text stays flat
    expect(textLayers(litCells('I').length, 40)).toBe(1);
    expect(textLayers(litCells('I').length, 200)).toBeGreaterThan(1);
  });
});

describe('expandRecipe: palette, parameters and the memo cache', () => {
  const red: RGB = [1, 0, 0];
  const green: RGB = [0, 1, 0];

  it('uses the recipe palette as a left-to-right gradient, without moving any slot', () => {
    const plain = expandRecipe({ kind: 'sphere' }, 40, makeParams(40));
    const f = expandRecipe({ kind: 'sphere', palette: [red, green] }, 40, makeParams(40));
    expect(f.slots.map((s) => s.pos)).toEqual(plain.slots.map((s) => s.pos));
    const width = f.bounds.max[0] - f.bounds.min[0];
    for (const s of f.slots) {
      const t = (s.pos[0] - f.bounds.min[0]) / width;
      expect(s.colour[0]).toBeCloseTo(1 - t, 9);
      expect(s.colour[1]).toBeCloseTo(t, 9);
      expect(s.colour[2]).toBe(0);
    }
    const byX = [...f.slots].sort((a, b) => a.pos[0] - b.pos[0]);
    expect(byX[0].colour[0]).toBeGreaterThan(0.9);                 // leftmost is nearly palette[0]
    expect(byX[byX.length - 1].colour[1]).toBeGreaterThan(0.9);    // rightmost is nearly palette[1]
  });

  it('no default palette colour is pure blue', () => {
    for (const { recipe } of KINDS) {
      for (const colour of defaultPalette(recipe.kind)) {
        expect(Math.max(colour[0], colour[1])).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('depends on slotSpacingMin and on no other parameter', () => {
    const base = expandRecipe({ kind: 'helix' }, 40, makeParams(40));
    const sameGeometry = expandRecipe({ kind: 'helix' }, 40, makeParams(40, { vMax: 3, loss: 0.5, scoreLead: 7 }));
    expect(sameGeometry).toBe(base);                               // memo hit: the very same object
    const wide = expandRecipe({ kind: 'helix' }, 40, makeParams(40, { slotSpacingMin: 3 }));
    const closest = closestPair(wide.slots.map((s) => s.pos));
    expect(closest).toBeGreaterThanOrEqual(3);
    expect(closest).toBeLessThanOrEqual(3.03);
    expect(expandRecipe({ kind: 'helix' }, 40, makeParams(40))).toBe(base);
    wide.slots.forEach((s, i) => {                                 // same shape, twice the size
      expect(dist(s.pos, [0, 30, 0])).toBeCloseTo(2 * dist(base.slots[i].pos, [0, 30, 0]), 9);
    });
  });

  it('returns a frozen formation, so no caller can corrupt the shared cache', () => {
    const f = expandRecipe({ kind: 'sphere' }, 40, makeParams(40));
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.slots)).toBe(true);
    expect(Object.isFrozen(f.slots[0])).toBe(true);
    expect(Object.isFrozen(f.slots[0].pos)).toBe(true);
    expect(Object.isFrozen(f.dense[0])).toBe(true);
    expect(Object.isFrozen(f.bounds.min)).toBe(true);
    expect(() => { f.slots[0].pos[0] = 99; }).toThrow(TypeError);
  });

  it('stays correct when the cache evicts old entries', () => {
    const first = expandRecipe({ kind: 'text', text: 'EVICT' }, 20, makeParams(20));
    for (let i = 0; i < 80; i++) expandRecipe({ kind: 'text', text: `E${i}` }, 20, makeParams(20));
    const again = expandRecipe({ kind: 'text', text: 'EVICT' }, 20, makeParams(20));
    expect(again).not.toBe(first);                                 // recomputed after eviction
    expect(again).toEqual(first);
  });

  it('handles a roster of one, and rejects a roster that is not a positive integer', () => {
    for (const { recipe } of KINDS) {
      const f = expandRecipe(recipe, 1, makeParams(1));
      expect(f.slots).toHaveLength(1);
      expect(f.slots[0].index).toBe(0);
    }
    expect(() => expandRecipe({ kind: 'sphere' }, 0, makeParams(0))).toThrow(RangeError);
    expect(() => expandRecipe({ kind: 'sphere' }, 2.5, makeParams(2.5))).toThrow(RangeError);
  });
});

describe('farthestPointOrder', () => {
  it('matches a brute-force implementation, including on a grid full of ties', () => {
    const grid: Vec3[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 9; x++) grid.push([x, y, 0]);
    expect(farthestPointOrder(grid, 30)).toEqual(bruteFarthestOrder(grid, 30));

    const rand = mulberry32(7);
    const cloud: Vec3[] = Array.from({ length: 300 }, () => [rand() * 10, rand() * 4, rand() * 2]);
    expect(farthestPointOrder(cloud, 120)).toEqual(bruteFarthestOrder(cloud, 120));
  });

  it('breaks ties towards the lowest index', () => {
    // centroid (1.5, 0, 0): points 1 and 2 tie for nearest, so 1 starts. Point 3 is farthest from it.
    // Then 0 and 2 tie, both 1 m from a chosen point, so 0 is next.
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
    expect(farthestPointOrder(line, 3)).toEqual([1, 3, 0]);
    // the centre starts; the four corners tie, so corner 0; then corners 1, 2 and 3 tie again, so 1.
    const square: Vec3[] = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0], [1, 1, 0]];
    expect(farthestPointOrder(square, 3)).toEqual([4, 0, 1]);
  });

  it('refuses to pick more points than there are', () => {
    expect(() => farthestPointOrder([[0, 0, 0]], 2)).toThrow(RangeError);
    expect(farthestPointOrder([[0, 0, 0]], 0)).toEqual([]);
  });
});

describe('5x7 font', () => {
  it('has a 7-row, 5-column glyph for A-Z, 0-9 and space', () => {
    const wanted = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '];
    expect(Object.keys(FONT).sort()).toEqual([...wanted].sort());
    for (const ch of wanted) {
      expect(FONT[ch]).toHaveLength(7);
      for (const row of FONT[ch]) expect(row).toMatch(/^[#.]{5}$/);
      expect(litCells(ch).length > 0).toBe(ch !== ' ');
    }
    // no two characters share a glyph
    expect(new Set(wanted.map((ch) => FONT[ch].join('/'))).size).toBe(wanted.length);
  });

  it('lays glyphs out left to right, 6 columns apart, with y up', () => {
    const l = litCells('L');
    expect(l).toHaveLength(11);
    expect(l.filter((c) => c.y === 0)).toHaveLength(5);            // the foot of the L is the bottom row
    expect(l.filter((c) => c.x === 0)).toHaveLength(7);
    const ll = litCells('LL');
    expect(ll.slice(11).map((c) => ({ x: c.x - 6, y: c.y }))).toEqual(l);
    expect(litCells(' L')).toEqual(l.map((c) => ({ x: c.x + 6, y: c.y })));
    expect(litCells('l')).toEqual(l);
    expect(litCells('~')).toEqual([]);
  });
});
