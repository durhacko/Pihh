// tests/app/worlds.test.ts
// WP-3b (#6): the app's two worlds, headless. Real createWorld, real score, real static brain.
import { describe, expect, it, vi } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { EnvEvent, WorldSnapshot } from '../../src/contracts';
import { ARMS, createWorlds, DEFAULT_N0, encoreBrainIsFixture, idsInRegion, killEvent, type Pair, type Worlds } from '../../src/app/worlds';

const SEED = 1234;
const aliveCount = (s: WorldSnapshot) => s.drones.filter(d => d.alive).length;

function runTo(worlds: Worlds, tick: number): Pair<WorldSnapshot> {
  let last = worlds.latest();
  while (worlds.tick < tick) last = worlds.stepBoth();
  return last!;
}
function hashes(worlds: Worlds): Pair<string> {
  return { encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() };
}

describe('createWorlds', () => {
  it('builds both arms from the same seed, params and preloaded score (ENCORE, sphere, helix), n0 200 by default', () => {
    const worlds = createWorlds({ seed: SEED });
    expect(DEFAULT_N0).toBe(200);
    expect(worlds.params).toEqual(makeParams(200));
    expect(worlds.score.movements.map(m => m.recipe)).toEqual([{ kind: 'text', text: 'ENCORE' }, { kind: 'sphere' }, { kind: 'helix' }]);
    const { encore, static: baseline } = worlds.worlds;
    expect(encore).not.toBe(baseline);
    expect(encore.config.seed).toBe(SEED);
    expect(baseline.config.seed).toBe(SEED);
    expect(encore.config.params).toEqual(baseline.config.params);
    expect(encore.config.score).toEqual(baseline.config.score);
    expect(baseline.config.brain.kind).toBe('static');
    expect(encoreBrainIsFixture).toBe(encore.config.brain.kind !== 'encore');
    expect(worlds.tick).toBe(0);
    expect(worlds.latest()).toBeNull();
  });

  it('rejects an n0 that disagrees with params, and a seed that is not a uint32', () => {
    expect(() => createWorlds({ seed: 1, n0: 10, params: makeParams(20) })).toThrow(RangeError);
    expect(() => createWorlds({ seed: -1, n0: 10 })).toThrow(RangeError);
    expect(() => createWorlds({ seed: 1.5, n0: 10 })).toThrow(RangeError);
  });

  it('keeps both worlds on the same tick, one tick per stepBoth', () => {
    const worlds = createWorlds({ seed: SEED });
    for (let t = 1; t <= 60; t++) {
      const s = worlds.stepBoth();
      expect(s.encore.tick).toBe(t);
      expect(s.static.tick).toBe(t);
      expect(worlds.tick).toBe(t);
      expect(worlds.latest()).toBe(s);
      expect(s.encore.drones).toHaveLength(200);
      expect(s.static.drones).toHaveLength(200);
    }
  });

  it('drones lift off the launch grid toward the first formation', () => {
    const worlds = createWorlds({ seed: SEED });
    const s = runTo(worlds, 100);
    for (const arm of ARMS) {
      const meanHeight = s[arm].drones.reduce((sum, d) => sum + d.pos[1], 0) / s[arm].drones.length;
      expect(meanHeight).toBeGreaterThan(1);
    }
  });
});

