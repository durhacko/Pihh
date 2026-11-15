// integrations/gateway/src/shows/repository.ts — the data-access contract of the shows module (MDB-WP-03) and the pure
// rules every implementation shares: keyset order and cursors (spec section 11), the per-item listing check (section
// 10.3), validation on read (sections 7.4, 9 R15, 10.3) and the duplicate-key outcome (section 10.5).
// Pure: no I/O, no driver. The memory repository (memoryRepository.ts) and, later under D3, the MongoDB repository
// implement ShowsRepository and pass the same contract suite (test/shows/repositoryContract.ts).
import {
  APP_N0_RANGE, COMPOSITION_LIMITS, SUPPORTED_SCHEMA_VERSION, canonicalJson, compositionPreview, contentHash, makeParams,
  validateComposition, validateShowRequest,
} from './validate.ts';
import { INVALID_SHOW_TITLE } from './types.ts';
import type {
  InsertOutcome, NewSavedShow, PageKey, SavedShow, SavedShowDoc, ShowId, ShowSummary,
} from './types.ts';

/** Listing page size (spec section 10.3): 1–50, default 20. */
export const LIST_LIMITS: Readonly<{ min: number; max: number; default: number }> = Object.freeze({ min: 1, max: 50, default: 20 });

export interface ListPage { limit: number; after?: PageKey }
export interface ListResult { items: ShowSummary[]; next: PageKey | null }

/** Data access, mocked in unit tests (MDB-WP-03 "Proposed interfaces"). Every method may reject; callers map failures. */
export interface ShowsRepository {
  /** Inserts one document; a stored operationId gives 'duplicate', never a second document. */
  insert(show: NewSavedShow, now: Date): Promise<InsertOutcome>;
  /** Newest first, (createdAt desc, _id desc); `after` is the previous page's last key. `limit` is 1–50. */
  list(page: ListPage): Promise<ListResult>;
  /** The stored document, unvalidated (callers run readStoredShow), or null. `id` is already checked as 24 hex. */
  get(id: ShowId): Promise<unknown>;
  ping(): Promise<'up' | 'down'>;
}

export const SHOW_ID_PATTERN = /^[0-9a-f]{24}$/;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;
/** Lower-case UUID v4 (spec section 10.5). */
export const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Throws RangeError unless `limit` is an integer in [1, 50]. Route code validates the query first (400 INVALID_QUERY). */
export function checkListLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < LIST_LIMITS.min || limit > LIST_LIMITS.max) {
    throw new RangeError(`list limit must be an integer in [${LIST_LIMITS.min}, ${LIST_LIMITS.max}]`);
  }
}

// ------------------------------------------------------------------------------------------------ keyset order

/** The total listing order: negative when `a` comes first (newer createdAt, then larger id). */
export function compareKeys(a: PageKey, b: PageKey): number {
  const dt = b.createdAt.getTime() - a.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;   // fixed-length lower-case hex: string order = ObjectId order
}

/** True when `key` comes strictly after `after` in the listing order: the next-page filter of spec section 11. */
export function isAfter(key: PageKey, after: PageKey): boolean {
  return compareKeys(after, key) < 0;
}

// --------------------------------------------------------------------------------------------- cursor (section 11)

const CURSOR_MAX = 128;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_DATE_MS = 8.64e15;

/** cursor = base64url(JSON [createdAt epoch ms, id hex]). */
export function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify([key.createdAt.getTime(), key.id]), 'utf8').toString('base64url');
}

/**
 * The client-controlled cursor, RE-TYPED: its decoded form must be exactly `[ms, hex]`, ms a safe non-negative integer
 * and hex 24 lower-case hex. The key is built only from `new Date(ms)` and the hex string, never from a decoded value
 * as such. Anything else (over 128 characters, invalid or non-canonical base64url, invalid JSON, operator objects,
 * strings, floats, negatives, extra elements) gives null: the route answers 400 INVALID_CURSOR before any query.
 */
export function decodeCursor(cursor: unknown): PageKey | null {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > CURSOR_MAX || !BASE64URL.test(cursor)) return null;
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.toString('base64url') !== cursor) return null;   // one canonical spelling per key
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return null;
  const [ms, hex] = decoded as unknown[];
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > MAX_DATE_MS) return null;
  if (typeof hex !== 'string' || !SHOW_ID_PATTERN.test(hex)) return null;
  return { createdAt: new Date(ms), id: hex };
}

