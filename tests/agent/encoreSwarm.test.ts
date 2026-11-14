// tests/agent/encoreSwarm.test.ts
// Tests for issue #16 (WP-1b) in which several Encore brains interact (contract section 8).
// The "world" is a tiny in-test harness, not src/sim: an ideal radio (every live drone within rRadio of
// the sender at send time hears the message one tick later, no loss), ideal sensing (every live drone
// within rSense), and the integrator of section 10 in the order of the real world: tick += 1, kills,
// every brain steps from the same start-of-tick state on a deep-frozen input, then clamp |accel| <= aMax,
// integrate velocity, clamp |vel| <= vMax, integrate position, keep y >= 0.
// Gate G1 on the real world, with packet loss, is issue #17. Nothing here replaces it.
import { describe, expect, it } from 'vitest';
import { DT, makeParams } from '../../src/contracts';
import type { AgentInput, AgentOutput, Belief, Formation, Message, Params, Recipe, Score, Sensed, Vec3 } from '../../src/contracts';
import { expandRecipe, launchPos, makeScore } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import type { EncoreState } from '../../src/agent/state';

// ---------- small helpers ----------

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function clampLen(v: Vec3, max: number): Vec3 {
  const l = len(v);
  return l <= max ? v : [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

// ---------- the harness ----------

interface Drone { id: number; alive: boolean; state: EncoreState; pos: Vec3; vel: Vec3 }
interface SwarmOptions {
  n: number;
  recipe: Recipe;
  ticks: number;
  kills?: { tick: number; ids: number[] }[];        // these drones are dead from this tick on
  radioOff?: { from: number; to: number };         // nothing sent at a tick in [from, to) is heard by anybody
  roundTrip?: boolean;                             // every state goes through JSON before every step
}
interface SlotChange { tick: number; id: number; from: number; to: number; heldSince: number; kind: 'commit' | 'back' }
interface Trace {
  params: Params;
  score: Score;
  formation: Formation;
  holdStart: number;
  claims: { tick: number; id: number; slot: number; rank: number }[];   // every heartbeat that carried a claim
  changes: SlotChange[];                                                // every change of a believed slot
  dupTicks: number;                 // ticks on which some slot was believed by two or more live drones
  longestDup: number;               // longest run of such ticks
  sent: number;                     // heartbeats sent
  drones: Drone[];                  // as they were after the last tick
  beliefs: Belief[];                // after the last tick (dead drones: their last belief)
  digest: string[];                 // per tick: JSON of every output and position, for comparing two runs
}

function runSwarm(o: SwarmOptions): Trace {
  const params = makeParams(o.n);
  const score = makeScore([o.recipe], o.n, params, 100000);     // one movement with a hold longer than any test
  const formation = expandRecipe(o.recipe, o.n, params);
  const drones: Drone[] = [];
  for (let id = 0; id < o.n; id++) {
    drones.push({
      id, alive: true, pos: launchPos(id, o.n), vel: [0, 0, 0],
      state: encoreBrain.init({ id, n0: o.n, initialSlot: id, score: jsonCopy(score), params: { ...params }, seed: 9000 + id }),
    });
  }
  const trace: Trace = {
    params, score, formation, holdStart: score.movements[0].transitionTicks,
    claims: [], changes: [], dupTicks: 0, longestDup: 0, sent: 0, drones, beliefs: [], digest: [],
  };
  let inFlight: { to: number; message: Message }[] = [];
  let dupRun = 0;
  const believed: number[] = drones.map(d => d.state.slot);

  for (let tick = 1; tick <= o.ticks; tick++) {
    for (const kill of o.kills ?? []) if (kill.tick === tick) for (const id of kill.ids) drones[id].alive = false;

    // Radio: what was sent last tick arrives now, sorted as the contract says.
    const inboxes: Message[][] = drones.map(() => []);
    for (const delivery of inFlight) if (drones[delivery.to].alive) inboxes[delivery.to].push(delivery.message);
    inFlight = [];
    for (const inbox of inboxes) inbox.sort((a, b) => a.sentTick - b.sentTick || a.from - b.from || a.seq - b.seq);

    // Every live brain decides from the same start-of-tick state.
    const outputs = drones.map((d, i): AgentOutput | null => {
      if (!d.alive) return null;
      const sensed: Sensed[] = [];
      for (let j = 0; j < drones.length; j++) {
        if (j === i || !drones[j].alive) continue;
        const rel = sub(drones[j].pos, d.pos);
        if (len(rel) <= params.rSense) sensed.push({ rel, vel: sub(drones[j].vel, d.vel) });
      }
      const input: AgentInput = deepFreeze({ tick, pos: [...d.pos] as Vec3, vel: [...d.vel] as Vec3, inbox: inboxes[i], sensed });
      if (o.roundTrip) d.state = jsonCopy(d.state);
      return jsonCopy(encoreBrain.step(d.state, input));
    });

    // Broadcast: one frozen packet per message, to every live drone in range of the sender now.
    drones.forEach((d, i) => {
      const out = outputs[i];
      if (out === null) return;
      for (const message of out.outbox) {
        if (message.from !== d.id || message.sentTick !== tick) throw new Error(`drone ${d.id}: a broadcast must carry its sender and the current tick`);
        trace.sent++;
        if (message.type === 'HB' && message.claim) trace.claims.push({ tick, id: d.id, slot: message.claim.slot, rank: message.claim.rank });
        if (o.radioOff && tick >= o.radioOff.from && tick < o.radioOff.to) continue;
        const packet = deepFreeze(jsonCopy(message));
        for (let j = 0; j < drones.length; j++) {
          if (j !== i && drones[j].alive && dist(drones[j].pos, d.pos) <= params.rRadio) inFlight.push({ to: j, message: packet });
        }
      }
    });

    // Then all move.
    drones.forEach((d, i) => {
      const out = outputs[i];
      if (out === null) return;
      const a = clampLen(out.accel, params.aMax);
      d.vel = clampLen([d.vel[0] + a[0] * DT, d.vel[1] + a[1] * DT, d.vel[2] + a[2] * DT], params.vMax);
      d.pos = [d.pos[0] + d.vel[0] * DT, Math.max(0, d.pos[1] + d.vel[1] * DT), d.pos[2] + d.vel[2] * DT];
    });

    // Bookkeeping, from beliefs only.
    const holders = new Map<number, number>();
    for (const d of drones) {
      if (!d.alive) continue;
      const b = encoreBrain.belief(d.state);
      if (b.slot !== believed[d.id]) {
        const kind = b.heldSince === tick && b.slot < believed[d.id] ? 'commit' : 'back';
        trace.changes.push({ tick, id: d.id, from: believed[d.id], to: b.slot, heldSince: b.heldSince, kind });
        believed[d.id] = b.slot;
      }
      holders.set(b.slot, (holders.get(b.slot) ?? 0) + 1);
    }
    const dup = [...holders.values()].some(count => count > 1);
    dupRun = dup ? dupRun + 1 : 0;
    if (dup) trace.dupTicks++;
    if (dupRun > trace.longestDup) trace.longestDup = dupRun;
    trace.digest.push(JSON.stringify([outputs, drones.map(d => d.pos)]));
  }
  trace.beliefs = drones.map(d => encoreBrain.belief(d.state));
  return trace;
}

/** The live drone that is within rOcc of slot `v` and slower than 0.5 m/s at the end of the run, or -1. */
function settledOn(t: Trace, v: number): number {
  for (const d of t.drones) {
    if (d.alive && dist(d.pos, t.formation.slots[v].pos) < t.params.rOcc && len(d.vel) < 0.5) return d.id;
  }
  return -1;
}
const alive = (t: Trace): Drone[] => t.drones.filter(d => d.alive);
const commits = (t: Trace): SlotChange[] => t.changes.filter(c => c.kind === 'commit');
const backs = (t: Trace): SlotChange[] => t.changes.filter(c => c.kind === 'back');

// ---------- the small show: 12 drones on a sphere ----------

const N = 12;
const SPHERE: Recipe = { kind: 'sphere' };
const HOLD_START = makeScore([SPHERE], N, makeParams(N)).movements[0].transitionTicks;
const KILL = HOLD_START + 180;        // well into the hold: everybody may heal by then
const SECONDS = (s: number): number => Math.round(s / DT);

describe('the show used by these tests', () => {
  it('is a 12-drone sphere in which every slot is within rClaim and rRadio of every other', () => {
    const p = makeParams(N);
    const f = expandRecipe(SPHERE, N, p);
    expect(p.claimGap).toBe(2);
    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        expect(dist(f.slots[a].pos, f.slots[b].pos)).toBeLessThanOrEqual(p.rClaim);
        expect(dist(f.slots[a].pos, f.slots[b].pos)).toBeGreaterThanOrEqual(p.slotSpacingMin);
      }
    }
    expect(KILL).toBeGreaterThan(HOLD_START + p.holdGrace + p.tSettle);
    expect(KILL).toBeGreaterThan(p.tStable);
  });
});

