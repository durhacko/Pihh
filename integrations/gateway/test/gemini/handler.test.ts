import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGeminiConfig, type GeminiConfig } from '../../src/gemini/config.ts';
import { defaultGeminiDeps, handleGenerateFormation, type GeminiDeps, type ProviderOutcome } from '../../src/gemini/index.ts';
import { isErrorEnvelope } from '../../src/errors.ts';
import { acceptingValidator, fakeProvider, fakeValidator } from './fakes.ts';

const KEY = 'test-key-not-real-0123456789';
const BODY = JSON.stringify({ prompt: '  a grey elephant ', mode: 'scene3d', requestId: 'r-000042' });

function enabled(overrides: Record<string, string> = {}): GeminiConfig {
  return readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, ...overrides });
}

function wired(answer: () => Promise<ProviderOutcome>, config = enabled()): GeminiDeps & { provider: ReturnType<typeof fakeProvider> } {
  return { config, provider: fakeProvider(answer), validator: acceptingValidator };
}

async function errorOf(deps: GeminiDeps, body = BODY): Promise<{ status: number; code: string; reasons: string[]; paths: string[]; requestId?: string; text: string }> {
  const res = await handleGenerateFormation(body, deps);
  assert.ok(isErrorEnvelope(res.body), `expected an error, got ${JSON.stringify(res.body)}`);
  if (!isErrorEnvelope(res.body)) throw new Error('unreachable');
  const { code, details = [], requestId } = res.body.error;
  return { status: res.status, code, reasons: details.map(d => d.reason), paths: details.map(d => d.path), requestId, text: JSON.stringify(res.body) };
}

const SCENE = { version: 1, mode: 'scene3d', title: 'Elephant', referenceView: 'three-quarter', materials: [], parts: [] };
const output = (text: string, latencyMs = 1234.4): ProviderOutcome => ({ kind: 'output', text, latencyMs });

test('offline default: no key gives 503 PROVIDER_UNAVAILABLE / MODULE_DISABLED, with the requestId echoed', async () => {
  const e = await errorOf(defaultGeminiDeps(readGeminiConfig({})));
  assert.deepEqual([e.status, e.code, e.reasons, e.requestId], [503, 'PROVIDER_UNAVAILABLE', ['MODULE_DISABLED'], 'r-000042']);
});

test('this build stays unavailable even with a key: no provider and no validator are shipped', async () => {
  const e = await errorOf(defaultGeminiDeps(enabled()));
  assert.deepEqual([e.status, e.reasons], [503, ['MODULE_DISABLED']]);
  assert.ok(!e.text.includes(KEY));
});

test('no upstream call when the module is not fully available', async () => {
  const provider = fakeProvider(async () => output(JSON.stringify(SCENE)));
  for (const deps of [
    { config: readGeminiConfig({}), provider, validator: acceptingValidator },
    { config: readGeminiConfig({ GEMINI_ENABLED: '1' }), provider, validator: acceptingValidator },
    { config: enabled(), provider, validator: null },
  ]) {
    assert.equal((await errorOf(deps)).reasons[0], 'MODULE_DISABLED');
  }
  assert.equal(provider.calls.length, 0);
});

test('an invalid request is 400 before anything else, even offline', async () => {
  const e = await errorOf(defaultGeminiDeps(readGeminiConfig({})), JSON.stringify({ prompt: '', mode: 'scene3d', requestId: 'r-7' }));
  assert.deepEqual([e.status, e.code, e.reasons, e.requestId], [400, 'VALIDATION_FAILED', ['BAD_REQUEST'], 'r-7']);
});

test('success: §10.1 body, no success flag, requestId echoed, provider sees only the trimmed prompt and mode', async () => {
  const deps = wired(async () => output(JSON.stringify(SCENE)));
  const res = await handleGenerateFormation(BODY, deps);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { requestId: 'r-000042', model: 'test-fake-model', mode: 'scene3d', scene: SCENE, sceneHash: 'hash-test', modelLatencyMs: 1234 });
  assert.deepEqual(deps.provider.calls, [{ prompt: 'a grey elephant', mode: 'scene3d', attemptTimeoutMs: 30_000 }]);
});

test('the provider gets the per-attempt timeout, not the whole-request deadline', async () => {
  const deps = wired(async () => output(JSON.stringify(SCENE)), enabled({ GEMINI_PROVIDER_TIMEOUT_MS: '12000', GEMINI_REQUEST_TIMEOUT_MS: '50000' }));
  assert.equal((await handleGenerateFormation(BODY, deps)).status, 200);
  assert.deepEqual(deps.provider.calls.map(c => c.attemptTimeoutMs), [12_000]);
});

