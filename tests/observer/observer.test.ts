import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { Score, WorldSnapshot } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { createObserver } from '../../src/observer';

const params = makeParams(4);
const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const formation = expandRecipe(score.movements[0].recipe, params.n0, params);
function snapshot(tick: number, dead: number[] = [], repaired = false): WorldSnapshot {
  return {
    tick, radio: [], jams: [], partitions: [], collisions: [], nearMisses: [],
    drones: formation.slots.map((slot, id) => {
      const held = repaired && id === 3 ? 0 : id;
      return { id, alive: !dead.includes(id), diedTick: dead.includes(id) ? 10 : null,
        pos: [...formation.slots[held].pos], vel: [0, 0, 0], colour: [1, 0, 0], partitionSide: null,
        belief: { slot: held, heldSince: repaired && id === 3 ? 20 : 0,
          target: [...formation.slots[held].pos], version: { ...score.version },
          deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] } };
    }),
  };
}

describe('public observer', () => {
  it('emits only every fifth tick, with position-based known answers and detached output', () => {
    const observer = createObserver(params);
    observer.registerScore(score);
    for (let tick = 1; tick < 5; tick++) expect(observer.sample(snapshot(tick))).toBeNull();
    const fifth = snapshot(5);
    const metrics = observer.sample(fifth)!;
    expect(metrics.coverage).toBe(1);
    expect(metrics.npwc).toBeCloseTo(1);
    expect(metrics.sfMean).toBeGreaterThanOrEqual(0);
    expect(observer.slotStatus(fifth).status).toEqual(['occupied', 'occupied', 'occupied', 'occupied']);
    expect(observer.sample(fifth)).toBeNull();
    metrics.msgs.hb = 999;
    expect(observer.summary().msgsPerDroneSec).toBe(0);
    const slots = observer.slotStatus(fifth);
    slots.formation.slots[0].pos[0] = 999;
    expect(observer.slotStatus(fifth).formation.slots[0].pos[0]).not.toBe(999);
  });
  it('keeps a static world measured against its preloaded score after injection registration', () => {
    const observer = createObserver(params);
    observer.registerScore(score);
    const injected: Score = { version: { issuedTick: 2, origin: 1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'helix' } }] };
    observer.registerScore(injected);
    observer.recordEvent({ type: 'INJECT_SCORE', tick: 2, droneId: 1, score: injected });
    for (let tick = 1; tick <= 5; tick++) observer.sample(snapshot(tick));
    expect(observer.slotStatus(snapshot(5)).formation).toEqual(formation);
    expect(observer.summary().unadopted).toBe(4);
    expect(observer.summary().adoptMax).toBeNull();
  });
  it('uses explicit kill time and twelve consecutive hold samples for recovery', () => {
    const observer = createObserver(params);
    observer.registerScore(score);
    observer.recordEvent({ type: 'KILL', tick: 10, ids: [0] });
    for (let tick = 1; tick <= 80; tick++) observer.sample(snapshot(tick, tick >= 10 ? [0] : [], tick >= 20));
    expect(observer.summary().tRec).toBeCloseTo(0.5);
    expect(observer.summary().slotChanges).toBe(1);
    expect(observer.summary().slotChangesMaxDrone).toBe(1);
  });
  it('emits JSON-safe null normalisation/fidelity for an empty swarm', () => {
    const observer = createObserver(params);
    observer.registerScore(score);
    observer.recordEvent({ type: 'KILL', tick: 10, ids: [0, 1, 2, 3] });
    let metrics;
    for (let tick = 1; tick <= 10; tick++) metrics = observer.sample(snapshot(tick, tick >= 10 ? [0, 1, 2, 3] : []));
    expect(metrics).toMatchObject({ alive: 0, coverage: 0, pwc: 0, npwc: null, sfMean: null, sfMax: null });
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics);
    expect(observer.slotStatus(snapshot(10, [0, 1, 2, 3])).status).toEqual(['vacant', 'vacant', 'vacant', 'vacant']);
    expect(observer.summary().tRec).toBeNull();
  });
  it('copies metadata and never uses future scheduled events early', () => {
    const observer = createObserver(params);
    observer.registerScore(score);
    const event = { type: 'KILL' as const, tick: 10, ids: [0] };
    observer.recordEvent(event);
    event.tick = 2;
    for (let tick = 1; tick <= 5; tick++) observer.sample(snapshot(tick));
    expect(observer.summary()).not.toHaveProperty('tRec');
    expect(() => observer.recordEvent({ type: 'KILL', tick: 0, ids: [] })).toThrow('event tick');
  });
});
