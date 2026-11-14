// tests/score/timing.test.ts
// Issue #13 (WP-4a): the show clock, score versions and the authoring formula for transition time.
import { describe, expect, it } from 'vitest';
import { DT, OPERATOR, makeParams } from '../../src/contracts';
import type { Score, Vec3 } from '../../src/contracts';
import { currentMovement, newerVersion, transitionTicksBetween } from '../../src/score';

const score: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [
    { startTick: 0, transitionTicks: 200, recipe: { kind: 'text', text: 'ENCORE' } },
    { startTick: 800, transitionTicks: 150, recipe: { kind: 'sphere' } },
    { startTick: 1500, transitionTicks: 100, recipe: { kind: 'helix' } },
  ],
};

describe('currentMovement', () => {
  it('returns the last movement that has started', () => {
    expect(currentMovement(score, 0).index).toBe(0);
    expect(currentMovement(score, 799).index).toBe(0);
    expect(currentMovement(score, 800).index).toBe(1);             // at the boundary: the new movement
    expect(currentMovement(score, 801).index).toBe(1);
    expect(currentMovement(score, 1499).index).toBe(1);
    expect(currentMovement(score, 1500).index).toBe(2);
    expect(currentMovement(score, 1_000_000).index).toBe(2);
    expect(currentMovement(score, 800).movement).toBe(score.movements[1]);
  });

  it('reports the hold: holdStart = startTick + transitionTicks, inHold from that tick on', () => {
    expect(currentMovement(score, 199)).toMatchObject({ index: 0, holdStart: 200, inHold: false });
    expect(currentMovement(score, 200)).toMatchObject({ index: 0, holdStart: 200, inHold: true });
    expect(currentMovement(score, 799)).toMatchObject({ index: 0, holdStart: 200, inHold: true });
    expect(currentMovement(score, 800)).toMatchObject({ index: 1, holdStart: 950, inHold: false });
    expect(currentMovement(score, 949)).toMatchObject({ index: 1, holdStart: 950, inHold: false });
    expect(currentMovement(score, 950)).toMatchObject({ index: 1, holdStart: 950, inHold: true });
    expect(currentMovement(score, 1600)).toMatchObject({ index: 2, holdStart: 1600, inHold: true });
  });

  it('falls back to the first movement before anything has started', () => {
    const late: Score = {
      version: { issuedTick: 0, origin: OPERATOR },
      movements: [
        { startTick: 50, transitionTicks: 100, recipe: { kind: 'sphere' } },
        { startTick: 400, transitionTicks: 100, recipe: { kind: 'helix' } },
      ],
    };
    expect(currentMovement(late, 0)).toMatchObject({ index: 0, holdStart: 150, inHold: false });
    expect(currentMovement(late, -5).index).toBe(0);
    expect(currentMovement(late, 50).index).toBe(0);
    expect(currentMovement(late, 400).index).toBe(1);
  });

  it('rejects a score with no movements', () => {
    expect(() => currentMovement({ version: { issuedTick: 0, origin: OPERATOR }, movements: [] }, 0)).toThrow(RangeError);
  });
});

describe('newerVersion', () => {
  it('orders by issuedTick first', () => {
    expect(newerVersion({ issuedTick: 10, origin: 0 }, { issuedTick: 9, origin: 199 })).toBe(true);
    expect(newerVersion({ issuedTick: 9, origin: 199 }, { issuedTick: 10, origin: 0 })).toBe(false);
  });

  it('breaks an issuedTick tie by the higher origin', () => {
    expect(newerVersion({ issuedTick: 10, origin: 5 }, { issuedTick: 10, origin: 4 })).toBe(true);
    expect(newerVersion({ issuedTick: 10, origin: 4 }, { issuedTick: 10, origin: 5 })).toBe(false);
    expect(newerVersion({ issuedTick: 0, origin: 0 }, { issuedTick: 0, origin: OPERATOR })).toBe(true);
    expect(newerVersion({ issuedTick: 0, origin: OPERATOR }, { issuedTick: 0, origin: 0 })).toBe(false);
  });

  it('is strict: equal versions are not newer than each other', () => {
    expect(newerVersion({ issuedTick: 10, origin: 5 }, { issuedTick: 10, origin: 5 })).toBe(false);
    expect(newerVersion({ issuedTick: 0, origin: OPERATOR }, { issuedTick: 0, origin: OPERATOR })).toBe(false);
  });

  it('any injected score beats the preloaded one', () => {
    expect(newerVersion({ issuedTick: 1, origin: 0 }, { issuedTick: 0, origin: OPERATOR })).toBe(true);
  });
});

describe('transitionTicksBetween', () => {
  const params = makeParams(40);   // vMax 8, so the cruise speed in the formula is 4 m/s

  it('is ceil((maxDisplacement / (0.5 * vMax) + 3 s) / DT)', () => {
    const from: Vec3[] = [[0, 0, 0], [0, 0, 0], [1, 1, 1]];
    const to: Vec3[] = [[3, 4, 0], [0, 40, 0], [1, 1, 1]];
    // largest move is 40 m: 40 / 4 = 10 s, plus 3 s, is 13 s = 260 ticks
    expect(transitionTicksBetween(from, to, params)).toBe(260);
    expect(transitionTicksBetween(from, to, params)).toBe(Math.ceil((40 / (0.5 * params.vMax) + 3) / DT));
  });

  it('uses the largest displacement, not the first or the mean', () => {
    const from: Vec3[] = [[0, 0, 0], [0, 0, 0]];
    expect(transitionTicksBetween(from, [[0, 0, 12], [1, 0, 0]], params)).toBe(120);
    expect(transitionTicksBetween(from, [[1, 0, 0], [0, 0, 12]], params)).toBe(120);
  });

  it('gives the 3 s settle time when nothing moves, and rounds up', () => {
    const p: Vec3[] = [[1, 2, 3]];
    expect(transitionTicksBetween(p, p, params)).toBe(60);
    // 0.1 m / 4 m/s = 0.025 s, half a tick: rounds up to 61
    expect(transitionTicksBetween([[0, 0, 0]], [[0.1, 0, 0]], params)).toBe(61);
  });

  it('scales with vMax', () => {
    const slow = makeParams(40, { vMax: 4 });
    expect(transitionTicksBetween([[0, 0, 0]], [[0, 20, 0]], slow)).toBe(260);   // 20 / 2 + 3 = 13 s
  });
});
