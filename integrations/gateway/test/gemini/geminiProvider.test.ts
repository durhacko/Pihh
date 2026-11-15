// The live Gemini adapter (G4, prepared before D3), tested with an INJECTED transport only: nothing here contacts
// Google, and the adapter has no default transport to fall back on.
//
// FIXTURES ARE RECORDED-SHAPE, NOT RECORDED RESPONSES. No byte of them came from a real Gemini call. Each fake answer
// uses the names the spec gives as design rules (gemini-generated-formations.md §10.1/§10.3: `candidates[0].finishReason`,
// `promptFeedback.blockReason`, `thoughtsTokenCount`; their wire spelling is UNVERIFIED), laid out as the adapter's
// header marks UNVERIFIED (`candidates[0].content.parts[].text`, `usageMetadata`). Names that appear ONLY in these
// fixtures and nowhere in the spec, all UNVERIFIED: `role: 'model'`, `promptTokenCount`, `candidatesTokenCount`,
// `totalTokenCount`, and the finish reason `MALFORMED_FUNCTION_CALL` (used only as "some other finish").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { readGeminiConfig } from '../../src/gemini/config.ts';
import {
  buildRequestBody, createGeminiProvider, GEMINI_REST_BASE, MAX_OUTPUT_TOKENS, MAX_RESPONSE_BYTES, PLACEHOLDER_PROMPTS,
  readResponseBody, THINKING_LEVEL, type EnabledGeminiConfig, type ProviderObservation, type Transport, type TransportInit,
} from '../../src/gemini/geminiProvider.ts';
import { geminiModule } from '../../src/gemini/module.ts';
import { RETRY_POLICY, withRetries } from '../../src/gemini/provider.ts';
import { createSceneValidator } from '../../src/gemini/validate.ts';
import type { FormationMode, ProviderRequest } from '../../src/gemini/types.ts';

const KEY = 'test-key-not-real-0123456789';
const schema = (mode: FormationMode): object =>
  JSON.parse(readFileSync(new URL(`../../../../src/score/generated/schema/${mode === 'silhouette2d' ? 'scene2d' : 'scene3d'}.schema.json`, import.meta.url), 'utf8')) as object;
const SCHEMAS = { silhouette2d: schema('silhouette2d'), scene3d: schema('scene3d') } as const;
const SPHERE = readFileSync(new URL('../../../../tests/fixtures/scenes/valid-3d-sphere.json', import.meta.url), 'utf8');

function config(model?: string): EnabledGeminiConfig {
  const c = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, ...(model ? { GEMINI_MODEL: model } : {}) });
  if (!c.enabled) throw new Error('config should be enabled');
  return c;
}

/** RECORDED-SHAPE answer: a 200 with one candidate (see the file header). */
function candidateBody(finishReason: string | undefined, parts: { text: string; thought?: boolean }[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 300, thoughtsTokenCount: 40, totalTokenCount: 460 },
    ...extra,
  });
}

interface Call { url: string; init: TransportInit }
/** The request body as sent, read back for assertions. */
interface SentBody { contents: unknown; systemInstruction: unknown; generationConfig: Record<string, unknown> }
/** A transport that records every call and answers from `answer`. */
function transport(answer: (call: Call, index: number) => Promise<{ status: number; body: string }> | { status: number; body: string }) {
  const calls: Call[] = [];
  const fn: Transport = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const { status, body } = await answer(call, calls.length - 1);
    return { status, text: async () => body };
  };
  return { fn, calls };
}

let clock = 0;
const now = () => (clock += 250);
const REQ3D: ProviderRequest = { prompt: 'a white sphere', mode: 'scene3d', attemptTimeoutMs: 30_000 };
const REQ2D: ProviderRequest = { prompt: 'an elephant in profile', mode: 'silhouette2d', attemptTimeoutMs: 30_000 };
const live = (signal = new AbortController().signal) => signal;

