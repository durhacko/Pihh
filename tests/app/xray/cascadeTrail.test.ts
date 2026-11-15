// tests/app/xray/cascadeTrail.test.ts
// #202 (P2-WP-03, P2-T06): the repair-cascade trail records only OBSERVED belief.slot changes, counted exactly as the
// observer counts slotChanges, and makes an arrow drawable only once its drone has arrived within rOcc of the new
// target, and only while the drone stays there (never while its tether would be drawn).
import { describe, expect, it } from 'vitest';
import type { Vec3, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import { CASCADE_FADE_TICKS, CascadeTrail } from '../../../src/app/render/colourModes/cascadeTrail';
import { createWorlds } from '../../../src/app/worlds';
import { idsInSphere } from '../../../src/sim';

const R_OCC = 1;
interface D { slot?: number; target?: Vec3; pos?: Vec3; alive?: boolean }
/** n drones; drone i defaults to slot i, target [i, 30, 0], sitting on its target. */
function snap(tick: number, n: number, overrides: Record<number, D> = {}): WorldSnapshot {
  const base = makeFakeSnapshot(tick, n);
  return {
    ...base, radio: [],
    drones: base.drones.map((d, i) => {
      const o = overrides[i] ?? {};
      const target = o.target ?? [i, 30, 0] as Vec3;
      return { ...d, alive: o.alive ?? true, diedTick: o.alive === false ? 1 : null, pos: o.pos ?? [...target] as Vec3, belief: { ...d.belief, slot: o.slot ?? i, target } };
    }),
  };
}

describe('CascadeTrail: change detection (#202)', () => {
  it('records one entry per observed slot change, with its kind, and nothing for unchanged drones', () => {
    const trail = new CascadeTrail(4, R_OCC);
    trail.ingest(snap(1, 4));
    trail.ingest(snap(2, 4));
    expect(trail.counts()).toMatchObject({ changes: 0, pending: 0 });
    trail.ingest(snap(3, 4, { 2: { slot: 0, target: [9, 30, 0], pos: [2, 30, 0] }, 1: { slot: 3, target: [7, 30, 0], pos: [1, 30, 0] } }));
    expect(trail.counts()).toEqual({ changes: 2, commits: 1, pops: 1, pending: 2, superseded: 0 });
    const [first, second] = trail.entries();
    expect(first).toMatchObject({ id: 1, fromSlot: 1, toSlot: 3, kind: 'pop', from: [1, 30, 0], to: [7, 30, 0], tick: 3 });
    expect(second).toMatchObject({ id: 2, fromSlot: 2, toSlot: 0, kind: 'commit', from: [2, 30, 0], to: [9, 30, 0] });
    expect(trail.arrows(3)).toEqual([]);        // nobody has arrived yet
  });

  it('a repeated or older tick is a no-op; a backwards tick (rebuilt world) resets; reset() forgets everything', () => {
    const trail = new CascadeTrail(3, R_OCC);
    trail.ingest(snap(1, 3));
    const changed = snap(2, 3, { 0: { slot: 2 } });
    trail.ingest(changed);
    trail.ingest(changed);
    trail.ingest(snap(2, 3));
    expect(trail.counts().changes).toBe(1);
    trail.ingest(snap(1, 3));                   // tick went backwards: a new world
    expect(trail.counts().changes).toBe(0);
    expect(trail.entries()).toEqual([]);
    trail.ingest(snap(2, 3, { 0: { slot: 2 } }));
    trail.reset();
    expect(trail.counts()).toEqual({ changes: 0, commits: 0, pops: 0, pending: 0, superseded: 0 });
    expect(trail.lastTick).toBe(0);
  });

  it('dead drones are skipped, as the observer skips them; a drone that dies before arriving never shows', () => {
    const trail = new CascadeTrail(3, R_OCC);
    trail.ingest(snap(1, 3));
    trail.ingest(snap(2, 3, { 1: { alive: false, slot: 0 } }));       // a dead drone's belief is not a change
    expect(trail.counts().changes).toBe(0);
    trail.ingest(snap(3, 3, { 1: { alive: false }, 2: { slot: 1, target: [5, 30, 0], pos: [2, 30, 0] } }));
    expect(trail.counts()).toMatchObject({ changes: 1, pending: 1 });
    trail.ingest(snap(4, 3, { 1: { alive: false }, 2: { alive: false, slot: 1, target: [5, 30, 0], pos: [5, 30, 0] } }));
    expect(trail.counts()).toMatchObject({ changes: 1, pending: 0, superseded: 1 });
    for (let t = 4; t < 20; t++) expect(trail.arrows(t)).toEqual([]);
  });

  it('`from` is the previous tick\'s target, also after a movement change with no slot change', () => {
    const trail = new CascadeTrail(2, R_OCC);
    trail.ingest(snap(1, 2));
    trail.ingest(snap(2, 2, { 0: { target: [0, 40, 0], pos: [0, 40, 0] } }));   // new movement: target moved, same slot
    expect(trail.counts().changes).toBe(0);
    trail.ingest(snap(3, 2, { 0: { slot: 1, target: [3, 40, 0], pos: [0, 40, 0] } }));
    expect(trail.entries()[0].from).toEqual([0, 40, 0]);   // not the first formation's [0, 30, 0]
  });

  it('a full ring overwrites its oldest entry, while the cumulative counts keep every change', () => {
    const trail = new CascadeTrail(1, R_OCC, 4);
    trail.ingest(snap(1, 1));
    for (let t = 2; t <= 11; t++) trail.ingest(snap(t, 1, { 0: { slot: t, target: [t, 30, 0] } }));   // arrives at once each time
    expect(trail.counts().changes).toBe(10);
    expect(trail.entries()).toHaveLength(4);
    expect(trail.entries().map(e => e.toSlot)).toEqual([8, 9, 10, 11]);
  });
});

describe('CascadeTrail: onset after arrival, fade, and the tether rule (#202)', () => {
  it('an arrow shows on the first tick its drone is within rOcc of the new target, then fades over 120 ticks', () => {
    const trail = new CascadeTrail(2, R_OCC);
    trail.ingest(snap(1, 2));
    trail.ingest(snap(2, 2, { 0: { slot: 1, target: [10, 30, 0], pos: [0, 30, 0] } }));
    trail.ingest(snap(3, 2, { 0: { slot: 1, target: [10, 30, 0], pos: [5, 30, 0] } }));
    expect(trail.arrows(3)).toEqual([]);
    trail.ingest(snap(4, 2, { 0: { slot: 1, target: [10, 30, 0], pos: [9.2, 30, 0] } }));   // 0.8 m away: arrived
    const [arrow] = trail.arrows(4);
    expect(arrow).toMatchObject({ id: 0, from: [0, 30, 0], to: [10, 30, 0], kind: 'pop', brightness: 1 });
    expect(trail.entries()[0].shownAt).toBe(4);
    for (let t = 5; t < 4 + CASCADE_FADE_TICKS; t++) trail.ingest(snap(t, 2, { 0: { slot: 1, target: [10, 30, 0] } }));
    const late = trail.arrows(4 + CASCADE_FADE_TICKS - 1);
    expect(late).toHaveLength(1);
    expect(late[0].brightness).toBeCloseTo(1 / CASCADE_FADE_TICKS, 10);
    trail.ingest(snap(4 + CASCADE_FADE_TICKS, 2, { 0: { slot: 1, target: [10, 30, 0] } }));
    expect(trail.arrows(4 + CASCADE_FADE_TICKS)).toEqual([]);
  });

  it('an entry superseded by another change before arrival is counted and never drawn', () => {
    const trail = new CascadeTrail(1, R_OCC);
    trail.ingest(snap(1, 1));
    trail.ingest(snap(2, 1, { 0: { slot: 5, target: [10, 30, 0], pos: [0, 30, 0] } }));
    trail.ingest(snap(3, 1, { 0: { slot: 3, target: [-10, 30, 0], pos: [1, 30, 0] } }));    // changed again mid-flight
    trail.ingest(snap(4, 1, { 0: { slot: 3, target: [-10, 30, 0], pos: [10, 30, 0] } }));   // passes the first target
    expect(trail.counts()).toMatchObject({ changes: 2, superseded: 1, pending: 1 });
    expect(trail.arrows(4)).toEqual([]);
    trail.ingest(snap(5, 1, { 0: { slot: 3, target: [-10, 30, 0] } }));
    const arrows = trail.arrows(5);
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ from: [10, 30, 0], to: [-10, 30, 0], kind: 'commit' });
  });

  it('a shown arrow is hidden while its drone is farther than rOcc from its own current target (its tether is drawn)', () => {
    const trail = new CascadeTrail(1, R_OCC);
    trail.ingest(snap(1, 1));
    trail.ingest(snap(2, 1, { 0: { slot: 2, target: [4, 30, 0] } }));      // arrives on the change tick
    expect(trail.arrows(2)).toHaveLength(1);
    trail.ingest(snap(3, 1, { 0: { slot: 2, target: [4, 50, 0], pos: [4, 30, 0] } }));   // movement change: flying again
    expect(trail.isSettled(0)).toBe(false);
    expect(trail.arrows(3)).toEqual([]);
    trail.ingest(snap(4, 1, { 0: { slot: 2, target: [4, 50, 0] } }));
    expect(trail.arrows(4)).toHaveLength(1);
  });

  it('alpha only advances the fade; it never makes an entry appear early', () => {
    const trail = new CascadeTrail(1, R_OCC);
    trail.ingest(snap(1, 1));
    trail.ingest(snap(2, 1, { 0: { slot: 2, target: [4, 30, 0] } }));
    expect(trail.arrows(1, 0.99)).toEqual([]);
    expect(trail.arrows(2, 0.5)[0].brightness).toBeCloseTo(1 - 0.5 / CASCADE_FADE_TICKS, 10);
  });
});

