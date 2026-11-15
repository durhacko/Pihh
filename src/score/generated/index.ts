// src/score/generated/index.ts
// GF-WP-06 (#212): the public surface of the generated-scene compiler, for GF-WP-07 (recipe integration),
// GF-WP-08 (memo), GF-WP-10 (Composer preview) and the tests. Nothing outside src/score/generated imports
// it yet; expandRecipe reaches it only through GF-WP-07.
export {
  COMPILER_VERSION, compileGeneratedScene, colourWarningsFor, linearLuminance, MAX_N0, MIN_SLOT_SPACING, repairReport, repairWarnings, srgbToLinear,
  type CompileParams, type CompileResult, type CompileStats, type CompileWarning, type GeneratedFormation, type RejectCode,
  type RepairComponent, type RepairReport,
} from './compile';
export { canonicalSceneBytes, canonicalSceneJson, normaliseScene, SCENE_QUANTUM, sceneHash, sha256Hex, SLOT_QUANTUM, slotsDigest, type FormationSlots } from './hashing';
export { seededStream, sfc32 } from './prng';
export type { SceneSpec, SceneSpec2D, SceneSpec3D } from './types';
export { SCENE_LIMITS, validateScene, type SceneIssue, type SceneLimits, type SceneValidation } from './validation';
