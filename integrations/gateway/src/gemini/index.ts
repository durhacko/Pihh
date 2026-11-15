// integrations/gateway/src/gemini/index.ts
// The `gemini` module's public surface (for tests and the later app-facing docs). The skeleton imports only
// `./module.ts`.
export { createModule, defaultGeminiDeps, geminiModule, GENERATE_FORMATION_ROUTE } from './module.ts';
export { readGeminiConfig, GEMINI_DEFAULTS, type GeminiConfig } from './config.ts';
export { geminiAvailable, handleGenerateFormation, type GeminiDeps } from './handler.ts';
export { parseGenerateRequest } from './request.ts';
export * from './types.ts';
