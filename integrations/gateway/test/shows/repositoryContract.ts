// The ShowsRepository contract suite (MDB-WP-03): one suite every implementation passes. repository.test.ts runs it on
// the memory repository; the MongoDB repository (live PR, under D3) runs it against a separate test database.
// It uses only the public interface: documents are counted by walking `list`, never through an implementation hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareKeys, decodeCursor, encodeCursor, LIST_LIMITS, SHOW_ID_PATTERN, type ShowsRepository } from '../../src/shows/repository.ts';
import type { NewSavedShow, PageKey, SavedShowDoc, ShowSummary } from '../../src/shows/types.ts';

export const hex64 = (n: number): string => n.toString(16).padStart(64, '0');
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A new show as a save would hand it over (the repository does not validate: the route already did). */
export function newShow(n: number, patch: Partial<NewSavedShow> = {}): NewSavedShow {
  return {
    title: `Show ${n}`,
    composition: { v: 1, movements: [{ recipe: { kind: 'sphere' }, holdTicks: 600 }] },
    contentHash: hex64(n),
    requestHash: hex64(1_000_000 + n),
    source: 'manual',
    preview: { movementCount: 1, kinds: ['sphere'] },
    operationId: uuid(n),
    ...patch,
  };
}

/** Every summary, page by page, following `next` through the cursor codec as a route would. */
export async function walk(repo: ShowsRepository, limit: number): Promise<{ items: ShowSummary[]; pages: number }> {
  const items: ShowSummary[] = [];
  let after: PageKey | undefined;
  let pages = 0;
  for (;;) {
    const page = await repo.list({ limit, ...(after ? { after } : {}) });
    pages++;
    assert.ok(page.items.length <= limit);
    items.push(...page.items);
    if (page.next === null) return { items, pages };
    const cursor = encodeCursor(page.next);
    const decoded = decodeCursor(cursor);
    assert.ok(decoded, 'next encodes to a cursor that decodes');
    after = decoded;
    assert.ok(pages < 1000, 'walk terminates');
  }
}

export type MakeRepository = () => ShowsRepository | Promise<ShowsRepository>;

const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);

