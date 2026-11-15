// integrations/gateway/src/gemini/index.ts
// The `gemini` module's public surface (for tests). The skeleton imports only
// `./module.ts`.
export { createModule, defaultGeminiDeps, DEFAULT_RETRY_DEPS, geminiModule, GENERATE_FORMATION_ROUTE } from './module.ts';
export { readGeminiConfig, GEMINI_DEFAULTS, type GeminiConfig } from './config.ts';
export { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';
export { parseGenerateRequest } from './request.ts';
export { abortableSleep, backoffMs, isRetryable, RETRY_POLICY, withRetries, type RetryDeps } from './provider.ts';
export { BLOCKING_FINISH_REASONS, mapProviderResponse, type RawProviderResponse } from './mapResponse.ts';
export { createSceneValidator, TRIAL_COMPILE_AVAILABLE, TRIAL_COMPILE_N0, trialCompileHook, type TrialCompile } from './validate.ts';
export * from './types.ts';
