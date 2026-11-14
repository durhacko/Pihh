// tests/score/compose.test.ts
// Issue #13 (WP-4a): the launch grid, the preloaded score and the next composition.
import { describe, expect, it } from 'vitest';
import { DT, OPERATOR, makeParams } from '../../src/contracts';
import type { Params, Recipe, Vec3 } from '../../src/contracts';
import { composeNext, currentMovement, expandRecipe, launchPos, makeScore, newerVersion } from '../../src/score';
import { dist } from './helpers';

const text: Recipe = { kind: 'text', text: 'ENCORE' };
const sphere: Recipe = { kind: 'sphere' };
const helix: Recipe = { kind: 'helix', palette: [[1, 0.5, 0], [0, 1, 0.5]] };

/** The authoring formula, computed here from the formations themselves. */
function expectedTicks(from: Vec3[], to: Vec3[], params: Params): number {
  let max = 0;
  for (let i = 0; i < from.length; i++) max = Math.max(max, dist(from[i], to[i]));
  return Math.ceil((max / (0.5 * params.vMax) + 3) / DT);
}
const slotsOf = (recipe: Recipe, n0: number, params: Params): Vec3[] =>
  expandRecipe(recipe, n0, params).slots.map((s) => s.pos);
const gridOf = (n0: number): Vec3[] => Array.from({ length: n0 }, (_, id) => launchPos(id, n0));

describe('launchPos', () => {
  it.each([40, 200])('matches the agreed formula for every drone at n0 = %i', (n0) => {
    const cols = Math.ceil(Math.sqrt(n0));
    const rows = Math.ceil(n0 / cols);
    const seen = new Set<string>();
    for (let id = 0; id < n0; id++) {
      const p = launchPos(id, n0);
      expect(p).toEqual([(id % cols - (cols - 1) / 2) * 1.5, 0, (Math.floor(id / cols) - (rows - 1) / 2) * 1.5]);
      expect(p[1]).toBe(0);
      seen.add(p.join(','));
    }
    expect(seen.size).toBe(n0);                                     // all positions unique
  });

  it('is a centred grid with 1.5 m pitch: 7 x 6 at n0 = 40, 15 x 14 at n0 = 200', () => {
    expect(launchPos(0, 40)).toEqual([-4.5, 0, -3.75]);
    expect(launchPos(6, 40)).toEqual([4.5, 0, -3.75]);
    expect(launchPos(7, 40)).toEqual([-4.5, 0, -2.25]);
    expect(launchPos(39, 40)).toEqual([1.5, 0, 3.75]);
    expect(launchPos(0, 200)).toEqual([-10.5, 0, -9.75]);
    expect(launchPos(199, 200)).toEqual([-4.5, 0, 9.75]);
    expect(dist(launchPos(3, 200), launchPos(4, 200))).toBe(1.5);
    expect(dist(launchPos(3, 200), launchPos(18, 200))).toBe(1.5);
  });
});

describe('makeScore', () => {
  const n0 = 40;
  const params = makeParams(n0);

  it('builds the preloaded score: operator version, first movement at tick 0 from the launch grid', () => {
    const score = makeScore([text, sphere, helix], n0, params);
    expect(score.version).toEqual({ issuedTick: 0, origin: OPERATOR });
    expect(score.movements.map((m) => m.recipe)).toEqual([text, sphere, helix]);
    expect(score.movements[0].startTick).toBe(0);
    expect(score.movements[0].transitionTicks).toBe(expectedTicks(gridOf(n0), slotsOf(text, n0, params), params));
    // the climb to y = 30 alone takes at least 30 / 4 + 3 s
    expect(score.movements[0].transitionTicks).toBeGreaterThanOrEqual(210);
  });

  it('starts each later movement holdTicks (default 600) after the previous hold began', () => {
    const score = makeScore([text, sphere, helix], n0, params);
    const [a, b, c] = score.movements;
    expect(b.startTick).toBe(a.startTick + a.transitionTicks + 600);
    expect(c.startTick).toBe(b.startTick + b.transitionTicks + 600);
    expect(b.transitionTicks).toBe(expectedTicks(slotsOf(text, n0, params), slotsOf(sphere, n0, params), params));
    expect(c.transitionTicks).toBe(expectedTicks(slotsOf(sphere, n0, params), slotsOf(helix, n0, params), params));
    // sorted by startTick, and each hold really lasts holdTicks on the clock
    expect(currentMovement(score, b.startTick - 1)).toMatchObject({ index: 0, inHold: true });
    expect(currentMovement(score, b.startTick)).toMatchObject({ index: 1, inHold: false });
  });

  it('takes a custom hold length, copies the recipes, and is deterministic', () => {
    const score = makeScore([text, helix], n0, params, 100);
    const [a, b] = score.movements;
    expect(b.startTick).toBe(a.transitionTicks + 100);
    expect(b.recipe).toEqual(helix);
    expect(b.recipe).not.toBe(helix);
    expect(b.recipe.palette).not.toBe(helix.palette);
    expect(makeScore([text, helix], n0, params, 100)).toEqual(score);
    expect(JSON.parse(JSON.stringify(score))).toEqual(score);
  });

  it('needs at least one recipe', () => {
    expect(() => makeScore([], n0, params)).toThrow(RangeError);
  });
});

