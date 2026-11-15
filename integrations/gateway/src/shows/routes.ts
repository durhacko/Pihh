// integrations/gateway/src/shows/routes.ts — the Saved Shows API (MDB-WP-04, offline; spec sections 10.1–10.6):
// POST /api/shows, GET /api/shows, GET /api/shows/:id over any ShowsRepository (the memory repository here).
//
// The skeleton's guard and server have already checked Host, Origin, Content-Type and the body size and UTF-8 before a
// handler runs. RouteRequest carries no headers, so the idempotency key travels in the body field `operationId`, the
// spec's own fallback (section 10.5); `Location` and `Retry-After` need response headers the skeleton does not yet
// expose (recorded in the PR). Responses follow spec section 10.1 exactly; listing items are FLAT ShowSummary objects.
import type { ModuleRoute, RouteRequest } from '../module.ts';
import type { RouteResponse } from '../errors.ts';
import { readJsonBody } from './body.ts';
import {
  badRequest, conflict, internal, notFound, payloadTooLarge, schemaUnsupported, storedShowInvalid, unavailable,
  validationFailed, type ShowsError,
} from './errorMap.ts';
import { moduleDisabledResponse, SHOWS_TIMEOUTS } from './module.ts';
import {
  decodeCursor, encodeCursor, LIST_LIMITS, OPERATION_ID_PATTERN, readStoredShow, SHOW_ID_PATTERN, type ShowsRepository,
} from './repository.ts';
import { INVALID_SHOW_TITLE, type NewSavedShow, type PageKey, type SavedShow, type ShowSummary } from './types.ts';
import { APP_N0_RANGE, compositionPreview, contentHash, makeParams, requestHash, validateShowRequest, type ShowRequest } from './validate.ts';

export const SHOWS_PATH = '/api/shows';

/** Spec section 10.1 ShowSummary, flat, as the HTTP API returns it. */
export interface ShowSummaryBody {
  id: string; title: string; source: 'gemini' | 'manual'; createdAt: string;
  movementCount: number; kinds: string[]; schemaVersion: number;
  loadable: boolean; problem?: 'invalid' | 'unsupported-schema';
}

/**
 * The flat HTTP form of a listing item. An invalid stored document carries NO stored value: its title is the fixed
 * "Invalid saved show" and the other required fields hold neutral placeholders (source 'manual', createdAt the epoch,
 * movementCount 0, kinds [], schemaVersion 0), with loadable false and problem 'invalid' (spec difference, recorded).
 */
export function summaryBody(summary: ShowSummary): ShowSummaryBody {
  if (summary.loadable === false && summary.problem === 'invalid') {
    return {
      id: summary.id, title: INVALID_SHOW_TITLE, source: 'manual', createdAt: new Date(0).toISOString(),
      movementCount: 0, kinds: [], schemaVersion: 0, loadable: false, problem: 'invalid',
    };
  }
  return { ...summary, kinds: [...summary.kinds] };
}

export interface RoutesDeps {
  repository: ShowsRepository;
  now?: () => Date;
  /**
   * The handler deadline (spec section 10.6: 5 s, below the client's 8 s abort). ONE absolute deadline is fixed when a
   * request enters its handler; every repository call in that request (a save's insert and its read-back) gets only
   * the budget that remains. A hit is 503 (POST: OUTCOME_UNKNOWN).
   */
  deadlineMs?: number;
  /** Monotonic milliseconds for the deadline. Default performance.now. */
  clock?: () => number;
}

type Timed<T> = { ok: true; value: T } | { ok: false; why: 'deadline' | 'error' };

/**
 * A repository call bounded by the request's absolute deadline `endAt` (clock ms). With no budget left the call is not
 * started. Never rejects; a sync throw is an 'error'.
 */
