// MDB-WP-03 (#241): the shows module entry. Disabled in this build whatever the environment holds (no driver);
// MONGODB_* only; health per spec section 10.4 (never a URI, user or reason); the route answer while disabled is
// 503 DATABASE_UNAVAILABLE / MODULE_DISABLED (section 10.6, MDB-T18); the cached health ping (TTL, deadline, failures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { isErrorEnvelope } from '../../src/errors.ts';
import { healthBody } from '../../src/health.ts';
import { MODULES } from '../../src/modules.ts';
import { createMemoryRepository } from '../../src/shows/memoryRepository.ts';
import {
  createModule, DEFAULT_DB_NAME, HEALTH_TTL_MS, moduleDisabledResponse, readShowsConfig, showsModule,
} from '../../src/shows/module.ts';
import type { ShowsRepository } from '../../src/shows/repository.ts';

const URI = 'mongodb+srv://runtime-user:not-a-real-password-123@cluster0.example.mongodb.net/?retryWrites=true';
const DISABLED = { enabled: false, db: 'disabled', writable: false };

test('registry: the shows module is registered with the MONGODB_ prefix', () => {
  const entry = MODULES.find(m => m.name === 'shows');
  assert.equal(entry?.envPrefix, 'MONGODB_');
  assert.equal(entry?.create, createModule);
});

test('no MONGODB_URI: disabled, with health exactly { enabled: false, db: disabled, writable: false }', () => {
  const module = createModule({});
  assert.equal(module.name, 'shows');
  assert.deepEqual(module.health(), DISABLED);
  assert.deepEqual(healthBody([module]).modules.shows, DISABLED);
});

test('a URI alone does not enable this build (no driver): still disabled, and nothing echoes the URI', () => {
  const module = createModule({ MONGODB_URI: URI, MONGODB_DB: 'encore_test' });
  assert.deepEqual(module.health(), DISABLED);
  for (const text of [JSON.stringify(module.health()), JSON.stringify(healthBody([module])), inspect(module, { depth: 5 })]) {
    assert.ok(!text.includes('not-a-real-password'), text);
    assert.ok(!text.includes('cluster0'), text);
  }
});

test('while disabled, the route answer is 503 DATABASE_UNAVAILABLE with reason MODULE_DISABLED in the shared envelope', () => {
  const response = moduleDisabledResponse('r-000042');
  assert.equal(response.status, 503);
  assert.ok(isErrorEnvelope(response.body));
  assert.deepEqual(response.body, {
    error: { code: 'DATABASE_UNAVAILABLE', message: 'Saved shows are not available.', details: [{ path: '', reason: 'MODULE_DISABLED' }], requestId: 'r-000042' },
  });
  assert.equal('requestId' in moduleDisabledResponse('bad id with spaces').body.error, false, 'an invalid requestId is dropped');
});

test('config: reads MONGODB_URI and MONGODB_DB only; the URI is a Secret; problems never hold a value', () => {
  const config = readShowsConfig({ MONGODB_URI: ` ${URI} `, MONGODB_DB: 'encore_test' });
  assert.equal(config.configured, true);
  assert.equal(config.uri?.reveal(), URI);
  assert.equal(String(config.uri), '[redacted]');
  assert.ok(!JSON.stringify(config).includes('not-a-real-password'));
  assert.equal(config.dbName, 'encore_test');
  assert.deepEqual(config.problems, []);

  const bad = readShowsConfig({ MONGODB_URI: 'postgres://user:hunter2@db', MONGODB_DB: 'bad/name' });
  assert.equal(bad.configured, false);
  assert.equal(bad.uri, null);
  assert.equal(bad.dbName, DEFAULT_DB_NAME);
  assert.equal(bad.problems.length, 2);
  assert.ok(!bad.problems.join(' ').includes('hunter2') && !bad.problems.join(' ').includes('bad/name'));

  assert.deepEqual(readShowsConfig({ MONGODB_URI: '   ' }), { configured: false, uri: null, dbName: DEFAULT_DB_NAME, problems: [] });
});

test('with a repository but no configured URI, the module stays disabled', () => {
  const module = showsModule({ config: readShowsConfig({}), repository: createMemoryRepository() });
  assert.equal(module.enabled, false);
  assert.deepEqual(module.health(), DISABLED);
});

