import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerateRequest } from '../../src/gemini/request.ts';

function reject(raw: string): { status: number; code: string; path?: string; reason?: string; requestId?: string } {
  const parsed = parseGenerateRequest(raw);
  assert.equal(parsed.ok, false, `expected a rejection for ${raw.slice(0, 80)}`);
  if (parsed.ok) throw new Error('unreachable');
  const { code, details, requestId } = parsed.body.error;
  return { status: parsed.status, code, path: details?.[0]?.path, reason: details?.[0]?.reason, requestId };
}

test('a valid request is accepted, trimmed, with its requestId', () => {
  const parsed = parseGenerateRequest(JSON.stringify({ prompt: '  a grey elephant  ', mode: 'scene3d', requestId: 'r-000042' }));
  assert.deepEqual(parsed, { ok: true, request: { prompt: 'a grey elephant', mode: 'scene3d', requestId: 'r-000042' } });
});

test('requestId is optional; a bad one is dropped, not an error', () => {
  for (const requestId of [undefined, 'bad id', 7, null, 'x'.repeat(65)]) {
    const parsed = parseGenerateRequest(JSON.stringify({ prompt: 'p', mode: 'silhouette2d', requestId }));
    assert.ok(parsed.ok);
    if (parsed.ok) assert.ok(!('requestId' in parsed.request));
  }
});

test('unknown fields are refused (additionalProperties: false), including prototype keys', () => {
  assert.deepEqual(reject(JSON.stringify({ prompt: 'p', mode: 'scene3d', n0: 200, requestId: 'r-1' })),
    { status: 400, code: 'VALIDATION_FAILED', path: '/n0', reason: 'BAD_REQUEST', requestId: 'r-1' });
  assert.equal(reject('{"prompt":"p","mode":"scene3d","__proto__":{"x":1}}').path, '/__proto__');
  assert.equal(reject(JSON.stringify({ prompt: 'p', mode: 'scene3d', 'a/b': 1 })).path, '/a~1b');
});

test('bodies that are not a JSON object are 400 BAD_REQUEST', () => {
  for (const raw of ['', 'not json', '[]', 'null', '"text"', '42', '{"prompt":"p",']) {
    assert.deepEqual(reject(raw), { status: 400, code: 'VALIDATION_FAILED', path: '', reason: 'BAD_REQUEST', requestId: undefined });
  }
});

test('a body over 8 KiB is 413 REQUEST_TOO_LARGE, counted in UTF-8 bytes', () => {
  const big = JSON.stringify({ prompt: 'é'.repeat(4100), mode: 'scene3d' });
  assert.ok(big.length < 8192);
  assert.deepEqual(reject(big), { status: 413, code: 'PAYLOAD_TOO_LARGE', path: '', reason: 'REQUEST_TOO_LARGE', requestId: undefined });
});

test('mode must be silhouette2d or scene3d', () => {
  for (const mode of [undefined, 'scene2d', 'SCENE3D', 3]) {
    const r = reject(JSON.stringify({ prompt: 'p', mode }));
    assert.equal(r.path, '/mode');
    assert.equal(r.reason, 'BAD_REQUEST');
  }
});

test('prompt: 1 to 500 printable characters after trimming', () => {
  assert.equal(reject(JSON.stringify({ mode: 'scene3d' })).path, '/prompt');
  assert.equal(reject(JSON.stringify({ prompt: 5, mode: 'scene3d' })).reason, 'BAD_REQUEST');
  assert.equal(reject(JSON.stringify({ prompt: '   ', mode: 'scene3d' })).reason, 'BAD_REQUEST');
  assert.ok(parseGenerateRequest(JSON.stringify({ prompt: 'x'.repeat(500), mode: 'scene3d' })).ok);
  assert.deepEqual(reject(JSON.stringify({ prompt: 'x'.repeat(501), mode: 'scene3d' })),
    { status: 400, code: 'VALIDATION_FAILED', path: '/prompt', reason: 'PROMPT_TOO_LONG', requestId: undefined });
  // Counted in code points: 500 emoji are 1000 UTF-16 units and still fit.
  assert.ok(parseGenerateRequest(JSON.stringify({ prompt: '🐘'.repeat(500), mode: 'scene3d' })).ok);
  assert.equal(reject(JSON.stringify({ prompt: 'line\nbreak', mode: 'scene3d' })).reason, 'BAD_REQUEST');
  assert.equal(reject('{"prompt":"lone \\ud800 surrogate","mode":"scene3d"}').reason, 'BAD_REQUEST');
});

test('prompt: invisible, bidi, private-use and separator characters are refused; ZWJ and ZWNJ are kept', () => {
  const body = (prompt: string) => JSON.stringify({ prompt, mode: 'scene3d' });
  for (const bad of ['a\u200Bb', 'a\u200Eb', 'a\u200Fb', 'a\u202Eb', 'a\u2066b', 'a\u2069b', 'a\u2060b', 'a\uFEFFb', 'a\uE000b', 'a\u2028b', 'a\u2029b', 'a\u0007b']) {
    const r = parseGenerateRequest(body(bad));
    assert.ok(!r.ok, JSON.stringify(bad));
  }
  for (const ok of ['a family 👨\u200D👩\u200D👧', 'می\u200Cخواهم', 'Éléphant 象 🐘']) assert.ok(parseGenerateRequest(body(ok)).ok, ok);
});
