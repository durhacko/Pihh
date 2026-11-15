// MDB-WP-03 (#241): the gateway's import of the app's validator gives the app's verdict on the whole WP-02 corpus
// (tests/persistence/fixtures/*.json, MDB-T01–T10 via MDB-T09's "one validator, four call sites"), at the app's
// smallest and largest n0 (MDB-T08), and the server-side hashes (spec section 7.3) match the corpus's contentHash.
// Also pins the two values the gateway restates: APP_N0_RANGE (src/app/main.ts ROSTERS) and LISTABLE_KINDS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTABLE_KINDS } from '../../src/shows/repository.ts';
import {
  APP_N0_RANGE, canonicalJson, contentHash, makeParams, requestHash, validateComposition, validateShowRequest,
  type CompositionIssue, type Params,
} from '../../src/shows/validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const fixtureDir = join(repo, 'tests/persistence/fixtures');

type Expect = { ok: true; output: unknown; contentHash: string } | { ok: false; errors: { path: string; reason: string }[] };
interface Case { name: string; target: 'composition' | 'request'; input: unknown; expect: Expect }
interface Fixture { id: string; cases: Case[] }

const corpus: Fixture[] = readdirSync(fixtureDir).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8')) as Fixture);
const cases = corpus.flatMap(f => f.cases.map(c => ({ ...c, id: `${f.id} · ${c.name}` })));
const pairs = (errors: readonly { path: string; reason: string }[]) => errors.map(e => `${e.path} ${e.reason}`).sort();
const run = (c: Case, params: Params) => (c.target === 'request' ? validateShowRequest(c.input, params) : validateComposition(c.input, params));

test('the corpus is the WP-02 one, with an accepted manual show', () => {
  assert.ok(corpus.length >= 11, `${corpus.length} fixture files`);
  assert.ok(cases.length > 100, `${cases.length} cases`);
  assert.equal(cases.find(c => c.name === 'FX-SHOW')?.expect.ok, true);
});

for (const n0 of [APP_N0_RANGE.smallest, APP_N0_RANGE.largest]) {
  test(`every fixture gets the app's verdict, paths, reasons, output and contentHash through the gateway import (n0 ${n0})`, () => {
    const params = makeParams(n0);
    const wrong: string[] = [];
    for (const c of cases) {
      const result = run(c, params);
      if (c.expect.ok) {
        if (!result.ok) { wrong.push(`${c.id}: rejected ${JSON.stringify(result.errors)}`); continue; }
        const output = 'request' in result ? result.request : result.composition;
        const composition = 'request' in result ? result.request.composition : result.composition;
        if (canonicalJson(output) !== canonicalJson(c.expect.output)) wrong.push(`${c.id}: output ${JSON.stringify(output)}`);
        if (contentHash(composition) !== c.expect.contentHash) wrong.push(`${c.id}: contentHash ${contentHash(composition)}`);
      } else if (result.ok) {
        wrong.push(`${c.id}: accepted`);
      } else if (JSON.stringify(pairs(result.errors as CompositionIssue[])) !== JSON.stringify(pairs(c.expect.errors))) {
        wrong.push(`${c.id}: ${JSON.stringify(pairs(result.errors as CompositionIssue[]))}`);
      }
    }
    assert.deepEqual(wrong, []);
  });
}

test('contentHash is sha256 of canonicalJson(composition), independent of key order', () => {
  const a = { v: 1 as const, movements: [{ recipe: { kind: 'sphere' as const }, holdTicks: 600 }] };
  const b = JSON.parse('{"movements":[{"holdTicks":600,"recipe":{"kind":"sphere"}}],"v":1}') as typeof a;
  const expected = createHash('sha256').update('{"movements":[{"holdTicks":600,"recipe":{"kind":"sphere"}}],"v":1}', 'utf8').digest('hex');
  assert.equal(contentHash(a), expected);
  assert.equal(contentHash(b), expected);
});

test('requestHash covers title, prompt, source, generator and composition, and ignores operationId', () => {
  const params = makeParams(APP_N0_RANGE.smallest);
  const body = { schemaVersion: 1, title: 'HELLO to Helix', source: 'manual', composition: { v: 1, movements: [{ recipe: { kind: 'helix' }, holdTicks: 600 }] } };
  const hashOf = (input: unknown) => {
    const checked = validateShowRequest(input, params);
    assert.ok(checked.ok, JSON.stringify(checked));
    return requestHash(checked.request);
  };
  const base = hashOf(body);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(hashOf({ ...body, operationId: '00000000-0000-4000-8000-000000000001' }), base, 'operationId excluded');
  assert.equal(hashOf({ ...body, title: '  HELLO to Helix  ' }), base, 'after normalisation (title trimmed)');
  assert.notEqual(hashOf({ ...body, title: 'Another' }), base);
  assert.notEqual(hashOf({ ...body, prompt: 'glow' }), base);
  assert.notEqual(hashOf({ ...body, composition: { v: 1, movements: [{ recipe: { kind: 'helix' }, holdTicks: 601 }] } }), base);
  assert.notEqual(hashOf({ ...body, source: 'gemini', generator: { model: 'm', integrationVersion: '1' } }), base);
});

test('APP_N0_RANGE is the smallest and largest of the app rosters (src/app/main.ts ROSTERS)', () => {
  const main = readFileSync(join(repo, 'src/app/main.ts'), 'utf8');
  const match = /const ROSTERS = \[([^\]]*)\]/.exec(main);
  assert.ok(match, 'ROSTERS not found in src/app/main.ts');
  const rosters = (match[1] ?? '').split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  assert.deepEqual(APP_N0_RANGE, { smallest: Math.min(...rosters), largest: Math.max(...rosters) });
});

test('LISTABLE_KINDS is exactly the recipe kinds the app validator accepts', () => {
  const params = makeParams(APP_N0_RANGE.smallest);
  const sample: Record<string, unknown> = { text: { kind: 'text', text: 'HI' }, sphere: { kind: 'sphere' }, helix: { kind: 'helix' } };
  for (const kind of LISTABLE_KINDS) assert.equal(validateComposition({ v: 1, movements: [{ recipe: sample[kind], holdTicks: 600 }] }, params).ok, true, kind);
  for (const kind of ['generated', 'cube', 'svg', '']) {
    const result = validateComposition({ v: 1, movements: [{ recipe: { kind }, holdTicks: 600 }] }, params);
    assert.equal(result.ok, false, kind);
  }
});
