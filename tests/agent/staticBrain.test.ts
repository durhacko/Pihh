// tests/agent/staticBrain.test.ts
// Application tests for issue #15 (WP-1a, second half): the static baseline brain of contract section 11.
// The "world" here is a tiny in-test one: several static brains, no radio (every inbox is empty unless a
// test fills it), true-position sensing within rSense, and the integrator of section 10 in the same
// order as the real world: tick += 1, every brain steps from the same start-of-tick state, then
// clamp |accel| <= aMax, integrate velocity, clamp |vel| <= vMax, integrate position, keep y >= 0.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DT, OPERATOR, makeParams } from '../../src/contracts';
import type {
  AgentInput, AgentOutput, Belief, Formation, Heartbeat, Message, Params, Recipe, Score, ScoreMsg, Sensed, Vec3,
} from '../../src/contracts';
import { composeNext, expandRecipe, launchPos, makeScore, newerVersion } from '../../src/score';
import { staticBrain } from '../../src/agent/staticBrain';
import type { StaticState } from '../../src/agent/staticBrain';
import { pacedSlotPos, steer, steerTarget } from '../../src/agent/steer';

// ---------- the show used by every test ----------

const N = 40;
const P = makeParams(N);
const HOLD = 200;
const RECIPES: Recipe[] = [{ kind: 'sphere' }, { kind: 'helix' }, { kind: 'text', text: 'HI' }];
const SCORE = makeScore(RECIPES, N, P, HOLD);
const FORMATIONS: Formation[] = SCORE.movements.map(m => expandRecipe(m.recipe, N, P));
const [M1, M2, M3] = SCORE.movements;
const RUN_TICKS = 2000;

