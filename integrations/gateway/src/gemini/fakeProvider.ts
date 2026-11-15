// integrations/gateway/src/gemini/fakeProvider.ts
// A scripted, offline stand-in for the provider port (GF-WP-12 offline part). It exists so the module's whole path
// (retries, finish-reason mapping, validation, hashing) is exercised without an SDK, a key or a network, behind the same
// port as the live adapter.
//
// It is NEVER wired by `createModule`. createModule wires the LIVE adapter (geminiProvider.ts, real calls to Google)
// when GEMINI_ENABLED and GEMINI_API_KEY are both set, and answers MODULE_DISABLED otherwise. Its model id is
// `offline-fake`, so no output from it can be mistaken for a Gemini response.
import { mapProviderResponse, type RawProviderResponse } from './mapResponse.ts';
import type { GeminiProvider, ProviderOutcome, ProviderRequest } from './types.ts';

export const FAKE_MODEL = 'offline-fake';

/** One scripted step: a raw response to map, a ready outcome, or a function of the request (and attempt, 0-based). */
export type FakeStep =
  | { readonly raw: RawProviderResponse }
  | { readonly outcome: ProviderOutcome }
  | { readonly hang: true }
  | ((request: ProviderRequest, attempt: number) => ProviderOutcome | Promise<ProviderOutcome>);

export interface ScriptedProvider extends GeminiProvider {
  /** Every request the fake received, in order. */
  readonly calls: readonly ProviderRequest[];
}

/**
 * Plays `steps` in order, one per call; the last step repeats once the script runs out. `{ hang: true }` never answers
 * until the call's signal aborts, which models a provider that exceeds its timeout.
 */
export function scriptedProvider(steps: readonly FakeStep[]): ScriptedProvider {
  if (steps.length === 0) throw new Error('scriptedProvider needs at least one step');
  const calls: ProviderRequest[] = [];
  return {
    model: FAKE_MODEL,
    calls,
    async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
      const index = calls.length;
      calls.push({ ...request });
      const step = steps[Math.min(index, steps.length - 1)]!;
      if (typeof step === 'function') return step(request, index);
      if ('raw' in step) return mapProviderResponse(step.raw);
      if ('outcome' in step) return step.outcome;
      return new Promise<ProviderOutcome>(resolve => {
        if (signal.aborted) return resolve({ kind: 'timeout' });
        signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true });
      });
    },
  };
}

/** A STOP response carrying `scene` as JSON text, the common happy path. */
export function stopWith(scene: unknown, latencyMs = 1_000): FakeStep {
  return { raw: { httpStatus: 200, finishReason: 'STOP', text: JSON.stringify(scene), latencyMs } };
}
