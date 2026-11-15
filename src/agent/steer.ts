// src/agent/steer.ts
// The steering function shared by both brains (docs/design/contracts-and-algorithms.md, section 10).
// Pure: no state, no clock, no randomness. Imports only the contracts and the score package.
import { DT } from '../contracts';
import type { Params, Score, Sensed, Vec3 } from '../contracts';
import { currentMovement, expandRecipe, launchPos } from '../score';
import type { PaceAnchor } from './state';

/** Velocity-tracking gain, per second (section 10). */
const TRACK_GAIN = 4;
/** Sidestep strength as a fraction of aMax (section 10). */
const SIDESTEP_FRACTION = 0.3;
/** transitLanes: use the lane offset only while further than this from the target, in metres. */
const LANE_RELEASE_DIST = 3;
/** transitLanes: depth distance between two neighbouring lanes, in metres. */
const LANE_SPACING = 2;
/**
 * A neighbour counts as "directly above or below" when its horizontal distance is below this fraction
 * of its distance. Then cross(rel, up) is zero (or numerically meaningless) and the fallback axis is used.
 */
const VERTICAL_EPS = 1e-9;

/**
 * The desired acceleration for a drone at `pos` moving at `vel` that wants to reach `target`,
 * given the neighbours it senses. The result is NOT clamped: the world clamps |accel| <= aMax.
 *
 * Degenerate cases (the result is always finite for finite inputs):
 * - dist = 0: the desired velocity is zero, so the drone only brakes.
 * - a neighbour at rel = [0,0,0]: it has no direction, so it adds nothing. Its relative velocity cannot
 *   break the tie either way without the two drones possibly choosing the same side.
 * - a neighbour directly above or below: cross(rel, up) is zero, so the sidestep uses cross(rel, [1,0,0]).
 *   The other drone sees -rel, so the two still sidestep to opposite sides (along z).
 */
export function steer(pos: Vec3, vel: Vec3, target: Vec3, sensed: readonly Sensed[], params: Params): Vec3 {
  const { vMax, aMax, dAvoid } = params;

  // Desired velocity: towards the target, slowing down on approach.
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const dist = Math.hypot(dx, dy, dz);
  const k = dist > 0 ? Math.min(vMax, Math.sqrt(aMax * dist)) / dist : 0;

  // Velocity tracking.
  let ax = (dx * k - vel[0]) * TRACK_GAIN;
  let ay = (dy * k - vel[1]) * TRACK_GAIN;
  let az = (dz * k - vel[2]) * TRACK_GAIN;

  for (let i = 0; i < sensed.length; i++) {
    const rel = sensed[i].rel;
    const relVel = sensed[i].vel;
    const rx = rel[0];
    const ry = rel[1];
    const rz = rel[2];
    const r = Math.hypot(rx, ry, rz);
    if (!(r < dAvoid) || !(r > 0)) continue;

    // Separation: push straight away from the neighbour, harder the closer it is.
    // (Divide by r first: each component of rel / r is at most 1, however small r is.)
    const push = (aMax * (dAvoid - r)) / dAvoid;
    ax -= (rx / r) * push;
    ay -= (ry / r) * push;
    az -= (rz / r) * push;

    // Closing: sidestep along cross(rel, up) = [-rz, 0, rx].
    if (rx * relVel[0] + ry * relVel[1] + rz * relVel[2] < 0) {
      const side = SIDESTEP_FRACTION * aMax;
      const h = Math.hypot(rx, rz);
      if (h > VERTICAL_EPS * r) {
        ax += (-rz / h) * side;
        az += (rx / h) * side;
      } else {
        // Directly above or below: cross(rel, [1,0,0]) = [0, rz, -ry].
        const f = Math.hypot(ry, rz);
        ay += (rz / f) * side;
        az += (-ry / f) * side;
      }
    }
  }
  return [ax, ay, az];
}

/**
 * The point a drone should aim at, to be passed to `steer` as its target. Always a new array.
 * With params.transitLanes off this is the target itself. With it on (the SHOULD feature of section 10),
 * a drone further than 3 m from its target aims at target + [0, 0, ((id % 3) - 1) * 2], which spreads
 * crossing traffic over three depth layers; within 3 m it goes straight in.
 */
export function steerTarget(id: number, pos: Vec3, target: Vec3, params: Params): Vec3 {
  if (!params.transitLanes) return [target[0], target[1], target[2]];
  const dist = Math.hypot(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]);
  if (!(dist > LANE_RELEASE_DIST)) return [target[0], target[1], target[2]];
  return [target[0], target[1], target[2] + ((id % 3) - 1) * LANE_SPACING];
}

