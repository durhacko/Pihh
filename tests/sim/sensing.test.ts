import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { AgentBrain, AgentOutput, Belief, Score, Vec3 } from '../../src/contracts';
import { createWorld } from '../../src/sim';
import { senseFrom } from '../../src/sim/sensing';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
type Body = { pos: Vec3; vel: Vec3 };
const body = (pos: Vec3, vel: Vec3 = [0, 0, 0]): Body => ({ pos, vel });

/** Each drone accelerates in its own id-dependent direction, so the swarm spreads out unevenly. */
function drifting(): AgentBrain {
  return {
    kind: 'static',
    init: ({ id }) => ({ id }),
    step(raw: unknown): AgentOutput {
      const { id } = raw as { id: number };
      return { accel: [Math.sin(id * 1.7), 0.5 + (id % 3) * 0.2, Math.cos(id * 2.3)], colour: [1, 1, 1], outbox: [] };
    },
    belief: (): Belief => ({ slot: 0, heldSince: 0, target: [0, 0, 0], version: score.version, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] }),
  };
}

describe('geometric sensing order', () => {
  it('is identical when two drones swap ids but keep their positions and velocities', () => {
    const own = body([1, 2, 3], [0.5, 0, 0]);
    const a = body([2, 2, 3], [1, 0, 0]);
    const b = body([1, 2, 5], [0, 0, -1]);
    const c = body([0, 1, 3]);
    const d = body([1, 2, 4], [0, 2, 0]);
    // Peers are passed in id order; swapping b and d is swapping their ids.
    expect(senseFrom(own, [a, d, c, b])).toEqual(senseFrom(own, [a, b, c, d]));
    expect(senseFrom(own, [d, c, b, a])).toEqual(senseFrom(own, [a, b, c, d]));
  });
  it('orders by distance, then relative x, y, z, then relative velocity', () => {
    const own = body([0, 0, 0]);
    const sensed = senseFrom(own, [body([1, 0, 0]), body([0, 1, 0]), body([0, 0, 0.5]), body([0, 0, 1]), body([-1, 0, 0]), body([0, 0, 1], [0, -1, 0])]);
    expect(sensed).toEqual([
      { rel: [0, 0, 0.5], vel: [0, 0, 0] },
      { rel: [-1, 0, 0], vel: [0, 0, 0] },
      { rel: [0, 0, 1], vel: [0, -1, 0] },
      { rel: [0, 0, 1], vel: [0, 0, 0] },
      { rel: [0, 1, 0], vel: [0, 0, 0] },
      { rel: [1, 0, 0], vel: [0, 0, 0] },
    ]);
  });
  it('the world passes sensed in geometric order, not id order', () => {
    const world = createWorld({ seed: 101, score, brain: drifting(), params: makeParams(4, { rSense: 100 }) });
    world.step();
    // Drone 0 on the 2x2 launch grid: drone 1 is +x, drone 2 is +z, at equal distance; +z sorts first on x.
    expect(world.inspect(0)!.input.sensed.map(s => s.rel)).toEqual([[0, 0, 1.5], [1.5, 0, 0], [1.5, 0, 1.5]]);
  });
  it('in a moving 40-drone world, each sensed list equals the order-independent geometric list', () => {
    const params = makeParams(40, { rSense: 4 });
    const world = createWorld({ seed: 7, score, brain: drifting(), params });
    let checked = 0;
    for (let tick = 0; tick < 30; tick++) {
      const before = world.step();
      world.step();
      for (const own of before.drones) {
        const peers = before.drones
          .filter(peer => peer.id !== own.id && (own.pos[0] - peer.pos[0]) ** 2 + (own.pos[1] - peer.pos[1]) ** 2 + (own.pos[2] - peer.pos[2]) ** 2 <= params.rSense ** 2)
          .reverse();
        const sensed = world.inspect(own.id)!.input.sensed;
        expect(sensed).toEqual(senseFrom(own, peers));
        for (let i = 1; i < sensed.length; i++) expect(Math.hypot(...sensed[i - 1].rel)).toBeLessThanOrEqual(Math.hypot(...sensed[i].rel));
        checked += sensed.length;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
