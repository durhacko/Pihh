// tests/app/xray/radioSendTime.test.ts
// #149: X-ray radio links are drawn where the medium decided them, i.e. at the positions the drones had when the
// message was sent (the previous snapshot), never at the post-move positions of the same tick. So no drawn link is
// longer than rRadio.
import { describe, expect, it } from 'vitest';
import type { RadioEvent, Vec3, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import { RadioTrace } from '../../../src/app/render/colourModes/radioTrace';
import { createWorlds } from '../../../src/app/worlds';

function event(overrides: Partial<RadioEvent> = {}): RadioEvent {
  return { tick: 2, from: 0, type: 'SCORE', claimSlot: null, delivered: [1], lost: 0, jammed: 0, partitioned: 0, ...overrides };
}
function snapshotAt(tick: number, positions: Vec3[], radio: RadioEvent[] = []): WorldSnapshot {
  const base = makeFakeSnapshot(tick, positions.length);
  return { ...base, tick, radio, drones: base.drones.map((d, i) => ({ ...d, pos: positions[i] })) };
}

describe('radio links use send-time positions (#149)', () => {
  it('a tick-2 broadcast is drawn between the tick-1 (pre-move) positions', () => {
    const trace = new RadioTrace();
    trace.ingest(snapshotAt(1, [[0, 30, 0], [14.9, 30, 0]]));
    trace.ingest(snapshotAt(2, [[-0.4, 30, 0], [15.3, 30, 0]], [event()]));   // both moved 0.4 m apart: 15.7 m now
    const [segment] = trace.plan(2, 0).segments;
    expect(segment.from).toEqual([0, 30, 0]);
    expect(segment.to).toEqual([14.9, 30, 0]);
  });

  it('without the previous tick (first snapshot, or a gap), it falls back to the same tick', () => {
    const trace = new RadioTrace();
    trace.ingest(snapshotAt(5, [[0, 30, 0], [3, 30, 0]], [event({ tick: 5 })]));
    expect(trace.plan(5, 0).segments[0].to).toEqual([3, 30, 0]);
    trace.ingest(snapshotAt(9, [[1, 30, 0], [4, 30, 0]], [event({ tick: 9 })]));   // ticks 6-8 never seen
    expect(trace.plan(9, 0).segments.some(s => s.to[0] === 4)).toBe(true);
  });

  it('reset forgets the previous positions', () => {
    const trace = new RadioTrace();
    trace.ingest(snapshotAt(1, [[0, 30, 0], [9, 30, 0]]));
    trace.reset();
    trace.ingest(snapshotAt(2, [[0, 30, 0], [2, 30, 0]], [event()]));
    expect(trace.plan(2, 0).segments[0].to).toEqual([2, 30, 0]);
  });

  it('on the real app worlds (seed 101, n0 200, ticks 300-360) no drawn link is longer than rRadio', () => {
    const worlds = createWorlds({ seed: 101 });
    const rRadio = worlds.params.rRadio;
    const trace = new RadioTrace();
    let drawn = 0;
    let longest = 0;
    for (let tick = 1; tick <= 360; tick++) {
      const snap = worlds.stepBoth().encore;
      trace.ingest(snap);
      if (snap.tick < 300) continue;
      for (const alpha of [0, 0.5, 0.99]) {
        for (const s of trace.plan(snap.tick, alpha).segments) {
          const a = new Float32Array(s.from), b = new Float32Array(s.to);   // as uploaded to the position attribute
          const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          longest = Math.max(longest, length);
          drawn++;
        }
      }
    }
    expect(drawn).toBeGreaterThan(1000);
    expect(longest).toBeLessThanOrEqual(rRadio + 1e-5);   // Float32 rounding only; was 15.0035 m before #149
  }, 60_000);
});
