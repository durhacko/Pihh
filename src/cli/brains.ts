// src/cli/brains.ts
// The brain for each evaluation arm. Only `WorldConfig.brain` differs between arms (evaluation doc §4).
import type { AgentBrain, RunRecord } from '../contracts';
import { encoreBrain } from '../agent/encoreBrain';
import { staticBrain } from '../agent/staticBrain';

export type Arm = RunRecord['arm'];
export const ARMS: readonly Arm[] = ['static', 'encore'];
export type BrainMap = Partial<Record<Arm, AgentBrain>>;

export const BRAINS: BrainMap = {
  static: staticBrain,
  encore: encoreBrain,
};

export function isArm(value: string): value is Arm {
  return (ARMS as readonly string[]).includes(value);
}

/** The brain registered for `arm`, or a clear error naming what is missing. */
export function brainFor(brains: BrainMap, arm: Arm): AgentBrain {
  const brain = brains[arm];
  if (brain === undefined) {
    const hint = arm === 'encore'
      ? ' The Encore brain (#16) is not registered yet: add `encore: encoreBrain` to BRAINS in src/cli/brains.ts once it merges.'
      : '';
    throw new Error(`Arm '${arm}' has no registered brain.${hint}`);
  }
  if (brain.kind !== arm) throw new Error(`Arm '${arm}' is registered with a brain of kind '${brain.kind}'`);
  return brain;
}
