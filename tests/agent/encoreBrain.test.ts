// tests/agent/encoreBrain.test.ts
// Unit tests for issue #16 (WP-1b): ONE Encore brain driven by scripted AgentInput sequences
// (contract sections 7 and 8). No world: the surroundings are a script. Tests in which several brains
// interact are in encoreSwarm.test.ts.
//
// The script ("stage"): a 40-drone text formation in which every other drone j sits on slot j, is
// sensed there, and sends a heartbeat on its own heartbeat ticks, heard one tick later. A test changes
// who is sensed and what is heard. The brain under test is drone 33, parked on its launch slot 33.
// Every input is deep-frozen: a brain may not edit what it is given.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPERATOR, makeParams } from '../../src/contracts';
import type {
  AgentInput, AgentOutput, Belief, Heartbeat, Message, Params, Recipe, Score, ScoreMsg, Sensed, Vec3,
} from '../../src/contracts';
import { composeNext, currentMovement, expandRecipe, newerVersion } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { NEVER_HEARD, nextRandom } from '../../src/agent/state';
import type { EncoreState } from '../../src/agent/state';
import { steer, steerTarget } from '../../src/agent/steer';

// ---------- the show ----------

const N = 40;
const P = makeParams(N);                      // claimGap = 2
const TEXT: Recipe = { kind: 'text', text: 'ENCORE' };
const SPHERE: Recipe = { kind: 'sphere' };
const HOLD_START = 100;
/** One movement: the hold starts at tick 100, so a parked, hearing drone may heal from tick 140. */
const SCORE: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [{ startTick: 0, transitionTicks: HOLD_START, recipe: TEXT }],
};
/** The same, then a sphere from tick 300 with a 10-tick transition. */
const TWO_MOVEMENTS: Score = {
  version: { issuedTick: 0, origin: OPERATOR },
  movements: [
    { startTick: 0, transitionTicks: HOLD_START, recipe: TEXT },
    { startTick: 300, transitionTicks: 10, recipe: SPHERE },
  ],
};

const ME = 33;       // the brain under test: drone 33 on slot 33
const NEAR = 0;      // the most important slot within rClaim of slot 33
const NEAR2 = 4;     // the next one
const SENSED_FAR = 13;   // more important, within sensing range, but beyond rClaim

// ---------- small helpers ----------

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Where slot `slot` of `score` is at `tick`. */
function slotPos(slot: number, tick: number, score: Score = SCORE, params: Params = P): Vec3 {
  const p = expandRecipe(currentMovement(score, tick).movement.recipe, params.n0, params).slots[slot].pos;
  return [p[0], p[1], p[2]];
}

/** The first tick >= t on which drone `id` scans and sends its heartbeat. */
function scanAtOrAfter(t: number, id: number = ME, params: Params = P): number {
  let tick = t;
  while (tick % params.hbPeriod !== id % params.hbPeriod) tick++;
  return tick;
}

/** The last tick < t on which drone `id` sends a heartbeat. */
function lastSendBefore(t: number, id: number, params: Params = P): number {
  let tick = t - 1;
  while (tick % params.hbPeriod !== id % params.hbPeriod) tick--;
  return tick;
}

// ---------- the scripted surroundings ----------

interface Stage {
  id?: number;                                   // the brain under test (default ME); its launch slot is its id
  params?: Params;
  score?: Score;
  /** Where the body is. Default: parked on its LAUNCH slot of the current formation, whatever it believes. */
  pos?: (tick: number) => Vec3;
  vel?: (tick: number) => Vec3;                  // default: at rest
  /** Is drone j (sitting on slot j) there to be sensed at this tick? Default: yes. */
  sensed?: (j: number, tick: number) => boolean;
  /** The heartbeat drone j sends at `sent` (heard at sent + 1), or null for none. Default: `base`. */
  heartbeat?: (j: number, sent: number, base: Heartbeat) => Heartbeat | null;
  extra?: (tick: number) => Message[];           // more messages delivered at this tick
  radio?: boolean;                               // false: the inbox is always empty
  roundTrip?: boolean;                           // replace the state by JSON.parse(JSON.stringify(state)) before every step
}
interface Frame { tick: number; input: AgentInput; out: AgentOutput; belief: Belief; hb: Heartbeat | null; state: EncoreState }
interface Play { state: EncoreState; frames: Frame[] }

function baseHeartbeat(j: number, sent: number, score: Score, params: Params): Heartbeat {
  return {
    type: 'HB', from: j, seq: Math.floor(sent / params.hbPeriod), sentTick: sent,
    slot: j, heldSince: 0, version: { ...score.version }, pos: slotPos(j, sent, score, params),
  };
}

function inputAt(stage: Stage, tick: number): AgentInput {
  const id = stage.id ?? ME;
  const params = stage.params ?? P;
  const score = stage.score ?? SCORE;
  const posAt = stage.pos ?? ((t: number) => slotPos(id, t, score, params));
  const pos = posAt(tick);
  const vel: Vec3 = stage.vel ? stage.vel(tick) : [0, 0, 0];

  const sensed: Sensed[] = [];
  for (let j = 0; j < params.n0; j++) {
    if (j === id || (stage.sensed && !stage.sensed(j, tick))) continue;
    const rel = sub(slotPos(j, tick, score, params), pos);
    if (len(rel) <= params.rSense) sensed.push({ rel, vel: [-vel[0], -vel[1], -vel[2]] });
  }

  const inbox: Message[] = [];
  const sent = tick - 1;
  if (stage.radio !== false) {
    if (sent >= 1) {
      for (let j = 0; j < params.n0; j++) {
        if (j === id || sent % params.hbPeriod !== j % params.hbPeriod) continue;
        if (dist(slotPos(j, sent, score, params), posAt(sent)) > params.rRadio) continue;
        const base = baseHeartbeat(j, sent, score, params);
        const hb = stage.heartbeat ? stage.heartbeat(j, sent, base) : base;
        if (hb !== null) inbox.push(hb);
      }
    }
    if (stage.extra) inbox.push(...stage.extra(tick));
    inbox.sort((a, b) => a.sentTick - b.sentTick || a.from - b.from || a.seq - b.seq);
  }
  return deepFreeze({ tick, pos, vel, inbox, sensed });
}

function newState(stage: Stage = {}): EncoreState {
  const id = stage.id ?? ME;
  const params = stage.params ?? P;
  return encoreBrain.init({ id, n0: params.n0, initialSlot: id, score: stage.score ?? SCORE, params, seed: 1000 + id });
}

/** Steps a brain through ticks `from`..`to` of the stage. Each frame keeps a copy of the state after that step. */
function play(stage: Stage, to: number, start?: { state: EncoreState; from: number }): Play {
  let state = start ? start.state : newState(stage);
  const frames: Frame[] = [];
  for (let tick = start ? start.from : 1; tick <= to; tick++) {
    if (stage.roundTrip) state = jsonCopy(state);
    const input = inputAt(stage, tick);
    const out = encoreBrain.step(state, input);
    const first = out.outbox[0];
    frames.push({
      tick, input, out, belief: encoreBrain.belief(state), state: jsonCopy(state),
      hb: first !== undefined && first.type === 'HB' ? first : null,
    });
  }
  return { state, frames };
}

