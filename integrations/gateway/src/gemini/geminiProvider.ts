// integrations/gateway/src/gemini/geminiProvider.ts
// The live Gemini Flash-Lite adapter for the `gemini` module's provider port (GF-WP-12, spec gemini-generated-formations.md
// §10.1, §10.3, §10.6). Prepared under G4, WIRED under D3 (#218, free quota only): module.ts builds it with the platform
// fetch as its transport whenever GEMINI_ENABLED and GEMINI_API_KEY are both set, so it then makes REAL calls to
// Google. The file itself holds no reference to the global `fetch`: the caller injects a `transport` (tests inject a
// recorded-shape fake, and the suite's tripwire, test/no-network.mjs, refuses any real one). No SDK, no key in the
// repo; the key arrives in `GeminiConfig.apiKey` (config.ts reads GEMINI_API_KEY server-side, only when enabled).
//
// One `generate` call = exactly one HTTP request, never a retry: `withRetries` (provider.ts) owns the 429/503 policy
// (§10.3: the SDK's own retries must be off; with plain HTTP there are none). The per-attempt timeout is applied here
// too, as defence in depth, and the whole-request `signal` aborts the request. The HARD time bound is withRetries'
// per-attempt race (provider.ts `attempt`): this adapter alone cannot stop a transport that ignores its abort signal
// and never settles. `generate` never rejects. Every answer is mapped through `mapProviderResponse`, which alone
// interprets finish reasons.
//
// Redirects are never followed (`redirect: 'error'`): on a cross-origin redirect the platform fetch drops
// `Authorization` but not a custom `x-goog-api-key` header, so following one could forward the key to another host and
// would also bypass the https-only endpoint check. A 3xx is an upstream error, unread.
//
// What the spec does and does not establish (§10.6 "VERIFIED" = an official source seen on 2026-11-15; it is about the
// JS SDK, not the REST wire format):
//   VERIFIED (§10.6): the model id `gemini-3.1-flash-lite` (config default); structured output via
//     `responseMimeType: "application/json"` + `responseJsonSchema`, never combined with `responseSchema`;
//     `thinkingConfig.thinkingLevel` with levels minimal/low/medium/high; 429 and 503 retried, never 400/402/403;
//     the key server-side only.
//   SPEC RULE, field name UNVERIFIED (§10.1/§10.3 design rules, not checked provider facts): parse only when
//     `candidates[0].finishReason` is `STOP`; a `promptFeedback.blockReason` blocks; log `thoughtsTokenCount`;
//     `maxOutputTokens` per mode, with the values 2,048 / 8,192 proposed defaults (†) for William to confirm.
//   VERIFIED against Google's current public docs on 2026-11-15 (D3 lane; ai.google.dev redirects to aistudio.google.com):
//     the method and path `POST /v1beta/models/{model}:generateContent` on generativelanguage.googleapis.com
//     (https://aistudio.google.com/api-reference/generate-content); the `x-goog-api-key` header
//     (https://aistudio.google.com/docs/api-key); `candidates[].finishReason` (string enum, STOP, MAX_TOKENS, SAFETY,
//     RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII, …) and `promptFeedback.blockReason`; the `usageMetadata` counters
//     (promptTokenCount, cachedContentTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount); the
//     ThinkingLevel enum names MINIMAL/LOW/MEDIUM/HIGH, with minimal…high for gemini-3.1-flash-lite (Stable,
//     https://aistudio.google.com/docs/models, /docs/thinking); its free tier (https://aistudio.google.com/docs/pricing).
//   STILL UNVERIFIED (no current public page shows a generateContent request example; the docs now show the
//     Interactions API): the top-level request layout (`systemInstruction`, `contents[].parts[].text`,
//     `generationConfig` with `responseMimeType`, `responseJsonSchema`, `maxOutputTokens`, `thinkingConfig`), seen only
//     as field names in the reference, not as a request example; `thought: true` on thought parts. The first live call is
//     the check. Whether thinking tokens count against `maxOutputTokens` is UNVERIFIED (§10.3).
//   PLACEHOLDER: the system instructions below are not William's prompts (he owns prompts, spec §2; handoff §8 names
//     PROMPT_2D/PROMPT_3D as not yet written). Pass `prompts` to replace them.
import type { GeminiConfig } from './config.ts';
import { mapProviderResponse, type RawProviderResponse } from './mapResponse.ts';
import type { FormationMode, GeminiProvider, ProviderOutcome, ProviderRequest } from './types.ts';

