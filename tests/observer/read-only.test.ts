import { expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { Score } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { createWorld } from '../../src/sim';
import { dummyBrain } from '../fixtures/dummyBrain';
import { TickEvidence } from '../../src/observer/evidence';
import { measureFormation } from '../../src/observer/measure';
import { ReferenceScores } from '../../src/observer/reference';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

it('observer components consume frozen real snapshots without changing simulation replay', () => {
  const params = makeParams(40);
  const score: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
  const config = { seed: 101, score, params, brain: dummyBrain };
  const baseline = createWorld(config, { freezeInputs: true });
  const observed = createWorld(config, { freezeInputs: true });
  baseline.schedule({ type: 'KILL', tick: 50, ids: [1, 2, 3] });
  observed.schedule({ type: 'KILL', tick: 50, ids: [1, 2, 3] });
  const registry = new ReferenceScores();
  registry.register(score);
  const evidence = new TickEvidence();
  const formation = freeze(expandRecipe(score.movements[0].recipe, params.n0, params));
  for (let tick = 1; tick <= 100; tick++) {
    baseline.step();
    const snapshot = freeze(observed.step());
    const before = observed.stateHash();
    expect(registry.reference(snapshot)).toEqual(score);
    evidence.ingest(snapshot);
    if (tick % 5 === 0) measureFormation(snapshot, formation, params);
    expect(observed.stateHash()).toBe(before);
    expect(observed.stateHash()).toBe(baseline.stateHash());
  }
  expect(evidence.timeline).toHaveLength(100);
  expect(evidence.finalLive).toHaveLength(37);
  // The public createObserver/T14 integration is still pending #48; this verifies its components only.
});
