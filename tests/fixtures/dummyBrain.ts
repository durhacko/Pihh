// tests/fixtures/dummyBrain.ts
// A minimal AgentBrain for building the world, the radio medium and the inspector before the real brains exist.
// It flies to a fixed point 20 m above its launch position and sends one heartbeat every hbPeriod ticks.
// It never claims, never heals and never changes slot. It imports only from src/contracts.
import { OPERATOR } from '../../src/contracts';
import type {
  AgentBrain,
  AgentInit,
  AgentInput,
  AgentOutput,
  Belief,
  Heartbeat,
  Params,
  RGB,
  ScoreVersion,
  Vec3,
} from '../../src/contracts';

/** Plain JSON, as the contract requires of every brain state. */
export interface DummyState {
  id: number;
  n0: number;
  params: Params;
  slot: number;
  version: ScoreVersion;
  target: Vec3 | null;        // launch position + CLIMB, fixed on the first step (AgentInit carries no position)
  tick: number;               // last tick stepped
  lastRx: number;             // tick of the last radio message from another drone
  heard: (number | null)[];   // by id: last tick a heartbeat from that drone was heard
  seq: number;                // message counter
  log: string[];
}

const CLIMB = 20;             // metres above the launch position
const KP = 2;                 // position gain, 1/s^2
const KV = 3;                 // velocity damping, 1/s
const COLOUR: RGB = [0.2, 0.6, 1];
const LOG_MAX = 20;

function pushLog(s: DummyState, line: string): void {
  s.log.push(line);
  if (s.log.length > LOG_MAX) s.log.shift();
}

export const dummyBrain: AgentBrain<DummyState> = {
  kind: 'static',

  init(init: AgentInit): DummyState {
    const heard: (number | null)[] = [];
    for (let i = 0; i < init.n0; i++) heard.push(null);
    return {
      id: init.id,
      n0: init.n0,
      params: { ...init.params },
      slot: init.initialSlot,
      version: { issuedTick: init.score.version.issuedTick, origin: init.score.version.origin },
      target: null,
      tick: 0,
      lastRx: 0,
      heard,
      seq: 0,
      log: [],
    };
  },

  step(s: DummyState, input: AgentInput): AgentOutput {
    const now = input.tick;
    s.tick = now;

    // Inbox: remember who was heard. Nothing else is acted on.
    for (const m of input.inbox) {
      if (m.from === OPERATOR) continue;
      s.lastRx = now;
      if (m.type === 'HB' && m.from >= 0 && m.from < s.n0) s.heard[m.from] = now;
    }

    // Target: fixed on the first step, 20 m above where the drone then is.
    if (s.target === null) {
      s.target = [input.pos[0], input.pos[1] + CLIMB, input.pos[2]];
      pushLog(s, `t=${now} target set ${CLIMB} m above launch`);
    }
    const target = s.target;

    // Proportional controller with velocity damping. The world clamps the result.
    const accel: Vec3 = [
      KP * (target[0] - input.pos[0]) - KV * input.vel[0],
      KP * (target[1] - input.pos[1]) - KV * input.vel[1],
      KP * (target[2] - input.pos[2]) - KV * input.vel[2],
    ];

    // One heartbeat every hbPeriod ticks, staggered by id.
    const outbox: Heartbeat[] = [];
    const period = s.params.hbPeriod;
    if (now % period === s.id % period) {
      outbox.push({
        type: 'HB',
        from: s.id,
        seq: s.seq,
        sentTick: now,
        slot: s.slot,
        heldSince: 0,
        version: { issuedTick: s.version.issuedTick, origin: s.version.origin },
        pos: [input.pos[0], input.pos[1], input.pos[2]],
      });
      s.seq += 1;
    }

    return { accel, colour: [COLOUR[0], COLOUR[1], COLOUR[2]], outbox };
  },

  belief(s: DummyState): Belief {
    let peersKnown = 0;
    for (const h of s.heard) {
      if (h !== null && s.tick - h < s.params.tSuspect) peersKnown += 1;
    }
    const target: Vec3 = s.target === null ? [0, CLIMB, 0] : [s.target[0], s.target[1], s.target[2]];
    return {
      slot: s.slot,
      heldSince: 0,
      target,
      version: { issuedTick: s.version.issuedTick, origin: s.version.origin },
      deaf: s.tick - s.lastRx >= s.params.tDeaf,
      canHeal: false,
      claiming: null,
      peersKnown,
      log: s.log.slice(),
    };
  },
};
