// The tripwire (test/no-network.mjs, loaded by `npm test` with --import) is really in force in the test processes:
// a real outbound fetch, http.request or https.request throws, loopback still works, and the live gemini module,
// enabled with the flag and a (fake) key, cannot reach the network either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { startGateway } from '../src/server.ts';
import { createModule } from '../src/gemini/module.ts';

const KEY = 'test-key-not-real-0123456789';

test('a real fetch to the internet throws inside the suite', async () => {
  await assert.rejects(fetch('https://generativelanguage.googleapis.com/v1beta/models'), { name: 'NetworkDisabledInTests' });
  await assert.rejects(fetch(new URL('http://example.com/')), { name: 'NetworkDisabledInTests' });
});

test('http.request and https.request / https.get to any outside host throw; https refuses even loopback', () => {
  assert.throws(() => httpRequest({ host: 'example.com', path: '/' }), { name: 'NetworkDisabledInTests' });
  assert.throws(() => httpRequest('http://93.184.216.34/'), { name: 'NetworkDisabledInTests' });
  assert.throws(() => httpsRequest('https://generativelanguage.googleapis.com/'), { name: 'NetworkDisabledInTests' });
  assert.throws(() => httpsGet({ hostname: '127.0.0.1', port: 1 }), { name: 'NetworkDisabledInTests' });
});

test('loopback still works: the gateway under test answers on 127.0.0.1', async () => {
  const g = await startGateway({ GATEWAY_ALLOWED_ORIGINS: 'http://localhost:5173' }, { port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${g.port}/api/health`, { headers: { host: `127.0.0.1:${g.port}` } });
    assert.equal(r.status, 200);
  } finally {
    await g.close();
  }
});

test('the live gemini module (flag + key) cannot reach the network in tests: its platform transport is the tripwire', async () => {
  const module = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.equal(module.health().enabled, true);
  const route = module.routes[0]!;
  const reply = await route.handle({ rawBody: JSON.stringify({ prompt: 'a white sphere', mode: 'scene3d' }) } as Parameters<typeof route.handle>[0]);
  const text = JSON.stringify(reply);
  assert.ok(text.includes('PROVIDER_ERROR'), text.slice(0, 300));   // the refused transport is an upstream failure, never a call
  assert.ok(!text.includes(KEY));
});
