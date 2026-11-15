// MDB-WP-04 (#263): database unavailable and the handler deadline (spec section 10.6; MDB-T17). A repository that
// rejects is 503 DATABASE_UNAVAILABLE with the fixed message and no driver text; one that hangs is cut at the deadline:
// 503 for reads, 503 OUTCOME_UNKNOWN for a save, after which a retry with the same key gets 201 or a 200 replay and
// never a second document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, type MemoryShowsRepository } from '../../src/shows/memoryRepository.ts';
import { api, KEY, SHOW } from './apiHarness.ts';

const SECRET = 'mongodb+srv://user:hunter2@cluster0.example.net';

test('a rejecting repository is 503 DATABASE_UNAVAILABLE with the fixed message and no driver text', async () => {
  const base = createMemoryRepository();
  const failing: MemoryShowsRepository = {
    ...base,
    insert: async () => { throw new Error(`connection to ${SECRET} refused`); },
    list: () => { throw new Error(`sync failure ${SECRET}`); },
    get: async () => { throw new Error(`timeout ${SECRET}`); },
  };
  const t = api(failing);
  for (const response of [await t.save({ ...SHOW, operationId: KEY }), await t.call('GET', '/api/shows'), await t.call('GET', '/api/shows/0123456789abcdef01234567')]) {
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(response.body.error.message, 'Saved shows are temporarily unavailable.');
    assert.ok(!JSON.stringify(response.body).includes('hunter2'));
  }
});

test('a hanging repository is cut at the deadline: 503 for reads, 503 OUTCOME_UNKNOWN for a save', async () => {
  const base = createMemoryRepository();
  const hanging: MemoryShowsRepository = { ...base, insert: () => new Promise(() => {}), list: () => new Promise(() => {}), get: () => new Promise(() => {}) };
  const t = api(hanging, { deadlineMs: 25 });
  const started = Date.now();
  const save = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(save.status, 503);
  assert.deepEqual(save.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
  const list = await t.call('GET', '/api/shows');
  assert.equal(list.status, 503);
  assert.equal(list.body.error.details, undefined);
  assert.equal((await t.call('GET', '/api/shows/0123456789abcdef01234567')).status, 503);
  assert.ok(Date.now() - started < 2000, 'answered at the deadline, not after a driver timeout');
});

test('after a save hangs past the deadline but lands, a retry with the same key is a 200 replay, never a second document', async () => {
  const base = createMemoryRepository();
  let slow = true;
  const late: MemoryShowsRepository = {
    ...base,
    insert: async (show, now) => {
      if (!slow) return base.insert(show, now);
      const outcome = await base.insert(show, now);   // the write lands...
      await new Promise(resolve => setTimeout(resolve, 60));   // ...but the answer comes after the deadline
      return outcome;
    },
  };
  const t = api(late, { deadlineMs: 20 });
  const first = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(first.status, 503);
  assert.deepEqual(first.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
  slow = false;
  await new Promise(resolve => setTimeout(resolve, 80));
  const retry = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(base.size(), 1);
});