test('the request: one POST to the model\'s generateContent, key in a header only, the committed schema, per-mode limits', async () => {
  for (const [request, mode] of [[REQ2D, 'silhouette2d'], [REQ3D, 'scene3d']] as const) {
    const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: '{}' }]) }));
    await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }).generate(request, live());
    assert.equal(t.calls.length, 1);
    const { url, init } = t.calls[0]!;
    assert.equal(url, `${GEMINI_REST_BASE}/models/gemini-3.1-flash-lite:generateContent`);
    assert.ok(!url.includes(KEY), 'the key is never in the URL');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { 'content-type': 'application/json', 'x-goog-api-key': KEY });
    const body = JSON.parse(init.body) as SentBody;
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: request.prompt }] }]);
    assert.deepEqual(body.systemInstruction, { parts: [{ text: PLACEHOLDER_PROMPTS[mode] }] });
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseJsonSchema, SCHEMAS[mode], 'the committed scene schema, unchanged');
    assert.ok(!('responseSchema' in body.generationConfig), 'never combined with responseSchema (§10.6)');
    assert.equal(body.generationConfig.maxOutputTokens, mode === 'silhouette2d' ? 2_048 : 8_192);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: mode === 'silhouette2d' ? 'minimal' : 'low' });
    assert.ok(!('temperature' in body.generationConfig), 'temperature is omitted unless set');
    assert.ok(!init.body.includes(KEY), 'the key is never in the body');
  }
  assert.deepEqual(MAX_OUTPUT_TOKENS, { silhouette2d: 2_048, scene3d: 8_192 });
  assert.deepEqual(THINKING_LEVEL, { silhouette2d: 'minimal', scene3d: 'low' });
});

test('GEMINI_MODEL picks the model in the URL; prompts, temperature and the endpoint can be replaced', async () => {
  const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: '{}' }]) }));
  const provider = createGeminiProvider(config('gemini-3.5-flash-lite'), {
    transport: t.fn, schemas: SCHEMAS, now, prompts: { scene3d: 'WILLIAM 3D' }, temperature: 0.3, endpoint: 'http://127.0.0.1:9/v1beta/',
  });
  assert.equal(provider.model, 'gemini-3.5-flash-lite');
  await provider.generate(REQ3D, live());
  assert.equal(t.calls[0]!.url, 'http://127.0.0.1:9/v1beta/models/gemini-3.5-flash-lite:generateContent');
  const body = JSON.parse(t.calls[0]!.init.body) as SentBody;
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'WILLIAM 3D' }] });
  assert.equal(body.generationConfig.temperature, 0.3);
  assert.deepEqual(buildRequestBody(REQ2D, { schemas: SCHEMAS, prompts: { scene3d: 'x' } }).systemInstruction, { parts: [{ text: PLACEHOLDER_PROMPTS.silhouette2d }] });
});

test('a STOP answer is output: the non-thought text parts joined, latency from the injected clock', async () => {
  clock = 0;
  const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: 'thinking aloud', thought: true }, { text: SPHERE.slice(0, 20) }, { text: SPHERE.slice(20) }]) }));
  const outcome = await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }).generate(REQ3D, live());
  assert.deepEqual(outcome, { kind: 'output', text: SPHERE, latencyMs: 250 });
});

test('finish reasons pass through mapProviderResponse unchanged: MAX_TOKENS, SAFETY, blockReason, missing, other', async () => {
  const cases: [string, unknown][] = [
    [candidateBody('MAX_TOKENS', [{ text: '{"version":1,' }]), { kind: 'truncated' }],
    [candidateBody('SAFETY', [{ text: '{}' }]), { kind: 'blocked' }],
    [candidateBody('RECITATION', [{ text: '{}' }]), { kind: 'blocked' }],
    [JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { kind: 'blocked' }],
    [candidateBody(undefined, [{ text: '{}' }]), { kind: 'other-finish', finishReason: 'FINISH_REASON_MISSING' }],
    [candidateBody('MALFORMED_FUNCTION_CALL', [{ text: '{}' }]), { kind: 'other-finish', finishReason: 'MALFORMED_FUNCTION_CALL' }],
    [JSON.stringify({ candidates: [] }), { kind: 'other-finish', finishReason: 'FINISH_REASON_MISSING' }],
    ['not json at all', { kind: 'other-finish', finishReason: 'FINISH_REASON_MISSING' }],
  ];
  for (const [body, expected] of cases) {
    const t = transport(() => ({ status: 200, body }));
    assert.deepEqual(await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }).generate(REQ3D, live()), expected, body.slice(0, 60));
  }
});

