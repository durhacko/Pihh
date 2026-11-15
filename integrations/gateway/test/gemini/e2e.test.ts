// GF-T33 (gateway side) end to end: real server, real guard, real validator and sceneHash, a scripted fake provider.
// Every socket is 127.0.0.1; the fake records every upstream call, so "no call" is checked directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { startGateway, type AccessEntry, type RunningGateway } from '../../src/server.ts';
import type { ModuleEntry } from '../../src/modules.ts';
import { readGeminiConfig } from '../../src/gemini/config.ts';
import { geminiModule, liveGeminiDeps } from '../../src/gemini/module.ts';
import type { Transport, TransportInit } from '../../src/gemini/geminiProvider.ts';
import { scriptedProvider, stopWith, FAKE_MODEL, type FakeStep, type ScriptedProvider } from '../../src/gemini/fakeProvider.ts';
import { createSceneValidator, type TrialCompile } from '../../src/gemini/validate.ts';
import { RETRY_POLICY } from '../../src/gemini/provider.ts';
import { sceneHash } from '../../../../src/score/generated/hashing.ts';

const APP = 'http://localhost:5173';
const KEY = 'test-key-not-real-0123456789';
const SPHERE = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/scenes/valid-3d-sphere.json', import.meta.url), 'utf8')) as Record<string, unknown>;

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }

function post(g: RunningGateway, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request({
      host: '127.0.0.1', port: g.port, method: 'POST', path: '/api/generate-formation',
      headers: { host: `127.0.0.1:${g.port}`, 'content-type': 'application/json', origin: APP, ...headers },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', fail);
    req.end(text);
  });
}

const reasons = (r: Reply) => ((r.body.error as { details?: { reason: string }[] } | undefined)?.details ?? []).map(d => d.reason);
const code = (r: Reply) => (r.body.error as { code?: string } | undefined)?.code;

/** A gateway whose gemini module has the fake provider and the real validator; retries never actually wait. */
async function withGemini(steps: FakeStep[], run: (g: RunningGateway, fake: ScriptedProvider, log: AccessEntry[]) => Promise<void>,
  options: { env?: Record<string, string>; compile?: (scene: unknown, n0s: readonly number[]) => TrialCompile } = {}) {
  const fake = scriptedProvider(steps);
  const validator = options.compile ? createSceneValidator(options.compile) : createSceneValidator();
  const registry: ModuleEntry[] = [{
    name: 'gemini', envPrefix: 'GEMINI_',
    create: env => geminiModule({ config: readGeminiConfig(env), provider: fake, validator }, { random: () => 0.5, sleep: async () => {} }),
  }];
  const log: AccessEntry[] = [];
  const g = await startGateway({ GATEWAY_ALLOWED_ORIGINS: APP, GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, ...options.env }, { port: 0, registry, log: e => log.push(e) });
  try {
    await run(g, fake, log);
  } finally {
    await g.close();
  }
}

const ASK = { prompt: '  a white sphere  ', mode: 'scene3d', requestId: 'r-000042' };

test('success: the §10.1 body, the server\'s own sceneHash, the requestId echoed, the trimmed prompt sent', async () => {
  await withGemini([stopWith(SPHERE, 1234.4)], async (g, fake) => {
    const r = await post(g, ASK);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['mode', 'model', 'modelLatencyMs', 'requestId', 'scene', 'sceneHash']);
    assert.equal(r.body.model, FAKE_MODEL);
    assert.equal(r.body.requestId, 'r-000042');
    assert.equal(r.body.modelLatencyMs, 1234);
    assert.equal(r.body.sceneHash, sceneHash(r.body.scene as never), 're-hashed on the server');
    assert.deepEqual(fake.calls.map(c => [c.prompt, c.mode]), [['a white sphere', 'scene3d']]);
    assert.ok(!JSON.stringify(r.body).includes(KEY));
  });
});

test('a sceneHash the model invents is never used (it is an unknown field, so the scene is refused)', async () => {
  await withGemini([stopWith({ ...SPHERE, sceneHash: 'f'.repeat(64) })], async g => {
    const r = await post(g, ASK);
    assert.deepEqual([r.status, reasons(r)[0]], [400, 'SCENE_INVALID']);
  });
});