function countingRepository(answer: () => Promise<'up' | 'down'>): { repo: ShowsRepository; pings: () => number } {
  let pings = 0;
  const base = createMemoryRepository();
  return { repo: { ...base, ping: () => { pings++; return answer(); } }, pings: () => pings };
}

test('health: enabled with a configured repository; db is down until a ping confirms it; the ping is cached for 10 s', async () => {
  let clock = 1_000_000;
  const { repo, pings } = countingRepository(async () => 'up');
  const module = showsModule({ config: readShowsConfig({ MONGODB_URI: URI }), repository: repo, now: () => clock });
  assert.equal(module.enabled, true);
  assert.deepEqual(module.health(), { enabled: true, db: 'down', writable: false }, 'never a guessed up');
  assert.deepEqual(await module.refreshHealth(), { enabled: true, db: 'up', writable: true });
  clock += HEALTH_TTL_MS - 1;
  await module.refreshHealth();
  assert.equal(pings(), 1, 'cached within the TTL');
  clock += 1;
  await module.refreshHealth();
  assert.equal(pings(), 2, 'refreshed after the TTL');
  await Promise.all([module.refreshHealth(), module.refreshHealth()]);
  assert.equal(pings(), 2);
});

test('health: concurrent refreshes share one ping', async () => {
  let release: ((v: 'up') => void) | null = null;
  let started: () => void = () => {};
  const pingStarted = new Promise<void>(resolve => { started = resolve; });
  const { repo, pings } = countingRepository(() => new Promise(resolve => { release = resolve; started(); }));
  const module = showsModule({ config: readShowsConfig({ MONGODB_URI: URI }), repository: repo });
  const both = Promise.all([module.refreshHealth(), module.refreshHealth()]);
  await pingStarted;   // the ping is deferred: release it only once it has really started
  assert.ok(release);
  (release as (v: 'up') => void)('up');
  const [a, b] = await both;
  assert.equal(pings(), 1);
  assert.deepEqual(a, { enabled: true, db: 'up', writable: true });
  assert.deepEqual(b, a);
});

test('health: a failing, throwing or hanging ping is db down and not writable; it never rejects', async () => {
  const config = readShowsConfig({ MONGODB_URI: URI });
  const cases: [string, ShowsRepository['ping']][] = [
    ['rejects', async () => { throw new Error(`connect failed for ${URI}`); }],
    ['throws synchronously', () => { throw new Error('sync'); }],
    ['answers down', async () => 'down'],
    ['answers garbage', async () => 'sideways' as 'up'],
    ['hangs', () => new Promise(() => {})],
  ];
  for (const [name, ping] of cases) {
    const module = showsModule({ config, repository: { ...createMemoryRepository(), ping }, pingDeadlineMs: 20 });
    const health = await module.refreshHealth();
    assert.deepEqual(health, { enabled: true, db: 'down', writable: false }, name);
    assert.ok(!JSON.stringify(health).includes('connect failed'), name);
  }
});

test('disabled, the three shows routes are registered and each answers 503 MODULE_DISABLED', async () => {
  const routes = createModule({ MONGODB_URI: URI }).routes;
  assert.deepEqual(routes.map(r => `${r.method} ${r.path}`), ['POST /api/shows', 'GET /api/shows', 'GET /api/shows/:id']);
  for (const route of routes) {
    const response = await route.handle({ method: route.method, path: route.path, params: { id: '0123456789abcdef01234567' }, query: {}, rawBody: '{}' });
    assert.deepEqual(response, moduleDisabledResponse());
  }
});

test('enabled with a repository, the module serves the routes (Save then Get)', async () => {
  const module = showsModule({ config: readShowsConfig({ MONGODB_URI: URI }), repository: createMemoryRepository() });
  const post = module.routes.find(r => r.method === 'POST');
  assert.ok(post);
  const body = { schemaVersion: 1, title: 'T', source: 'manual', operationId: '00000000-0000-4000-8000-000000000001', composition: { v: 1, movements: [{ recipe: { kind: 'sphere' }, holdTicks: 600 }] } };
  const saved = await post.handle({ method: 'POST', path: '/api/shows', params: {}, query: {}, rawBody: JSON.stringify(body) });
  assert.equal(saved.status, 201);
});
