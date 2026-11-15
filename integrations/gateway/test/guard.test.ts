import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardRequest, hostAllowed, isJsonContentType, isLoopbackAddress, type GuardSettings, type RequestFacts } from '../src/guard.ts';

const SETTINGS: GuardSettings = { port: 8787, allowedOrigins: ['http://localhost:5173'], maxBodyBytes: 65_536, token: null };
const POST: RequestFacts = {
  method: 'POST', url: '/api/generate-formation', remoteAddress: '127.0.0.1', host: '127.0.0.1:8787',
  origin: 'http://localhost:5173', contentType: 'application/json', contentLength: '20', transferEncoding: undefined, authorization: undefined,
};
const GET: RequestFacts = { ...POST, method: 'GET', url: '/api/health', origin: undefined, contentType: undefined, contentLength: undefined };

function verdict(facts: Partial<RequestFacts>, settings: Partial<GuardSettings> = {}, base: RequestFacts = POST) {
  const r = guardRequest({ ...base, ...facts }, { ...SETTINGS, ...settings });
  return r === null ? null : [r.status, r.body.error.code, r.body.error.details?.[0]?.reason];
}

test('a well-formed local request passes; a GET needs no Origin or body type', () => {
  assert.equal(verdict({}), null);
  assert.equal(verdict({}, {}, GET), null);
});

test('peer: only loopback is accepted', () => {
  for (const ok of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) assert.ok(isLoopbackAddress(ok), ok);
  for (const bad of [undefined, '', '10.0.0.5', '192.168.1.2', '::ffff:10.0.0.1', '0.0.0.0', '128.0.0.1', '127.0.0.256', 'localhost', 'fe80::1']) {
    assert.ok(!isLoopbackAddress(bad), String(bad));
  }
  assert.deepEqual(verdict({ remoteAddress: '192.168.1.2' }), [403, 'FORBIDDEN', 'NON_LOOPBACK_PEER']);
});

test('Host: exactly 127.0.0.1:<port> or localhost:<port>, so DNS rebinding fails', () => {
  assert.ok(hostAllowed('127.0.0.1:8787', 8787) && hostAllowed('LOCALHOST:8787', 8787));
  for (const bad of [undefined, '', '127.0.0.1', 'localhost', '127.0.0.1:8788', 'evil.example:8787', 'localhost.evil.example:8787', '[::1]:8787']) {
    assert.ok(!hostAllowed(bad, 8787), String(bad));
  }
  assert.deepEqual(verdict({ host: 'attacker.example:8787' }), [403, 'FORBIDDEN', 'HOST_NOT_ALLOWED']);
  assert.deepEqual(verdict({ host: 'attacker.example:8787' }, {}, GET), [403, 'FORBIDDEN', 'HOST_NOT_ALLOWED']);
});

test('Origin: exact match on every non-GET; missing or "null" is 403', () => {
  assert.deepEqual(verdict({ origin: undefined }), [403, 'FORBIDDEN', 'ORIGIN_MISSING']);
  assert.deepEqual(verdict({ origin: 'null' }), [403, 'FORBIDDEN', 'ORIGIN_MISSING']);
  for (const bad of ['http://localhost:5174', 'http://localhost:5173/', 'https://localhost:5173', 'http://evil.example']) {
    assert.deepEqual(verdict({ origin: bad }), [403, 'FORBIDDEN', 'ORIGIN_NOT_ALLOWED'], bad);
  }
  assert.deepEqual(verdict({}, { allowedOrigins: [] }), [403, 'FORBIDDEN', 'ORIGIN_NOT_ALLOWED']);
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.deepEqual(verdict({ method, origin: undefined }), [403, 'FORBIDDEN', 'ORIGIN_MISSING'], method);
});