describe('encore swarm: no failure', () => {
  it('flies to the formation, settles, and nobody claims or changes slot', () => {
    const t = runSwarm({ n: N, recipe: SPHERE, ticks: KILL + 400 });
    expect(t.claims).toEqual([]);
    expect(t.changes).toEqual([]);
    expect(t.dupTicks).toBe(0);
    for (let id = 0; id < N; id++) {
      expect(settledOn(t, id)).toBe(id);
      expect(t.beliefs[id]).toMatchObject({ slot: id, heldSince: 0, deaf: false, canHeal: true, claiming: null, peersKnown: N - 1, log: [] });
    }
    // Every drone sent one heartbeat per hbPeriod, on its own ticks, and nothing else.
    let expected = 0;
    for (let id = 0; id < N; id++) {
      for (let tick = 1; tick <= KILL + 400; tick++) if (tick % t.params.hbPeriod === id % t.params.hbPeriod) expected++;
    }
    expect(t.sent).toBe(expected);
  });

  it('silence is not death: with the radio off for 35 s in hold, nobody claims or changes slot', () => {
    const off = { from: KILL, to: KILL + SECONDS(35) };
    const during = runSwarm({ n: N, recipe: SPHERE, ticks: off.to - 1, radioOff: off });
    for (let id = 0; id < N; id++) expect(during.beliefs[id]).toMatchObject({ slot: id, deaf: true, canHeal: false, peersKnown: 0 });
    const t = runSwarm({ n: N, recipe: SPHERE, ticks: off.to + 200, radioOff: off });
    expect(t.claims).toEqual([]);
    expect(t.changes).toEqual([]);
    for (let id = 0; id < N; id++) expect(t.beliefs[id]).toMatchObject({ slot: id, deaf: false, canHeal: true, peersKnown: N - 1 });
  });
});

