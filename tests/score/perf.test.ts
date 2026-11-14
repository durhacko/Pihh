// tests/score/perf.test.ts
// Issue #13 (WP-4a): a cold expandRecipe for 200 drones must be quick (budget: under 200 ms).
// This file runs in its own module state, so nothing is cached when the first test starts and the
// code has not been warmed up. Tests must not read a clock, so each test only asserts that the
// expansion completes; the time is the per-test duration that vitest prints (--reporter=verbose).
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { Recipe } from '../../src/contracts';
import { expandRecipe } from '../../src/score';

const recipes: Recipe[] = [{ kind: 'text', text: 'ENCORE' }, { kind: 'sphere' }, { kind: 'helix' }];

describe('expandRecipe cold, n0 = 200', () => {
  let completed = 0;

  it.each(recipes)('expands $kind once, uncached', (recipe) => {
    const f = expandRecipe(recipe, 200, makeParams(200));
    completed += 1;
    expect(f.slots).toHaveLength(200);
  });

  it('expands 30 more uncached formations (10 of each kind)', () => {
    let done = 0;
    for (let i = 0; i < 10; i++) {
      const tint = i / 10;                       // a new palette is a new cache key
      expandRecipe({ kind: 'text', text: `ENCORE ${i}` }, 200, makeParams(200));
      expandRecipe({ kind: 'sphere', palette: [[1, tint, 0], [0, 1, tint]] }, 200, makeParams(200));
      expandRecipe({ kind: 'helix', palette: [[1, tint, 0], [0, 1, tint]] }, 200, makeParams(200));
      done += 3;
    }
    expect(done).toBe(30);
    expect(completed).toBe(3);
  });
});