describe('composeNext', () => {
  const n0 = 40;
  const params = makeParams(n0);
  const score = makeScore([text, sphere], n0, params);
  const second = score.movements[1];

  it('keeps the current movement and starts the new one at tick + scoreLead, under a new version', () => {
    const tick = score.movements[0].transitionTicks + 100;          // in the first hold
    const before = JSON.parse(JSON.stringify(score));
    const next = composeNext(score, tick, helix, 7, n0, params);

    expect(next.version).toEqual({ issuedTick: tick, origin: 7 });
    expect(newerVersion(next.version, score.version)).toBe(true);
    expect(next.movements).toHaveLength(2);
    expect(next.movements[0]).toEqual(score.movements[0]);          // the current movement, unchanged
    expect(next.movements[1].startTick).toBe(tick + params.scoreLead);
    expect(next.movements[1].recipe).toEqual(helix);
    expect(next.movements[1].transitionTicks).toBe(
      expectedTicks(slotsOf(text, n0, params), slotsOf(helix, n0, params), params),
    );
    expect(score).toEqual(before);                                  // the old score is not modified
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);         // plain JSON data
  });

  it('drones on the new score keep flying the same formation until the lead time is over', () => {
    const tick = score.movements[0].transitionTicks + 100;
    const next = composeNext(score, tick, helix, 7, n0, params);
    expect(currentMovement(next, tick).movement).toEqual(currentMovement(score, tick).movement);
    expect(currentMovement(next, tick + params.scoreLead - 1)).toMatchObject({ index: 0, inHold: true });
    expect(currentMovement(next, tick + params.scoreLead)).toMatchObject({ index: 1, inHold: false });
  });

  it('carries over whichever movement is current at the injection tick, and drops the rest', () => {
    const tick = second.startTick + 10;                             // the sphere has started
    const next = composeNext(score, tick, helix, 3, n0, params);
    expect(next.movements).toHaveLength(2);
    expect(next.movements[0]).toEqual(second);
    expect(next.movements[1].transitionTicks).toBe(
      expectedTicks(slotsOf(sphere, n0, params), slotsOf(helix, n0, params), params),
    );
    // composing during the first movement drops the sphere that had been scheduled
    const early = composeNext(score, 5, helix, 3, n0, params);
    expect(early.movements.map((m) => m.recipe.kind)).toEqual(['text', 'helix']);
  });

  it('does not share objects with the old score or the recipe passed in', () => {
    const next = composeNext(score, 500, helix, 7, n0, params);
    expect(next.movements[0]).not.toBe(score.movements[0]);
    expect(next.movements[1].recipe).not.toBe(helix);
    expect(next.movements[1].recipe.palette).not.toBe(helix.palette);
  });

  it('the most recent composition always wins, and a tie goes to the higher origin', () => {
    const a = composeNext(score, 500, helix, 7, n0, params);
    const b = composeNext(a, 900, sphere, 2, n0, params);
    expect(newerVersion(b.version, a.version)).toBe(true);
    expect(newerVersion(a.version, b.version)).toBe(false);
    const c = composeNext(score, 500, sphere, 9, n0, params);
    expect(newerVersion(c.version, a.version)).toBe(true);
    expect(composeNext(score, 500, helix, 7, n0, params)).toEqual(a);
  });
});
