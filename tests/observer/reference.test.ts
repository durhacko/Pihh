import { describe, expect, it } from 'vitest';
import type { Score } from '../../src/contracts';
import { makeFakeSnapshot } from '../fixtures/fakeSnapshot';
import { ReferenceScores } from '../../src/observer/reference';

const preloaded: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const injected: Score = { version: { issuedTick: 20, origin: 2 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'helix' } }] };
function registry() {
  const result = new ReferenceScores();
  result.register(preloaded);
  result.register(injected);
  return result;
}

describe('per-world reference scores', () => {
  it('keeps the static preloaded reference after registering an injection', () => {
    expect(registry().reference(makeFakeSnapshot(30, 5))).toEqual(preloaded);
  });
  it('uses the newest score actually believed by a live drone in that world', () => {
    const snap = makeFakeSnapshot(30, 5);
    snap.drones[0].belief.version = injected.version;
    expect(registry().reference(snap)).toEqual(injected);
    snap.drones[0].alive = false;
    expect(registry().reference(snap)).toEqual(preloaded);
  });
  it('reports no reference for an empty swarm, and rejects unregistered live beliefs', () => {
    const snap = makeFakeSnapshot(30, 5);
    snap.drones[0].belief.version = { issuedTick: 10, origin: 1 };
    expect(() => registry().reference(snap)).toThrow('Register score');
    for (const drone of snap.drones) drone.alive = false;
    expect(registry().reference(snap)).toBeNull();
  });
  it('copies registered and returned scores and rejects conflicting version contents', () => {
    const scores = new ReferenceScores();
    const source = structuredClone(preloaded);
    scores.register(source);
    source.movements[0].recipe = { kind: 'text', text: 'CHANGED' };
    const first = scores.reference(makeFakeSnapshot(1, 5))!;
    expect(first).toEqual(preloaded);
    first.movements[0].recipe = { kind: 'helix' };
    expect(scores.reference(makeFakeSnapshot(1, 5))).toEqual(preloaded);
    expect(() => scores.register(source)).toThrow('Conflicting contents');
  });
  it('does not treat a registered future injection as having occurred', () => {
    const scores = registry();
    expect(scores.newestAt(19)).toEqual(preloaded);
    expect(scores.newestAt(20)).toEqual(injected);
  });
});