// ------------------------------------------------------------------------------------ per-item listing (10.3)

const TITLE_FORBIDDEN = /[\p{Cc}\p{Cf}]/u;
/** Kinds a listing may show for a supported document (the validator's recipe kinds; pinned in validate.test.ts). */
export const LISTABLE_KINDS: readonly string[] = Object.freeze(['text', 'sphere', 'helix']);
/** For a NEWER schemaVersion the kinds are only checked as short identifiers: the document is shown, never loaded. */
const KIND_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** A lone surrogate: not well-formed UTF-16 (the app's checkPrintable rejects it too). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** R4 for a STORED title: already trimmed, well-formed, 1–80 code points, no control or format character. */
export function isStoredTitle(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || LONE_SURROGATE.test(value)) return false;
  const length = [...value].length;
  return length >= 1 && length <= COMPOSITION_LIMITS.maxTitleChars && !TITLE_FORBIDDEN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** An own data property, never a getter. */
function own(obj: Record<string, unknown>, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && 'value' in d ? d.value : undefined;
}

const isValidDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/**
 * One listing item from a stored document's projected fields (spec section 10.3). Every projected field is checked;
 * a document that fails is `loadable: false, problem: 'invalid'` with the fixed title and no stored value, and a
 * newer schemaVersion is `problem: 'unsupported-schema'`. It never reads `composition` or `prompt`.
 */
export function toSummary(doc: unknown): ShowSummary {
  const invalid = (id: string): ShowSummary => ({ id, title: INVALID_SHOW_TITLE, loadable: false, problem: 'invalid' });
  if (!isPlainObject(doc)) return invalid('');
  const rawId = own(doc, '_id');
  const id = typeof rawId === 'string' && SHOW_ID_PATTERN.test(rawId) ? rawId : '';
  if (id === '') return invalid('');
  const title = own(doc, 'title');
  const source = own(doc, 'source');
  const schemaVersion = own(doc, 'schemaVersion');
  const createdAt = own(doc, 'createdAt');
  const preview = own(doc, 'preview');
  if (!isStoredTitle(title) || (source !== 'manual' && source !== 'gemini') || !isValidDate(createdAt)) return invalid(id);
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) return invalid(id);
  if (!isPlainObject(preview)) return invalid(id);
  const movementCount = own(preview, 'movementCount');
  const kinds = own(preview, 'kinds');
  if (typeof movementCount !== 'number' || !Number.isSafeInteger(movementCount) || movementCount < 1 || movementCount > COMPOSITION_LIMITS.maxMovements) return invalid(id);
  const newer = schemaVersion > SUPPORTED_SCHEMA_VERSION;
  if (!Array.isArray(kinds) || kinds.length !== movementCount) return invalid(id);
  for (let i = 0; i < kinds.length; i++) {   // indexed, so a hole in a sparse array is checked (every() would skip it)
    const k: unknown = kinds[i];
    if (typeof k !== 'string' || !(newer ? KIND_NAME.test(k) : LISTABLE_KINDS.includes(k))) return invalid(id);
  }
  const summary = {
    id, title, source, createdAt: createdAt.toISOString(), movementCount, kinds: [...kinds] as string[], schemaVersion,
  } as const;
  return newer ? { ...summary, loadable: false, problem: 'unsupported-schema' } : { ...summary, loadable: true };
}

// ------------------------------------------------------------------------------------ validation on read (7.4)

export type StoredShowCheck =
  | { ok: true; show: SavedShow }
  | { ok: false; code: 'STORED_SHOW_INVALID' | 'SCHEMA_VERSION_UNSUPPORTED' };

const STORED_KEYS: readonly string[] = [
  '_id', 'schemaVersion', 'title', 'prompt', 'composition', 'contentHash', 'requestHash', 'source', 'generator', 'preview',
  'operationId', 'createdAt', 'updatedAt',
];

