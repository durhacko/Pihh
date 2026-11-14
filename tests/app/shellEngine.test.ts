// tests/app/shellEngine.test.ts
// #92 follow-ups from the #97 review, headless: a failed tick latches the worlds until reset; error reporting
// never steps; a failure on the first tick after a reset keeps its root cause; refused play says why; the
// tick pipeline (main.ts's advance) and WorldView really forward every tick to the layers.
import { describe, expect, it } from 'vitest';
import type { AgentBrain, WorldSnapshot } from '../../src/contracts';
import { staticBrain } from '../../src/agent/staticBrain';
import { createActionController } from '../../src/app/actions';
import { WorldView } from '../../src/app/render/WorldView';
import type { Layer } from '../../src/app/render/Layer';
import { ARMS, controlContext, createTickPipeline, createWorlds, WorldsBrokenError, type Pair, type ShellHooks, type Worlds } from '../../src/app/worlds';

/** The static brain, except it throws on the ticks in `explode` (mutable, so a test can arm it later). */
function exploding(explode: Set<number>): AgentBrain {
  const inner = staticBrain as AgentBrain;
  return { ...inner, kind: 'encore', step(state, input) { if (explode.has(input.tick)) throw new Error(`brain exploded at tick ${input.tick}`); return inner.step(state, input); } };
}
function shell(worlds: Worlds, transport = { playing: false, speed: 1 }, extra: Partial<ShellHooks> = {}): ShellHooks {
  return {
    getSnapshots: () => worlds.latest()!,
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: seed => { worlds.reset(seed); worlds.stepBoth(); },
    step: () => { worlds.stepBoth(); },
    ...extra,
  };
}

describe('a failed tick is latched until reset', () => {
  it('stepBoth and scheduleBoth refuse with the root cause; reset clears it', () => {
    const explode = new Set([4]);
    const worlds = createWorlds({ seed: 2, n0: 20, brains: { encore: exploding(explode) } });
    for (let t = 1; t <= 3; t++) worlds.stepBoth();
    expect(() => worlds.stepBoth()).toThrow('brain exploded at tick 4');
    expect(worlds.broken?.message).toBe('brain exploded at tick 4');
    // The encore world stepped into tick 4 half-way; the static one did not. Nothing may run them further.
    expect(() => worlds.stepBoth()).toThrow(WorldsBrokenError);
    expect(() => worlds.stepBoth()).toThrow(/brain exploded at tick 4/);
    expect(() => worlds.scheduleBoth({ type: 'KILL', tick: 9, ids: [1] })).toThrow(WorldsBrokenError);
    explode.clear();
    worlds.reset(2);
    expect(worlds.broken).toBeNull();
    for (let t = 1; t <= 5; t++) expect(worlds.stepBoth().encore.tick).toBe(t);
  });

  it('an observer failure is not latched: both worlds stepped consistently', () => {
    const worlds = createWorlds({ seed: 2, n0: 20 });
    const original = worlds.observers.static.sample.bind(worlds.observers.static);
    worlds.observers.static.sample = s => { const r = original(s); if (s.tick === 2) throw new Error('observer hiccup'); return r; };
    worlds.stepBoth();
    expect(() => worlds.stepBoth()).toThrow('observer hiccup');
    expect(worlds.broken).toBeNull();
    expect(worlds.stepBoth().static.tick).toBe(3);
  });
});

describe('the controller says why play is refused', () => {
  it('play and step report the latched failure; scheduling is refused too', () => {
    const explode = new Set([3]);
    const worlds = createWorlds({ seed: 2, n0: 20, brains: { encore: exploding(explode) } });
    worlds.stepBoth(); worlds.stepBoth();
    expect(() => worlds.stepBoth()).toThrow();
    const transport = { playing: false, speed: 1 };
    const controller = createActionController(controlContext(worlds, shell(worlds, transport)));
    const play = controller.handle({ type: 'play' });
    expect(play.ok).toBe(false);
    expect(play.message).toMatch(/^Cannot play: the simulation stopped after a failed tick \(brain exploded at tick 3\)\. Press R to reset\.$/);
    expect(transport.playing).toBe(false);
    expect(controller.handle({ type: 'step' }).message).toMatch(/^Cannot step: .*brain exploded at tick 3/);
    const kill = controller.handle({ type: 'kill-random' });
    expect(kill.ok).toBe(false);
    expect(kill.message).toMatch(/brain exploded at tick 3/);
    explode.clear();
    expect(controller.handle({ type: 'reset', seed: 2 }).ok).toBe(true);
    expect(controller.handle({ type: 'play' }).ok).toBe(true);
    expect(transport.playing).toBe(true);
  });

  it('step advances exactly one tick and pauses', () => {
    const worlds = createWorlds({ seed: 2, n0: 20 });
    worlds.stepBoth();
    const transport = { playing: true, speed: 1 };
    const controller = createActionController(controlContext(worlds, shell(worlds, transport)));
    expect(controller.handle({ type: 'step' }).ok).toBe(true);
    expect(worlds.tick).toBe(2);
    expect(transport.playing).toBe(false);
  });

  it('kill-region and jam accept an explicit centre (a picked point), resolved once from the Encore snapshot', () => {
    const worlds = createWorlds({ seed: 2, n0: 40 });
    for (let t = 0; t < 60; t++) worlds.stepBoth();
    const controller = createActionController(controlContext(worlds, shell(worlds)));
    const centre = worlds.latest()!.encore.drones[7].pos;
    const kill = controller.handle({ type: 'kill-region', radius: 2, centre }).event!;
    expect(kill.type === 'KILL' && kill.ids.includes(7)).toBe(true);
    const jam = controller.handle({ type: 'jam', radius: 5, centre: [1, 2, 3] }).event!;
    expect(jam).toMatchObject({ type: 'JAM_ON', centre: [1, 2, 3], radius: 5 });
    const snaps = worlds.stepBoth();
    for (const arm of ARMS) expect(snaps[arm].jams).toEqual([{ id: 'operator-jam', centre: [1, 2, 3], radius: 5 }]);
  });
});

