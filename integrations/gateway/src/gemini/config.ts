// integrations/gateway/src/gemini/config.ts
// The `gemini` module's settings (spec §10.3). It receives only `GEMINI_*` variables (`moduleEnv`). Offline is the
// default: the module is enabled only when `GEMINI_ENABLED` is set AND `GEMINI_API_KEY` is present, and the key is
// not read unless the flag is set (§10.3 "a disabled module's secrets are never loaded"). `GOOGLE_API_KEY` is never
// read; the live adapter (geminiProvider.ts) sends GEMINI_API_KEY explicitly, in the x-goog-api-key header.
// GEMINI_MAX_CALLS caps the live upstream calls per gateway process (D3: free quota only), retries included.
import { envFlag, envInteger, secret, type Env, type Secret } from '../config.ts';

/** Proposed defaults from spec §10.3 (rows marked † are William's to confirm). */
export const GEMINI_DEFAULTS = Object.freeze({
  model: 'gemini-3.1-flash-lite',
  providerTimeoutMs: 30_000,
  requestTimeoutMs: 45_000,
  /** Live upstream calls per process (every attempt counts, retries included); after that, 429 RATE_LIMITED. */
  maxCalls: 50,
});

export type GeminiDisabledReason = 'NOT_ENABLED' | 'NO_KEY';

export type GeminiConfig =
  | { readonly enabled: false; readonly reason: GeminiDisabledReason }
  | {
      readonly enabled: true;
      readonly apiKey: Secret;
      readonly model: string;
      /** Per provider attempt (§10.3, 30 s†). */
      readonly providerTimeoutMs: number;
      /** Whole request, retries included (§10.3, 45 s†). */
      readonly requestTimeoutMs: number;
      /** Live upstream calls this process may make (GEMINI_MAX_CALLS: default 50; 0 to 10,000; 0 = none; an invalid
       *  value means 0). */
      readonly maxCalls: number;
    };

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export function readGeminiConfig(env: Env, problems: string[] = []): GeminiConfig {
  if (!envFlag(env.GEMINI_ENABLED)) return { enabled: false, reason: 'NOT_ENABLED' };
  const key = (env.GEMINI_API_KEY ?? '').trim();
  if (key === '') return { enabled: false, reason: 'NO_KEY' };
  let model = (env.GEMINI_MODEL ?? '').trim();
  if (model === '') model = GEMINI_DEFAULTS.model;
  else if (!MODEL_PATTERN.test(model)) {
    problems.push(`GEMINI_MODEL is not a model id; using ${GEMINI_DEFAULTS.model}`);
    model = GEMINI_DEFAULTS.model;
  }
  const providerTimeoutMs = envInteger(env, 'GEMINI_PROVIDER_TIMEOUT_MS', GEMINI_DEFAULTS.providerTimeoutMs, 1, 120_000, problems);
  let requestTimeoutMs = envInteger(env, 'GEMINI_REQUEST_TIMEOUT_MS', GEMINI_DEFAULTS.requestTimeoutMs, 1, 300_000, problems);
  if (requestTimeoutMs < providerTimeoutMs) {
    problems.push('GEMINI_REQUEST_TIMEOUT_MS is below GEMINI_PROVIDER_TIMEOUT_MS; raising it to match');
    requestTimeoutMs = providerTimeoutMs;
  }
  // Unset: the default. Set but not an integer in [0, 10000]: FAIL CLOSED to 0 (no live calls), never to the default,
  // because a typo in a quota cap must not grant more calls than were meant.
  const maxCalls = (env.GEMINI_MAX_CALLS ?? '').trim() === ''
    ? GEMINI_DEFAULTS.maxCalls
    : envInteger(env, 'GEMINI_MAX_CALLS', 0, 0, 10_000, problems);
  return { enabled: true, apiKey: secret(key), model, providerTimeoutMs, requestTimeoutMs, maxCalls };
}
