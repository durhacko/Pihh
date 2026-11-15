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
import { createGeminiProvider, type Transport } from './geminiProvider.ts';
import { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';
import { abortableSleep, withRetries, type RetryDeps } from './provider.ts';
import type { FormationMode } from './types.ts';
import { createSceneValidator, TRIAL_COMPILE_AVAILABLE } from './validate.ts';

export const GENERATE_FORMATION_ROUTE = Object.freeze({ method: 'POST', path: '/api/generate-formation' } as const);

/** Jitter and sleep for the retry policy. Jitter needs no reproducibility, so Math.random is fine here. */
export const DEFAULT_RETRY_DEPS: RetryDeps = Object.freeze({ random: Math.random, sleep: abortableSleep });

// The ONE place the gateway's gemini code names the platform fetch (allow-listed, exactly, in test/offline.test.ts).
const PLATFORM_TRANSPORT: Transport = fetch;

/** The committed model-facing scene schemas (src/score/generated/schema), read once per live module, as data. */
export function loadSceneSchemas(): Readonly<Record<FormationMode, object>> {
  const read = (name: string): object =>
    JSON.parse(readFileSync(new URL(`../../../../src/score/generated/schema/${name}.schema.json`, import.meta.url), 'utf8')) as object;
  return Object.freeze({ silhouette2d: read('scene2d'), scene3d: read('scene3d') });
}

/** The module offline: the real validator, no provider (tests, and any run without the flag and the key). */
export function defaultGeminiDeps(config: GeminiConfig): GeminiDeps {
  return { config, provider: null, validator: createSceneValidator() };
}

/** The module as this build runs it: live when the config is enabled (flag and key), offline otherwise. */
export function liveGeminiDeps(config: GeminiConfig, transport: Transport = PLATFORM_TRANSPORT): GeminiDeps {
  if (!config.enabled) return defaultGeminiDeps(config);
  const provider = createGeminiProvider(config, { transport, schemas: loadSceneSchemas(), now: () => performance.now() });
  return { config, provider, validator: createSceneValidator() };
}

/** Builds the module from explicit deps (tests, and the live path). A provider is always wrapped in the retry policy. */
export function geminiModule(deps: GeminiDeps, retry: RetryDeps = DEFAULT_RETRY_DEPS): GatewayModule {
  const wired: GeminiDeps = { ...deps, provider: deps.provider === null ? null : withRetries(deps.provider, retry) };
  return {
    name: 'gemini',
    routes: [{ ...GENERATE_FORMATION_ROUTE, handle: request => handleGenerateFormation(request.rawBody, wired) }],
    health: () => ({ enabled: geminiAvailable(wired), trialCompile: TRIAL_COMPILE_AVAILABLE }),
  };
}

/** Ignored GEMINI_* values (a bad model id or timeout replaced by its default) go to the start-up log as `problems`,
 *  naming the variable, never the value. */
export const createModule: ModuleFactory = (env: Env) => {
  const problems: string[] = [];
  const module = geminiModule(liveGeminiDeps(readGeminiConfig(env, problems)));
  return { ...module, problems: Object.freeze(problems) };
};
