// tests/app/encoreArm.test.ts
// G2 (#6): the app's two worlds now fly real brains. A regional KILL scheduled through the app's own path
// (scheduleBoth, the same event into both worlds) leaves a hole that the Encore world refills and the static
// world keeps. Same set-up as G1 (tests/g1/helpers.ts) at n0 40: one text movement in a long hold, the kill at
// the first tick by which every drone can heal, the five drones nearest a seeded centre, 30 s window.
import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '../../src/contracts';
import { createWorlds } from '../../src/app/worlds';
import { analyseKill, centreFor, killSetUp } from '../g1/helpers';

describe('Encore arm versus static arm in the app', () => {
  it('a regional kill scheduled through scheduleBoth is refilled by the Encore world and not by the static one', () => {
    const s = killSetUp(1, 40, 5, centreFor(1, 40));
    const worlds = createWorlds({ seed: s.seed, n0: s.n0, params: s.params, score: s.score });
    expect(worlds.worlds.encore.config.brain.kind).toBe('encore');
    expect(worlds.worlds.static.config.brain.kind).toBe('static');
    const encore: WorldSnapshot[] = [];
    const baseline: WorldSnapshot[] = [];
    while (worlds.tick < s.endTick) {
      if (worlds.tick === s.killTick - 1) worlds.scheduleBoth({ type: 'KILL', tick: s.killTick, ids: s.killed });
      const snaps = worlds.stepBoth();
      encore.push(snaps.encore);
      baseline.push(snaps.static);
    }
    const r = analyseKill(s, encore, baseline);

    // Set-up: both arms complete before the kill, the same drones die in both on the kill tick.
    expect(r.ready.allOnOwnSlot).toBe(true);
    expect(r.encore.npwcBefore).toBeCloseTo(1, 12);
    expect(r.fixed.npwcBefore).toBeCloseTo(1, 12);
    expect(r.encore.npwcAfter).toBeCloseTo(r.fixed.npwcAfter ?? -1, 12);
    expect(r.encore.npwcAfter!).toBeLessThan(1);
    for (const arm of [encore, baseline]) expect(arm[s.killTick - 1].drones.filter(d => !d.alive).map(d => d.id)).toEqual(s.killed);

    // Outcome: the static world keeps the hole; the Encore world refills it (G1's verdict, through the app).
    expect(r.fixed.npwcEnd).toBeCloseTo(r.fixed.npwcAfter ?? -1, 12);
    expect(r.encore.npwcEnd!).toBeGreaterThan(r.fixed.npwcEnd!);
    expect(r.commits.length).toBeGreaterThan(0);
    expect(r.verdict).toMatchObject({ dupOk: true, quietOk: true, countOk: true, lowerOk: true, npwcOk: true, all: true });

    // What the app shows (the readout / HUD) comes from the observers: they agree on the direction.
    const samples = worlds.samples();
    expect(samples.encore!.npwc!).toBeGreaterThan(samples.static!.npwc!);
    expect(samples.encore!.alive).toBe(35);
    expect(samples.static!.alive).toBe(35);
    // And the Encore world really talks: heartbeats in the radio log, none from the static world.
    expect(encore.some(x => x.radio.length > 0)).toBe(true);
    expect(baseline.every(x => x.radio.length === 0)).toBe(true);
  }, 120_000);
});
