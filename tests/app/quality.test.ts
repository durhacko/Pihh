// tests/app/quality.test.ts
// The render quality ladder (src/app/render/quality.ts): ?q= parsing, automatic step-down below 30 fps (warm-up,
// hold, one level at a time, never back up, gaps ignored), forced levels, and the plain-heartbeat trim in the
// radio trace (claims and SCOREs always drawn; the drawn/observed counts stay honest).
import { describe, expect, it } from 'vitest';
import type { RadioEvent, WorldSnapshot } from '../../src/contracts';
import { makeFakeSnapshot } from '../fixtures/fakeSnapshot';
import { RadioTrace } from '../../src/app/render/colourModes/radioTrace';
import {
  AUTO_FPS_FLOOR, FPS_WINDOW_MS, GAP_MS, HOLD_MS, LOWEST_QUALITY, QUALITY_LADDER, QualityController, SUSTAIN_WINDOWS, WARMUP_MS, parseQuality,
} from '../../src/app/render/quality';

/** Feeds frames at `fps` for `ms` starting at `t`; returns the time after the last frame. */
function run(q: QualityController, t: number, fps: number, ms: number): number {
  const step = 1000 / fps;
  for (let now = t; now < t + ms; now += step) q.frame(now);
  return t + ms;
}

describe('?q= parsing', () => {
  it('auto by default; low = lowest, high = 0, a digit = that level, all forced; nonsense = auto', () => {
    expect(parseQuality('')).toEqual({ level: 0, mode: 'auto' });
    expect(parseQuality('?split=1')).toEqual({ level: 0, mode: 'auto' });
    expect(parseQuality('?q=low')).toEqual({ level: LOWEST_QUALITY, mode: 'forced' });
    expect(parseQuality('?q=high')).toEqual({ level: 0, mode: 'forced' });
    expect(parseQuality('?seed=4&q=2')).toEqual({ level: 2, mode: 'forced' });
    expect(parseQuality('?q=9')).toEqual({ level: 0, mode: 'auto' });
    expect(parseQuality('?q=medium')).toEqual({ level: 0, mode: 'auto' });
  });
  it('the ladder is the documented order and ends at the half-rate static view', () => {
    expect(QUALITY_LADDER).toEqual(['full', 'plain heartbeat lines off', 'halos off', 'pixel ratio 1', 'static view at half rate in split']);
    expect(LOWEST_QUALITY).toBe(4);
  });
});

describe('automatic stepping', () => {
  it('stays at full quality at 60 fps (and at 180 fps: nothing changes at high frame rates)', () => {
    for (const fps of [60, 180]) {
      const q = new QualityController();
      run(q, 0, fps, 20_000);
      expect(q.level).toBe(0);
      expect(q.fps).toBeGreaterThan(fps * 0.9);
    }
  });

  it('a brief dip (fewer than SUSTAIN_WINDOWS slow windows) never steps down', () => {
    const q = new QualityController();
    let t = run(q, 0, 60, WARMUP_MS + 2000);
    for (let i = 0; i < 5; i++) {
      t = run(q, t, 15, (SUSTAIN_WINDOWS - 1) * FPS_WINDOW_MS);   // two slow windows...
      t = run(q, t, 60, FPS_WINDOW_MS * 2);                         // ...then recovered
    }
    expect(q.level).toBe(0);
  });

  it('below the floor: waits out the warm-up, then steps one level at a time, HOLD_MS apart, down to the lowest only', () => {
    const q = new QualityController();
    const steps: { level: number; at: number }[] = [];
    for (let now = 0; now < 60_000; now += 1000 / 15) if (q.frame(now)) steps.push({ level: q.level, at: now });
    expect(steps.map(s => s.level)).toEqual([1, 2, 3, 4]);          // one level at a time, in order, never past 4
    expect(steps[0].at).toBeGreaterThanOrEqual(WARMUP_MS);           // nothing during warm-up, however slow
    for (let i = 1; i < steps.length; i++) expect(steps[i].at - steps[i - 1].at).toBeGreaterThanOrEqual(HOLD_MS);
    expect(q.level).toBe(LOWEST_QUALITY);
    expect(q.fps).toBeLessThan(AUTO_FPS_FLOOR);
  });

  it('never steps back up when the frame rate recovers (no flicker in a demo)', () => {
    const q = new QualityController();
    const t = run(q, 0, 15, WARMUP_MS + FPS_WINDOW_MS * 2 + HOLD_MS);
    const degraded = q.level;
    expect(degraded).toBeGreaterThan(0);
    run(q, t, 120, 30_000);
    expect(q.level).toBe(degraded);
  });

  it('stops stepping once the frame rate is back above the floor', () => {
    const q = new QualityController();
    const t = run(q, 0, 20, WARMUP_MS + SUSTAIN_WINDOWS * FPS_WINDOW_MS + 10);
    const reached = q.level;
    expect(reached).toBeGreaterThan(0);
    run(q, t, 40, 30_000);
    expect(q.level).toBe(reached);
  });

  it('a gap longer than GAP_MS (debugger, sleep) restarts the window instead of reading as a slow frame rate', () => {
    const q = new QualityController();
    let t = run(q, 0, 60, WARMUP_MS + 1000);
    for (let i = 0; i < 6; i++) { t += GAP_MS + 1000; t = run(q, t, 60, 400); }   // rare bursts of frames
    expect(q.level).toBe(0);
  });

  it('a hidden tab (restartWindow on visibilitychange, frames not fed while hidden) never steps down', () => {
    const q = new QualityController();
    let t = run(q, 0, 60, WARMUP_MS + 1000);
    for (let i = 0; i < 6; i++) {
      q.restartWindow(); t += 3000;          // hidden for 3 s: the monitor feeds nothing
      q.restartWindow(); t = run(q, t, 60, 1000);   // visible again at full speed
    }
    expect(q.level).toBe(0);
  });

  it('a really slow machine (1.5 fps: every frame gap over 500 ms) is still judged and steps down to the lowest level', () => {
    const q = new QualityController();
    run(q, 0, 1.5, 120_000);
    expect(q.level).toBe(LOWEST_QUALITY);
  });
});

