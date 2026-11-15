// integrations/gateway/src/shows/body.ts — the shows module's JSON body reader (MDB-WP-04, spec section 9 R1, MDB-T13).
// The skeleton's server has already capped the body while streaming (GATEWAY_MAX_BODY_BYTES) and decoded it as strict
// UTF-8 (invalid bytes: 400 INVALID_JSON). This reader adds the shows rules on the decoded text: the module's own
// 64 KiB cap (413), a linear pre-parse nesting scan (deeper than 8 is 400 INVALID_JSON, so JSON.parse never sees a
// pathological `[[[[…`), and JSON.parse itself (400 INVALID_JSON). Pure: no I/O.
import { COMPOSITION_LIMITS } from './validate.ts';

/** The deepest container nesting a request may have: a valid body nests 7 deep (spec section 9). */
export const MAX_NESTING = 8;

export type BodyRead =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; reason: 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE' };

/** Deepest `{`/`[` nesting outside strings, in one linear pass; stops early past `limit`. */
export function nestingDepth(text: string, limit = Infinity): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;                 // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) { depth++; if (depth > max) { max = depth; if (max > limit) return max; } }
    else if (c === 0x7d || c === 0x5d) depth--;
  }
  return max;
}

/** Reads a request body: size, nesting, then JSON. */
export function readJsonBody(rawBody: string): BodyRead {
  if (Buffer.byteLength(rawBody, 'utf8') > COMPOSITION_LIMITS.maxBodyBytes) return { ok: false, status: 413, reason: 'PAYLOAD_TOO_LARGE' };
  if (rawBody.trim() === '' || nestingDepth(rawBody, MAX_NESTING) > MAX_NESTING) return { ok: false, status: 400, reason: 'INVALID_JSON' };
  try {
    return { ok: true, value: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false, status: 400, reason: 'INVALID_JSON' };
  }
}
