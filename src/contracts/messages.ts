// src/contracts/messages.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 3). Change only through a [contract] PR.
// Two message types. Both are one-hop broadcasts: the radio medium never relays, and brains never re-flood.
import type { Vec3 } from './params';
import type { Score, ScoreVersion } from './score';

export interface Heartbeat {
  type: 'HB';
  from: number; seq: number; sentTick: number;
  slot: number;              // the slot I hold
  heldSince: number;         // tick at which I took it (0 for the launch slot)
  version: ScoreVersion;     // the score I am flying
  pos: Vec3;                 // my position when sent
  claim?: { slot: number; rank: number };   // present while I am claiming: target slot, and my current slot as the bid
}
export interface ScoreMsg {
  type: 'SCORE';
  from: number;              // a drone id, or OPERATOR for the uplink
  seq: number; sentTick: number;
  score: Score;              // the whole score; it is small
}
export type Message = Heartbeat | ScoreMsg;
