// tests/agent/steer.test.ts
// Application tests for issue #15 (WP-1a, first half): the steering function of contract section 10.
// The "world" here is a tiny in-test integrator that follows the same order as section 10:
// clamp |accel| <= aMax, integrate velocity, clamp |vel| <= vMax, integrate position, keep y >= 0.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DT, makeParams } from '../../src/contracts';
import type { Params, Sensed, Vec3 } from '../../src/contracts';
import { steer, steerTarget } from '../../src/agent/steer';

interface Body { id: number; pos: Vec3; vel: Vec3; target: Vec3 }

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const isFiniteVec = (v: Vec3): boolean => v.every(c => Number.isFinite(c));

function clampLen(v: Vec3, max: number): Vec3 {
  const l = len(v);
  if (l <= max) return v;
  return [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l];
}

/** What drone `i` senses: every other drone within rSense, as relative position and relative velocity. */
function senseFor(bodies: readonly Body[], i: number, p: Params): Sensed[] {
  const sensed: Sensed[] = [];
  for (let j = 0; j < bodies.length; j++) {
    if (j === i) continue;
    const rel = sub(bodies[j].pos, bodies[i].pos);
    if (len(rel) <= p.rSense) sensed.push({ rel, vel: sub(bodies[j].vel, bodies[i].vel) });
  }
  return sensed;
}

/** One tick for all drones: every drone decides from the same start-of-tick state, then all move. */
function tick(bodies: Body[], p: Params): void {
  const accels = bodies.map((b, i) =>
    clampLen(steer(b.pos, b.vel, steerTarget(b.id, b.pos, b.target, p), senseFor(bodies, i, p), p), p.aMax));
  bodies.forEach((b, i) => {
    const a = accels[i];
    b.vel = clampLen([b.vel[0] + a[0] * DT, b.vel[1] + a[1] * DT, b.vel[2] + a[2] * DT], p.vMax);
    b.pos = [b.pos[0] + b.vel[0] * DT, Math.max(0, b.pos[1] + b.vel[1] * DT), b.pos[2] + b.vel[2] * DT];
  });
}

const settled = (b: Body, p: Params): boolean => len(sub(b.pos, b.target)) < p.rOcc && len(b.vel) < 0.5;

/** Closest distance between two drones during one tick, taking both as moving in a straight line within it. */
function closestInTick(a0: Vec3, b0: Vec3, a1: Vec3, b1: Vec3): number {
  const r0 = sub(b0, a0);
  const dr = sub(sub(b1, a1), r0);
  const dd = dr[0] * dr[0] + dr[1] * dr[1] + dr[2] * dr[2];
  const u = dd > 0 ? Math.min(1, Math.max(0, -(r0[0] * dr[0] + r0[1] * dr[1] + r0[2] * dr[2]) / dd)) : 0;
  return len([r0[0] + dr[0] * u, r0[1] + dr[1] * u, r0[2] + dr[2] * u]);
}

interface PassResult {
  minSeparation: number;      // closest approach over the whole run, measured within ticks (not only at tick ends)
  minSampled: number;         // closest approach at tick ends only
  zAtClosest: [number, number]; // each drone's depth offset (z) at the tick end where they were closest
  bothSettledAt: number;      // first tick at which both drones are settled, or -1
  trace: Vec3[];              // drone A's position per tick
}

/** Two drones swap places: each one's target is the other's start position. */
function swapPlaces(startA: Vec3, startB: Vec3, p: Params, ids: [number, number], ticks: number): PassResult {
  const a: Body = { id: ids[0], pos: [...startA], vel: [0, 0, 0], target: [...startB] };
  const b: Body = { id: ids[1], pos: [...startB], vel: [0, 0, 0], target: [...startA] };
  const result: PassResult = { minSeparation: Infinity, minSampled: Infinity, zAtClosest: [0, 0], bothSettledAt: -1, trace: [] };
  for (let t = 1; t <= ticks; t++) {
    const a0 = a.pos;
    const b0 = b.pos;
    tick([a, b], p);
    result.minSeparation = Math.min(result.minSeparation, closestInTick(a0, b0, a.pos, b.pos));
    const sampled = len(sub(b.pos, a.pos));
    if (sampled < result.minSampled) {
      result.minSampled = sampled;
      result.zAtClosest = [a.pos[2], b.pos[2]];
    }
    if (result.bothSettledAt < 0 && settled(a, p) && settled(b, p)) result.bothSettledAt = t;
    result.trace.push(a.pos);
  }
  return result;
}

const P = DEFAULT_PARAMS;

