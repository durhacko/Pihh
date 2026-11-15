// integrations/gateway/src/gemini/provider.ts
// The provider side of the `gemini` module (GF-WP-12, spec §10.3): the per-attempt timeout and the retry policy,
// wrapped around any `GeminiProvider`. The live adapter (later, under D3) only turns one SDK call into one
// `ProviderOutcome` (see mapResponse.ts); it never retries on its own (spec §10.3: disable the SDK's retries, whose
// default list also retries 408 and 5xx).
//
// Policy (spec §10.3, GF-T33 (2)–(3)): retry **only** an upstream 429 or 503; at most 2 retries; exponential backoff
// with jitter; never past the whole-request deadline (the caller's `signal`). Every other outcome, a timeout included,
// is final. No network code here: the wrapped provider does the calling.
import type { GeminiProvider, ProviderOutcome, ProviderRequest } from './types.ts';

export const RETRY_POLICY = Object.freeze({
  /** Retries after the first attempt (spec §10.3: ≤ 2). */
  maxRetries: 2,
  /** Backoff before retry n (1-based): base × 2^(n-1), capped, then jittered into [½, 1] of that. */
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  retryStatuses: Object.freeze([429, 503]),
});

export interface RetryDeps {
  /** In [0, 1). Injected so tests are deterministic; the module passes Math.random. */
  readonly random: () => number;
  /** Resolves after `ms`, or early when `signal` aborts. Injected so tests run without real waiting. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The real sleep: a timer that is cleared when the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Backoff before retry `n` (1-based), with "equal jitter": half fixed, half random. */
export function backoffMs(n: number, random: () => number): number {
  const ceiling = Math.min(RETRY_POLICY.maxDelayMs, RETRY_POLICY.baseDelayMs * 2 ** (n - 1));
  const r = random();
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0;
  return Math.round(ceiling / 2 + (ceiling / 2) * unit);
}

export function isRetryable(outcome: ProviderOutcome): boolean {
  return outcome.kind === 'upstream-error' && (RETRY_POLICY.retryStatuses as readonly number[]).includes(outcome.status);
}

/** One attempt, bounded by `request.attemptTimeoutMs` and by the request-wide `signal`. A provider that throws is
 *  an upstream failure of unknown status (502 PROVIDER_ERROR), never retried. */
async function attempt(provider: GeminiProvider, request: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderOutcome>(resolve => {
    timer = setTimeout(() => {
      resolve({ kind: 'timeout' });
      controller.abort();
    }, request.attemptTimeoutMs);
  });
  const call = Promise.resolve()
    .then(() => provider.generate(request, controller.signal))
    .then(outcome => outcome, (): ProviderOutcome => ({ kind: 'upstream-error', status: 0 }));
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

/** Wraps a provider with the per-attempt timeout and the 429/503 retry policy. `model` passes through. */
export function withRetries(provider: GeminiProvider, deps: RetryDeps): GeminiProvider {
  return {
    model: provider.model,
    async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
      let outcome = await attempt(provider, request, signal);
      for (let n = 1; n <= RETRY_POLICY.maxRetries && isRetryable(outcome) && !signal.aborted; n++) {
        await deps.sleep(backoffMs(n, deps.random), signal);
        if (signal.aborted) break;
        outcome = await attempt(provider, request, signal);
      }
      return outcome;
    },
  };
}
