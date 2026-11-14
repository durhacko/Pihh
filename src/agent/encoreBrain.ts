// src/agent/encoreBrain.ts
// The Encore drone brain: heartbeats, locally observed vacancies, claims, duplicates, physical yield
// (docs/design/contracts-and-algorithms.md, section 8, with the state of section 7).
//
// A brain sees only its own state and its AgentInput: its own body, the messages delivered to it this
// tick, and anonymous relative positions of the drones it senses. It never sees the world, another
// drone's state or ground truth. Imports only the contracts, the score package, ./steer and ./state.
// No clock, no Math.random, no module-level mutable state. Arrays are iterated in index order.
//
// Score adoption and gossip (section 9) are issue #21: handleScoreMessage, scheduleScoreSend, the anti-entropy line in
// handleHeartbeat, and the SCORE send in step 5.
import { OPERATOR } from '../contracts';
import type {
  AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Heartbeat, Message, ScoreMsg, ScoreVersion, Sensed, Slot, Vec3,
} from '../contracts';
import { currentMovement, expandRecipe, newerVersion } from '../score';
import { NEVER_HEARD, nextRandom } from './state';
import type { EncoreState } from './state';
import { steer, steerTarget } from './steer';

/** "Slow" for being settled at a slot, in m/s (section 8.2, condition 3). */
const SETTLED_SPEED = 0.5;
/** A peer-table entry not refreshed for this many ticks is dropped (section 3, "Freshness"). */
const PEER_DROP_TICKS = 200;
/** The decision log keeps this many entries (Belief.log: "last <= 20 decisions"). */
const LOG_MAX = 20;