/** UNVERIFIED: the Generative Language REST base (API version v1beta). Overridable for a proxy or a test. */
export const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** §10.3† proposed defaults, per mode. By estimate (~4 bytes per token, a planning figure, not a measured bound) they
 *  keep output under the handler's 64 KiB raw cap; 4,096 tokens is about the 16 KB scene cap. The handler's cap is the
 *  real guard. */
export const MAX_OUTPUT_TOKENS: Readonly<Record<FormationMode, number>> = Object.freeze({ silhouette2d: 2_048, scene3d: 8_192 });

/** William's settings to benchmark (spec §10.6, handoff §2): minimal thinking for 2D, low for 3D. Upper case, as the
 *  generateContent reference lists the ThinkingLevel enum (MINIMAL, LOW, …; docs checked 2026-11-15). */
export const THINKING_LEVEL: Readonly<Record<FormationMode, 'MINIMAL' | 'LOW'>> = Object.freeze({ silhouette2d: 'MINIMAL', scene3d: 'LOW' });

/** The most response bytes read from one HTTP answer. A larger answer is an upstream fault, never parsed. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Usage counters copied into observations (names UNVERIFIED; any other key is dropped). */
export const USAGE_KEYS: readonly string[] = Object.freeze(['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount']);

/** A finish reason from upstream is passed on only in this shape; anything else becomes UNRECOGNISED (never parsed). */
const FINISH_REASON_SHAPE = /^[A-Z_]{1,64}$/;

/** Hosts for which a plain-http endpoint override is accepted (a local proxy or a test). Anything else must be https. */
const LOCAL_HOSTS: readonly string[] = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

/** PLACEHOLDER system instructions (see the header). Data only: the model's output is validated, never trusted. */
export const PLACEHOLDER_PROMPTS: Readonly<Record<FormationMode, string>> = Object.freeze({
  silhouette2d: 'PLACEHOLDER (not William\'s prompt). Describe the requested subject as a 2D silhouette scene for a drone ' +
    'light show: JSON matching the response schema, mode "silhouette2d", parts applied in array order, coordinates in ' +
    'about [-1, 1] with y up. Output only the JSON object.',
  scene3d: 'PLACEHOLDER (not William\'s prompt). Describe the requested subject as a 3D scene of simple solids for a drone ' +
    'light show: JSON matching the response schema, mode "scene3d", y up, the subject\'s front facing +z, left/right ' +
    'symmetric about x = 0. Output only the JSON object.',
});

/** The few parts of a WHATWG `Response` the adapter reads. The body is always read as a stream, with a byte cap; a
 *  200 without a body stream is refused (there is no whole-body `text()` fallback). */
export interface TransportResponse {
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers?: { get(name: string): string | null };
}

/** What the adapter sends. Exactly the shape of `fetch(url, init)`, so under D3 the platform fetch can be passed as is.
 *  `redirect: 'error'` makes the platform fetch reject instead of following a 3xx (see the header). */
export interface TransportInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
  readonly redirect: 'error';
}

export type Transport = (url: string, init: TransportInit) => Promise<TransportResponse>;

/** One provider call as the module may log it (§10.3 "Logging"): never the key, never the prompt or the model text. */
export interface ProviderObservation {
  readonly model: string;
  readonly mode: FormationMode;
  readonly httpStatus: number;
  readonly latencyMs: number;
  readonly outcome: ProviderOutcome['kind'];
  readonly finishReason?: string;
  readonly usage?: Readonly<Record<string, number>>;
  /** For a 4xx/5xx only: the sanitised classification of Google's error body (never its message or anything else). */
  readonly error?: UpstreamErrorClass;
}

