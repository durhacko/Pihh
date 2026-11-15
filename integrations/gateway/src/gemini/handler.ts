// integrations/gateway/src/gemini/handler.ts
// `POST /api/generate-formation` as a pure async function: raw body in, { status, body } out. Every outcome maps to
// one row of gemini spec §10.1's table. The server, the shared guard (415, Host, Origin, token) and the gateway's own
// rate bucket run before this and are not in this package yet.
//
// Offline is the default: unless the module is enabled in config (flag and key) AND a provider AND a scene validator
// are wired, every valid request gets 503 PROVIDER_UNAVAILABLE / MODULE_DISABLED and nothing upstream is touched.
import { errorResponse, toReason, type ErrorDetail, type RouteResponse } from '../errors.ts';
import type { GeminiConfig } from './config.ts';
import { parseGenerateRequest, utf8Bytes } from './request.ts';
import {
  GEMINI_LIMITS,
  type GeminiProvider,
  type GenerateFormationSuccess,
  type ProviderOutcome,
  type ProviderRequest,
  type SceneCheck,
  type SceneValidator,
} from './types.ts';

export interface GeminiDeps {
  readonly config: GeminiConfig;
  /** The live provider. `null` in this build: no SDK and no network code exist yet. */
  readonly provider: GeminiProvider | null;
  /** Server-side V1–V11 and trial compile (spec §10.2). `null` until GF-WP-01 lands. */
  readonly validator: SceneValidator | null;
}

/** True only when the module can actually answer: enabled in config, with a provider and a validator. */
export function geminiAvailable(deps: GeminiDeps): boolean {
  return deps.config.enabled && deps.provider !== null && deps.validator !== null;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True if `value` nests deeper than `maxDepth` or has a prototype key at any depth (boundaries §3.1 step 3). */
function unsafeShape(value: unknown, maxDepth: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > maxDepth) return true;
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(key)) return true;
      stack.push({ node: (node as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return false;
}

type Raced = { outcome: ProviderOutcome } | { thrown: true } | { timedOut: true };

async function callWithDeadline(provider: GeminiProvider, request: ProviderRequest, ms: number): Promise<Raced> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Raced>(resolve => {
    timer = setTimeout(() => {
      resolve({ timedOut: true }); // settle first, so a provider that rejects on abort cannot win the race
      controller.abort();
    }, ms);
  });
  const call = Promise.resolve()
    .then(() => provider.generate(request, controller.signal))
    .then(outcome => ({ outcome }) as Raced, () => ({ thrown: true }) as Raced);
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function handleGenerateFormation(rawBody: string, deps: GeminiDeps): Promise<RouteResponse<GenerateFormationSuccess>> {
  const parsed = parseGenerateRequest(rawBody);
  if (!parsed.ok) return { status: parsed.status, body: parsed.body };
  const { prompt, mode, requestId } = parsed.request;

  if (!geminiAvailable(deps) || !deps.config.enabled) {
    return errorResponse('PROVIDER_UNAVAILABLE', 'The gemini module is disabled. Use the offline library.', {
      details: [{ path: '', reason: 'MODULE_DISABLED' }], requestId,
    });
  }
  const provider = deps.provider!;
  const validator = deps.validator!;

  const raced = await callWithDeadline(provider, { prompt, mode, attemptTimeoutMs: deps.config.providerTimeoutMs }, deps.config.requestTimeoutMs);
  if ('timedOut' in raced) {
    return errorResponse('TIMEOUT', 'The provider did not answer in time.', { details: [{ path: '', reason: 'TIMEOUT' }], requestId });
  }
  if ('thrown' in raced) {
    return errorResponse('PROVIDER_ERROR', 'The provider call failed.', { details: [{ path: '', reason: 'PROVIDER_ERROR' }], requestId });
  }

  const outcome = raced.outcome;
  switch (outcome.kind) {
    case 'timeout':
      return errorResponse('TIMEOUT', 'The provider did not answer in time.', { details: [{ path: '', reason: 'TIMEOUT' }], requestId });
    case 'upstream-error':
      if (outcome.status === 429) return errorResponse('RATE_LIMITED', 'The provider is rate limiting requests.', { details: [{ path: '', reason: 'PROVIDER_RATE_LIMITED' }], requestId });
      if (outcome.status === 503) return errorResponse('PROVIDER_UNAVAILABLE', 'The provider is unavailable.', { details: [{ path: '', reason: 'PROVIDER_UNAVAILABLE' }], requestId });
      return errorResponse('PROVIDER_ERROR', 'The provider returned an error.', { details: [{ path: '', reason: 'PROVIDER_ERROR' }], requestId });
    case 'truncated':
      return errorResponse('PROVIDER_ERROR', 'The model output was cut off.', { details: [{ path: '', reason: 'RESPONSE_TOO_LARGE' }], requestId });
    case 'blocked':
      return errorResponse('PROVIDER_ERROR', 'The provider blocked the request or its output.', { details: [{ path: '', reason: 'PROVIDER_BLOCKED' }], requestId });
    case 'other-finish':
      return errorResponse('PROVIDER_ERROR', 'The model did not finish normally.', { details: [{ path: '', reason: 'PROVIDER_ERROR' }], requestId });
    case 'output':
      break;
    default:
      return errorResponse('INTERNAL', 'Unexpected provider outcome.', { requestId });
  }

  // Untrusted model text: size gate, parse, shape gate, then the shared validator. Never repaired (§10.3).
  if (typeof outcome.text !== 'string' || utf8Bytes(outcome.text) > GEMINI_LIMITS.rawOutputMaxBytes) {
    return errorResponse('PROVIDER_ERROR', 'The model output is too large.', { details: [{ path: '', reason: 'RESPONSE_TOO_LARGE' }], requestId });
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(outcome.text);
  } catch {
    return errorResponse('PROVIDER_ERROR', 'The model output is not valid JSON.', { details: [{ path: '', reason: 'INVALID_MODEL_OUTPUT' }], requestId });
  }
  if (unsafeShape(candidate, GEMINI_LIMITS.outputMaxDepth)) {
    return errorResponse('PROVIDER_ERROR', 'The model output has a forbidden shape.', { details: [{ path: '', reason: 'INVALID_MODEL_OUTPUT' }], requestId });
  }

  let check: SceneCheck;
  try {
    check = validator.validate(candidate, mode);
  } catch {
    return errorResponse('INTERNAL', 'Scene validation failed unexpectedly.', { requestId });
  }
  if (!check.ok || check.scene.mode !== mode) {
    const details: ErrorDetail[] = [{ path: '', reason: 'SCENE_INVALID' }];
    if (!check.ok) {
      const first = check.issues[0];
      if (first) details.push({ path: `/scene${first.path}`, reason: toReason(first.code) });
    } else {
      // A scene of the other mode fails V3's exact shape for the requested mode (spec §6.5 `schema`).
      details.push({ path: '/scene/mode', reason: 'SCHEMA' });
    }
    return errorResponse('VALIDATION_FAILED', 'The model scene is not valid.', { details, requestId });
  }

  const latency = Number.isFinite(outcome.latencyMs) && outcome.latencyMs >= 0 ? Math.round(outcome.latencyMs) : 0;
  const body: GenerateFormationSuccess = { model: provider.model, mode, scene: check.scene, sceneHash: check.sceneHash, modelLatencyMs: latency };
  if (requestId !== undefined) body.requestId = requestId;
  return { status: 200, body };
}
