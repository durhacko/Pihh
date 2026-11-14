import { describe, expect, it } from 'vitest';
import type { RadioEvent, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import { HIGHLIGHT_RECEIVER_CAP, RadioTrace } from '../../../src/app/render/colourModes/radioTrace';

function event(overrides: Partial<RadioEvent> = {}): RadioEvent {
  return { tick: 1, from: 0, type: 'HB', claimSlot: null, delivered: [1, 2, 4], lost: 0, jammed: 0, partitioned: 0, ...overrides };
}
function snapshot(tick: number, radio: RadioEvent[] = [], n0 = 40): WorldSnapshot { return { ...makeFakeSnapshot(tick, n0), radio }; }

describe('snapshot radio evidence', () => {
  it('draws no deliveries or dropped stubs when the observed log is empty', () => {
    const trace = new RadioTrace(); const snap = snapshot(1); trace.update(snap, snap);
    expect(trace.plan(1, 0)).toEqual({ segments: [], stubs: [], drawn: 0, logged: 0 });
  });
  it('samples ordinary heartbeats but highlights claim and SCORE broadcasts first', () => {
    const trace = new RadioTrace(); const snap = snapshot(1, [event(), event(), event({ claimSlot: 2 }), event({ type: 'SCORE' })]);
    trace.update(snap, snap); const plan = trace.plan(1, 0);
    expect(plan.logged).toBe(12); expect(plan.drawn).toBe(9); expect(plan.segments).toHaveLength(9);
    expect(plan.segments[0].colour).toEqual([0.12, 0.95, 1]);
    expect(plan.segments[3].colour).toEqual([1, 0.12, 0.72]);
    expect(plan.segments.every(line => [1, 2, 4].includes(line.receiver))).toBe(true);
  });
  it('caps each highlighted broadcast and never draws more links than logged deliveries', () => {
    const trace = new RadioTrace(); const delivered = Array.from({ length: 35 }, (_, index) => index + 1);
    const snap = snapshot(1, [event({ type: 'SCORE', delivered })]); trace.update(snap, snap);
    const plan = trace.plan(1, 0); expect(plan.segments).toHaveLength(HIGHLIGHT_RECEIVER_CAP);
    expect(plan.drawn).toBeLessThanOrEqual(plan.logged);
  });
  it('does not replay broadcasts or double-count links when the same tick renders repeatedly', () => {
    const trace = new RadioTrace(); const snap = snapshot(1, [event()]); trace.update(snap, snap);
    const first = trace.plan(1, 0.2);
    for (let i = 0; i < 50; i++) { trace.update(snap, snap); expect(trace.plan(1, 0.2)).toEqual(first); }
  });
  it('filters selection honestly and never counts links while X-ray is hidden', () => {
    const trace = new RadioTrace(); const snap = snapshot(1, [event({ type: 'SCORE' })]); trace.update(snap, snap);
    expect(trace.plan(1, 0, null, false).drawn).toBe(0);
    const selected = trace.plan(1, 0, 2); expect(selected.segments).toHaveLength(1); expect(selected.drawn).toBe(1); expect(selected.logged).toBe(3);
    expect(trace.plan(1, 0, 10).segments).toHaveLength(0);
  });
  it('uses only non-zero drop reasons for sender stubs, never guessed receivers', () => {
    const trace = new RadioTrace(); const snap = snapshot(1, [event({ delivered: [], lost: 7, jammed: 2 })]); trace.update(snap, snap);
    const plan = trace.plan(1, 0); expect(plan.segments).toHaveLength(0); expect(plan.logged).toBe(0);
    expect(plan.stubs.map(stub => [stub.reason, stub.count])).toEqual([['lost', 7], ['jammed', 2]]);
    expect(plan.stubs.every(stub => !('receiver' in stub))).toBe(true);
  });
  it('fades over 0.3 simulation seconds, expires evidence after one second, and clears on reset', () => {
    const trace = new RadioTrace(); const first = snapshot(1, [event()]); trace.update(first, first);
    expect(trace.plan(1, 0).segments[0].opacity).toBe(1);
    expect(trace.plan(4, 0).segments[0].opacity).toBeCloseTo(0.5);
    expect(trace.plan(8, 0).segments).toHaveLength(0);
    const later = snapshot(21); trace.update(later, later); expect(trace.plan(21, 0).logged).toBe(0);
    trace.update(first, first); expect(trace.plan(1, 0).logged).toBe(3);
    const reset = snapshot(0); trace.update(reset, reset); expect(trace.plan(0, 0).logged).toBe(0);
  });
  it('does not mutate snapshots and skips missing endpoints instead of inventing locations', () => {
    const trace = new RadioTrace(); const snap = snapshot(1, [event({ type: 'SCORE', delivered: [1, 99] })]); const before = JSON.stringify(snap);
    trace.update(snap, snap); const plan = trace.plan(1, 0); expect(plan.segments).toHaveLength(1); expect(plan.logged).toBe(2); expect(JSON.stringify(snap)).toBe(before);
  });
});
