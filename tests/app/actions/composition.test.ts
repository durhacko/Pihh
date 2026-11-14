import { describe, expect, it, vi } from 'vitest';
import { makeParams, type Score } from '../../../src/contracts';
import { composeNext } from '../../../src/score';
import { createWorld } from '../../../src/sim';
import { createActionController, type ControlContext } from '../../../src/app/actions';
import { dummyBrain } from '../../fixtures/dummyBrain';

/** Adapter unit test: real composer and real initial snapshots, explicit schedule recorders.
 * Actual operator inbox delivery requires WP-2b and is validated separately after #19. */
function setup() {
  const params = makeParams(40);
  const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
  const actual = { encore: createWorld({ seed: 101, params, score, brain: dummyBrain }), static: createWorld({ seed: 101, params, score, brain: dummyBrain }) };
  const snapshots = { encore: actual.encore.step(), static: actual.static.step() };
  const calls: string[] = [];
  const worlds = {
    encore: { ...actual.encore, schedule: vi.fn(() => { calls.push('encore'); }) },
    static: { ...actual.static, schedule: vi.fn(() => { calls.push('static'); }) },
  };
  const registerScore = vi.fn(() => { calls.push('register'); });
  const onScheduledEvent = vi.fn(() => { calls.push('event'); });
  const context: ControlContext = {
    params, getWorlds: () => worlds, getSnapshots: () => snapshots, getScore: () => score,
    getTransport: () => ({ playing: true, speed: 1, seed: 101 }), setPlaying() {}, setSpeed() {}, reset() {},
    composeScore: composeNext, radioFaults: true, registerScore, onScheduledEvent,
  };
  return { params, score, snapshots, calls, worlds, registerScore, onScheduledEvent, controller: createActionController(context) };
}

describe('real score composer at the action boundary', () => {
  it('authors once at the injection tick and schedules deep-equal scores into both arms', () => {
    const fixture = setup(); fixture.controller.selectDrone(4);
    const result = fixture.controller.handle({ type: 'inject', recipe: { kind: 'text', text: 'bravo' } });
    expect(result.ok).toBe(true);
    expect(result.event?.type).toBe('INJECT_SCORE');
    if (result.event?.type !== 'INJECT_SCORE') throw new Error('Expected injection');
    expect(result.event.tick).toBe(2); expect(result.event.droneId).toBe(4);
    expect(result.event.score).toEqual(composeNext(fixture.score, 2, { kind: 'text', text: 'BRAVO' }, 4, 40, fixture.params));
    expect(fixture.worlds.encore.schedule).toHaveBeenCalledExactlyOnceWith(result.event);
    expect(fixture.worlds.static.schedule).toHaveBeenCalledExactlyOnceWith(result.event);
    expect(fixture.calls).toEqual(['encore', 'static', 'register', 'event']);
    expect(fixture.registerScore).toHaveBeenCalledExactlyOnceWith(result.event.score);
    expect(fixture.onScheduledEvent).toHaveBeenCalledExactlyOnceWith(result.event);
    expect(fixture.score.movements).toHaveLength(1);
  });
  it('uses the latest authored score for subsequent composition without touching a brain', () => {
    const fixture = setup(); fixture.controller.selectDrone(4);
    const first = fixture.controller.handle({ type: 'inject', recipe: { kind: 'text', text: 'BRAVO' } }).event;
    if (first?.type !== 'INJECT_SCORE') throw new Error('Expected first injection');
    fixture.snapshots.encore.tick = 100; fixture.snapshots.static.tick = 100;
    const second = fixture.controller.handle({ type: 'inject', recipe: { kind: 'helix' } }).event;
    if (second?.type !== 'INJECT_SCORE') throw new Error('Expected second injection');
    expect(second.score).toEqual(composeNext(first.score, 101, { kind: 'helix' }, 4, 40, fixture.params));
    expect(second.score.movements[0].recipe).toEqual({ kind: 'text', text: 'BRAVO' });
    expect(second.score.movements[1].startTick).toBe(101 + fixture.params.scoreLead);
  });
  it('rejects invalid text and missing/live-dead selections before scheduling either arm', () => {
    const fixture = setup(); expect(fixture.controller.handle({ type: 'inject', recipe: { kind: 'sphere' } }).ok).toBe(false);
    fixture.controller.selectDrone(4);
    expect(fixture.controller.handle({ type: 'inject', recipe: { kind: 'text', text: '@@@' } }).ok).toBe(false);
    fixture.snapshots.encore.drones[4].alive = false;
    expect(fixture.controller.handle({ type: 'inject', recipe: { kind: 'helix' } }).ok).toBe(false);
    expect(fixture.worlds.encore.schedule).not.toHaveBeenCalled(); expect(fixture.worlds.static.schedule).not.toHaveBeenCalled();
  });
});