describe('steer: the documented formula (contract section 10)', () => {
  it('tracks the desired velocity with gain 4 and slows down on approach', () => {
    // dist = 2, so the desired speed is min(vMax, sqrt(aMax * 2)) = 4 m/s along +z.
    expect(steer([0, 0, 0], [1, 0, 0], [0, 0, 2], [], P)).toEqual([-4, 0, 16]);
    // Far away the desired speed is capped at vMax.
    expect(steer([0, 30, 0], [0, 0, 0], [100, 30, 0], [], P)).toEqual([4 * P.vMax, 0, 0]);
  });

  it('adds separation and, for a closing neighbour, the sidestep, and does not clamp the result', () => {
    const closing: Sensed = { rel: [0.7, 0, 0], vel: [-1, 0, 0] };
    const a = steer([0, 0, 0], [1, 0, 0], [0, 0, 2], [closing], P);
    expect(a[0]).toBeCloseTo(-4 - P.aMax * 0.5, 12);        // separation: aMax * (1.4 - 0.7) / 1.4, away from the neighbour
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(16 + 0.3 * P.aMax, 12);         // sidestep: cross([0.7,0,0], up) points along +z
    expect(len(a)).toBeGreaterThan(P.aMax);                  // the world clamps, steer does not

    // The same neighbour moving away: separation only, no sidestep.
    const leaving = steer([0, 0, 0], [1, 0, 0], [0, 0, 2], [{ rel: [0.7, 0, 0], vel: [1, 0, 0] }], P);
    expect(leaving[2]).toBeCloseTo(16, 12);
  });

  it('ignores neighbours at dAvoid or further', () => {
    const alone = steer([0, 30, 0], [2, 0, 0], [10, 30, 0], [], P);
    const far: Sensed[] = [{ rel: [P.dAvoid, 0, 0], vel: [-5, 0, 0] }, { rel: [0, 3, 4], vel: [0, -3, -4] }];
    expect(steer([0, 30, 0], [2, 0, 0], [10, 30, 0], far, P)).toEqual(alone);
  });
});

describe('steer: a lone drone', () => {
  const cases: { name: string; start: Vec3; target: Vec3 }[] = [
    { name: 'along x', start: [0, 30, 0], target: [30, 30, 0] },
    { name: 'on a diagonal', start: [-10, 20, 5], target: [10, 40, -5] },   // also 30 m
  ];
  for (const c of cases) {
    it(`reaches a target 30 m away ${c.name}, settles within rOcc, and overshoots by less than 1 m`, () => {
      expect(len(sub(c.target, c.start))).toBeCloseTo(30, 9);
      const dir = clampLen(sub(c.target, c.start), 1);
      const b: Body = { id: 0, pos: [...c.start], vel: [0, 0, 0], target: [...c.target] };
      let firstSettled = -1;
      let lastUnsettled = 0;
      let overshoot = 0;
      for (let t = 1; t <= 400; t++) {
        tick([b], P);
        const past = sub(b.pos, c.target);
        overshoot = Math.max(overshoot, past[0] * dir[0] + past[1] * dir[1] + past[2] * dir[2]);
        if (settled(b, P)) { if (firstSettled < 0) firstSettled = t; } else lastUnsettled = t;
      }
      // 30 m at vMax = 8 m/s cannot take fewer than 75 ticks; 130 leaves room for speeding up and braking.
      expect(firstSettled).toBeGreaterThan(75);
      expect(lastUnsettled).toBeLessThan(130);       // from tick 130 to tick 400 it never leaves "settled"
      expect(overshoot).toBeLessThan(1);
      expect(len(sub(b.pos, c.target))).toBeLessThan(0.01);
    });
  }
});

