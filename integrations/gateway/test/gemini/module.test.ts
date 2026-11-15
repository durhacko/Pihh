import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGeminiConfig } from '../../src/gemini/config.ts';
import { createModule, defaultGeminiDeps, geminiModule, GENERATE_FORMATION_ROUTE } from '../../src/gemini/index.ts';
import { fakeProvider, fakeValidator } from './fakes.ts';

const KEY = 'test-key-not-real-0123456789';

test('gemini module: disabled offline, and its route is registered anyway', () => {
  const module = createModule({});
  assert.equal(module.name, 'gemini');
  assert.deepEqual(module.health(), { enabled: false, trialCompile: false });
  assert.deepEqual(module.routes.map(r => [r.method, r.path]), [[GENERATE_FORMATION_ROUTE.method, GENERATE_FORMATION_ROUTE.path]]);
});

test('gemini module: a configured key alone does not enable it in this build (no provider)', () => {
  const module = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.deepEqual(module.health(), { enabled: false, trialCompile: false });
  assert.ok(!JSON.stringify(module.health()).includes(KEY));
});

test('gemini module: enabled only with config, provider and validator together', () => {
  const config = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  const provider = fakeProvider(async () => ({ kind: 'blocked' }));
  const validator = fakeValidator(() => ({ ok: false, issues: [] }));
  assert.equal(geminiModule({ config, provider, validator }).health().enabled, true);
  assert.equal(geminiModule({ config, provider: null, validator }).health().enabled, false);
  assert.equal(geminiModule({ config, provider, validator: null }).health().enabled, false);
  assert.equal(geminiModule({ config: readGeminiConfig({}), provider, validator }).health().enabled, false);
  assert.equal(geminiModule(defaultGeminiDeps(config)).health().enabled, false);
});

test('(6) createModule reports ignored GEMINI_* values as problems, never their values', () => {
  const module = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'Bad Model!', GEMINI_REQUEST_TIMEOUT_MS: '-5' });
  assert.equal(module.problems?.length, 2);
  assert.ok(module.problems?.every(p => !p.includes('Bad Model!') && !p.includes('-5') && !p.includes(KEY)));
  assert.deepEqual(createModule({}).problems, [], 'a disabled module reads, and reports, nothing');
});