describe('encore swarm: contention for one vacant slot', () => {
  it('with exactly two claimants, exactly one commits: the one on the less important slot', () => {
    // Slot 7 dies. Only slots 10 and 11 are more than claimGap less important.
    const t = runSwarm({ n: N, recipe: SPHERE, ticks: KILL + SECONDS(30), kills: [{ tick: KILL, ids: [7] }] });
    expect(new Set(t.claims.map(c => c.id))).toEqual(new Set([10, 11]));
    expect(t.claims.every(c => c.slot === 7 && c.rank === c.id)).toBe(true);
    // No claim before the slot had been empty and silent for long enough.
    expect(Math.min(...t.claims.map(c => c.tick))).toBeGreaterThanOrEqual(KILL - t.params.hbPeriod + t.params.tSuspect);

    expect(t.changes).toHaveLength(1);
    const commit = t.changes[0];
    expect(commit).toMatchObject({ id: 11, from: 11, to: 7, kind: 'commit' });
    const firstClaim11 = Math.min(...t.claims.filter(c => c.id === 11).map(c => c.tick));
    expect(commit.tick).toBe(firstClaim11 + t.params.claimWindow);

    // Drone 10 stood down when it heard the better bid, and says so.
    expect(t.beliefs[10]).toMatchObject({ slot: 10, heldSince: 0, claiming: null });
    expect(t.beliefs[10].log.some(l => l.includes('drop claim on slot 7: better bid from 11'))).toBe(true);
    expect(t.claims.filter(c => c.id === 10).every(c => c.tick < commit.tick)).toBe(true);

    // The hole moved from slot 7 to slot 11, and nobody is left who may claim that.
    expect(settledOn(t, 7)).toBe(11);
    expect(settledOn(t, 11)).toBe(-1);
    expect(t.beliefs[11]).toMatchObject({ slot: 7, heldSince: commit.tick });
    expect(t.dupTicks).toBe(0);
    expect(t.claims.every(c => c.tick < commit.tick)).toBe(true);
  });

  it('with many claimants, exactly one commits, and it is the best bidder', () => {
    // Slot 0 dies: every drone on slot 3 or higher may claim it.
    const t = runSwarm({ n: N, recipe: SPHERE, ticks: KILL + SECONDS(30), kills: [{ tick: KILL, ids: [0] }] });
    const claimants = [...new Set(t.claims.map(c => c.id))].sort((a, b) => a - b);
    expect(claimants.length).toBeGreaterThanOrEqual(2);
    expect(claimants.every(id => id >= 3)).toBe(true);
    expect(t.claims.every(c => c.slot === 0 && c.rank === c.id)).toBe(true);
    expect(t.changes).toHaveLength(1);
    expect(t.changes[0]).toMatchObject({ id: Math.max(...claimants), from: Math.max(...claimants), to: 0, kind: 'commit' });
    expect(t.changes[0].id).toBe(11);
    expect(settledOn(t, 0)).toBe(11);
    expect(t.dupTicks).toBe(0);
    expect(alive(t).every(d => t.beliefs[d.id].claiming === null)).toBe(true);
  });

  it('two claimants that cannot hear each other both commit; the duplicate clears when the radio returns', () => {
    // Known limit 5 (section 8.5). The radio is off from 55 to 90 ticks after the kill: short enough that
    // nobody is deaf (tDeaf = 40 after the last message heard), long enough to hide both claim windows.
    const off = { from: KILL + 55, to: KILL + 90 };
    const t = runSwarm({ n: N, recipe: SPHERE, ticks: KILL + SECONDS(30), kills: [{ tick: KILL, ids: [7] }], radioOff: off });
    const made = commits(t);
    expect(made.map(c => c.id).sort((a, b) => a - b)).toEqual([10, 11]);
    expect(made.every(c => c.to === 7 && c.tick >= off.from && c.tick < off.to)).toBe(true);
    // The earlier holder keeps the slot; the other goes back to its launch slot with its original heldSince.
    const [keeper, loser] = [...made].sort((a, b) => a.heldSince - b.heldSince || a.id - b.id);
    expect(backs(t)).toHaveLength(1);
    expect(backs(t)[0]).toMatchObject({ id: loser.id, from: 7, to: loser.id, heldSince: 0 });
    expect(backs(t)[0].tick).toBeGreaterThanOrEqual(off.to);
    expect(backs(t)[0].tick).toBeLessThanOrEqual(off.to + t.params.hbPeriod + 1);
    expect(t.beliefs[loser.id].log.at(-1)).toContain(`lost duplicate to ${keeper.id}`);
    expect(t.beliefs[keeper.id]).toMatchObject({ slot: 7, heldSince: keeper.heldSince });
    expect(settledOn(t, 7)).toBe(keeper.id);
    expect(settledOn(t, loser.id)).toBe(loser.id);
    // The duplicate lasted from the second commit until the first heartbeat heard after the radio came back.
    expect(t.dupTicks).toBe(backs(t)[0].tick - Math.max(...made.map(c => c.tick)));
    expect(t.longestDup).toBeLessThanOrEqual(SECONDS(3));
    expect(t.changes.every(c => c.tick <= off.to + t.params.hbPeriod + 1)).toBe(true);
  });
});