describe('steer: two drones head-on', () => {
  it('at full speed they sidestep to opposite sides and both still arrive', () => {
    const r = swapPlaces([-15, 30, 0], [15, 30, 0], P, [0, 0], 400);
    const [zA, zB] = r.zAtClosest;
    expect(zA * zB).toBeLessThan(0);                 // opposite sides of the line they were flying along
    expect(zA).toBeCloseTo(-zB, 9);                  // and mirrored: neither drone gives way more than the other
    expect(r.bothSettledAt).toBeGreaterThan(0);
    expect(r.bothSettledAt).toBeLessThan(130);
    // NOT asserted: a pass above dCollide. With the default parameters it does not hold, see the next test.
  });

  it('at a low closing speed the sidestep clears dCollide', () => {
    // The documented rule only acts inside dAvoid = 1.4 m. At vMax = 8 two drones close 0.8 m per tick, so the
    // rule gets one or two ticks and moves each drone sideways by about 2 cm: the full-speed pass above comes
    // within about 0.02 m. With vMax = 1 the same rule has time to work.
    const slow = makeParams(200, { vMax: 1 });
    const r = swapPlaces([-5, 30, 0], [5, 30, 0], slow, [0, 0], 400);
    expect(r.minSeparation).toBeGreaterThan(slow.dCollide);
    expect(r.zAtClosest[0] * r.zAtClosest[1]).toBeLessThan(0);
    expect(r.bothSettledAt).toBeGreaterThan(0);
  });

  it('one directly above the other: they still pick opposite sides (fallback axis) and clear dCollide at low speed', () => {
    const slow = makeParams(200, { vMax: 1 });
    const r = swapPlaces([0, 25, 0], [0, 35, 0], slow, [0, 0], 600);
    expect(r.minSeparation).toBeGreaterThan(slow.dCollide);
    expect(r.zAtClosest[0] * r.zAtClosest[1]).toBeLessThan(0);
    expect(r.bothSettledAt).toBeGreaterThan(0);
  });

  it('at full speed with transitLanes on, drones in different lanes clear dCollide', () => {
    const lanes = makeParams(200, { transitLanes: true });
    const r = swapPlaces([-15, 30, 0], [15, 30, 0], lanes, [0, 1], 400);
    expect(r.minSeparation).toBeGreaterThan(lanes.dCollide);
    expect(r.bothSettledAt).toBeGreaterThan(0);
  });
});

describe('steer: drones at rest on their slots', () => {
  const directions: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.8, 0]];

  it('get no separation force at slotSpacingMin, so the acceleration stays zero', () => {
    expect(P.dAvoid).toBeLessThan(P.slotSpacingMin);
    for (const d of directions) {
      const a: Body = { id: 0, pos: [0, 30, 0], vel: [0, 0, 0], target: [0, 30, 0] };
      const other: Vec3 = [d[0] * P.slotSpacingMin, 30 + d[1] * P.slotSpacingMin, d[2] * P.slotSpacingMin];
      const b: Body = { id: 1, pos: [...other], vel: [0, 0, 0], target: [...other] };
      expect(len(steer(a.pos, a.vel, a.target, senseFor([a, b], 0, P), P))).toBe(0);
      expect(len(steer(b.pos, b.vel, b.target, senseFor([a, b], 1, P), P))).toBe(0);
      for (let t = 0; t < 100; t++) tick([a, b], P);
      expect(a.pos).toEqual([0, 30, 0]);
      expect(b.pos).toEqual(other);
      expect(len(a.vel)).toBe(0);
      expect(len(b.vel)).toBe(0);
    }
  });

  it('do push each other apart when closer than dAvoid', () => {
    const a = steer([0, 30, 0], [0, 0, 0], [0, 30, 0], [{ rel: [1, 0, 0], vel: [0, 0, 0] }], P);
    expect(a[0]).toBeCloseTo((-P.aMax * (P.dAvoid - 1)) / P.dAvoid, 12);
    expect(a[1]).toBe(0);
    expect(a[2]).toBe(0);     // not closing, so no sidestep
  });
});

describe('steer: degenerate inputs give finite output', () => {
  it('dist = 0: only brakes', () => {
    expect(len(steer([3, 30, -2], [0, 0, 0], [3, 30, -2], [], P))).toBe(0);
    expect(steer([3, 30, -2], [1, -2, 3], [3, 30, -2], [], P)).toEqual([-4, 8, -12]);
  });

  it('a neighbour at rel = [0,0,0] adds nothing', () => {
    const alone = steer([0, 30, 0], [1, 0, 0], [5, 30, 0], [], P);
    for (const vel of [[0, 0, 0], [2, -1, 0.5]] as Vec3[]) {
      const a = steer([0, 30, 0], [1, 0, 0], [5, 30, 0], [{ rel: [0, 0, 0], vel }], P);
      expect(isFiniteVec(a)).toBe(true);
      expect(a).toEqual(alone);
    }
    expect(isFiniteVec(steer([0, 30, 0], [0, 0, 0], [0, 30, 0], [{ rel: [0, 0, 0], vel: [0, 0, 0] }], P))).toBe(true);
  });

  it('a closing neighbour directly above or below: finite, and the pair sidesteps to opposite sides', () => {
    const lower = steer([0, 30, 0], [0, 0, 0], [0, 30, 0], [{ rel: [0, 1, 0], vel: [0, -2, 0] }], P);
    const upper = steer([0, 31, 0], [0, 0, 0], [0, 31, 0], [{ rel: [0, -1, 0], vel: [0, 2, 0] }], P);
    expect(isFiniteVec(lower)).toBe(true);
    expect(isFiniteVec(upper)).toBe(true);
    expect(lower[1]).toBeCloseTo((-P.aMax * (P.dAvoid - 1)) / P.dAvoid, 12);   // pushed down, away from the one above
    expect(Math.abs(lower[2])).toBeCloseTo(0.3 * P.aMax, 12);                   // sidestep along z
    expect(lower[0]).toBe(0);
    expect(upper[2]).toBeCloseTo(-lower[2], 12);
    expect(upper[1]).toBeCloseTo(-lower[1], 12);
  });

  it('a neighbour almost exactly above, or extremely close: finite', () => {
    const rels: Vec3[] = [[1e-300, 1, 0], [0, 1, 5e-324], [1e-12, -0.5, 1e-12], [5e-324, 0, 0], [0, 1e-200, 0], [1e-160, 1e-160, 1e-160]];
    for (const rel of rels) {
      const a = steer([0, 30, 0], [1, 2, 3], [4, 30, 1], [{ rel, vel: [-rel[0], -rel[1] - 1, -rel[2]] }], P);
      expect(isFiniteVec(a)).toBe(true);
    }
  });
});

