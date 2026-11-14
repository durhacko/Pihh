// tests/agent/scoreGossip.test.ts
// Unit tests for issue #21 (WP-6a): score adoption and gossip in the Encore brain (contract section 9). One brain,
// stepped with hand-built inputs, so every rule is checked on its own. The real-world tests (T18, jam, partition,
// T16) are in tests/g4/.
import { describe, expect, it } from 'vitest';
import { OPERATOR, makeParams } from '../../src/contracts';
import type { AgentInput, Heartbeat, Message, Score, ScoreMsg, ScoreVersion, Vec3 } from '../../src/contracts';
import { composeNext, currentMovement, expandRecipe, launchPos, makeScore } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { NEVER_HEARD } from '../../src/agent/state';
import type { EncoreState } from '../../src/agent/state';

const N = 40;
const P = makeParams(N);
const ME = 7;
const PRE = makeScore([{ kind: 'sphere' }, { kind: 'helix' }], N, P, 400);
const T = 500;                                                     // a tick in the first movement's hold
const NEXT = composeNext(PRE, T, { kind: 'text', text: 'GO' }, 3, N, P);
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function brain(seed = 1, id = ME): EncoreState {
  return encoreBrain.init({ id, n0: N, initialSlot: id, score: jsonCopy(PRE), params: P, seed });
}
function input(tick: number, inbox: Message[] = [], id = ME): AgentInput {
  const pos: Vec3 = launchPos(id, N);
  return { tick, pos, vel: [0, 0, 0], inbox, sensed: [] };
}
function scoreMsg(score: Score, from: number, tick: number): ScoreMsg {
  return { type: 'SCORE', from, seq: 9000 + tick, sentTick: tick - 1, score: jsonCopy(score) };
}
function hb(from: number, tick: number, version: ScoreVersion): Heartbeat {
  return { type: 'HB', from, seq: tick, sentTick: tick - 1, slot: from, heldSince: 0, version: { ...version }, pos: launchPos(from, N) };
}
/** Steps `s` from tick `from` to `to` with the given inbox per tick; returns every SCORE it sent, with its tick. */
function stepRange(s: EncoreState, from: number, to: number, inboxAt: (t: number) => Message[] = () => []): { tick: number; msg: ScoreMsg }[] {
  const sent: { tick: number; msg: ScoreMsg }[] = [];
  for (let t = from; t <= to; t++) {
    const out = encoreBrain.step(s, input(t, inboxAt(t)));
    for (const m of out.outbox) if (m.type === 'SCORE') sent.push({ tick: t, msg: m });
  }
  return sent;
}

