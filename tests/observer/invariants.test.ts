// P2-T01: each INV-* holds on one synthetic history and fires on another at the expected tick, ids and slot.
// Also: tick rules, unavailable and derived modes, multi-partition suppression, and that ingest never mutates.
import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import type { DroneSnap, EnvEvent, Params, RadioEvent, Score, ScoreVersion, Vec3, WorldSnapshot } from '../../src/contracts';
import { expandRecipe, launchPos } from '../../src/score';
import { createInvariantChecker, INVARIANT_DEFAULTS, KNOWN_LIMIT_3, KNOWN_LIMIT_FLAPPING, type InvariantCheckerOptions, type InvariantId } from '../../src/observer/invariants';

const V0: ScoreVersion = { issuedTick: 0, origin: OPERATOR };
const V1: ScoreVersion = { issuedTick: 10, origin: 0 };
const SCORE: Score = { version: V0, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const SCORE_V1: Score = { version: V1, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };

interface Spec { slot?: number; heldSince?: number; version?: ScoreVersion; pos?: Vec3; alive?: boolean; side?: 0 | 1 | null }

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A frozen snapshot of n0 drones; drone k defaults to slot k, launch position, version V0, alive. */
function snap(tick: number, n0: number, specs: Record<number, Spec> = {}, extra: Partial<WorldSnapshot> = {}): WorldSnapshot {
  const drones: DroneSnap[] = [];
  for (let id = 0; id < n0; id++) {
    const s = specs[id] ?? {};
    drones.push({
      id, alive: s.alive ?? true, diedTick: s.alive === false ? 1 : null,
      pos: s.pos ?? launchPos(id, n0), vel: [0, 0, 0], colour: [1, 1, 1], partitionSide: s.side ?? null,
      belief: {
        slot: s.slot ?? id, heldSince: s.heldSince ?? 0, target: [0, 0, 0], version: s.version ?? V0,
        deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [],
      },
    });
  }
  return deepFreeze({ tick, drones, radio: [], jams: [], partitions: [], collisions: [], nearMisses: [], ...extra });
}

function hb(tick: number, from: number, delivered: number[], lost = 0): RadioEvent {
  return { tick, from, type: 'HB', claimSlot: null, delivered, lost, jammed: 0, partitioned: 0 };
}

function checker(params: Params, checks: InvariantId[], arm: InvariantCheckerOptions['arm'] = 'encore', opts: Partial<InvariantCheckerOptions> = {}) {
  const c = createInvariantChecker({ params, arm, checks, ...opts });
  return c;
}

/** Feed ticks 1..last; `at(t)` builds the snapshot of tick t. Returns every violation. */
function feed(c: ReturnType<typeof checker>, last: number, at: (t: number) => WorldSnapshot) {
  const out = [];
  for (let t = 1; t <= last; t++) out.push(...c.ingest(at(t)));
  return out;
}

describe('P2-T01: INV-DUP', () => {
  const params = makeParams(12);   // latencyMax 2
  it('fires at t + latencyMax + 1 when the later holder keeps the slot after a delivered heartbeat', () => {
    const c = checker(params, ['INV-DUP']);
    // Drone 9 shares slot 5 with drone 5 from tick 1; (heldSince, id): (0, 5) < (3, 9). HB from 5 delivered to 9 at tick 2.
    const v = feed(c, 6, (t) => snap(t, 12, { 9: { slot: 5, heldSince: 3 } }, { radio: t === 2 ? [hb(2, 5, [9])] : [] }));
    expect(v).toEqual([expect.objectContaining({ inv: 'INV-DUP', tick: 5, ids: [5, 9], slot: 5, knownLimit: null })]);
    expect(c.report().counts['INV-DUP']).toBe(1);
  });
  it('holds when the later holder pops in time', () => {
    const c = checker(params, ['INV-DUP']);
    const v = feed(c, 6, (t) => snap(t, 12, t <= 3 ? { 9: { slot: 5, heldSince: 3 } } : {}, { radio: t === 2 ? [hb(2, 5, [9])] : [] }));
    expect(v).toEqual([]);
    expect(c.report().holding).toEqual(['INV-DUP']);
  });
  it('does not flag a later holder that left the slot when the heartbeat arrived and returned to the same (slot, heldSince)', () => {
    const c = checker(params, ['INV-DUP']);
    // HB from 5 delivered to 9 at tick 2; 9 is on slot 2 at tick 3 (so it never compared the heartbeat) and is back on (5, 3) at 4.
    const v = feed(c, 6, (t) => snap(t, 12, { 9: t === 3 ? { slot: 2, heldSince: 3 } : { slot: 5, heldSince: 3 } }, { radio: t === 2 ? [hb(2, 5, [9])] : [] }));
    expect(v).toEqual([]);
  });
  it('does not flag a separated duplicate (no heartbeat delivered) or one whose every heartbeat is lost', () => {
    const c = checker(params, ['INV-DUP']);
    const v = feed(c, 20, (t) => snap(t, 12, { 9: { slot: 5, heldSince: 3 } }, { radio: t % 5 === 0 ? [hb(t, 5, [], 1)] : [] }));
    expect(v).toEqual([]);
  });
});

describe('P2-T01: INV-MONO', () => {
  const params = makeParams(12);   // claimGap 2, so a commit must drop by >= 3
  const path = (slots: Record<number, number>) => (t: number) => {
    let slot = 11;
    for (const [from, s] of Object.entries(slots)) if (t >= Number(from)) slot = s;
    return snap(t, 12, { 11: { slot } });
  };
  it('holds on commits by >= claimGap + 1 and on pops (also multi-pop) back down the observed stack', () => {
    const c = checker(params, ['INV-MONO']);
    expect(feed(c, 10, path({ 2: 7, 4: 3, 6: 11 }))).toEqual([]);   // 11 -> 7 -> 3, then one tick pops two levels to 11
  });
  it('fires on a commit by less than claimGap + 1', () => {
    const c = checker(params, ['INV-MONO']);
    expect(feed(c, 4, path({ 3: 10 }))).toEqual([expect.objectContaining({ inv: 'INV-MONO', tick: 3, ids: [11], slot: 10 })]);
  });
  it('rejects A->B, B->A, A->C, C->B (B left the stack when A was popped back)', () => {
    const c = checker(params, ['INV-MONO']);
    expect(feed(c, 10, path({ 2: 7, 4: 11, 6: 3, 8: 7 }))).toEqual([expect.objectContaining({ inv: 'INV-MONO', tick: 8, ids: [11], slot: 7 })]);
  });
});

describe('P2-T01: INV-SILENCE', () => {
  const params = makeParams(12);   // tVacant 40, claimWindow 20, tSuspect 60, hbPeriod 5
  const slots = expandRecipe(SCORE.movements[0].recipe, 12, params).slots.map((s) => s.pos);
  const FAR: Vec3 = [500, 500, 500];
  // Everyone sits on its slot; drone 11 commits 11 -> 3 at tick 100. `vacate` moves drone 3 away (still alive).
  const history = (vacate: boolean, extra: (t: number) => Partial<WorldSnapshot> = () => ({}), version?: (t: number) => Record<number, Spec>) => (t: number) => {
    const specs: Record<number, Spec> = {};
    for (let k = 0; k < 12; k++) specs[k] = { pos: slots[k] };
    if (vacate) specs[3] = { pos: FAR };
    specs[11] = { pos: slots[11], slot: t >= 100 ? 3 : 11, heldSince: t >= 100 ? 100 : 0 };
    Object.assign(specs, version?.(t) ?? {});
    return snap(t, 12, specs, extra(t));
  };
  function make() {
    const c = checker(params, ['INV-SILENCE']);
    c.registerScore(SCORE);
    c.registerScore(SCORE_V1);
    return c;
  }
  it('fires on a commit while a drone sat on the slot (no vacancy evidence)', () => {
    const c = make();
    expect(feed(c, 101, history(false))).toEqual([expect.objectContaining({ inv: 'INV-SILENCE', tick: 100, ids: [11], slot: 3, knownLimit: null })]);
  });
  it('excuses a commit on the brain\'s own evidence: slot sensed empty on every scan tick, no holder heartbeat delivered (limit 6)', () => {
    const c = make();
    expect(feed(c, 101, history(true))).toEqual([]);
    expect(c.report().silenceExcused).toBe(1);
  });
  it('still excuses it when the holder\'s heartbeat in the window was lost (limit-6 excuse with a lost heartbeat)', () => {
    const c = make();
    expect(feed(c, 101, history(true, (t) => ({ radio: t === 70 ? [hb(70, 3, [], 1)] : [] })))).toEqual([]);
  });
  it('fires when a heartbeat from the slot\'s holder was delivered to it inside the tSuspect window', () => {
    const c = make();
    expect(feed(c, 101, history(true, (t) => ({ radio: t === 70 ? [hb(70, 3, [11])] : [] }))))
      .toEqual([expect.objectContaining({ inv: 'INV-SILENCE', tick: 100, ids: [11], slot: 3 })]);
  });
  it('(ii) window boundaries: a holder heartbeat sent at c - tSuspect - latencyMin or at c - 1 does not count; one sent at c - latencyMax does', () => {
    for (const [sent, fires] of [[100 - 60 - 1, false], [99, false], [98, true], [40, true]] as const) {
      const c = make();
      const v = feed(c, 101, history(true, (t) => ({ radio: t === sent ? [hb(sent, 3, [11])] : [] })));
      expect(v.length, `heartbeat sent at ${sent}`).toBe(fires ? 1 : 0);
    }
  });
  it('excuse (b): a pop after an excused commit is excused; a pop with no excused commit fires', () => {
    const popAfter = (vacate: boolean) => (t: number) => {
      const s = history(vacate)(t);
      if (t < 110) return s;
      const specs: Record<number, Spec> = {};
      for (const d of s.drones) specs[d.id] = { pos: d.pos, slot: d.id === 11 ? 11 : d.belief.slot };
      return snap(t, 12, specs);
    };
    const ok = make();
    expect(feed(ok, 111, popAfter(true))).toEqual([]);
    expect(ok.report().silenceExcused).toBe(2);
    const bad = make();
    expect(feed(bad, 111, popAfter(false))).toEqual([
      expect.objectContaining({ inv: 'INV-SILENCE', tick: 100, ids: [11], slot: 3 }),
      expect.objectContaining({ inv: 'INV-SILENCE', tick: 110, ids: [11], slot: 11 }),
    ]);
  });
  it('does not check from the first recorded KILL on', () => {
    const c = make();
    c.recordEvent({ type: 'KILL', tick: 90, ids: [] });
    expect(feed(c, 101, history(false))).toEqual([]);
  });
  it('does not check after a version split (limit 7): two versions coexist from tick 50', () => {
    const c = make();
    expect(feed(c, 101, history(false, undefined, (t): Record<number, Spec> => (t >= 50 ? { 0: { pos: slots[0], version: V1 } } : {})))).toEqual([]);
  });
});

describe('P2-T01: INV-QUIET', () => {
  const params = makeParams(12);
  const at = (t: number) => {
    // Drone 11: commits 11 -> 7 at 300 and 7 -> 3 at 450. Drone 10: one commit 10 -> 4 at 420.
    const s11 = t >= 450 ? 3 : t >= 300 ? 7 : 11;
    const s10 = t >= 420 ? 4 : 10;
    return snap(t, 12, { 11: { slot: s11 }, 10: { slot: s10 } });
  };
  const events: EnvEvent[] = [{ type: 'SET_LOSS', tick: 10, loss: 0.05 }];
  it(`fires more than Q = ${INVARIANT_DEFAULTS.Q} ticks after the anchor; a drone's second commit since the anchor is tagged limit 3`, () => {
    const c = checker(params, ['INV-QUIET']);
    c.registerScore(SCORE);
    for (const e of events) c.recordEvent(e);
    expect(feed(c, 460, at)).toEqual([
      expect.objectContaining({ inv: 'INV-QUIET', tick: 420, ids: [10], slot: 4, knownLimit: null }),
      expect.objectContaining({ inv: 'INV-QUIET', tick: 450, ids: [11], slot: 3, knownLimit: KNOWN_LIMIT_3 }),
    ]);
    const r = c.report();
    expect(r.counterexamples).toHaveLength(1);
    expect(r.knownLimitInstances).toHaveLength(1);
  });
  it('holds when a later event moves the anchor', () => {
    const c = checker(params, ['INV-QUIET']);
    c.registerScore(SCORE);
    c.recordEvent({ type: 'SET_LOSS', tick: 200, loss: 0.05 });
    expect(feed(c, 460, at)).toEqual([]);
  });
  it('the anchor includes the hold start of the drone\'s own score and its own last version change', () => {
    // Movement 1 holds from 400: a commit at 750 is 350 after the hold (holds), 750 after the last event (would fire).
    const held: Score = { version: V0, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }, { startTick: 300, transitionTicks: 100, recipe: { kind: 'helix' } }] };
    const a = checker(params, ['INV-QUIET']);
    a.registerScore(held);
    expect(feed(a, 760, (t) => snap(t, 12, { 11: { slot: t >= 750 ? 3 : 11 } }))).toEqual([]);
    // Drone 10 adopts V1 at 300 and commits at 650: 350 after its own adoption (holds), 650 after tick 0 (would fire).
    const b = checker(params, ['INV-QUIET']);
    b.registerScore(SCORE);
    b.registerScore(SCORE_V1);
    expect(feed(b, 660, (t) => snap(t, 12, { 10: { slot: t >= 650 ? 4 : 10, version: t >= 300 ? V1 : V0 } }))).toEqual([]);
    // Control: without the adoption the same commit fires.
    const c = checker(params, ['INV-QUIET']);
    c.registerScore(SCORE);
    expect(feed(c, 660, (t) => snap(t, 12, { 10: { slot: t >= 650 ? 4 : 10 } })).length).toBe(1);
  });
  it('does not judge a commit on an unregistered version (no guessed hold start)', () => {
    const c = checker(params, ['INV-QUIET']);
    c.registerScore(SCORE);
    expect(feed(c, 460, (t) => snap(t, 12, { 10: { slot: t >= 450 ? 4 : 10, version: V1 } }))).toEqual([]);
    expect(c.report().unavailable.map((u) => u.inv)).toContain('INV-QUIET');
  });
  it('marks the anchor derived when events are not recorded', () => {
    const c = checker(params, ['INV-QUIET'], 'encore', { eventsRecorded: false });
    c.registerScore(SCORE);
    feed(c, 10, at);
    expect(c.report().derived.map((d) => d.inv)).toEqual(['INV-QUIET']);
  });
});

