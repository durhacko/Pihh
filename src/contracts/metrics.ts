// src/contracts/metrics.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 5). Change only through a [contract] PR.
import type { Formation, Score } from './score';
import type { EnvEvent, WorldSnapshot } from './world';

export interface MetricsSample {       // one per 5 ticks, per world
  tick: number; alive: number;
  coverage: number;                    // occupied slots / n0
  pwc: number; npwc: number;           // priority-weighted coverage, and normalised by what M survivors could reach
  sfMean: number; sfMax: number;       // shape fidelity, metres (label-independent)
  dupSlots: number;                    // slots claimed by 2+ live drones
  versions: Record<string, number>;    // "issuedTick:origin" -> live drones believing it
  msgs: { hb: number; score: number; delivered: number; lost: number; blocked: number };   // cumulative
  collisions: number; nearMisses: number; slotChanges: number;                               // cumulative
}
export interface RunRecord {
  v: 1; git: string; paramsHash: string;
  scenario: string; arm: 'encore' | 'static'; seed: number; n0: number;
  events: EnvEvent[];
  series: MetricsSample[];
  summary: Record<string, number | null>;   // keys defined in the evaluation doc
  stateHash: string;
}

// src/observer exports (one observer per world)
export type SlotStatus = 'occupied' | 'inTransit' | 'vacant' | 'contested';
export interface Observer {
  registerScore(score: Score): void;                     // call for the preloaded score and for every score scheduled with INJECT_SCORE
  sample(snapshot: WorldSnapshot): MetricsSample | null; // call every tick; returns a sample every 5 ticks
  slotStatus(snapshot: WorldSnapshot): { formation: Formation; inHold: boolean; status: SlotStatus[] };   // the reference formation at this tick, and each slot's status by index
  summary(): Record<string, number | null>;
}
// createObserver(params: Params): Observer
