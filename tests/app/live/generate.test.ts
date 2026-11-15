// tests/app/live/generate.test.ts
// #213: the live generation client. Off unless the build flag AND `?p2=…,live`; honest states; the gateway's offline
// test provider is never called Gemini; the token is sent only as a bearer header; no socket is ever opened here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGenerateClient, LIVE_OFF, GATEWAY_UNREACHABLE, gatewayUnavailable, liveGenerationEnabled, providerLabel } from '../../../src/app/live/generate';

const scene = JSON.parse(readFileSync('tests/fixtures/scenes/valid-3d-sphere.json', 'utf8'));
function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return { status, json: async () => body, headers: { get: () => null } } as unknown as Response;
  }) as typeof fetch;
}

describe('live generation is off by default', () => {
  it('needs both the build flag and `?p2=…,live`', () => {
    expect(liveGenerationEnabled(undefined, '?p2=generated,live')).toBe(false);
    expect(liveGenerationEnabled('0', '?p2=generated,live')).toBe(false);
    expect(liveGenerationEnabled('1', null)).toBe(false);
    expect(liveGenerationEnabled('1', '?p2=generated')).toBe(false);
    expect(liveGenerationEnabled('1', '?p2=generated,live')).toBe(true);
  });

  it('creating a client sends nothing; only generate() does', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const client = createGenerateClient({ fetch: fakeFetch(503, {}, seen) });
    expect(seen).toHaveLength(0);
    await client.generate({ prompt: 'a cat', mode: 'scene3d' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/api/generate-formation');
    expect(seen[0].init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ prompt: 'a cat', mode: 'scene3d' });
  });
});

describe('honest states', () => {
  it('the shipped gateway (503 PROVIDER_UNAVAILABLE / MODULE_DISABLED) reports the gateway\'s own reason, not a guess', async () => {
    const body = { error: { code: 'PROVIDER_UNAVAILABLE', message: 'The gemini module is disabled. Use the offline library.', details: [{ path: '', reason: 'MODULE_DISABLED' }] } };
    const out = await createGenerateClient({ fetch: fakeFetch(503, body) }).generate({ prompt: 'x', mode: 'scene3d' });
    expect(out).toMatchObject({ ok: false, kind: 'unavailable', code: 'PROVIDER_UNAVAILABLE', message: 'live Gemini unavailable (gateway: MODULE_DISABLED)' });
    expect(gatewayUnavailable('MODULE_DISABLED')).toBe('live Gemini unavailable (gateway: MODULE_DISABLED)');
    expect(LIVE_OFF).toBe('live Gemini unavailable (live mode is off on this page)');   // only for "no live client at all"
  });

  it('an unreachable gateway (or a CORS refusal) is unavailable too, said once', async () => {
    const failing = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const out = await createGenerateClient({ fetch: failing }).generate({ prompt: 'x', mode: 'scene3d' });
    expect(out).toMatchObject({ ok: false, kind: 'unavailable', status: 0, code: 'UNREACHABLE', message: GATEWAY_UNREACHABLE });
  });

  it('a caller abort (supersede, cancel, dispose) aborts the fetch and reads cancelled, before or during the request', async () => {
    let seenSignal: AbortSignal | undefined;
    const hanging = ((_: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      seenSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = createGenerateClient({ fetch: hanging }).generate({ prompt: 'x', mode: 'scene3d', signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(seenSignal?.aborted).toBe(true);
    const already = new AbortController(); already.abort();
    const seen: unknown[] = [];
    expect(await createGenerateClient({ fetch: fakeFetch(200, {}, seen as never) }).generate({ prompt: 'x', mode: 'scene3d', signal: already.signal })).toMatchObject({ kind: 'cancelled' });
    expect(seen).toHaveLength(0);
  });

  it('only a Gemini model id (gemini-<digit>…) is labelled Gemini', () => {
    for (const id of ['gemini-3.1-flash-lite', 'gemini-2.5-pro', 'Gemini-3-flash']) expect(providerLabel(id).gemini, id).toBe(true);
    for (const id of ['gemini', 'geminix', 'gemini-', 'gemini-flash', 'gemini-x1', 'offline-fake', 'my-gemini-3']) expect(providerLabel(id).gemini, id).toBe(false);
  });

  it('the gateway\'s offline-fake provider is never called Gemini; only a gemini* model id is', async () => {
    expect(providerLabel('offline-fake')).toEqual({ provider: 'offline-fake provider (not Gemini)', gemini: false });
    expect(providerLabel('gemini-3.1-flash-lite')).toEqual({ provider: 'live Gemini (gemini-3.1-flash-lite)', gemini: true });
    expect(providerLabel('not-gemini-really').gemini).toBe(false);
    const ok = { model: 'offline-fake', mode: 'scene3d', scene, sceneHash: 'x', modelLatencyMs: 12 };
    const out = await createGenerateClient({ fetch: fakeFetch(200, ok) }).generate({ prompt: 'x', mode: 'scene3d' });
    expect(out).toMatchObject({ ok: true, model: 'offline-fake', provider: 'offline-fake provider (not Gemini)', gemini: false, latencyMs: 12 });
  });

  it('other error envelopes and unusable bodies are typed rejections, never thrown', async () => {
    const rejected = await createGenerateClient({ fetch: fakeFetch(422, { error: { code: 'VALIDATION_FAILED', message: 'bad scene', details: [{ path: '/parts/0', reason: 'RANGE' }] } }) }).generate({ prompt: 'x', mode: 'scene3d' });
    expect(rejected).toMatchObject({ ok: false, kind: 'rejected', code: 'VALIDATION_FAILED', details: [{ path: '/parts/0', reason: 'RANGE' }] });
    const junk = await createGenerateClient({ fetch: fakeFetch(200, { model: 1 }) }).generate({ prompt: 'x', mode: 'scene3d' });
    expect(junk).toMatchObject({ ok: false, kind: 'invalid-response' });
  });

  it('a typed-in token goes only into Authorization: Bearer; none is sent without one', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const client = createGenerateClient({ fetch: fakeFetch(503, {}, seen) });
    await client.generate({ prompt: 'x', mode: 'scene3d', token: 'abc123' });
    await client.generate({ prompt: 'x', mode: 'scene3d' });
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer abc123');
    expect((seen[1].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(String(seen[0].init?.body)).not.toContain('abc123');
  });
});
