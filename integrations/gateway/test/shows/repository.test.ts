// MDB-WP-03 (#241): the memory repository against the shared contract suite, and the pure repository rules: cursor
// re-typing (spec section 11, MDB-T14), the per-item listing check (section 10.3, MDB-T14), validation on read
// (sections 7.4, 9; MDB-T16), the duplicate-key outcome (section 10.5) and the no-telemetry rule for the types (MD-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepository } from '../../src/shows/memoryRepository.ts';
import {
  compareKeys, decodeCursor, encodeCursor, isStoredTitle, outcomeAfterDuplicate, readStoredShow, toSummary,
} from '../../src/shows/repository.ts';
import { INVALID_SHOW_TITLE, type SavedShowDoc } from '../../src/shows/types.ts';
import { compositionPreview, contentHash, makeParams, requestHash, validateShowRequest } from '../../src/shows/validate.ts';
import { hex64, newShow, repositoryContract, uuid, walk } from './repositoryContract.ts';

const here = dirname(fileURLToPath(import.meta.url));

repositoryContract('memory repository', () => createMemoryRepository());

// ------------------------------------------------------------------------------------------------------ cursor

const ID = '65a1b2c3d4e5f60718293a4b';
const raw = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url');

test('cursor: [ms, hex] round-trips, and the key is rebuilt from a fresh Date and the hex string', () => {
  const key = { createdAt: new Date(Date.UTC(2026, 10, 15, 9, 30)), id: ID };
  const cursor = encodeCursor(key);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(cursor), key);
  assert.deepEqual(decodeCursor(raw([0, ID])), { createdAt: new Date(0), id: ID });
});

test('cursor: everything else is rejected before any query (MDB-T14 tampered cursors)', () => {
  const rejected: [string, unknown][] = [
    ['over 128 characters', 'A'.repeat(129)],
    ['empty', ''],
    ['not a string', 42],
    ['invalid base64url characters', 'abc+/='],
    ['padding', `${raw([0, ID])}=`],
    ['invalid JSON', raw('{not json')],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x5b]).toString('base64url')],
    ['an object', raw({ createdAt: 0, id: ID })],
    ['an operator object', raw([{ $gt: '' }, ID])],
    ['an operator id', raw([0, { $ne: null }])],
    ['a string ms', raw(['1', ID])],
    ['a float', raw([1.5, ID])],
    ['a negative', raw([-1, ID])],
    ['beyond the Date range', raw([8.64e15 + 1, ID])],
    ['a third element', raw([0, ID, 1])],
    ['one element', raw([0])],
    ['upper-case hex', raw([0, ID.toUpperCase()])],
    ['23 hex', raw([0, ID.slice(1)])],
    ['null', raw(null)],
  ];
  for (const [name, cursor] of rejected) assert.equal(decodeCursor(cursor), null, name);
  // A non-canonical spelling of a valid cursor (a spare trailing bit set) decodes to the same bytes but is refused,
  // so each key has one cursor. [10, ID] is 31 bytes: the last base64url character carries 4 spare bits.
  const good = raw([10, ID]);
  assert.notEqual(Buffer.from(JSON.stringify([10, ID])).length % 3, 0, 'the payload must leave spare bits');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const sibling = alphabet[alphabet.indexOf(good.at(-1) as string) ^ 1] as string;
  const twin = good.slice(0, -1) + sibling;
  assert.notEqual(twin, good);
  assert.ok(Buffer.from(twin, 'base64url').equals(Buffer.from(good, 'base64url')), 'same bytes, different spelling');
  assert.deepEqual(decodeCursor(good), { createdAt: new Date(10), id: ID });
  assert.equal(decodeCursor(twin), null);
});

