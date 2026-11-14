// tests/agent/pacedSlotPos.test.ts
// Paced steering targets (contract section 10; #80): pacedSlotPos moves the point a drone steers at in a straight
// line, at constant speed, from its slot of the previous movement (launch position for movement 0) to its slot,
// reaching it PACE_SETTLE_TICKS before holdStart.
import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { Movement, Recipe, Score, Vec3 } from '../../src/contracts';
import { composeNext, currentMovement, expandRecipe, launchPos, makeScore } from '../../src/score';
import { PACE_SETTLE_TICKS, pacedSlotPos } from '../../src/agent/steer';

const N = 30;
const P = makeParams(N);
const SPHERE: Recipe = { kind: 'sphere' };
const HELIX: Recipe = { kind: 'helix' };

function score(...movements: Movement[]): Score {
  return { version: { issuedTick: 0, origin: OPERATOR }, movements };
}
const slotOf = (recipe: Recipe, slot: number): Vec3 => expandRecipe(recipe, N, P).slots[slot].pos;
const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
function expectClose(a: Vec3, b: Vec3) {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 9);
}

// Two movements: A from tick 0 (hold at 300), B from tick 600 (hold at 900).
const TWO = score(
  { startTick: 0, transitionTicks: 300, recipe: SPHERE },
  { startTick: 600, transitionTicks: 300, recipe: HELIX },
);
const A_END = 300 - PACE_SETTLE_TICKS;          // the paced point reaches A's slot here
const B_END = 900 - PACE_SETTLE_TICKS;

describe('PACE_SETTLE_TICKS', () => {
  it('is the 3 s settle allowance of the authoring formula: 60 ticks at 20 Hz', () => {
    expect(PACE_SETTLE_TICKS).toBe(60);
  });
});

