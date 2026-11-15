// src/cli/generated.ts: run provenance and replay for generated scenes (GF-WP-11, #214; spec gemini-generated-formations.md
// §6.7, §7.1, §8.2; work package gemini-integration-work-packages.md §GF-WP-11).
//
// PURE: imports only src/contracts and src/score/generated. No Node built-ins, DOM, clock, randomness or network, so
// the app (the Composer's accept → inject path) and the CLI share it. No model is ever called: a replay re-derives
// the formation from the stored scene and its provenance alone (William: "replay doesn't depend on Gemini returning
// the same content").
//
// - GeneratedProvenance: what a run records about one generated scene: the scene's content hash, the compiler
//   version, the slots digest at the n0 and slotSpacingMin it was compiled for, and where the scene came from
//   ('fixture' = a committed scene file; 'live' = the optional gateway, X-RUN/live).
// - replayFromProvenance: re-validates and re-hashes the scene, refuses another compiler version, recompiles at the
//   provenance's own n0 and slotSpacingMin and compares the digest. It returns the re-derived formation, or a typed
//   refusal; it never returns a substitute formation.
// - injectPreflight: the same checks at the operator's own n0 and slotSpacingMin, run immediately before an
//   injection (GF-WP-11 step 1, defence in depth on top of the strict compile path).
import { COMPILER_VERSION, compileGeneratedScene, sceneHash, slotsDigest, validateScene, type CompileResult, type GeneratedFormation, type SceneSpec } from '../score/generated';

/** Where a generated scene came from. */
export type ProvenanceSource = 'fixture' | 'live';

/** One generated scene as a run records it. All fields are plain JSON data. */
export interface GeneratedProvenance {
  sceneHash: string;           // 64 lower-case hex: sha256 of the canonical scene (§6.7), recomputed, never trusted
  compilerVersion: number;     // COMPILER_VERSION that produced slotsDigest
  slotsDigest: string;         // 64 lower-case hex over [index, pos, colour] at (n0, slotSpacingMin) (§7.1, §8.2)
  n0: number;
  slotSpacingMin: number;
  title: string;               // scene.title, for reports; never used as identity
  source: ProvenanceSource;
  fixture?: string;            // the fixture id or file, when source is 'fixture'
}

/** The parameters a compile depends on (a full Params is accepted). */
export interface ProvenanceParams { n0: number; slotSpacingMin: number; rClaim?: number; claimGap?: number }

export type ReplayRefusal = 'scene-invalid' | 'hash-mismatch' | 'compiler-mismatch' | 'rejected' | 'digest-mismatch' | 'provenance-invalid';
export type ReplayResult =
  | { ok: true; formation: GeneratedFormation; provenance: GeneratedProvenance }
  | { ok: false; reason: ReplayRefusal; detail: string };

const HEX64 = /^[0-9a-f]{64}$/;

/** The provenance of one successful compile, or null for a rejected one (a rejection is never recorded as a scene). */
export function provenanceFromCompile(scene: SceneSpec, result: CompileResult, params: ProvenanceParams, source: ProvenanceSource, fixture?: string): GeneratedProvenance | null {
  if (!result.ok) return null;
  return {
    sceneHash: result.sceneHash, compilerVersion: result.compilerVersion, slotsDigest: result.slotsDigest,
    n0: params.n0, slotSpacingMin: params.slotSpacingMin, title: scene.title, source,
    ...(source === 'fixture' && fixture !== undefined ? { fixture } : {}),
  };
}

/** Compiles a scene and records its provenance in one step. A rejected compile gives the typed rejection. */
export function compileWithProvenance(scene: SceneSpec, params: ProvenanceParams, source: ProvenanceSource, fixture?: string):
  { ok: true; formation: GeneratedFormation; provenance: GeneratedProvenance } | { ok: false; reason: 'rejected'; detail: string } {
  const result = compileGeneratedScene(scene, params, params.n0);
  const provenance = provenanceFromCompile(scene, result, params, source, fixture);
  if (!result.ok || !provenance) return { ok: false, reason: 'rejected', detail: result.ok ? 'no provenance' : `${result.code}: ${result.detail}` };
  return { ok: true, formation: result.formation, provenance };
}