/** Google's error classification, each value filtered to an enum or field-path shape; nothing free-text. `unknownNames`
 *  and `paths` are the identifiers quoted in a field violation's description (`Unknown name "X"`, `at 'a.b'`): the
 *  description itself is never kept. */
export interface UpstreamErrorClass {
  readonly status?: string;
  readonly reasons?: readonly string[];
  readonly fields?: readonly string[];
  readonly unknownNames?: readonly string[];
  readonly paths?: readonly string[];
}

/** An error body is read up to this many bytes and this long, only to classify it. */
const ERROR_BODY_MAX = 16 * 1024;
const ERROR_BODY_MS = 2_000;
const ENUM_SHAPE = /^[A-Z_]{1,64}$/;
const FIELD_SHAPE = /^[A-Za-z0-9_.[\]]{1,128}$/;
const IDENT_SHAPE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The classification of a Google error body: error.status, details[].reason, details[].fieldViolations[].field. */
export function classifyErrorBody(body: string): UpstreamErrorClass | undefined {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return undefined; }
  const error = record(record(json)?.error);
  if (!error) return undefined;
  const status = typeof error.status === 'string' && ENUM_SHAPE.test(error.status) ? error.status : undefined;
  const reasons: string[] = [];
  const fields: string[] = [];
  const unknownNames: string[] = [];
  const paths: string[] = [];
  const add = (list: string[], value: string, shape: RegExp) => { if (shape.test(value) && list.length < 8 && !list.includes(value)) list.push(value); };
  const details: unknown = error.details;
  for (const detail of Array.isArray(details) ? details.map(record) : []) {
    if (!detail) continue;
    if (typeof detail.reason === 'string') add(reasons, detail.reason, ENUM_SHAPE);
    const violations: unknown = detail.fieldViolations;
    for (const v of Array.isArray(violations) ? violations.map(record) : []) {
      if (!v) continue;
      if (typeof v.field === 'string') add(fields, v.field, FIELD_SHAPE);
      if (typeof v.description === 'string') {
        // Only the identifiers the description quotes; the description text is never kept.
        for (const m of v.description.matchAll(/Unknown name "([A-Za-z_][A-Za-z0-9_]{0,63})"/g)) add(unknownNames, m[1]!, IDENT_SHAPE);
        for (const m of v.description.matchAll(/at '([A-Za-z_][A-Za-z0-9_.[\]]{0,127})'/g)) add(paths, m[1]!, FIELD_SHAPE);
      }
    }
  }
  if (!status && reasons.length + fields.length + unknownNames.length + paths.length === 0) return undefined;
  return {
    ...(status ? { status } : {}), ...(reasons.length ? { reasons } : {}), ...(fields.length ? { fields } : {}),
    ...(unknownNames.length ? { unknownNames } : {}), ...(paths.length ? { paths } : {}),
  };
}

/** Reads at most `max` bytes of a body stream within `ms`; whatever arrived (or '' on failure). Cancels the rest. */
async function readErrorBody(stream: ReadableStream<Uint8Array> | null, max: number, ms: number, abort: AbortSignal): Promise<string> {
  if (!stream || typeof stream.getReader !== 'function') return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), ms);
    abort.addEventListener('abort', () => resolve(null), { once: true });
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), stop]);
      if (next === null || next.done) break;
      bytes += next.value.byteLength;
      text += decoder.decode(next.value, { stream: true });
      if (bytes >= max) break;
    }
  } catch {
    // an unreadable error body classifies as nothing
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
  return text.slice(0, max);
}

