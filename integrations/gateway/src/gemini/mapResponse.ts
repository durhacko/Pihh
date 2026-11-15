// integrations/gateway/src/gemini/mapResponse.ts
// Maps one provider call's raw result to exactly one `ProviderOutcome` (GF-WP-12 step 5, spec §10.1 and §10.3). The
// live adapter (later, under D3) copies the few SDK fields below into `RawProviderResponse` and calls this; it never
// interprets finish reasons itself, so the mapping is tested offline here. SDK-free: plain data in, plain data out.
//
// Rules: a non-200 status is an upstream error; a `promptFeedback.blockReason` blocks; only a `STOP` finish is parsed;
// `MAX_TOKENS` is truncation (RESPONSE_TOO_LARGE); `SAFETY` or `RECITATION` blocks (PROVIDER_BLOCKED); any other or a
// missing finish reason is never parsed (PROVIDER_ERROR).
import type { ProviderOutcome } from './types.ts';

/** The provider fields the module reads, already copied out of the SDK's response. */
export interface RawProviderResponse {
  /** HTTP status of the final call. */
  readonly httpStatus: number;
  /** `promptFeedback.blockReason`, if any. */
  readonly blockReason?: string | null;
  /** `candidates[0].finishReason`, if any. */
  readonly finishReason?: string | null;
  /** The candidate's text, unparsed. */
  readonly text?: string | null;
  /** Wall time of the call, in ms. */
  readonly latencyMs?: number;
}

export const BLOCKING_FINISH_REASONS: readonly string[] = Object.freeze(['SAFETY', 'RECITATION']);

const present = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== '';

export function mapProviderResponse(raw: RawProviderResponse): ProviderOutcome {
  const status = Number.isInteger(raw.httpStatus) ? raw.httpStatus : 0;
  if (status !== 200) return { kind: 'upstream-error', status };
  if (present(raw.blockReason)) return { kind: 'blocked' };
  const finish = present(raw.finishReason) ? raw.finishReason.trim() : 'FINISH_REASON_MISSING';
  if (finish === 'STOP') {
    const latency = typeof raw.latencyMs === 'number' && Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0 ? raw.latencyMs : 0;
    // A STOP with no text is still output: an empty string fails JSON parsing, so it is reported INVALID_MODEL_OUTPUT.
    return { kind: 'output', text: typeof raw.text === 'string' ? raw.text : '', latencyMs: latency };
  }
  if (finish === 'MAX_TOKENS') return { kind: 'truncated' };
  if (BLOCKING_FINISH_REASONS.includes(finish)) return { kind: 'blocked' };
  return { kind: 'other-finish', finishReason: finish };
}
