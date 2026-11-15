// XI-2: modules import the pure app code in the repo's src/ by relative path. src/ uses bundler-style extensionless
// imports, which loader/resolve.mjs (loaded by `npm test` and `npm start`) resolves, and only for files under src/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, type NextResolve } from '../loader/resolve.mjs';
// Real src/ modules whose own imports are extensionless ('./font', '../contracts', ...).
import { canonicalJson } from '../../../src/score/canonical.ts';
import * as score from '../../../src/score/index.ts';

const SRC = new URL('../../../src/', import.meta.url).href;
const GATEWAY_SRC = new URL('../src/', import.meta.url).href;

function fakeNext(existing: string[]): { next: NextResolve; tried: string[] } {
  const tried: string[] = [];
  const next: NextResolve = async (specifier, context) => {
    tried.push(specifier);
    const url = new URL(specifier, context.parentURL).href;
    if (existing.includes(url)) return { url };
    const error = Object.assign(new Error(`not found: ${specifier}`), { code: specifier.endsWith('/') || !specifier.includes('.') ? 'ERR_UNSUPPORTED_DIR_IMPORT' : 'ERR_MODULE_NOT_FOUND' });
    throw error;
  };
  return { next, tried };
}

test('src/ modules with extensionless imports load at runtime through the hook', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.equal(typeof score.expandRecipe, 'function');
});

test('the hook retries <path>.ts, then <path>/index.ts, for a file inside src/', async () => {
  const parentURL = `${SRC}app/compose/validate.ts`;
  const file = fakeNext([`${SRC}score/font.ts`]);
  assert.equal((await resolve('../../score/font', { parentURL }, file.next)).url, `${SRC}score/font.ts`);
  assert.deepEqual(file.tried, ['../../score/font', '../../score/font.ts']);
  const dir = fakeNext([`${SRC}score/index.ts`]);
  assert.equal((await resolve('../../score', { parentURL }, dir.next)).url, `${SRC}score/index.ts`);
  assert.deepEqual(dir.tried, ['../../score', '../../score.ts', '../../score/index.ts']);
});

test('the hook leaves everything else alone: gateway files, packages, explicit extensions, other errors', async () => {
  const { next, tried } = fakeNext([`${GATEWAY_SRC}errors.ts`]);
  await assert.rejects(resolve('./errors', { parentURL: `${GATEWAY_SRC}router.ts` }, next), /not found/);
  await assert.rejects(resolve('node-fetch', { parentURL: `${SRC}app/main.ts` }, next), /not found/);
  await assert.rejects(resolve('./missing.ts', { parentURL: `${SRC}app/main.ts` }, next), /not found/);
  assert.deepEqual(tried, ['./errors', 'node-fetch', './missing.ts'], 'no retries outside src/ or with an extension');
  const odd: NextResolve = async () => { throw Object.assign(new Error('boom'), { code: 'ERR_INVALID_URL' }); };
  await assert.rejects(resolve('./x', { parentURL: `${SRC}a.ts` }, odd), /boom/);
});

test('the scripts load the hook, and the loader imports only node:module', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  for (const script of ['test', 'start']) assert.match(pkg.scripts[script] ?? '', /--import \.\/loader\/register\.mjs/, script);
  const register = readFileSync(new URL('../loader/register.mjs', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../loader/resolve.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...register.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(m => m[1]), ['node:module']);
  assert.deepEqual([...hook.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(m => m[1]), []);
});
