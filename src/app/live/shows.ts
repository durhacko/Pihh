// src/app/live/shows.ts: the app's show-library client (MDB-WP-05, #264; spec mongodb-atlas-show-library.md §10, §12).
// XI-14: under src/app, only src/app/live/ uses a network API. This module is reached only through the flag-guarded
// mount in main.ts (VITE_SHOW_LIBRARY === '1'), so the default build contains none of it.
//
// - Every call goes through an injectable `fetch` (tests use a fake; no socket), with an 8 s abort (§10.6).
// - Retries (§10.6): GET once, POST at most twice, only on a network error, a timeout, 503, or 429 (after Retry-After),
//   and POST only with the SAME Idempotency-Key and body. Nothing else is retried.
// - Responses are data from the network: the health entry and every list item are re-validated field by field; an
//   item that fails becomes "Invalid saved show" (not loadable). A full show is validated by the panel through the
//   strict composition validator before Load as drafts is offered.
import type { Recipe } from '../../contracts';
import type { Generator, SavedShowComposition, ShowRequest, ShowSource } from '../compose/validate';

/** Canonical §12: `off` = flag unset (never in the bundle); `probing` is the panel's own state while a probe runs. */
export type ShowsAvailability = 'off' | 'probing' | 'unavailable' | 'disabled' | 'down' | 'read-only' | 'up';

export interface ShowSummary {
  id: string; title: string; source: ShowSource; createdAt: string; movementCount: number; kinds: string[];
  schemaVersion: number; loadable: boolean; problem?: 'invalid' | 'unsupported-schema';
}
export interface SavedShow extends ShowSummary {
  prompt?: string; composition: SavedShowComposition; contentHash: string; generator?: Generator; updatedAt: string;
}
export interface ErrorDetail { path: string; reason: string }
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string; retryable: boolean; details: ErrorDetail[] };

export interface ClientOptions {
  /** The fetch to use (default: the global one). Tests pass a fake. */
  fetch?: typeof fetch;
  /** Abort after this long (default 8000 ms, §10.6). */
  timeoutMs?: number;
  /** Origin of the gateway, e.g. 'http://127.0.0.1:8787' (default: same origin). */
  base?: string;
  /** Waits between retries (default: a real timer). Tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const KINDS = ['text', 'sphere', 'helix'];
const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Lower-case UUID v4, the Idempotency-Key (§10.5). */
export function newOperationId(): string { return crypto.randomUUID().toLowerCase(); }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

interface Raw { status: number; body: unknown; retryAfterMs: number | null }

/**
 * Retry-After in delta-seconds, capped at 30 s; null when absent, empty or not a number (an HTTP-date is not used).
 * `Number(null)` and `Number('')` are 0, so absent or empty must be mapped to null explicitly (#270 review 2).
 */
export function retryAfterMs(header: string | null): number | null {
  if (header === null || header.trim() === '' || !/^\d+$/.test(header.trim())) return null;
  return Math.min(Number(header.trim()), 30) * 1000;
}

/** The fallback wait before retry `attempt` (1-based): about 1 s × attempt, with ±20 % jitter (§10.6). */
export const fallbackDelayMs = (attempt: number, random: () => number = Math.random): number => Math.round(1000 * attempt * (0.8 + 0.4 * random()));

/** One request, never throws: a network failure is status 0, a timeout status -1. */
async function send(method: 'GET' | 'POST', path: string, o: ClientOptions, body?: string, headers: Record<string, string> = {}): Promise<Raw> {
  const doFetch = o.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(`${o.base ?? ''}${path}`, { method, headers: { Accept: 'application/json', ...headers }, body, signal: controller.signal, credentials: 'same-origin' });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed, retryAfterMs: retryAfterMs(res.headers?.get?.('Retry-After') ?? null) };
  } catch {
    return { status: controller.signal.aborted ? -1 : 0, body: null, retryAfterMs: null };
  } finally {
    clearTimeout(timer);
  }
}