describe('tick pipeline (main.ts advance) and WorldView forwarding', () => {
  function targets() {
    const seen: Pair<number[]> = { encore: [], static: [] };
    const resets: string[] = [];
    const list = ARMS.map(arm => ({ arm, ingest: (s: WorldSnapshot) => { seen[arm].push(s.tick); }, reset: () => { resets.push(arm); } }));
    const pushed: Pair<number[]> = { encore: [], static: [] };
    const buffers = { encore: { push: (s: WorldSnapshot) => { pushed.encore.push(s.tick); } }, static: { push: (s: WorldSnapshot) => { pushed.static.push(s.tick); } } };
    return { seen, resets, list, pushed, buffers };
  }

  it('every view ingests every tick of its own arm, in order, and every buffer gets it', () => {
    const worlds = createWorlds({ seed: 2, n0: 20 });
    const t = targets();
    const pipeline = createTickPipeline(worlds, t.buffers, () => t.list);
    for (let i = 0; i < 7; i++) pipeline.advance();
    expect(t.seen).toEqual({ encore: [1, 2, 3, 4, 5, 6, 7], static: [1, 2, 3, 4, 5, 6, 7] });
    expect(t.pushed).toEqual(t.seen);
  });

  it('WorldView.ingest forwards each snapshot to every layer that has ingest; reset reaches every layer', () => {
    const got: string[] = [];
    const layer = (id: string, withIngest: boolean): Layer => ({
      id, init() {}, update() {}, setVisible() {}, dispose() {},
      ...(withIngest ? { ingest: (s: WorldSnapshot) => { got.push(`${id}:${s.tick}`); }, reset: () => { got.push(`${id}:reset`); } } : {}),
    });
    const fake = { layers: [layer('radio', true), layer('drones', false), layer('deaths', true)] };
    const snapshot = { tick: 9 } as WorldSnapshot;
    WorldView.prototype.ingest.call(fake as unknown as WorldView, snapshot);
    WorldView.prototype.reset.call(fake as unknown as WorldView);
    expect(got).toEqual(['radio:9', 'deaths:9', 'radio:reset', 'deaths:reset']);
  });

  it('current() never steps a world', () => {
    const worlds = createWorlds({ seed: 2, n0: 20 });
    const t = targets();
    const pipeline = createTickPipeline(worlds, t.buffers, () => t.list);
    pipeline.advance(); pipeline.advance();
    for (let i = 0; i < 10; i++) expect(pipeline.current()!.encore.tick).toBe(2);
    expect(worlds.tick).toBe(2);
  });

  it('a failure on the first tick after a reset keeps its root cause, and reporting cannot step', () => {
    const explode = new Set<number>();
    const worlds = createWorlds({ seed: 2, n0: 20, brains: { encore: exploding(explode) } });
    const t = targets();
    const pipeline = createTickPipeline(worlds, t.buffers, () => t.list);
    for (let i = 0; i < 5; i++) pipeline.advance();
    explode.add(1);
    expect(() => pipeline.restart(3)).toThrow('brain exploded at tick 1');
    expect(t.resets.sort()).toEqual(['encore', 'static']);
    expect(worlds.broken?.message).toBe('brain exploded at tick 1');
    expect(pipeline.current()).toBeNull();                 // nothing from the new show yet, and no old-world snapshot
    expect(worlds.tick).toBe(0);
    expect(() => pipeline.advance()).toThrow(/brain exploded at tick 1/);   // the root cause, not a lockstep error
    explode.clear();
    pipeline.restart(3);
    expect(pipeline.current()!.encore.tick).toBe(1);
  });

  it('a tick whose observer throws is still shown before the error surfaces', () => {
    const worlds = createWorlds({ seed: 2, n0: 20 });
    const t = targets();
    const pipeline = createTickPipeline(worlds, t.buffers, () => t.list);
    const original = worlds.observers.encore.sample.bind(worlds.observers.encore);
    worlds.observers.encore.sample = s => { const r = original(s); if (s.tick === 2) throw new Error('observer hiccup'); return r; };
    pipeline.advance();
    expect(() => pipeline.advance()).toThrow('observer hiccup');
    expect(t.seen.encore).toEqual([1, 2]);
    expect(t.pushed.static).toEqual([1, 2]);
  });
});
