// The server on a real loopback socket (port 0). Every request goes to 127.0.0.1 only; nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startGateway, startupLines, type RunningGateway } from '../src/server.ts';
import type { ModuleEntry } from '../src/modules.ts';
import { FatalConfigError } from '../src/errors.ts';
import { readGeminiConfig } from '../src/gemini/config.ts';
import type { Transport, TransportInit } from '../src/gemini/geminiProvider.ts';
import { geminiModule, liveGeminiDeps } from '../src/gemini/module.ts';

const APP = 'http://localhost:5173';
const FAKE_KEY = 'test-key-not-real-0123456789';

/** D3 (#218): a gemini registry entry that is LIVE through liveGeminiDeps but whose transport is a recording fake, so
 *  no test ever reaches the network (the suite's tripwire, test/no-network.mjs, would refuse it anyway). */
function fakeGeminiRegistry(status = 400) {
  const calls: { url: string; init: TransportInit }[] = [];
  const transport: Transport = async (url, init) => { calls.push({ url, init }); return { status, body: null }; };
  const registry: ModuleEntry[] = [{
    name: 'gemini', envPrefix: 'GEMINI_',
    create: env => geminiModule(liveGeminiDeps(readGeminiConfig(env), transport), { random: () => 0.5, sleep: async () => {} }),
  }];
  return { calls, registry };
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: unknown }

function send(g: RunningGateway, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((ok, fail) => {
    const req = request({
      host: '127.0.0.1', port: g.port, method: options.method ?? 'GET', path: options.path ?? '/api/health',
      headers: { host: `127.0.0.1:${g.port}`, ...options.headers },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        ok({ status: res.statusCode ?? 0, headers: res.headers, body: text === '' ? null : JSON.parse(text) });
      });
    });
    req.on('error', fail);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const json = (origin = APP) => ({ 'content-type': 'application/json', origin });
const reasonOf = (r: Reply) => (r.body as { error: { code: string; details?: { reason: string }[] } }).error;

async function withGateway(env: Record<string, string>, run: (g: RunningGateway) => Promise<void>, registry?: readonly ModuleEntry[]) {
  const g = await startGateway({ GATEWAY_ALLOWED_ORIGINS: APP, ...env }, { port: 0, ...(registry ? { registry } : {}) });
  try {
    await run(g);
  } finally {
    await g.close();
  }
}

test('binds 127.0.0.1 only and serves /api/health with every module disabled offline', async () => {
  await withGateway({}, async g => {
    const address = g.server.address();
    assert.ok(typeof address === 'object' && address !== null && address.address === '127.0.0.1');
    const r = await send(g, {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      service: 'encore-gateway', version: '0.0.0',
      modules: { gemini: { enabled: false, trialCompile: false }, shows: { db: 'disabled', writable: false, enabled: false }, tiger: { db: 'disabled', enabled: false } },
    });
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'no CORS headers');
  });
});

test('refuses to start on any other bind address', async () => {
  for (const bind of ['0.0.0.0', '192.168.1.2', '::', 'localhost']) {
    let started: RunningGateway | null = null;
    try {
      started = await startGateway({ GATEWAY_BIND: bind }, { port: 0 });
    } catch (error) {
      assert.match(String(error), /127\.0\.0\.1 only/, bind);
      continue;
    }
    await started.close();
    assert.fail(`the gateway started although GATEWAY_BIND=${bind}`);
  }
});

test('D3: with the flag and a key, gemini is live through the whole stack (fake transport: exactly one call; key only in its header)', async () => {
  const fake = fakeGeminiRegistry(400);
  await withGateway({ GEMINI_ENABLED: '1', GEMINI_API_KEY: FAKE_KEY }, async g => {
    const r = await send(g, { method: 'POST', path: '/api/generate-formation', headers: json(), body: JSON.stringify({ prompt: 'an elephant', mode: 'scene3d', requestId: 'r-1' }) });
    const error = reasonOf(r) as { code: string; details?: { reason: string }[]; requestId?: string };
    // Live: the provider was called (an upstream 400 is PROVIDER_ERROR, never retried), not MODULE_DISABLED.
    assert.deepEqual([r.status, error.code, error.details?.map(d => d.reason), error.requestId], [502, 'PROVIDER_ERROR', ['PROVIDER_ERROR'], 'r-1']);
    assert.equal(fake.calls.length, 1);
    const { url, init } = fake.calls[0]!;
    assert.equal(init.headers['x-goog-api-key'], FAKE_KEY, 'the key travels in its header only');
    assert.ok(!url.includes(FAKE_KEY), 'not in the URL');
    assert.ok(!init.body.includes(FAKE_KEY), 'not in the request body');
    assert.ok(!JSON.stringify(r.body).includes(FAKE_KEY), 'not in the response');
  }, fake.registry);
});

