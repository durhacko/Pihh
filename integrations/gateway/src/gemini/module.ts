// integrations/gateway/src/gemini/module.ts
// Entry point of the `gemini` module (GF-WP-12, #249), registered by the skeleton in `../modules.ts`.
//
// D3 granted for Gemini (recorded on #218): FREE QUOTA ONLY. The module is live only when BOTH GEMINI_ENABLED and
// GEMINI_API_KEY are set (config.ts, which reads the key as a `Secret` and never logs it); otherwise it has no provider
// and `POST /api/generate-formation` answers 503 PROVIDER_UNAVAILABLE / MODULE_DISABLED, exactly as before. When live,
// the provider is geminiProvider.ts (plain HTTP to generateContent, model GEMINI_MODEL) with the platform fetch as its
// transport, wrapped by `geminiModule` in the 429/503 retry policy. The guard, limits, timeouts, redaction and error
// mapping are unchanged: they live in the handler and the skeleton.
import { readFileSync } from 'node:fs';
import type { Env } from '../config.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import { readGeminiConfig, type GeminiConfig } from './config.ts';
import { createGeminiProvider, PLACEHOLDER_PROMPTS, type Transport, type UpstreamErrorClass } from './geminiProvider.ts';
import { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';
import { abortableSleep, withRetries, type RetryDeps } from './provider.ts';
import type { FormationMode } from './types.ts';
import { createSceneValidator, TRIAL_COMPILE_AVAILABLE } from './validate.ts';

export const GENERATE_FORMATION_ROUTE = Object.freeze({ method: 'POST', path: '/api/generate-formation' } as const);

/** Jitter and sleep for the retry policy. Jitter needs no reproducibility, so Math.random is fine here. */
export const DEFAULT_RETRY_DEPS: RetryDeps = Object.freeze({ random: Math.random, sleep: abortableSleep });

// The ONE place the gateway's gemini code names the platform fetch (allow-listed, exactly, in test/offline.test.ts).
const PLATFORM_TRANSPORT: Transport = fetch;

/** Schema keywords that identify the file rather than constrain output; dropped before the schema is sent (the
 *  first live call was refused upstream, and `$id` is outside the spec §6.8 subset Gemini accepts). */
const DOCUMENT_ONLY_KEYS: readonly string[] = Object.freeze(['$id', '$schema']);

/** The committed model-facing scene schemas (src/score/generated/schema), read once per live module, as data, with the
 *  top-level document-only keys removed. */
export function loadSceneSchemas(): Readonly<Record<FormationMode, object>> {
  const read = (name: string): object => {
    const schema = JSON.parse(readFileSync(new URL(`../../../../src/score/generated/schema/${name}.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    for (const key of DOCUMENT_ONLY_KEYS) delete schema[key];
    return schema;
  };
  return Object.freeze({ silhouette2d: read('scene2d'), scene3d: read('scene3d') });
}

/** Keywords the slim model-facing schema drops: numeric and length bounds, and prose. Every one of them is re-checked
 *  by the server-side validateScene (V3 schema and later layers), which stays authoritative; nothing is repaired. */
export const SLIM_DROPPED_KEYWORDS: readonly string[] = Object.freeze(['minimum', 'maximum', 'minItems', 'maxItems', 'description', 'title']);

/** The schema with SLIM_DROPPED_KEYWORDS removed at keyword positions only: a property NAMED `title` (scene3d has one)
 *  stays, because `properties` and `$defs` are maps of names to schemas, not schemas. Kept: type, properties, required,
 *  enum, items, anyOf, $defs, $ref, additionalProperties. Pure; returns a new value and never mutates its input. */
export function slimSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(slimSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SLIM_DROPPED_KEYWORDS.includes(key)) continue;
    if ((key === 'properties' || key === '$defs') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, slimSchema(schema)]));
    } else if (key === 'items' || key === 'anyOf' || key === 'additionalProperties') {
      out[key] = slimSchema(value);
    } else {
      out[key] = value; // type, required, enum, $ref: data, copied as is
    }
  }
  return out;
}

/** The slim schemas, derived at load time from the committed ones (never a second hand-written copy). */
export function loadSlimSceneSchemas(): Readonly<Record<FormationMode, object>> {
  const full = loadSceneSchemas();
  return Object.freeze({ silhouette2d: slimSchema(full.silhouette2d) as object, scene3d: slimSchema(full.scene3d) as object });
}

/** GEMINI_RESPONSE_SCHEMA=text: no responseJsonSchema; the PLACEHOLDER system instruction gains one line naming
 *  version 1, the mode and the field names, with the slim schema as text. PLACEHOLDER prompt change for William's
 *  review (he owns prompts, spec §2); the output is validated server-side exactly as in every other mode. */
export function schemaAsTextPrompts(): Readonly<Record<FormationMode, string>> {
  const slim = loadSlimSceneSchemas();
  const line = (mode: FormationMode): string => `${PLACEHOLDER_PROMPTS[mode]} PLACEHOLDER line for William's review: the JSON ` +
    `object must have "version": 1 and "mode": "${mode}", and use exactly the field names and nesting of this JSON ` +
    `Schema (bounds are checked after generation): ${JSON.stringify(slim[mode])}`;
  return Object.freeze({ silhouette2d: line('silhouette2d'), scene3d: line('scene3d') });
}

/** The last upstream call as health may show it (sanitised: no key, prompt, model text or error body). */
export interface LastUpstream {
  readonly httpStatus: number; readonly outcome: string; readonly finishReason?: string; readonly latencyMs: number; readonly at: string;
  /** For a 4xx/5xx: Google's error.status, details[].reason and fieldViolations[].field, sanitised (no message). */
  readonly error?: UpstreamErrorClass;
}

/** The module offline: the real validator, no provider (tests, and any run without the flag and the key). */
export function defaultGeminiDeps(config: GeminiConfig): GeminiDeps {
  return { config, provider: null, validator: createSceneValidator() };
}

/** The module as this build runs it: live when the config is enabled (flag and key), offline otherwise. `onUpstream`
 *  receives each call's sanitised outcome (status, outcome kind, sanitised finish reason, latency). */
export function liveGeminiDeps(config: GeminiConfig, transport: Transport = PLATFORM_TRANSPORT, onUpstream?: (last: LastUpstream) => void, schemaMode: ResponseSchemaMode = 'full'): GeminiDeps {
  if (!config.enabled) return defaultGeminiDeps(config);
  const schemas = schemaMode === 'full' ? loadSceneSchemas() : schemaMode === 'slim' ? loadSlimSceneSchemas() : null;
  const provider = createGeminiProvider(config, {
    transport, schemas, ...(schemaMode === 'text' ? { prompts: schemaAsTextPrompts() } : {}), now: () => performance.now(),
    observe: o => onUpstream?.({
      httpStatus: o.httpStatus, outcome: o.outcome, latencyMs: Math.round(o.latencyMs),
      ...(o.finishReason ? { finishReason: o.finishReason } : {}), ...(o.error ? { error: o.error } : {}), at: new Date().toISOString(),
    }),
  });
  return { config, provider, validator: createSceneValidator() };
}

/** Builds the module from explicit deps (tests, and the live path). A provider is always wrapped in the retry policy.
 *  `lastUpstream`, when given, adds the last upstream call (sanitised) to health, so a failure is diagnosable. */
export function geminiModule(deps: GeminiDeps, retry: RetryDeps = DEFAULT_RETRY_DEPS, lastUpstream?: () => LastUpstream | null): GatewayModule {
  const wired: GeminiDeps = { ...deps, provider: deps.provider === null ? null : withRetries(deps.provider, retry) };
  return {
    name: 'gemini',
    routes: [{ ...GENERATE_FORMATION_ROUTE, handle: request => handleGenerateFormation(request.rawBody, wired) }],
    health: () => {
      const last = lastUpstream?.() ?? null;
      return { enabled: geminiAvailable(wired), trialCompile: TRIAL_COMPILE_AVAILABLE, ...(last ? { lastUpstream: last } : {}) };
    },
  };
}

/** Ignored GEMINI_* values (a bad model id or timeout replaced by its default) go to the start-up log as `problems`,
 *  naming the variable, never the value. */
export const createModule: ModuleFactory = (env: Env) => {
  const problems: string[] = [];
  let last: LastUpstream | null = null;
  const schemaMode = responseSchemaSetting(env.GEMINI_RESPONSE_SCHEMA, problems);
  const module = geminiModule(liveGeminiDeps(readGeminiConfig(env, problems), PLATFORM_TRANSPORT, l => { last = l; }, schemaMode), DEFAULT_RETRY_DEPS, () => last);
  return { ...module, problems: Object.freeze(problems) };
};

/** What generationConfig carries for the scene shape. `full`: the committed schema as responseJsonSchema. `slim`: the
 *  same, derived at load time without bounds or prose (slimSchema). `off`: JSON mode, no schema. `text`: JSON mode, no
 *  schema, the slim schema as text in the PLACEHOLDER system instruction. validateScene is authoritative in all four. */
export type ResponseSchemaMode = 'full' | 'slim' | 'off' | 'text';

/** GEMINI_RESPONSE_SCHEMA: unset or "on" = full; "slim", "off", "text" as ResponseSchemaMode. The first live calls with
 *  the full schema were refused with 400 INVALID_ARGUMENT and no field named, the shape of a schema too complex for
 *  constrained decoding; "off" then gave 200 STOP. Any other value keeps the default and is reported by name only. */
export function responseSchemaSetting(value: string | undefined, problems: string[] = []): ResponseSchemaMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'on') return 'full';
  if (v === 'slim' || v === 'off' || v === 'text') return v;
  problems.push('GEMINI_RESPONSE_SCHEMA is not "on", "slim", "off" or "text"; sending the full schema');
  return 'full';
}
