// src/score/timing.ts
// The show clock and score versions (contract section 6, "Timing", and section 9).
import { DT } from '../contracts';
import type { Movement, Params, Score, ScoreVersion, Vec3 } from '../contracts';

const SETTLE_SECONDS = 3;

/**
 * The movement that is current at `tick`: the last one with `startTick <= tick`, or the first
 * movement if none has started yet. `holdStart = startTick + transitionTicks`.
 */
export function currentMovement(
  score: Score, tick: number,
): { index: number; movement: Movement; holdStart: number; inHold: boolean } {
  const first = score.movements[0];
  if (first === undefined) throw new RangeError('currentMovement: the score has no movements');
  let index = 0;
  let movement = first;
  for (let i = 1; i < score.movements.length; i++) {
    const m = score.movements[i] as Movement;
    if (m.startTick <= tick) { index = i; movement = m; }
  }
  const holdStart = movement.startTick + movement.transitionTicks;
  return { index, movement, holdStart, inHold: tick >= holdStart };
}

/** True iff `a` is strictly newer than `b`: (issuedTick, origin) compared lexicographically. */
export function newerVersion(a: ScoreVersion, b: ScoreVersion): boolean {
  return a.issuedTick > b.issuedTick || (a.issuedTick === b.issuedTick && a.origin > b.origin);
}

/**
 * Ticks to allow for flying from `from[i]` to `to[i]` for every index i:
 * ceil((maxDisplacement / (0.5 * vMax) + 3 s) / DT).
 */
export function transitionTicksBetween(from: readonly Vec3[], to: readonly Vec3[], params: Params): number {
  const n = Math.min(from.length, to.length);
  let max2 = 0;
  for (let i = 0; i < n; i++) {
    const a = from[i] as Vec3;
    const b = to[i] as Vec3;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > max2) max2 = d2;
  }
  return Math.ceil((Math.sqrt(max2) / (0.5 * params.vMax) + SETTLE_SECONDS) / DT);
}