test('a non-200 status is an upstream error with that status, never parsed', async () => {
  for (const status of [400, 403, 429, 500, 503]) {
    const t = transport(() => ({ status, body: candidateBody('STOP', [{ text: SPHERE }]) }));
    assert.deepEqual(await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }).generate(REQ3D, live()), { kind: 'upstream-error', status });
  }
});

test('one generate is exactly one HTTP call: retries are only withRetries\' (429, 429, then STOP = 3 calls)', async () => {
  const script = (_call: Call, i: number) => (i < 2 ? { status: 429, body: '{}' } : { status: 200, body: candidateBody('STOP', [{ text: SPHERE }]) });
  const alone = transport(script);
  assert.deepEqual(await createGeminiProvider(config(), { transport: alone.fn, schemas: SCHEMAS, now }).generate(REQ3D, live()), { kind: 'upstream-error', status: 429 });
  assert.equal(alone.calls.length, 1, 'the adapter alone never retries');
  const t = transport(script);
  const wrapped = withRetries(createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }), { random: () => 0.5, sleep: async () => {} });
  assert.equal((await wrapped.generate(REQ3D, live())).kind, 'output');
  assert.equal(t.calls.length, 1 + RETRY_POLICY.maxRetries, '429, 429, then STOP: the wrapper\'s two retries');
});

test('the per-attempt timeout aborts the call and reports timeout', async () => {
  let sawAbort = false;
  const hanging: Transport = (_url, init) => new Promise((_ok, fail) => {
    init.signal.addEventListener('abort', () => { sawAbort = true; fail(new Error('aborted')); }, { once: true });
  });
  const outcome = await createGeminiProvider(config(), { transport: hanging, schemas: SCHEMAS, now }).generate({ ...REQ3D, attemptTimeoutMs: 20 }, live());
  assert.deepEqual(outcome, { kind: 'timeout' });
  assert.equal(sawAbort, true);
});

test('the whole-request signal aborts the call (and an already-aborted signal makes no call)', async () => {
  const controller = new AbortController();
  const hanging: Transport = (_url, init) => new Promise((_ok, fail) => { init.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }); });
  const pending = createGeminiProvider(config(), { transport: hanging, schemas: SCHEMAS, now }).generate(REQ3D, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { kind: 'timeout' });
  const t = transport(() => ({ status: 200, body: '{}' }));
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now }).generate(REQ3D, aborted.signal), { kind: 'timeout' });
  assert.equal(t.calls.length, 0);
});

test('a transport failure is an upstream error of unknown status; an oversized body is never parsed', async () => {
  const failing: Transport = async () => { throw new Error(`ECONNRESET with ${KEY}`); };
  assert.deepEqual(await createGeminiProvider(config(), { transport: failing, schemas: SCHEMAS, now }).generate(REQ3D, live()), { kind: 'upstream-error', status: 0 });
  const big = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: 'x'.repeat(MAX_RESPONSE_BYTES) }]) }));
  assert.deepEqual(await createGeminiProvider(config(), { transport: big.fn, schemas: SCHEMAS, now }).generate(REQ3D, live()), { kind: 'upstream-error', status: 0 });
});

test('observations carry status, outcome, finish reason and token counts, never the key, prompt or model text', async () => {
  const seen: ProviderObservation[] = [];
  const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: SPHERE }]) }));
  await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now, observe: o => { seen.push(o); } }).generate(REQ3D, live());
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.httpStatus, 200);
  assert.equal(seen[0]!.outcome, 'output');
  assert.equal(seen[0]!.finishReason, 'STOP');
  assert.equal(seen[0]!.usage?.thoughtsTokenCount, 40);
  const text = JSON.stringify(seen);
  for (const secretish of [KEY, REQ3D.prompt, '"parts"', SPHERE.slice(10, 40)]) assert.ok(!text.includes(secretish), secretish);
  // A transport error that quotes the key is swallowed, never observed.
  const errSeen: ProviderObservation[] = [];
  const failing: Transport = async () => { throw new Error(`refused for ${KEY}`); };
  await createGeminiProvider(config(), { transport: failing, schemas: SCHEMAS, now, observe: o => { errSeen.push(o); } }).generate(REQ3D, live());
  assert.ok(!JSON.stringify(errSeen).includes(KEY));
  // A throwing observer never breaks the request.
  const outcome = await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now, observe: () => { throw new Error('log down'); } }).generate(REQ3D, live());
  assert.equal(outcome.kind, 'output');
});