describe('encore swarm: 12 drones, 2 kills', () => {
  const KILLED = [1, 4];
  const TICKS = KILL + SECONDS(30);
  let shared: Trace | undefined;
  const run = (): Trace => (shared ??= runSwarm({ n: N, recipe: SPHERE, ticks: TICKS, kills: [{ tick: KILL, ids: KILLED }] }));

  it('heals: the two holes are filled, the loss ends up on the least important slots', () => {
    const t = run();
    expect(alive(t)).toHaveLength(N - KILLED.length);
    // Every change is a commit that lowers the slot index by more than claimGap; nobody went back.
    expect(backs(t)).toEqual([]);
    for (const c of commits(t)) expect(c.to + t.params.claimGap).toBeLessThan(c.from);
    expect(commits(t).length).toBeLessThanOrEqual(3 * KILLED.length);
    expect(commits(t).map(c => [c.id, c.from, c.to])).toEqual([[11, 11, 1], [10, 10, 4]]);
    // Both holes are physically filled, and the two empty slots are now 10 and 11.
    expect(settledOn(t, 1)).toBe(11);
    expect(settledOn(t, 4)).toBe(10);
    for (let v = 0; v < N; v++) expect(settledOn(t, v) !== -1, `slot ${v}`).toBe(v < N - KILLED.length);
  });

  it('settles: no slot is ever held by two drones, and nothing changes in the last 10 seconds', () => {
    const t = run();
    expect(t.dupTicks).toBe(0);
    const held = alive(t).map(d => t.beliefs[d.id].slot).sort((a, b) => a - b);
    expect(new Set(held).size).toBe(held.length);
    expect(held).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const quietFrom = TICKS - SECONDS(10);
    expect(t.changes.filter(c => c.tick > quietFrom)).toEqual([]);
    expect(t.claims.filter(c => c.tick > quietFrom)).toEqual([]);
    // In fact everything was over within 6 seconds of the kill.
    expect(Math.max(...t.changes.map(c => c.tick))).toBeLessThanOrEqual(KILL + SECONDS(6));
    for (const d of alive(t)) expect(t.beliefs[d.id]).toMatchObject({ claiming: null, deaf: false, canHeal: true });
  });

  it('two identical runs give identical outputs and positions at every tick', () => {
    const a = run();
    const b = runSwarm({ n: N, recipe: SPHERE, ticks: TICKS, kills: [{ tick: KILL, ids: KILLED }] });
    expect(b.digest).toHaveLength(TICKS);
    expect(b.digest.findIndex((line, i) => line !== a.digest[i])).toBe(-1);
    expect(b.changes).toEqual(a.changes);
    expect(jsonCopy(b.drones.map(d => d.state))).toStrictEqual(jsonCopy(a.drones.map(d => d.state)));
    // The comparison can fail: another kill gives another run.
    const c = runSwarm({ n: N, recipe: SPHERE, ticks: TICKS, kills: [{ tick: KILL, ids: [1, 5] }] });
    expect(c.digest.findIndex((line, i) => line !== a.digest[i])).toBe(KILL - 1);
  });

  it('with every state sent through JSON before every step, the run is identical', () => {
    const a = run();
    const b = runSwarm({ n: N, recipe: SPHERE, ticks: TICKS, kills: [{ tick: KILL, ids: KILLED }], roundTrip: true });
    expect(b.digest.findIndex((line, i) => line !== a.digest[i])).toBe(-1);
    expect(b.drones.map(d => d.state)).toStrictEqual(a.drones.map(d => d.state));
  });
});