describe('adopt only a strictly newer version (section 9)', () => {
  it('a newer score is adopted: copied, movement recomputed by the clock, target changed, a send scheduled, logged', () => {
    const s = brain();
    stepRange(s, 1, T - 1);
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    expect(s.score).toEqual(NEXT);
    expect(s.mvIndex).toBe(currentMovement(NEXT, T).index);
    expect(s.lastTargetChange).toBe(T);
    expect(s.settledSince).toBeNull();
    expect(s.emptySince.every((e) => e === null)).toBe(true);
    expect(s.scoreSendAt).not.toBeNull();
    expect(s.scoreSendAt as number).toBeGreaterThanOrEqual(T + 1);
    expect(s.scoreSendAt as number).toBeLessThanOrEqual(T + P.scoreJitter);
    expect(encoreBrain.belief(s).version).toEqual(NEXT.version);
    expect(s.log.some((l) => l.includes(`adopt score {${T}, 3}`))).toBe(true);
  });

  it('an equal or older version is ignored entirely (no target change, no send scheduled, rng untouched)', () => {
    for (const offered of [PRE, { ...jsonCopy(PRE), version: { issuedTick: 0, origin: OPERATOR - 1 } }]) {
      const s = brain();
      stepRange(s, 1, T - 1);
      const before = jsonCopy(s);
      encoreBrain.step(s, input(T, [scoreMsg(offered, 3, T)]));
      expect(s.score).toEqual(PRE);
      expect(s.lastTargetChange).toBe(before.lastTargetChange);
      expect(s.scoreSendAt).toBeNull();
      expect(s.rng).toBe(before.rng);
    }
  });

  it('version order is (issuedTick, origin): the same tick with a higher origin is newer, with a lower one it is not', () => {
    const s = brain();
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    const higher = { ...jsonCopy(NEXT), version: { issuedTick: T, origin: 4 } };
    const lower = { ...jsonCopy(NEXT), version: { issuedTick: T, origin: 2 } };
    encoreBrain.step(s, input(T + 1, [scoreMsg(lower, 2, T + 1)]));
    expect(s.score.version).toEqual({ issuedTick: T, origin: 3 });
    encoreBrain.step(s, input(T + 2, [scoreMsg(higher, 4, T + 2)]));
    expect(s.score.version).toEqual({ issuedTick: T, origin: 4 });
  });

  it('the adopted score is a copy: changing the message afterwards changes nothing in the brain', () => {
    const s = brain();
    const msg = scoreMsg(NEXT, 3, T);
    encoreBrain.step(s, input(T, [msg]));
    msg.score.movements[1].recipe = { kind: 'sphere' };
    msg.score.version.issuedTick = 1e9;
    expect(s.score).toEqual(NEXT);
  });

  it('a score with no movements is ignored without throwing', () => {
    const s = brain();
    const empty: Score = { version: { issuedTick: T + 50, origin: 1 }, movements: [] };
    expect(() => encoreBrain.step(s, input(T, [scoreMsg(empty, 1, T)]))).not.toThrow();
    expect(s.score).toEqual(PRE);
  });

  it('late adopters join by the clock: adopting long after the new movement started puts me straight into it', () => {
    const s = brain();
    const late = NEXT.movements[1].startTick + 200;
    encoreBrain.step(s, input(late, [scoreMsg(NEXT, 3, late)]));
    expect(s.mvIndex).toBe(1);
    const slot = expandRecipe(NEXT.movements[1].recipe, N, P).slots[ME].pos;
    expect(encoreBrain.belief(s).target).toEqual([slot[0], slot[1], slot[2]]);
  });

  it('the operator uplink is adopted like any SCORE but does not count as radio heard (lastRx)', () => {
    const s = brain();
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, OPERATOR, T)]));
    expect(s.score).toEqual(NEXT);
    expect(s.lastRx).toBe(NEVER_HEARD);
    expect(s.log.some((l) => l.includes('from operator'))).toBe(true);
    const t = brain();
    encoreBrain.step(t, input(T, [scoreMsg(NEXT, 3, T)]));
    expect(t.lastRx).toBe(T);
  });
});