const frameAt = (p: Play, tick: number): Frame => {
  const f = p.frames.find(frame => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame for tick ${tick}`);
  return f;
};
/** Ticks at which the brain sent a heartbeat carrying a claim, with the claim. */
const claimsSent = (p: Play): { tick: number; slot: number; rank: number }[] =>
  p.frames.flatMap(f => (f.hb && f.hb.claim ? [{ tick: f.tick, slot: f.hb.claim.slot, rank: f.hb.claim.rank }] : []));
/** Ticks at which the believed slot differs from the tick before. */
function slotChanges(p: Play, initial: number): { tick: number; from: number; to: number }[] {
  const changes: { tick: number; from: number; to: number }[] = [];
  let slot = initial;
  for (const f of p.frames) {
    if (f.belief.slot !== slot) { changes.push({ tick: f.tick, from: slot, to: f.belief.slot }); slot = f.belief.slot; }
  }
  return changes;
}

/** Drone `id` dies at tick `at`: from then on it is neither sensed nor does it send. Heartbeats sent before are heard. */
function dies(ids: number[], at: number): Pick<Stage, 'sensed' | 'heartbeat'> {
  return {
    sensed: (j, tick) => !(ids.includes(j) && tick >= at),
    heartbeat: (j, sent, base) => (ids.includes(j) && sent >= at ? null : base),
  };
}

// ---------- the reference scenario: drone 0 dies at tick 200 ----------

const KILL = 200;
/** Tick at which the last heartbeat of drone 0 is heard. */
const LAST_HEARD = lastSendBefore(KILL, NEAR) + 1;                                  // 196
/** First scan on which slot 0 is sensed empty. */
const EMPTY_FROM = scanAtOrAfter(KILL);                                             // 203
const CLAIM = scanAtOrAfter(Math.max(EMPTY_FROM + P.tVacant, LAST_HEARD + P.tSuspect));   // 258
const COMMIT = scanAtOrAfter(CLAIM + P.claimWindow);                                // 278

const reference = (to: number, more: Stage = {}): Play => play({ ...dies([NEAR], KILL), ...more }, to);

describe('the show used by these tests', () => {
  it('has the geometry the tests rely on', () => {
    expect(P.claimGap).toBe(2);
    const d = (v: number) => dist(slotPos(v, 1), slotPos(ME, 1));
    // Slot 0 is the most important slot within rClaim of slot 33; slot 4 is the next.
    for (let v = 0; v < ME; v++) {
      if (v === NEAR || v === NEAR2) expect(d(v)).toBeLessThanOrEqual(P.rClaim);
      else if (v < NEAR2) expect(d(v)).toBeGreaterThan(P.rClaim);
    }
    // Slot 13 can be sensed (so "empty" there would be a real observation) but is beyond rClaim.
    expect(d(SENSED_FAR)).toBeGreaterThan(P.rClaim);
    expect(d(SENSED_FAR)).toBeLessThanOrEqual(P.rSense);
    // Slots 31, 32, 34 and 39 are within rClaim but not claimGap + 1 more important than slot 33.
    for (const v of [31, 32, 34, 39]) expect(d(v)).toBeLessThanOrEqual(P.rClaim);
    // Drones 5, 20, 32, 34 and 39 are within radio range.
    for (const j of [5, 20, 32, 34, 39]) expect(d(j)).toBeLessThanOrEqual(P.rRadio);
    // In the sphere, slot 4 is within rClaim of slot 33 too, and slot 0 can be sensed from slot 33.
    const sphere = (v: number) => dist(slotPos(v, 400, TWO_MOVEMENTS), slotPos(ME, 400, TWO_MOVEMENTS));
    expect(sphere(NEAR2)).toBeLessThanOrEqual(P.rClaim);
    expect(sphere(NEAR)).toBeLessThanOrEqual(P.rSense);
    expect(sphere(NEAR)).toBeGreaterThan(P.rOcc);
  });

  it('has the timeline the tests rely on', () => {
    expect([LAST_HEARD, EMPTY_FROM, CLAIM, COMMIT]).toEqual([196, 203, 258, 278]);
  });
});

describe('encoreBrain: init, state and the seeded stream (contract section 7)', () => {
  it("has kind 'encore'", () => {
    expect(encoreBrain.kind).toBe('encore');
  });

  it('init gives the state of section 7', () => {
    const s = encoreBrain.init({ id: 7, n0: N, initialSlot: 21, score: SCORE, params: P, seed: 123456 });
    expect(s).toStrictEqual({
      id: 7, n0: N, params: P,
      slot: 21, heldSince: 0, history: [],
      score: SCORE, mvIndex: 0,
      lastTargetChange: 0, settledSince: null,
      lastRx: NEVER_HEARD,
      peers: new Array(N).fill(null), slotHeard: new Array(N).fill(0), emptySince: new Array(N).fill(null),
      claim: null, yieldSince: null,
      scoreSendAt: null, lastScoreSent: -P.scoreResendMin,
      seq: 0, rng: 123456, log: [],
      now: 0, canHeal: false,
    });
    expect(NEVER_HEARD).toBeLessThan(-1e6);
    expect(Number.isSafeInteger(NEVER_HEARD)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
  });

  it('mvIndex is the movement that is current at tick 0', () => {
    const score: Score = {
      version: { issuedTick: 0, origin: OPERATOR },
      movements: [{ startTick: -50, transitionTicks: 10, recipe: TEXT }, { startTick: 0, transitionTicks: 10, recipe: SPHERE }],
    };
    expect(encoreBrain.init({ id: 1, n0: N, initialSlot: 1, score, params: P, seed: 1 }).mvIndex).toBe(1);
  });

  it('the state shares no object with what init was given', () => {
    const score = jsonCopy(SCORE);
    const params = { ...P };
    const s = encoreBrain.init({ id: 3, n0: N, initialSlot: 3, score, params, seed: 7 });
    score.version.issuedTick = 999;
    score.movements.length = 0;
    params.tVacant = 1;
    expect(s.score).toEqual(SCORE);
    expect(s.params).toEqual(P);
  });

  it('rejects an initialSlot that is not a slot of the roster', () => {
    for (const bad of [-1, N, 1.5, Number.NaN]) {
      expect(() => encoreBrain.init({ id: 0, n0: N, initialSlot: bad, score: SCORE, params: P, seed: 1 })).toThrow(RangeError);
    }
  });

  it('nextRandom is a seeded uint32 stream kept in the state', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const c = { rng: 43 };
    const fromA = [nextRandom(a), nextRandom(a), nextRandom(a), nextRandom(a)];
    const fromB = [nextRandom(b), nextRandom(b), nextRandom(b), nextRandom(b)];
    const fromC = [nextRandom(c), nextRandom(c), nextRandom(c), nextRandom(c)];
    expect(fromB).toEqual(fromA);
    expect(fromC).not.toEqual(fromA);
    expect(new Set(fromA).size).toBe(4);
    for (const v of fromA) expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    expect(Number.isInteger(a.rng) && a.rng >= 0 && a.rng <= 0xffffffff).toBe(true);
    // The stream continues from the stored state: a copy of the state gives the same next value.
    const copy = jsonCopy(a);
    expect(nextRandom(copy)).toBe(nextRandom(a));
    // Roughly uniform: the mean of 4000 draws is near the middle of the range.
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += nextRandom(a) / 0x100000000;
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
  });

  it('the brain files import only the contracts, the score package and their own package', () => {
    const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../src/agent/${name}`, import.meta.url)), 'utf8');
    const specifiers = (source: string) => [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
    expect([...new Set(specifiers(read('encoreBrain.ts')))]).toEqual(['../contracts', '../score', './state', './steer']);
    expect([...new Set(specifiers(read('state.ts')))]).toEqual(['../contracts']);
    for (const name of ['encoreBrain.ts', 'state.ts']) {
      const code = read(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments removed
      expect(code).toContain('export ');
      expect(code).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^import\s+['"]/m);
      expect(code).not.toMatch(/Math\s*\.\s*random|\bDate\b|\bperformance\b/);
      expect(code).not.toMatch(/^(let|var)\s/m);            // no module-level mutable binding
      expect(code).not.toMatch(/new (Map|Set|WeakMap)\b/);
    }
  });
});

describe('encoreBrain: belief (contract section 4)', () => {
  it('before the first step: the launch slot, its position at tick 0, deaf, not healing', () => {
    for (const slot of [0, 17, N - 1]) {
      const s = encoreBrain.init({ id: slot, n0: N, initialSlot: slot, score: SCORE, params: P, seed: 5 });
      expect(encoreBrain.belief(s)).toStrictEqual({
        slot, heldSince: 0, target: slotPos(slot, 0),
        version: { issuedTick: 0, origin: OPERATOR },
        deaf: true, canHeal: false, claiming: null, peersKnown: 0, log: [],
      });
    }
  });

  it('target is my slot of the current movement, and follows the clock', () => {
    const p = play({ score: TWO_MOVEMENTS }, 320);
    expect(frameAt(p, 1).belief.target).toEqual(slotPos(ME, 1, TWO_MOVEMENTS));
    expect(frameAt(p, 299).belief.target).toEqual(slotPos(ME, 299, TWO_MOVEMENTS));
    expect(frameAt(p, 300).belief.target).toEqual(slotPos(ME, 300, TWO_MOVEMENTS));
    expect(frameAt(p, 300).belief.target).not.toEqual(frameAt(p, 299).belief.target);
    expect(frameAt(p, 320).state.mvIndex).toBe(1);
  });

  it('deaf, peersKnown and canHeal come from what the drone heard', () => {
    const p = reference(CLAIM - 1);
    // Tick 1: nothing heard yet (the first heartbeats were sent at tick 1 and arrive at tick 2).
    expect(frameAt(p, 1).belief).toMatchObject({ deaf: true, peersKnown: 0, canHeal: false });
    expect(frameAt(p, 2).belief.deaf).toBe(false);
    // Every other drone within radio range has been heard after one heartbeat period.
    let inRange = 0;
    for (let j = 0; j < N; j++) if (j !== ME && dist(slotPos(j, 1), slotPos(ME, 1)) <= P.rRadio) inRange++;
    expect(inRange).toBeGreaterThan(20);
    expect(frameAt(p, 1 + P.hbPeriod + 1).belief.peersKnown).toBe(inRange);
    expect(frameAt(p, KILL).belief.peersKnown).toBe(inRange);
    // Drone 0 was last heard at tick 196: it is suspected (no longer "known") tSuspect later.
    expect(frameAt(p, LAST_HEARD + P.tSuspect - 1).belief.peersKnown).toBe(inRange);
    expect(frameAt(p, LAST_HEARD + P.tSuspect).belief.peersKnown).toBe(inRange - 1);
    // canHeal is false until the hold grace has passed, and is the value of the last scan.
    const firstHeal = scanAtOrAfter(HOLD_START + P.holdGrace);
    for (const f of p.frames) expect(f.belief.canHeal, `tick ${f.tick}`).toBe(f.tick >= firstHeal);
  });

  it('returns fresh objects: editing a belief changes nothing in the brain', () => {
    const p = reference(COMMIT + 5);
    const before = jsonCopy(p.state);
    const b = encoreBrain.belief(p.state);
    b.target[0] += 100;
    b.version.issuedTick = 500;
    b.log.push('edited by the observer');
    b.slot = 7;
    expect(p.state).toStrictEqual(before);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });

  it('a peer-table entry not refreshed for 200 ticks is dropped (section 3)', () => {
    // Drone 2 is in radio range but too far to sense. It falls silent at tick 200.
    const far = 2;
    expect(dist(slotPos(far, 1), slotPos(ME, 1))).toBeGreaterThan(P.rSense);
    const p = play({ heartbeat: (j, sent, base) => (j === far && sent >= KILL ? null : base) }, 420);
    const heard = lastSendBefore(KILL, far) + 1;
    const dropped = scanAtOrAfter(heard + 200);
    expect(frameAt(p, dropped - 1).state.peers[far]).toEqual({ slot: far, heldSince: 0, version: SCORE.version, claim: null, heard });
    expect(frameAt(p, dropped).state.peers[far]).toBeNull();
    // Radio silence is never treated as death: nothing else happened.
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
  });
});

describe('encoreBrain: heartbeats (section 8.3, step 5)', () => {
  it('sends exactly one heartbeat every hbPeriod ticks, on tick % hbPeriod === id % hbPeriod, and nothing else', () => {
    for (const id of [ME, 7, 20]) {
      // The body drifts, so that `pos` is seen to be the position at the time of sending.
      const pos = (tick: number): Vec3 => add(slotPos(id, tick), [0.01 * tick, 0, 0]);
      const p = play({ id, pos }, 120);
      let seq = 0;
      for (const f of p.frames) {
        if (f.tick % P.hbPeriod !== id % P.hbPeriod) {
          expect(f.out.outbox, `drone ${id} tick ${f.tick}`).toEqual([]);
          continue;
        }
        expect(f.out.outbox, `drone ${id} tick ${f.tick}`).toHaveLength(1);
        expect(f.out.outbox[0]).toStrictEqual({
          type: 'HB', from: id, seq, sentTick: f.tick, slot: id, heldSince: 0,
          version: { issuedTick: 0, origin: OPERATOR }, pos: pos(f.tick),
        });
        expect('claim' in f.out.outbox[0]).toBe(false);      // omitted, not undefined
        seq++;
      }
      expect(seq).toBe(120 / P.hbPeriod);
    }
  });

  it('a heartbeat shares no object with the state, the input or the frozen formation', () => {
    const s = newState();
    const input = inputAt({}, 3);
    const out = encoreBrain.step(s, input);
    const hb = out.outbox[0] as Heartbeat;
    expect(hb.version).not.toBe(s.score.version);
    expect(hb.pos).not.toBe(input.pos);
    hb.version.issuedTick = 77;
    hb.pos[0] = 1e6;
    out.colour[0] = 0.123;       // would throw if it were the frozen slot colour
    out.accel[0] = 0;
    expect(s.score.version).toEqual({ issuedTick: 0, origin: OPERATOR });
    expect(encoreBrain.step(s, inputAt({}, 8)).outbox[0]).toMatchObject({ version: { issuedTick: 0, origin: OPERATOR }, seq: 1 });
  });

  it('accel is steer towards my slot, and the colour is my slot colour', () => {
    const pos: Vec3 = [3, 12, -4];
    const vel: Vec3 = [1, 2, -1];
    const p = play({ pos: () => pos, vel: () => vel }, 6);
    for (const f of p.frames) {
      const slot = expandRecipe(TEXT, N, P).slots[ME];
      expect(f.out.accel).toEqual(steer(pos, vel, steerTarget(ME, pos, slot.pos, P), f.input.sensed, P));
      expect(f.out.colour).toEqual(slot.colour);
    }
  });
});