describe('P2-T06: real worlds, Encore, n0 40, regional kill', () => {
  const KILL_TICK = 400;
  function run(withTrail = true) {
    const worlds = createWorlds({ seed: 1, n0: 40 });
    const { rOcc } = worlds.params;
    const trails = { encore: new CascadeTrail(40, rOcc), static: new CascadeTrail(40, rOcc) };
    const observed = { encore: 0, static: 0 };
    let drawnMax = 0;
    let violations = 0;
    const shownAfterArrival: string[] = [];
    const seen = new Set<string>();
    let killed = 0;
    for (let tick = 1; tick <= 720; tick++) {
      if (tick === KILL_TICK - 5) {
        const snapNow = worlds.latest()!.encore;
        const ids = idsInSphere(snapNow, snapNow.drones[0].pos, 4);
        killed = ids.length;
        worlds.scheduleBoth({ type: 'KILL', tick: KILL_TICK, ids });
      }
      const both = worlds.stepBoth();
      if (withTrail) for (const arm of ['encore', 'static'] as const) {
        const s = both[arm];
        trails[arm].ingest(s);
        const arrows = trails[arm].arrows(s.tick, 0);
        if (arm === 'encore') drawnMax = Math.max(drawnMax, arrows.length);
        else observed.static += arrows.length;
        for (const arrow of arrows) {
          const drone = s.drones[arrow.id];
          // TetherLayer's rule on the same frame: a live drone farther than rOcc from its belief.target has a tether.
          const t = drone.belief.target;
          const tethered = drone.alive && Math.hypot(drone.pos[0] - t[0], drone.pos[1] - t[1], drone.pos[2] - t[2]) > rOcc;
          if (tethered || !drone.alive) violations++;
          // Onset: on the first frame an arrow is drawn, its drone is within rOcc of the arrow's head (measured here,
          // independently of the trail's own bookkeeping).
          const key = `${arm}:${arrow.id}@${arrow.tick}`;
          if (!seen.has(key)) {
            seen.add(key);
            if (Math.hypot(drone.pos[0] - arrow.to[0], drone.pos[1] - arrow.to[1], drone.pos[2] - arrow.to[2]) > rOcc) shownAfterArrival.push(key);
          }
        }
      }
    }
    return { worlds, trails, killed, drawnMax, violations, shownAfterArrival, arrowsSeen: seen.size, staticArrows: observed.static };
  }

  it('changes equal the observer\'s slotChanges; arrows only after arrival, never with a tether, none in static', () => {
    const r = run();
    expect(r.killed).toBeGreaterThan(0);
    const encore = r.trails.encore.counts();
    expect(encore.changes).toBe(r.worlds.observers.encore.summary().slotChanges);
    expect(encore.changes).toBeGreaterThan(0);                       // the kill really produced repairs
    expect(encore.changes).toBe(encore.commits + encore.pops);
    expect(r.drawnMax).toBeGreaterThan(0);
    expect(r.drawnMax).toBeLessThanOrEqual(encore.changes);          // never more arrows than observed changes
    expect(r.violations).toBe(0);
    expect(r.arrowsSeen).toBeGreaterThan(0);
    expect(r.shownAfterArrival).toEqual([]);
    expect(r.arrowsSeen).toBeLessThanOrEqual(encore.changes);       // each drawn arrow is a distinct observed change
    for (const e of r.trails.encore.entries()) expect(e.toSlot).not.toBe(e.fromSlot);
    expect(r.trails.static.counts().changes).toBe(0);
    expect(r.worlds.observers.static.summary().slotChanges).toBe(0);
    expect(r.staticArrows).toBe(0);
  }, 60_000);

  it('replays identically, and the worlds end in the same state with or without the trail reading them', () => {
    const a = run(), b = run(), off = run(false);
    expect(b.trails.encore.entries()).toEqual(a.trails.encore.entries());
    expect(b.trails.encore.counts()).toEqual(a.trails.encore.counts());
    for (const arm of ['encore', 'static'] as const) {
      expect(b.worlds.worlds[arm].stateHash()).toBe(a.worlds.worlds[arm].stateHash());
      expect(off.worlds.worlds[arm].stateHash()).toBe(a.worlds.worlds[arm].stateHash());
    }
    expect(off.worlds.observers.encore.summary()).toEqual(a.worlds.observers.encore.summary());
  }, 60_000);
});