describe('P2-T01: INV-CONVERGE and multi-partition suppression', () => {
  const params = makeParams(3);
  const C = INVARIANT_DEFAULTS.C;
  it(`fires C = ${C} ticks into a stale run in a stable component; a membership change restarts the run`, () => {
    const c = checker(params, ['INV-CONVERGE']);
    // Drone 0 holds V1; 1 and 2 hold V0, stale from the first sample (5). Drone 2 leaves radio range at tick 300:
    // at sample 305 drone 2 is alone (no longer stale) and drone 1's component {0,1,2} became {0,1}, so drone 1's
    // run restarts at 305. Nothing fires at 5 + C; drone 1 fires at 305 + C.
    const v = feed(c, 305 + C + 10, (t) => snap(t, 3, { 0: { version: V1 }, 2: { pos: t >= 300 ? [100, 0, 0] : launchPos(2, 3) } }));
    expect(v).toEqual([expect.objectContaining({ inv: 'INV-CONVERGE', tick: 305 + C, ids: [1], knownLimit: null })]);
  });
  it('tags a stall as flapping when an edge inside the stable component changed state recently', () => {
    const c = checker(params, ['INV-CONVERGE']);
    // 0 at the origin, 1 at x = -10, 2 at x = +10 or +4: edge 1-2 flaps every 10 ticks, the component {0,1,2} stays.
    const v = feed(c, C + 20, (t) => snap(t, 3, {
      0: { version: V1, pos: [0, 0, 0] }, 1: { pos: [-10, 0, 0] }, 2: { pos: [Math.floor(t / 10) % 2 ? 4 : 10, 0, 0] },
    }));
    expect(v.length).toBeGreaterThan(0);
    for (const x of v) expect(x.knownLimit).toBe(KNOWN_LIMIT_FLAPPING);
  });
  const twoPartitions = { partitions: [{ id: 'P', point: [50, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 }, { id: 'Q', point: [0, 0, 50] as Vec3, normal: [0, 0, 1] as Vec3 }] };
  it('without recorded events, pairs are not in contact while two or more partitions are active (suppression only)', () => {
    const c = checker(params, ['INV-CONVERGE'], 'encore', { eventsRecorded: false });
    expect(feed(c, C + 20, (t) => snap(t, 3, { 0: { version: V1, side: 0 }, 1: { side: 0 }, 2: { side: 0 } }, twoPartitions))).toEqual([]);
    expect(c.report().derived.map((d) => d.inv)).toEqual(['INV-CONVERGE']);
  });
  it('with the recorded events the same history fires (all three drones are on one side of both planes)', () => {
    const c = checker(params, ['INV-CONVERGE']);
    c.recordEvent({ type: 'PARTITION_ON', tick: 1, ...twoPartitions.partitions[0] });
    c.recordEvent({ type: 'PARTITION_ON', tick: 1, ...twoPartitions.partitions[1] });
    expect(feed(c, C + 20, (t) => snap(t, 3, { 0: { version: V1 } }, twoPartitions)).length).toBe(2);
  });
});

describe('P2-T01: INV-STATIC', () => {
  const params = makeParams(12);
  it('holds when every static drone keeps slot = id and the preloaded version; fires on a slot or version change', () => {
    const ok = checker(params, ['INV-STATIC'], 'static');
    ok.registerScore(SCORE);
    expect(feed(ok, 5, (t) => snap(t, 12))).toEqual([]);
    const bad = checker(params, ['INV-STATIC'], 'static');
    bad.registerScore(SCORE);
    expect(feed(bad, 5, (t) => snap(t, 12, t >= 3 ? { 2: { slot: 6 }, 4: { version: V1 } } : {}))).toEqual([
      expect.objectContaining({ inv: 'INV-STATIC', tick: 3, ids: [2], slot: 6 }),
      expect.objectContaining({ inv: 'INV-STATIC', tick: 3, ids: [4], slot: 4 }),
    ]);
  });
});

describe('checker rules', () => {
  const params = makeParams(4);
  it('follows TickEvidence\'s tick rules: a repeated tick is a no-op, a gap or a backwards tick throws', () => {
    const c = checker(params, ['INV-MONO']);
    c.ingest(snap(1, 4));
    // The repeat holds an illegal commit (3 -> 2 drops by 1 < claimGap + 1): processed, it would fire INV-MONO.
    expect(c.ingest(snap(1, 4, { 3: { slot: 2 } }))).toEqual([]);
    expect(c.report().violations).toEqual([]);
    expect(() => c.ingest(snap(3, 4))).toThrow(/every simulation tick/);
    c.ingest(snap(2, 4));
    expect(() => c.ingest(snap(1, 4))).toThrow(/reset/);
    c.reset();
    expect(() => c.ingest(snap(1, 4))).not.toThrow();
  });
  it('reports checks it cannot run as unavailable, with the reason', () => {
    const encore = checker(params, ['INV-SILENCE', 'INV-QUIET', 'INV-CONVERGE', 'INV-STATIC']);
    encore.ingest(snap(1, 4));
    const r = encore.report();
    expect(r.checked).toEqual(['INV-CONVERGE']);
    expect(r.unavailable.map((u) => u.inv)).toEqual(['INV-SILENCE', 'INV-QUIET', 'INV-STATIC']);
    const stat = checker(params, ['INV-SILENCE', 'INV-STATIC'], 'static');
    stat.registerScore(SCORE);
    stat.ingest(snap(1, 4));
    expect(stat.report().unavailable).toEqual([{ inv: 'INV-SILENCE', why: 'Encore only' }]);
  });
  it('never mutates its inputs: frozen snapshots, events and scores', () => {
    const c = createInvariantChecker({ params, arm: 'encore' });
    c.registerScore(deepFreeze(structuredClone(SCORE)));
    c.recordEvent(deepFreeze({ type: 'SET_LOSS', tick: 2, loss: 0.1 }) as EnvEvent);
    expect(() => feed(c, 30, (t) => snap(t, 4, {}, { radio: [hb(t, 0, [1, 2])] }))).not.toThrow();
  });
});
