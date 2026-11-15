// tests/score/generated/perf.test.ts
// GF-WP-06 (#212): a cold compileGeneratedScene at n0 = 200 must meet the existing cold-expansion budget of
// 200 ms (tests/score/perf.test.ts; canonical spec §7.13) for CL-1 to CL-4 scenes. Measured the way that file
// does: this file runs in its own module state, so nothing is warm when the first test starts, and tests must
// not read a clock, so each test only asserts that the compile completes; the time is the per-test duration
// that vitest prints (--reporter=verbose). Both modes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../../src/contracts';
import { compileGeneratedScene, type SceneSpec } from '../../../src/score/generated';

const fixtureDir = new URL('../../fixtures/scenes/', import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8')) as SceneSpec;

// 3D: CL-1 (a sphere) up to the full 3D elephant (14 solids with mirror copies); 2D: a disc, a path heart, the 2D elephant.
const scenes = ['valid-3d-sphere.json', 'valid-3d-two-spheres.json', 'valid-3d-primitives.json', 'valid-3d-elephant.json',
  'valid-2d-disc.json', 'valid-2d-heart.json', 'valid-2d-elephant.json'];

describe('compileGeneratedScene cold, n0 = 200', () => {
  it.each(scenes)('compiles %s once, cold', (name) => {
    const r = compileGeneratedScene(load(name), makeParams(200), 200);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.formation.slots).toHaveLength(200);
  });
});
