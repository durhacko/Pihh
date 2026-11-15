import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGeminiConfig } from '../../src/gemini/config.ts';
import { createModule, defaultGeminiDeps, geminiModule, GENERATE_FORMATION_ROUTE } from '../../src/gemini/index.ts';
import { liveGeminiDeps, loadSceneSchemas } from '../../src/gemini/module.ts';
import { fakeProvider, fakeValidator } from './fakes.ts';

const KEY = 'test-key-not-real-0123456789';

test('gemini module: disabled offline, and its route is registered anyway', () => {
  const module = createModule({});
  assert.equal(module.name, 'gemini');
  assert.deepEqual(module.health(), { enabled: false, trialCompile: false });
  assert.deepEqual(module.routes.map(r => [r.method, r.path]), [[GENERATE_FORMATION_ROUTE.method, GENERATE_FORMATION_ROUTE.path]]);
});

test('gemini module (D3): the enable flag AND a key make it live; either alone keeps it off; health never shows the key', () => {
  const live = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.equal(live.health().enabled, true);
  assert.ok(!JSON.stringify(live.health()).includes(KEY));
  assert.ok(!JSON.stringify(live).includes(KEY));
  assert.equal(createModule({ GEMINI_API_KEY: KEY }).health().enabled, false, 'a key without the flag stays off');
  assert.equal(createModule({ GEMINI_ENABLED: '1' }).health().enabled, false, 'the flag without a key stays off');
});

test('gemini module (D3): the live deps send the committed scene schemas through the injected transport, nothing else', async () => {
  const calls: { url: string; body: string; redirect: string }[] = [];
  const transport = async (url: string, init: { body: string; redirect: string }) => {
    calls.push({ url, body: init.body, redirect: init.redirect });
    return { status: 503, body: null };
  };
  const deps = liveGeminiDeps(readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY }), transport);
  assert.ok(deps.provider);
  const outcome = await deps.provider!.generate({ prompt: 'a white sphere', mode: 'scene3d', attemptTimeoutMs: 5_000 }, new AbortController().signal);
  assert.deepEqual(outcome, { kind: 'upstream-error', status: 503 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
  assert.equal(calls[0]!.redirect, 'error');
  const sent = JSON.parse(calls[0]!.body) as { generationConfig: { responseJsonSchema: unknown } };
  assert.deepEqual(sent.generationConfig.responseJsonSchema, loadSceneSchemas().scene3d);
  assert.equal(liveGeminiDeps(readGeminiConfig({})).provider, null, 'disabled: no provider is built');
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