/** Shape check of a provenance record read back from a file or a report (it is data, not trusted). */
export function isProvenance(value: unknown): value is GeneratedProvenance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.sceneHash === 'string' && HEX64.test(p.sceneHash) && Number.isInteger(p.compilerVersion)
    && typeof p.slotsDigest === 'string' && HEX64.test(p.slotsDigest) && Number.isInteger(p.n0) && (p.n0 as number) >= 1
    && typeof p.slotSpacingMin === 'number' && Number.isFinite(p.slotSpacingMin) && (p.slotSpacingMin as number) > 0
    && typeof p.title === 'string' && (p.source === 'fixture' || p.source === 'live')
    && (p.fixture === undefined || typeof p.fixture === 'string');
}

/**
 * Re-derives the formation a run flew from the stored scene and its provenance alone (no model call). The scene is
 * re-validated and re-hashed; the compiler version must be this build's; the compile at the provenance's own n0 and
 * slotSpacingMin must reproduce slotsDigest exactly.
 */
export function replayFromProvenance(scene: unknown, provenance: unknown): ReplayResult {
  if (!isProvenance(provenance)) return { ok: false, reason: 'provenance-invalid', detail: 'not a provenance record' };
  return check(scene, provenance, { n0: provenance.n0, slotSpacingMin: provenance.slotSpacingMin });
}

/**
 * The defence-in-depth check immediately before injecting a generated scene (GF-WP-11 step 1): the same checks at
 * the operator's own n0 and slotSpacingMin. When those equal the provenance's, the digest must match; otherwise the
 * scene must still hash and compile, and the returned provenance is the one for this page's parameters.
 */
export function injectPreflight(scene: unknown, provenance: unknown, params: ProvenanceParams): ReplayResult {
  if (!isProvenance(provenance)) return { ok: false, reason: 'provenance-invalid', detail: 'not a provenance record' };
  return check(scene, provenance, params);
}

function check(scene: unknown, p: GeneratedProvenance, params: ProvenanceParams): ReplayResult {
  const valid = validateScene(scene);
  if (!valid.ok) return { ok: false, reason: 'scene-invalid', detail: valid.errors.slice(0, 3).map(e => `${e.code} at ${e.path}`).join('; ') };
  let hash: string;
  try { hash = sceneHash(valid.scene); } catch (e) { return { ok: false, reason: 'scene-invalid', detail: e instanceof Error ? e.message : String(e) }; }
  if (hash !== p.sceneHash) return { ok: false, reason: 'hash-mismatch', detail: `the scene hashes to ${hash.slice(0, 12)}…, the provenance says ${p.sceneHash.slice(0, 12)}…` };
  if (p.compilerVersion !== COMPILER_VERSION) return { ok: false, reason: 'compiler-mismatch', detail: `recorded with compiler v${p.compilerVersion}, this build is v${COMPILER_VERSION}` };
  const result = compileGeneratedScene(valid.scene, params, params.n0);
  if (!result.ok) return { ok: false, reason: 'rejected', detail: `${result.code}: ${result.detail}` };
  const sameParams = params.n0 === p.n0 && params.slotSpacingMin === p.slotSpacingMin;
  const digest = slotsDigest(result.formation, params.n0, params.slotSpacingMin);
  if (digest !== result.slotsDigest) return { ok: false, reason: 'digest-mismatch', detail: 'the compiler reported a digest that its own formation does not reproduce' };
  if (sameParams && digest !== p.slotsDigest) return { ok: false, reason: 'digest-mismatch', detail: `recompiled to ${digest.slice(0, 12)}…, the provenance says ${p.slotsDigest.slice(0, 12)}…` };
  return { ok: true, formation: result.formation, provenance: sameParams ? p : { ...p, n0: params.n0, slotSpacingMin: params.slotSpacingMin, slotsDigest: digest } };
}
