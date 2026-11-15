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
import type { EnvEvent, Params } from '../contracts';
import { canonicalJson } from '../score/canonical';
import { COMPILER_VERSION, compileGeneratedScene, sceneHash, sha256Hex, slotsDigest, validateScene, type CompileResult, type GeneratedFormation, type SceneSpec } from '../score/generated';

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

// ------------------------------------------------------------------------------------------- event-log replay

/**
 * A deterministic replay of one run (GF-WP-11 step 3): the seed, the params it ran with (by hash) and every event the
 * operator scheduled. Each INJECT_SCORE carries its full score (and, after GF-WP-07, the full scene), so replaying
 * needs no model, gateway or database. NOT a composition: composition files are encore.composition, saved shows are
 * saved_shows.composition.
 */
export interface ReplayLogFile { format: 1; n0: number; paramsHash: string; seed: number; events: EnvEvent[] }

/** sha256 hex of canonicalJson(params): the same value as src/cli/run.ts paramsHash, computed without node:crypto. */
export const replayParamsHash = (params: Params): string => sha256Hex(canonicalJson(params));

/** The replay log of a run: deep-copied events in tick order (stable for equal ticks). */
export function makeReplayLog(seed: number, params: Params, events: readonly EnvEvent[]): ReplayLogFile {
  const copy = JSON.parse(JSON.stringify(events)) as EnvEvent[];
  return { format: 1, n0: params.n0, paramsHash: replayParamsHash(params), seed, events: copy.map((e, i) => [e, i] as const).sort((a, b) => a[0].tick - b[0].tick || a[1] - b[1]).map(([e]) => e) };
}

export type ReplayLogCheck = { ok: true; log: ReplayLogFile } | { ok: false; reason: 'format' | 'params' | 'event' | 'scene'; detail: string };
const EVENT_TYPES = new Set(['KILL', 'JAM_ON', 'JAM_OFF', 'PARTITION_ON', 'PARTITION_OFF', 'INJECT_SCORE', 'SET_LOSS']);

/**
 * Checks a replay log read back from a file (it is data, not trusted) against this page's params: the same n0 and
 * paramsHash, an integer seed, and events of known types with safe-integer ticks ≥ 0 in tick order. A replay with
 * other params would be another run, so it is refused, never adapted.
 */
export function checkReplayLog(input: unknown, params: Params): ReplayLogCheck {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'format', detail: 'not an object' };
  const log = input as Record<string, unknown>;
  if (log.format !== 1) return { ok: false, reason: 'format', detail: 'format must be 1' };
  if (!Number.isSafeInteger(log.seed)) return { ok: false, reason: 'format', detail: 'seed must be an integer' };
  if (!Array.isArray(log.events)) return { ok: false, reason: 'format', detail: 'events must be an array' };
  if (log.n0 !== params.n0) return { ok: false, reason: 'params', detail: `recorded at n0 ${String(log.n0)}, this page runs n0 ${params.n0}` };
  if (log.paramsHash !== replayParamsHash(params)) return { ok: false, reason: 'params', detail: 'recorded with other params' };
  let last = -1;
  for (const [i, e] of (log.events as unknown[]).entries()) {
    const ev = e as Record<string, unknown> | null;
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string' || !EVENT_TYPES.has(ev.type)) return { ok: false, reason: 'event', detail: `events[${i}]: unknown event` };
    if (!Number.isSafeInteger(ev.tick) || (ev.tick as number) < 0 || (ev.tick as number) < last) return { ok: false, reason: 'event', detail: `events[${i}]: tick must be a non-negative integer, in order` };
    if (ev.type === 'INJECT_SCORE' && (!Number.isSafeInteger(ev.droneId) || (ev.droneId as number) < 0 || (ev.droneId as number) >= params.n0)) return { ok: false, reason: 'event', detail: `events[${i}]: droneId out of range` };
    if (ev.type === 'INJECT_SCORE') {
      const movements = (ev.score as { movements?: unknown } | null)?.movements;
      if (!Array.isArray(movements)) return { ok: false, reason: 'event', detail: `events[${i}]: score has no movements` };
      for (const [k, m] of movements.entries()) {
        const problem = generatedRecipeProblem((m as { recipe?: unknown } | null)?.recipe);
        if (problem) return { ok: false, reason: 'scene', detail: `events[${i}].score.movements[${k}]: ${problem}` };   // refused before scheduling
      }
    }
    last = ev.tick as number;
  }
  return { ok: true, log: input as unknown as ReplayLogFile };
}

