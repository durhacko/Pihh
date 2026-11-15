import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GATEWAY_SERVICE, GATEWAY_VERSION, healthBody } from '../src/health.ts';
import { disabledModule, type GatewayModule } from '../src/module.ts';

const KEY = 'test-key-not-real-0123456789';
const mod = (name: string, health: () => Record<string, unknown>): GatewayModule => ({ name, routes: [], health: health as GatewayModule['health'] });

test('health: the envelope is the skeleton\'s; each module adds its own entry', () => {
  const body = healthBody([disabledModule('gemini'), disabledModule('shows', { db: 'disabled', writable: false })]);
  assert.deepEqual(body, {
    service: GATEWAY_SERVICE,
    version: GATEWAY_VERSION,
    modules: { gemini: { enabled: false }, shows: { db: 'disabled', writable: false, enabled: false } },
  });
});

test('health: enabled is a strict boolean; anything but true reads as false', () => {
  const body = healthBody([mod('a', () => ({ enabled: true })), mod('b', () => ({ enabled: 'yes' })), mod('c', () => ({}))]);
  assert.deepEqual([body.modules.a?.enabled, body.modules.b?.enabled, body.modules.c?.enabled], [true, false, false]);
});

test('health: a module whose health() throws reads as disabled, and the others are unaffected', () => {
  const body = healthBody([mod('bad', () => { throw new Error(KEY); }), mod('good', () => ({ enabled: true }))]);
  assert.deepEqual(body.modules, { bad: { enabled: false }, good: { enabled: true } });
  assert.ok(!JSON.stringify(body).includes(KEY));
});

test('health: GATEWAY_VERSION equals package.json version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(GATEWAY_VERSION, pkg.version);
});

test('(4) health(): unserialisable or non-object results read as disabled; /api/health always answers', () => {
  const cyclic: Record<string, unknown> = { enabled: true }; cyclic.self = cyclic;
  const results: [string, () => unknown][] = [
    ['bigint', () => ({ enabled: true, n: 10n })],
    ['cycle', () => cyclic],
    ['throwing toJSON', () => ({ enabled: true, toJSON() { throw new Error(KEY); } })],
    ['throwing getter', () => Object.defineProperty({ enabled: true }, 'x', { get() { throw new Error(KEY); }, enumerable: true })],
    ['array', () => [true]],
    ['string', () => 'enabled'],
    ['undefined', () => undefined],
    ['huge', () => ({ enabled: true, blob: 'x'.repeat(10_000) })],
    ['promise', () => Promise.resolve({ enabled: true })],
  ];
  for (const [label, health] of results) {
    const body = healthBody([mod('bad', health as () => Record<string, unknown>), mod('good', () => ({ enabled: true, db: 'up' }))]);
    assert.deepEqual(body.modules.bad, { enabled: false }, label);
    assert.deepEqual(body.modules.good, { enabled: true, db: 'up' }, label);
    assert.doesNotThrow(() => JSON.stringify(body), label);
    assert.ok(!JSON.stringify(body).includes(KEY), label);
  }
});

test('(4) a health entry is plain data: functions and undefined fields are dropped', () => {
  const body = healthBody([mod('m', () => ({ enabled: true, f: () => 1, u: undefined, nested: { ok: 1 } }))]);
  assert.deepEqual(body.modules.m, { enabled: true, nested: { ok: 1 } });
});
