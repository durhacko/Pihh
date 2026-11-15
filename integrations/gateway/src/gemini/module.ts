// integrations/gateway/src/gemini/module.ts
// Entry point of the `gemini` module (GF-WP-12, #218), registered by the skeleton in `../modules.ts`.
// In this build it has no provider and no validator, so `POST /api/generate-formation` always answers 503
// PROVIDER_UNAVAILABLE / MODULE_DISABLED and health says `enabled: false`, whatever the environment holds.
import type { Env } from '../config.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import { readGeminiConfig, type GeminiConfig } from './config.ts';
import { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';

export const GENERATE_FORMATION_ROUTE = Object.freeze({ method: 'POST', path: '/api/generate-formation' } as const);

/** The module as this build ships it: no provider, no validator. */
export function defaultGeminiDeps(config: GeminiConfig): GeminiDeps {
  return { config, provider: null, validator: null };
}

/** Builds the module from explicit deps (tests, and the live PR once a provider and validator exist). */
export function geminiModule(deps: GeminiDeps): GatewayModule {
  return {
    name: 'gemini',
    routes: [{ ...GENERATE_FORMATION_ROUTE, handle: request => handleGenerateFormation(request.rawBody, deps) }],
    health: () => ({ enabled: geminiAvailable(deps) }),
  };
}

/** Ignored GEMINI_* values (a bad model id or timeout replaced by its default) go to the start-up log as `problems`,
 *  naming the variable, never the value. */
export const createModule: ModuleFactory = (env: Env) => {
  const problems: string[] = [];
  const module = geminiModule(defaultGeminiDeps(readGeminiConfig(env, problems)));
  return { ...module, problems: Object.freeze(problems) };
};
