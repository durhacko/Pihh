// tests/agent/adoptionPace.test.ts
// Adoption pacing (contract section 10, [contract] #123): a drone that adopts a score mid-transition paces from
// its own position and the adoption tick, not from the movement start; a slot change re-anchors; adopting before
// the movement starts (or in its hold) is exactly pacedSlotPos with no state field set.
import { describe, expect, it } from 'vitest';
import { DT, OPERATOR, makeParams } from '../../src/contracts';
import type { AgentInput, Recipe, Score, ScoreMsg, Vec3 } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import {
  PACE_SETTLE_TICKS, adoptionSpan, anchorPace, anchoredPos, flightTicks, midTransition, pacedSlotPos, steer,
} from '../../src/agent/steer';

const N = 40;
const P = makeParams(N);
const TEXT: Recipe = { kind: 'text', text: 'ENCORE' };
const SPHERE: Recipe = { kind: 'sphere' };
const ME = 0;                       // slot 0: there is no more important slot to claim, so the slot only changes when a test says so
const PRELOADED: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [{ startTick: 0, transitionTicks: 100, recipe: TEXT }] };
/** Injected at 200: ENCORE kept, then a sphere from 260 with a 400-tick transition (paced 260 to 600, hold at 660). */
const INJECTED: Score = {
  version: { issuedTick: 200, origin: 5 },
  movements: [{ startTick: 0, transitionTicks: 100, recipe: TEXT }, { startTick: 260, transitionTicks: 400, recipe: SPHERE }],
};
const HOLD = 660;
const PACE_END = HOLD - PACE_SETTLE_TICKS;   // 600
const slotOf = (r: Recipe, i: number): Vec3 => expandRecipe(r, N, P).slots[i].pos;
const VEL: Vec3 = [0.5, -0.2, 0.1];

function scoreMsg(tick: number): ScoreMsg {
  return { type: 'SCORE', from: OPERATOR, seq: 0, sentTick: tick - 1, score: INJECTED };
}
function input(tick: number, pos: Vec3, inbox: ScoreMsg[] = []): AgentInput {
  return { tick, pos, vel: VEL, inbox, sensed: [] };
}
// Non-heartbeat ticks for id 0 (hbPeriod 5): no scan, no claim, no send in these steps.
const offBeat = (t: number) => { expect(t % P.hbPeriod).not.toBe(ME % P.hbPeriod); return t; };

describe('adoption pacing helpers', () => {
  it('midTransition is true strictly after the movement begins and before its paced point reaches the slot', () => {
    expect(midTransition(260, HOLD, 260)).toBe(false);
    expect(midTransition(260, HOLD, 261)).toBe(true);
    expect(midTransition(260, HOLD, PACE_END - 1)).toBe(true);
    expect(midTransition(260, HOLD, PACE_END)).toBe(false);
    expect(midTransition(-40, 323, 0)).toBe(false);     // a movement that began before tick 0 begins at 0
  });

  it('anchorPace never ends before holdStart - PACE_SETTLE_TICKS, nor before tick + minTicks', () => {
    expect(flightTicks([0, 30, 0], [60, 30, 0], P)).toBe(Math.ceil(60 / (0.5 * P.vMax) / DT));   // 60 m at 4 m/s: 300 ticks
    expect(adoptionSpan(260, HOLD)).toBe(PACE_END - 260);
    expect(adoptionSpan(-40, 323)).toBe(323 - PACE_SETTLE_TICKS);                                // begins at tick 0
    const near = anchorPace(1, 3, 500, [0, 30, 0], HOLD, flightTicks([0, 30, 0], [4, 30, 0], P));   // 4 m: 20 ticks
    expect(near).toEqual({ mv: 1, slot: 3, begin: 500, end: PACE_END, from: [0, 30, 0] });
    const far = anchorPace(1, 3, 500, [0, 30, 0], HOLD, flightTicks([0, 30, 0], [60, 30, 0], P));
    expect(far.end).toBe(800);
    expect(anchoredPos(far, 500, [60, 30, 0])).toEqual([0, 30, 0]);                  // starts where the drone is
    expect(anchoredPos(far, 650, [60, 30, 0])).toEqual([30, 30, 0]);
    expect(anchoredPos(far, 10_000, [60, 30, 0])).toEqual([60, 30, 0]);
  });
});