export function repositoryContract(name: string, make: MakeRepository): void {
  test(`${name}: insert creates one document, built field by field, with server fields added`, async () => {
    const repo = await make();
    const now = new Date(T0);
    const show = newShow(1, { prompt: 'a prompt' });
    const outcome = await repo.insert(show, now);
    assert.equal(outcome.kind, 'created');
    if (outcome.kind !== 'created') return;
    assert.match(outcome.id, SHOW_ID_PATTERN);
    const doc = (await repo.get(outcome.id)) as SavedShowDoc;
    assert.deepEqual(Object.keys(doc).sort(), ['_id', 'composition', 'contentHash', 'createdAt', 'operationId', 'preview', 'prompt', 'requestHash', 'schemaVersion', 'source', 'title', 'updatedAt']);
    assert.equal(doc._id, outcome.id);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.createdAt.getTime(), T0);
    assert.equal(doc.updatedAt.getTime(), T0);
    assert.deepEqual(doc.composition, show.composition);
    assert.equal(doc.requestHash, show.requestHash);
  });

  test(`${name}: stored documents are copies, in and out`, async () => {
    const repo = await make();
    const show = newShow(2);
    const outcome = await repo.insert(show, new Date(T0));
    assert.equal(outcome.kind, 'created');
    if (outcome.kind !== 'created') return;
    show.title = 'changed after insert';
    show.composition.movements[0]!.holdTicks = 1;
    const first = (await repo.get(outcome.id)) as SavedShowDoc;
    first.title = 'changed after get';
    const again = (await repo.get(outcome.id)) as SavedShowDoc;
    assert.equal(again.title, 'Show 2');
    assert.equal(again.composition.movements[0]!.holdTicks, 600);
  });

  test(`${name}: a repeated operationId is 'duplicate' with the STORED requestHash, and no second document`, async () => {
    const repo = await make();
    const created = await repo.insert(newShow(3), new Date(T0));
    assert.equal(created.kind, 'created');
    if (created.kind !== 'created') return;
    const retry = await repo.insert(newShow(3, { title: 'Different title', requestHash: hex64(42) }), new Date(T0 + 5000));
    assert.deepEqual(retry, { kind: 'duplicate', id: created.id, requestHash: hex64(1_000_003) });
    assert.equal((await walk(repo, LIST_LIMITS.max)).items.length, 1);
    assert.equal(((await repo.get(created.id)) as SavedShowDoc).title, 'Show 3');
  });

  test(`${name}: concurrent inserts with one operationId store exactly one document, and all callers get its id`, async () => {
    const repo = await make();
    const outcomes = await Promise.all(Array.from({ length: 5 }, (_, i) => repo.insert(newShow(4, { title: `racer ${i}` }), new Date(T0 + i))));
    const created = outcomes.filter(o => o.kind === 'created');
    assert.equal(created.length, 1);
    const id = (created[0] as { id: string }).id;
    for (const o of outcomes) assert.ok(o.kind === 'created' || (o.kind === 'duplicate' && o.id === id), JSON.stringify(o));
    assert.equal((await walk(repo, LIST_LIMITS.max)).items.length, 1);
  });

  test(`${name}: an absent id gives null; an empty library lists nothing`, async () => {
    const repo = await make();
    assert.equal(await repo.get('0123456789abcdef01234567'), null);
    assert.deepEqual(await repo.list({ limit: LIST_LIMITS.default }), { items: [], next: null });
  });

  test(`${name}: keyset paging is newest first with _id as the tie-break, and a walk returns every document once`, async () => {
    const repo = await make();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      // Seven distinct timestamps, so most documents tie on createdAt; insertion order is shuffled against time.
      const at = new Date(T0 + ((i * 3) % 7) * 1000);
      const o = await repo.insert(newShow(100 + i), at);
      assert.equal(o.kind, 'created');
      if (o.kind === 'created') ids.push(o.id);
    }
    for (const limit of [1, 7, LIST_LIMITS.default, LIST_LIMITS.max]) {
      const { items, pages } = await walk(repo, limit);
      assert.equal(items.length, 60, `limit ${limit}`);
      assert.equal(new Set(items.map(s => s.id)).size, 60, `limit ${limit}: no repeats`);
      assert.equal(pages, Math.ceil(60 / limit), `limit ${limit}: pages (the extra row means no empty last page)`);
      for (let k = 1; k < items.length; k++) {
        const a = items[k - 1] as Extract<ShowSummary, { loadable: true }>;
        const b = items[k] as Extract<ShowSummary, { loadable: true }>;
        assert.ok(compareKeys({ createdAt: new Date(a.createdAt), id: a.id }, { createdAt: new Date(b.createdAt), id: b.id }) < 0, `limit ${limit}: order at ${k}`);
      }
    }
    assert.deepEqual(new Set((await walk(repo, 50)).items.map(s => s.id)), new Set(ids));
  });

  test(`${name}: listing items are metadata only (no composition, no prompt)`, async () => {
    const repo = await make();
    await repo.insert(newShow(5, { prompt: 'secret-ish prompt' }), new Date(T0));
    const { items } = await repo.list({ limit: 1 });
    assert.equal(items.length, 1);
    const item = items[0] as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'id', 'kinds', 'loadable', 'movementCount', 'schemaVersion', 'source', 'title']);
    assert.equal(item.loadable, true);
    assert.equal(item.createdAt, new Date(T0).toISOString());
    assert.ok(!JSON.stringify(items).includes('secret-ish'));
  });

  test(`${name}: list refuses a limit outside 1–50`, async () => {
    const repo = await make();
    for (const limit of [0, -1, 51, 1.5, Number.NaN]) await assert.rejects(Promise.resolve().then(() => repo.list({ limit })), RangeError, String(limit));
  });

  test(`${name}: a key after the last document gives an empty page`, async () => {
    const repo = await make();
    await repo.insert(newShow(6), new Date(T0));
    assert.deepEqual(await repo.list({ limit: 5, after: { createdAt: new Date(0), id: '000000000000000000000000' } }), { items: [], next: null });
  });

  test(`${name}: ping answers up`, async () => {
    assert.equal(await (await make()).ping(), 'up');
  });
}
