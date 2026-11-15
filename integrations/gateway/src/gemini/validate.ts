// integrations/gateway/src/gemini/validate.ts
// The `gemini` module's server-side scene validation (spec §10.2, GF-WP-12): the module's ONE bridge into the app's
// pure code (XI-2), importing only `src/score/generated/` by relative path. Every other gemini file imports from here.
//
// For each model scene: GF-WP-01's `validateScene` (V1–V10 as implemented there, on the canonical scene), the
// requested mode, the trial compile hook, then GF-WP-02's `sceneHash`, recomputed here and never taken from the model.
// The app re-validates and re-hashes anyway (CR-26); this only stops bad scenes earlier.
import { sceneHash } from '../../../../src/score/generated/hashing.ts';
import type { SceneSpec } from '../../../../src/score/generated/types.ts';
import { validateScene } from '../../../../src/score/generated/validation.ts';
import type { FormationMode, SceneCheck, SceneValidator } from './types.ts';

export type { SceneSpec };

/** The app's smallest and largest supported n0 (spec §10.2, XI-17; rosters 100, 150, 200 at c697f6c). */
export const TRIAL_COMPILE_N0: readonly number[] = Object.freeze([100, 200]);

/** False until GF-WP-06 (#212) replaces `trialCompileHook`. Reported in the module's health entry. */
export const TRIAL_COMPILE_AVAILABLE = false;

export type TrialCompile =
  | { readonly status: 'compiled' }
  | { readonly status: 'rejected'; readonly n0: number; readonly code: string; readonly path: string }
  | { readonly status: 'not-yet-compiled' };

/**
 * HOOK: GF-WP-06 (#212) trial compile. NOT IMPLEMENTED: the compiler is not on this branch.
 * It always answers `not-yet-compiled`; it never claims a scene compiled, and never rejects one. Replace its body
 * with `compileGeneratedScene` at each of `n0s` once #212 lands (GF-T33 (9) is pending until then).
 */
export function trialCompileHook(_scene: SceneSpec, _n0s: readonly number[]): TrialCompile {
  return { status: 'not-yet-compiled' };
}

/** The real validator: shared pure code only. `compile` is injectable so GF-T33 (9) can be tested now. */
export function createSceneValidator(compile: (scene: SceneSpec, n0s: readonly number[]) => TrialCompile = trialCompileHook): SceneValidator {
  return {
    validate(candidate: unknown, mode: FormationMode): SceneCheck {
      const result = validateScene(candidate);
      if (!result.ok) return { ok: false, issues: result.errors.map(e => ({ path: e.path, code: e.code })) };
      if (result.scene.mode !== mode) return { ok: false, issues: [{ path: '/mode', code: 'schema' }] };
      const compiled = compile(result.scene, TRIAL_COMPILE_N0);
      if (compiled.status === 'rejected') return { ok: false, issues: [{ path: compiled.path, code: compiled.code }] };
      return { ok: true, scene: result.scene, sceneHash: sceneHash(result.scene), trialCompile: compiled.status };
    },
  };
}