const retryableStatus = (s: number) => s === 0 || s === -1 || s === 503 || s === 429;
/** A disabled shows module answers 503 DATABASE_UNAVAILABLE with reason MODULE_DISABLED: configuration, not an outage. */
export const isModuleDisabled = (body: unknown): boolean =>
  isObject(body) && isObject(body.error) && Array.isArray(body.error.details) && body.error.details.some(d => isObject(d) && d.reason === 'MODULE_DISABLED');
const retryable = (raw: Raw) => retryableStatus(raw.status) && !isModuleDisabled(raw.body);

/** The XI-3 error envelope as a failed ApiResult; message and details are data, shown only as text. */
function failure(raw: Raw): Extract<ApiResult<never>, { ok: false }> {
  if (raw.status === 0) return { ok: false, status: 0, code: 'NETWORK', message: 'The gateway could not be reached.', retryable: true, details: [] };
  if (raw.status === -1) return { ok: false, status: -1, code: 'TIMEOUT', message: 'The gateway did not answer in time.', retryable: true, details: [] };
  const error = isObject(raw.body) && isObject(raw.body.error) ? raw.body.error : {};
  const code = typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'INTERNAL';
  const message = typeof error.message === 'string' ? error.message.slice(0, 300) : `HTTP ${raw.status}`;
  const details = Array.isArray(error.details) ? error.details.filter(isObject).slice(0, 32)
    .map(d => ({ path: typeof d.path === 'string' ? d.path.slice(0, 200) : '', reason: typeof d.reason === 'string' && /^[A-Z_]{1,64}$/.test(d.reason) ? d.reason : 'INVALID' })) : [];
  return { ok: false, status: raw.status, code, message, retryable: retryable(raw), details };
}

/** Sends, retrying up to `retries` times on a retryable outcome only (same method, path, body and headers). */
async function sendWithRetry(retries: number, method: 'GET' | 'POST', path: string, o: ClientOptions, body?: string, headers?: Record<string, string>): Promise<Raw> {
  const sleep = o.sleep ?? realSleep;
  let raw = await send(method, path, o, body, headers);
  for (let attempt = 1; attempt <= retries && retryable(raw); attempt++) {
    await sleep(raw.retryAfterMs ?? fallbackDelayMs(attempt));
    raw = await send(method, path, o, body, headers);
  }
  return raw;
}

/** One `/api/health` probe → availability (§10.4). Never throws, never resolves to 'off' or 'probing'. */
export async function probeShows(o: ClientOptions = {}): Promise<Exclude<ShowsAvailability, 'off' | 'probing'>> {
  const raw = await send('GET', '/api/health', o);
  if (raw.status !== 200 || !isObject(raw.body) || !isObject(raw.body.modules)) return 'unavailable';
  const shows = raw.body.modules.shows;
  if (!isObject(shows) || shows.enabled !== true || shows.db === 'disabled') return 'disabled';
  if (shows.db === 'down') return 'down';
  if (shows.db !== 'up') return 'unavailable';
  return shows.writable === true ? 'up' : 'read-only';
}

/** POST /api/shows with the Idempotency-Key; retries reuse the same key and body (§10.5, §10.6). */
export async function saveShow(request: ShowRequest, operationId: string, o: ClientOptions = {}): Promise<ApiResult<{ show: SavedShow; idempotentReplay: boolean }>> {
  const raw = await sendWithRetry(2, 'POST', '/api/shows', o, JSON.stringify(request), { 'Content-Type': 'application/json', 'Idempotency-Key': operationId });
  if ((raw.status === 201 || raw.status === 200) && isObject(raw.body) && isObject(raw.body.show)) {
    const summary = summaryOf(raw.body.show);
    return { ok: true, value: { show: { ...(raw.body.show as unknown as SavedShow), ...summary }, idempotentReplay: raw.body.idempotentReplay === true } };
  }
  return raw.status >= 200 && raw.status < 300 ? { ok: false, status: raw.status, code: 'INTERNAL', message: 'Unexpected response.', retryable: false, details: [] } : failure(raw);
}

const INVALID_TITLE = 'Invalid saved show';

