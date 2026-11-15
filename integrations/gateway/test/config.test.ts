import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { envFlag, envInteger, GATEWAY_DEFAULTS, moduleEnv, readGatewayConfig, secret } from '../src/config.ts';

const KEY = 'test-key-not-real-0123456789';

test('an empty environment gives the defaults and no problems', () => {
  const config = readGatewayConfig({});
  assert.equal(config.port, GATEWAY_DEFAULTS.port);
  assert.deepEqual(config.problems, []);
});

test('GATEWAY_PORT is read; a bad value falls back and is reported', () => {
  assert.equal(readGatewayConfig({ GATEWAY_PORT: '9000' }).port, 9000);
  for (const bad of ['99999', '0', '-1', '80.5', 'soon']) {
    const config = readGatewayConfig({ GATEWAY_PORT: bad });
    assert.equal(config.port, GATEWAY_DEFAULTS.port, bad);
    assert.equal(config.problems.length, 1, bad);
    assert.ok(!config.problems[0]?.includes(bad), 'a problem names the variable, never the value');
  }
});

test('the gateway config reads only GATEWAY_* and holds no module secret', () => {
  const config = readGatewayConfig({ GATEWAY_PORT: '9000', GEMINI_API_KEY: KEY, MONGODB_URI: KEY });
  assert.ok(!JSON.stringify(config).includes(KEY));
  assert.deepEqual(Object.keys(config).sort(), ['allowedOrigins', 'bind', 'maxBodyBytes', 'port', 'problems', 'requireToken']);
});

test('moduleEnv passes only the variables with the module prefix', () => {
  const env = { GEMINI_API_KEY: 'g', GEMINI_ENABLED: '1', MONGODB_URI: 'm', TIGER_URL: 't', GOOGLE_API_KEY: 'x', GEMINIX: 'no' };
  assert.deepEqual(moduleEnv(env, 'GEMINI_'), { GEMINI_API_KEY: 'g', GEMINI_ENABLED: '1' });
  assert.deepEqual(moduleEnv(env, 'MONGODB_'), { MONGODB_URI: 'm' });
  assert.ok(Object.isFrozen(moduleEnv(env, 'TIGER_')));
  for (const bad of ['gemini_', 'GEMINI', '', '_X_']) assert.throws(() => moduleEnv(env, bad));
});

test('envFlag accepts only 1 and true, in any case', () => {
  for (const on of ['1', 'true', 'TRUE', ' True ']) assert.equal(envFlag(on), true, on);
  for (const off of [undefined, '', '0', 'false', 'yes', 'on', '2']) assert.equal(envFlag(off), false, String(off));
});

test('envInteger: in range is read, anything else falls back with a problem', () => {
  const problems: string[] = [];
  assert.equal(envInteger({ N: ' 42 ' }, 'N', 7, 1, 100, problems), 42);
  assert.equal(envInteger({}, 'N', 7, 1, 100, problems), 7);
  assert.equal(envInteger({ N: '' }, 'N', 7, 1, 100, problems), 7);
  assert.deepEqual(problems, []);
  for (const bad of ['101', '0', '1.5', '1e3', 'x']) assert.equal(envInteger({ N: bad }, 'N', 7, 1, 100, problems), 7, bad);
  assert.equal(problems.length, 5);
});

test('a Secret never leaks through JSON, String, template literals or inspect', () => {
  const s = secret(KEY);
  for (const text of [JSON.stringify({ s }), String(s), `${s}`, inspect(s), inspect({ nested: { s } }, { depth: 10 })]) {
    assert.ok(!text.includes(KEY), text);
  }
  assert.equal(s.reveal(), KEY);
  assert.ok(Object.isFrozen(s));
});
