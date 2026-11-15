// integrations/gateway/src/guard.ts
// The one guard for every gateway route (OPTIONAL_INTEGRATION_BOUNDARIES.md §6.2, XI-12). Skeleton-owned; modules
// never re-implement any of it. Pure: it decides from the request's facts, which `server.ts` collects, and does no I/O.
//
// Order: peer, Host, token, Origin, Content-Type, declared body size. The first failure answers; the request never
// reaches a module. No CORS headers are ever sent (OIB-Q2 is undecided), so a browser page on another origin cannot
// read any response.
import type { GatewayConfig } from './config.ts';
import { errorResponse, type ErrorEnvelope } from './errors.ts';

/** What the guard looks at, as the server read it from the socket and headers. */
export interface RequestFacts {
  readonly method: string;
  /** Path plus query, as sent. */
  readonly url: string;
  readonly remoteAddress: string | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly contentType: string | undefined;
  readonly contentLength: string | undefined;
  readonly transferEncoding: string | undefined;
  readonly authorization: string | undefined;
}

export type GuardSettings = Pick<GatewayConfig, 'port' | 'allowedOrigins' | 'maxBodyBytes'> & {
  /** The per-launch token, or null when none is required. */
  readonly token: string | null;
};

type Rejection = { status: number; body: ErrorEnvelope };

const HEALTH = '/api/health';
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** 127.0.0.0/8, ::1 and their IPv4-mapped forms. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) return v4.split('.').every(part => Number(part) <= 255);
  return address === '::1';
}

/** `127.0.0.1:<port>` or `localhost:<port>`, exactly (case-insensitive name). */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const value = host.trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

/** `application/json`, optionally with `charset=utf-8` (any case); nothing else. */
export function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const [type, ...params] = value.split(';').map(s => s.trim().toLowerCase());
  if (type !== 'application/json') return false;
  return params.every(p => p === '' || p === 'charset=utf-8' || p === 'charset="utf-8"');
}

/** Constant-time comparison for equal-length strings; unequal lengths fail without comparing. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

const reject = (code: Parameters<typeof errorResponse>[0], message: string, reason: string): Rejection =>
  errorResponse(code, message, { details: [{ path: '', reason }] });

/** Null when the request may proceed to the router, otherwise the response to send. */
export function guardRequest(facts: RequestFacts, settings: GuardSettings): Rejection | null {
  const method = facts.method.toUpperCase();

  if (!isLoopbackAddress(facts.remoteAddress)) return reject('FORBIDDEN', 'Only local requests are accepted.', 'NON_LOOPBACK_PEER');
  if (!hostAllowed(facts.host, settings.port)) return reject('FORBIDDEN', 'The Host header is not allowed.', 'HOST_NOT_ALLOWED');

  if (settings.token !== null && !(method === 'GET' && pathOf(facts.url) === HEALTH)) {
    const match = /^Bearer ([^\s]+)$/.exec(facts.authorization?.trim() ?? '');
    if (!match || !sameSecret(match[1] ?? '', settings.token)) return reject('UNAUTHORIZED', 'A valid launch token is required.', 'TOKEN_MISSING');
  }

  if (!SAFE_METHODS.has(method)) {
    const origin = facts.origin?.trim();
    if (origin === undefined || origin === '' || origin === 'null') return reject('FORBIDDEN', 'An Origin header is required.', 'ORIGIN_MISSING');
    if (!settings.allowedOrigins.includes(origin)) return reject('FORBIDDEN', 'The Origin is not allowed.', 'ORIGIN_NOT_ALLOWED');
  }

  const declared = facts.contentLength === undefined ? undefined : Number(facts.contentLength);
  const hasBody = facts.transferEncoding !== undefined || (declared !== undefined && declared > 0) || ['POST', 'PUT', 'PATCH'].includes(method);
  if (hasBody && !isJsonContentType(facts.contentType)) {
    return reject('UNSUPPORTED_MEDIA_TYPE', 'The body must be application/json.', 'NOT_JSON');
  }
  if (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 0)) {
    return reject('VALIDATION_FAILED', 'The Content-Length header is invalid.', 'BAD_CONTENT_LENGTH');
  }
  if (declared !== undefined && declared > settings.maxBodyBytes) {
    return reject('PAYLOAD_TOO_LARGE', 'The request body is too large.', 'REQUEST_TOO_LARGE');
  }
  return null;
}