/**
 * Paced targets: the paced point reaches the slot this many ticks before holdStart. It is the 3 s settle allowance
 * of the authoring formula (src/score/timing.ts, transitionTicksBetween), so the drone has settled at its slot by holdStart.
 */
export const PACE_SETTLE_TICKS = Math.round(3 / DT);

/**
 * Where slot `slot` of the movement current at `tick` is "now" for steering (section 10, paced targets; #80).
 * Instead of jumping to the new slot when a movement starts, the point moves in a straight line, at constant
 * speed, from the same slot index of the previous movement to the slot. With begin = max(startTick, 0) and
 * end = holdStart - PACE_SETTLE_TICKS: f = 0 at and before begin, f = 1 at and after end, linear in between;
 * if end <= begin it is the slot itself.
 * Movement 0 has no previous movement in the score. If it starts at or before tick 0 it is the launch movement and
 * is paced from the launch position `launchPos(slot, n0)`. If it starts later it is not paced (the slot itself):
 * that is the current movement that composeNext carries into an injected score, whose previous formation the
 * score no longer holds, and pacing it from the launch grid would pull the drone towards the ground.
 * Every drone of a formation moves its point in step, so crossing traffic meets at transit speeds the
 * sidestep can handle instead of at vMax. Always a new array. Pure: a function of the score and the clock.
 */
export function pacedSlotPos(score: Score, tick: number, slot: number, n0: number, params: Params): Vec3 {
  const cm = currentMovement(score, tick);
  const to = expandRecipe(cm.movement.recipe, n0, params).slots[slot]?.pos;
  if (to === undefined) throw new RangeError(`pacedSlotPos: slot ${slot} does not exist for n0 = ${n0}`);
  if (cm.index === 0 && cm.movement.startTick > 0) return [to[0], to[1], to[2]];
  const begin = Math.max(cm.movement.startTick, 0);
  const span = cm.holdStart - PACE_SETTLE_TICKS - begin;
  if (!(span > 0) || tick >= begin + span) return [to[0], to[1], to[2]];
  const from = cm.index === 0
    ? launchPos(slot, n0)
    : expandRecipe(score.movements[cm.index - 1].recipe, n0, params).slots[slot].pos;
  const f = Math.max(0, (tick - begin) / span);
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
}

/** True while `tick` is inside a movement's paced flight: after its begin and before its paced point reaches the slot. */
export function midTransition(startTick: number, holdStart: number, tick: number): boolean {
  return tick > Math.max(startTick, 0) && tick < holdStart - PACE_SETTLE_TICKS;
}

/**
 * Adoption pacing (section 10, #123). A drone that adopts a score, or changes slot, while that movement is
 * mid-transition paces from where it is now, not from the movement's start: begin = tick, from = pos, and
 * end = max(holdStart - PACE_SETTLE_TICKS, tick + minTicks). On adoption, minTicks is the movement's whole paced
 * span, so the drones that adopt together (e.g. a group joining when a partition heals) move in step, as a
 * transition does. On a slot change it is the time to fly |to - pos| at 0.5 vMax (the authoring speed), so a heal
 * is not slowed beyond that.
 */
export function adoptionSpan(startTick: number, holdStart: number): number {
  return holdStart - PACE_SETTLE_TICKS - Math.max(startTick, 0);
}
export function flightTicks(pos: Vec3, to: Vec3, params: Params): number {
  return Math.ceil(Math.hypot(to[0] - pos[0], to[1] - pos[1], to[2] - pos[2]) / (0.5 * params.vMax) / DT);
}
export function anchorPace(mv: number, slot: number, tick: number, pos: Vec3, holdStart: number, minTicks: number): PaceAnchor {
  const end = Math.max(holdStart - PACE_SETTLE_TICKS, tick + minTicks);
  return { mv, slot, begin: tick, end, from: [pos[0], pos[1], pos[2]] };
}

/** The point on an anchored segment at `tick`: linear from `a.from` at a.begin to `to` at a.end. Always a new array. */
export function anchoredPos(a: PaceAnchor, tick: number, to: Vec3): Vec3 {
  const span = a.end - a.begin;
  const f = span > 0 ? Math.min(1, Math.max(0, (tick - a.begin) / span)) : 1;
  return [a.from[0] + (to[0] - a.from[0]) * f, a.from[1] + (to[1] - a.from[1]) * f, a.from[2] + (to[2] - a.from[2]) * f];
}
