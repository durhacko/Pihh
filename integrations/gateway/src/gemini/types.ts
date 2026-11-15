// integrations/gateway/src/gemini/types.ts
// The typed interface of `POST /api/generate-formation` (gemini spec §10.1, GF-WP-12 "interface only"): the request,
// the success body, the scene-validator port and the provider port. No network code lives in this module yet; the
// live provider is a later PR, after GF-D1 and the credentials.

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

/**
 * Placeholder for `SceneSpec2D | SceneSpec3D` (spec §6.2, §6.3). The real types and `validateScene` belong to
 * GF-WP-01 at `src/score/generated/`, which is not on `phase2/development` yet. Only the fields this module reads
 * are typed here; the validator port owns everything else. When GF-WP-01 lands, replace this with a type import from
 * there (XI-2 allows the gateway to import `src/score/**` by relative path).
 */
export interface SceneSpec {
  readonly version: number;
  readonly mode: FormationMode;
  readonly [field: string]: unknown;
}

/** One validator finding: a JSON pointer inside the scene (`""` = the whole scene) and a kebab-case code from
 *  V1–V11 or the compiler (spec §6.5, §7.11). The handler maps the code to SCREAMING_SNAKE (XI-16). */
export interface SceneIssue { path: string; code: string }

export type SceneCheck =
  | { ok: true; scene: SceneSpec; sceneHash: string }
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
 *  included, when `signal` aborts at the whole-request deadline (`GEMINI_REQUEST_TIMEOUT_MS`, 45 s†). */
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