test('the provider object exposes no key: not as a property, not through JSON or String', () => {
  const provider = createGeminiProvider(config(), { transport: async () => ({ status: 200, text: async () => '{}' }), schemas: SCHEMAS, now });
  assert.deepEqual(Object.keys(provider).sort(), ['generate', 'model']);
  assert.ok(!JSON.stringify(provider).includes(KEY));
  assert.ok(!String(provider).includes(KEY));
  assert.ok(Object.isFrozen(provider));
});

test('readResponseBody copies exactly the fields mapProviderResponse reads', () => {
  assert.deepEqual(readResponseBody(200, candidateBody('STOP', [{ text: 'a' }, { text: 'b' }]), 7).raw, { httpStatus: 200, latencyMs: 7, blockReason: null, finishReason: 'STOP', text: 'ab' });
  assert.deepEqual(readResponseBody(503, 'anything', 7).raw, { httpStatus: 503, latencyMs: 7 });
});

// ------------------------------------------------------------------ review follow-ups (bounded reads, totality, hygiene)

/** A response whose text() must never be called (the adapter must not read it). */
const unreadable = (status: number, extra: Partial<{ headers: { get(n: string): string | null }; body: ReadableStream<Uint8Array> }> = {}) =>
  ({ status, text: async () => { throw new Error('text() was read'); }, ...extra });

test('an error status is final without reading its body: a 429 or 503 stays retryable however large', async () => {
  for (const status of [429, 503, 400]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const outcome = await createGeminiProvider(config(), { transport: async () => unreadable(status, { body }), schemas: SCHEMAS, now }).generate(REQ3D, live());
    assert.deepEqual(outcome, { kind: 'upstream-error', status });
    assert.equal(cancelled, true, 'the unread body is cancelled');
  }
});

test('reads are bounded: a declared content-length over the cap is refused unread; a streamed body is cut at the cap', async () => {
  const declared = await createGeminiProvider(config(), {
    transport: async () => unreadable(200, { headers: { get: (n: string) => (n === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) } }),
    schemas: SCHEMAS, now,
  }).generate(REQ3D, live());
  assert.deepEqual(declared, { kind: 'upstream-error', status: 0 });

  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(chunk); }, cancel() { cancelled = true; } });
  const streamed = await createGeminiProvider(config(), { transport: async () => unreadable(200, { body: endless }), schemas: SCHEMAS, now }).generate(REQ3D, live());
  assert.deepEqual(streamed, { kind: 'upstream-error', status: 0 });
  assert.equal(cancelled, true);
  assert.ok(pulled * chunk.byteLength <= MAX_RESPONSE_BYTES + 2 * chunk.byteLength, `read ${pulled} chunks`);

  // A small streamed STOP answer is decoded and parsed like text().
  const small = new TextEncoder().encode(candidateBody('STOP', [{ text: SPHERE }]));
  const ok = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(small.slice(0, 7)); c.enqueue(small.slice(7)); c.close(); } });
  const parsed = await createGeminiProvider(config(), { transport: async () => unreadable(200, { body: ok }), schemas: SCHEMAS, now }).generate(REQ3D, live());
  assert.equal(parsed.kind === 'output' && parsed.text, SPHERE);
});

test('a transport that ignores the abort and answers after the attempt timeout is still a timeout', async () => {
  const late: Transport = () => new Promise(resolve => setTimeout(() => resolve({ status: 200, text: async () => candidateBody('STOP', [{ text: SPHERE }]) }), 60));
  assert.deepEqual(await createGeminiProvider(config(), { transport: late, schemas: SCHEMAS, now }).generate({ ...REQ3D, attemptTimeoutMs: 10 }, live()), { kind: 'timeout' });
});

