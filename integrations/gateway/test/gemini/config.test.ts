import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { moduleEnv, type Env } from '../../src/config.ts';
import { GEMINI_DEFAULTS, readGeminiConfig } from '../../src/gemini/config.ts';

const KEY = 'test-key-not-real-0123456789';

/** An env that records which variables were read. */
function recording(values: Record<string, string>): { env: Env; read: Set<string> } {
  const read = new Set<string>();
  const env = new Proxy(values, {
    get(target, name) {
      if (typeof name === 'string') read.add(name);
      return Reflect.get(target, name);
    },
  }) as Env;
  return { env, read };
}

test('offline by default: an empty environment disables gemini', () => {
  assert.deepEqual(readGeminiConfig({}), { enabled: false, reason: 'NOT_ENABLED' });
});

test('a key without the enable flag stays disabled and the key is never read', () => {
  const { env, read } = recording({ GEMINI_API_KEY: KEY });
  assert.deepEqual(readGeminiConfig(env), { enabled: false, reason: 'NOT_ENABLED' });
  assert.ok(!read.has('GEMINI_API_KEY'));
});

test('the enable flag without a key is disabled (NO_KEY)', () => {
  assert.deepEqual(readGeminiConfig({ GEMINI_ENABLED: '1' }), { enabled: false, reason: 'NO_KEY' });
  assert.deepEqual(readGeminiConfig({ GEMINI_ENABLED: 'true', GEMINI_API_KEY: '   ' }), { enabled: false, reason: 'NO_KEY' });
  assert.deepEqual(readGeminiConfig({ GEMINI_ENABLED: 'yes', GEMINI_API_KEY: KEY }), { enabled: false, reason: 'NOT_ENABLED' });
});

test('only GEMINI_API_KEY counts: GOOGLE_API_KEY and VITE_* never reach the module', () => {
  const { env, read } = recording({ GEMINI_ENABLED: '1', GOOGLE_API_KEY: KEY, VITE_GEMINI_API_KEY: KEY });
  assert.deepEqual(readGeminiConfig(env), { enabled: false, reason: 'NO_KEY' });
  assert.ok(!read.has('GOOGLE_API_KEY'));
  assert.ok([...read].every(name => name.startsWith('GEMINI_')), `read: ${[...read].join(', ')}`);
  // Through the skeleton the module only ever sees its own prefix.
  assert.deepEqual(Object.keys(moduleEnv({ GEMINI_ENABLED: '1', GOOGLE_API_KEY: KEY, VITE_GEMINI_API_KEY: KEY }, 'GEMINI_')), ['GEMINI_ENABLED']);
});

test('flag and key enable the module with the §10.3 defaults', () => {
  const gemini = readGeminiConfig({ GEMINI_ENABLED: 'TRUE', GEMINI_API_KEY: ` ${KEY} ` });
  assert.equal(gemini.enabled, true);
  if (!gemini.enabled) return;
  assert.equal(gemini.apiKey.reveal(), KEY);
  assert.equal(gemini.model, GEMINI_DEFAULTS.model);
  assert.equal(gemini.providerTimeoutMs, 30_000);
  assert.equal(gemini.requestTimeoutMs, 45_000);
});

test('the key never leaks through JSON, String or inspect', () => {
  const gemini = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.ok(gemini.enabled);
  for (const text of [JSON.stringify(gemini), String(gemini.enabled && gemini.apiKey), inspect(gemini, { depth: 10 })]) {
    assert.ok(!text.includes(KEY), text);
  }
});

test('bad values fall back to defaults and are reported without the key', () => {
  const problems: string[] = [];
  const gemini = readGeminiConfig({
    GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'Bad Model!',
    GEMINI_PROVIDER_TIMEOUT_MS: 'soon', GEMINI_REQUEST_TIMEOUT_MS: '-5',
  }, problems);
  assert.ok(gemini.enabled);
  if (!gemini.enabled) return;
  assert.equal(gemini.model, GEMINI_DEFAULTS.model);
  assert.equal(gemini.providerTimeoutMs, 30_000);
  assert.equal(gemini.requestTimeoutMs, 45_000);
  assert.equal(problems.length, 3);
  assert.ok(problems.every(p => !p.includes(KEY)));
});

test('the two timeouts are read separately', () => {
  const gemini = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_PROVIDER_TIMEOUT_MS: '12000', GEMINI_REQUEST_TIMEOUT_MS: '50000' });
  assert.ok(gemini.enabled);
  if (!gemini.enabled) return;
  assert.deepEqual([gemini.providerTimeoutMs, gemini.requestTimeoutMs], [12_000, 50_000]);
  const onlyProvider = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_PROVIDER_TIMEOUT_MS: '12000' });
  assert.ok(onlyProvider.enabled && onlyProvider.providerTimeoutMs === 12_000 && onlyProvider.requestTimeoutMs === GEMINI_DEFAULTS.requestTimeoutMs);
  const onlyRequest = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_REQUEST_TIMEOUT_MS: '60000' });
  assert.ok(onlyRequest.enabled && onlyRequest.providerTimeoutMs === GEMINI_DEFAULTS.providerTimeoutMs && onlyRequest.requestTimeoutMs === 60_000);
});

test('a request deadline below the provider timeout is raised to match', () => {
  const problems: string[] = [];
  const gemini = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_PROVIDER_TIMEOUT_MS: '20000', GEMINI_REQUEST_TIMEOUT_MS: '1000' }, problems);
  assert.ok(gemini.enabled && gemini.requestTimeoutMs === 20_000);
  assert.equal(problems.length, 1);
});
