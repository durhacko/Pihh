// PROTOTYPE FIXTURE — not the Encore brain (#16).
// A compact reading of contract §8.3 (healing by local claims) and §9 (score gossip), written only so the
// prototype has real HB/SCORE traffic, beliefs, claims and version divergence to display. It implements the
// real AgentBrain interface and uses the real steer() and expandRecipe(), so the UI never touches anything
// the production brain will not also provide. Replace with src/agent's encoreBrain when it lands.
import { OPERATOR } from '@encore/contracts';
import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Heartbeat, Message, Params, Score, ScoreVersion, Vec3 } from '@encore/contracts';
import { currentMovement, expandRecipe, newerVersion } from '@encore/score';
import { steer, steerTarget } from '@encore/agent/steer';

interface Peer { slot: number; heldSince: number; version: ScoreVersion; claim: { slot: number; rank: number } | null; heard: number }
export interface FixtureEncoreState {
  id: number; n0: number; params: Params;
  slot: number; heldSince: number;
  history: { slot: number; heldSince: number }[];
  score: Score; mvIndex: number;
  lastTargetChange: number; settledSince: number | null;
  lastRx: number; lastMismatch: number;
  peers: (Peer | null)[];
  slotHeard: number[];
  emptySince: Record<string, number>;
  claim: { slot: number; start: number } | null;
  yieldSince: number | null;
  scoreSendAt: number | null; lastScoreSent: number;
  seq: number; rng: number; now: number; target: Vec3;
  log: string[];
}