test('compareKeys: newer first, then the larger id; equal keys compare 0', () => {
  const a = { createdAt: new Date(2000), id: '00000000000000000000000a' };
  const b = { createdAt: new Date(1000), id: 'ffffffffffffffffffffffff' };
  const c = { createdAt: new Date(2000), id: '00000000000000000000000b' };
  assert.ok(compareKeys(a, b) < 0);
  assert.ok(compareKeys(c, a) < 0);
  assert.equal(compareKeys(a, { ...a }), 0);
});

test('outcomeAfterDuplicate: the stored id and requestHash, or outcome-unknown when it cannot be read', () => {
  assert.deepEqual(outcomeAfterDuplicate({ _id: ID, requestHash: hex64(7) }), { kind: 'duplicate', id: ID, requestHash: hex64(7) });
  assert.deepEqual(outcomeAfterDuplicate(null), { kind: 'outcome-unknown' });
});

// ------------------------------------------------------------------------------------------- listing per item

const T = new Date(Date.UTC(2026, 10, 15, 10, 0));
const storedProjection = (patch: Record<string, unknown> = {}) => ({
  _id: ID, title: 'HELLO to Helix', source: 'manual', schemaVersion: 1, createdAt: T,
  preview: { movementCount: 2, kinds: ['text', 'sphere'] }, ...patch,
});

test('toSummary: a valid projection is a loadable summary with metadata only', () => {
  assert.deepEqual(toSummary(storedProjection()), {
    id: ID, title: 'HELLO to Helix', source: 'manual', createdAt: T.toISOString(), movementCount: 2, kinds: ['text', 'sphere'],
    schemaVersion: 1, loadable: true,
  });
});

test('toSummary: FX-LIST-BAD items come back invalid, with the fixed title and no stored value', () => {
  const bad: [string, unknown][] = [
    ['not an object', 'show'],
    ['title empty', storedProjection({ title: '' })],
    ['title untrimmed', storedProjection({ title: ' HELLO ' })],
    ['title 81 code points', storedProjection({ title: 'x'.repeat(81) })],
    ['title with a control character', storedProjection({ title: 'A\u0007B' })],
    ['title with a format character', storedProjection({ title: 'A‮B' })],
    ['title not a string', storedProjection({ title: 7 })],
    ['unknown source', storedProjection({ source: 'atlas' })],
    ['createdAt a string', storedProjection({ createdAt: T.toISOString() })],
    ['createdAt invalid', storedProjection({ createdAt: new Date(Number.NaN) })],
    ['schemaVersion 0', storedProjection({ schemaVersion: 0 })],
    ['schemaVersion a string', storedProjection({ schemaVersion: '1' })],
    ['preview missing', storedProjection({ preview: undefined })],
    ['movementCount 0', storedProjection({ preview: { movementCount: 0, kinds: [] } })],
    ['movementCount 17', storedProjection({ preview: { movementCount: 17, kinds: Array(17).fill('sphere') } })],
    ['kinds length mismatch', storedProjection({ preview: { movementCount: 2, kinds: ['text'] } })],
    ['unsupported kind', storedProjection({ preview: { movementCount: 1, kinds: ['cube'] } })],
    ['an injected title in a kind', storedProjection({ preview: { movementCount: 1, kinds: ['<b>x</b>'] } })],
    ['a hole in kinds', storedProjection({ preview: { movementCount: 2, kinds: (() => { const a: string[] = new Array<string>(2); a[0] = 'text'; return a; })() } })],
  ];
  for (const [name, doc] of bad) {
    const summary = toSummary(doc);
    assert.equal(summary.loadable, false, name);
    assert.equal(summary.title, INVALID_SHOW_TITLE, name);
    assert.deepEqual(Object.keys(summary).sort(), ['id', 'loadable', 'problem', 'title'], name);
    assert.equal((summary as { problem: string }).problem, 'invalid', name);
  }
  assert.equal(toSummary(storedProjection({ _id: 'not-hex' })).id, '');
});

