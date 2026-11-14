// src/agent/staticBrain.ts
// The static baseline brain (docs/design/contracts-and-algorithms.md, section 11): a pre-uploaded show.
// It keeps its launch slot for ever and flies that slot of whatever movement of the PRELOADED score is
// current, with the same steering as the Encore brain. It sends nothing and never reads its inbox, so an
// injected score has no effect on it. It does not freeze or degrade under jamming or failures.
// Imports only the contracts, the score package and ./steer. No module-level state.
import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Params, Score, Slot, Vec3 } from '../contracts';
import { currentMovement, expandRecipe } from '../score';
import { steer, steerTarget } from './steer';

/** Plain JSON, as the contract requires of every brain state. */
export interface StaticState {
  id: number;
  n0: number;
  slot: number;          // = initialSlot. Never changes
  score: Score;          // the preloaded score. Never changes
  params: Params;
  lastTarget: Vec3;      // the slot position flown at the last step (before the first step: at tick 0)
}

/** A deep copy of plain JSON data, so the state shares no object with what the caller passed in. */
function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Slot `s.slot` of the formation that is current at `tick`. The formation is shared and frozen: copy, never edit. */
function slotAt(s: StaticState, tick: number): Slot {
  return expandRecipe(currentMovement(s.score, tick).movement.recipe, s.n0, s.params).slots[s.slot];
}

export const staticBrain: AgentBrain<StaticState> = {
  kind: 'static',

  init(init: AgentInit): StaticState {
    const { id, n0, initialSlot } = init;
    if (!Number.isInteger(initialSlot) || initialSlot < 0 || initialSlot >= n0) {
      throw new RangeError(`staticBrain: initialSlot must be an integer in 0..${n0 - 1}, got ${initialSlot}`);
    }
    const state: StaticState = {
      id,
      n0,
      slot: initialSlot,
      score: copyJson(init.score),
      params: copyJson(init.params),
      lastTarget: [0, 0, 0],
    };
    const pos = slotAt(state, 0).pos;
    state.lastTarget = [pos[0], pos[1], pos[2]];
    return state;
  },

  step(s: StaticState, input: AgentInput): AgentOutput {
    // input.inbox is deliberately never read.
    const slot = slotAt(s, input.tick);
    const target: Vec3 = [slot.pos[0], slot.pos[1], slot.pos[2]];
    s.lastTarget = target;
    const accel = steer(input.pos, input.vel, steerTarget(s.id, input.pos, target, s.params), input.sensed, s.params);
    return { accel, colour: [slot.colour[0], slot.colour[1], slot.colour[2]], outbox: [] };
  },

  belief(s: StaticState): Belief {
    return {
      slot: s.slot,
      heldSince: 0,
      target: [s.lastTarget[0], s.lastTarget[1], s.lastTarget[2]],
      version: { issuedTick: s.score.version.issuedTick, origin: s.score.version.origin },
      deaf: false,
      canHeal: false,
      claiming: null,
      peersKnown: 0,
      log: [],
    };
  },
};