describe('encoreBrain: canHeal (section 8.2)', () => {
  it('a quiet show: no claim, no slot change, no log entry in 800 ticks', () => {
    const p = play({}, 800);
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.state.log).toEqual([]);
    expect(p.state.history).toEqual([]);
    expect(frameAt(p, 800).belief).toMatchObject({ slot: ME, heldSince: 0, canHeal: true, deaf: false, claiming: null });
  });

  it('5. a deaf drone never claims, even with an obviously empty, more important slot beside it', () => {
    // No radio at all, ever. Slots 0 and 4 are empty from the first tick.
    const p = play({ radio: false, sensed: j => j !== NEAR && j !== NEAR2 }, 800);
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    for (const f of p.frames) {
      expect(f.input.inbox).toEqual([]);
      expect(f.belief.deaf).toBe(true);
      expect(f.belief.canHeal).toBe(false);
      expect(f.belief.claiming).toBeNull();
    }
    expect(p.state.emptySince.every(e => e === null)).toBe(true);
    expect(p.state.lastRx).toBe(NEVER_HEARD);
    // It keeps flying its score and keeps sending heartbeats, without a claim.
    expect(p.frames.filter(f => f.hb !== null)).toHaveLength(800 / P.hbPeriod);
  });

  it('5. hearing only the operator does not end deafness', () => {
    const next = composeNext(SCORE, 150, SPHERE, ME, N, P);
    const uplink = (tick: number): ScoreMsg => ({ type: 'SCORE', from: OPERATOR, seq: tick, sentTick: tick, score: next });
    const p = play({ radio: true, heartbeat: () => null, sensed: j => j !== NEAR, extra: tick => [uplink(tick)] }, 400);
    expect(p.frames.every(f => f.input.inbox.length === 1 && f.belief.deaf)).toBe(true);
    expect(p.state.lastRx).toBe(NEVER_HEARD);
    expect(claimsSent(p)).toEqual([]);
  });

  it('5. a drone that goes deaf while claiming drops the claim and does not commit', () => {
    // The radio dies at tick 226 (last message heard at 225). The claim starts at 258, when the drone
    // is not yet deaf (258 - 225 <= tDeaf). From tick 266 it is deaf: the claim is dropped at the scan of 268.
    const quietFrom = 226;
    const p = play({ ...dies([NEAR], KILL), heartbeat: (j, sent, base) => (sent + 1 >= quietFrom || (j === NEAR && sent >= KILL) ? null : base) }, 500);
    expect(p.state.lastRx).toBe(quietFrom - 1);
    const deafScan = scanAtOrAfter(quietFrom - 1 + P.tDeaf + 1);
    expect(deafScan).toBeLessThan(COMMIT);
    expect(claimsSent(p).map(c => c.tick)).toEqual([258, 263]);
    expect(frameAt(p, deafScan - 1).belief).toMatchObject({ claiming: NEAR, canHeal: true });
    expect(frameAt(p, deafScan).belief).toMatchObject({ claiming: null, canHeal: false, deaf: true });
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.state.log).toEqual(['t=258 claim slot 0 (bid 33)', `t=${deafScan} drop claim on slot 0: I may not heal now`]);
  });

  it('1. never claims during a transition or the hold grace time', () => {
    // The hold starts at tick 400. Slot 0 is empty and silent from the first tick; the drone is parked and hears the rest.
    const score: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [{ startTick: 0, transitionTicks: 400, recipe: TEXT }] };
    const p = play({ score, sensed: j => j !== NEAR, heartbeat: (j, _sent, base) => (j === NEAR ? null : base) }, 505);
    const firstHeal = scanAtOrAfter(400 + P.holdGrace);
    expect(firstHeal).toBe(443);
    for (const f of p.frames) expect(f.belief.canHeal, `tick ${f.tick}`).toBe(f.tick >= firstHeal);
    // Until then no slot is even watched; the claim comes tVacant after the first allowed scan.
    expect(frameAt(p, firstHeal - 1).state.emptySince.every(e => e === null)).toBe(true);
    expect(frameAt(p, firstHeal).state.emptySince[NEAR]).toBe(firstHeal);
    expect(claimsSent(p)[0]).toEqual({ tick: firstHeal + P.tVacant, slot: NEAR, rank: ME });
    expect(slotChanges(p, ME)).toEqual([{ tick: firstHeal + P.tVacant + P.claimWindow, from: ME, to: NEAR }]);
  });

  it('2. never claims before its own target has been unchanged for tStable', () => {
    // Drone 4 dies at tick 250. The formation changes at tick 300 (10-tick transition), and the body
    // is scripted onto its new slot at once, so only tStable holds the drone back until tick 420.
    const p = play({ score: TWO_MOVEMENTS, ...dies([NEAR2], 250) }, 500);
    expect(300 + 10 + P.holdGrace).toBeLessThan(300 + P.tStable);
    const firstHeal = scanAtOrAfter(300 + P.tStable);
    expect(firstHeal).toBe(423);
    // (Belief.canHeal is the value of the last scan, so it is checked from the first scan after the change.)
    for (const f of p.frames) {
      if (f.tick >= scanAtOrAfter(300) && f.tick <= firstHeal + P.tVacant) expect(f.belief.canHeal, `tick ${f.tick}`).toBe(f.tick >= firstHeal);
    }
    expect(frameAt(p, 299).state.emptySince[NEAR2]).toBe(scanAtOrAfter(250));     // it had started watching
    expect(frameAt(p, 300).state).toMatchObject({ lastTargetChange: 300, mvIndex: 1, settledSince: 300 });
    expect(frameAt(p, 300).state.emptySince.every(e => e === null)).toBe(true);   // and forgot it at the change
    expect(claimsSent(p)[0]).toEqual({ tick: firstHeal + P.tVacant, slot: NEAR2, rank: ME });
    expect(claimsSent(p).every(c => c.tick >= 300 + P.tStable + P.tVacant)).toBe(true);
  });

  it('3. never claims before it has been at its slot and slow for tSettle', () => {
    const cases: { name: string; stage: Stage }[] = [
      { name: 'too fast', stage: { vel: tick => (tick < 300 ? [0.5, 0, 0] : [0, 0, 0]) } },
      { name: 'too far', stage: { pos: tick => add(slotPos(ME, tick), tick < 300 ? [P.rOcc + 0.01, 0, 0] : [0, 0, 0]) } },
    ];
    for (const c of cases) {
      const p = play({ ...c.stage, sensed: j => j !== NEAR, heartbeat: (j, _sent, base) => (j === NEAR ? null : base) }, 385);
      const firstHeal = scanAtOrAfter(300 + P.tSettle);
      expect(firstHeal).toBe(323);
      expect(frameAt(p, 299).state.settledSince, c.name).toBeNull();
      expect(frameAt(p, 300).state.settledSince, c.name).toBe(300);
      for (const f of p.frames) expect(f.belief.canHeal, `${c.name}, tick ${f.tick}`).toBe(f.tick >= firstHeal);
      expect(claimsSent(p)[0], c.name).toEqual({ tick: firstHeal + P.tVacant, slot: NEAR, rank: ME });
    }
    // Just inside both limits counts as settled from the first tick.
    const inside = play({ vel: () => [0.49, 0, 0], pos: tick => add(slotPos(ME, tick), [P.rOcc - 0.01, 0, 0]) }, 200);
    expect(inside.state.settledSince).toBe(1);
    expect(inside.state.canHeal).toBe(true);
  });

  it('4. never claims while a heartbeat heard within tDeaf carries another score version', () => {
    // Drone 20 flies another version until tick 300, then the same one again.
    const other = { issuedTick: 50, origin: 3 };
    const p = play({
      sensed: j => j !== NEAR,
      heartbeat: (j, sent, base) => (j === NEAR ? null : j === 20 && sent < 300 ? { ...base, version: other } : base),
    }, 365);
    const agreed = lastSendBefore(300 + P.hbPeriod, 20) + 1;      // tick at which drone 20's first matching heartbeat is heard
    const firstHeal = scanAtOrAfter(agreed);
    for (const f of p.frames) expect(f.belief.canHeal, `tick ${f.tick}`).toBe(f.tick >= firstHeal);
    expect(claimsSent(p)[0]).toEqual({ tick: firstHeal + P.tVacant, slot: NEAR, rank: ME });
    // A stale drone that falls silent stops blocking once its last heartbeat is older than tDeaf.
    const q = play({
      sensed: j => j !== NEAR,
      heartbeat: (j, sent, base) => (j === NEAR ? null : j === 20 ? (sent < 300 ? { ...base, version: other } : null) : base),
    }, 400);
    const lastStale = lastSendBefore(300, 20) + 1;
    const healAgain = scanAtOrAfter(lastStale + P.tDeaf + 1);
    for (const f of q.frames) expect(f.belief.canHeal, `tick ${f.tick}`).toBe(f.tick >= healAgain);
  });

  it('when canHeal turns false, every emptySince timer is cleared', () => {
    // Drone 0 dies at 200; the drone under test is pushed off its slot from tick 230 to 239.
    const p = reference(330, { pos: tick => add(slotPos(ME, tick), tick >= 230 && tick < 240 ? [1, 0, 0] : [0, 0, 0]) });
    expect(frameAt(p, 229).state.emptySince[NEAR]).toBe(EMPTY_FROM);
    const lostAt = scanAtOrAfter(230);
    expect(frameAt(p, lostAt).state.emptySince.every(e => e === null)).toBe(true);
    expect(frameAt(p, lostAt).belief.canHeal).toBe(false);
    // Settled again from 240, allowed from 260, so the vacancy timer restarts at the scan of 263.
    const again = scanAtOrAfter(240 + P.tSettle);
    expect(frameAt(p, again).state.emptySince[NEAR]).toBe(again);
    expect(claimsSent(p)[0]).toEqual({ tick: again + P.tVacant, slot: NEAR, rank: ME });
  });
});