test('toSummary: a newer schemaVersion is shown as unsupported-schema, never loadable', () => {
  const summary = toSummary(storedProjection({ schemaVersion: 2, preview: { movementCount: 1, kinds: ['generated'] } }));
  assert.deepEqual(summary, {
    id: ID, title: 'HELLO to Helix', source: 'manual', createdAt: T.toISOString(), movementCount: 1, kinds: ['generated'],
    schemaVersion: 2, loadable: false, problem: 'unsupported-schema',
  });
});

test('toSummary never reads composition or prompt (a getter there would throw)', () => {
  const doc = storedProjection();
  for (const key of ['composition', 'prompt']) Object.defineProperty(doc, key, { enumerable: true, get() { throw new Error(`read ${key}`); } });
  assert.equal(toSummary(doc).loadable, true);
});

test('memory repository: seeded invalid documents list as invalid and do not break paging', async () => {
  const repo = createMemoryRepository();
  await repo.insert(newShow(1), T);
  repo.seed({ ...storedProjection({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: '' }), operationId: uuid(99) });
  repo.seed({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', createdAt: 'yesterday' });
  const { items, next } = await repo.list({ limit: 50 });
  assert.equal(next, null);
  assert.equal(items.length, 3);
  assert.deepEqual(items.filter(s => !s.loadable).map(s => s.id).sort(), ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb']);
  // Paging one item at a time through the cursor codec still visits every document exactly once.
  const walked = await walk(repo, 1);
  assert.equal(walked.pages, 3);
  assert.deepEqual(walked.items.map(s => s.id).sort(), items.map(s => s.id).sort());
});

test('isStoredTitle agrees with the app validator on every title the validator accepts as already trimmed', () => {
  const params = makeParams(100);
  const titles = ['A', 'HELLO to Helix', 'x'.repeat(80), 'x'.repeat(81), '', ' padded', 'tab\there', 'zero​width', 'émoji 🎆', 'A\u0000', '\uD800', '\uDC00x', 'A\uD800', '🎆'];
  for (const title of titles) {
    const app = validateShowRequest({ schemaVersion: 1, title, composition: { v: 1, movements: [{ recipe: { kind: 'sphere' }, holdTicks: 600 }] }, source: 'manual' }, params);
    const appAccepts = app.ok && app.request.title === title;
    assert.equal(isStoredTitle(title), appAccepts, JSON.stringify(title));
  }
});

// -------------------------------------------------------------------------------------------- read validation

/** A stored document exactly as a correct save would write it: through the app's validator and the hash functions. */
function storedDoc(input: Record<string, unknown> = {}): SavedShowDoc {
  const checked = validateShowRequest({
    schemaVersion: 1, title: 'HELLO to Helix', prompt: 'make it glow', source: 'manual',
    composition: { v: 1, movements: [{ recipe: { kind: 'text', text: 'hello', palette: [[1, 0.6, 0.1], [0.2, 0.5, 1]] }, holdTicks: 600 }, { recipe: { kind: 'helix' }, holdTicks: 300 }] },
    ...input,
  }, makeParams(100));
  assert.ok(checked.ok, JSON.stringify(checked));
  const r = checked.request;
  return {
    _id: ID, schemaVersion: 1, title: r.title, ...(r.prompt !== undefined ? { prompt: r.prompt } : {}), composition: r.composition,
    contentHash: contentHash(r.composition), requestHash: requestHash(r), source: r.source, preview: compositionPreview(r.composition),
    operationId: uuid(1), createdAt: T, updatedAt: T,
  };
}

test('readStoredShow: a correctly saved document reads back as a SavedShow', () => {
  const doc = storedDoc();
  const result = readStoredShow(doc);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.show, {
    id: ID, title: 'HELLO to Helix', source: 'manual', createdAt: T.toISOString(), movementCount: 2, kinds: ['text', 'helix'],
    schemaVersion: 1, loadable: true, prompt: 'make it glow', composition: doc.composition, contentHash: doc.contentHash,
    updatedAt: T.toISOString(),
  });
  assert.equal(doc.composition.movements[0]!.recipe.kind === 'text' && doc.composition.movements[0]!.recipe.text, 'HELLO');
});

test('readStoredShow: FX-CORRUPT documents are STORED_SHOW_INVALID; a newer schemaVersion is SCHEMA_VERSION_UNSUPPORTED', () => {
  const base = storedDoc();
  const corrupt: [string, unknown][] = [
    ['not an object', null],
    ['an unknown key', { ...base, extra: 1 }],
    ['a runtime field', { ...base, version: { issuedTick: 0, origin: -1 } }],
    ['a $ key', { ...base, $set: {} }],
    // Only canonicality fails here: contentHash and preview are the canonical ones that R15 and the preview check recompute.
    ['lower-case text (not canonical)', { ...base, composition: { ...base.composition, movements: base.composition.movements.map(m => (m.recipe.kind === 'text' ? { ...m, recipe: { ...m.recipe, text: m.recipe.text.toLowerCase() } } : m)) } }],
    ['contentHash mismatch (R15)', { ...base, contentHash: hex64(1) }],
    ['contentHash not hex', { ...base, contentHash: 'x'.repeat(64) }],
    ['requestHash missing', { ...base, requestHash: undefined }],
    ['preview mismatch', { ...base, preview: { movementCount: 2, kinds: ['text', 'sphere'] } }],
    ['title untrimmed', { ...base, title: ` ${base.title}` }],
    ['schemaVersion 0', { ...base, schemaVersion: 0 }],
    ['operationId upper-case', { ...base, operationId: 'ABCDEF01-0000-4000-8000-0000000000AB' }],
    ['operationId not v4', { ...base, operationId: '00000000-0000-1000-8000-000000000001' }],
    ['createdAt a string', { ...base, createdAt: T.toISOString() }],
    ['updatedAt invalid', { ...base, updatedAt: new Date(Number.NaN) }],
    ['_id not hex', { ...base, _id: 'zzzzzzzzzzzzzzzzzzzzzzzz' }],
    ['holdTicks out of range', { ...base, composition: { v: 1, movements: [{ recipe: { kind: 'sphere' }, holdTicks: 6001 }] } }],
    ['source gemini without generator', { ...base, source: 'gemini' }],
    ['an accessor field', Object.defineProperty({ ...base }, 'title', { enumerable: true, get: () => 'x' })],
  ];
  for (const [name, doc] of corrupt) assert.deepEqual(readStoredShow(doc), { ok: false, code: 'STORED_SHOW_INVALID' }, name);
  assert.deepEqual(readStoredShow({ ...base, schemaVersion: 2, composition: 'anything newer' }), { ok: false, code: 'SCHEMA_VERSION_UNSUPPORTED' });
});

test('readStoredShow on a memory round trip: insert, get, read back', async () => {
  const repo = createMemoryRepository();
  const doc = storedDoc();
  const outcome = await repo.insert({
    title: doc.title, ...(doc.prompt !== undefined ? { prompt: doc.prompt } : {}), composition: doc.composition, contentHash: doc.contentHash,
    requestHash: doc.requestHash, source: doc.source, preview: doc.preview, operationId: doc.operationId,
  }, T);
  assert.equal(outcome.kind, 'created');
  if (outcome.kind !== 'created') return;
  const result = readStoredShow(await repo.get(outcome.id));
  assert.ok(result.ok);
  assert.equal(result.show.id, outcome.id);
});

// ------------------------------------------------------------------------------------------------------ types

test('the types hold no telemetry, frame, run record or runtime score field (MD-13, XI-6)', () => {
  const text = readFileSync(join(here, '../../src/shows/types.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const word of ['telemetry', 'frame', 'RunRecord', 'snapshot', 'stateHash', 'series', 'startTick', 'transitionTicks', 'droneId', 'slot', 'replay', 'latency', 'ScoreVersion', 'issuedTick']) {
    assert.ok(!new RegExp(word, 'i').test(text), word);
  }
});
