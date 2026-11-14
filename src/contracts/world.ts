// src/contracts/world.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 5). Change only through a [contract] PR.
import type { AgentBrain, AgentInput, AgentOutput, Belief } from './agent';
import type { Params, RGB, Vec3 } from './params';
import type { Score } from './score';

export type EnvEvent =
  | { type: 'KILL'; tick: number; ids: number[] }
  | { type: 'JAM_ON'; tick: number; id: string; centre: Vec3; radius: number }
  | { type: 'JAM_OFF'; tick: number; id: string }
  | { type: 'PARTITION_ON'; tick: number; id: string; point: Vec3; normal: Vec3 }   // splits the swarm into two groups, fixed at this tick
  | { type: 'PARTITION_OFF'; tick: number; id: string }
  | { type: 'INJECT_SCORE'; tick: number; droneId: number; score: Score }
  | { type: 'SET_LOSS'; tick: number; loss: number };

export interface WorldConfig {
  seed: number; params: Params;
  brain: AgentBrain;               // encore or static: the only difference between the two arms
  score: Score;                    // preloaded
  events?: EnvEvent[];             // scripted; more can be scheduled live
}
export interface DroneSnap {
  id: number; alive: boolean; diedTick: number | null;
  pos: Vec3; vel: Vec3; colour: RGB;
  partitionSide: 0 | 1 | null;     // group in the oldest active partition, null if none
  belief: Belief;                  // from brain.belief(), copied
}
export interface RadioEvent {      // one per broadcast, from the medium's real log
  tick: number; from: number; type: 'HB' | 'SCORE';
  claimSlot: number | null;        // HB.claim?.slot
  delivered: number[];             // receiver ids scheduled for delivery
  lost: number; jammed: number; partitioned: number;   // in-range receivers that did not get it, by reason
}
export interface WorldSnapshot {
  tick: number;
  drones: DroneSnap[];             // all n0, index = id
  radio: RadioEvent[];             // broadcasts sent this tick
  jams: { id: string; centre: Vec3; radius: number }[];
  partitions: { id: string; point: Vec3; normal: Vec3 }[];
  collisions: [number, number][];  // pairs that entered d < dCollide this tick
  nearMisses: [number, number][];  // pairs that entered d < dNear this tick
}
export interface World {
  readonly config: WorldConfig;
  step(): WorldSnapshot;                        // advance one tick
  schedule(e: EnvEvent): void;                  // tick must be > current tick
  inspect(id: number): { input: AgentInput; output: AgentOutput; state: unknown } | null;  // that drone's last step, deep-copied. For a dead drone: its final step. null only before its first step
  stateHash(): string;                          // hash of bodies + brain states, for replay tests
}
// src/sim exports:
//   createWorld(config: WorldConfig, test?: { reverseStepOrder?: boolean; freezeInputs?: boolean }): World
//   idsInSphere(snapshot: WorldSnapshot, centre: Vec3, radius: number): number[]      // live drones, ascending id
//   randomIds(seed: number, liveIds: number[], count: number): number[]
