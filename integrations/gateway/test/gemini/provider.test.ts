// GF-T33 (2)–(3): 429 and 503 retried with exponential backoff and jitter up to the cap; nothing else retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abortableSleep, backoffMs, RETRY_POLICY, withRetries, type RetryDeps } from '../../src/gemini/provider.ts';
import { scriptedProvider, stopWith } from '../../src/gemini/fakeProvider.ts';
import type { ProviderOutcome, ProviderRequest } from '../../src/gemini/types.ts';

const REQUEST: ProviderRequest = { prompt: 'an elephant', mode: 'scene3d', attemptTimeoutMs: 30_000 };
const upstream = (status: number) => ({ outcome: { kind: 'upstream-error', status } as ProviderOutcome });

/** Records every sleep instead of waiting. */
function recorder(random = () => 0.5): RetryDeps & { sleeps: number[] } {
  const sleeps: number[] = [];
  return { random, sleeps, sleep: async (ms: number) => { sleeps.push(ms); } };
}

test('backoff is exponential with equal jitter, capped', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(n => backoffMs(n, () => 0)), [250, 500, 1000, 2000, 2000]);
  assert.deepEqual([1, 2, 3].map(n => backoffMs(n, () => 0.999999)), [500, 1000, 2000]);
  assert.deepEqual([1, 2].map(n => backoffMs(n, () => NaN)), [250, 500], 'a bad random value is clamped, never NaN');
  assert.equal(RETRY_POLICY.maxRetries, 2);
});

for (const status of [429, 503]) {
  test(`${status} is retried up to the cap with growing, jittered delays; then the last outcome stands`, async () => {
    const fake = scriptedProvider([upstream(status)]);
    const deps = recorder(() => 0.5);
    const outcome = await withRetries(fake, deps).generate(REQUEST, new AbortController().signal);
    assert.deepEqual(outcome, { kind: 'upstream-error', status });
    assert.equal(fake.calls.length, 1 + RETRY_POLICY.maxRetries);
    assert.deepEqual(deps.sleeps, [375, 750]);
  });

  test(`${status} then success: the success is returned after one retry`, async () => {
    const fake = scriptedProvider([upstream(status), stopWith({ ok: 1 })]);
    const deps = recorder();
    const outcome = await withRetries(fake, deps).generate(REQUEST, new AbortController().signal);
    assert.equal(outcome.kind, 'output');
    assert.equal(fake.calls.length, 2);
    assert.equal(deps.sleeps.length, 1);
  });
}

test('400, 402, 403, 500, 502, 408 and every non-error outcome are never retried', async () => {
  const finals: ProviderOutcome[] = [
    ...[400, 402, 403, 404, 408, 500, 502, 504].map(status => ({ kind: 'upstream-error', status }) as ProviderOutcome),
    { kind: 'timeout' }, { kind: 'truncated' }, { kind: 'blocked' }, { kind: 'other-finish', finishReason: 'OTHER' },
    { kind: 'output', text: '{}', latencyMs: 1 },
  ];
  for (const final of finals) {
    const fake = scriptedProvider([{ outcome: final }]);
    const deps = recorder();
    assert.deepEqual(await withRetries(fake, deps).generate(REQUEST, new AbortController().signal), final);
    assert.equal(fake.calls.length, 1, JSON.stringify(final));
    assert.deepEqual(deps.sleeps, []);
  }
});

test('no retry after the whole-request deadline aborts, even during the backoff', async () => {
  const controller = new AbortController();
  const fake = scriptedProvider([upstream(503)]);
  const deps: RetryDeps = { random: () => 0, sleep: async () => { controller.abort(); } };
  const outcome = await withRetries(fake, deps).generate(REQUEST, controller.signal);
  assert.deepEqual(outcome, { kind: 'upstream-error', status: 503 });
  assert.equal(fake.calls.length, 1);
});

test('each attempt is bounded by attemptTimeoutMs; a timeout is final, and the provider sees its signal abort', async () => {
  let aborted = false;
  const fake = scriptedProvider([() => new Promise<ProviderOutcome>(() => {})]);
  const hanging = { model: fake.model, generate: (request: ProviderRequest, signal: AbortSignal) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return fake.generate(request, signal);
  } };
  const started = Date.now();
  const whole = new AbortController();
  // A guard so a broken per-attempt timeout fails this test instead of hanging the run.
  let guard: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<'hung'>(resolve => { guard = setTimeout(() => { whole.abort(); resolve('hung'); }, 2_000); });
  const outcome = await Promise.race([withRetries(hanging, recorder()).generate({ ...REQUEST, attemptTimeoutMs: 50 }, whole.signal), hung]);
  clearTimeout(guard);
  assert.deepEqual(outcome, { kind: 'timeout' }, 'the attempt timed out on its own, not via the guard');
  assert.ok(Date.now() - started < 2_000);
  assert.ok(aborted);
  assert.equal(fake.calls.length, 1);
});

test('a provider that throws is a final upstream failure (status 0), not retried', async () => {
  const throwing = { model: 'x', generate: async () => { throw new Error('socket hang up'); } };
  const deps = recorder();
  assert.deepEqual(await withRetries(throwing, deps).generate(REQUEST, new AbortController().signal), { kind: 'upstream-error', status: 0 });
  assert.deepEqual(deps.sleeps, []);
});

test('abortableSleep resolves on time, or early on abort', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const sleeping = abortableSleep(10_000, controller.signal);
  controller.abort();
  await sleeping;
  assert.ok(Date.now() - started < 1_000);
  await abortableSleep(5, new AbortController().signal);
});