describe('scheduleBoth', () => {
  it('schedules the same event object into both worlds', () => {
    const worlds = createWorlds({ seed: SEED, n0: 30 });
    runTo(worlds, 5);
    const encoreSpy = vi.spyOn(worlds.worlds.encore, 'schedule');
    const staticSpy = vi.spyOn(worlds.worlds.static, 'schedule');
    const event: EnvEvent = { type: 'KILL', tick: 6, ids: [1] };
    worlds.scheduleBoth(event);
    expect(encoreSpy).toHaveBeenCalledWith(event);
    expect(encoreSpy.mock.calls[0][0]).toBe(event);
    expect(staticSpy.mock.calls[0][0]).toBe(event);
  });

  it('a KILL lowers alive by exactly the same ids in both worlds on the next tick', () => {
    const worlds = createWorlds({ seed: SEED });
    const before = runTo(worlds, 40);
    const ids = [0, 7, 99, 199];
    const event = killEvent(worlds, [99, 7, 0, 199, 7]);
    expect(event).toEqual({ type: 'KILL', tick: 41, ids });
    worlds.scheduleBoth(event);
    const after = worlds.stepBoth();
    for (const arm of ARMS) {
      expect(aliveCount(before[arm])).toBe(200);
      expect(aliveCount(after[arm])).toBe(196);
      const dead = after[arm].drones.filter(d => !d.alive);
      expect(dead.map(d => d.id)).toEqual(ids);
      expect(dead.every(d => d.diedTick === 41)).toBe(true);
    }
    // Stays dead, and the worlds keep stepping in lockstep.
    const later = runTo(worlds, 60);
    for (const arm of ARMS) expect(aliveCount(later[arm])).toBe(196);
  });

  it('rejects an event that is not after the shared tick, in neither world', () => {
    const worlds = createWorlds({ seed: SEED, n0: 30 });
    runTo(worlds, 10);
    const encoreSpy = vi.spyOn(worlds.worlds.encore, 'schedule');
    const staticSpy = vi.spyOn(worlds.worlds.static, 'schedule');
    expect(() => worlds.scheduleBoth({ type: 'KILL', tick: 10, ids: [1] })).toThrow();
    expect(() => worlds.scheduleBoth({ type: 'KILL', tick: 10.5, ids: [1] })).toThrow();
    expect(encoreSpy).not.toHaveBeenCalled();
    expect(staticSpy).not.toHaveBeenCalled();
  });

  it('killEvent refuses ids outside the roster', () => {
    const worlds = createWorlds({ seed: SEED, n0: 30 });
    expect(() => killEvent(worlds, [30])).toThrow(RangeError);
    expect(() => killEvent(worlds, [-1])).toThrow(RangeError);
    expect(() => killEvent(worlds, [1.5])).toThrow(RangeError);
  });
});

describe('idsInRegion', () => {
  it('returns live drones within the radius, ascending, from one snapshot', () => {
    const worlds = createWorlds({ seed: SEED });
    const s = runTo(worlds, 80).encore;
    const centre = s.drones[50].pos;
    const ids = idsInRegion(s, centre, 4);
    expect(ids).toContain(50);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    for (const d of s.drones) {
      const inside = Math.hypot(d.pos[0] - centre[0], d.pos[1] - centre[1], d.pos[2] - centre[2]) <= 4;
      expect(ids.includes(d.id)).toBe(inside && d.alive);
    }
    worlds.scheduleBoth(killEvent(worlds, [50]));
    expect(idsInRegion(worlds.stepBoth().encore, centre, 4)).not.toContain(50);
    expect(() => idsInRegion(s, centre, 0)).toThrow(RangeError);
  });
});

describe('determinism', () => {
  it('reset(seed) reproduces the same stateHash at tick 200 for each arm', () => {
    const worlds = createWorlds({ seed: SEED });
    runTo(worlds, 200);
    const first = hashes(worlds);
    worlds.reset(SEED + 1);
    expect(worlds.tick).toBe(0);
    expect(worlds.latest()).toBeNull();
    expect(worlds.seed).toBe(SEED + 1);
    runTo(worlds, 200);
    expect(hashes(worlds).encore).not.toBe(first.encore);
    worlds.reset(SEED);
    runTo(worlds, 200);
    expect(hashes(worlds)).toEqual(first);
  }, 15_000); // Bounded headroom for CPU contention across concurrent local check runs.

  it('two runs with the same seed and events give identical hashes and snapshots', () => {
    const script = (worlds: Worlds) => {
      const snaps: Pair<WorldSnapshot>[] = [];
      while (worlds.tick < 200) {
        if (worlds.tick === 60) worlds.scheduleBoth(killEvent(worlds, idsInRegion(worlds.latest()!.encore, worlds.latest()!.encore.drones[120].pos, 5)));
        snaps.push(worlds.stepBoth());
      }
      return snaps;
    };
    const a = createWorlds({ seed: SEED });
    const b = createWorlds({ seed: SEED });
    const runA = script(a);
    const runB = script(b);
    expect(hashes(a)).toEqual(hashes(b));
    expect(runA[199]).toEqual(runB[199]);
    expect(aliveCount(runA[199].encore)).toBeLessThan(200);
    expect(aliveCount(runA[199].encore)).toBe(aliveCount(runA[199].static));
  });
});
