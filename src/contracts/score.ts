// src/contracts/score.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 2). Change only through a [contract] PR.
import type { RGB, Vec3 } from './params';

export interface ScoreVersion { issuedTick: number; origin: number }   // origin = drone that received the uplink; preloaded score = {0, OPERATOR}

export type Recipe =
  | { kind: 'text'; text: string; palette?: [RGB, RGB] }      // 5x7 bitmap font, A-Z 0-9 space
  | { kind: 'sphere'; palette?: [RGB, RGB] }
  | { kind: 'helix'; palette?: [RGB, RGB] };                  // double helix

// All three recipe kinds are MUST: the show needs typed text and two parametric 3D shapes.
export interface Movement {
  startTick: number;        // show clock tick at which drones start flying to this formation
  transitionTicks: number;  // hold begins at startTick + transitionTicks
  recipe: Recipe;
}
export interface Score { version: ScoreVersion; movements: Movement[] }   // sorted by startTick, first has startTick 0 or earlier than now

export interface Slot { index: number; pos: Vec3; colour: RGB }           // index 0 = most important
export interface Formation {
  slots: Slot[];            // exactly n0, priority order
  dense: Vec3[];            // the dense target shape (about 2000 points), for label-independent metrics
  bounds: { min: Vec3; max: Vec3 };
}
