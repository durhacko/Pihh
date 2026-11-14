// tests/app/xray/radioIngest.test.ts
// #46: per-tick radio evidence. Real worlds, a test brain that really broadcasts, the real RadioLayer and
// RadioTrace; no GPU. A frame that advances several ticks must keep exactly the logged traffic.
import { afterEach, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { DT, type AgentBrain, type Heartbeat, type WorldSnapshot } from '../../../src/contracts';
import { createWorlds } from '../../../src/app/worlds';
import { RadioTrace } from '../../../src/app/render/colourModes/radioTrace';
import { resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';
import createRadioLayer from '../../../src/app/render/layers/RadioLayer';
import createDeathLayer from '../../../src/app/render/layers/DeathLayer';

afterEach(() => resetViewMode());

/** Stays on the ground and sends one heartbeat every 5 ticks (staggered by id); claims now and then. */
interface TalkerState { id: number; seq: number; version: Heartbeat['version'] }
const talker: AgentBrain<TalkerState> = {
  kind: 'encore',
  init: init => ({ id: init.id, seq: 0, version: { ...init.score.version } }),
  step(state, input) {
    const outbox: Heartbeat[] = (input.tick + state.id) % 5 === 0
      ? [{ type: 'HB', from: state.id, seq: state.seq++, sentTick: input.tick, slot: state.id, heldSince: 0, version: { ...state.version }, pos: [...input.pos], ...(state.id % 7 === 0 ? { claim: { slot: state.id + 1, rank: state.id } } : {}) }]
      : [];
    return { accel: [0, 0, 0], colour: [1, 1, 1], outbox };
  },
  belief: state => ({ slot: state.id, heldSince: 0, target: [0, 0, 0], version: { ...state.version }, deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [] }),
};

/** 60 ticks of one real world's snapshots (index i holds tick i + 1). */
function run(ticks = 60, kills: number[] = []): WorldSnapshot[] {
  const worlds = createWorlds({ seed: 31, n0: 60, brains: { encore: talker, static: talker } });
  const out: WorldSnapshot[] = [];
  while (worlds.tick < ticks) {
    if (worlds.tick === 30 && kills.length) worlds.scheduleBoth({ type: 'KILL', tick: 31, ids: kills });
    out.push(worlds.stepBoth().encore);
  }
  return out;
}
/** Ground truth: every logged delivery in the retention window (the last 1 s of simulation) ending at `tick`. */
function loggedWithinOneSecond(snapshots: WorldSnapshot[], tick: number): number {
  return snapshots.filter(s => s.tick <= tick && (tick - s.tick) * DT < 1).reduce((sum, s) => sum + s.radio.reduce((n, e) => n + e.delivered.length, 0), 0);
}
function radioLayer() {
  const scene = new Scene();
  const layer = createRadioLayer();
  layer.init({ scene, camera: new PerspectiveCamera(), params: { n0: 60 } as never });
  const stats = () => (scene.children[0] as Group).userData.radio as { drawn: number; observed: number };
  return { layer, stats };
}

describe('per-tick radio ingestion (#46)', () => {
  const snapshots = run();
  it('the fixture really broadcasts', () => {
    expect(snapshots.reduce((n, s) => n + s.radio.length, 0)).toBeGreaterThan(500);
  });

  it('advancing 5 ticks in one frame retains the same log totals as rendering every tick, and both equal the log', () => {
    setViewMode({ xray: true });
    const everyTick = radioLayer();
    const everyFifth = radioLayer();
    const framesOnly = radioLayer();   // negative control: no ingest, as before #46
    for (let i = 0; i < snapshots.length; i++) {
      const curr = snapshots[i];
      const frame = { prev: snapshots[Math.max(0, i - 1)], curr, alpha: 0, dtReal: 0 };
      everyTick.layer.ingest!(curr); everyTick.layer.update(frame);
      everyFifth.layer.ingest!(curr);
      if (curr.tick % 5 === 0) {
        everyFifth.layer.update(frame); framesOnly.layer.update(frame);
        const truth = loggedWithinOneSecond(snapshots, curr.tick);
        expect(everyFifth.stats().observed).toBe(truth);
        expect(everyTick.stats().observed).toBe(truth);
        if (curr.tick >= 20) expect(framesOnly.stats().observed).toBeLessThan(truth);
      }
    }
  });

  it('pausing and rendering the same frame again adds no duplicates; re-ingesting a tick adds nothing', () => {
    setViewMode({ xray: true });
    const { layer, stats } = radioLayer();
    for (const s of snapshots.slice(0, 25)) layer.ingest!(s);
    const frame = { prev: snapshots[23], curr: snapshots[24], alpha: 0.4, dtReal: 0.016 };
    layer.update(frame);
    const first = { ...stats() };
    for (let i = 0; i < 30; i++) { layer.update(frame); layer.ingest!(snapshots[24]); }
    expect(stats()).toEqual(first);
    expect(first.observed).toBe(loggedWithinOneSecond(snapshots, 25));
  });

  it('a tick that goes backwards can only be a rebuilt world, so it starts a fresh trace', () => {
    const trace = new RadioTrace();
    for (const s of snapshots.slice(0, 25)) trace.ingest(s);
    trace.ingest(snapshots[2]);   // tick 3 after tick 25
    expect(trace.plan(3, 0).logged).toBe(snapshots[2].radio.reduce((n, e) => n + e.delivered.length, 0));
  });

  it('reset clears retained evidence, so a rebuilt world starts from its own tick 1', () => {
    setViewMode({ xray: true });
    const { layer, stats } = radioLayer();
    for (const s of snapshots.slice(0, 40)) layer.ingest!(s);
    layer.update({ prev: snapshots[38], curr: snapshots[39], alpha: 0, dtReal: 0 });
    expect(stats().observed).toBeGreaterThan(0);
    layer.reset!();
    const fresh = run(2);
    layer.ingest!(fresh[0]); layer.ingest!(fresh[1]);
    layer.update({ prev: fresh[0], curr: fresh[1], alpha: 0, dtReal: 0 });
    expect(stats().observed).toBe(loggedWithinOneSecond(fresh, 2));
  });

  it('drawn links never exceed delivered receivers, and every drawn link is a logged delivery', () => {
    const trace = new RadioTrace();
    for (const s of snapshots) {
      trace.ingest(s);
      for (const selected of [null, 3, 14]) {
        const plan = trace.plan(s.tick, 0.5, selected, true);
        expect(plan.drawn).toBeLessThanOrEqual(plan.logged);
        const window = snapshots.filter(w => w.tick <= s.tick && (s.tick - w.tick) * DT < 1);
        for (const segment of plan.segments) {
          expect(window.some(w => w.radio.some(e => e.from === segment.sender && e.delivered.includes(segment.receiver)))).toBe(true);
        }
      }
    }
  });

  it('the death layer forgets old deaths on reset', () => {
    setViewMode({ xray: true });
    const killed = run(40, [1, 2, 3]);
    const scene = new Scene();
    const layer = createDeathLayer();
    layer.init({ scene, camera: new PerspectiveCamera(), params: { n0: 60 } as never });
    layer.update({ prev: killed[30], curr: killed[31], alpha: 0, dtReal: 0 });
    const group = scene.children[0] as Group;
    expect(group.children.length).toBe(6);   // flash + cross per dead drone
    layer.reset!();
    expect(group.children.length).toBe(0);
    const fresh = run(2);
    layer.update({ prev: fresh[0], curr: fresh[1], alpha: 0, dtReal: 0 });
    expect(group.children.length).toBe(0);
  });
});