describe('encoreBrain: vacancy, claim and commit (section 8.3, step 4)', () => {
  it('claims a sensed-empty, silent, more important slot, announces it, and commits after claimWindow', () => {
    const p = reference(COMMIT + 30);

    // Before the claim: nothing.
    for (const f of p.frames) if (f.tick < CLAIM) expect(f.belief.claiming, `tick ${f.tick}`).toBeNull();
    expect(frameAt(p, EMPTY_FROM - 1).state.emptySince[NEAR]).toBeNull();
    expect(frameAt(p, EMPTY_FROM).state.emptySince[NEAR]).toBe(EMPTY_FROM);
    // One scan before the claim the slot had been empty for long enough, but not silent for long enough.
    expect(CLAIM - P.hbPeriod - EMPTY_FROM).toBeGreaterThanOrEqual(P.tVacant);
    expect(CLAIM - P.hbPeriod - LAST_HEARD).toBeLessThan(P.tSuspect);

    // The claim is in every heartbeat of the window: target slot, and my current slot as the bid.
    expect(claimsSent(p)).toEqual([258, 263, 268, 273].map(tick => ({ tick, slot: NEAR, rank: ME })));
    expect(frameAt(p, CLAIM).hb).toStrictEqual({
      type: 'HB', from: ME, seq: Math.floor(CLAIM / P.hbPeriod), sentTick: CLAIM, slot: ME, heldSince: 0,
      version: { issuedTick: 0, origin: OPERATOR }, pos: slotPos(ME, CLAIM), claim: { slot: NEAR, rank: ME },
    });
    expect(frameAt(p, CLAIM).state.claim).toEqual({ slot: NEAR, start: CLAIM });
    for (let tick = CLAIM; tick < COMMIT; tick++) {
      expect(frameAt(p, tick).belief).toMatchObject({ slot: ME, heldSince: 0, claiming: NEAR });
    }

    // The commit: the first heartbeat after it is the recovery notification.
    expect(slotChanges(p, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }]);
    expect(frameAt(p, COMMIT).hb).toStrictEqual({
      type: 'HB', from: ME, seq: Math.floor(COMMIT / P.hbPeriod), sentTick: COMMIT, slot: NEAR, heldSince: COMMIT,
      version: { issuedTick: 0, origin: OPERATOR }, pos: slotPos(ME, COMMIT),
    });
    const after = frameAt(p, COMMIT);
    expect(after.belief).toMatchObject({ slot: NEAR, heldSince: COMMIT, claiming: null, target: slotPos(NEAR, COMMIT) });
    expect(after.state).toMatchObject({
      slot: NEAR, heldSince: COMMIT, claim: null, history: [{ slot: ME, heldSince: 0 }],
      lastTargetChange: COMMIT, settledSince: null, yieldSince: null,
    });
    expect(after.state.emptySince.every(e => e === null)).toBe(true);
    expect(after.belief.log).toEqual(['t=258 claim slot 0 (bid 33)', 't=278 commit slot 0 (was 33)']);
    // From the commit tick on it flies to, and shows the colour of, the new slot.
    const slot0 = expandRecipe(TEXT, N, P).slots[NEAR];
    expect(after.out.accel).toEqual(steer(after.input.pos, after.input.vel, steerTarget(ME, after.input.pos, slot0.pos, P), after.input.sensed, P));
    expect(after.out.colour).toEqual(slot0.colour);
    // The slot index strictly decreased, by more than claimGap.
    expect(NEAR + P.claimGap).toBeLessThan(ME);
    // Nothing more happens: it is not settled on the new slot (the scripted body never moves).
    expect(claimsSent(p).every(c => c.tick < COMMIT)).toBe(true);
    expect(p.state.slot).toBe(NEAR);
  });

  it('only after tSuspect: a slot it has long sensed empty is not claimed until its holder has been silent for tSuspect', () => {
    // Slot 0 is sensed empty from tick 150, but its holder is heard until it falls silent at tick 300.
    const p = play({ sensed: (j, tick) => !(j === NEAR && tick >= 150), heartbeat: (j, sent, base) => (j === NEAR && sent >= 300 ? null : base) }, 400);
    const heard = lastSendBefore(300, NEAR) + 1;
    const expected = scanAtOrAfter(heard + P.tSuspect);
    expect(frameAt(p, expected - 1).state.emptySince[NEAR]).toBe(scanAtOrAfter(150));
    expect(expected - scanAtOrAfter(150)).toBeGreaterThan(3 * P.tVacant);
    expect(claimsSent(p)[0]).toEqual({ tick: expected, slot: NEAR, rank: ME });
    expect(slotChanges(p, ME)).toEqual([{ tick: expected + P.claimWindow, from: ME, to: NEAR }]);
  });

  it('only after tVacant: a slot whose holder has long been silent is not claimed until it has been sensed empty for tVacant', () => {
    // The holder of slot 0 is silent from tick 150 (jammed, say) but still sensed on its slot until tick 300.
    const p = play({ sensed: (j, tick) => !(j === NEAR && tick >= 300), heartbeat: (j, sent, base) => (j === NEAR && sent >= 150 ? null : base) }, 400);
    const empty = scanAtOrAfter(300);
    for (const f of p.frames) if (f.tick < empty) expect(f.state.emptySince[NEAR], `tick ${f.tick}`).toBeNull();
    expect(empty + P.tVacant - (lastSendBefore(150, NEAR) + 1)).toBeGreaterThan(3 * P.tSuspect);
    expect(claimsSent(p)[0]).toEqual({ tick: empty + P.tVacant, slot: NEAR, rank: ME });
    expect(slotChanges(p, ME)).toEqual([{ tick: empty + P.tVacant + P.claimWindow, from: ME, to: NEAR }]);
  });

  it('radio silence is never treated as death: a silent holder that is still sensed is never replaced', () => {
    const p = play({ heartbeat: (j, sent, base) => (j === NEAR && sent >= 150 ? null : base) }, 800);
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.state.emptySince[NEAR]).toBeNull();
  });

  it('does NOT claim a slot whose holder it keeps hearing, although it cannot sense that position as occupied', () => {
    const p = play({ sensed: (j, tick) => !(j === NEAR && tick >= 150) }, 800);
    expect(p.state.emptySince[NEAR]).toBe(scanAtOrAfter(150));      // it does see the slot empty
    expect(800 - p.state.slotHeard[NEAR]).toBeLessThanOrEqual(P.hbPeriod);
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.frames.every(f => f.belief.claiming === null)).toBe(true);
  });

  it('a sensed drone anywhere within rOcc of the slot position makes it occupied; one just outside does not', () => {
    // Drone 0 is dead. An anonymous drone hovers near slot 0: 0.59 m away in one run, 0.61 m in the other.
    const hover = (offset: number): Play => {
      const stage: Stage = { ...dies([NEAR], KILL) };
      const base = (tick: number) => inputAt(stage, tick);
      const state = newState();
      const frames: Frame[] = [];
      for (let tick = 1; tick <= COMMIT; tick++) {
        const input = jsonCopy(base(tick)) as AgentInput & { sensed: Sensed[] };
        if (tick >= KILL) input.sensed.push({ rel: sub(add(slotPos(NEAR, tick), [0, offset, 0]), input.pos), vel: [0, 0, 0] });
        const out = encoreBrain.step(state, deepFreeze(input));
        frames.push({ tick, input, out, belief: encoreBrain.belief(state), state: jsonCopy(state), hb: (out.outbox[0] as Heartbeat | undefined) ?? null });
      }
      return { state, frames };
    };
    const inside = hover(P.rOcc - 0.01);
    expect(inside.state.emptySince[NEAR]).toBeNull();
    expect(claimsSent(inside)).toEqual([]);
    const outside = hover(P.rOcc + 0.01);
    expect(claimsSent(outside)[0]).toEqual({ tick: CLAIM, slot: NEAR, rank: ME });
    expect(outside.state.slot).toBe(NEAR);
  });

  it('claims only slots within rClaim of where it is', () => {
    // Slot 13 is more important, empty and silent, and close enough to be sensed, but beyond rClaim.
    const p = play(dies([SENSED_FAR], KILL), 800);
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.frames.every(f => f.state.emptySince[SENSED_FAR] === null)).toBe(true);   // not watched
  });

  describe('a watched slot that leaves rClaim (I drift within rOcc of my own slot) is no longer watched', () => {
    // Slot 25 is 6.19 m from slot 33: just beyond rClaim = 6. A body leaning 0.3 m towards it is still
    // "at its slot" (0.3 < rOcc) and has slot 25 within rClaim, at 5.89 m.
    const FRINGE = 25;
    const LEAN = 0.3;
    const home = slotPos(ME, 1);
    const towards = sub(slotPos(FRINGE, 1), home);
    const k = LEAN / len(towards);
    const leaning: Vec3 = add(home, [towards[0] * k, towards[1] * k, towards[2] * k]);
    /** The body leans towards slot 25 on the ticks for which `leans` is true, and sits exactly on slot 33 otherwise. */
    const body = (leans: (tick: number) => boolean): Stage['pos'] => tick => (leans(tick) ? leaning : home);
    const silent = dies([FRINGE], KILL).heartbeat;
    const FIRST_SCAN_OUTSIDE = scanAtOrAfter(230);                                   // 233

    it('has the geometry these tests rely on', () => {
      expect(dist(slotPos(FRINGE, 1), home)).toBeGreaterThan(P.rClaim);
      expect(dist(slotPos(FRINGE, 1), home)).toBeLessThanOrEqual(P.rSense - P.rOcc);   // it can be sensed from home
      expect(dist(slotPos(FRINGE, 1), leaning)).toBeLessThanOrEqual(P.rClaim);
      expect(LEAN).toBeLessThan(P.rOcc);
      expect(FRINGE + P.claimGap).toBeLessThan(ME);
      expect(FIRST_SCAN_OUTSIDE).toBe(233);
      // The control: leaning all the time, with drone 25 dead, slot 25 is claimed on the reference timeline.
      const control = play({ ...dies([FRINGE], KILL), pos: body(() => true) }, COMMIT);
      expect(control.frames.every(f => f.tick < CLAIM || f.belief.canHeal)).toBe(true);
      expect(claimsSent(control)[0]).toEqual({ tick: CLAIM, slot: FRINGE, rank: ME });
      expect(slotChanges(control, ME)).toEqual([{ tick: COMMIT, from: ME, to: FRINGE }]);
    });

    it('its timer is cleared: a silent holder that comes back while the slot is beyond rClaim is not replaced', () => {
      // Drone 25 is silent from tick 200, away from its slot during ticks 200..239, and sensed on it again from 240.
      // I lean towards slot 25 until tick 229 (watching it, seeing it empty from 203), then sit on slot 33.
      const p = play({
        sensed: (j, tick) => !(j === FRINGE && tick >= KILL && tick < 240),
        heartbeat: silent,
        pos: body(tick => tick <= 229),
      }, 400);
      expect(frameAt(p, FIRST_SCAN_OUTSIDE - 1).state.emptySince[FRINGE]).toBe(EMPTY_FROM);   // watched, seen empty
      for (const f of p.frames) {
        if (f.tick >= FIRST_SCAN_OUTSIDE) expect(f.state.emptySince[FRINGE], `tick ${f.tick}`).toBeNull();
      }
      // Nothing else was in the way: it may heal, and the slot has been silent for tSuspect.
      expect(frameAt(p, CLAIM).belief.canHeal).toBe(true);
      expect(CLAIM - frameAt(p, CLAIM).state.slotHeard[FRINGE]).toBeGreaterThanOrEqual(P.tSuspect);
      expect(claimsSent(p)).toEqual([]);
      expect(slotChanges(p, ME)).toEqual([]);
      expect(p.frames.every(f => f.belief.claiming === null)).toBe(true);
      expect(encoreBrain.belief(p.state).log).toEqual([]);
    });

    it('it is not claimed from beyond rClaim even when it really is empty and silent', () => {
      const p = play({ ...dies([FRINGE], KILL), pos: body(tick => tick <= 229) }, 800);
      expect(frameAt(p, FIRST_SCAN_OUTSIDE - 1).state.emptySince[FRINGE]).toBe(EMPTY_FROM);
      expect(p.state.emptySince[FRINGE]).toBeNull();
      expect(claimsSent(p)).toEqual([]);
      expect(slotChanges(p, ME)).toEqual([]);
    });

    it('a claim in progress on it is dropped, not committed', () => {
      // The slot leaves rClaim five ticks into the contention window.
      const p = play({ ...dies([FRINGE], KILL), pos: body(tick => tick < CLAIM + P.hbPeriod) }, COMMIT + 100);
      expect(claimsSent(p)).toEqual([{ tick: CLAIM, slot: FRINGE, rank: ME }]);
      expect(frameAt(p, CLAIM + P.hbPeriod).belief.log).toEqual([
        `t=${CLAIM} claim slot ${FRINGE} (bid ${ME})`, `t=${CLAIM + P.hbPeriod} drop claim on slot ${FRINGE}: no longer vacant`,
      ]);
      expect(frameAt(p, CLAIM + P.hbPeriod).state.emptySince[FRINGE]).toBeNull();
      expect(slotChanges(p, ME)).toEqual([]);
    });

    it('when it comes back within rClaim the timer starts again: empty for tVacant means while watched', () => {
      // Leaning until 229, on slot 33 during 230..239, leaning again from 240. Drone 25 is dead throughout.
      const p = play({ ...dies([FRINGE], KILL), pos: body(tick => tick <= 229 || tick >= 240) }, 400);
      const back = scanAtOrAfter(240);
      expect(frameAt(p, back - 1).state.emptySince[FRINGE]).toBeNull();
      expect(frameAt(p, back).state.emptySince[FRINGE]).toBe(back);
      expect(claimsSent(p)[0]).toEqual({ tick: back + P.tVacant, slot: FRINGE, rank: ME });
      expect(slotChanges(p, ME)).toEqual([{ tick: back + P.tVacant + P.claimWindow, from: ME, to: FRINGE }]);
    });
  });

  it('does not claim when v + claimGap >= its own slot', () => {
    // Slots 31, 32, 34 and 39 are within rClaim, empty and silent. None is claimGap + 1 more important than 33.
    const stage = dies([31, 32, 34, 39], KILL);
    const p = play(stage, 800);
    for (const v of [31, 32, 34, 39]) expect(p.state.emptySince[v]).toBe(EMPTY_FROM);   // they are seen empty
    expect(claimsSent(p)).toEqual([]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(31 + P.claimGap).toBe(ME);        // the boundary case: equal is not enough

    // With claimGap = 1 the same slot 31 is claimed: the gap was the only thing in the way.
    const p1 = makeParams(N, { claimGap: 1 });
    const q = play({ ...stage, params: p1 }, 400);
    expect(claimsSent(q)[0]).toMatchObject({ slot: 31, rank: ME });
    expect(slotChanges(q, ME)).toEqual([{ tick: claimsSent(q)[0].tick + p1.claimWindow, from: ME, to: 31 }]);

    // And a drone never claims a less important slot: drone 0 beside the empty slots 33 and 31.
    const r = play({ id: NEAR, ...dies([ME, 31], KILL) }, 800);
    expect(r.state.emptySince[ME]).toBe(scanAtOrAfter(KILL, NEAR));
    expect(claimsSent(r)).toEqual([]);
    expect(slotChanges(r, NEAR)).toEqual([]);
  });

  it('of several vacant slots it claims the most important one', () => {
    const p = play(dies([NEAR, NEAR2, 10, 31], KILL), COMMIT);
    expect(new Set(claimsSent(p).map(c => c.slot))).toEqual(new Set([NEAR]));
    expect(slotChanges(p, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }]);
  });

  it('drops the claim when a heartbeat holding the slot is heard, and when the slot is sensed occupied again', () => {
    // Somebody else (drone 5) reports that it holds slot 0, six ticks into the window.
    const holder: Heartbeat = { ...baseHeartbeat(5, CLAIM + 5, SCORE, P), seq: 9000, slot: NEAR, heldSince: CLAIM + 5 };
    const heard = reference(COMMIT + 100, { extra: tick => (tick === CLAIM + 6 ? [holder] : []) });
    const reclaim = scanAtOrAfter(CLAIM + 6 + P.tSuspect);
    expect(claimsSent(heard).map(c => c.tick).filter(tick => tick < reclaim)).toEqual([258, 263]);
    expect(frameAt(heard, 263).belief.claiming).toBe(NEAR);
    expect(frameAt(heard, 268).belief.claiming).toBeNull();
    expect(frameAt(heard, 268).belief.log).toEqual(['t=258 claim slot 0 (bid 33)', 't=268 drop claim on slot 0: no longer vacant']);
    // One report, then silence again: the slot is vacant again tSuspect later, and only then re-claimed.
    expect(claimsSent(heard).find(c => c.tick >= reclaim)).toEqual({ tick: reclaim, slot: NEAR, rank: ME });
    expect(slotChanges(heard, ME)).toEqual([{ tick: reclaim + P.claimWindow, from: ME, to: NEAR }]);

    // The drone reappears on slot 0 (still silent) at tick 265.
    const seen = play({ sensed: (j, tick) => !(j === NEAR && tick >= KILL && tick < 265), heartbeat: dies([NEAR], KILL).heartbeat }, COMMIT + 100);
    expect(claimsSent(seen).map(c => c.tick)).toEqual([258, 263]);
    expect(frameAt(seen, 268).belief.log).toEqual(['t=258 claim slot 0 (bid 33)', 't=268 drop claim on slot 0: no longer vacant']);
    expect(frameAt(seen, 268).state.emptySince[NEAR]).toBeNull();
    expect(slotChanges(seen, ME)).toEqual([]);
  });
});

