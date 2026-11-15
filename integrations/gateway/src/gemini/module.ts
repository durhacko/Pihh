// integrations/gateway/src/gemini/module.ts
// Entry point of the `gemini` module (GF-WP-12, #249), registered by the skeleton in `../modules.ts`.
//
// As shipped (offline): the real server-side validator (validateScene + sceneHash; trial compile pending #212) but
// NO provider, so `POST /api/generate-formation` answers 503 PROVIDER_UNAVAILABLE / MODULE_DISABLED and health says
// `enabled: false`, whatever the environment holds. The live adapter (under D3/GF-D1) is the only missing piece: it
// implements `GeminiProvider` and is passed to `geminiModule`, which wraps it in the 429/503 retry policy.
import type { Env } from '../config.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import { readGeminiConfig, type GeminiConfig } from './config.ts';
import { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';
import { abortableSleep, withRetries, type RetryDeps } from './provider.ts';
import { createSceneValidator, TRIAL_COMPILE_AVAILABLE } from './validate.ts';

export const GENERATE_FORMATION_ROUTE = Object.freeze({ method: 'POST', path: '/api/generate-formation' } as const);

/** Jitter and sleep for the retry policy. Jitter needs no reproducibility, so Math.random is fine here. */
export const DEFAULT_RETRY_DEPS: RetryDeps = Object.freeze({ random: Math.random, sleep: abortableSleep });

/** The module as this build ships it: the real validator, no provider. */
export function defaultGeminiDeps(config: GeminiConfig): GeminiDeps {
  return { config, provider: null, validator: createSceneValidator() };
}

/** Builds the module from explicit deps (tests, and the live PR). A provider is always wrapped in the retry policy. */
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
  const module = geminiModule(defaultGeminiDeps(readGeminiConfig(env, problems)));
  return { ...module, problems: Object.freeze(problems) };
};
