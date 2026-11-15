// MDB-WP-04 (#263): database unavailable and the handler deadline (spec section 10.6; MDB-T17). A repository that
// rejects is 503 DATABASE_UNAVAILABLE with the fixed message and no driver text; one that hangs is cut at the deadline:
// 503 for reads, 503 OUTCOME_UNKNOWN for a save, after which a retry with the same key gets 201 or a 200 replay and
// never a second document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, type MemoryShowsRepository } from '../../src/shows/memoryRepository.ts';
import { api, KEY, SHOW } from './apiHarness.ts';

const SECRET = 'mongodb+srv://user:hunter2@cluster0.example.net';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('ONE absolute deadline per request (real time): insert and read-back that each fit alone but not together is 503 OUTCOME_UNKNOWN', async () => {
  // Budget 40 ms; the insert and the read-back each take 25 ms. Per-call deadlines would let both through (201); one
  // request deadline leaves the read-back only about 15 ms, so it is cut and the save answers OUTCOME_UNKNOWN.
  const base = createMemoryRepository();
  const slow: MemoryShowsRepository = {
    ...base,
    insert: async (show, now) => { await sleep(25); return base.insert(show, now); },
    get: async id => { await sleep(25); return base.get(id); },
  };
  const response = await api(slow, { deadlineMs: 40 }).save({ ...SHOW, operationId: KEY });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
  // 25 + 25 > 40 always, so the status above is deterministic. Which call is cut depends on load: the budget also covers
  // parsing and validation, so under load the insert may never start, or may land late. The fake-clock test below pins
  // the read-back case exactly. Whatever happened, a retry with the same key and a fresh budget gets 201 or a 200 replay,
  // and the store ends with exactly one document.
  const retry = await api(base, { deadlineMs: 5000 }).save({ ...SHOW, operationId: KEY });
  assert.ok(retry.status === 201 || (retry.status === 200 && retry.body.idempotentReplay === true), JSON.stringify(retry));
  await sleep(150);   // let a late first insert settle: it can only be a duplicate now
  assert.equal(base.size(), 1);
});

test('ONE absolute deadline per request (fake clock): once the insert spends the budget, the read-back is never started', async () => {
  let clock = 0;
  let gets = 0;
  const base = createMemoryRepository();
  const spending: MemoryShowsRepository = {
    ...base,
    insert: async (show, now) => { clock += 1000; return base.insert(show, now); },
    get: async id => { gets++; return base.get(id); },
  };
  const response = await api(spending, { deadlineMs: 1000, clock: () => clock }).save({ ...SHOW, operationId: KEY });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
  assert.equal(gets, 0);
});

test('each request has its own budget: GETs after a slow request are not penalised', async () => {
  let clock = 0;
  const base = createMemoryRepository();
  const saved = await api(base).save({ ...SHOW, operationId: KEY });
  const timed: MemoryShowsRepository = { ...base, get: async id => { clock += 600; return base.get(id); }, list: async page => { clock += 600; return base.list(page); } };
  const t = api(timed, { deadlineMs: 1000, clock: () => clock });
  assert.equal((await t.call('GET', `/api/shows/${saved.body.show.id}`)).status, 200);
  assert.equal((await t.call('GET', '/api/shows')).status, 200);
  assert.equal(clock, 1200, 'both ran: the second request started a fresh 1000 ms budget');
});

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
  // A clock frozen at 0 makes the start check always pass (load cannot keep the insert from starting), while the real
  // 20 ms timer still cuts the slow answer: the write lands, the answer is OUTCOME_UNKNOWN. Deterministic under load.
  const t = api(late, { deadlineMs: 20, clock: () => 0 });
  const first = await t.save({ ...SHOW, operationId: KEY });
  assert.equal(first.status, 503);
  assert.deepEqual(first.body.error.details, [{ path: '', reason: 'OUTCOME_UNKNOWN' }]);
  assert.equal(base.size(), 1, 'the write landed before the deadline cut the answer');
  slow = false;
  await new Promise(resolve => setTimeout(resolve, 80));
  const retry = await api(late, { deadlineMs: 5000 }).save({ ...SHOW, operationId: KEY });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(base.size(), 1);
});