export interface GeminiProviderDeps {
  /** The HTTP call. Under D3 the wiring passes the platform fetch; there is deliberately no default. */
  readonly transport: Transport;
  /** The committed model-facing scene schemas (src/score/generated/schema/scene2d|scene3d.schema.json), sent as
   *  `responseJsonSchema`. `null` sends JSON mode without a schema (GEMINI_RESPONSE_SCHEMA=off): the server-side
   *  validateScene stays authoritative either way (spec §10.2). */
  readonly schemas: Readonly<Record<FormationMode, object>> | null;
  /** Milliseconds, for latency only. The module passes a monotonic clock. A failing clock reads as 0. */
  readonly now: () => number;
  /** Replaces the placeholder system instructions (William's prompts, once written). */
  readonly prompts?: Partial<Readonly<Record<FormationMode, string>>>;
  /** Optional sampling temperature (handoff §2 suggests 0.3 to benchmark; UNVERIFIED for Gemini 3). Omitted by default. */
  readonly temperature?: number;
  /** Base URL override. Must be https, except for a local host (127.0.0.1, localhost, [::1]). */
  readonly endpoint?: string;
  readonly observe?: (observation: ProviderObservation) => void;
}

export type EnabledGeminiConfig = Extract<GeminiConfig, { enabled: true }>;

/** The REST request body for one generation (UNVERIFIED layout; see the header). Pure. */
export function buildRequestBody(request: ProviderRequest, deps: Pick<GeminiProviderDeps, 'schemas' | 'prompts' | 'temperature'>): Record<string, unknown> {
  const mode = request.mode;
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    ...(deps.schemas ? { responseJsonSchema: deps.schemas[mode] } : {}),
    maxOutputTokens: MAX_OUTPUT_TOKENS[mode],
    thinkingConfig: { thinkingLevel: THINKING_LEVEL[mode] },
  };
  if (typeof deps.temperature === 'number' && Number.isFinite(deps.temperature)) generationConfig.temperature = deps.temperature;
  return {
    systemInstruction: { parts: [{ text: deps.prompts?.[mode] ?? PLACEHOLDER_PROMPTS[mode] }] },
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig,
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * The fields `mapProviderResponse` reads, copied out of one 200 answer, plus the known usage counters for logging. A
 * body that is not JSON, or has no candidate, gives no finish reason, so it maps to PROVIDER_ERROR and is never parsed.
 * A finish reason that is not upper-case letters and underscores becomes UNRECOGNISED. The candidate's text is its
 * non-thought text parts, joined (UNVERIFIED layout).
 */
export function readResponseBody(httpStatus: number, body: string, latencyMs: number): { raw: RawProviderResponse; usage?: Record<string, number> } {
  if (httpStatus !== 200) return { raw: { httpStatus, latencyMs } };
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { raw: { httpStatus, latencyMs } }; }
  const top = record(json);
  const feedback = record(top?.promptFeedback);
  const candidateList: unknown = top?.candidates;
  const first = Array.isArray(candidateList) ? record(candidateList[0]) : null;
  const partList: unknown = record(first?.content)?.parts;
  const parts: unknown[] = Array.isArray(partList) ? partList : [];
  const texts = parts.map(record).filter((p): p is Record<string, unknown> => p !== null && typeof p.text === 'string' && p.thought !== true);
  const finish = first?.finishReason;
  const raw: RawProviderResponse = {
    httpStatus,
    latencyMs,
    blockReason: typeof feedback?.blockReason === 'string' ? feedback.blockReason : null,
    finishReason: typeof finish === 'string' ? (FINISH_REASON_SHAPE.test(finish) ? finish : 'UNRECOGNISED') : null,
    text: texts.length > 0 ? texts.map(p => p.text as string).join('') : null,
  };
  const usageRecord = record(top?.usageMetadata);
  const usage: Record<string, number> = {};
  for (const key of USAGE_KEYS) {
    const value = usageRecord?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? { raw, usage } : { raw };
}

/** Reads at most MAX_RESPONSE_BYTES of an answer's body stream; null if it is larger (the rest is not read) or if
 *  there is no body stream at all. */
async function readBounded(response: TransportResponse): Promise<string | null> {
  const declared = Number(response.headers?.get('content-length') ?? Number.NaN);
  const stream = response.body;
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await stream?.cancel().catch(() => {});
    return null;
  }
  if (!stream || typeof stream.getReader !== 'function') return null;
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function checkedBase(endpoint: string | undefined): string {
  const base = (endpoint ?? GEMINI_REST_BASE).replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(base); } catch { throw new RangeError('geminiProvider: the endpoint is not a URL'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))) {
    throw new RangeError('geminiProvider: the endpoint must be https (plain http only for a local host)');
  }
  return base;
}