describe('steer: determinism', () => {
  it('gives the same output for the same inputs and does not change its inputs', () => {
    const pos: Vec3 = [1.5, 29, -3];
    const vel: Vec3 = [0.3, -1.2, 4];
    const target: Vec3 = [-7, 33, 2];
    const sensed: Sensed[] = [{ rel: [0.4, 0.2, -0.9], vel: [-1, 0, 2] }, { rel: [0, -1.1, 0], vel: [0, 3, 0] }, { rel: [5, 0, 0], vel: [0, 0, 0] }];
    const before = JSON.stringify({ pos, vel, target, sensed });
    const first = steer(pos, vel, target, sensed, P);
    const second = steer(pos, vel, target, sensed, P);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(JSON.stringify({ pos, vel, target, sensed })).toBe(before);
  });

  it('gives the same trajectory when a whole run is repeated', () => {
    const one = swapPlaces([-15, 30, 0], [15, 30, 0], P, [0, 0], 150);
    const two = swapPlaces([-15, 30, 0], [15, 30, 0], P, [0, 0], 150);
    expect(two.trace).toEqual(one.trace);
    expect(two.minSeparation).toBe(one.minSeparation);
  });
});

describe('steerTarget', () => {
  const target: Vec3 = [4, 30, -1];

  it('returns the target unchanged when transitLanes is false', () => {
    expect(P.transitLanes).toBe(false);
    for (let id = 0; id < 6; id++) {
      for (const pos of [[4, 30, -1], [4, 31, -1], [40, 10, 7]] as Vec3[]) {
        const aim = steerTarget(id, pos, target, P);
        expect(aim).toEqual(target);
        expect(aim).not.toBe(target);       // a copy, so a caller may keep or change it
      }
    }
    expect(target).toEqual([4, 30, -1]);
  });

  it('with transitLanes on, offsets the aim point in depth by lane while more than 3 m away', () => {
    const lanes = makeParams(200, { transitLanes: true });
    const far: Vec3 = [-20, 30, -1];
    expect(steerTarget(0, far, target, lanes)).toEqual([4, 30, -3]);
    expect(steerTarget(1, far, target, lanes)).toEqual([4, 30, -1]);
    expect(steerTarget(2, far, target, lanes)).toEqual([4, 30, 1]);
    expect(steerTarget(3, far, target, lanes)).toEqual([4, 30, -3]);
    expect(steerTarget(199, far, target, lanes)).toEqual([4, 30, -1]);
  });

  it('with transitLanes on, goes straight in from 3 m', () => {
    const lanes = makeParams(200, { transitLanes: true });
    expect(steerTarget(0, [4, 30, -3], target, lanes)).toEqual(target);      // at the lane point: 2 m away
    expect(steerTarget(2, [1, 30, -1], target, lanes)).toEqual(target);      // exactly 3 m: not "more than 3 m"
    expect(steerTarget(2, [0.99, 30, -1], target, lanes)).toEqual([4, 30, 1]);
  });

  it('with transitLanes on, a drone in each lane still arrives and settles', () => {
    const lanes = makeParams(200, { transitLanes: true });
    for (let id = 0; id < 3; id++) {
      const b: Body = { id, pos: [0, 30, 0], vel: [0, 0, 0], target: [30, 30, 0] };
      let lastUnsettled = 0;
      for (let t = 1; t <= 400; t++) {
        tick([b], lanes);
        if (!settled(b, lanes)) lastUnsettled = t;
      }
      expect(lastUnsettled).toBeLessThan(160);
      expect(len(sub(b.pos, b.target))).toBeLessThan(0.01);
    }
  });
});