describe('scheduleScoreSend and the send (section 9)', () => {
  it('the first send is not delayed by the rate limit (lastScoreSent starts at -scoreResendMin) and fires exactly at scoreSendAt', () => {
    const s = brain();
    expect(s.lastScoreSent).toBe(-P.scoreResendMin);
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    const at = s.scoreSendAt as number;
    const sent = stepRange(s, T + 1, T + 60);
    expect(sent.map((x) => x.tick)).toEqual([at]);
    const m = sent[0].msg;
    expect(m).toMatchObject({ type: 'SCORE', from: ME, sentTick: at });
    expect(m.score).toEqual(NEXT);
    expect(s.lastScoreSent).toBe(at);
    expect(s.scoreSendAt).toBeNull();
  });

  it('every message I send has its own seq, heartbeats and SCOREs alike', () => {
    const s = brain();
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    const seqs: number[] = [];
    for (let t = T + 1; t <= T + 60; t++) for (const m of encoreBrain.step(s, input(t)).outbox) seqs.push(m.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('a scheduled send is NEVER cancelled: hearing my version from others (SCORE and heartbeats) before it fires changes nothing', () => {
    const quiet = brain();
    encoreBrain.step(quiet, input(T, [scoreMsg(NEXT, 3, T)]));
    const at = quiet.scoreSendAt as number;
    const noisy = brain();
    encoreBrain.step(noisy, input(T, [scoreMsg(NEXT, 3, T)]));
    const same = (t: number): Message[] => [scoreMsg(NEXT, 11, t), hb(12, t, NEXT.version), hb(13, t, NEXT.version)];
    const sent = stepRange(noisy, T + 1, T + 60, (t) => (t < at ? same(t) : []));
    expect(at).toBeGreaterThan(T + 1);   // there is at least one tick in which to hear the others
    expect(sent.map((x) => x.tick)).toEqual([at]);
  });

  it('jitter: the first send is now + 1 + (rng % scoreJitter), deterministic per seed and spread across seeds', () => {
    const delays: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const a = brain(seed);
      const b = brain(seed);
      encoreBrain.step(a, input(T, [scoreMsg(NEXT, 3, T)]));
      encoreBrain.step(b, input(T, [scoreMsg(NEXT, 3, T)]));
      expect(a.scoreSendAt).toBe(b.scoreSendAt);
      delays.push((a.scoreSendAt as number) - T);
    }
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...delays)).toBeLessThanOrEqual(P.scoreJitter);
    expect(new Set(delays).size).toBeGreaterThan(3);
  });

  it('rate limit: under a stale heartbeat on every tick for 400 ticks, at most one SCORE per scoreResendMin, and it keeps sending', () => {
    const s = brain();
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    const sent = stepRange(s, T + 1, T + 400, (t) => [hb(20, t, PRE.version)]);
    const ticks = sent.map((x) => x.tick);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(P.scoreResendMin);
    expect(ticks.length).toBeGreaterThanOrEqual(Math.floor(400 / (P.scoreResendMin + P.scoreJitter)));
  });
});

describe('anti-entropy from heartbeat versions (section 9)', () => {
  it('a heartbeat with an OLDER version schedules a send; an equal or NEWER one does not', () => {
    const upToDate = (): EncoreState => {
      const s = brain();
      encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
      stepRange(s, T + 1, T + P.scoreResendMin + P.scoreJitter + 1);   // the adoption send has fired
      expect(s.scoreSendAt).toBeNull();
      return s;
    };
    const t0 = T + P.scoreResendMin + P.scoreJitter + 2;

    const older = upToDate();
    encoreBrain.step(older, input(t0, [hb(20, t0, PRE.version)]));
    expect(older.scoreSendAt).not.toBeNull();

    const equal = upToDate();
    encoreBrain.step(equal, input(t0, [hb(20, t0, NEXT.version)]));
    expect(equal.scoreSendAt).toBeNull();

    const newer = upToDate();
    encoreBrain.step(newer, input(t0, [hb(20, t0, { issuedTick: T + 100, origin: 5 })]));
    expect(newer.scoreSendAt).toBeNull();
    expect(newer.score.version).toEqual(NEXT.version);   // a heartbeat never carries a score: nothing to adopt
  });

  it('the anti-entropy send also respects the rate limit: no earlier than lastScoreSent + scoreResendMin', () => {
    const s = brain();
    encoreBrain.step(s, input(T, [scoreMsg(NEXT, 3, T)]));
    const sent = stepRange(s, T + 1, T + 20);
    const last = sent[sent.length - 1].tick;
    encoreBrain.step(s, input(last + 1, [hb(20, last + 1, PRE.version)]));
    expect(s.scoreSendAt as number).toBeGreaterThanOrEqual(last + P.scoreResendMin);
  });
});

describe('state stays plain JSON (section 7)', () => {
  it('a brain whose state goes through JSON before every step behaves identically', () => {
    const inbox = (t: number): Message[] => (t === T ? [scoreMsg(NEXT, 3, t)] : t % 9 === 0 ? [hb(20, t, PRE.version)] : []);
    const a = brain();
    let b = brain();
    for (let t = 1; t <= T + 300; t++) {
      const oa = encoreBrain.step(a, input(t, inbox(t)));
      b = jsonCopy(b);
      const ob = encoreBrain.step(b, input(t, inbox(t)));
      expect(ob).toEqual(oa);
    }
    expect(b).toEqual(a);
  });
});