test('the guard runs before any module: foreign Host, missing Origin, text/plain', async () => {
  await withGateway({}, async g => {
    const body = JSON.stringify({ prompt: 'x', mode: 'scene3d' });
    assert.equal(reasonOf(await send(g, { headers: { host: 'evil.example' } })).details?.[0]?.reason, 'HOST_NOT_ALLOWED');
    assert.equal(reasonOf(await send(g, { method: 'POST', path: '/api/generate-formation', headers: { 'content-type': 'application/json' }, body })).details?.[0]?.reason, 'ORIGIN_MISSING');
    const plain = await send(g, { method: 'POST', path: '/api/generate-formation', headers: { 'content-type': 'text/plain', origin: APP }, body });
    assert.deepEqual([plain.status, reasonOf(plain).details?.[0]?.reason], [415, 'NOT_JSON']);
  });
});

test('an empty allow-list refuses every non-GET', async () => {
  await withGateway({ GATEWAY_ALLOWED_ORIGINS: '' }, async g => {
    const r = await send(g, { method: 'POST', path: '/api/generate-formation', headers: json(), body: '{}' });
    assert.deepEqual([r.status, reasonOf(r).details?.[0]?.reason], [403, 'ORIGIN_NOT_ALLOWED']);
    assert.equal((await send(g, {})).status, 200);
  });
});

test('body: over the cap is 413 while streaming (chunked, no Content-Length); invalid UTF-8 is 400', async () => {
  await withGateway({ GATEWAY_MAX_BODY_BYTES: '2048' }, async g => {
    const big = await send(g, { method: 'POST', path: '/api/generate-formation', headers: { ...json(), 'transfer-encoding': 'chunked' }, body: 'x'.repeat(5000) });
    assert.deepEqual([big.status, reasonOf(big).details?.[0]?.reason], [413, 'REQUEST_TOO_LARGE']);
    const declared = await send(g, { method: 'POST', path: '/api/generate-formation', headers: { ...json(), 'content-length': '4096' }, body: 'x'.repeat(4096) });
    assert.equal(declared.status, 413);
    const bad = await send(g, { method: 'POST', path: '/api/generate-formation', headers: json(), body: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) });
    assert.deepEqual([bad.status, reasonOf(bad).details?.[0]?.reason], [400, 'INVALID_JSON']);
  });
});

test('per-launch token: made at start, printed once, required everywhere but GET /api/health', async () => {
  await withGateway({ GATEWAY_REQUIRE_TOKEN: '1' }, async g => {
    assert.ok(g.token !== null && g.token.length >= 32);
    assert.equal(startupLines(g).filter(line => line.includes(g.token ?? '\u0000')).length, 1);
    assert.equal((await send(g, {})).status, 200);
    const body = JSON.stringify({ prompt: 'x', mode: 'scene3d' });
    const without = await send(g, { method: 'POST', path: '/api/generate-formation', headers: json(), body });
    assert.deepEqual([without.status, reasonOf(without).details?.[0]?.reason], [401, 'TOKEN_MISSING']);
    const withToken = await send(g, { method: 'POST', path: '/api/generate-formation', headers: { ...json(), authorization: `Bearer ${g.token}` }, body });
    assert.equal(withToken.status, 503);
  });
  await withGateway({}, async g => assert.equal(g.token, null));
});