async function within<T>(endAt: number, clock: () => number, call: () => Promise<T>): Promise<Timed<T>> {
  const remaining = endAt - clock();
  if (!(remaining > 0)) return { ok: false, why: 'deadline' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Timed<T>>(resolve => { timer = setTimeout(() => resolve({ ok: false, why: 'deadline' }), remaining); });
  try {
    const work = Promise.resolve().then(call).then(value => ({ ok: true, value }) as Timed<T>, () => ({ ok: false, why: 'error' }) as Timed<T>);
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

const SAVE_KEYS_OUTSIDE_VALIDATOR = ['operationId'];

/** Validates a POST body at the app's smallest and largest n0 (R14 at both); the request is the same normalised value. */
function validateSave(value: unknown): { ok: true; request: ShowRequest } | { ok: false; error: ShowsError } {
  let request: ShowRequest | null = null;
  for (const n0 of [APP_N0_RANGE.smallest, APP_N0_RANGE.largest]) {
    const checked = validateShowRequest(value, makeParams(n0));
    if (!checked.ok) {
      if (checked.errors.some(e => e.reason === 'SCHEMA_VERSION_UNSUPPORTED')) return { ok: false, error: schemaUnsupported(400) };
      return { ok: false, error: validationFailed(checked.errors) };
    }
    request = checked.request;
  }
  if (request === null) return { ok: false, error: internal() };
  // MDB-D2 is not decided: a prompt is not stored, so a request carrying one is refused rather than silently dropped.
  if (request.prompt !== undefined) return { ok: false, error: validationFailed([{ path: 'prompt', reason: 'INVALID_FIELD' }]) };
  return { ok: true, request };
}

export function createShowsRoutes(deps: RoutesDeps): ModuleRoute[] {
  const repo = deps.repository;
  const now = deps.now ?? (() => new Date());
  const deadline = deps.deadlineMs ?? SHOWS_TIMEOUTS.handlerDeadlineMs;
  const clock = deps.clock ?? (() => performance.now());

  /** The stored show with this id, validated on read; or the error to answer. Bounded by the request's `endAt`. */
  async function loadShow(id: string, endAt: number, onUnavailable: ShowsError): Promise<{ ok: true; show: SavedShow } | { ok: false; error: ShowsError }> {
    const got = await within(endAt, clock, () => repo.get(id));
    if (!got.ok) return { ok: false, error: onUnavailable };
    if (got.value === null || got.value === undefined) return { ok: false, error: notFound() };
    const read = readStoredShow(got.value);
    if (read.ok) return { ok: true, show: read.show };
    return { ok: false, error: read.code === 'SCHEMA_VERSION_UNSUPPORTED' ? schemaUnsupported(500) : storedShowInvalid() };
  }

  async function save(request: RouteRequest): Promise<RouteResponse<unknown>> {
    const endAt = clock() + deadline;   // one budget for the whole request: insert and read-back share it
    const body = readJsonBody(request.rawBody);
    if (!body.ok) return body.status === 413 ? payloadTooLarge() : badRequest('INVALID_JSON');
    const value = body.value;
    const operationId = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, SAVE_KEYS_OUTSIDE_VALIDATOR[0] as string)?.value as unknown : undefined;
    if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) return badRequest('INVALID_IDEMPOTENCY_KEY', 'operationId');
    const checked = validateSave(value);
    if (!checked.ok) return checked.error;
    const r = checked.request;
    const fingerprint = requestHash(r);
    // Built field by field from the validated request: the body is never spread into the document (MDB-T11).
    const doc: NewSavedShow = {
      title: r.title, composition: r.composition, contentHash: contentHash(r.composition), requestHash: fingerprint,
      source: r.source, ...(r.generator !== undefined ? { generator: r.generator } : {}),
      preview: compositionPreview(r.composition), operationId,
    };
    const inserted = await within(endAt, clock, () => repo.insert(doc, now()));
    if (!inserted.ok) return inserted.why === 'deadline' ? unavailable('OUTCOME_UNKNOWN') : unavailable();
    const outcome = inserted.value;
    if (outcome.kind === 'outcome-unknown') return unavailable('OUTCOME_UNKNOWN');
    if (outcome.kind === 'duplicate' && outcome.requestHash !== fingerprint) return conflict();
    const stored = await loadShow(outcome.id, endAt, unavailable('OUTCOME_UNKNOWN'));
    if (!stored.ok) return stored.error.status === 404 ? unavailable('OUTCOME_UNKNOWN') : stored.error;
    const replay = outcome.kind === 'duplicate';
    return { status: replay ? 200 : 201, body: { show: stored.show, idempotentReplay: replay } };
  }

  async function list(request: RouteRequest): Promise<RouteResponse<unknown>> {
    const endAt = clock() + deadline;
    const keys = Object.keys(request.query);
    if (keys.some(k => k !== 'limit' && k !== 'cursor')) return badRequest('INVALID_QUERY');
    let limit = LIST_LIMITS.default;
    if (request.query.limit !== undefined) {
      if (!/^[1-9][0-9]?$/.test(request.query.limit)) return badRequest('INVALID_QUERY', 'limit');
      limit = Number(request.query.limit);
      if (limit < LIST_LIMITS.min || limit > LIST_LIMITS.max) return badRequest('INVALID_QUERY', 'limit');
    }
    let after: PageKey | null | undefined;
    if (request.query.cursor !== undefined) {
      after = decodeCursor(request.query.cursor);
      if (after === null) return badRequest('INVALID_CURSOR', 'cursor');
    }
    const page = await within(endAt, clock, () => repo.list({ limit, ...(after ? { after } : {}) }));
    if (!page.ok) return unavailable();
    return { status: 200, body: { items: page.value.items.map(summaryBody), nextCursor: page.value.next ? encodeCursor(page.value.next) : null } };
  }

  async function get(request: RouteRequest): Promise<RouteResponse<unknown>> {
    const endAt = clock() + deadline;
    const id = request.params.id ?? '';
    if (!SHOW_ID_PATTERN.test(id)) return badRequest('INVALID_ID', 'id');
    const stored = await loadShow(id, endAt, unavailable());
    return stored.ok ? { status: 200, body: { show: stored.show } } : stored.error;
  }

  const guard = (handle: (r: RouteRequest) => Promise<RouteResponse<unknown>>) => async (r: RouteRequest) => {
    try { return await handle(r); } catch { return internal(); }
  };
  return [
    { method: 'POST', path: SHOWS_PATH, handle: guard(save) },
    { method: 'GET', path: SHOWS_PATH, handle: guard(list) },
    { method: 'GET', path: `${SHOWS_PATH}/:id`, handle: guard(get) },
  ];
}

/** The same three routes while the module is disabled: each answers 503 DATABASE_UNAVAILABLE / MODULE_DISABLED. */
export function disabledShowsRoutes(): ModuleRoute[] {
  const handle = async () => moduleDisabledResponse();
  return [
    { method: 'POST', path: SHOWS_PATH, handle },
    { method: 'GET', path: SHOWS_PATH, handle },
    { method: 'GET', path: `${SHOWS_PATH}/:id`, handle },
  ];
}
