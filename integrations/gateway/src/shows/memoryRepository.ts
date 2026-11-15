// integrations/gateway/src/shows/memoryRepository.ts — an in-process ShowsRepository (MDB-WP-03, offline). It keeps the
// MongoDB semantics the module relies on: a unique operationId (a repeated one is 'duplicate', never a second
// document), keyset listing in (createdAt desc, _id desc), documents copied in and out (no caller can alias the
// store). It is what the module runs on in tests and offline demos; it is not a cache of Atlas and persists nothing.
import { checkListLimit, compareKeys, isAfter, toSummary, type ListPage, type ListResult, type ShowsRepository } from './repository.ts';
import type { InsertOutcome, NewSavedShow, PageKey, SavedShowDoc, ShowId } from './types.ts';

export interface MemoryRepositoryOptions {
  /** A new 24-hex id. Default: ObjectId layout, 8 hex of seconds then a 16-hex counter, so ids rise with time. */
  newId?: (now: Date) => ShowId;
  /** What ping() answers. Default 'up'. */
  ping?: () => 'up' | 'down';
}

export interface MemoryShowsRepository extends ShowsRepository {
  /** Number of stored documents (tests). */
  size(): number;
  /** Stores a raw document as-is, bypassing insert (tests: documents written by another client, MDB-T14/T16). */
  seed(doc: unknown): void;
}

function defaultIdFactory(): (now: Date) => ShowId {
  let counter = 0n;
  return now => {
    const seconds = Math.max(0, Math.min(0xffffffff, Math.floor(now.getTime() / 1000)));
    counter += 1n;
    return seconds.toString(16).padStart(8, '0') + counter.toString(16).padStart(16, '0');
  };
}

/** The listing key. Defensive, because seed() may store a corrupt document: a bad date sorts as epoch 0, a bad id as ''. */
const keyOf = (doc: SavedShowDoc): PageKey => ({
  createdAt: doc.createdAt instanceof Date && Number.isFinite(doc.createdAt.getTime()) ? doc.createdAt : new Date(0),
  id: typeof doc._id === 'string' ? doc._id : '',
});

export function createMemoryRepository(options: MemoryRepositoryOptions = {}): MemoryShowsRepository {
  const newId = options.newId ?? defaultIdFactory();
  const ping = options.ping ?? (() => 'up' as const);
  /** By id. Values are private copies; raw seeded documents are kept as given. */
  const byId = new Map<ShowId, SavedShowDoc>();
  const byOperation = new Map<string, ShowId>();

  return {
    async insert(show: NewSavedShow, now: Date): Promise<InsertOutcome> {
      const existing = byOperation.get(show.operationId);
      if (existing !== undefined) {
        const stored = byId.get(existing);
        return stored ? { kind: 'duplicate', id: stored._id, requestHash: stored.requestHash } : { kind: 'outcome-unknown' };
      }
      const id = newId(now);
      if (byId.has(id)) throw new Error('memory repository: id collision');
      const at = new Date(now.getTime());
      // Field by field (spec section 7.1): nothing else on `show` can reach the store.
      const doc: SavedShowDoc = structuredClone({
        _id: id,
        schemaVersion: 1,
        title: show.title,
        ...(show.prompt !== undefined ? { prompt: show.prompt } : {}),
        composition: show.composition,
        contentHash: show.contentHash,
        requestHash: show.requestHash,
        source: show.source,
        ...(show.generator !== undefined ? { generator: show.generator } : {}),
        preview: show.preview,
        operationId: show.operationId,
        createdAt: at,
        updatedAt: new Date(at.getTime()),
      });
      byId.set(id, doc);
      byOperation.set(show.operationId, id);
      return { kind: 'created', id };
    },

    async list(page: ListPage): Promise<ListResult> {
      checkListLimit(page.limit);
      const after = page.after;
      const ordered = [...byId.values()].sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
      const rest = after === undefined ? ordered : ordered.filter(doc => isAfter(keyOf(doc), after));
      const rows = rest.slice(0, page.limit + 1);   // the extra row decides `next` (spec section 11)
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return {
        items: items.map(doc => toSummary(structuredClone(doc))),
        next: rows.length > page.limit && last !== undefined ? { id: keyOf(last).id, createdAt: new Date(keyOf(last).createdAt.getTime()) } : null,
      };
    },

    async get(id: ShowId): Promise<unknown> {
      const doc = byId.get(id);
      return doc === undefined ? null : structuredClone(doc);
    },

    async ping() {
      return ping();
    },

    size: () => byId.size,

    seed(doc: unknown) {
      const copy = structuredClone(doc) as SavedShowDoc;
      byId.set(copy._id, copy);
      if (typeof copy.operationId === 'string') byOperation.set(copy.operationId, copy._id);
    },
  };
}