const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function nextRand(s: FixtureEncoreState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let x = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function log(s: FixtureEncoreState, text: string) {
  s.log.push(`t=${s.now} ${text}`);
  if (s.log.length > 20) s.log.shift();
}
function targetChanged(s: FixtureEncoreState) {
  s.lastTargetChange = s.now; s.settledSince = null; s.yieldSince = null; s.emptySince = {};
}
function scheduleScoreSend(s: FixtureEncoreState) {
  if (s.scoreSendAt !== null) return;
  s.scoreSendAt = Math.max(s.now + 1 + Math.floor(nextRand(s) * s.params.scoreJitter), s.lastScoreSent + s.params.scoreResendMin);
}
function popHistory(s: FixtureEncoreState, why: string) {
  const prev = s.history.pop();
  if (!prev) { log(s, `keep launch slot ${s.slot} (${why})`); return; }
  log(s, `return to slot ${prev.slot} from ${s.slot}: ${why}`);
  s.slot = prev.slot; s.heldSince = prev.heldSince; s.claim = null; targetChanged(s);
}
function commit(s: FixtureEncoreState, v: number) {
  s.history.push({ slot: s.slot, heldSince: s.heldSince });
  if (s.history.length > s.params.historyMax) s.history.splice(1, 1);
  log(s, `commit slot ${v} (was ${s.slot})`);
  s.slot = v; s.heldSince = s.now; s.claim = null; targetChanged(s);
}
const better = (rankA: number, idA: number, rankB: number, idB: number) => rankA > rankB || (rankA === rankB && idA < idB);

function canHeal(s: FixtureEncoreState, holdStart: number): boolean {
  const p = s.params;
  return s.now >= holdStart + p.holdGrace
    && s.now - s.lastTargetChange >= p.tStable
    && s.settledSince !== null && s.now - s.settledSince >= p.tSettle
    && s.now - s.lastMismatch >= p.tDeaf
    && s.now - s.lastRx < p.tDeaf;
}

export const fixtureEncoreBrain: AgentBrain<FixtureEncoreState> = {
  kind: 'encore',
  init(init: AgentInit): FixtureEncoreState {
    const { id, n0, params } = init;
    return {
      id, n0, params: JSON.parse(JSON.stringify(params)) as Params,
      slot: init.initialSlot, heldSince: 0, history: [],
      score: JSON.parse(JSON.stringify(init.score)) as Score, mvIndex: 0,
      lastTargetChange: 0, settledSince: null, lastRx: 0, lastMismatch: -1e9,
      peers: Array.from({ length: n0 }, () => null), slotHeard: Array.from({ length: n0 }, () => 0),
      emptySince: {}, claim: null, yieldSince: null, scoreSendAt: null, lastScoreSent: -params.scoreResendMin,
      seq: 0, rng: init.seed >>> 0, now: 0, target: [0, 0, 0], log: [],
    };
  },
  step(s: FixtureEncoreState, input: AgentInput): AgentOutput {
    const now = input.tick; s.now = now;
    const p = s.params;
    // 1. Inbox
    for (const m of input.inbox as readonly Message[]) {
      if (m.from !== OPERATOR) s.lastRx = now;
      if (m.type === 'SCORE') {
        if (newerVersion(m.score.version, s.score.version)) {
          s.score = JSON.parse(JSON.stringify(m.score)) as Score;
          s.mvIndex = currentMovement(s.score, now).index;
          log(s, `adopt score ${m.score.version.issuedTick}:${m.score.version.origin} from ${m.from === OPERATOR ? 'uplink' : m.from}`);
          targetChanged(s); scheduleScoreSend(s);
        }
        continue;
      }
      s.peers[m.from] = { slot: m.slot, heldSince: m.heldSince, version: m.version, claim: m.claim ?? null, heard: now };
      s.slotHeard[m.slot] = now;
      if (m.version.issuedTick !== s.score.version.issuedTick || m.version.origin !== s.score.version.origin) s.lastMismatch = now;
      if (newerVersion(s.score.version, m.version)) scheduleScoreSend(s);
      if (m.slot === s.slot && (m.heldSince < s.heldSince || (m.heldSince === s.heldSince && m.from < s.id))) popHistory(s, `lost duplicate to ${m.from}`);
      if (s.claim && m.claim && m.claim.slot === s.claim.slot && better(m.claim.rank, m.from, s.slot, s.id)) {
        log(s, `drop claim on ${s.claim.slot}: better bid from ${m.from}`); s.claim = null;
      }
    }
    // 2. Target
    const mv = currentMovement(s.score, now);
    if (mv.index !== s.mvIndex) { s.mvIndex = mv.index; targetChanged(s); }
    const formation = expandRecipe(mv.movement.recipe, s.n0, p);
    const slot = formation.slots[s.slot];
    const target = slot.pos as Vec3;
    s.target = [target[0], target[1], target[2]];
    const atSlot = d2(input.pos, target) < p.rOcc ** 2;
    const speed2 = input.vel[0] ** 2 + input.vel[1] ** 2 + input.vel[2] ** 2;
    if (atSlot && speed2 < 0.25) s.settledSince ??= now; else s.settledSince = null;
    const sensedAt = (pos: Vec3) => input.sensed.some(o => d2([input.pos[0] + o.rel[0], input.pos[1] + o.rel[1], input.pos[2] + o.rel[2]], pos) < p.rOcc ** 2);
    // 3. Physical yield
    if (mv.inHold && s.history.length > 0 && !atSlot) {
      s.yieldSince = sensedAt(target) ? (s.yieldSince ?? now) : null;
      if (s.yieldSince !== null && now - s.yieldSince >= p.yieldTicks) popHistory(s, 'slot already occupied');
    }
    // 4. Scan and claim
    const scanTick = now % p.hbPeriod === s.id % p.hbPeriod;
    if (scanTick) {
      if (!canHeal(s, mv.holdStart)) { s.emptySince = {}; s.claim = null; }
      else {
        for (const sl of formation.slots) {
          if (sl.index === s.slot) continue;
          if (d2(sl.pos as Vec3, input.pos) > p.rClaim ** 2) { delete s.emptySince[sl.index]; continue; }
          if (sensedAt(sl.pos as Vec3)) delete s.emptySince[sl.index]; else s.emptySince[sl.index] ??= now;
        }
        const vacant = (v: number) => s.emptySince[v] !== undefined && now - s.emptySince[v] >= p.tVacant && now - s.slotHeard[v] >= p.tSuspect;
        let committed = false;
        if (s.claim) {
          if (!vacant(s.claim.slot)) s.claim = null;
          else if (now - s.claim.start >= p.claimWindow) { commit(s, s.claim.slot); committed = true; }
        }
        if (!s.claim && !committed) {
          let best: number | null = null;
          for (const key of Object.keys(s.emptySince)) {
            const v = Number(key);
            if (!vacant(v) || v + p.claimGap >= s.slot) continue;
            const beaten = s.peers.some((peer, from) => peer && now - peer.heard <= p.claimWindow && peer.claim?.slot === v && better(peer.claim.rank, from, s.slot, s.id));
            if (!beaten && (best === null || v < best)) best = v;
          }
          if (best !== null) { s.claim = { slot: best, start: now }; log(s, `claim slot ${best} (bid ${s.slot})`); }
        }
      }
    }
    // 5. Send
    const outbox: Message[] = [];
    if (scanTick) {
      const hb: Heartbeat = { type: 'HB', from: s.id, seq: s.seq++, sentTick: now, slot: s.slot, heldSince: s.heldSince, version: { ...s.score.version }, pos: [input.pos[0], input.pos[1], input.pos[2]] };
      if (s.claim) hb.claim = { slot: s.claim.slot, rank: s.slot };
      outbox.push(hb);
    }
    if (s.scoreSendAt !== null && now >= s.scoreSendAt) {
      outbox.push({ type: 'SCORE', from: s.id, seq: s.seq++, sentTick: now, score: JSON.parse(JSON.stringify(s.score)) as Score });
      s.lastScoreSent = now; s.scoreSendAt = null;
    }
    // 6. Move and light (shared steering, contract §10)
    const finalSlot = formation.slots[s.slot];
    const accel = steer(input.pos, input.vel, steerTarget(s.id, input.pos, finalSlot.pos as Vec3, p), input.sensed, p);
    return { accel, colour: [finalSlot.colour[0], finalSlot.colour[1], finalSlot.colour[2]], outbox };
  },
  belief(s: FixtureEncoreState): Belief {
    const p = s.params;
    const holdStart = currentMovement(s.score, s.now).holdStart;
    return {
      slot: s.slot, heldSince: s.heldSince, target: [s.target[0], s.target[1], s.target[2]],
      version: { ...s.score.version },
      deaf: s.now - s.lastRx >= p.tDeaf && s.now > p.tDeaf,
      canHeal: canHeal(s, holdStart),
      claiming: s.claim?.slot ?? null,
      peersKnown: s.peers.reduce((n, peer) => n + (peer && s.now - peer.heard < p.tSuspect ? 1 : 0), 0),
      log: s.log.slice(),
    };
  },
};
