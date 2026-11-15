// integrations/gateway/src/gemini/types.ts
// The typed interface of `POST /api/generate-formation` (gemini spec §10.1, GF-WP-12): the request, the success body,
// the scene-validator port and the provider port. No network code lives in this module; the live provider adapter is
// a later PR, after GF-D1 and the credentials, and only implements `GeminiProvider`.

export const FORMATION_MODES = ['silhouette2d', 'scene3d'] as const;
export type FormationMode = (typeof FORMATION_MODES)[number];

/** §10.1 and §10.3 limits. Rows marked † in the spec are proposed defaults for William to confirm. */
export const GEMINI_LIMITS = Object.freeze({
  /** Prompt length after trimming, in Unicode code points (§10.1, †). */
  promptMax: 500,
  /** Request body, UTF-8 bytes (§10.3, †). */
  requestBodyMaxBytes: 8 * 1024,
  /** Raw model text, UTF-8 bytes (§10.3). */
  rawOutputMaxBytes: 64 * 1024,
  /** Nesting depth accepted in model output before the scene validator sees it. */
  outputMaxDepth: 64,
});

/** Request body. No other field is accepted (`additionalProperties: false`, §10.1). */
export interface GenerateFormationRequest {
  prompt: string;
  mode: FormationMode;
  /** Optional, client-generated, opaque (XI-11); only a matching value is kept. */
  requestId?: string;
}

/** `SceneSpec2D | SceneSpec3D` from GF-WP-01 (spec §6.2, §6.3), through the module's one bridge (XI-2). */
export type { SceneSpec } from './validate.ts';
import type { SceneSpec } from './validate.ts';

/** One validator finding: a JSON pointer inside the scene (`""` = the whole scene) and a kebab-case code from
 *  V1–V11 or the compiler (spec §6.5, §7.11). The handler maps the code to SCREAMING_SNAKE (XI-16). */
export interface SceneIssue { path: string; code: string }

/** `trialCompile` says honestly what the server checked: `not-yet-compiled` until GF-WP-06 (#212) lands. */
export type SceneCheck =
  | { ok: true; scene: SceneSpec; sceneHash: string; trialCompile: 'compiled' | 'not-yet-compiled' }
  | { ok: false; issues: readonly SceneIssue[] };

/**
 * The server-side validation port (spec §10.2): V1–V11 plus the trial compile at the app's smallest and largest n0,
 * using the same pure modules the app imports. It must treat `candidate` as untrusted and return a fresh object.
 * There is no default implementation: without one the module is unavailable (fail closed).
 */
export interface SceneValidator {
  validate(candidate: unknown, mode: FormationMode): SceneCheck;
}

/** What the module asks a provider for. Never carries run, telemetry, library or agent data (§10.3).
 *  `attemptTimeoutMs` is the per-call budget (§10.3, 30 s†, `GEMINI_PROVIDER_TIMEOUT_MS`): the provider applies it to
 *  each attempt and reports `timeout` when an attempt runs past it. */
export interface ProviderRequest { prompt: string; mode: FormationMode; attemptTimeoutMs: number }

/**
 * A provider's final outcome, after its own retries (429 and 503 only, §10.3). The live adapter maps the SDK
 * response into exactly one of these; the handler never sees SDK types.
 * - `output`: `finishReason` was `STOP`; `text` is the raw model text, unparsed.
 * - `truncated`: a `MAX_TOKENS` finish.
 * - `blocked`: a `SAFETY` or `RECITATION` finish, or a `promptFeedback.blockReason`.
 * - `other-finish`: any other finish reason; never parsed.
 * - `upstream-error`: the final HTTP status from the provider.
 * - `timeout`: an attempt ran past `attemptTimeoutMs` (504 TIMEOUT, §10.1).
 */
export type ProviderOutcome =
  | { kind: 'output'; text: string; latencyMs: number }
  | { kind: 'timeout' }
  | { kind: 'truncated' }
  | { kind: 'blocked' }
  | { kind: 'other-finish'; finishReason: string }
  | { kind: 'upstream-error'; status: number };

/** The provider port. The live implementation holds the key it was constructed with; the handler never sees it.
 *  Two clocks (§10.3): it applies `request.attemptTimeoutMs` to each attempt, and it must stop all work, retries
 *  included, when `signal` aborts at the whole-request deadline (`GEMINI_REQUEST_TIMEOUT_MS`, 45 s†).
 *  Obligations of the live adapter (spec §10.3): set `maxOutputTokens` per mode (2,048 for silhouette2d and 8,192 for
 *  scene3d†), so the model cannot produce text past the 64 KiB raw cap the handler enforces; turn the SDK's own retries
 *  off (`withRetries` retries 429 and 503 only); and map each response through `mapProviderResponse`. */
export interface GeminiProvider {
  readonly model: string;
  generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome>;
}

/** Success body (§10.1): William's envelope plus `requestId`, with no `success` flag (XI-3). */
export interface GenerateFormationSuccess {
  requestId?: string;
  model: string;
  mode: FormationMode;
  scene: SceneSpec;
  /** Advisory: the app recomputes it and never trusts this value (spec §6.7, CR-26). */
  sceneHash: string;
  modelLatencyMs: number;
}