describe('encoreBrain: contention (section 8.3: a bid is (rank, -id))', () => {
  /** Drone `j` claims slot 0 in every heartbeat it sends from tick `from` on, with the given fields. */
  const rival = (j: number, from: number, patch: Partial<Heartbeat>): Stage['heartbeat'] =>
    (id, sent, base) => (id === NEAR && sent >= KILL ? null : id === j && sent >= from ? { ...base, ...patch } : base);

  it('drops its claim on hearing a better bid, and does not claim that slot again while the bid is repeated', () => {
    // Drone 34 holds slot 34: a less important slot than mine, so a better bid.
    const p = reference(COMMIT + 200, { heartbeat: rival(34, CLAIM, { claim: { slot: NEAR, rank: 34 } }) });
    const heard = scanAtOrAfter(CLAIM, 34) + 1;                   // 260
    expect(heard).toBeGreaterThan(CLAIM);
    expect(heard).toBeLessThan(COMMIT);
    expect(frameAt(p, heard - 1).belief.claiming).toBe(NEAR);
    expect(frameAt(p, heard).belief.claiming).toBeNull();        // dropped on receipt, not at the next scan
    expect(claimsSent(p).map(c => c.tick)).toEqual([258]);
    expect(slotChanges(p, ME)).toEqual([]);
    expect(p.state.log).toEqual(['t=258 claim slot 0 (bid 33)', 't=260 drop claim on slot 0: better bid from 34']);
    expect(p.state.emptySince[NEAR]).toBe(EMPTY_FROM);            // the slot still looks vacant to it
  });

  it('with the better bidder claiming the best slot, it claims the next vacant one instead', () => {
    const p = play({ ...dies([NEAR, NEAR2], KILL), heartbeat: (id, sent, base) =>
      ((id === NEAR || id === NEAR2) && sent >= KILL ? null : id === 34 && sent >= CLAIM ? { ...base, claim: { slot: NEAR, rank: 34 } } : base) }, COMMIT + 30);
    expect(claimsSent(p)).toEqual([
      { tick: 258, slot: NEAR, rank: ME },
      { tick: 263, slot: NEAR2, rank: ME }, { tick: 268, slot: NEAR2, rank: ME },
      { tick: 273, slot: NEAR2, rank: ME }, { tick: 278, slot: NEAR2, rank: ME },
    ]);
    expect(slotChanges(p, ME)).toEqual([{ tick: 283, from: ME, to: NEAR2 }]);
  });

  it('keeps its claim on hearing a worse bid, and commits', () => {
    // Drone 32 holds slot 32: more important than mine, so a worse bid.
    const p = reference(COMMIT + 5, { heartbeat: rival(32, CLAIM, { claim: { slot: NEAR, rank: 32 } }) });
    expect(frameAt(p, COMMIT - 1).state.peers[32]?.claim).toEqual({ slot: NEAR, rank: 32 });   // it did hear the bid
    expect(claimsSent(p).map(c => c.tick)).toEqual([258, 263, 268, 273]);
    expect(slotChanges(p, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }]);
  });

  it('a better bid for ANOTHER slot changes nothing', () => {
    const p = reference(COMMIT + 5, { heartbeat: rival(34, CLAIM, { claim: { slot: NEAR2, rank: 34 } }) });
    expect(slotChanges(p, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }]);
  });

  it('on equal rank the lower id wins', () => {
    // Two later holders of my own slot 33 (they do not make me pop: I hold it since tick 0) claim slot 0 with rank 33.
    const dup = { slot: ME, heldSince: 50, claim: { slot: NEAR, rank: ME } };
    const lower = reference(COMMIT + 5, { heartbeat: rival(20, CLAIM, dup) });
    expect(slotChanges(lower, ME)).toEqual([]);
    expect(lower.state.log[1]).toBe(`t=${scanAtOrAfter(CLAIM, 20) + 1} drop claim on slot 0: better bid from 20`);
    const higher = reference(COMMIT + 5, { heartbeat: rival(39, CLAIM, dup) });
    expect(slotChanges(higher, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }]);
  });

  it('a better bid heard before its own claim holds it back, but only while it was heard within claimWindow', () => {
    // Drone 34 announces a claim on slot 0 in a single heartbeat, sent at the scan before mine.
    const once = scanAtOrAfter(CLAIM - P.hbPeriod, 34);          // 254, heard at 255
    const p = reference(COMMIT + 60, {
      heartbeat: (id, sent, base) => (id === NEAR && sent >= KILL ? null : id === 34 && sent === once ? { ...base, claim: { slot: NEAR, rank: 34 } } : base),
    });
    // Drone 34's next heartbeat (heard at 260) carries no claim, so the peer entry no longer claims.
    expect(claimsSent(p)[0].tick).toBe(scanAtOrAfter(once + 1 + P.hbPeriod));
    expect(claimsSent(p)[0].tick).toBeGreaterThan(CLAIM);

    // If drone 34 falls silent right after that one bid, the bid counts for claimWindow ticks after it was heard.
    const q = reference(COMMIT + 60, {
      heartbeat: (id, sent, base) =>
        (id === NEAR && sent >= KILL ? null : id === 34 ? (sent < once ? base : sent === once ? { ...base, claim: { slot: NEAR, rank: 34 } } : null) : base),
    });
    expect(claimsSent(q)[0].tick).toBe(scanAtOrAfter(once + 1 + P.claimWindow + 1));
    expect(q.frames.filter(f => f.tick <= once + 1 + P.claimWindow).every(f => f.belief.claiming === null)).toBe(true);
  });
});