test('(1) a provider that never answers gives 504 TIMEOUT within the deadline', async () => {
  await withGemini([{ hang: true }], async g => {
    const started = Date.now();
    const r = await post(g, ASK);
    assert.deepEqual([r.status, code(r), reasons(r)], [504, 'TIMEOUT', ['TIMEOUT']]);
    assert.ok(Date.now() - started < 3_000);
  }, { env: { GEMINI_PROVIDER_TIMEOUT_MS: '100', GEMINI_REQUEST_TIMEOUT_MS: '300' } });
});

test('(2) 429 and 503 are retried up to the cap, then mapped; a later success wins', async () => {
  for (const [status, http, codeName, reason] of [[429, 429, 'RATE_LIMITED', 'PROVIDER_RATE_LIMITED'], [503, 503, 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE']] as const) {
    await withGemini([{ raw: { httpStatus: status } }], async (g, fake) => {
      const r = await post(g, ASK);
      assert.deepEqual([r.status, code(r), reasons(r)], [http, codeName, [reason]]);
      assert.equal(fake.calls.length, 1 + RETRY_POLICY.maxRetries);
    });
    await withGemini([{ raw: { httpStatus: status } }, stopWith(SPHERE)], async (g, fake) => {
      assert.equal((await post(g, ASK)).status, 200);
      assert.equal(fake.calls.length, 2);
    });
  }
});

test('(3) 400, 402 and 403 are not retried: one call, 502 PROVIDER_ERROR', async () => {
  for (const status of [400, 402, 403]) {
    await withGemini([{ raw: { httpStatus: status } }], async (g, fake) => {
      const r = await post(g, ASK);
      assert.deepEqual([r.status, code(r), reasons(r)], [502, 'PROVIDER_ERROR', ['PROVIDER_ERROR']]);
      assert.equal(fake.calls.length, 1, String(status));
    });
  }
});

test('(4) empty, truncated, schema-invalid or oversize output gives a typed error and no partial scene', async () => {
  const cases: [FakeStep, number, string][] = [
    [{ raw: { httpStatus: 200, finishReason: 'STOP', text: '' } }, 502, 'INVALID_MODEL_OUTPUT'],
    [{ raw: { httpStatus: 200, finishReason: 'STOP', text: JSON.stringify(SPHERE).slice(0, 40) } }, 502, 'INVALID_MODEL_OUTPUT'],
    [stopWith({ ...SPHERE, parts: [] }), 400, 'SCENE_INVALID'],
    [stopWith({ version: 1, mode: 'scene3d' }), 400, 'SCENE_INVALID'],
    [{ raw: { httpStatus: 200, finishReason: 'STOP', text: ' '.repeat(64 * 1024 + 1) } }, 502, 'RESPONSE_TOO_LARGE'],
  ];
  for (const [step, status, reason] of cases) {
    await withGemini([step], async g => {
      const r = await post(g, ASK);
      assert.deepEqual([r.status, reasons(r)[0]], [status, reason]);
      assert.equal(r.body.scene, undefined, 'no partial scene');
      assert.ok(Object.keys(r.body).every(k => k === 'error'));
    });
  }
});

test('(4) a scene invalid on the server names the first failing layer at its /scene path', async () => {
  const bad = { ...SPHERE, parts: [{ ...(SPHERE.parts as Record<string, unknown>[])[0], materialId: 'gold' }] };
  await withGemini([stopWith(bad)], async g => {
    const r = await post(g, ASK);
    assert.equal(r.status, 400);
    assert.deepEqual((r.body.error as { details: unknown }).details, [{ path: '', reason: 'SCENE_INVALID' }, { path: '/scene/parts/0/materialId', reason: 'REFERENCE' }]);
  });
});

test('(5) finish reasons: MAX_TOKENS → RESPONSE_TOO_LARGE; SAFETY, RECITATION or blockReason → PROVIDER_BLOCKED; never parsed', async () => {
  const cases: [FakeStep, string][] = [
    [{ raw: { httpStatus: 200, finishReason: 'MAX_TOKENS', text: JSON.stringify(SPHERE) } }, 'RESPONSE_TOO_LARGE'],
    [{ raw: { httpStatus: 200, finishReason: 'SAFETY', text: JSON.stringify(SPHERE) } }, 'PROVIDER_BLOCKED'],
    [{ raw: { httpStatus: 200, finishReason: 'RECITATION', text: JSON.stringify(SPHERE) } }, 'PROVIDER_BLOCKED'],
    [{ raw: { httpStatus: 200, blockReason: 'SAFETY', finishReason: 'STOP', text: JSON.stringify(SPHERE) } }, 'PROVIDER_BLOCKED'],
    [{ raw: { httpStatus: 200, finishReason: 'PROHIBITED_CONTENT', text: JSON.stringify(SPHERE) } }, 'PROVIDER_BLOCKED'],
    [{ raw: { httpStatus: 200, finishReason: 'OTHER', text: JSON.stringify(SPHERE) } }, 'PROVIDER_ERROR'],
  ];
  for (const [step, reason] of cases) {
    await withGemini([step], async (g, fake) => {
      const r = await post(g, ASK);
      assert.deepEqual([r.status, code(r), reasons(r)], [502, 'PROVIDER_ERROR', [reason]]);
      assert.equal(r.body.scene, undefined);
      assert.equal(fake.calls.length, 1, 'a finish reason is never retried');
    });
  }
});

test('(6) with the gemini routes on, the shared guard refuses before any upstream call; no CORS headers', async () => {
  await withGemini([stopWith(SPHERE)], async (g, fake) => {
    const refused: [Record<string, string>, number][] = [
      [{ 'content-type': 'text/plain' }, 415],
      [{ host: 'evil.example:80' }, 403],
      [{ host: `localhost.evil.example:${g.port}` }, 403],
      [{ origin: 'http://evil.example' }, 403],
      [{ origin: 'null' }, 403],
    ];
    for (const [headers, status] of refused) assert.equal((await post(g, ASK, headers)).status, status, JSON.stringify(headers));
    const noOrigin = await new Promise<number>((ok, fail) => {
      const req = request({ host: '127.0.0.1', port: g.port, method: 'POST', path: '/api/generate-formation', headers: { host: `127.0.0.1:${g.port}`, 'content-type': 'application/json' } }, res => { res.resume(); ok(res.statusCode ?? 0); });
      req.on('error', fail);
      req.end(JSON.stringify(ASK));
    });
    assert.equal(noOrigin, 403);
    assert.equal(fake.calls.length, 0, 'the fake upstream recorded no call');
    const ok = await post(g, ASK);
    assert.equal(ok.status, 200);
    for (const name of Object.keys(ok.headers)) assert.ok(!name.startsWith('access-control-'), name);
  });
});

test('(6) the gemini module defines no server, guard or error helper of its own', () => {
  const dir = new URL('../../src/gemini/', import.meta.url);
  for (const name of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/node:http|createServer|\.listen\(/.test(text), `${name} builds a server`);
    assert.ok(!/function\s+(?:guardRequest|errorResponse|sanitise|redact)\b|const\s+(?:guardRequest|errorResponse)\s*=/.test(text), `${name} redefines a skeleton helper`);
    assert.ok(!/from\s+['"]\.\.\/guard\.ts['"]/.test(text), `${name} calls the guard itself`);
  }
});

test('(7) a prompt over 500 characters is 400 PROMPT_TOO_LONG with no upstream call; exactly 500 is accepted', async () => {
  await withGemini([stopWith(SPHERE)], async (g, fake) => {
    const long = await post(g, { ...ASK, prompt: 'x'.repeat(501) });
    assert.deepEqual([long.status, code(long), reasons(long)], [400, 'VALIDATION_FAILED', ['PROMPT_TOO_LONG']]);
    assert.equal(fake.calls.length, 0);
    assert.equal((await post(g, { ...ASK, prompt: 'é'.repeat(500) })).status, 200);
    assert.equal(fake.calls.length, 1);
    const extra = await post(g, { ...ASK, temperature: 2 });
    assert.deepEqual([extra.status, reasons(extra)], [400, ['BAD_REQUEST']]);
    assert.equal(fake.calls.length, 1, 'an extra field is refused before any upstream call');
  });
});

test('(8) a requestId that does not match is dropped, the request still succeeds, and the log has the server\'s own id', async () => {
  await withGemini([stopWith(SPHERE)], async (g, _fake, log) => {
    for (const requestId of ['r'.repeat(65), 'has space', 'r-é', '']) {
      const r = await post(g, { ...ASK, requestId });
      assert.equal(r.status, 200, requestId);
      assert.equal(r.body.requestId, undefined, requestId);
    }
    assert.equal((await post(g, { ...ASK, requestId: 'r'.repeat(64) })).body.requestId, 'r'.repeat(64));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(log.length, 5);
    assert.deepEqual(log.map(e => e.serverId), ['g-1', 'g-2', 'g-3', 'g-4', 'g-5']);
    assert.ok(log.every(e => e.path === '/api/generate-formation' && e.status === 200 && e.method === 'POST'));
    assert.ok(!JSON.stringify(log).includes(KEY) && !JSON.stringify(log).includes('sphere'), 'no key or prompt in the log');
  });
});

test('(9) feasibility wiring: a trial compile that fails at one roster limit refuses the scene with the compiler code', async () => {
  const compile = (_scene: unknown, n0s: readonly number[]): TrialCompile => ({ status: 'rejected', n0: n0s[n0s.length - 1] ?? 0, code: 'below-floor', path: '' });
  await withGemini([stopWith(SPHERE)], async g => {
    const r = await post(g, ASK);
    assert.equal(r.status, 400);
    assert.deepEqual(reasons(r), ['SCENE_INVALID', 'BELOW_FLOOR']);
  }, { compile });
});

test('D3 through the stack: flag + key make the module live; a FAKE transport answers once; the key appears nowhere but its header', async () => {
  const calls: { url: string; init: TransportInit }[] = [];
  // RECORDED-SHAPE fake answer (see geminiProvider.test.ts): one STOP candidate carrying the committed sphere scene.
  const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(SPHERE) }] }, finishReason: 'STOP' }] });
  const transport: Transport = async (url, init) => {
    calls.push({ url, init });
    const bytes = new TextEncoder().encode(answer);
    return { status: 200, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }) };
  };
  const registry: ModuleEntry[] = [{
    name: 'gemini', envPrefix: 'GEMINI_',
    create: env => geminiModule(liveGeminiDeps(readGeminiConfig(env), transport), { random: () => 0.5, sleep: async () => {} }),
  }];
  const lines: AccessEntry[] = [];
  const g = await startGateway({ GATEWAY_ALLOWED_ORIGINS: APP, GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY }, { port: 0, registry, log: e => lines.push(e) });
  try {
    const r = await post(g, ASK);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.model, 'gemini-3.1-flash-lite');
    assert.equal(r.body.requestId, 'r-000042');
    assert.equal(typeof r.body.sceneHash, 'string');
    assert.equal((g.gateway.health().modules.gemini as { enabled: boolean }).enabled, true);
    assert.equal(calls.length, 1, 'exactly one upstream call');
    assert.equal(calls[0]!.init.headers['x-goog-api-key'], KEY);
    assert.ok(!calls[0]!.url.includes(KEY) && !calls[0]!.init.body.includes(KEY));
    assert.ok(!JSON.stringify([r.body, g.gateway.health(), g.gateway.problems, lines]).includes(KEY));
  } finally {
    await g.close();
  }
});

test('#268 review: a double-encoded scene and a padded STOP are refused end to end, never repaired', async () => {
  await withGemini([{ raw: { httpStatus: 200, finishReason: 'STOP', text: JSON.stringify(JSON.stringify(SPHERE)) } }], async g => {
    const r = await post(g, ASK);
    assert.deepEqual([r.status, reasons(r)], [400, ['SCENE_INVALID', 'SCHEMA']]);
    assert.equal(r.body.scene, undefined);
  });
  await withGemini([{ raw: { httpStatus: 200, finishReason: ' STOP ', text: JSON.stringify(SPHERE) } }], async g => {
    const r = await post(g, ASK);
    assert.deepEqual([r.status, reasons(r)], [502, ['PROVIDER_ERROR']]);
    assert.equal(r.body.scene, undefined);
  });
});
