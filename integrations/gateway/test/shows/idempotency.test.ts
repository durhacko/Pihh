// MDB-WP-04 (#263): idempotency (spec section 10.5; MDB-T19). The key is the body's operationId. A repeated key with the
// same normalised request is 200 with the original show and idempotentReplay true; with a different request it is 409
// IDEMPOTENCY_CONFLICT; concurrent saves with one key store one document; a duplicate whose stored document cannot be
// read back is 503 OUTCOME_UNKNOWN (retryable), never 500.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, type MemoryShowsRepository } from '../../src/shows/memoryRepository.ts';
import { api, KEY, SHOW } from './apiHarness.ts';

test('a repeated key with the same request replays the original: 200, same id, idempotentReplay, no second document', async () => {
  const t = api();
  const first = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(first.status, 201);
  // The same request after normalisation: a re-trimmed title and lower-case text still hash equal.
  const again = await t.save({ ...SHOW, title: 'HELLO to Helix', operationId: KEY });
  assert.equal(again.status, 200);
  assert.equal(again.body.idempotentReplay, true);
  assert.deepEqual(again.body.show, first.body.show);
  assert.equal(t.repository.size(), 1);
});

test('a repeated key with a different request is 409 IDEMPOTENCY_CONFLICT, and the original is untouched', async () => {
  const t = api();
  const first = await t.save({ ...SHOW, operationId: KEY });
  for (const changed of [{ title: 'Another title' }, { composition: { v: 1, movements: [{ recipe: { kind: 'helix' }, holdTicks: 600 }] } }, { source: 'gemini', generator: { model: 'm', integrationVersion: '1' } }]) {
    const response = await t.save({ ...SHOW, ...changed, operationId: KEY });
    assert.equal(response.status, 409, JSON.stringify(changed));
    assert.equal(response.body.error.code, 'CONFLICT');
    assert.deepEqual(response.body.error.details, [{ path: '', reason: 'IDEMPOTENCY_CONFLICT' }]);
  }
  assert.equal(t.repository.size(), 1);
  assert.deepEqual((await t.call('GET', `/api/shows/${first.body.show.id}`)).body.show, first.body.show);
});

test('concurrent saves with one key: one 201, the rest 200 replays of the same id', async () => {
  const t = api();
  const responses = await Promise.all(Array.from({ length: 6 }, () => t.save({ ...SHOW, operationId: KEY })));
  const statuses = responses.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(responses.map(r => r.body.show.id)).size, 1);
  assert.equal(t.repository.size(), 1);
});

test('a duplicate whose stored document cannot be read back is 503 OUTCOME_UNKNOWN, never 500', async () => {
  const base = createMemoryRepository();
  const lossy: MemoryShowsRepository = { ...base, insert: async () => ({ kind: 'outcome-unknown' }) };
  const response = await api(lossy).save({ ...SHOW, operationId: KEY });
  assert.equal(response.status, 503);
  assert.deepEqual([response.body.error.code, response.body.error.details], ['DATABASE_UNAVAILABLE', [{ path: '', reason: 'OUTCOME_UNKNOWN' }]]);
  const vanished: MemoryShowsRepository = { ...base, insert: async () => ({ kind: 'created', id: '0123456789abcdef01234567' }) };
  const gone = await api(vanished).save({ ...SHOW, operationId: KEY });
  assert.equal(gone.status, 503);
  assert.deepEqual(gone.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
});

test('client-sent hashes are refused, and the stored hashes are the server-computed ones', async () => {
  const t = api();
  assert.equal((await t.save({ ...SHOW, operationId: KEY, requestHash: '0'.repeat(64) })).status, 400);
  const saved = await t.save({ ...SHOW, operationId: KEY });
  const stored = await t.repository.get(saved.body.show.id) as { contentHash: string; requestHash: string };
  assert.equal(stored.contentHash, saved.body.show.contentHash);
  assert.match(stored.requestHash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.requestHash, stored.contentHash);
});