describe('encoreBrain: duplicates (section 8.3, step 1)', () => {
  /** A heartbeat from drone `from` saying it holds `slot` since `heldSince`, delivered at `tick`. */
  const holderHb = (from: number, tick: number, slot: number, heldSince: number): Heartbeat =>
    ({ ...baseHeartbeat(from, tick - 1, SCORE, P), seq: 9000 + tick, slot, heldSince });
  const T = COMMIT + 12;       // a tick after the commit, not a scan tick

  it('hearing an EARLIER holder of my slot pops my history and restores the ORIGINAL heldSince', () => {
    const p = reference(T + 10, { extra: tick => (tick === T ? [holderHb(5, T, NEAR, 150)] : []) });
    expect(frameAt(p, T - 1).state).toMatchObject({ slot: NEAR, heldSince: COMMIT, history: [{ slot: ME, heldSince: 0 }] });
    expect(frameAt(p, T).state).toMatchObject({
      slot: ME, heldSince: 0, history: [], claim: null, lastTargetChange: T, yieldSince: null,
    });
    expect(frameAt(p, T).belief).toMatchObject({ slot: ME, heldSince: 0, target: slotPos(ME, T) });
    expect(frameAt(p, T).belief.log.at(-1)).toBe(`t=${T} back to slot 33 (was 0): lost duplicate to 5`);
    expect(slotChanges(p, ME)).toEqual([{ tick: COMMIT, from: ME, to: NEAR }, { tick: T, from: NEAR, to: ME }]);
    // The next heartbeat announces the launch slot again, held since tick 0.
    expect(frameAt(p, scanAtOrAfter(T)).hb).toMatchObject({ slot: ME, heldSince: 0 });
    // From the pop tick on it steers back to slot 33.
    const f = frameAt(p, T);
    expect(f.out.accel).toEqual(steer(f.input.pos, f.input.vel, steerTarget(ME, f.input.pos, slotPos(ME, T), P), f.input.sensed, P));
  });

  it('a LATER holder of my slot does not move me', () => {
    const p = reference(T + 10, { extra: tick => (tick === T ? [holderHb(5, T, NEAR, COMMIT + 1)] : []) });
    expect(p.state).toMatchObject({ slot: NEAR, heldSince: COMMIT, history: [{ slot: ME, heldSince: 0 }] });
    expect(p.state.log).toHaveLength(2);
  });

  it('same heldSince: the lower id keeps the slot', () => {
    const lower = reference(T + 10, { extra: tick => (tick === T ? [holderHb(5, T, NEAR, COMMIT)] : []) });
    expect(lower.state).toMatchObject({ slot: ME, heldSince: 0 });
    const higher = reference(T + 10, { extra: tick => (tick === T ? [holderHb(39, T, NEAR, COMMIT)] : []) });
    expect(higher.state).toMatchObject({ slot: NEAR, heldSince: COMMIT });
  });

  it('a holder of another slot changes nothing', () => {
    const p = reference(T + 10, { extra: tick => (tick === T ? [holderHb(5, T, NEAR2, 1)] : []) });
    expect(p.state).toMatchObject({ slot: NEAR, heldSince: COMMIT });
  });

  it('a drone with an empty history is on its launch home: it keeps its slot, and logs that', () => {
    // A fresh drone on its launch slot hears drone 5 say it holds slot 33 since tick 0 (and 5 < 33).
    const p = play({ extra: tick => (tick === 50 ? [holderHb(5, 50, ME, 0)] : []) }, 60);
    expect(p.state).toMatchObject({ slot: ME, heldSince: 0, history: [], lastTargetChange: 0, settledSince: 1 });
    expect(p.state.log).toEqual(['t=50 keep slot 33, my launch home: lost duplicate to 5']);
    expect(slotChanges(p, ME)).toEqual([]);
  });

  it('T19: an earlier holder on a DIFFERENT score version makes me pop too; slot ownership is by index', () => {
    const other = { issuedTick: 77, origin: 2 };
    const p = reference(T + 10, { extra: tick => (tick === T ? [{ ...holderHb(5, T, NEAR, 150), version: other }] : []) });
    expect(frameAt(p, T - 1).state).toMatchObject({ slot: NEAR, heldSince: COMMIT });
    expect(frameAt(p, T).state).toMatchObject({ slot: ME, heldSince: 0, history: [] });
    expect(frameAt(p, T).state.peers[5]?.version).toEqual(other);
    expect(frameAt(p, T).belief.version).toEqual({ issuedTick: 0, origin: OPERATOR });      // I still fly my own score
    expect(frameAt(p, T).belief.log.at(-1)).toBe(`t=${T} back to slot 33 (was 0): lost duplicate to 5`);
    // A later holder on another version does not move me, exactly as on my own version.
    const later = reference(T + 10, { extra: tick => (tick === T ? [{ ...holderHb(5, T, NEAR, COMMIT + 1), version: other }] : []) });
    expect(later.state).toMatchObject({ slot: NEAR, heldSince: COMMIT });
  });

  it('slotHeard and the bid rule ignore the score version as well', () => {
    const other = { issuedTick: 77, origin: 2 };
    // Drone 1 is out of radio range, so slot 1 is never heard. A heartbeat holding slot 1 on another
    // version counts as "slot 1 heard".
    expect(dist(slotPos(1, 1), slotPos(ME, 1))).toBeGreaterThan(P.rRadio);
    expect(play({}, 150).state.slotHeard[1]).toBe(0);
    const heard = play({ extra: tick => (tick === 150 ? [{ ...holderHb(5, 150, 1, 0), version: other }] : []) }, 150);
    expect(heard.state.slotHeard[1]).toBe(150);
    // A better bid on another version makes me drop my claim on receipt (tick 260 is not one of my scan ticks).
    const p = reference(COMMIT + 5, {
      heartbeat: (id, sent, base) =>
        (id === NEAR && sent >= KILL ? null : id === 34 && sent === scanAtOrAfter(CLAIM, 34) ? { ...base, version: other, claim: { slot: NEAR, rank: 34 } } : base),
    });
    expect(frameAt(p, 259).belief.claiming).toBe(NEAR);
    expect(frameAt(p, 260).belief.claiming).toBeNull();
    expect(frameAt(p, 260).belief.log.at(-1)).toBe('t=260 drop claim on slot 0: better bid from 34');
  });

  it('pops one entry per lost duplicate, each with its own original heldSince', () => {
    // White box: a drone that has committed twice (33 -> 20 at tick 500 -> 6 at tick 900).
    const s = newState();
    s.slot = 6;
    s.heldSince = 900;
    s.history = [{ slot: ME, heldSince: 0 }, { slot: 20, heldSince: 500 }];
    const stage = (hb: Heartbeat): Stage => ({ heartbeat: () => null, extra: () => [hb] });
    encoreBrain.step(s, inputAt(stage(holderHb(5, 1001, 6, 700)), 1001));
    expect(s).toMatchObject({ slot: 20, heldSince: 500, history: [{ slot: ME, heldSince: 0 }], lastTargetChange: 1001 });
    // Drone 20 has held slot 20 since tick 0: earlier than my 500.
    encoreBrain.step(s, inputAt(stage(holderHb(20, 1002, 20, 0)), 1002));
    expect(s).toMatchObject({ slot: ME, heldSince: 0, history: [], lastTargetChange: 1002 });
    // Home: nothing left to pop.
    encoreBrain.step(s, inputAt(stage(holderHb(5, 1003, ME, 0)), 1003));
    expect(s).toMatchObject({ slot: ME, heldSince: 0, history: [] });
    expect(s.log).toEqual([
      't=1001 back to slot 20 (was 6): lost duplicate to 5',
      't=1002 back to slot 33 (was 20): lost duplicate to 20',
      't=1003 keep slot 33, my launch home: lost duplicate to 5',
    ]);
  });

  it('losing a duplicate drops a claim in progress', () => {
    // White box: the drone holds slot 31 since tick 150 (history: home) and is claiming slot 0.
    const held = 31;
    expect(dist(slotPos(NEAR, 1), slotPos(held, 1))).toBeLessThanOrEqual(P.rClaim);
    const start = newState();
    start.slot = held;
    start.heldSince = 150;
    start.history = [{ slot: ME, heldSince: 0 }];
    // Drone 31 itself is not there (never sensed, never heard); drone 0 dies at tick 200.
    const stage: Stage = {
      pos: tick => slotPos(held, tick),
      sensed: (j, tick) => j !== held && !(j === NEAR && tick >= KILL),
      heartbeat: (j, sent, base) => (j === held || (j === NEAR && sent >= KILL) ? null : base),
      extra: tick => (tick === 270 ? [holderHb(5, 270, held, 10)] : []),
    };
    const p = play(stage, 300, { state: start, from: 1 });
    const claims = claimsSent(p);
    expect(claims).toEqual([258, 263, 268].map(tick => ({ tick, slot: NEAR, rank: held })));
    expect(frameAt(p, 269).belief.claiming).not.toBeNull();
    expect(frameAt(p, 270).state).toMatchObject({ slot: ME, heldSince: 0, claim: null, history: [] });
  });
});

