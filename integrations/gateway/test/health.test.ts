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