/**
 * The live provider for `withRetries` (provider.ts) and `geminiModule` (module.ts). Construct it only with an enabled
 * config, after D3. The returned object exposes `model` and `generate` and nothing that holds the key. Throws a
 * RangeError at construction for an endpoint override that is not https (or a local http host).
 */
export function createGeminiProvider(config: EnabledGeminiConfig, deps: GeminiProviderDeps): GeminiProvider {
  const model = config.model;
  const url = `${checkedBase(deps.endpoint)}/models/${encodeURIComponent(model)}:generateContent`;
  const clock = (): number => {
    try {
      const t = deps.now();
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  };
  const report = (observation: ProviderObservation): void => {
    try { deps.observe?.(observation); } catch { /* logging never breaks a request */ }
  };

  async function generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
    const started = clock();
    const controller = new AbortController();
    let timedOut = false;
    const forward = () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: ProviderOutcome, httpStatus: number, extra: Partial<ProviderObservation> = {}): ProviderOutcome => {
      report({ model, mode: request.mode, httpStatus, latencyMs: Math.max(0, clock() - started), outcome: outcome.kind, ...extra });
      return outcome;
    };
    try {
      if (signal.aborted) return finish({ kind: 'timeout' }, 0);
      signal.addEventListener('abort', forward, { once: true });
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, request.attemptTimeoutMs));
      let status: number;
      let body: string | null;
      try {
        const response = await deps.transport(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey.reveal() },
          body: JSON.stringify(buildRequestBody(request, deps)),
          signal: controller.signal,
          redirect: 'error',
        });
        status = Number.isInteger(response.status) ? response.status : 0;
        if (status !== 200) {
          // An error status (a 3xx included) is final whatever its body (a 429 stays a 429, however large; a redirect
          // is never followed). A 4xx/5xx body is read only to classify it (capped, sanitised, never returned).
          const error = status >= 400 ? classifyErrorBody(await readErrorBody(response.body, ERROR_BODY_MAX, ERROR_BODY_MS, controller.signal)) : undefined;
          if (status < 400) await response.body?.cancel().catch(() => {});
          return finish(timedOut || controller.signal.aborted ? { kind: 'timeout' } : { kind: 'upstream-error', status }, status, error ? { error } : {});
        }
        body = await readBounded(response);
      } catch {
        // An abort (attempt timeout or the request deadline) is a timeout; any other transport failure is an upstream
        // error of unknown status (PROVIDER_ERROR). The error itself is not reported: it may carry the request.
        return finish(timedOut || controller.signal.aborted ? { kind: 'timeout' } : { kind: 'upstream-error', status: 0 }, 0);
      }
      // A transport that ignores the abort and answers late still counts as a timeout.
      if (timedOut || controller.signal.aborted) return finish({ kind: 'timeout' }, status);
      if (body === null) return finish({ kind: 'upstream-error', status: 0 }, status);
      const { raw, usage } = readResponseBody(status, body, Math.max(0, clock() - started));
      const outcome = mapProviderResponse(raw);
      return finish(outcome, status, {
        ...(typeof raw.finishReason === 'string' ? { finishReason: raw.finishReason } : {}),
        ...(usage ? { usage } : {}),
      });
    } catch {
      // Defensive: nothing above should throw, but the port's contract is that generate never rejects.
      return { kind: 'upstream-error', status: 0 };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', forward);
    }
  }

  return Object.freeze({ model, generate });
}
