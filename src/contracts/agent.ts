// src/contracts/agent.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 4). Change only through a [contract] PR.
import type { Message } from './messages';
import type { Params, RGB, Vec3 } from './params';
import type { Score, ScoreVersion } from './score';

export interface Sensed { rel: Vec3; vel: Vec3 }   // relative position and relative velocity. Anonymous: no id, no slot

export interface AgentInput {
  tick: number;                    // synced show clock (assumption AS-01)
  pos: Vec3; vel: Vec3;            // own body
  inbox: readonly Message[];       // delivered this tick, sorted by (sentTick, from, seq)
  sensed: readonly Sensed[];       // live drones within rSense
}
export interface AgentOutput {
  accel: Vec3;                     // desired acceleration; the world clamps it
  colour: RGB;                     // light
  outbox: Message[];               // broadcasts to send this tick
}
export interface AgentInit {
  id: number; n0: number; initialSlot: number;   // preloaded launch roster entry
  score: Score;                                   // preloaded score
  params: Params;
  seed: number;                                   // per-agent RNG seed = hash(runSeed, id)
}
/** What a brain believes. Read by the observer, renderer and inspector only. Never fed to another brain. */
export interface Belief {
  slot: number; heldSince: number;
  target: Vec3;                    // where I am flying: slot `slot` of my own score's current movement
  version: ScoreVersion;
  deaf: boolean;
  canHeal: boolean;
  claiming: number | null;
  peersKnown: number;              // peer-table entries heard within tSuspect
  log: string[];                   // last <= 20 decisions, e.g. "t=812 commit slot 14 (was 163)"
}
export interface AgentBrain<S = unknown> {
  kind: 'encore' | 'static';
  init(init: AgentInit): S;                        // S must be plain JSON data
  step(state: S, input: AgentInput): AgentOutput;  // may mutate and keep `state`; must not keep `input`
  belief(state: S): Belief;
}