describe('forced levels', () => {
  it('?q=low starts at the lowest level and ?q=high stays at 0 however slow the frames are', () => {
    const low = new QualityController(parseQuality('?q=low'));
    const high = new QualityController(parseQuality('?q=high'));
    run(low, 0, 5, 60_000);
    run(high, 0, 5, 60_000);
    expect(low.level).toBe(LOWEST_QUALITY);
    expect(high.level).toBe(0);
    expect(low.describe()).toBe('Quality 4/4 · static view at half rate in split · forced by ?q=');
  });

  it('subscribe reports the current level at once; unsubscribe stops further calls', () => {
    const q = new QualityController();
    const seen: number[] = [];
    const off = q.subscribe(level => seen.push(level));
    expect(seen).toEqual([0]);
    off();
    run(q, 0, 10, 60_000);
    expect(seen).toEqual([0]);
    expect(q.describe()).toMatch(/^Quality 4\/4 · static view at half rate in split · auto below 30 fps$/);
  });
});

describe('plain heartbeat lines (quality level >= 1)', () => {
  function event(overrides: Partial<RadioEvent> = {}): RadioEvent {
    return { tick: 1, from: 0, type: 'HB', claimSlot: null, delivered: [1, 2, 4], lost: 0, jammed: 0, partitioned: 0, ...overrides };
  }
  const snap: WorldSnapshot = { ...makeFakeSnapshot(1, 40), radio: [event(), event(), event({ claimSlot: 2 }), event({ type: 'SCORE' })] };

  it('drops only the plain heartbeat segments; claims and SCOREs are drawn as before; drawn <= observed', () => {
    const full = new RadioTrace(); full.update(snap, snap);
    const trimmed = new RadioTrace(); trimmed.update(snap, snap);
    const all = full.plan(1, 0, null, true, true);
    const some = trimmed.plan(1, 0, null, true, false);
    expect(all.segments).toHaveLength(9);
    expect(some.segments).toHaveLength(6);                                  // claim (3) + SCORE (3)
    expect(some.segments.every(s => s.colour[0] !== 0.22)).toBe(true);     // no plain-heartbeat colour left
    expect(some.logged).toBe(all.logged);                                   // observed deliveries unchanged
    expect(some.drawn).toBe(6);
    expect(some.drawn).toBeLessThanOrEqual(some.logged);
  });

  it('the default (no argument) keeps plain lines, as before', () => {
    const t = new RadioTrace(); t.update(snap, snap);
    expect(t.plan(1, 0).segments).toHaveLength(9);
  });
});

describe('the level reaches the HUD (hudPayload.quality)', () => {
  it('hudPayload carries the shared controller\'s description', async () => {
    const { createWorlds, hudPayload } = await import('../../src/app/worlds');
    const { sharedQuality } = await import('../../src/app/render/quality');
    const worlds = createWorlds({ seed: 1, n0: 20 });
    worlds.stepBoth();
    const payload = hudPayload(worlds, { fps: 30, layout: 'encore' });
    expect(payload.quality).toBe(sharedQuality().describe());
    expect(payload.quality).toMatch(/^Quality [0-4]\/4 · /);
  });
});

describe('the level in the readout (#113 shell, Readout.ts)', () => {
  it('shows nothing at full quality, and a muted "Qn/4 · rung" item below it', async () => {
    const { readoutItems } = await import('../../src/app/ui/Readout');
    const base = { samples: { encore: null, static: null }, view: 'encore' as const, n0: 200, phase: null, fps: 60, stopped: null };
    const q = (level: number) => ({ level, lowest: LOWEST_QUALITY, name: QUALITY_LADDER[level], description: `Quality ${level}/4` });
    expect(readoutItems({ ...base, quality: q(0) }).some(i => i.key === 'quality')).toBe(false);
    expect(readoutItems(base).some(i => i.key === 'quality')).toBe(false);
    const item = readoutItems({ ...base, quality: q(2) }).find(i => i.key === 'quality');
    expect(item).toEqual({ key: 'quality', label: 'Q2/4', value: 'halos off', muted: true, title: 'Quality 2/4' });
  });
});
