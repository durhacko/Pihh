// src/agent/state.ts
// The Encore brain's private state (docs/design/contracts-and-algorithms.md, section 7) and its seeded
// random stream. Not a contract: owned by the agent package. The inspector shows it as a JSON tree.
// Everything here is plain JSON data: arrays indexed by drone id or by slot, no Map, no typed array,
// no undefined, no Infinity. Imports only the contracts.
import type { Params, Score, ScoreVersion } from '../contracts';

/** A slot a drone holds or held, and the tick at which it took it (0 for the launch slot). */
export interface HeldSlot { slot: number; heldSince: number }

/** What the last heartbeat heard from one drone said. Last-known only: it permits nothing (section 8.1). */
export interface PeerEntry {
  slot: number;
  heldSince: number;
  version: ScoreVersion;
  claim: { slot: number; rank: number } | null;
  heard: number;                // tick at which I heard it
}

export interface EncoreState {
  id: number; n0: number; params: Params;
  slot: number; heldSince: number;
  history: HeldSlot[];          // previous slots, most recent last; the launch slot is the home
  score: Score; mvIndex: number;
  lastTargetChange: number;     // tick my slot or formation last changed
  settledSince: number | null;  // since when I have been within rOcc of my slot and slow
  lastRx: number;               // tick of the last radio message from another drone (NEVER_HEARD before the first)
  peers: (PeerEntry | null)[];  // by drone id
  slotHeard: number[];          // by slot: last tick I heard a heartbeat holding it (init 0)
  emptySince: (number | null)[];// by slot: since when I have sensed it empty (null = not empty / not watched)
  claim: { slot: number; start: number } | null;
  yieldSince: number | null;    // since when I have sensed another drone on the slot I am flying to
  scoreSendAt: number | null; lastScoreSent: number;   // score gossip (section 9): unused until issue #21
  seq: number; rng: number;     // message counter; seeded PRNG state (a uint32)
  log: string[];                // my last decisions, oldest first, at most 20

  // The two fields below are not in section 7. belief(state) gets no tick and no input, so the state
  // itself has to remember what belief() reports about "now". Neither is read by any decision.
  now: number;                  // tick of my last step (0 before the first)
  canHeal: boolean;             // canHeal as last evaluated, on my last scan tick (false before the first)

  // GF-CC-02 (section 9, "Adopt"): scores I refused, as (version, sceneHash), oldest first, at most 8. ABSENT until
  // the first refusal, so JSON.stringify omits it and the stateHash of every run without a generated recipe is
  // unchanged.
  refused?: { version: ScoreVersion; sceneHash: string }[];
}

/** "Never heard anybody": stands in for minus infinity, which JSON cannot carry. */
export const NEVER_HEARD = -1_000_000_000;

/**
 * One step of the seeded stream (mulberry32). Advances `state.rng` and returns a uint32.
 * The only source of randomness a brain may use. Its first user is the score gossip jitter of issue #21.
 */
export function nextRandom(state: { rng: number }): number {
  const a = (state.rng + 0x6d2b79f5) >>> 0;
  state.rng = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
