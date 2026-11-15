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
export function slimSchema(node: unknown, dropped: readonly string[] = SLIM_DROPPED_KEYWORDS): unknown {
  if (Array.isArray(node)) return node.map(n => slimSchema(n, dropped));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (dropped.includes(key)) continue;
    if ((key === 'properties' || key === '$defs') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, slimSchema(schema, dropped)]));
    } else if (key === 'items' || key === 'anyOf' || key === 'additionalProperties') {
      out[key] = slimSchema(value, dropped);
    } else {
      out[key] = value; // type, required, enum, $ref: data, copied as is
    }
  }
  return out;
}

/** GEMINI_RESPONSE_SCHEMA=bounded drops only array lengths and prose; numeric minimum/maximum are sent. With slim, the
 *  live model chose a radius outside the size range (V3 RANGE), a bound slim had dropped. */
export const BOUNDED_DROPPED_KEYWORDS: readonly string[] = Object.freeze(['minItems', 'maxItems', 'description', 'title']);

/** The slim schemas, derived at load time from the committed ones (never a second hand-written copy). */
export function loadSlimSceneSchemas(dropped: readonly string[] = SLIM_DROPPED_KEYWORDS): Readonly<Record<FormationMode, object>> {
  const full = loadSceneSchemas();
  return Object.freeze({ silhouette2d: slimSchema(full.silhouette2d, dropped) as object, scene3d: slimSchema(full.scene3d, dropped) as object });
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

/** The committed schema's numeric ranges, as "<name> in [min, max]" (name = the property or $defs entry; array items
 *  carry their array's name), de-duplicated, in document order. Derived, so the text cannot drift from the schema. */
export function schemaRanges(schema: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, label: string): void => {
    if (Array.isArray(node)) { node.forEach(n => walk(n, label)); return; }
    if (node === null || typeof node !== 'object') return;
    const s = node as Record<string, unknown>;
    if (typeof s.minimum === 'number' && typeof s.maximum === 'number') {
      const line = `${label} in [${s.minimum}, ${s.maximum}]`;
      if (!out.includes(line)) out.push(line);
    }
    for (const key of ['properties', '$defs'] as const) {
      const map = s[key];
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        for (const [name, child] of Object.entries(map)) walk(child, key === '$defs' ? `$defs/${name}` : name);
      }
    }
    walk(s.items, label);
    walk(s.anyOf, label);
  };
  walk(schema, 'scene');
  return out;
}

/** GEMINI_RESPONSE_SCHEMA=ranges: the slim responseJsonSchema, and the PLACEHOLDER system instruction gains one line
 *  stating the numeric ranges slim drops (schemaRanges of the committed schema). PLACEHOLDER prompt change for
 *  William's review; validateScene stays authoritative. */
export function rangesPrompts(): Readonly<Record<FormationMode, string>> {
  const full = loadSceneSchemas();
  const line = (mode: FormationMode): string => `${PLACEHOLDER_PROMPTS[mode]} PLACEHOLDER line for William's review: ` +
    `every number must be inside its inclusive range: ${schemaRanges(full[mode]).join('; ')}.`;
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
  const schemas = schemaMode === 'full' ? loadSceneSchemas()
    : schemaMode === 'slim' || schemaMode === 'ranges' ? loadSlimSceneSchemas()
      : schemaMode === 'bounded' ? loadSlimSceneSchemas(BOUNDED_DROPPED_KEYWORDS) : null;
  const prompts = schemaMode === 'text' ? schemaAsTextPrompts() : schemaMode === 'ranges' ? rangesPrompts() : null;
  const provider = createGeminiProvider(config, {
    transport, schemas, ...(prompts ? { prompts } : {}), now: () => performance.now(),
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
 *  same, derived at load time without bounds or prose (slimSchema). `bounded`: like slim but keeping numeric
 *  minimum/maximum. `ranges`: slim, plus the dropped numeric ranges as one PLACEHOLDER system-instruction line. `off`:
 *  JSON mode, no schema. `text`: JSON mode, no schema, the slim schema as text in the PLACEHOLDER system instruction.
 *  validateScene is authoritative in all six. */
export type ResponseSchemaMode = 'full' | 'slim' | 'bounded' | 'ranges' | 'off' | 'text';

/** GEMINI_RESPONSE_SCHEMA: unset or "on" = full; "slim", "bounded", "off", "text" as ResponseSchemaMode. The first live
 *  calls with the full schema were refused with 400 INVALID_ARGUMENT and no field named, the shape of a schema too
 *  complex for constrained decoding; "off" and "slim" then gave 200 STOP. Any other value keeps the default and is
 *  reported by name only. */
export function responseSchemaSetting(value: string | undefined, problems: string[] = []): ResponseSchemaMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'on') return 'full';
  if (v === 'slim' || v === 'bounded' || v === 'ranges' || v === 'off' || v === 'text') return v;
  problems.push('GEMINI_RESPONSE_SCHEMA is not "on", "slim", "bounded", "ranges", "off" or "text"; sending the full schema');
  return 'full';
}
