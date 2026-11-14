import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Params, ScoreVersion, Vec3 } from '../../src/contracts';

interface ProbeState {
  id: number;
  slot: number;
  params: Params;
  version: ScoreVersion;
  rng: number;
  seq: number;
  heard: number;
  target: Vec3 | null;
}

/** A test-only, radio-active brain that makes ordering and seed defects observable. */
export const probeBrain: AgentBrain<ProbeState> = {
  kind: 'encore',
  init(init: AgentInit): ProbeState {
    return {
      id: init.id, slot: init.initialSlot, params: structuredClone(init.params),
      version: structuredClone(init.score.version), rng: init.seed >>> 0,
      seq: 0, heard: 0, target: null,
    };
  },
  step(state: ProbeState, input: AgentInput): AgentOutput {
    state.target ??= [input.pos[0], 3, input.pos[2]];
    state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
    state.heard += input.inbox.length;
    const accel: Vec3 = [0, 2 * (state.target[1] - input.pos[1]) - 3 * input.vel[1], 0];
    return {
      accel,
      colour: [(state.rng & 255) / 255, (state.heard % 31) / 31, 0.5],
      outbox: input.tick % state.params.hbPeriod === state.id % state.params.hbPeriod ? [{
        type: 'HB', from: state.id, seq: state.seq++, sentTick: input.tick,
        slot: state.slot, heldSince: 0, version: structuredClone(state.version),
        pos: [...input.pos],
      }] : [],
    };
  },
  belief(state: ProbeState): Belief {
    return {
      slot: state.slot, heldSince: 0, target: state.target ? [...state.target] : [0, 3, 0],
      version: structuredClone(state.version), deaf: false, canHeal: false,
      claiming: null, peersKnown: state.heard, log: [],
    };
  },
};
