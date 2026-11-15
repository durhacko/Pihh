// Registry and router (no socket): how modules plug in, and that one bad module never disables another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, type ModuleEntry } from '../src/modules.ts';
import { buildGateway, HEALTH_PATH } from '../src/router.ts';
import type { GatewayModule, ModuleRoute, RouteRequest } from '../src/module.ts';

const ok = (body: unknown = { ok: 1 }) => async () => ({ status: 200, body });

function entry(name: string, envPrefix: string, routes: ModuleRoute[], extra: Partial<GatewayModule> = {}): ModuleEntry {
  return { name, envPrefix, create: () => ({ name, routes, health: () => ({ enabled: true }), ...extra }) };
}

test('the registry lists gemini, shows and tiger with their own env prefixes', () => {
  assert.deepEqual(MODULES.map(m => [m.name, m.envPrefix]), [['gemini', 'GEMINI_'], ['shows', 'MONGODB_'], ['tiger', 'TIGER_']]);
  assert.ok(Object.isFrozen(MODULES));
});

test('each factory receives only its own prefix', () => {
  const seen: Record<string, string[]> = {};
  const spy = (name: string, prefix: string): ModuleEntry => ({
    name, envPrefix: prefix,
    create: env => { seen[name] = Object.keys(env).sort(); return { name, routes: [], health: () => ({ enabled: false }) }; },
  });
  buildGateway({ A_KEY: 'a', A_URL: 'u', B_KEY: 'b', GATEWAY_PORT: '9000', OTHER: 'x' }, [spy('a', 'A_'), spy('b', 'B_')]);
  assert.deepEqual(seen, { a: ['A_KEY', 'A_URL'], b: ['B_KEY'] });
});

test('routing: exact segments, :params decoded, query parsed, method matched, raw body passed through', async () => {
  let got: RouteRequest | null = null;
  const g = buildGateway({}, [entry('runs', 'RUNS_', [
    { method: 'GET', path: '/api/runs/:id/metrics', handle: async req => { got = req; return { status: 200, body: { id: req.params.id } }; } },
    { method: 'POST', path: '/api/runs', handle: async req => ({ status: 201, body: { raw: req.rawBody } }) },
  ])]);
  assert.deepEqual(await g.handle({ method: 'get', url: '/api/runs/a%20b/metrics?limit=5&limit=6', rawBody: '' }), { status: 200, body: { id: 'a b' } });
  assert.deepEqual(got, { method: 'GET', path: '/api/runs/a%20b/metrics', params: { id: 'a b' }, query: { limit: '6' }, rawBody: '' });
  assert.deepEqual(await g.handle({ method: 'POST', url: '/api/runs', rawBody: '{"x":1}' }), { status: 201, body: { raw: '{"x":1}' } });
  for (const [method, url] of [['POST', '/api/runs/1/metrics'], ['GET', '/api/runs'], ['GET', '/api/runs//metrics'], ['GET', '/api/runs/%E0%A4%A/metrics'], ['GET', 'api/runs'], ['TRACE', '/api/runs']] as const) {
    const r = await g.handle({ method, url, rawBody: '' });
    assert.equal(r.status, 404, `${method} ${url}`);
  }
});

test('/api/health is the skeleton\'s: GET only, and no module may claim it', async () => {
  const g = buildGateway({}, [entry('sneaky', 'SNEAKY_', [{ method: 'GET', path: HEALTH_PATH, handle: ok() }])]);
  assert.deepEqual(g.modules.map(m => [m.name, m.health().enabled]), [['sneaky', false]]);
  assert.match(g.problems.join('\n'), /reserved/);
  assert.equal((await g.handle({ method: 'GET', url: HEALTH_PATH, rawBody: '' })).status, 200);
  assert.equal((await g.handle({ method: 'POST', url: HEALTH_PATH, rawBody: '' })).status, 404);
});

test('one bad module is disabled alone: a throwing factory, a bad path, a wrong name, a collision', async () => {
  const good = entry('good', 'GOOD_', [{ method: 'GET', path: '/api/good', handle: ok() }]);
  const cases: ModuleEntry[] = [
    { name: 'throws', envPrefix: 'THROWS_', create: () => { throw new Error('THROWS_KEY=secret'); } },
    entry('badpath', 'BADPATH_', [{ method: 'GET', path: '/other/x', handle: ok() }]),
    entry('badseg', 'BADSEG_', [{ method: 'GET', path: '/api/Upper', handle: ok() }]),
    entry('badmethod', 'BADMETHOD_', [{ method: 'TRACE' as never, path: '/api/m', handle: ok() }]),
    { name: 'misnamed', envPrefix: 'MISNAMED_', create: () => ({ name: 'other', routes: [], health: () => ({ enabled: true }) }) },
    entry('collides', 'COLLIDES_', [{ method: 'GET', path: '/api/:anything', handle: ok() }, { method: 'GET', path: '/api/good', handle: ok() }]),
  ];
  for (const bad of cases) {
    const g = buildGateway({}, [good, bad]);
    const health = g.health().modules;
    assert.deepEqual(health[bad.name], { enabled: false }, bad.name);
    assert.deepEqual(health.good, { enabled: true }, bad.name);
    assert.equal((await g.handle({ method: 'GET', url: '/api/good', rawBody: '' })).status, 200, bad.name);
    assert.equal(g.problems.length, 1, bad.name);
    assert.ok(!g.problems.join().includes('secret'), bad.name);
  }
});

test('a module registered after a good one may not shadow its routes, even with a different param name', () => {
  const g = buildGateway({}, [
    entry('first', 'FIRST_', [{ method: 'GET', path: '/api/shows/:id', handle: ok() }]),
    entry('second', 'SECOND_', [{ method: 'GET', path: '/api/shows/:showId', handle: ok() }]),
  ]);
  assert.deepEqual(g.modules.map(m => [m.name, m.health().enabled]), [['first', true], ['second', false]]);
});

test('the registry itself is checked: duplicate names and overlapping prefixes throw at build', () => {
  const a = entry('a', 'A_', []);
  assert.throws(() => buildGateway({}, [a, entry('a', 'B_', [])]), /duplicate/);
  assert.throws(() => buildGateway({}, [entry('a', 'MONGO_', []), entry('b', 'MONGO_DB_', [])]), /overlaps/);
  assert.throws(() => buildGateway({}, [entry('Bad Name', 'C_', [])]), /bad or duplicate/);
});

test('a handler that throws answers 500 INTERNAL for that request only, without its message', async () => {
  const g = buildGateway({}, [entry('flaky', 'FLAKY_', [
    { method: 'GET', path: '/api/flaky', handle: async () => { throw new Error('db password is hunter2'); } },
    { method: 'GET', path: '/api/fine', handle: ok() },
  ])]);
  const r = await g.handle({ method: 'GET', url: '/api/flaky', rawBody: '' });
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.body).includes('hunter2'));
  assert.equal((await g.handle({ method: 'GET', url: '/api/fine', rawBody: '' })).status, 200);
});

test('the default build: three modules, all disabled, gemini routes registered', async () => {
  const g = buildGateway({});
  assert.deepEqual(g.problems, []);
  assert.deepEqual(Object.fromEntries(Object.entries(g.health().modules).map(([k, v]) => [k, v.enabled])), { gemini: false, shows: false, tiger: false });
  assert.equal((await g.handle({ method: 'POST', url: '/api/generate-formation', rawBody: '{}' })).status, 400);
});
