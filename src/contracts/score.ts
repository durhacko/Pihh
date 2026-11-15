// src/contracts/score.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 2). Change only through a [contract] PR.
import type { SceneSpec2D, SceneSpec3D } from './generatedScene';
import type { RGB, Vec3 } from './params';

export interface ScoreVersion { issuedTick: number; origin: number }   // origin = drone that received the uplink; preloaded score = {0, OPERATOR}

export type Recipe =
  | { kind: 'text'; text: string; palette?: [RGB, RGB] }      // 5x7 bitmap font, A-Z 0-9 space
  | { kind: 'sphere'; palette?: [RGB, RGB] }
  | { kind: 'helix'; palette?: [RGB, RGB] }                   // double helix
  | GeneratedRecipe;                                          // optional kind (GF-CC-01, GF-FR-01)

// text, sphere and helix are MUST: the show needs typed text and two parametric 3D shapes. `generated` is optional.

/**
 * A formation compiled from a scene (GF-CC-01, section 2; GF-CC-02, section 9). It has no `palette`: colours come
 * from the scene's materials or foreground. `sceneHash` is a checked label, never trusted and never a memo key;
 * a drone adopts a score only if every generated movement's labels match what it recomputes (section 9, "Adopt").
 */
export interface GeneratedRecipe {
  kind: 'generated';
  /** Integer; must equal the running compiler's COMPILER_VERSION. */
  compilerVersion: number;
  /** 64 lower-case hex: SHA-256 of the scene's canonical form (§6.7). */
  sceneHash: string;
  /** What the operator's compile produced for its roster (GF-CC-02). */
  slotsDigest: SlotsDigest;
  /** The canonical (validated, quantised) scene. */
  scene: SceneSpec2D | SceneSpec3D;
}

/** SHA-256 of the canonical slot list a compile produced at this n0 and slotSpacingMin (GF-CC-02). */
export interface SlotsDigest { n0: number; slotSpacingMin: number; digest: string }

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