/**
 * Validates a retrieved document before it is returned (spec sections 7.4, 9, 10.3; MDB-T16). A newer schemaVersion is
 * SCHEMA_VERSION_UNSUPPORTED and nothing else is read (never down-read). Otherwise every field is checked: unknown
 * keys, the request fields through the app's own validator (R2–R16), the composition again in 'stored' mode (already
 * canonical, so lower-case text is rejected) with R14's trial expansion at the app's smallest and largest n0, R15
 * (contentHash equals the recomputed one), the derived preview, the hashes, operationId and dates. Any failure is
 * STORED_SHOW_INVALID. Total over unknown: never throws.
 */
export function readStoredShow(doc: unknown): StoredShowCheck {
  const bad: StoredShowCheck = { ok: false, code: 'STORED_SHOW_INVALID' };
  try {
    if (!isPlainObject(doc)) return bad;
    const version = own(doc, 'schemaVersion');
    if (typeof version === 'number' && Number.isSafeInteger(version) && version > SUPPORTED_SCHEMA_VERSION) {
      return { ok: false, code: 'SCHEMA_VERSION_UNSUPPORTED' };
    }
    if (Reflect.ownKeys(doc).some(k => typeof k !== 'string' || !STORED_KEYS.includes(k))) return bad;
    const id = own(doc, '_id');
    const createdAt = own(doc, 'createdAt');
    const updatedAt = own(doc, 'updatedAt');
    const stored = {
      schemaVersion: version, title: own(doc, 'title'), composition: own(doc, 'composition'), source: own(doc, 'source'),
      ...(Object.hasOwn(doc, 'prompt') ? { prompt: own(doc, 'prompt') } : {}),
      ...(Object.hasOwn(doc, 'generator') ? { generator: own(doc, 'generator') } : {}),
    };
    if (typeof id !== 'string' || !SHOW_ID_PATTERN.test(id) || !isValidDate(createdAt) || !isValidDate(updatedAt)) return bad;
    const hash = own(doc, 'contentHash');
    const fingerprint = own(doc, 'requestHash');
    const operationId = own(doc, 'operationId');
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash) || typeof fingerprint !== 'string' || !HASH_PATTERN.test(fingerprint)) return bad;
    if (typeof operationId !== 'string' || !OPERATION_ID_PATTERN.test(operationId)) return bad;
    if (!isStoredTitle(stored.title)) return bad;

    let request = null;
    for (const n0 of [APP_N0_RANGE.smallest, APP_N0_RANGE.largest]) {
      const params = makeParams(n0);
      const asRequest = validateShowRequest(stored, params);
      const asStored = validateComposition(stored.composition, params, { mode: 'stored' });
      if (!asRequest.ok || !asStored.ok) return bad;
      // Stored data must already be canonical: validating it changes nothing.
      if (canonicalJson(asRequest.request) !== canonicalJson(stored) || canonicalJson(asStored.composition) !== canonicalJson(stored.composition)) return bad;
      request = asRequest.request;
    }
    if (request === null || contentHash(request.composition) !== hash) return bad;   // R15
    const preview = own(doc, 'preview');
    if (canonicalJson(preview) !== canonicalJson(compositionPreview(request.composition))) return bad;
    const show: SavedShow = {
      id, title: request.title, source: request.source, createdAt: createdAt.toISOString(),
      movementCount: request.composition.movements.length, kinds: request.composition.movements.map(m => m.recipe.kind),
      schemaVersion: 1, loadable: true,
      ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      composition: request.composition, contentHash: hash,
      ...(request.generator !== undefined ? { generator: request.generator } : {}),
      updatedAt: updatedAt.toISOString(),
    };
    return { ok: true, show };
  } catch {
    return bad;
  }
}

// ------------------------------------------------------------------------------------- duplicate key (10.5)

/**
 * After a duplicate-key error on operationId, the stored document decides the outcome: its id and requestHash
 * ('duplicate'; the caller answers 200 replay or 409 by comparing requestHash), or 'outcome-unknown' when it cannot be
 * read (503 OUTCOME_UNKNOWN, retryable with the same key; never 500).
 */
export function outcomeAfterDuplicate(found: Pick<SavedShowDoc, '_id' | 'requestHash'> | null): InsertOutcome {
  return found === null ? { kind: 'outcome-unknown' } : { kind: 'duplicate', id: found._id, requestHash: found.requestHash };
}
