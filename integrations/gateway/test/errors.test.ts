import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptRequestId, errorResponse, ERROR_CODES, isErrorEnvelope, redact, sanitise, STATUS_OF, toReason } from '../src/errors.ts';

test('requestId: a matching value is kept, anything else is dropped', () => {
  assert.equal(acceptRequestId('r-000042'), 'r-000042');
  assert.equal(acceptRequestId('a.b_c:d-1'), 'a.b_c:d-1');
  assert.equal(acceptRequestId('x'.repeat(64)), 'x'.repeat(64));
  for (const bad of ['', 'x'.repeat(65), 'has space', 'semi;colon', 'é', 42, null, undefined, {}, ['r-1']]) {
    assert.equal(acceptRequestId(bad), undefined, `should drop ${JSON.stringify(bad)}`);
  }
});

test('every shared code has a status, and the statuses match boundaries §6.2 / spec §10.1', () => {
  assert.equal(ERROR_CODES.length, 14);
  for (const code of ERROR_CODES) assert.equal(typeof STATUS_OF[code], 'number');
  assert.deepEqual(
    [STATUS_OF.VALIDATION_FAILED, STATUS_OF.UNAUTHORIZED, STATUS_OF.FORBIDDEN, STATUS_OF.PAYLOAD_TOO_LARGE, STATUS_OF.UNSUPPORTED_MEDIA_TYPE,
      STATUS_OF.RATE_LIMITED, STATUS_OF.PROVIDER_ERROR, STATUS_OF.PROVIDER_UNAVAILABLE, STATUS_OF.TIMEOUT, STATUS_OF.INTERNAL],
    [400, 401, 403, 413, 415, 429, 502, 503, 504, 500],
  );
});

test('toReason maps kebab-case score codes to SCREAMING_SNAKE (XI-16)', () => {
  assert.equal(toReason('geometry'), 'GEOMETRY');
  assert.equal(toReason('radio-partitioned'), 'RADIO_PARTITIONED');
  assert.equal(toReason('below-floor'), 'BELOW_FLOOR');
  assert.equal(toReason('ALREADY_SNAKE'), 'ALREADY_SNAKE');
  assert.equal(toReason(''), 'INVALID');
  assert.equal(toReason('<script>'), 'INVALID');
});

test('sanitise removes control characters and caps the length', () => {
  assert.equal(sanitise('a\u0000b\nc\u009f d'), 'a b c d');
  const long = sanitise('x'.repeat(500));
  assert.equal([...long].length, 200);
  assert.ok(long.endsWith('…'));
});

test('redact replaces every occurrence of each secret', () => {
  assert.equal(redact('key=abc123 again abc123', ['abc123']), 'key=[redacted] again [redacted]');
  assert.equal(redact('nothing', ['']), 'nothing');
});

test('errorResponse builds the one envelope: no success flag, normalised reasons, requestId only when valid', () => {
  const ok = errorResponse('RATE_LIMITED', 'slow down', { details: [{ path: '', reason: 'PROVIDER_RATE_LIMITED' }], requestId: 'r-1' });
  assert.equal(ok.status, 429);
  assert.deepEqual(ok.body, { error: { code: 'RATE_LIMITED', message: 'slow down', details: [{ path: '', reason: 'PROVIDER_RATE_LIMITED' }], requestId: 'r-1' } });
  assert.ok(!('success' in ok.body));
  assert.ok(isErrorEnvelope(ok.body));

  const dropped = errorResponse('INTERNAL', 'x', { requestId: 'bad id' });
  assert.ok(!('requestId' in dropped.body.error));
  assert.ok(!('details' in dropped.body.error));

  const kebab = errorResponse('VALIDATION_FAILED', 'x', { details: [{ path: '/a', reason: 'radio-partitioned' }], status: 422 });
  assert.equal(kebab.status, 422);
  assert.equal(kebab.body.error.details?.[0]?.reason, 'RADIO_PARTITIONED');

  assert.ok(!isErrorEnvelope({ error: { code: 'NOPE' } }));
  assert.ok(!isErrorEnvelope(null));
});