describe('encore swarm: 40 drones on a text formation, a clumped kill of 5 (ideal radio)', () => {
  it('fills the holes from nearby, less important slots, and then stays quiet', () => {
    // The shape of gate G1 test 2 (section 8.6), but on this harness: no packet loss, 1-tick latency.
    const n = 40;
    const recipe: Recipe = { kind: 'text', text: 'ENCORE' };
    const p = makeParams(n);
    const f = expandRecipe(recipe, n, p);
    const kill = makeScore([recipe], n, p).movements[0].transitionTicks + 180;
    // The 5 drones nearest slot 0 (itself included). In hold, drone i sits on slot i.
    const killed = f.slots.map(s => s.index)
      .sort((a, b) => dist(f.slots[a].pos, f.slots[0].pos) - dist(f.slots[b].pos, f.slots[0].pos) || a - b)
      .slice(0, 5);
    expect(killed).toContain(0);
    const ticks = kill + SECONDS(30);
    const t = runSwarm({ n, recipe, ticks, kills: [{ tick: kill, ids: killed }] });

    expect(alive(t)).toHaveLength(n - killed.length);
    expect(commits(t).length).toBeGreaterThan(0);
    expect(commits(t).length).toBeLessThanOrEqual(3 * killed.length);
    for (const c of commits(t)) expect(c.to + p.claimGap).toBeLessThan(c.from);     // every commit lowers the slot index
    expect(backs(t)).toEqual([]);
    expect(t.dupTicks).toBe(0);
    expect(t.changes.filter(c => c.tick > ticks - SECONDS(10))).toEqual([]);
    expect(t.claims.filter(c => c.tick > ticks - SECONDS(10))).toEqual([]);
    const held = alive(t).map(d => t.beliefs[d.id].slot);
    expect(new Set(held).size).toBe(held.length);
    // Here every killed slot was refilled, each by one hop, and the holes ended up on less important slots.
    for (const v of killed) expect(settledOn(t, v), `slot ${v}`).not.toBe(-1);
    const empty = f.slots.map(s => s.index).filter(v => settledOn(t, v) === -1);
    expect(empty).toHaveLength(killed.length);
    expect(Math.min(...empty)).toBeGreaterThan(Math.max(...killed));
    expect(commits(t).map(c => c.to).sort((a, b) => a - b)).toEqual([...killed].sort((a, b) => a - b));
  }, 30000);
});
