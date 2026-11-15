// tests/app/xray/redteam134.test.ts
// Judge red-team #134: P1-10 belief colours no longer repeat while versions are held, and reset on a world reset;
// P1-4 the X-ray radio counter labels the selected-drone filter honestly and compares like with like.
import { afterEach, describe, expect, it } from 'vitest';
import type { RadioEvent, ScoreVersion, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import { resetVersionColours, versionColour } from '../../../src/app/render/colourModes/belief';
import { RadioTrace } from '../../../src/app/render/colourModes/radioTrace';
import { radioCounterText } from '../../../src/app/render/layers/RadioLayer';
import createBeliefLayer from '../../../src/app/render/layers/BeliefLayer';

afterEach(() => resetVersionColours());
const v = (issuedTick: number, origin = 0): ScoreVersion => ({ issuedTick, origin });
const key = (c: number[]) => c.join(',');

describe('belief colours (#134 P1-10)', () => {
  it('the versions held at the same time get distinct colours, however many versions came before', () => {
    // Inject one version after another for a long show: at each moment the preloaded version and the newest two are
    // held (coloured every frame); older ones are no longer held. Held colours must never collide.
    const held = [v(0, -1)];
    for (let n = 1; n <= 12; n++) {
      held.push(v(n * 100, n % 5));
      if (held.length > 3) held.splice(1, 1);          // the oldest injected version is no longer held
      for (let frame = 0; frame < 3; frame++) for (const h of held) versionColour(h);
      const colours = held.map(h => key(versionColour(h)));
      expect(new Set(colours).size, `after inject ${n}`).toBe(held.length);
    }
  });

  it('a held version keeps its colour while newer versions arrive', () => {
    const preloaded = v(0, -1);
    const first = key(versionColour(preloaded));
    for (let n = 1; n <= 10; n++) { versionColour(v(n * 50, 1)); versionColour(preloaded); }
    expect(key(versionColour(preloaded))).toBe(first);
  });

  it('a fifth version reuses the colour of the least recently used (no longer held) version, not a held one', () => {
    const vs = [v(1), v(2), v(3), v(4)];
    const colour = vs.map(x => key(versionColour(x)));
    expect(new Set(colour).size).toBe(4);
    for (const x of [vs[1], vs[2], vs[3]]) versionColour(x);   // vs[0] is no longer held
    expect(key(versionColour(v(5)))).toBe(colour[0]);
    expect([vs[1], vs[2], vs[3]].map(x => key(versionColour(x)))).toEqual(colour.slice(1));
  });

  it('a world reset starts the colours over (BeliefLayer.reset calls resetVersionColours)', () => {
    const before = key(versionColour(v(0, -1)));
    versionColour(v(7)); versionColour(v(8));
    createBeliefLayer().reset?.();
    expect(key(versionColour(v(8)))).toBe(before);           // the first version seen after reset gets palette[0]
  });
});

describe('X-ray radio counter with a selected drone (#134 P1-4)', () => {
  function event(overrides: Partial<RadioEvent> = {}): RadioEvent {
    return { tick: 1, from: 0, type: 'SCORE', claimSlot: null, delivered: [1, 2, 4], lost: 0, jammed: 0, partitioned: 0, ...overrides };
  }
  const snap: WorldSnapshot = { ...makeFakeSnapshot(1, 40), radio: [event(), event({ from: 5, delivered: [1, 6, 7] }), event({ from: 8, delivered: [9, 10] })] };

  it('counts the deliveries involving the selected drone as the denominator, and leaves the unfiltered plan unchanged', () => {
    const all = new RadioTrace(); all.update(snap, snap);
    const plain = all.plan(1, 0);
    expect(plain).toEqual({ segments: plain.segments, stubs: plain.stubs, drawn: 8, logged: 8 });
    expect('filteredTo' in plain).toBe(false);
    const sel = new RadioTrace(); sel.update(snap, snap);
    const one = sel.plan(1, 0, 1);
    expect(one.filteredTo).toBe(1);
    expect(one.involving).toBe(2);                   // drone 1 received from 0 and from 5; it sent nothing
    expect(one.drawn).toBe(2);
    expect(one.drawn).toBeLessThanOrEqual(one.involving!);
    expect(one.logged).toBe(8);                      // still every observed delivery
    const sender = new RadioTrace(); sender.update(snap, snap);
    expect(sender.plan(1, 0, 0).involving).toBe(3);  // drone 0 sent one SCORE delivered to 3
  });

  it('the counter says it is filtered, to whom, and gives both totals', () => {
    expect(radioCounterText(1, { drawn: 8, logged: 8 })).toBe('Radio view 1 · drawn 8 / 8 observed deliveries · last 1 s');
    expect(radioCounterText(2, { drawn: 2, logged: 8, involving: 2, filteredTo: 1 }))
      .toBe('Radio view 2 · drawn 2 of 2 deliveries involving #1 · filtered to #1 (all drones: 8) · last 1 s');
  });
});