describe('encoreBrain: adoption pacing', () => {
  it('adopting before the new movement starts is exactly pacedSlotPos, and sets no state field', () => {
    const s = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    const pos = slotOf(TEXT, ME);
    const t = offBeat(201);
    const out = encoreBrain.step(s, input(t, pos, [scoreMsg(t)]));
    expect(s.score.version).toEqual(INJECTED.version);
    expect('pace' in s).toBe(false);
    expect(out.accel).toEqual(steer(pos, VEL, pacedSlotPos(INJECTED, t, ME, N, P), [], P));
    // and later in the transition it still follows pacedSlotPos, with no field
    const t2 = offBeat(401);
    const mid: Vec3 = [1, 25, 2];
    const out2 = encoreBrain.step(s, input(t2, mid));
    expect('pace' in s).toBe(false);
    expect(out2.accel).toEqual(steer(mid, VEL, pacedSlotPos(INJECTED, t2, ME, N, P), [], P));
  });

  it('adopting in the hold of the current movement is exactly pacedSlotPos, with no field', () => {
    const late: Score = { ...INJECTED, movements: [INJECTED.movements[0]] };   // only ENCORE: in its hold from tick 100
    const s = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    const t = offBeat(301);
    const pos = slotOf(TEXT, ME);
    const out = encoreBrain.step(s, input(t, pos, [{ ...scoreMsg(t), score: late }]));
    expect('pace' in s).toBe(false);
    expect(out.accel).toEqual(steer(pos, VEL, pacedSlotPos(late, t, ME, N, P), [], P));
  });

  it('adopting mid-transition anchors at my position and the adoption tick, instead of the far-advanced pacedSlotPos', () => {
    const s = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    const pos = slotOf(TEXT, ME);                       // still on my ENCORE slot: the score never reached me
    const t = offBeat(501);                             // (501 - 260) / (600 - 260) = 71% of the way along pacedSlotPos
    const out = encoreBrain.step(s, input(t, pos, [scoreMsg(t)]));
    const to = slotOf(SPHERE, ME);
    // The whole paced span of the movement (600 - 260 = 340 ticks) from the adoption tick: late adopters move in step.
    expect(s.pace).toEqual({ mv: 1, slot: ME, begin: t, end: t + 340, from: pos });
    expect(s.pace).toEqual(anchorPace(1, ME, t, pos, HOLD, adoptionSpan(260, HOLD)));
    // At the adoption tick the aim is where I am, not 71% of the way to the sphere slot.
    expect(out.accel).toEqual(steer(pos, VEL, pos, [], P));
    expect(out.accel).not.toEqual(steer(pos, VEL, pacedSlotPos(INJECTED, t, ME, N, P), [], P));
    // Two ticks later the aim has moved along the anchored segment.
    const t2 = offBeat(503);
    const here: Vec3 = [pos[0] + 0.1, pos[1], pos[2]];
    const out2 = encoreBrain.step(s, input(t2, here));
    expect(out2.accel).toEqual(steer(here, VEL, anchoredPos(s.pace!, t2, to), [], P));
    // Belief.target stays the real slot.
    expect(encoreBrain.belief(s).target).toEqual(to);
  });

  it('a slot change while anchored re-anchors from the position at that tick; the anchor ends at its end tick', () => {
    const s = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    const t = offBeat(501);
    encoreBrain.step(s, input(t, slotOf(TEXT, ME), [scoreMsg(t)]));
    expect(s.pace?.slot).toBe(ME);
    // A heal: the drone now holds slot 7 (as a commit would leave it), mid-transition.
    s.history.push({ slot: s.slot, heldSince: s.heldSince });
    s.slot = 7;
    const t2 = offBeat(502);
    const here: Vec3 = [3, 22, -1];
    const out = encoreBrain.step(s, input(t2, here));
    const to7 = slotOf(SPHERE, 7);
    // A slot change re-anchors with the flight-time floor, so a heal is not slowed to a whole transition.
    expect(s.pace).toEqual(anchorPace(1, 7, t2, here, HOLD, flightTicks(here, to7, P)));
    expect(s.pace?.end).toBe(Math.max(PACE_END, t2 + flightTicks(here, to7, P)));
    expect(out.accel).toEqual(steer(here, VEL, here, [], P));                 // re-anchored where I am: no sprint
    expect(out.accel).not.toEqual(steer(here, VEL, pacedSlotPos(INJECTED, t2, 7, N, P), [], P));
    // When the anchored point reaches the slot, the field is removed and pacedSlotPos (the slot itself by then) takes over.
    let end = s.pace!.end;
    if (end % P.hbPeriod === ME % P.hbPeriod) end += 1;
    const atEnd: Vec3 = [to7[0], to7[1], to7[2]];
    const out3 = encoreBrain.step(s, input(end, atEnd));
    expect('pace' in s).toBe(false);
    expect(out3.accel).toEqual(steer(atEnd, VEL, pacedSlotPos(INJECTED, end, 7, N, P), [], P));
  });

  it('two drones that adopt on the same tick get the same begin and end (they move in step)', () => {
    const a = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    const b = encoreBrain.init({ id: 6, n0: N, initialSlot: 6, score: PRELOADED, params: P, seed: 2 });
    // Different slots, different distances to fly; tick 502 is off-beat for both id 0 and id 6.
    encoreBrain.step(a, input(502, slotOf(TEXT, ME), [scoreMsg(502)]));
    encoreBrain.step(b, input(502, slotOf(TEXT, 6), [scoreMsg(502)]));
    expect(a.pace).toMatchObject({ begin: 502, end: 502 + 340 });
    expect(b.pace).toMatchObject({ begin: 502, end: 502 + 340 });
  });

  it('the state stays plain JSON with the field present', () => {
    const s = encoreBrain.init({ id: ME, n0: N, initialSlot: ME, score: PRELOADED, params: P, seed: 1 });
    encoreBrain.step(s, input(offBeat(501), slotOf(TEXT, ME), [scoreMsg(501)]));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