test('Content-Type: a body must be application/json, so a cross-site "simple" POST is refused', () => {
  for (const ok of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8']) assert.ok(isJsonContentType(ok), ok);
  for (const bad of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json; charset=latin1', 'application/jsonp']) {
    assert.ok(!isJsonContentType(bad), String(bad));
  }
  assert.deepEqual(verdict({ contentType: 'text/plain' }), [415, 'UNSUPPORTED_MEDIA_TYPE', 'NOT_JSON']);
  assert.deepEqual(verdict({ contentType: undefined }), [415, 'UNSUPPORTED_MEDIA_TYPE', 'NOT_JSON']);
  // A GET or DELETE that carries a body is held to the same rule.
  assert.deepEqual(verdict({ contentLength: '5', contentType: 'text/plain' }, {}, GET), [415, 'UNSUPPORTED_MEDIA_TYPE', 'NOT_JSON']);
  assert.deepEqual(verdict({ method: 'DELETE', transferEncoding: 'chunked', contentType: undefined }), [415, 'UNSUPPORTED_MEDIA_TYPE', 'NOT_JSON']);
});

test('a declared body over the cap is 413 before it is read; a bad Content-Length is 400', () => {
  assert.deepEqual(verdict({ contentLength: '65537' }), [413, 'PAYLOAD_TOO_LARGE', 'REQUEST_TOO_LARGE']);
  assert.equal(verdict({ contentLength: '65536' }), null);
  assert.deepEqual(verdict({ contentLength: 'abc' }), [400, 'VALIDATION_FAILED', 'BAD_CONTENT_LENGTH']);
});

test('token: when required, every route but GET /api/health needs the exact bearer token', () => {
  const token = 'per-launch-token-0123456789';
  assert.deepEqual(verdict({}, { token }), [401, 'UNAUTHORIZED', 'TOKEN_MISSING']);
  for (const bad of [`Bearer ${token}x`, `Bearer ${token.slice(1)}`, token, `Basic ${token}`, 'Bearer ']) {
    assert.deepEqual(verdict({ authorization: bad }, { token }), [401, 'UNAUTHORIZED', 'TOKEN_MISSING'], bad);
  }
  assert.equal(verdict({ authorization: `Bearer ${token}` }, { token }), null);
  assert.equal(verdict({}, { token }, GET), null);
  assert.deepEqual(verdict({ url: '/api/runs' }, { token }, GET), [401, 'UNAUTHORIZED', 'TOKEN_MISSING']);
  assert.deepEqual(verdict({ url: '/api/health/x' }, { token }, GET), [401, 'UNAUTHORIZED', 'TOKEN_MISSING']);
});

test('order: the peer and Host are checked before the token, and the token before Origin', () => {
  const token = 'per-launch-token-0123456789';
  assert.deepEqual(verdict({ remoteAddress: '10.0.0.1', host: 'x:1', origin: undefined }, { token }), [403, 'FORBIDDEN', 'NON_LOOPBACK_PEER']);
  assert.deepEqual(verdict({ host: 'x:1', origin: undefined }, { token }), [403, 'FORBIDDEN', 'HOST_NOT_ALLOWED']);
  assert.deepEqual(verdict({ origin: undefined }, { token }), [401, 'UNAUTHORIZED', 'TOKEN_MISSING']);
});

test('a guard rejection never echoes request values', () => {
  const r = guardRequest({ ...POST, host: 'secret-host.example:8787' }, SETTINGS);
  assert.ok(r && !JSON.stringify(r.body).includes('secret-host'));
});

test('(2) HEAD is not exempt from the Origin check: every non-GET needs an exact Origin', () => {
  assert.deepEqual(verdict({ method: 'HEAD', origin: undefined }, {}, GET), [403, 'FORBIDDEN', 'ORIGIN_MISSING']);
  assert.deepEqual(verdict({ method: 'HEAD', origin: 'http://evil.example' }, {}, GET), [403, 'FORBIDDEN', 'ORIGIN_NOT_ALLOWED']);
  assert.equal(verdict({ method: 'HEAD', origin: 'http://localhost:5173' }, {}, GET), null);
  assert.equal(verdict({ method: 'GET', origin: undefined }, {}, GET), null);
});
