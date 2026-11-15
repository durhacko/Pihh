// GF-WP-12 step 5, GF-T33 (5): parse only on STOP; MAX_TOKENS → truncated; SAFETY, RECITATION or blockReason → blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapProviderResponse } from '../../src/gemini/mapResponse.ts';

test('STOP with text is output (latency kept, bad latency zeroed)', () => {
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason: 'STOP', text: '{"a":1}', latencyMs: 1234.5 }), { kind: 'output', text: '{"a":1}', latencyMs: 1234.5 });
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason: 'STOP', text: '{}', latencyMs: -5 }), { kind: 'output', text: '{}', latencyMs: 0 });
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason: 'STOP', text: '{}' }), { kind: 'output', text: '{}', latencyMs: 0 });
});

test('STOP with no text is output with an empty string (the handler reports INVALID_MODEL_OUTPUT)', () => {
  for (const text of [undefined, null]) assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason: 'STOP', text }), { kind: 'output', text: '', latencyMs: 0 });
});

test('MAX_TOKENS is truncated; SAFETY and RECITATION are blocked; text is never surfaced for them', () => {
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason: 'MAX_TOKENS', text: '{"partial":' }), { kind: 'truncated' });
  for (const finishReason of ['SAFETY', 'RECITATION']) assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason, text: '{}' }), { kind: 'blocked' });
});

test('a promptFeedback.blockReason blocks, whatever the finish reason', () => {
  for (const finishReason of ['STOP', undefined, 'MAX_TOKENS']) {
    assert.deepEqual(mapProviderResponse({ httpStatus: 200, blockReason: 'PROHIBITED_CONTENT', finishReason, text: '{}' }), { kind: 'blocked' });
  }
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, blockReason: '  ', finishReason: 'STOP', text: '{}' }).kind, 'output', 'a blank blockReason is no block');
});

test('any other or missing finish reason is never parsed', () => {
  for (const finishReason of ['OTHER', 'BLOCKLIST', 'SPII', 'LANGUAGE', 'FINISH_REASON_UNSPECIFIED', 'stop', ' STOP-ish']) {
    assert.deepEqual(mapProviderResponse({ httpStatus: 200, finishReason, text: '{}' }), { kind: 'other-finish', finishReason: finishReason.trim() });
  }
  assert.deepEqual(mapProviderResponse({ httpStatus: 200, text: '{}' }), { kind: 'other-finish', finishReason: 'FINISH_REASON_MISSING' });
});

test('a non-200 status is an upstream error, checked before anything else', () => {
  for (const httpStatus of [400, 402, 403, 429, 500, 503]) {
    assert.deepEqual(mapProviderResponse({ httpStatus, finishReason: 'STOP', text: '{}' }), { kind: 'upstream-error', status: httpStatus });
  }
  assert.deepEqual(mapProviderResponse({ httpStatus: 200.5, finishReason: 'STOP', text: '{}' }), { kind: 'upstream-error', status: 0 });
});