// ---------- small helpers, written independently of the brain ----------

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function clampLen(v: Vec3, max: number): Vec3 {
  const l = len(v);
  if (l <= max) return v;
  return [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Index of the movement of the preloaded score that is current at `tick`: the last one that has started. */
function movementAt(tick: number): number {
  let index = 0;
  for (let i = 1; i < SCORE.movements.length; i++) if (SCORE.movements[i].startTick <= tick) index = i;
  return index;
}

/** Where slot `slot` of the preloaded show is at `tick`. */
const slotPos = (slot: number, tick: number): Vec3 => FORMATIONS[movementAt(tick)].slots[slot].pos;

// ---------- the tiny world ----------

interface Drone { id: number; alive: boolean; state: StaticState; pos: Vec3; vel: Vec3 }
/** What one tick left behind. Entries of dead drones are null. */
interface Frame {
  tick: number;
  pos: Vec3[];
  vel: Vec3[];
  outputs: (AgentOutput | null)[];
  beliefs: (Belief | null)[];
}
interface RunOptions {
  params?: Params;
  inboxFor?: (id: number, tick: number) => Message[];
  kill?: { tick: number; ids: number[] };   // these drones are dead from this tick on
}
interface Run { frames: Frame[]; drones: Drone[] }

function makeDrones(params: Params): Drone[] {
  const drones: Drone[] = [];
  for (let id = 0; id < N; id++) {
    drones.push({
      id, alive: true, pos: launchPos(id, N), vel: [0, 0, 0],
      state: staticBrain.init({ id, n0: N, initialSlot: id, score: SCORE, params, seed: 1000 + id }),
    });
  }
  return drones;
}

/** What drone `i` senses: every other live drone within rSense, as relative position and relative velocity. */
function senseFor(drones: readonly Drone[], i: number, p: Params): Sensed[] {
  const sensed: Sensed[] = [];
  for (let j = 0; j < drones.length; j++) {
    if (j === i || !drones[j].alive) continue;
    const rel = sub(drones[j].pos, drones[i].pos);
    if (len(rel) <= p.rSense) sensed.push({ rel, vel: sub(drones[j].vel, drones[i].vel) });
  }
  return sensed;
}

function run(ticks: number, options: RunOptions = {}): Run {
  const p = options.params ?? P;
  const drones = makeDrones(p);
  const frames: Frame[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    if (options.kill && options.kill.tick === tick) for (const id of options.kill.ids) drones[id].alive = false;
    // Every live brain decides from the same start-of-tick state. Inputs are deep-frozen: a brain may not edit them.
    const outputs = drones.map((d, i): AgentOutput | null => {
      if (!d.alive) return null;
      const input: AgentInput = deepFreeze({
        tick, pos: [...d.pos] as Vec3, vel: [...d.vel] as Vec3,
        inbox: options.inboxFor ? options.inboxFor(d.id, tick) : [],
        sensed: senseFor(drones, i, p),
      });
      return staticBrain.step(d.state, input);
    });
    // Then all move.
    drones.forEach((d, i) => {
      const out = outputs[i];
      if (out === null) return;
      const a = clampLen(out.accel, p.aMax);
      d.vel = clampLen([d.vel[0] + a[0] * DT, d.vel[1] + a[1] * DT, d.vel[2] + a[2] * DT], p.vMax);
      d.pos = [d.pos[0] + d.vel[0] * DT, Math.max(0, d.pos[1] + d.vel[1] * DT), d.pos[2] + d.vel[2] * DT];
    });
    frames.push({
      tick,
      pos: drones.map(d => d.pos),
      vel: drones.map(d => d.vel),
      outputs,
      beliefs: drones.map(d => (d.alive ? staticBrain.belief(d.state) : null)),
    });
  }
  return { frames, drones };
}

/** The frame of tick `tick` (frames start at tick 1). */
const frameAt = (r: Run, tick: number): Frame => r.frames[tick - 1];

/** Drone `id` is at slot `id` of the formation that is current at the frame's tick, and slow. */
const settledOnOwnSlot = (f: Frame, id: number, p: Params): boolean =>
  dist(f.pos[id], slotPos(id, f.tick)) < p.rOcc && len(f.vel[id]) < 0.5;

/** Exact equality of two vectors (as toEqual: +0 and -0 differ). For loops too long for one expect per value. */
const sameVec = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  a !== undefined && a.length === b.length && a.every((c, i) => Object.is(c, b[i]));

/**
 * Path of the first difference between two plain-JSON values, or null when they are deep-equal
 * (as toEqual: +0 and -0 differ). Used for whole runs, where a toEqual failure would print megabytes.
 */
function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return `${path} (size)`;
  for (const key of keys) {
    if (!(key in b)) return `${path}.${key}`;
    const d = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (d !== null) return d;
  }
  return null;
}

/** The quiet 2000-tick show (no radio, no failures), run once and shared by the tests that only read it. */
let quietRun: Run | undefined;
const quiet = (): Run => (quietRun ??= run(RUN_TICKS));

// ---------- messages a real radio could deliver ----------

const T_INJECT = 300;   // during the hold of the first movement
const INJECTED = composeNext(SCORE, T_INJECT, { kind: 'text', text: 'NEW' }, 0, N, P);
const INJECTED_FORMATION = expandRecipe(INJECTED.movements[1].recipe, N, P);

function scoreMsg(from: number, tick: number, score: Score): ScoreMsg {
  return { type: 'SCORE', from, seq: tick, sentTick: tick - 1, score: jsonCopy(score) };
}

/** A heartbeat from another drone that says it holds, and is claiming, this drone's own slot under the injected score. */
function rivalHeartbeat(from: number, tick: number, slot: number): Heartbeat {
  return {
    type: 'HB', from, seq: tick, sentTick: tick - 1, slot, heldSince: tick - 1,
    version: { ...INJECTED.version }, pos: [0, 30, 0], claim: { slot, rank: 0 },
  };
}

/** A busy radio: the operator's new score at T_INJECT, the same score gossiped by a peer every 40 ticks, and rival heartbeats. */
function busyInbox(id: number, tick: number): Message[] {
  const peer = (id + 1) % N;
  const inbox: Message[] = [];
  if (tick >= T_INJECT && tick % P.hbPeriod === 0) inbox.push(rivalHeartbeat(peer, tick, id));
  if (tick === T_INJECT) inbox.push(scoreMsg(OPERATOR, tick, INJECTED));
  if (tick > T_INJECT && (tick - T_INJECT) % P.scoreResendMin === 0) inbox.push(scoreMsg(peer, tick, INJECTED));
  return inbox;
}

// ---------- tests ----------

describe('the show used by these tests', () => {
  it('has three movements, and every slot moves by more than rOcc between consecutive formations', () => {
    expect(SCORE.movements.map(m => m.recipe.kind)).toEqual(['sphere', 'helix', 'text']);
    expect(M1.startTick).toBe(0);
    expect(M2.startTick).toBe(M1.transitionTicks + HOLD);
    expect(M3.startTick + M3.transitionTicks + HOLD).toBeLessThan(RUN_TICKS);   // the run covers the whole show
    for (let i = 0; i < N; i++) {
      expect(dist(FORMATIONS[0].slots[i].pos, FORMATIONS[1].slots[i].pos)).toBeGreaterThan(P.rOcc);
      expect(dist(FORMATIONS[1].slots[i].pos, FORMATIONS[2].slots[i].pos)).toBeGreaterThan(P.rOcc);
    }
  });
});

describe('staticBrain: state and belief (contract sections 4 and 11)', () => {
  const init = (id: number, slot: number = id) =>
    staticBrain.init({ id, n0: N, initialSlot: slot, score: SCORE, params: P, seed: 7 });

  it("has kind 'static'", () => {
    expect(staticBrain.kind).toBe('static');
  });

  it('init gives plain JSON state: id, n0, slot = initialSlot, the preloaded score, params, lastTarget', () => {
    const s = init(5, 17);
    expect(Object.keys(s).sort()).toEqual(['id', 'lastTarget', 'n0', 'params', 'score', 'slot']);
    expect(s).toEqual({ id: 5, n0: N, slot: 17, score: SCORE, params: P, lastTarget: FORMATIONS[0].slots[17].pos });
    expect(jsonCopy(s)).toEqual(s);
  });

  it('the state shares no object with what init was given', () => {
    const score = jsonCopy(SCORE);
    const params = { ...P };
    const s = staticBrain.init({ id: 3, n0: N, initialSlot: 3, score, params, seed: 7 });
    expect(s.score).not.toBe(score);
    expect(s.params).not.toBe(params);
    // The caller edits its own copies afterwards: the brain's preloaded show is not affected.
    score.version.issuedTick = 999;
    score.movements.length = 1;
    score.movements[0].recipe = { kind: 'text', text: 'X' };
    params.vMax = 1;
    expect(s.score).toEqual(SCORE);
    expect(s.params).toEqual(P);
    // Nor is the frozen, shared formation aliased into the state.
    expect(Object.isFrozen(s.lastTarget)).toBe(false);
  });

  it('before the first step, belief() is the documented constant with target = the slot position at tick 0', () => {
    for (const slot of [0, 17, N - 1]) {
      expect(staticBrain.belief(init(slot))).toEqual({
        slot, heldSince: 0, target: FORMATIONS[0].slots[slot].pos,
        version: { issuedTick: 0, origin: OPERATOR },
        deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [],
      });
    }
  });

  it('belief() is JSON-serialisable and deep-equal after a round trip, before and after steps, and so is the state', () => {
    const s = init(9);
    const check = () => {
      const b = staticBrain.belief(s);
      expect(JSON.parse(JSON.stringify(b))).toEqual(b);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    };
    check();
    for (const tick of [1, 2, M2.startTick, M3.startTick + 50]) {
      staticBrain.step(s, { tick, pos: [1, 2, 3], vel: [0.5, 0, -0.5], inbox: [], sensed: [{ rel: [1, 0, 0], vel: [-1, 0, 0] }] });
      check();
    }
    // The same holds for every belief of the 40-drone show, at a tick in each movement and at the end.
    for (const tick of [1, 200, M2.startTick + 10, M3.startTick + 10, RUN_TICKS]) {
      const beliefs = frameAt(quiet(), tick).beliefs;
      expect(JSON.parse(JSON.stringify(beliefs))).toEqual(beliefs);
    }
  });

  it('belief() returns a fresh object each time: editing it changes nothing in the brain', () => {
    const s = init(4);
    const before = jsonCopy(s);
    const b = staticBrain.belief(s);
    b.target[0] += 100;
    b.version.issuedTick = 500;
    b.log.push('edited by the observer');
    b.slot = 0;
    expect(s).toEqual(before);
    expect(staticBrain.belief(s)).toEqual(staticBrain.belief(init(4)));
  });

  it('rejects an initialSlot that is not a slot of the roster', () => {
    for (const bad of [-1, N, 1.5, Number.NaN]) expect(() => init(0, bad)).toThrow(RangeError);
  });

  it('imports only from src/contracts, src/score and ./steer', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/agent/staticBrain.ts', import.meta.url)), 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
    expect(specifiers).toEqual(['../contracts', '../score', './steer']);
    expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^import\s+['"]/m);
  });
});

describe('staticBrain: one step', () => {
  const pos: Vec3 = [3, 12, -4];
  const vel: Vec3 = [1, 2, -1];
  // One neighbour inside dAvoid and closing, one outside dAvoid: steering must see both lists unchanged.
  const sensed: Sensed[] = [{ rel: [0.6, 0.1, 0.2], vel: [-2, 0, 0] }, { rel: [3, 0, 0], vel: [0, 0, 0] }];
  const ticks = [1, M2.startTick - 1, M2.startTick, M3.startTick - 1, M3.startTick, 100000];

  it('accel = steer towards the paced point of its own slot; belief.target = the real slot; colour = that slot colour; outbox = []', () => {
    for (const id of [0, 13, N - 1]) {
      for (const tick of ticks) {
        const s = staticBrain.init({ id, n0: N, initialSlot: id, score: SCORE, params: P, seed: 7 });
        const out = staticBrain.step(s, { tick, pos: [...pos], vel: [...vel], inbox: [], sensed });
        const slot = FORMATIONS[movementAt(tick)].slots[id];
        expect(out.accel).toEqual(steer(pos, vel, pacedSlotPos(SCORE, tick, id, N, P), sensed, P));
        expect(out.colour).toEqual(slot.colour);
        expect(out.outbox).toEqual([]);
        expect(staticBrain.belief(s).target).toEqual(slot.pos);
        expect(s.slot).toBe(id);
      }
    }
  });

  it('the neighbours it senses do change the acceleration (it steers, it does not just fly at the slot)', () => {
    const s = staticBrain.init({ id: 13, n0: N, initialSlot: 13, score: SCORE, params: P, seed: 7 });
    const alone = staticBrain.step(s, { tick: 1, pos: [...pos], vel: [...vel], inbox: [], sensed: [] });
    const crowded = staticBrain.step(s, { tick: 1, pos: [...pos], vel: [...vel], inbox: [], sensed });
    expect(crowded.accel).not.toEqual(alone.accel);
  });

  it('mid-transition it does not fly straight at the new slot: the paced point lies strictly between the two slots', () => {
    const id = 13;
    const tick = M2.startTick + 20;
    const s = staticBrain.init({ id, n0: N, initialSlot: id, score: SCORE, params: P, seed: 7 });
    const out = staticBrain.step(s, { tick, pos: [...pos], vel: [...vel], inbox: [], sensed });
    const paced = pacedSlotPos(SCORE, tick, id, N, P);
    expect(dist(paced, FORMATIONS[0].slots[id].pos)).toBeGreaterThan(0);
    expect(dist(paced, FORMATIONS[1].slots[id].pos)).toBeGreaterThan(0);
    expect(out.accel).not.toEqual(steer(pos, vel, FORMATIONS[1].slots[id].pos, sensed, P));
    expect(staticBrain.belief(s).target).toEqual(FORMATIONS[1].slots[id].pos);
  });

  it('with transitLanes on, it aims at steerTarget(id, ...), so drones in different lanes steer differently', () => {
    const lanes = makeParams(N, { transitLanes: true });
    // A slot index that maps to an outer lane (id % 3 != 1), far from the slot, so the lane offset applies.
    const id = 12;
    const slot = FORMATIONS[0].slots[id];
    expect(dist(pos, slot.pos)).toBeGreaterThan(3);
    const withLanes = staticBrain.step(
      staticBrain.init({ id, n0: N, initialSlot: id, score: SCORE, params: lanes, seed: 7 }),
      { tick: 1, pos: [...pos], vel: [...vel], inbox: [], sensed },
    );
    const without = staticBrain.step(
      staticBrain.init({ id, n0: N, initialSlot: id, score: SCORE, params: P, seed: 7 }),
      { tick: 1, pos: [...pos], vel: [...vel], inbox: [], sensed },
    );
    // The lane is judged against the real slot and its offset is added to the paced point.
    const lane = steerTarget(id, pos, slot.pos, lanes);
    const paced = pacedSlotPos(SCORE, 1, id, N, lanes);
    const aim: Vec3 = [paced[0] + lane[0] - slot.pos[0], paced[1] + lane[1] - slot.pos[1], paced[2] + lane[2] - slot.pos[2]];
    expect(lane[2]).not.toBe(slot.pos[2]);
    expect(withLanes.accel).toEqual(steer(pos, vel, aim, sensed, lanes));
    expect(withLanes.accel).not.toEqual(without.accel);
  });

  it('does not change its input, and keeps nothing of it', () => {
    const s = staticBrain.init({ id: 6, n0: N, initialSlot: 6, score: SCORE, params: P, seed: 7 });
    const input: AgentInput = {
      tick: 50, pos: [...pos], vel: [...vel], sensed: jsonCopy(sensed),
      inbox: [scoreMsg(OPERATOR, 50, INJECTED), rivalHeartbeat(7, 50, 6)],
    };
    const snapshot = jsonCopy(input);
    const out = staticBrain.step(s, deepFreeze(jsonCopy(input)));   // a frozen input does not make it throw
    const again = staticBrain.step(s, input);
    expect(again).toEqual(out);
    expect(input).toEqual(snapshot);
    // The output and the state hold no reference into the input or into the shared frozen formation.
    const stateAfter = jsonCopy(s);
    input.pos[0] = 1e6;
    input.vel[1] = 1e6;
    input.sensed[0].rel[0] = 1e6;
    (input.inbox[0] as ScoreMsg).score.movements.length = 0;
    expect(s).toEqual(stateAfter);
    expect(again).toEqual(out);
    out.accel[0] = 0;
    out.colour[0] = 0;      // would throw if the colour were the frozen slot colour itself
    out.outbox.push(rivalHeartbeat(6, 50, 6));
    expect(staticBrain.step(s, { ...snapshot }).outbox).toEqual([]);   // a new, empty outbox every step
    expect(FORMATIONS[0].slots[6].colour).toEqual(again.colour);
  });
});

describe('staticBrain: a 40-drone show with no radio', () => {
  it('every brain reaches its slot of the first movement by the time the hold starts, and stays settled', () => {
    const r = quiet();
    const holdStart = M1.startTick + M1.transitionTicks;
    const problems: string[] = [];
    for (let tick = holdStart; tick < M2.startTick; tick++) {
      const f = frameAt(r, tick);
      for (let id = 0; id < N; id++) {
        if (!sameVec(f.beliefs[id]?.target, FORMATIONS[0].slots[id].pos)) problems.push(`tick ${tick} drone ${id}: wrong target`);
        if (!settledOnOwnSlot(f, id, P)) problems.push(`tick ${tick} drone ${id}: not settled`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Settled means settled: at the end of the hold nobody is more than 5 cm from its slot or faster than 5 cm/s.
    const last = frameAt(r, M2.startTick - 1);
    for (let id = 0; id < N; id++) {
      expect(dist(last.pos[id], FORMATIONS[0].slots[id].pos)).toBeLessThan(0.05);
      expect(len(last.vel[id])).toBeLessThan(0.05);
    }
  });

  it('when the clock passes the next startTick, it flies to the SAME slot index of the next formation', () => {
    const r = quiet();
    const steps: { from: number; startTick: number; holdStart: number; holdEnd: number }[] = [
      { from: 0, startTick: M2.startTick, holdStart: M2.startTick + M2.transitionTicks, holdEnd: M3.startTick },
      { from: 1, startTick: M3.startTick, holdStart: M3.startTick + M3.transitionTicks, holdEnd: RUN_TICKS + 1 },
    ];
    for (const step of steps) {
      const before = FORMATIONS[step.from];
      const after = FORMATIONS[step.from + 1];
      for (let id = 0; id < N; id++) {
        // The target switches exactly at startTick: one tick earlier it is still the old formation's slot.
        expect(frameAt(r, step.startTick - 1).beliefs[id]?.target).toEqual(before.slots[id].pos);
        expect(frameAt(r, step.startTick).beliefs[id]?.target).toEqual(after.slots[id].pos);
        expect(frameAt(r, step.startTick).beliefs[id]?.slot).toBe(id);
      }
      // From the start of the hold on, every drone is within rOcc of slot `id` of the new formation, and slow.
      const problems: string[] = [];
      for (let tick = step.holdStart; tick < step.holdEnd; tick++) {
        const f = frameAt(r, tick);
        for (let id = 0; id < N; id++) {
          if (!(dist(f.pos[id], after.slots[id].pos) < P.rOcc)) problems.push(`tick ${tick} drone ${id}: not at slot ${id}`);
          if (!(len(f.vel[id]) < 0.5)) problems.push(`tick ${tick} drone ${id}: still moving`);
        }
      }
      expect(problems.slice(0, 5)).toEqual([]);
      // Slot `id` and no other: at the end of the hold the slot nearest to drone `id` is slot `id`.
      const end = frameAt(r, step.holdEnd - 1);
      for (let id = 0; id < N; id++) {
        let nearest = 0;
        for (let other = 1; other < N; other++) {
          if (dist(end.pos[id], after.slots[other].pos) < dist(end.pos[id], after.slots[nearest].pos)) nearest = other;
        }
        expect(nearest).toBe(id);
        expect(dist(end.pos[id], after.slots[id].pos)).toBeLessThan(0.05);
      }
    }
  });

  it('its slot never changes over 2000 ticks, and its outbox is always empty', () => {
    const r = quiet();
    expect(r.frames).toHaveLength(RUN_TICKS);
    const problems: string[] = [];
    for (const f of r.frames) {
      for (let id = 0; id < N; id++) {
        const belief = f.beliefs[id];
        const outbox = f.outputs[id]?.outbox;
        if (belief?.slot !== id) problems.push(`tick ${f.tick} drone ${id}: slot ${belief?.slot}`);
        if (belief?.heldSince !== 0) problems.push(`tick ${f.tick} drone ${id}: heldSince ${belief?.heldSince}`);
        if (!sameVec(belief?.target, slotPos(id, f.tick))) problems.push(`tick ${f.tick} drone ${id}: wrong target`);
        if (!Array.isArray(outbox) || outbox.length !== 0) problems.push(`tick ${f.tick} drone ${id}: outbox not empty`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    for (const d of r.drones) {
      expect(d.state.slot).toBe(d.id);
      expect(d.state.score).toEqual(SCORE);     // the preloaded score is never changed either
      expect(d.state.params).toEqual(P);
    }
  });

  it('shows the slot colour, and proposes only finite accelerations', () => {
    const problems: string[] = [];
    for (const f of quiet().frames) {
      for (let id = 0; id < N; id++) {
        const out = f.outputs[id];
        if (!sameVec(out?.colour, FORMATIONS[movementAt(f.tick)].slots[id].colour)) problems.push(`tick ${f.tick} drone ${id}: wrong colour`);
        if (out?.accel.length !== 3 || !out.accel.every(c => Number.isFinite(c))) problems.push(`tick ${f.tick} drone ${id}: accel not finite`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it('two runs give identical outputs, positions and beliefs', () => {
    const a = run(700);
    const b = run(700);
    expect(a.frames).toHaveLength(700);
    expect(firstDifference(b.frames, a.frames)).toBeNull();
    expect(JSON.stringify(b.frames) === JSON.stringify(a.frames)).toBe(true);
    expect(firstDifference(b.drones.map(d => d.state), a.drones.map(d => d.state))).toBeNull();
    // And the shared 2000-tick run starts with exactly the same 700 ticks.
    expect(firstDifference(quiet().frames.slice(0, 700), a.frames)).toBeNull();
    // The comparison itself can fail: one changed number is found.
    const edited = jsonCopy(a.frames);
    (edited[650].outputs[39] as AgentOutput).accel[2] += 1e-9;
    expect(firstDifference(edited, a.frames)).toBe('$.650.outputs.39.accel.2');
  });

  it('does not freeze or degrade when other drones fail: the survivors keep flying the show', () => {
    // Every odd drone dies at tick 100, in the middle of the first transition.
    const dead: number[] = [];
    for (let id = 1; id < N; id += 2) dead.push(id);
    const r = run(M3.startTick, { kill: { tick: 100, ids: dead } });
    const endOfFirstHold = frameAt(r, M2.startTick - 1);
    const endOfSecondHold = frameAt(r, M3.startTick - 1);
    for (let id = 0; id < N; id += 2) {
      expect(settledOnOwnSlot(endOfFirstHold, id, P), `drone ${id}, first movement`).toBe(true);
      expect(settledOnOwnSlot(endOfSecondHold, id, P), `drone ${id}, second movement`).toBe(true);
      expect(endOfSecondHold.beliefs[id]?.slot).toBe(id);
      expect(endOfSecondHold.outputs[id]?.outbox).toEqual([]);
    }
    for (const id of dead) expect(endOfSecondHold.outputs[id]).toBeNull();
    // Nobody heals: the slots of the dead drones stay empty.
    for (const id of dead) {
      for (let other = 0; other < N; other += 2) {
        expect(dist(endOfSecondHold.pos[other], FORMATIONS[1].slots[id].pos)).toBeGreaterThan(P.rOcc);
      }
    }
  });
});

describe('staticBrain: it ignores its inbox', () => {
  it('the injected score really is newer, and would send an adopting drone somewhere else', () => {
    expect(newerVersion(INJECTED.version, SCORE.version)).toBe(true);
    expect(INJECTED.movements[1].startTick).toBe(T_INJECT + P.scoreLead);
    expect(INJECTED.movements[1].startTick).toBeLessThan(M2.startTick);
    for (let i = 0; i < N; i++) {
      expect(dist(INJECTED_FORMATION.slots[i].pos, FORMATIONS[0].slots[i].pos)).toBeGreaterThan(P.rOcc);
    }
  });

  it('one step: a SCORE from OPERATOR with a newer version changes neither the output nor the state', () => {
    const base = { tick: T_INJECT, pos: [2, 29, 1] as Vec3, vel: [0.3, 0, -0.2] as Vec3, sensed: [] as Sensed[] };
    const quietState = staticBrain.init({ id: 8, n0: N, initialSlot: 8, score: SCORE, params: P, seed: 7 });
    const injectedState = staticBrain.init({ id: 8, n0: N, initialSlot: 8, score: SCORE, params: P, seed: 7 });
    const quietOut = staticBrain.step(quietState, { ...base, inbox: [] });
    const injectedOut = staticBrain.step(injectedState, {
      ...base, inbox: [scoreMsg(OPERATOR, T_INJECT, INJECTED), rivalHeartbeat(9, T_INJECT, 8)],
    });
    expect(injectedOut).toEqual(quietOut);
    expect(injectedState).toEqual(quietState);
    expect(staticBrain.belief(injectedState).version).toEqual({ issuedTick: 0, origin: OPERATOR });
    expect(staticBrain.belief(injectedState).target).toEqual(FORMATIONS[0].slots[8].pos);

    // Long after the injected movement would have started, it still flies the preloaded show.
    const later = M3.startTick + 10;
    const out = staticBrain.step(injectedState, { ...base, tick: later, inbox: [scoreMsg(OPERATOR, later, INJECTED)] });
    expect(out.outbox).toEqual([]);
    expect(staticBrain.belief(injectedState).target).toEqual(FORMATIONS[2].slots[8].pos);
    expect(staticBrain.belief(injectedState).version).toEqual(SCORE.version);
    expect(injectedState.score).toEqual(SCORE);
  });

  it('a whole show with a busy radio is identical, tick for tick, to the same show with no radio', () => {
    const ticks = M3.startTick + M3.transitionTicks;
    const busy = run(ticks, { inboxFor: busyInbox });
    // The busy radio did deliver: check the generator, not the brain.
    expect(busyInbox(5, T_INJECT).some(m => m.type === 'SCORE' && m.from === OPERATOR)).toBe(true);
    expect(busyInbox(5, T_INJECT + P.scoreResendMin).some(m => m.type === 'SCORE' && m.from === 6)).toBe(true);
    expect(busyInbox(5, T_INJECT + P.hbPeriod).some(m => m.type === 'HB' && m.claim?.slot === 5)).toBe(true);

    expect(busy.frames).toHaveLength(ticks);
    expect(firstDifference(busy.frames, quiet().frames.slice(0, ticks))).toBeNull();
    expect(firstDifference(busy.drones.map(d => d.state), run(ticks).drones.map(d => d.state))).toBeNull();

    // Spelled out for the tick where an adopting drone would already be flying the injected formation:
    const f = frameAt(busy, M2.startTick - 1);
    expect(f.tick).toBeGreaterThan(INJECTED.movements[1].startTick);
    for (let id = 0; id < N; id++) {
      expect(f.beliefs[id]?.version).toEqual({ issuedTick: 0, origin: OPERATOR });
      expect(f.beliefs[id]?.target).toEqual(FORMATIONS[0].slots[id].pos);
      expect(f.beliefs[id]?.target).not.toEqual(INJECTED_FORMATION.slots[id].pos);
      expect(f.beliefs[id]?.slot).toBe(id);
      expect(settledOnOwnSlot(f, id, P)).toBe(true);
    }
    const sent = busy.frames.flatMap(frame => frame.outputs.flatMap(out => (out === null ? [] : out.outbox)));
    expect(sent).toEqual([]);
    expect(busy.frames.every(frame => frame.outputs.every(out => out !== null && Array.isArray(out.outbox)))).toBe(true);
  });
});