describe('pacedSlotPos', () => {
  it('f = 0 at the start of movement 0: the launch position', () => {
    for (const slot of [0, 7, N - 1]) expect(pacedSlotPos(TWO, 0, slot, N, P)).toEqual(launchPos(slot, N));
  });

  it('f = 0 at the start of a later movement: the same slot index of the previous formation', () => {
    for (const slot of [0, 7, N - 1]) expect(pacedSlotPos(TWO, 600, slot, N, P)).toEqual(slotOf(SPHERE, slot));
  });

  it('f = 1 at holdStart - PACE_SETTLE_TICKS, at holdStart, and after: exactly the slot', () => {
    for (const slot of [0, 7, N - 1]) {
      for (const tick of [A_END, A_END + 1, 300, 599]) expect(pacedSlotPos(TWO, tick, slot, N, P)).toEqual(slotOf(SPHERE, slot));
      for (const tick of [B_END, 900, 100000]) expect(pacedSlotPos(TWO, tick, slot, N, P)).toEqual(slotOf(HELIX, slot));
    }
  });

  it('is linear in between: lerp(from, to, (tick - begin) / span), so the point moves at constant speed', () => {
    const slot = 11;
    const from = slotOf(SPHERE, slot);
    const to = slotOf(HELIX, slot);
    const span = B_END - 600;
    for (const tick of [601, 650, 600 + span / 2, B_END - 1]) expectClose(pacedSlotPos(TWO, tick, slot, N, P), lerp(from, to, (tick - 600) / span));
    // Equal steps in time are equal steps in space.
    const step = (t: number) => {
      const a = pacedSlotPos(TWO, t, slot, N, P);
      const b = pacedSlotPos(TWO, t + 10, slot, N, P);
      return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    };
    expect(step(620)).toBeCloseTo(step(700), 9);
    expect(step(620)).toBeGreaterThan(0);
    // Movement 0 too, from the launch position.
    expectClose(pacedSlotPos(TWO, A_END / 2, slot, N, P), lerp(launchPos(slot, N), slotOf(SPHERE, slot), 0.5));
  });

  it('works for a single-movement score (makeScore with one recipe): launch position to the slot', () => {
    const one = makeScore([SPHERE], N, P);
    expect(one.movements).toHaveLength(1);
    const m = one.movements[0];
    const end = m.startTick + m.transitionTicks - PACE_SETTLE_TICKS;
    expect(end).toBeGreaterThan(m.startTick);
    expect(pacedSlotPos(one, m.startTick, 4, N, P)).toEqual(launchPos(4, N));
    expectClose(pacedSlotPos(one, m.startTick + (end - m.startTick) / 4, 4, N, P), lerp(launchPos(4, N), slotOf(SPHERE, 4), 0.25));
    expect(pacedSlotPos(one, end, 4, N, P)).toEqual(slotOf(SPHERE, 4));
    expect(pacedSlotPos(one, 1e6, 4, N, P)).toEqual(slotOf(SPHERE, 4));
  });

  it('a tick before the first movement starts: the launch position (launch movement from tick 0)', () => {
    expect(currentMovement(TWO, -5).index).toBe(0);
    for (const tick of [-100, -5, -1]) expect(pacedSlotPos(TWO, tick, 3, N, P)).toEqual(launchPos(3, N));
  });

  it('movement 0 that starts after tick 0 is not paced: there is no known previous formation', () => {
    const late = score({ startTick: 100, transitionTicks: 200, recipe: SPHERE });
    for (const tick of [-10, 0, 50, 100, 150, 400]) expect(pacedSlotPos(late, tick, 3, N, P)).toEqual(slotOf(SPHERE, 3));
  });

  it('an injected score (composeNext) during a transition does not pace from the launch grid', () => {
    // At tick 650 movement B (HELIX) of TWO is mid-transition. composeNext keeps only B, as movement 0 (startTick 600),
    // and appends the new movement. B must stay unpaced (its slot), never a point pulled towards the ground grid.
    const injected = composeNext(TWO, 650, { kind: 'text', text: 'X' }, 0, N, P);
    expect(injected.movements[0].startTick).toBe(600);
    expect(injected.movements[0].recipe).toEqual(HELIX);
    const next = injected.movements[1];
    for (const tick of [650, 660, next.startTick - 1]) expect(pacedSlotPos(injected, tick, 3, N, P)).toEqual(slotOf(HELIX, 3));
    // The injected movement itself is paced from B's slot, which the score does hold.
    expect(pacedSlotPos(injected, next.startTick, 3, N, P)).toEqual(slotOf(HELIX, 3));
    const end = next.startTick + next.transitionTicks - PACE_SETTLE_TICKS;
    expect(pacedSlotPos(injected, end, 3, N, P)).toEqual(expandRecipe(next.recipe, N, P).slots[3].pos);
  });

  it('a later-movement tick before its start keeps flying the previous movement (currentMovement decides)', () => {
    expectClose(pacedSlotPos(TWO, 599, 3, N, P), slotOf(SPHERE, 3));
    expectClose(pacedSlotPos(TWO, 120, 3, N, P), lerp(launchPos(3, N), slotOf(SPHERE, 3), 120 / A_END));
  });

  it('a movement that started before tick 0 (like EVAL movement A) is paced from tick 0, not from its startTick', () => {
    const early = score({ startTick: -40, transitionTicks: 363, recipe: SPHERE });
    const end = -40 + 363 - PACE_SETTLE_TICKS;                       // 263
    expect(pacedSlotPos(early, 0, 5, N, P)).toEqual(launchPos(5, N));
    expectClose(pacedSlotPos(early, end / 2, 5, N, P), lerp(launchPos(5, N), slotOf(SPHERE, 5), 0.5));
    expect(pacedSlotPos(early, end, 5, N, P)).toEqual(slotOf(SPHERE, 5));
  });

  it('when holdStart - PACE_SETTLE_TICKS is not after the start, it is the slot itself (no pacing)', () => {
    const rushed = score(
      { startTick: -500, transitionTicks: 400, recipe: SPHERE },     // hold already began before tick 0
      { startTick: 700, transitionTicks: PACE_SETTLE_TICKS, recipe: HELIX },   // no flight time at all
    );
    for (const tick of [0, 1, 50]) expect(pacedSlotPos(rushed, tick, 2, N, P)).toEqual(slotOf(SPHERE, 2));
    for (const tick of [700, 701]) expect(pacedSlotPos(rushed, tick, 2, N, P)).toEqual(slotOf(HELIX, 2));
  });

  it('returns a new, editable array every call (never the frozen shared formation), and is pure', () => {
    const a = pacedSlotPos(TWO, 1000, 1, N, P);
    const b = pacedSlotPos(TWO, 1000, 1, N, P);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a[0] += 5;
    expect(pacedSlotPos(TWO, 1000, 1, N, P)).toEqual(b);
    expect(slotOf(HELIX, 1)).toEqual(b);
  });

  it('throws a RangeError for a slot that does not exist', () => {
    expect(() => pacedSlotPos(TWO, 10, N, N, P)).toThrow(RangeError);
    expect(() => pacedSlotPos(TWO, 10, -1, N, P)).toThrow(RangeError);
  });
});