describe('encoreBrain: physical yield (section 8.3, step 3)', () => {
  const BACK = 300;   // the silent drone 0 is sensed on slot 0 again from this tick
  const returns = (from: number, to = Infinity): Stage =>
    ({ sensed: (j, tick) => !(j === NEAR && tick >= KILL && !(tick >= from && tick < to)), heartbeat: dies([NEAR], KILL).heartbeat });

  it('pops after it has seen its slot occupied for yieldTicks, with no radio message involved', () => {
    const p = play(returns(BACK), BACK + 40);
    expect(frameAt(p, BACK - 1).state).toMatchObject({ slot: NEAR, yieldSince: null });
    expect(frameAt(p, BACK).state.yieldSince).toBe(BACK);
    expect(frameAt(p, BACK + P.yieldTicks - 1).state).toMatchObject({ slot: NEAR, heldSince: COMMIT, yieldSince: BACK });
    expect(frameAt(p, BACK + P.yieldTicks).state).toMatchObject({
      slot: ME, heldSince: 0, history: [], yieldSince: null, lastTargetChange: BACK + P.yieldTicks,
    });
    expect(slotChanges(p, ME)).toEqual([
      { tick: COMMIT, from: ME, to: NEAR }, { tick: BACK + P.yieldTicks, from: NEAR, to: ME },
    ]);
    expect(p.state.log.at(-1)).toBe(`t=${BACK + P.yieldTicks} back to slot 33 (was 0): slot already occupied`);
    // No heartbeat about slot 0 was ever heard after the kill.
    expect(p.state.slotHeard[NEAR]).toBe(LAST_HEARD);
  });

  it('only after yieldTicks in a row: a gap restarts the count', () => {
    // Seen for 19 ticks, gone for one, then seen again.
    const p = play({
      sensed: (j, tick) => !(j === NEAR && tick >= KILL && !(tick >= BACK && tick !== BACK + 19)),
      heartbeat: dies([NEAR], KILL).heartbeat,
    }, BACK + 60);
    expect(frameAt(p, BACK + 18).state.yieldSince).toBe(BACK);
    expect(frameAt(p, BACK + 19).state.yieldSince).toBeNull();
    expect(frameAt(p, BACK + 20).state).toMatchObject({ slot: NEAR, yieldSince: BACK + 20 });
    expect(slotChanges(p, ME).at(-1)).toEqual({ tick: BACK + 20 + P.yieldTicks, from: NEAR, to: ME });
    // Seen for only 19 ticks in all: no pop.
    const brief = play(returns(BACK, BACK + 19), BACK + 100);
    expect(brief.state).toMatchObject({ slot: NEAR, heldSince: COMMIT, yieldSince: null });
  });

  it('only in hold: a drone sitting on its slot during a transition is not a holder', () => {
    // The commit to slot 0 happens at 278. A new movement starts at 300 with a 200-tick transition.
    const score: Score = {
      version: { issuedTick: 0, origin: OPERATOR },
      movements: [{ startTick: 0, transitionTicks: HOLD_START, recipe: TEXT }, { startTick: 300, transitionTicks: 200, recipe: SPHERE }],
    };
    const p = play({ score, ...returns(300) }, 540);
    expect(frameAt(p, 299).state.slot).toBe(NEAR);
    // Throughout the transition the drone senses somebody within rOcc of its target, and does nothing.
    for (let tick = 300; tick < 500; tick++) {
      const f = frameAt(p, tick);
      const target = slotPos(NEAR, tick, score);
      expect(f.input.sensed.some(n => dist(add(f.input.pos, n.rel), target) < P.rOcc), `tick ${tick}`).toBe(true);
      expect(f.state.yieldSince, `tick ${tick}`).toBeNull();
      expect(f.state.slot, `tick ${tick}`).toBe(NEAR);
    }
    // The hold starts at 500: the count starts there.
    expect(frameAt(p, 500).state.yieldSince).toBe(500);
    expect(frameAt(p, 500 + P.yieldTicks - 1).state.slot).toBe(NEAR);
    expect(frameAt(p, 500 + P.yieldTicks).state).toMatchObject({ slot: ME, heldSince: 0, history: [] });
  });

  it('only with a non-empty history: a drone on its launch slot never yields', () => {
    // A fresh drone is 2 m off its launch slot for the whole hold, and an anonymous drone sits on that slot.
    const pos = (tick: number): Vec3 => add(slotPos(ME, tick), [0, 2, 0]);
    const state = newState();
    for (let tick = 1; tick <= 500; tick++) {
      const input = jsonCopy(inputAt({ pos }, tick)) as AgentInput & { sensed: Sensed[] };
      input.sensed.push({ rel: sub(slotPos(ME, tick), input.pos), vel: [0, 0, 0] });
      encoreBrain.step(state, deepFreeze(input));
      expect(state.yieldSince).toBeNull();
    }
    expect(state).toMatchObject({ slot: ME, heldSince: 0, history: [], log: [] });
  });

  it('only while it is farther than rOcc from its slot: two drones crowding one slot are not resolved by the yield', () => {
    // White box: after the commit the body is moved onto slot 0, where the silent drone 0 also sits.
    const onSlot = play({ ...returns(BACK), pos: tick => (tick >= BACK ? add(slotPos(NEAR, tick), [0.3, 0, 0]) : slotPos(ME, tick)) }, BACK + 100);
    expect(onSlot.state).toMatchObject({ slot: NEAR, heldSince: COMMIT, yieldSince: null });
  });
});

describe('encoreBrain: SCORE messages are ignored until issue #21 (stub)', () => {
  const NEXT = composeNext(SCORE, 150, SPHERE, 5, N, P);
  const scoreMsg = (from: number, tick: number): ScoreMsg => ({ type: 'SCORE', from, seq: 7000 + tick, sentTick: tick - 1, score: jsonCopy(NEXT) });

  it('the injected score really is newer and would change the target', () => {
    expect(newerVersion(NEXT.version, SCORE.version)).toBe(true);
    expect(NEXT.movements[1].startTick).toBe(150 + P.scoreLead);
    expect(dist(slotPos(ME, 400, NEXT), slotPos(ME, 400))).toBeGreaterThan(P.rOcc);
  });

  it('a SCORE from the operator has no effect at all', () => {
    const quiet = reference(COMMIT + 20);
    const injected = reference(COMMIT + 20, { extra: tick => (tick === 150 || tick === 260 ? [scoreMsg(OPERATOR, tick)] : []) });
    expect(frameAt(injected, 150).input.inbox.some(m => m.type === 'SCORE')).toBe(true);
    for (const f of injected.frames) {
      const q = frameAt(quiet, f.tick);
      expect(f.out, `tick ${f.tick}`).toStrictEqual(q.out);
      expect(f.state, `tick ${f.tick}`).toStrictEqual(q.state);
      expect(f.belief, `tick ${f.tick}`).toStrictEqual(q.belief);
    }
    expect(injected.state.score).toEqual(SCORE);
    expect(injected.frames.every(f => f.out.outbox.every(m => m.type === 'HB'))).toBe(true);
  });

  it('a SCORE from another drone only counts as a radio message heard (lastRx)', () => {
    const quiet = reference(COMMIT + 20);
    const gossip = reference(COMMIT + 20, { extra: tick => (tick % 7 === 0 ? [scoreMsg(5, tick)] : []) });
    for (const f of gossip.frames) {
      const q = frameAt(quiet, f.tick);
      expect(f.out, `tick ${f.tick}`).toStrictEqual(q.out);
      expect({ ...f.state, lastRx: 0 }, `tick ${f.tick}`).toStrictEqual({ ...q.state, lastRx: 0 });
      expect(f.belief.version).toEqual({ issuedTick: 0, origin: OPERATOR });
      if (f.tick % 7 === 0) expect(f.state.lastRx).toBe(f.tick);
    }
    expect(gossip.state).toMatchObject({ scoreSendAt: null, lastScoreSent: -P.scoreResendMin, mvIndex: 0 });
    expect(gossip.state.rng).toBe(quiet.state.rng);
    // Alone, with no heartbeat ever heard, such a message is what keeps the drone from being deaf.
    const alone = play({ heartbeat: () => null, extra: tick => (tick === 30 ? [scoreMsg(5, tick)] : []) }, 30 + P.tDeaf + 1);
    expect(frameAt(alone, 29).belief.deaf).toBe(true);
    expect(frameAt(alone, 30).belief.deaf).toBe(false);
    expect(frameAt(alone, 30 + P.tDeaf).belief.deaf).toBe(false);
    expect(frameAt(alone, 30 + P.tDeaf + 1).belief.deaf).toBe(true);
  });
});