test('unknown routes are 404 NOT_FOUND; a module that throws is 500 for that request only', async () => {
  const registry: ModuleEntry[] = [{
    name: 'boom', envPrefix: 'BOOM_',
    create: () => ({
      name: 'boom',
      routes: [{ method: 'GET', path: '/api/boom', handle: async () => { throw new Error('secret detail'); } }],
      health: () => ({ enabled: true }),
    }),
  }];
  await withGateway({}, async g => {
    const missing = await send(g, { path: '/api/nope' });
    assert.deepEqual([missing.status, reasonOf(missing).code], [404, 'NOT_FOUND']);
    const boom = await send(g, { path: '/api/boom' });
    assert.deepEqual([boom.status, reasonOf(boom).code], [500, 'INTERNAL']);
    assert.ok(!JSON.stringify(boom.body).includes('secret detail'));
    assert.equal((await send(g, {})).status, 200);
  }, registry);
});

test('startup lines name each module and warn about an empty allow-list, without any module secret', async () => {
  const fake = fakeGeminiRegistry();
  await withGateway({ GATEWAY_ALLOWED_ORIGINS: '', GEMINI_ENABLED: '1', GEMINI_API_KEY: FAKE_KEY }, async g => {
    const lines = startupLines(g).join('\n');
    assert.match(lines, /listening on http:\/\/127\.0\.0\.1:\d+/);
    assert.match(lines, /module gemini: enabled/, 'D3: the flag and a key make it live');
    assert.match(lines, /GATEWAY_ALLOWED_ORIGINS is empty/);
    assert.ok(!lines.includes(FAKE_KEY));
    assert.equal(fake.calls.length, 0, 'starting makes no upstream call');
  }, fake.registry);
});

test('(1) over HTTP: "//" targets are 400 BAD_TARGET and never reach /api/health', async () => {
  await withGateway({}, async g => {
    for (const path of ['//api/health', '//evil.example/api/health']) {
      const r = await send(g, { path });
      assert.deepEqual([r.status, reasonOf(r).details?.[0]?.reason], [400, 'BAD_TARGET'], path);
    }
  });
});

test('(4) over HTTP: /api/health survives a module whose health() throws or cannot be serialised', async () => {
  const registry: ModuleEntry[] = [
    { name: 'thrower', envPrefix: 'THROWER_', create: () => ({ name: 'thrower', routes: [], health: () => { throw new Error('x'); } }) },
    { name: 'bigint', envPrefix: 'BIGINT_', create: () => ({ name: 'bigint', routes: [], health: () => ({ enabled: true, n: 1n }) as never }) },
  ];
  await withGateway({}, async g => {
    const r = await send(g, {});
    assert.equal(r.status, 200);
    assert.deepEqual((r.body as { modules: unknown }).modules, { thrower: { enabled: false }, bigint: { enabled: false } });
  }, registry);
});

test('(6) ignored GEMINI_* values are logged at start-up, by name and never by value', async () => {
  await withGateway({ GEMINI_ENABLED: '1', GEMINI_API_KEY: 'test-key-not-real-0123456789', GEMINI_MODEL: 'Bad Model!', GEMINI_PROVIDER_TIMEOUT_MS: 'soon' }, async g => {
    const lines = startupLines(g).join('\n');
    assert.match(lines, /note: module gemini: GEMINI_MODEL is not a model id/);
    assert.match(lines, /note: module gemini: GEMINI_PROVIDER_TIMEOUT_MS must be an integer/);
    assert.ok(!lines.includes('Bad Model!') && !lines.includes('soon') && !lines.includes('test-key-not-real'));
  });
});

test('a module throwing FatalConfigError makes startGateway refuse to start; nothing listens', async () => {
  const registry: ModuleEntry[] = [{ name: 'tiger', envPrefix: 'TIGER_', create: () => { throw new FatalConfigError('TIGER_ADMIN_URL must not be set'); } }];
  let started: RunningGateway | null = null;
  try {
    started = await startGateway({}, { port: 0, registry });
  } catch (error) {
    assert.ok(error instanceof FatalConfigError && /TIGER_ADMIN_URL/.test(error.message));
  }
  if (started !== null) {
    await started.close(); // never leave a listener behind, even when the assertion fails
    assert.fail('the gateway started although a module threw FatalConfigError');
  }
  const plain: ModuleEntry[] = [{ name: 'tiger', envPrefix: 'TIGER_', create: () => { throw new Error('x'); } }];
  await withGateway({}, async g => assert.equal((await send(g, {})).status, 200), plain);
});