test('upstream strings are sanitised: an odd finish reason becomes UNRECOGNISED; only known usage counters are kept', async () => {
  const seen: ProviderObservation[] = [];
  const odd = 'STOP\n[fake log line]' + 'X'.repeat(5_000);
  const t = transport(() => ({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: odd }], usageMetadata: { thoughtsTokenCount: 3, ['k'.repeat(3_000)]: 1 } }) }));
  const outcome = await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now, observe: o => { seen.push(o); } }).generate(REQ3D, live());
  assert.deepEqual(outcome, { kind: 'other-finish', finishReason: 'UNRECOGNISED' });
  assert.equal(seen[0]!.finishReason, 'UNRECOGNISED');
  assert.deepEqual(seen[0]!.usage, { thoughtsTokenCount: 3 });
  assert.ok(!JSON.stringify(seen).includes('fake log line'));
});

test('generate never rejects: a throwing clock still gives the outcome', async () => {
  const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: SPHERE }]) }));
  const outcome = await createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now: () => { throw new Error('clock'); } }).generate(REQ3D, live());
  assert.deepEqual(outcome, { kind: 'output', text: SPHERE, latencyMs: 0 });
});

test('an endpoint override must be https, except for a local host', () => {
  const deps = { transport: transport(() => ({ status: 200, body: '{}' })).fn, schemas: SCHEMAS, now };
  assert.throws(() => createGeminiProvider(config(), { ...deps, endpoint: 'http://proxy.example.com/v1beta' }), RangeError);
  assert.throws(() => createGeminiProvider(config(), { ...deps, endpoint: 'not a url' }), RangeError);
  for (const ok of ['https://proxy.example.com/v1beta', 'http://127.0.0.1:8080/v1beta', 'http://localhost:8080/v1beta']) {
    assert.doesNotThrow(() => createGeminiProvider(config(), { ...deps, endpoint: ok }), ok);
  }
});

test('every path clears its timer and removes its abort listener (normal, error status, transport throw, pre-aborted)', async () => {
  const timers = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
  const paths: Transport[] = [
    transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: '{}' }]) })).fn,
    transport(() => ({ status: 503, body: '{}' })).fn,
    async () => { throw new Error('reset'); },
  ];
  for (const path of paths) {
    const controller = new AbortController();
    const before = timers();
    await createGeminiProvider(config(), { transport: path, schemas: SCHEMAS, now }).generate(REQ3D, controller.signal);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(timers(), before);
  }
  const aborted = new AbortController();
  aborted.abort();
  const before = timers();
  await createGeminiProvider(config(), { transport: paths[0]!, schemas: SCHEMAS, now }).generate(REQ3D, aborted.signal);
  assert.equal(getEventListeners(aborted.signal, 'abort').length, 0);
  assert.equal(timers(), before);
});

test('through the module: a STOP answer carrying a valid scene is served with the server-side check and sceneHash', async () => {
  const t = transport(() => ({ status: 200, body: candidateBody('STOP', [{ text: SPHERE }]) }));
  const provider = createGeminiProvider(config(), { transport: t.fn, schemas: SCHEMAS, now });
  const module = geminiModule({ config: config(), provider, validator: createSceneValidator() }, { random: () => 0.5, sleep: async () => {} });
  const route = module.routes[0]!;
  const reply = await route.handle({ rawBody: JSON.stringify({ prompt: 'a white sphere', mode: 'scene3d', requestId: 'r-000001' }) } as Parameters<typeof route.handle>[0]);
  const text = JSON.stringify(reply);
  assert.ok(text.includes('"model":"gemini-3.1-flash-lite"'), text.slice(0, 300));
  assert.ok(text.includes('"sceneHash"'), text.slice(0, 300));
  assert.ok(text.includes('r-000001'));
  assert.ok(!text.includes(KEY));
  assert.equal(t.calls.length, 1);
});