describe('encoreBrain: bounded state, plain JSON, determinism', () => {
  /** A script with a claim, a commit, a lost duplicate, a second claim and commit, and a physical yield. */
  const busy: Stage = {
    sensed: (j, tick) => !(j === NEAR && tick >= KILL && tick < 520),
    heartbeat: dies([NEAR], KILL).heartbeat,
    extra: tick => (tick === 290 ? [{ ...baseHeartbeat(5, 289, SCORE, P), seq: 9999, slot: NEAR, heldSince: 150 }] : []),
  };

  it('the busy script does what its name says', () => {
    const p = play(busy, 600);
    const changes = slotChanges(p, ME);
    expect(changes.map(c => [c.from, c.to])).toEqual([[ME, NEAR], [NEAR, ME], [ME, NEAR], [NEAR, ME]]);
    expect(changes[0].tick).toBe(COMMIT);
    expect(changes[1].tick).toBe(290);
    expect(changes[3].tick).toBe(520 + P.yieldTicks);
    expect(p.state.log.filter(l => l.includes('commit'))).toHaveLength(2);
    expect(p.state.log.at(-1)).toContain('slot already occupied');
  });

  it('the state round-trips through JSON at every tick, and the brain behaves identically afterwards', () => {
    const plain = play(busy, 600);
    const tripped = play({ ...busy, roundTrip: true }, 600);
    for (const f of plain.frames) {
      const g = frameAt(tripped, f.tick);
      expect(g.out, `tick ${f.tick}`).toStrictEqual(f.out);
      expect(g.belief, `tick ${f.tick}`).toStrictEqual(f.belief);
      expect(g.state, `tick ${f.tick}`).toStrictEqual(f.state);
    }
    expect(JSON.parse(JSON.stringify(plain.state))).toStrictEqual(plain.state);
    // Plain JSON all the way down: only null, booleans, finite numbers, strings, arrays and plain objects.
    const problems: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
      if (typeof value === 'number') { if (!Number.isFinite(value)) problems.push(path); return; }
      if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
        return;
      }
      problems.push(path);
    };
    for (const f of plain.frames) walk(f.state, `t${f.tick}`);
    expect(problems.slice(0, 5)).toEqual([]);
    // Arrays stay indexed by id and by slot.
    expect([plain.state.peers.length, plain.state.slotHeard.length, plain.state.emptySince.length]).toEqual([N, N, N]);
  });

  it('two identical runs give identical outputs, beliefs and states', () => {
    const a = play(busy, 600);
    const b = play(busy, 600);
    expect(JSON.stringify(b.frames.map(f => [f.out, f.belief, f.state]))).toBe(JSON.stringify(a.frames.map(f => [f.out, f.belief, f.state])));
    // The comparison can fail: another seed gives another rng field, and nothing else.
    const other = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: SCORE, params: P, seed: 5 });
    const c = play(busy, 600, { state: other, from: 1 });
    expect(c.state.rng).not.toBe(a.state.rng);
    expect({ ...c.state, rng: 0 }).toStrictEqual({ ...a.state, rng: 0 });
  });

  it('does not change or keep its input', () => {
    const p = play(busy, 300);                 // every input was deep-frozen: an edit would have thrown
    const input = jsonCopy(frameAt(p, 300).input);
    const state = jsonCopy(p.state);
    const before = jsonCopy(input);
    encoreBrain.step(state, input);
    expect(input).toStrictEqual(before);
    const after = jsonCopy(state);
    (input.pos as Vec3)[0] = 1e6;
    (input.inbox as Message[]).length = 0;
    (input.sensed as Sensed[]).length = 0;
    expect(state).toStrictEqual(after);
  });

  it('the log keeps the last 20 decisions', () => {
    // A drone on its launch home that keeps hearing an earlier holder of its slot logs it each time.
    const dupHb = (tick: number): Heartbeat => ({ ...baseHeartbeat(5, tick - 1, SCORE, P), seq: 9000 + tick, slot: ME, heldSince: 0 });
    const p = play({ extra: tick => [dupHb(tick)] }, 50);
    expect(p.state.log).toHaveLength(20);
    expect(encoreBrain.belief(p.state).log).toHaveLength(20);
    expect(p.state.log[0]).toMatch(/^t=31 keep slot 33/);
    expect(p.state.log[19]).toMatch(/^t=50 keep slot 33/);
    expect(p.state.slot).toBe(ME);
  });

  it('the history cap removes history[1], never history[0], the launch home', () => {
    // White box: the history is already full when the drone commits in the reference scenario.
    const full = [39, 38, 37, 36, 35, 34, 32, 31].map((slot, k) => ({ slot, heldSince: 10 * k }));
    expect(full).toHaveLength(P.historyMax);
    const start = newState();
    start.history = jsonCopy(full);
    start.heldSince = 80;
    const p = play(dies([NEAR], KILL), COMMIT, { state: start, from: 1 });
    expect(p.state.slot).toBe(NEAR);
    expect(p.state.history).toEqual([full[0], ...full.slice(2), { slot: ME, heldSince: 80 }]);
    expect(p.state.history).toHaveLength(P.historyMax);

    // historyMax = 1: only the home is remembered.
    const one = makeParams(N, { historyMax: 1 });
    const first = play({ ...dies([NEAR], KILL), params: one }, COMMIT);
    expect(first.state.history).toEqual([{ slot: ME, heldSince: 0 }]);
    const again = newState({ params: one });
    again.slot = 31;
    again.heldSince = 150;
    again.history = [{ slot: ME, heldSince: 0 }];
    const second = play({
      params: one, pos: tick => slotPos(31, tick),
      sensed: (j, tick) => j !== 31 && !(j === NEAR && tick >= KILL),
      heartbeat: (j, sent, base) => (j === 31 || (j === NEAR && sent >= KILL) ? null : base),
    }, COMMIT, { state: again, from: 1 });
    expect(second.state).toMatchObject({ slot: NEAR, history: [{ slot: ME, heldSince: 0 }] });
  });

  it('T19: more than historyMax commits followed by repeated pops end on the launch slot with heldSince 0', () => {
    // Sensing wide enough that the next slot is always within rClaim. The body is scripted onto whatever
    // slot the drone believes. Victim k is there until the drone has committed k times, then dies:
    // the drone walks 33 -> 30 -> 27 -> ... -> 3, ten commits with historyMax = 8.
    const params = makeParams(N, { rSense: 60, rClaim: 50 });
    const victims = [30, 27, 24, 21, 18, 15, 12, 9, 6, 3];
    expect(victims.length).toBeGreaterThan(params.historyMax);
    const deadFrom = victims.map((_, i) => (i === 0 ? KILL : Infinity));
    const state = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: SCORE, params, seed: 1 });
    const gone = (j: number, tick: number): boolean => victims.includes(j) && tick >= deadFrom[victims.indexOf(j)];
    const stage: Stage = {
      params,
      pos: tick => slotPos(state.slot, tick, SCORE, params),
      sensed: (j, tick) => !gone(j, tick),
      heartbeat: (j, sent, base) => (gone(j, sent) ? null : base),
    };
    const made: { slot: number; heldSince: number }[] = [];
    let tick = 0;
    while (made.length < victims.length && tick < 4000) {
      tick++;
      const before = state.slot;
      encoreBrain.step(state, inputAt(stage, tick));
      if (state.slot !== before) {
        expect(state.heldSince).toBe(tick);
        made.push({ slot: state.slot, heldSince: tick });
        if (made.length < victims.length) deadFrom[made.length] = tick + 1;
      }
    }
    expect(made.map(c => c.slot)).toEqual(victims);
    // The cap dropped slots 30 and 27, in that order; the home and the six newest older slots remain.
    expect(state.history).toEqual([{ slot: ME, heldSince: 0 }, ...made.slice(2, 9)]);
    expect(state.history).toHaveLength(params.historyMax);

    // Now the original holder of each slot the drone sits on "comes back" (heard, held since tick 0),
    // alternately on the drone's own score version and on another one.
    const visited: { slot: number; heldSince: number }[] = [];
    for (let k = 0; k < params.historyMax; k++) {
      tick++;
      const holder: Heartbeat = {
        ...baseHeartbeat(state.slot, tick - 1, SCORE, params), seq: 9000 + k, heldSince: 0,
        version: k % 2 === 0 ? { ...SCORE.version } : { issuedTick: 77, origin: 2 },
      };
      encoreBrain.step(state, inputAt({ ...stage, heartbeat: () => null, extra: () => [holder] }, tick));
      visited.push({ slot: state.slot, heldSince: state.heldSince });
    }
    // Each pop restored the original heldSince; slots 27 and 30 are skipped; the last pop lands on the home.
    expect(visited).toEqual([...made.slice(2, 9).reverse(), { slot: ME, heldSince: 0 }]);
    expect(state).toMatchObject({ slot: ME, heldSince: 0, history: [], claim: null });
    // One more "earlier holder" changes nothing: nobody can outrank the launch home.
    tick++;
    const intruder: Heartbeat = { ...baseHeartbeat(5, tick - 1, SCORE, params), seq: 9999, slot: ME, heldSince: 0 };
    encoreBrain.step(state, inputAt({ ...stage, heartbeat: () => null, extra: () => [intruder] }, tick));
    expect(state).toMatchObject({ slot: ME, heldSince: 0, history: [] });
    expect(state.log.at(-1)).toBe(`t=${tick} keep slot 33, my launch home: lost duplicate to 5`);
  });

  it('a heartbeat naming no drone or no slot of the roster is ignored and leaves the arrays intact', () => {
    const bad = (tick: number): Message[] => [
      { ...baseHeartbeat(5, tick - 1, SCORE, P), from: N + 3, seq: 1 },
      { ...baseHeartbeat(5, tick - 1, SCORE, P), slot: -1, seq: 2 },
      { ...baseHeartbeat(5, tick - 1, SCORE, P), slot: 2.5, seq: 3 },
    ];
    const quiet = play({}, 200);
    const noisy = play({ extra: bad }, 200);
    expect(noisy.state).toStrictEqual(quiet.state);
    expect(Object.keys(noisy.state.peers)).toHaveLength(N);
    expect(Object.keys(noisy.state.slotHeard)).toHaveLength(N);
  });
});
