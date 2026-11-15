// tests/cli/s0Collisions.test.ts
// Regression for #80: in scenario S0 (no events) the static arm at n0 = 200 collided about 60 times per run,
// all during formation transitions, because every drone flew straight at its new slot. With paced steering
// targets (contract section 10) and A_START_TICK = -40 it is 14. S0 static is deterministic in the seed (no
// events; the world's RNG only drives the radio, which the static brain never uses), so one seed suffices.
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import { createWorld } from '../../src/sim';
import { staticBrain } from '../../src/agent/staticBrain';
import { onSlotFraction } from '../../src/cli/run';
import { buildScenario } from '../../src/cli/scenarios';

const MAX_COLLISIONS = 15;
const ARRIVAL_TICK = 400;     // the first KILL in S1, S2 and S4
const ARRIVAL_MIN = 0.95;

describe('S0, static arm, n0 = 200 (#80)', () => {
  it(`has at most ${MAX_COLLISIONS} collisions, and at least ${ARRIVAL_MIN * 100}% of drones on slot at tick ${ARRIVAL_TICK}`, () => {
    const params = makeParams(200);
    const scenario = buildScenario('S0', 1, params);
    const world = createWorld({ seed: 1, params, brain: staticBrain, score: scenario.score, events: scenario.events });
    const holdA = scenario.score.movements[0].startTick + scenario.score.movements[0].transitionTicks;
    const holdB = scenario.score.movements[1].startTick + scenario.score.movements[1].transitionTicks;
    let collisions = 0;
    const onSlot: Record<string, number> = {};
    for (let t = 0; t < scenario.ticks; t++) {
      const snapshot = world.step();
      collisions += snapshot.collisions.length;
      if (snapshot.tick === ARRIVAL_TICK) onSlot.arrival = onSlotFraction(snapshot, scenario.score, params);
      if (snapshot.tick === holdA) onSlot.holdA = onSlotFraction(snapshot, scenario.score, params);
      if (snapshot.tick === holdB) onSlot.holdB = onSlotFraction(snapshot, scenario.score, params);
      if (snapshot.tick === scenario.ticks) onSlot.end = onSlotFraction(snapshot, scenario.score, params);
    }
    expect(collisions).toBeLessThanOrEqual(MAX_COLLISIONS);
    expect(onSlot.arrival).toBeGreaterThanOrEqual(ARRIVAL_MIN);
    // Paced targets arrive PACE_SETTLE_TICKS before each hold, so the formation is there when its hold starts.
    expect(onSlot.holdA).toBeGreaterThanOrEqual(ARRIVAL_MIN);
    expect(onSlot.holdB).toBeGreaterThanOrEqual(ARRIVAL_MIN);
    expect(onSlot.end).toBe(1);
  }, 120_000);
});