test('upstream errors map to §10.1 codes and reasons', async () => {
  const cases: [number, number, string, string][] = [
    [429, 429, 'RATE_LIMITED', 'PROVIDER_RATE_LIMITED'],
    [503, 503, 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
    [500, 502, 'PROVIDER_ERROR', 'PROVIDER_ERROR'],
    [400, 502, 'PROVIDER_ERROR', 'PROVIDER_ERROR'],
    [403, 502, 'PROVIDER_ERROR', 'PROVIDER_ERROR'],
  ];
  for (const [upstream, status, code, reason] of cases) {
    const e = await errorOf(wired(async () => ({ kind: 'upstream-error', status: upstream })));
    assert.deepEqual([e.status, e.code, e.reasons, e.requestId], [status, code, [reason], 'r-000042'], `upstream ${upstream}`);
  }
});

test('finish reasons other than STOP are never parsed', async () => {
  const cases: [ProviderOutcome, string][] = [
    [{ kind: 'truncated' }, 'RESPONSE_TOO_LARGE'],
    [{ kind: 'blocked' }, 'PROVIDER_BLOCKED'],
    [{ kind: 'other-finish', finishReason: 'OTHER' }, 'PROVIDER_ERROR'],
  ];
  for (const [outcome, reason] of cases) {
    const e = await errorOf(wired(async () => outcome));
    assert.deepEqual([e.status, e.code, e.reasons], [502, 'PROVIDER_ERROR', [reason]]);
  }
});

test('a provider that throws gives 502 and leaks neither its message nor the key', async () => {
  const e = await errorOf(wired(async () => { throw new Error(`upstream said: bad key ${KEY}`); }));
  assert.deepEqual([e.status, e.reasons], [502, ['PROVIDER_ERROR']]);
  assert.ok(!e.text.includes(KEY) && !e.text.includes('upstream said'));
  const sync = await errorOf({ config: enabled(), provider: { model: 'm', generate() { throw new Error('sync'); } }, validator: acceptingValidator });
  assert.equal(sync.status, 502);
});

test('timeout: past the request deadline the call is aborted and the answer is 504 TIMEOUT', async () => {
  const config = enabled({ GEMINI_PROVIDER_TIMEOUT_MS: '10', GEMINI_REQUEST_TIMEOUT_MS: '25' });
  const hanging = wired(() => new Promise<ProviderOutcome>(() => {}), config);
  const e = await errorOf(hanging);
  assert.deepEqual([e.status, e.code, e.reasons, e.requestId], [504, 'TIMEOUT', ['TIMEOUT'], 'r-000042']);
  assert.equal(hanging.provider.signals[0]?.aborted, true);

  const rejectsOnAbort = wired(async () => { throw new Error('never'); }, config);
  rejectsOnAbort.provider.generate = (_request, signal) =>
    new Promise<ProviderOutcome>((_resolve, rejectPromise) => signal.addEventListener('abort', () => rejectPromise(new Error('aborted'))));
  assert.equal((await errorOf(rejectsOnAbort)).code, 'TIMEOUT');
});

test('malformed model output is 502 INVALID_MODEL_OUTPUT or RESPONSE_TOO_LARGE, never repaired', async () => {
  const notJson = await errorOf(wired(async () => output('{"version":1,')));
  assert.deepEqual([notJson.status, notJson.reasons], [502, ['INVALID_MODEL_OUTPUT']]);

  const huge = await errorOf(wired(async () => output(JSON.stringify({ pad: 'x'.repeat(64 * 1024) }))));
  assert.deepEqual([huge.status, huge.reasons], [502, ['RESPONSE_TOO_LARGE']]);

  const proto = await errorOf(wired(async () => output('{"version":1,"mode":"scene3d","parts":[{"__proto__":{"polluted":true}}]}')));
  assert.deepEqual(proto.reasons, ['INVALID_MODEL_OUTPUT']);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  let deep: unknown = 0;
  for (let i = 0; i < 100; i++) deep = [deep];
  assert.deepEqual((await errorOf(wired(async () => output(JSON.stringify(deep))))).reasons, ['INVALID_MODEL_OUTPUT']);
});

test('a scene that fails validation is 400 SCENE_INVALID plus the first issue in SCREAMING_SNAKE', async () => {
  const failing = (code: string, path: string): GeminiDeps => ({
    config: enabled(),
    provider: fakeProvider(async () => output(JSON.stringify(SCENE))),
    validator: fakeValidator(() => ({ ok: false, issues: [{ path, code }, { path: '/title', code: 'second-issue' }] })),
  });
  const geometry = await errorOf(failing('geometry', '/parts/3/shape/points'));
  assert.deepEqual([geometry.status, geometry.code, geometry.paths, geometry.reasons],
    [400, 'VALIDATION_FAILED', ['', '/scene/parts/3/shape/points'], ['SCENE_INVALID', 'GEOMETRY']]);
  assert.deepEqual((await errorOf(failing('radio-partitioned', ''))).reasons, ['SCENE_INVALID', 'RADIO_PARTITIONED']);
});

test('a validator that returns the other mode, or throws, is refused', async () => {
  const otherMode = await errorOf({
    config: enabled(),
    provider: fakeProvider(async () => output(JSON.stringify(SCENE))),
    validator: fakeValidator(() => ({ ok: true, scene: { version: 1, mode: 'silhouette2d' }, sceneHash: 'h' })),
  });
  assert.deepEqual([otherMode.status, otherMode.paths, otherMode.reasons], [400, ['', '/scene/mode'], ['SCENE_INVALID', 'SCHEMA']]);

  const throwing = await errorOf({
    config: enabled(),
    provider: fakeProvider(async () => output(JSON.stringify(SCENE))),
    validator: fakeValidator(() => { throw new Error('bug'); }),
  });
  assert.deepEqual([throwing.status, throwing.code], [500, 'INTERNAL']);
});
