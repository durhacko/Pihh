// MDB-WP-04 (#263), offline: the Saved Shows API over the memory repository (spec sections 10.1–10.3; MDB-T11–T16).
// Save -> List -> Get round trip, validation and body errors in the XI-3 envelope, list paging and query errors,
// malformed and absent ids, validation on read, and the flat section 10.1 listing shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isErrorEnvelope } from '../../src/errors.ts';
import { createMemoryRepository, type MemoryShowsRepository } from '../../src/shows/memoryRepository.ts';
import { SHOWS_PATH } from '../../src/shows/routes.ts';
import { INVALID_SHOW_TITLE } from '../../src/shows/types.ts';
import { api, KEY, reasons, SHOW } from './apiHarness.ts';

test('Save -> List -> Get round trip: 201 with the normalised show, listed as metadata, retrieved whole', async () => {
  const t = api(createMemoryRepository(), { now: () => new Date(Date.UTC(2026, 10, 15, 9, 40)) });
  const saved = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.idempotentReplay, false);
  const show = saved.body.show;
  assert.match(show.id, /^[0-9a-f]{24}$/);
  assert.equal(show.title, 'HELLO to Helix');
  assert.equal(show.composition.movements[0].recipe.text, 'HELLO');
  assert.match(show.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(show.createdAt, '2026-11-15T09:40:00.000Z');
  assert.deepEqual([show.movementCount, show.kinds, show.schemaVersion, show.loadable, show.source], [3, ['text', 'sphere', 'helix'], 1, true, 'manual']);

  const listed = await t.call('GET', SHOWS_PATH);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { items: [{ id: show.id, title: 'HELLO to Helix', source: 'manual', createdAt: show.createdAt, movementCount: 3, kinds: ['text', 'sphere', 'helix'], schemaVersion: 1, loadable: true }], nextCursor: null });

  const got = await t.call('GET', `${SHOWS_PATH}/${show.id}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { show });
});

test('the document is built field by field: stray keys, client hashes and timestamps never reach the store', async () => {
  const t = api();
  const saved = await t.save({ ...SHOW, operationId: KEY, contentHash: 'f'.repeat(64) });
  assert.equal(saved.status, 400, 'an unknown key is refused');
  const ok = await t.save({ ...SHOW, operationId: KEY });
  const stored = await t.repository.get(ok.body.show.id) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ['_id', 'composition', 'contentHash', 'createdAt', 'operationId', 'preview', 'requestHash', 'schemaVersion', 'source', 'title', 'updatedAt']);
  assert.equal(stored.operationId, KEY);
});

test('invalid bodies: 400 VALIDATION_FAILED with paths and reasons in the XI-3 envelope; the repository is never written', async () => {
  const t = api();
  const cases: [string, unknown, string[]][] = [
    ['an unsupported kind', { ...SHOW, operationId: KEY, composition: { v: 1, movements: [{ recipe: { kind: 'cube' }, holdTicks: 600 }] } }, ['composition.movements[0].recipe.kind UNSUPPORTED_RECIPE']],
    ['a runtime field', { ...SHOW, operationId: KEY, composition: { ...SHOW.composition, movements: [{ ...SHOW.composition.movements[1], startTick: 0 }] } }, ['composition.movements[0].startTick RUNTIME_FIELD']],
    ['a prompt (MDB-D2 undecided)', { ...SHOW, operationId: KEY, prompt: 'glow' }, ['prompt INVALID_FIELD']],
    ['no operationId', { ...SHOW }, ['operationId INVALID_IDEMPOTENCY_KEY']],
    ['an upper-case operationId', { ...SHOW, operationId: KEY.toUpperCase() }, ['operationId INVALID_IDEMPOTENCY_KEY']],
    ['an array body', [SHOW], ['operationId INVALID_IDEMPOTENCY_KEY']],
  ];
  for (const [name, body, expected] of cases) {
    const response = await t.save(body);
    assert.equal(response.status, 400, name);
    assert.ok(isErrorEnvelope(response.body), name);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED', name);
    assert.deepEqual(reasons(response.body), expected, name);
  }
  assert.equal(t.repository.size(), 0);
});

test('a newer schemaVersion in a request is 400 SCHEMA_VERSION_UNSUPPORTED', async () => {
  const response = await api().save({ ...SHOW, operationId: KEY, schemaVersion: 2 });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'SCHEMA_VERSION_UNSUPPORTED');
});

test('body reader: malformed JSON, an empty body and nesting deeper than 8 are 400 INVALID_JSON; over 64 KiB is 413', async () => {
  const t = api();
  for (const [name, raw] of [['malformed', '{"title":'], ['empty', ''], ['deep', `${'['.repeat(9)}${']'.repeat(9)}`], ['deep 64 KiB', '['.repeat(60_000)]] as const) {
    const response = await t.call('POST', SHOWS_PATH, { raw });
    assert.equal(response.status, 400, name);
    assert.deepEqual(reasons(response.body), [' INVALID_JSON'], name);
  }
  // Brackets inside strings are not nesting.
  const quoted = await t.save({ ...SHOW, operationId: KEY, title: '[[[[[[[[[[ title ]]]]]]]]]]' });
  assert.equal(quoted.status, 201);
  const big = await t.call('POST', SHOWS_PATH, { raw: JSON.stringify({ ...SHOW, operationId: KEY, title: 'x'.repeat(70_000) }) });
  assert.equal(big.status, 413);
  assert.equal(big.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('list: limit default 20 and max 50, cursor paging, and 400 for bad queries and tampered cursors', async () => {
  const t = api();
  for (let i = 0; i < 25; i++) assert.equal((await t.save({ ...SHOW, title: `Show ${i}`, operationId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })).status, 201);
  const first = await t.call('GET', SHOWS_PATH);
  assert.equal(first.body.items.length, 20);
  assert.equal(typeof first.body.nextCursor, 'string');
  const second = await t.call('GET', SHOWS_PATH, { query: { cursor: first.body.nextCursor } });
  assert.equal(second.body.items.length, 5);
  assert.equal(second.body.nextCursor, null);
  assert.equal(new Set([...first.body.items, ...second.body.items].map((s: { id: string }) => s.id)).size, 25);
  assert.equal((await t.call('GET', SHOWS_PATH, { query: { limit: '50' } })).body.items.length, 25);
  const badQueries: Record<string, string>[] = [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: '-1' }, { limit: '07' }, { limit: 'x' }, { sort: 'title' }];
  for (const query of badQueries) {
    const response = await t.call('GET', SHOWS_PATH, { query });
    assert.equal(response.status, 400, JSON.stringify(query));
    assert.match(reasons(response.body)[0] ?? '', /INVALID_QUERY$/);
  }
  for (const cursor of ['', 'A'.repeat(129), Buffer.from('[1.5,"0123456789abcdef01234567"]').toString('base64url'), Buffer.from('[{"$gt":""},"x"]').toString('base64url')]) {
    const response = await t.call('GET', SHOWS_PATH, { query: { cursor } });
    assert.equal(response.status, 400, cursor);
    assert.deepEqual(reasons(response.body), ['cursor INVALID_CURSOR']);
  }
  const empty = await api().call('GET', SHOWS_PATH);
  assert.deepEqual(empty, { status: 200, body: { items: [], nextCursor: null } });
});

test('list: an invalid stored document is a flat section 10.1 item with the fixed title and no stored value', async () => {
  const t = api();
  t.repository.seed({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: '<b>evil</b>‮', source: 'atlas', createdAt: new Date(5), schemaVersion: 1, preview: { movementCount: 1, kinds: ['sphere'] } });
  const { body } = await t.call('GET', SHOWS_PATH);
  assert.deepEqual(body.items, [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: INVALID_SHOW_TITLE, source: 'manual', createdAt: '1970-01-01T00:00:00.000Z', movementCount: 0, kinds: [], schemaVersion: 0, loadable: false, problem: 'invalid' }]);
  assert.ok(!JSON.stringify(body).includes('evil'));
});

test('get: malformed ids are 400 INVALID_ID before any lookup; an absent id is 404; corrupt and newer documents are 500', async () => {
  const t = api();
  let lookups = 0;
  const counting = { ...t.repository, get: (id: string) => { lookups++; return t.repository.get(id); } };
  const strict = api(counting as MemoryShowsRepository);
  for (const id of ['abc', '0123456789abcdef0123456', '0123456789abcdef012345678', 'zzzzzzzzzzzzzzzzzzzzzzzz', '0123456789ABCDEF01234567', '%24ne', '{"$ne":null}', '']) {
    const response = await strict.call('GET', `${SHOWS_PATH}/${id}`);
    assert.equal(response.status, 400, id);
    assert.deepEqual(reasons(response.body), ['id INVALID_ID']);
  }
  assert.equal(lookups, 0);
  assert.equal((await t.call('GET', `${SHOWS_PATH}/0123456789abcdef01234567`)).status, 404);

  const saved = await t.save({ ...SHOW, operationId: KEY });
  const stored = await t.repository.get(saved.body.show.id) as Record<string, unknown>;
  t.repository.seed({ ...stored, _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', operationId: '00000000-0000-4000-8000-0000000000bb', contentHash: '0'.repeat(64) });
  const corrupt = await t.call('GET', `${SHOWS_PATH}/bbbbbbbbbbbbbbbbbbbbbbbb`);
  assert.equal(corrupt.status, 500);
  assert.deepEqual([corrupt.body.error.code, reasons(corrupt.body)], ['INTERNAL', [' STORED_SHOW_INVALID']]);
  t.repository.seed({ ...stored, _id: 'cccccccccccccccccccccccc', operationId: '00000000-0000-4000-8000-0000000000cc', schemaVersion: 2 });
  const newer = await t.call('GET', `${SHOWS_PATH}/cccccccccccccccccccccccc`);
  assert.equal(newer.status, 500);
  assert.equal(newer.body.error.code, 'SCHEMA_VERSION_UNSUPPORTED');
});