// ---------- small pure helpers ----------

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isIndex(value: number, n0: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < n0;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sameVersion(a: ScoreVersion, b: ScoreVersion): boolean {
  return a.issuedTick === b.issuedTick && a.origin === b.origin;
}

/** A bid is (rank, -id), compared lexicographically: the higher current slot wins; on a tie the lower id wins. */
function betterBid(rankA: number, idA: number, rankB: number, idB: number): boolean {
  return rankA > rankB || (rankA === rankB && idA < idB);
}

/** True iff a sensed drone is within rOcc of the absolute position `p`. Sensed entries are relative to `pos`. */
function occupied(p: Vec3, pos: Vec3, sensed: readonly Sensed[], rOcc: number): boolean {
  for (let i = 0; i < sensed.length; i++) {
    const rel = sensed[i].rel;
    if (Math.hypot(pos[0] + rel[0] - p[0], pos[1] + rel[1] - p[1], pos[2] + rel[2] - p[2]) < rOcc) return true;
  }
  return false;
}

// ---------- the state changes of section 8.3 ----------

function note(s: EncoreState, now: number, text: string): void {
  s.log.push(`t=${now} ${text}`);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

function targetChanged(s: EncoreState, now: number): void {
  s.lastTargetChange = now;
  s.settledSince = null;
  s.yieldSince = null;
  for (let v = 0; v < s.emptySince.length; v++) s.emptySince[v] = null;
}

function commit(s: EncoreState, now: number, v: number): void {
  const was = s.slot;
  s.history.push({ slot: s.slot, heldSince: s.heldSince });
  // The cap never removes history[0]: that is the launch home. A later pop skips the removed slot
  // and lands on the next older one, which I also held earlier than any later claimant.
  if (s.history.length > s.params.historyMax) s.history.splice(1, 1);
  s.slot = v;
  s.heldSince = now;
  s.claim = null;
  targetChanged(s, now);
  note(s, now, `commit slot ${v} (was ${was})`);
}

function popHistory(s: EncoreState, now: number, why: string): void {
  const previous = s.history.pop();
  if (previous === undefined) {
    // An empty history means I am on my launch home, which nobody can outrank: keep the slot.
    note(s, now, `keep slot ${s.slot}, my launch home: ${why}`);
    return;
  }
  const was = s.slot;
  s.slot = previous.slot;
  s.heldSince = previous.heldSince;     // the ORIGINAL heldSince: I outrank whoever took that slot later
  s.claim = null;
  targetChanged(s, now);
  note(s, now, `back to slot ${s.slot} (was ${was}): ${why}`);
}

function dropClaim(s: EncoreState, now: number, why: string): void {
  if (s.claim === null) return;
  note(s, now, `drop claim on slot ${s.claim.slot}: ${why}`);
  s.claim = null;
}

// ---------- 1. inbox ----------

// ---------- score gossip (section 9; issue #21) ----------

/**
 * Section 9: if no SCORE send is pending, schedule one at max(now + 1 + (rng % scoreJitter), lastScoreSent + scoreResendMin).
 * A scheduled send always fires: it is never cancelled, not even by hearing my own version from someone else
 * (with A in range of B, B in range of C and A out of range of C, only B can reach C). The rate limit bounds the
 * traffic instead: at most one SCORE per drone per scoreResendMin. lastScoreSent starts at -scoreResendMin.
 */
function scheduleScoreSend(s: EncoreState, now: number): void {
  if (s.scoreSendAt !== null) return;
  const jitter = s.params.scoreJitter > 0 ? nextRandom(s) % s.params.scoreJitter : 0;
  s.scoreSendAt = Math.max(now + 1 + jitter, s.lastScoreSent + s.params.scoreResendMin);
}

/**
 * Section 9, "Adopt": a SCORE (from a drone, or the operator uplink: both count the same) is adopted only if its
 * version is strictly newer than mine; an equal or older one is ignored. Adopting recomputes the current movement
 * by the clock, so a late adopter joins whatever movement is current, and spreads the score on.
 */
function handleScoreMessage(s: EncoreState, m: ScoreMsg, now: number): void {
  // A score with no version or no movements cannot be ordered or flown (newerVersion and currentMovement would
  // throw). Honest senders never send one (section 12: no adversarial senders); it is ignored.
  const v = m.score?.version;
  if (!v || !Number.isFinite(v.issuedTick) || !Number.isFinite(v.origin)) return;
  if (!Array.isArray(m.score.movements) || m.score.movements.length === 0) return;
  if (!newerVersion(m.score.version, s.score.version)) return;
  const was = s.score.version;
  s.score = copyJson(m.score);
  s.mvIndex = currentMovement(s.score, now).index;
  targetChanged(s, now);
  scheduleScoreSend(s, now);
  const from = m.from === OPERATOR ? 'operator' : `drone ${m.from}`;
  note(s, now, `adopt score {${s.score.version.issuedTick}, ${s.score.version.origin}} from ${from} (was {${was.issuedTick}, ${was.origin}})`);
}

function handleHeartbeat(s: EncoreState, m: Heartbeat, now: number): void {
  // A heartbeat that names no drone or no slot of the roster cannot be stored in arrays indexed by id
  // and by slot. Honest drones never send one (section 12); it is ignored.
  if (!isIndex(m.from, s.n0) || !isIndex(m.slot, s.n0)) return;

  s.peers[m.from] = {
    slot: m.slot,
    heldSince: m.heldSince,
    version: { issuedTick: m.version.issuedTick, origin: m.version.origin },
    claim: m.claim ? { slot: m.claim.slot, rank: m.claim.rank } : null,
    heard: now,
  };
  s.slotHeard[m.slot] = now;

  // Anti-entropy (section 9): the sender flies an older score, so send it mine. A newer one: do nothing;
  // that drone will hear my heartbeat and send.
  if (newerVersion(s.score.version, m.version)) scheduleScoreSend(s, now);

  // Duplicate: the earlier holder keeps the slot. (heldSince, id) compared lexicographically.
  if (m.slot === s.slot && (m.heldSince < s.heldSince || (m.heldSince === s.heldSince && m.from < s.id))) {
    popHistory(s, now, `lost duplicate to ${m.from}`);
  }
  // A better bid heard on the slot I am claiming.
  if (s.claim !== null && m.claim && m.claim.slot === s.claim.slot && betterBid(m.claim.rank, m.from, s.slot, s.id)) {
    dropClaim(s, now, `better bid from ${m.from}`);
  }
}

function readInbox(s: EncoreState, inbox: readonly Message[], now: number): void {
  for (let i = 0; i < inbox.length; i++) {
    const m = inbox[i];
    if (m.from !== OPERATOR) s.lastRx = now;
    if (m.type === 'SCORE') handleScoreMessage(s, m, now);
    else handleHeartbeat(s, m, now);
  }
}

// ---------- 4. scan and claim ----------

/** Section 8.2: may I judge vacancies? All five must hold, on my own data only. */
function evaluateCanHeal(s: EncoreState, now: number, holdStart: number): boolean {
  const p = s.params;
  if (now < holdStart + p.holdGrace) return false;                                  // 1. in hold, past the grace time
  if (now - s.lastTargetChange < p.tStable) return false;                           // 2. my target is stable
  if (s.settledSince === null || now - s.settledSince < p.tSettle) return false;    // 3. I am settled at my slot
  for (let id = 0; id < s.peers.length; id++) {                                     // 4. nobody nearby flies another score
    const peer = s.peers[id];
    if (peer !== null && now - peer.heard <= p.tDeaf && !sameVersion(peer.version, s.score.version)) return false;
  }
  if (now - s.lastRx > p.tDeaf) return false;                                       // 5. I am not deaf
  return true;
}

/** Locally observed vacancy (section 8.1): sensed empty for tVacant, and no heartbeat holding it heard for tSuspect. */
function vacant(s: EncoreState, now: number, v: number): boolean {
  const since = s.emptySince[v];
  return since !== null && now - since >= s.params.tVacant && now - s.slotHeard[v] >= s.params.tSuspect;
}

/** True iff a peer heard within claimWindow is claiming slot `v` with a better bid than mine. */
function outbid(s: EncoreState, now: number, v: number): boolean {
  for (let id = 0; id < s.peers.length; id++) {
    const peer = s.peers[id];
    if (peer === null || peer.claim === null || peer.claim.slot !== v) continue;
    if (now - peer.heard <= s.params.claimWindow && betterBid(peer.claim.rank, id, s.slot, s.id)) return true;
  }
  return false;
}

function scanAndClaim(s: EncoreState, input: AgentInput, slots: readonly Slot[], holdStart: number): void {
  const now = input.tick;
  const p = s.params;

  // Section 3, "Freshness": a peer-table entry not refreshed for 200 ticks is dropped.
  for (let id = 0; id < s.peers.length; id++) {
    const peer = s.peers[id];
    if (peer !== null && now - peer.heard >= PEER_DROP_TICKS) s.peers[id] = null;
  }

  s.canHeal = evaluateCanHeal(s, now, holdStart);
  if (!s.canHeal) {
    for (let v = 0; v < s.emptySince.length; v++) s.emptySince[v] = null;
    dropClaim(s, now, 'I may not heal now');
    return;
  }

  // Watch every other slot within rClaim of where I am.
  // DEVIATION from the section 8.3 pseudocode, which only says what to do with slots within rClaim and is
  // silent about a slot that was watched and is now beyond it (I drift within rOcc of my own slot). Taken
  // literally its timer would keep running unchecked, and vacant(v) would let me claim a slot farther than
  // rClaim, even one I sense a drone on. Here such a slot is "not watched" again: its timer is cleared
  // (section 7: null = not empty / not watched; section 1: rClaim = max distance to a slot I may claim).
  for (let v = 0; v < slots.length; v++) {
    if (v === s.slot) continue;
    const slotPos = slots[v].pos;
    if (dist(slotPos, input.pos) > p.rClaim) { s.emptySince[v] = null; continue; }
    const empty = !occupied(slotPos, input.pos, input.sensed, p.rOcc);
    s.emptySince[v] = empty ? (s.emptySince[v] ?? now) : null;
  }

  let committed = false;
  if (s.claim !== null) {
    if (!vacant(s, now, s.claim.slot)) {
      dropClaim(s, now, 'no longer vacant');
    } else if (now - s.claim.start >= p.claimWindow) {
      commit(s, now, s.claim.slot);
      committed = true;
    }
  }
  if (s.claim === null && !committed) {
    // The most important vacant slot that is at least claimGap + 1 more important than mine.
    for (let v = 0; v + p.claimGap < s.slot; v++) {
      if (!vacant(s, now, v) || outbid(s, now, v)) continue;
      s.claim = { slot: v, start: now };
      note(s, now, `claim slot ${v} (bid ${s.slot})`);
      break;
    }
  }
}

// ---------- the brain ----------

export const encoreBrain: AgentBrain<EncoreState> = {
  kind: 'encore',

  init(init: AgentInit): EncoreState {
    const { id, n0, initialSlot } = init;
    if (!isIndex(initialSlot, n0)) {
      throw new RangeError(`encoreBrain: initialSlot must be an integer in 0..${n0 - 1}, got ${initialSlot}`);
    }
    const score = copyJson(init.score);
    const params = copyJson(init.params);
    const peers: EncoreState['peers'] = [];
    const slotHeard: number[] = [];
    const emptySince: (number | null)[] = [];
    for (let i = 0; i < n0; i++) { peers.push(null); slotHeard.push(0); emptySince.push(null); }
    return {
      id, n0, params,
      slot: initialSlot, heldSince: 0,
      history: [],
      score, mvIndex: currentMovement(score, 0).index,
      lastTargetChange: 0,
      settledSince: null,
      lastRx: NEVER_HEARD,
      peers, slotHeard, emptySince,
      claim: null,
      yieldSince: null,
      scoreSendAt: null, lastScoreSent: 0 - params.scoreResendMin,
      seq: 0, rng: init.seed >>> 0,
      log: [],
      now: 0,
      canHeal: false,
    };
  },

  step(s: EncoreState, input: AgentInput): AgentOutput {
    const now = input.tick;
    const p = s.params;
    s.now = now;

    // 1. Inbox (already sorted by the medium).
    readInbox(s, input.inbox, now);

    // 2. Target: my slot of the formation that is current by the clock.
    const mv = currentMovement(s.score, now);
    if (mv.index !== s.mvIndex) { s.mvIndex = mv.index; targetChanged(s, now); }
    const slots = expandRecipe(mv.movement.recipe, s.n0, p).slots;   // shared and frozen: read only
    const target = slots[s.slot].pos;
    const off = dist(input.pos, target);
    const atSlot = off < p.rOcc && Math.hypot(input.vel[0], input.vel[1], input.vel[2]) < SETTLED_SPEED;
    s.settledSince = atSlot ? (s.settledSince ?? now) : null;

    // 3. Physical yield (works without radio). Only in hold: during a transition, drones passing
    //    through my slot are not holders.
    if (mv.inHold && s.history.length > 0 && off > p.rOcc) {
      const seen = occupied(target, input.pos, input.sensed, p.rOcc);
      s.yieldSince = seen ? (s.yieldSince ?? now) : null;
      if (s.yieldSince !== null && now - s.yieldSince >= p.yieldTicks) popHistory(s, now, 'slot already occupied');
    }

    // 4. Scan and claim, on my heartbeat ticks only.
    const myTick = now % p.hbPeriod === s.id % p.hbPeriod;
    if (myTick) scanAndClaim(s, input, slots, mv.holdStart);

    // 5. Send.
    const outbox: Message[] = [];
    if (myTick) {
      const hb: Heartbeat = {
        type: 'HB', from: s.id, seq: s.seq, sentTick: now,
        slot: s.slot, heldSince: s.heldSince,
        version: { issuedTick: s.score.version.issuedTick, origin: s.score.version.origin },
        pos: [input.pos[0], input.pos[1], input.pos[2]],
      };
      if (s.claim !== null) hb.claim = { slot: s.claim.slot, rank: s.slot };
      s.seq += 1;
      outbox.push(hb);
    }
    // Score gossip (section 9): a scheduled send always fires.
    if (s.scoreSendAt !== null && now >= s.scoreSendAt) {
      const msg: ScoreMsg = { type: 'SCORE', from: s.id, seq: s.seq, sentTick: now, score: copyJson(s.score) };
      s.seq += 1;
      outbox.push(msg);
      s.lastScoreSent = now;
      s.scoreSendAt = null;
    }

    // 6. Move and light (section 10). The slot may have changed in steps 3 and 4: fly to the one I hold now.
    const mine = slots[s.slot];
    const accel = steer(input.pos, input.vel, steerTarget(s.id, input.pos, mine.pos, p), input.sensed, p);
    return { accel, colour: [mine.colour[0], mine.colour[1], mine.colour[2]], outbox };
  },

  belief(s: EncoreState): Belief {
    // Where I am flying: my slot of the movement that was current at my last step (at tick 0 before the first).
    const pos = expandRecipe(s.score.movements[s.mvIndex].recipe, s.n0, s.params).slots[s.slot].pos;
    let peersKnown = 0;
    for (let id = 0; id < s.peers.length; id++) {
      const peer = s.peers[id];
      if (peer !== null && s.now - peer.heard < s.params.tSuspect) peersKnown++;
    }
    return {
      slot: s.slot,
      heldSince: s.heldSince,
      target: [pos[0], pos[1], pos[2]],
      version: { issuedTick: s.score.version.issuedTick, origin: s.score.version.origin },
      deaf: s.now - s.lastRx > s.params.tDeaf,
      canHeal: s.canHeal,
      claiming: s.claim === null ? null : s.claim.slot,
      peersKnown,
      log: s.log.slice(-LOG_MAX),
    };
  },
};
