// src/agent/steer.ts
// The steering function shared by both brains (docs/design/contracts-and-algorithms.md, section 10).
// Pure: no state, no clock, no randomness. Imports only the contracts.
import type { Params, Sensed, Vec3 } from '../contracts';

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
