// integrations/gateway/src/errors.ts
// The one error envelope of every gateway route (OPTIONAL_INTEGRATION_BOUNDARIES.md §6.2, XI-3), the shared code list
// and its HTTP statuses, the requestId rule (XI-11), and `sanitise` / `redact`. Module specs cite this file and never
// redefine any of it. Pure: no I/O.

/** The shared code list (boundaries §6.2). SCREAMING_SNAKE. */
export const ERROR_CODES = [
  'VALIDATION_FAILED', 'NOT_FOUND', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'RATE_LIMITED', 'UNAUTHORIZED',
  'FORBIDDEN', 'CONFLICT', 'SCHEMA_VERSION_UNSUPPORTED', 'DATABASE_UNAVAILABLE', 'PROVIDER_UNAVAILABLE',
  'PROVIDER_ERROR', 'TIMEOUT', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default HTTP status per code. `VALIDATION_FAILED` is 400 for malformed input; a module may answer 422 for a
 *  well-formed request it refuses (boundaries §6.2, gemini spec §10.1), so `errorResponse` takes an override. */
export const STATUS_OF: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400, NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, RATE_LIMITED: 429,
  // SCHEMA_VERSION_UNSUPPORTED is 500: a stored record newer than this gateway understands (mongodb spec §7.4,
  // MDB-T16), not a client fault. A module that rejects a client's version passes `status` explicitly.
  UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, SCHEMA_VERSION_UNSUPPORTED: 500, DATABASE_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503, PROVIDER_ERROR: 502, TIMEOUT: 504, INTERNAL: 500,
};

/** One entry of `details`: a JSON path (`""` = the request as a whole) and a SCREAMING_SNAKE reason (XI-16). */
export interface ErrorDetail { path: string; reason: string }

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[]; requestId?: string };
}

/** What a route handler returns. `server.ts` writes `body` as JSON with `status`. A success
 *  body has no `success` flag: the status carries it (XI-3). */
export interface RouteResponse<T> { status: number; body: T | ErrorEnvelope }

/** requestId: optional, client-generated, opaque (XI-11). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** The requestId to echo, or undefined. A value that does not match is dropped, not echoed, and is not an error. */
export function acceptRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

const REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MESSAGE_MAX = 200;

/** Typed rejection codes inside `src/score` are kebab-case; the gateway reports them in SCREAMING_SNAKE (XI-16):
 *  `geometry` → `GEOMETRY`, `radio-partitioned` → `RADIO_PARTITIONED`. Anything else becomes `INVALID`. */
export function toReason(code: string): string {
  const reason = code.trim().replace(/[-\s.]+/g, '_').toUpperCase();
  return REASON_PATTERN.test(reason) ? reason.slice(0, 64) : 'INVALID';
}

/** `scheme://userinfo@`: everything between `://` and the last `@` before the host is credentials (a password may
 *  hold an unencoded `@`), e.g. `mongodb+srv://user:pass@cluster`. */
const URI_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;

/** A message safe to return or log: URI credentials replaced by `[redacted]`, control characters removed,
 *  whitespace collapsed, at most 200 characters. Callers pass messages they wrote; upstream text is never passed
 *  through, even sanitised. */
export function sanitise(message: string): string {
  const flat = message
    .replace(URI_CREDENTIALS, '$1[redacted]@')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MESSAGE_MAX ? `${flat.slice(0, MESSAGE_MAX - 1)}…` : flat;
}

/** Replaces every occurrence of each secret with `[redacted]`, longest first, so a secret that contains another is
 *  never left half-replaced. Empty secrets are ignored. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  const ordered = [...new Set(secrets)].filter(s => s.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of ordered) out = out.split(secret).join('[redacted]');
  return out;
}

/** Builds the envelope. `message` is sanitised; reasons are normalised to SCREAMING_SNAKE. */
export function errorResponse(
  code: ErrorCode,
  message: string,
  options: { details?: ErrorDetail[]; requestId?: string; status?: number } = {},
): { status: number; body: ErrorEnvelope } {
  const error: ErrorEnvelope['error'] = { code, message: sanitise(message) };
  if (options.details && options.details.length > 0) {
    error.details = options.details.map(d => ({ path: d.path, reason: REASON_PATTERN.test(d.reason) ? d.reason : toReason(d.reason) }));
  }
  const requestId = acceptRequestId(options.requestId);
  if (requestId !== undefined) error.requestId = requestId;
  return { status: options.status ?? STATUS_OF[code], body: { error } };
}

/** Type guard for callers and tests. */
export function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const error = (body as { error: unknown }).error;
  return typeof error === 'object' && error !== null && (ERROR_CODES as readonly string[]).includes((error as { code?: unknown }).code as string);
}