/**
 * Re-validates one listed item, field by field (§10.3). A bad field makes the whole item `loadable: false,
 * problem: 'invalid'` with the fixed title, and no stored value is shown.
 */
export function summaryOf(item: unknown): ShowSummary {
  const bad = (id = ''): ShowSummary => ({ id, title: INVALID_TITLE, source: 'manual', createdAt: '', movementCount: 0, kinds: [], schemaVersion: 0, loadable: false, problem: 'invalid' });
  if (!isObject(item)) return bad();
  const id = typeof item.id === 'string' && /^[0-9a-f]{24}$/.test(item.id) ? item.id : '';
  const title = item.title;
  const titleOk = typeof title === 'string' && title.trim() === title && [...title].length >= 1 && [...title].length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(title);
  const source: ShowSource | null = item.source === 'manual' || item.source === 'gemini' ? item.source : null;
  const createdOk = typeof item.createdAt === 'string' && item.createdAt.length <= 40 && !Number.isNaN(Date.parse(item.createdAt));
  const count = item.movementCount;
  const countOk = typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 16;
  const kindsOk = Array.isArray(item.kinds) && item.kinds.length === count && item.kinds.every(k => typeof k === 'string' && KINDS.includes(k));
  const version = item.schemaVersion;
  if (!id || !titleOk || !source || !createdOk || !countOk || !kindsOk || typeof version !== 'number' || !Number.isInteger(version)) return bad(id);
  const base = { id, title: title as string, source, createdAt: item.createdAt as string, movementCount: count as number, kinds: [...(item.kinds as string[])], schemaVersion: version };
  if (version > 1 || item.problem === 'unsupported-schema') return { ...base, loadable: false, problem: 'unsupported-schema' };
  // §10.1's flat ShowSummary: `loadable` is optional and present only as `false` on an invalid stored item.
  if (version < 1 || (item.loadable !== undefined && item.loadable !== true) || (item.problem !== undefined && item.problem !== null)) return { ...base, loadable: false, problem: 'invalid' };
  return { ...base, loadable: true };
}

/** GET /api/shows (newest first, keyset cursor). Each item is re-validated by `summaryOf`. */
export async function listShows(cursor?: string, limit = 20, o: ClientOptions = {}): Promise<ApiResult<{ items: ShowSummary[]; nextCursor: string | null }>> {
  const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(50, Math.floor(limit)))) });
  if (cursor) query.set('cursor', cursor);
  const raw = await sendWithRetry(1, 'GET', `/api/shows?${query.toString()}`, o);
  if (raw.status !== 200) return failure(raw);
  if (!isObject(raw.body) || !Array.isArray(raw.body.items)) return { ok: false, status: 200, code: 'INTERNAL', message: 'Unexpected response.', retryable: false, details: [] };
  const next = raw.body.nextCursor;
  return { ok: true, value: { items: raw.body.items.slice(0, 50).map(summaryOf), nextCursor: typeof next === 'string' && next.length <= 128 ? next : null } };
}

/** GET /api/shows/:id. The id is checked before any request (§10.3); the body is returned for the panel to validate. */
export async function getShow(id: string, o: ClientOptions = {}): Promise<ApiResult<{ show: unknown }>> {
  if (!/^[0-9a-f]{24}$/.test(id)) return { ok: false, status: 400, code: 'VALIDATION_FAILED', message: 'Invalid id.', retryable: false, details: [{ path: 'id', reason: 'INVALID_ID' }] };
  const raw = await sendWithRetry(1, 'GET', `/api/shows/${id}`, o);
  if (raw.status !== 200) return failure(raw);
  if (!isObject(raw.body) || !isObject(raw.body.show)) return { ok: false, status: 200, code: 'INTERNAL', message: 'Unexpected response.', retryable: false, details: [] };
  return { ok: true, value: { show: raw.body.show } };
}

/** The kinds a summary lists, typed (for display). */
export const kindsOf = (s: ShowSummary): Recipe['kind'][] => s.kinds.filter((k): k is Recipe['kind'] => KINDS.includes(k));