// ----------------------------------------------------------------------------------- provenance from a run

/** One generated injection of a run, for reports (GF-WP-11 step 4). Derived only from INJECT_SCORE events. */
export interface InjectedProvenance {
  tick: number; droneId: number; sceneHash: string; compilerVersion: number; slotsDigest: string; n0: number; slotSpacingMin: number; title: string;
}

/** The generated-recipe fields read here (GF-CC-01, src/contracts/score.ts GeneratedRecipe), checked structurally. */
interface GeneratedFields { kind: 'generated'; compilerVersion: number; sceneHash: string; slotsDigest: { n0: number; slotSpacingMin: number; digest: string }; scene: { title?: unknown } }
function asGenerated(recipe: unknown): GeneratedFields | null {
  if (recipe === null || typeof recipe !== 'object') return null;
  const r = recipe as Record<string, unknown>;
  if (r.kind !== 'generated') return null;
  const d = r.slotsDigest as Record<string, unknown> | null;
  if (!Number.isInteger(r.compilerVersion) || typeof r.sceneHash !== 'string' || !d || typeof d !== 'object'
    || !Number.isInteger(d.n0) || typeof d.slotSpacingMin !== 'number' || typeof d.digest !== 'string' || r.scene === null || typeof r.scene !== 'object') return null;
  return r as unknown as GeneratedFields;
}

/**
 * Every generated injection in a run's events: the movement each INJECT_SCORE adds (its last). RunRecord is a
 * contract type and is not changed; this reads `record.events` only. Non-generated injections are skipped.
 */
export function generatedProvenance(record: { events: readonly EnvEvent[] }): InjectedProvenance[] {
  const rows: InjectedProvenance[] = [];
  for (const e of record.events) {
    if (e.type !== 'INJECT_SCORE') continue;
    const g = asGenerated(e.score.movements.at(-1)?.recipe);
    if (!g) continue;
    rows.push({ tick: e.tick, droneId: e.droneId, sceneHash: g.sceneHash, compilerVersion: g.compilerVersion, slotsDigest: g.slotsDigest.digest,
      n0: g.slotsDigest.n0, slotSpacingMin: g.slotsDigest.slotSpacingMin, title: typeof g.scene.title === 'string' ? g.scene.title : '' });
  }
  return rows;
}

/**
 * The scene check for one generated recipe found in a loaded log or a scheduled injection (GF-WP-11 step 1 and
 * acceptance "a tampered scene in a loaded file is refused before scheduling"): the scene must validate, hash to its
 * sceneHash label, and carry this build's compiler version. Non-generated recipes pass. Null means accepted.
 */
export function generatedRecipeProblem(recipe: unknown): string | null {
  if (recipe === null || typeof recipe !== 'object' || (recipe as { kind?: unknown }).kind !== 'generated') return null;
  const g = asGenerated(recipe);
  if (!g) return 'malformed generated recipe';
  const valid = validateScene(g.scene);
  if (!valid.ok) return `scene-invalid: ${valid.errors[0]?.code ?? 'invalid'}`;
  if (sceneHash(valid.scene) !== g.sceneHash) return 'hash-mismatch: the scene does not hash to its sceneHash label';
  if (g.compilerVersion !== COMPILER_VERSION) return `compiler-mismatch: v${g.compilerVersion}, this build is v${COMPILER_VERSION}`;
  return null;
}
