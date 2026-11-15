// MDB-WP-05 (#264): the show-library client (src/app/live/shows.ts) and the Saved compositions panel
// (src/app/live/SavedCompositions.ts), against the spec §10.1 API through an INJECTED FAKE fetch only: no socket,
// no gateway, no database. Nothing here is live evidence. The panel runs on the headless fakeDom.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeParams } from '../../src/contracts';
import { Drafts } from '../../src/app/ui/Composer';
import { getShow, listShows, newOperationId, probeShows, saveShow, summaryOf, type ClientOptions } from '../../src/app/live/shows';
import { createPanel, MESSAGES } from '../../src/app/live/SavedCompositions';
import { FakeDocument, FakeElement } from '../app/ui/fakeDom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const proto = FakeElement.prototype as unknown as { replaceChildren?: (...nodes: (FakeElement | string)[]) => void };
proto.replaceChildren ??= function (this: FakeElement, ...nodes: (FakeElement | string)[]) { this.textContent = ''; this.append(...nodes); };
afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------------------------- the fake API
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'network' | 'hang';
interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
function fakeApi(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined });
    const key = `${method} ${url.split('?')[0]}`;
    const queue = queues.get(key) ?? queues.get(`${method} *`);
    const reply = queue ? (queue.length > 1 ? queue.shift()! : queue[0]!) : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no route' } } };
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    return { status: reply.status, json: async () => reply.body, headers: { get: (h: string) => reply.headers?.[h] ?? null } } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  const options: ClientOptions = { fetch, sleep: async () => {}, timeoutMs: 50 };
  return { calls, options };
}
const health = (shows: unknown) => ({ status: 200, body: { service: 'encore-gateway', version: '0.0.0', modules: { shows } } });
const UP = health({ enabled: true, db: 'up', writable: true });
const ID = '0123456789abcdef01234567';
// §10.1's flat ShowSummary: no `loadable` field on a valid item; `loadable: false` only on an invalid stored one.
const item = (over: Record<string, unknown> = {}) => ({ id: ID, title: 'Hello', source: 'manual', createdAt: '2026-11-15T09:00:00.000Z', movementCount: 2, kinds: ['text', 'sphere'], schemaVersion: 1, ...over });
/** An invalid stored item as the gateway lists it: fixed title, no stored value. */
const INVALID_ITEM = { id: 'fedcba9876543210fedcba98', title: 'Invalid saved show', loadable: false };
const composition = { v: 1, movements: [{ recipe: { kind: 'text', text: 'HELLO' }, holdTicks: 600 }, { recipe: { kind: 'sphere' }, holdTicks: 300 }] };
const show = (over: Record<string, unknown> = {}) => ({ ...item(), composition, contentHash: 'a'.repeat(64), updatedAt: '2026-11-15T09:00:00.000Z', ...over });
const request = { schemaVersion: 1 as const, title: 'Hello', source: 'manual' as const, composition: { v: 1 as const, movements: [{ recipe: { kind: 'sphere' as const }, holdTicks: 600 }] } };

// ---------------------------------------------------------------------------------------------- client
describe('client: health probe → availability (§10.4)', () => {
  it.each([
    ['up', UP],
    ['read-only', health({ enabled: true, db: 'up', writable: false })],
    ['down', health({ enabled: true, db: 'down', writable: false })],
    ['disabled', health({ enabled: false, db: 'disabled', writable: false })],
    ['disabled', { status: 200, body: { service: 'encore-gateway', modules: {} } }],
    ['unavailable', 'network' as const],
    ['unavailable', 'hang' as const],
    ['unavailable', { status: 502, body: null }],
    ['unavailable', { status: 200, body: '<html>' }],
  ])('%s', async (expected, reply) => {
    const api = fakeApi({ 'GET /api/health': reply as Reply });
    expect(await probeShows(api.options)).toBe(expected);
    expect(api.calls).toHaveLength(1);   // one probe, no retry
  });
});

describe('client: save, list, get (§10.2, §10.3, §10.5, §10.6)', () => {
  it('save sends the Idempotency-Key and JSON body; a 201 returns the show', async () => {
    const api = fakeApi({ 'POST /api/shows': { status: 201, body: { show: show(), idempotentReplay: false } } });
    const key = newOperationId();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const r = await saveShow(request, key, api.options);
    expect(r.ok && r.value.show.title).toBe('Hello');
    expect(api.calls[0]).toMatchObject({ method: 'POST', url: '/api/shows', headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' } });
    expect(JSON.parse(api.calls[0]!.body!)).toEqual(request);
  });

  it('retries POST at most twice, on network/timeout/503/429 only, with the same key and body', async () => {
    const api = fakeApi({ 'POST /api/shows': ['network', { status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'x' } } }, { status: 200, body: { show: show(), idempotentReplay: true } }] });
    const r = await saveShow(request, 'k1', api.options);
    expect(r.ok && r.value.idempotentReplay).toBe(true);
    expect(api.calls).toHaveLength(3);
    expect(new Set(api.calls.map(c => `${c.headers['Idempotency-Key']}|${c.body}`)).size).toBe(1);
    const failing = fakeApi({ 'POST /api/shows': 'hang' });
    const f = await saveShow(request, 'k2', failing.options);
    expect(f.ok ? 'ok' : [f.code, f.retryable]).toEqual(['TIMEOUT', true]);
    expect(failing.calls).toHaveLength(3);
  });

  it('never retries a definitive failure, and maps the error envelope (code, details) as data', async () => {
    for (const [status, code] of [[400, 'VALIDATION_FAILED'], [409, 'CONFLICT'], [403, 'FORBIDDEN'], [413, 'PAYLOAD_TOO_LARGE']] as const) {
      const api = fakeApi({ 'POST /api/shows': { status, body: { error: { code, message: 'm', details: [{ path: 'title', reason: 'INVALID_FIELD' }, { path: 'x', reason: '<b>' }] } } } });
      const r = await saveShow(request, 'k', api.options);
      expect(r.ok ? 'ok' : [r.status, r.code, r.retryable, r.details]).toEqual([status, code, false, [{ path: 'title', reason: 'INVALID_FIELD' }, { path: 'x', reason: 'INVALID' }]]);
      expect(api.calls).toHaveLength(1);
    }
  });

  it('list re-validates every item per field; a bad field gives the fixed "Invalid saved show"', async () => {
    const api = fakeApi({ 'GET /api/shows': { status: 200, body: { items: [item(), item({ title: '<img src=x onerror=alert(1)>' }), item({ movementCount: 17 }), item({ kinds: ['cube', 'sphere'] }), item({ id: 'nope' }), item({ schemaVersion: 2 }), item({ createdAt: 'yesterday' }), 7], nextCursor: 'abc' } } });
    const r = await listShows(undefined, 20, api.options);
    if (!r.ok) throw new Error('list failed');
    expect(r.value.nextCursor).toBe('abc');
    expect(r.value.items.map(i => [i.title, i.loadable, i.problem ?? null])).toEqual([
      ['Hello', true, null],
      ['<img src=x onerror=alert(1)>', true, null],   // a valid title: it is data, rendered as text (tested below)
      ['Invalid saved show', false, 'invalid'],
      ['Invalid saved show', false, 'invalid'],
      ['Invalid saved show', false, 'invalid'],
      ['Hello', false, 'unsupported-schema'],
      ['Invalid saved show', false, 'invalid'],
      ['Invalid saved show', false, 'invalid'],
    ]);
    expect(api.calls[0]!.url).toBe('/api/shows?limit=20');
  });

  it('get checks the id before any request and retries GET once', async () => {
    const api = fakeApi({ 'GET *': ['network', { status: 200, body: { show: show() } }] });
    expect((await getShow('../../etc', api.options)).ok).toBe(false);
    expect(api.calls).toHaveLength(0);
    const r = await getShow(ID, api.options);
    expect(r.ok).toBe(true);
    expect(api.calls.map(c => c.url)).toEqual([`/api/shows/${ID}`, `/api/shows/${ID}`]);
    expect(summaryOf({}).title).toBe('Invalid saved show');
  });
});

// ---------------------------------------------------------------------------------------------- panel
const params = makeParams(40);
async function mount(routes: Record<string, Reply | Reply[]>, drafts = new Drafts()) {
  const doc = new FakeDocument();
  vi.stubGlobal('document', doc);
  const api = fakeApi(routes);
  let clock = 0;
  const host = doc.createElement('div');
  const panel = createPanel({ host: host as unknown as HTMLElement, drafts, params, client: api.options, now: () => clock });
  await panel.idle();
  await panel.open();
  await panel.idle();
  const el = panel.el as unknown as FakeElement;
  const text = () => el.textContent;
  const button = (label: string) => el.findTag('button').find(b => b.textContent.trim().startsWith(label));
  return { panel, api, el, text, button, drafts, advance: (ms: number) => { clock += ms; } };
}
const healthCalls = (calls: Call[]) => calls.filter(c => c.url === '/api/health').length;

describe('panel: states (§12) with a fake client', () => {
  it('state 7: no gateway; one probe on mount, open within 2 s reuses it, Check again respects the backoff', async () => {
    const p = await mount({ 'GET /api/health': 'network' });
    expect(p.text()).toContain(MESSAGES.unavailable);
    expect(healthCalls(p.api.calls)).toBe(1);   // mount + open within the gap: one probe
    p.button('Check again')!.click(); await p.panel.idle();
    expect(healthCalls(p.api.calls)).toBe(1);   // still within 2 s: no probe
    p.advance(2000); p.button('Check again')!.click(); await p.panel.idle();
    expect(healthCalls(p.api.calls)).toBe(1);   // after a failure the gap doubled to 4 s
    p.advance(2000); p.button('Check again')!.click(); await p.panel.idle();
    expect(healthCalls(p.api.calls)).toBe(2);
    expect(p.button('Save composition')!.hasAttribute('disabled')).toBe(true);
  });

  it('Check again picks up a gateway started later, without a reload', async () => {
    const p = await mount({ 'GET /api/health': ['network', UP], 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } } });
    expect(p.text()).toContain(MESSAGES.unavailable);
    p.advance(5000); p.button('Check again')!.click(); await p.panel.idle();
    expect(p.text()).toContain(MESSAGES.empty);                               // state 3
    expect(p.text()).not.toContain(MESSAGES.unavailable);
  });

  it('state 1: module disabled', async () => {
    const p = await mount({ 'GET /api/health': health({ enabled: false, db: 'disabled', writable: false }) });
    expect(p.text()).toContain(MESSAGES.notConfigured);
    expect(p.button('Check again')).toBeDefined();
  });

  it('read-only: the list and Load as drafts work, Save is disabled with the read-only reason', async () => {
    const p = await mount({ 'GET /api/health': health({ enabled: true, db: 'up', writable: false }), 'GET /api/shows': { status: 200, body: { items: [item()], nextCursor: null } }, [`GET /api/shows/${ID}`]: { status: 200, body: { show: show() } } });
    expect(p.text()).toContain(MESSAGES.readOnly);
    expect(p.button('Save composition')!.hasAttribute('disabled')).toBe(true);
    p.button('Hello')!.click(); await p.panel.idle();
    expect(p.text()).toContain('Hello · 2 movements');                         // state 9
    const before = p.drafts.list.length;
    p.button('Load as drafts')!.click();
    expect(p.drafts.list.length).toBe(before + 2);                            // state 10b
    expect(p.drafts.list.slice(-2).map(d => [d.name, d.kind, d.text])).toEqual([['Hello 1', 'text', 'HELLO'], ['Hello 2', 'sphere', '']]);
    expect(p.text()).toContain('Added 2 drafts to the Composer. Inject each one when you are ready.');
  });

  it('save success (4 → 5): the current draft by default, then the list refreshes', async () => {
    const p = await mount({ 'GET /api/health': UP, 'GET /api/shows': [{ status: 200, body: { items: [], nextCursor: null } }, { status: 200, body: { items: [item({ title: 'Durhack' })], nextCursor: null } }], 'POST /api/shows': { status: 201, body: { show: show({ title: 'Durhack' }), idempotentReplay: false } } });
    expect(p.text()).toContain(MESSAGES.empty);
    p.button('Save composition')!.click(); await p.panel.idle();
    expect(p.text()).toContain('Saved “Durhack”.');
    const sent = JSON.parse(p.api.calls.find(c => c.method === 'POST')!.body!);
    expect(sent).toEqual({ schemaVersion: 1, title: 'Durhack', source: 'manual', composition: { v: 1, movements: [{ recipe: { kind: 'text', text: 'DURHACK', palette: [[0, 0.72, 0.62], [0.98, 0.78, 0.22]] }, holdTicks: 600 }] } });
    expect(p.button('Durhack')).toBeDefined();
  });

  it('6a: a failed save keeps the request; Retry resends the same key and body; an edit discards it', async () => {
    const p = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } }, 'POST /api/shows': [{ status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'x' } } }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 201, body: { show: show(), idempotentReplay: false } }] });
    const draftsBefore = p.drafts.list.map(d => d.id);
    p.button('Save composition')!.click(); await p.panel.idle();
    expect(p.text()).toContain('Not saved: the library is unavailable. Retry sends “Durhack”, 1 movements.');
    expect(p.drafts.list.map(d => d.id)).toEqual(draftsBefore);               // drafts untouched
    p.button('Retry')!.click(); await p.panel.idle();
    expect(p.text()).toContain('Saved “Hello”.'.replace('Hello', 'Durhack'));
    const posts = p.api.calls.filter(c => c.method === 'POST');
    expect(posts).toHaveLength(4);                                            // 3 tries, then Retry
    expect(new Set(posts.map(c => `${c.headers['Idempotency-Key']}|${c.body}`)).size).toBe(1);
  });

  it('an edit after a failed save discards the pending request; the next Save uses a new key', async () => {
    const p = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } }, 'POST /api/shows': [{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 201, body: { show: show(), idempotentReplay: false } }] });
    p.button('Save composition')!.click(); await p.panel.idle();
    expect(p.button('Retry')).toBeDefined();
    const title = p.el.findTag('input').find(i => i.getAttribute('aria-label') === 'Composition title')! as unknown as { value: string; dispatch(t: string): void };
    title.value = 'Renamed'; title.dispatch('input');
    expect(p.button('Retry')).toBeUndefined();
    p.button('Save composition')!.click(); await p.panel.idle();
    const posts = p.api.calls.filter(c => c.method === 'POST');
    expect(new Set(posts.map(c => c.headers['Idempotency-Key'])).size).toBe(2);
    expect(JSON.parse(posts.at(-1)!.body!).title).toBe('Renamed');
  });

  it('6b: 409 offers Save as new; 403 says not allowed and offers no Retry; 400 shows the reasons', async () => {
    const conflict = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } }, 'POST /api/shows': { status: 409, body: { error: { code: 'CONFLICT', message: 'x' } } } });
    conflict.button('Save composition')!.click(); await conflict.panel.idle();
    expect(conflict.text()).toContain(MESSAGES.conflict);
    expect(conflict.button('Save as new')).toBeDefined();
    const forbidden = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } }, 'POST /api/shows': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'x' } } } });
    forbidden.button('Save composition')!.click(); await forbidden.panel.idle();
    expect(forbidden.text()).toContain(MESSAGES.forbidden);
    expect(forbidden.button('Retry')).toBeUndefined();
    const invalid = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [], nextCursor: null } }, 'POST /api/shows': { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'x', details: [{ path: 'title', reason: 'INVALID_FIELD' }] } } } });
    invalid.button('Save composition')!.click(); await invalid.panel.idle();
    expect(invalid.text()).toContain('Not saved: VALIDATION_FAILED.');
    expect(invalid.text()).toContain('title: INVALID_FIELD');
  });

  it('state 8: invalid, newer and not-expandable shows are never loadable; 404 says it no longer exists', async () => {
    const corrupt = show({ composition: { v: 1, movements: [{ recipe: { kind: 'cube' }, holdTicks: 600 }] } });
    const lower = show({ composition: { v: 1, movements: [{ recipe: { kind: 'text', text: 'hello' }, holdTicks: 600 }] } });   // non-canonical when stored
    const routes = { 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [item(), item({ schemaVersion: 2, title: 'Newer' })], nextCursor: null } } };
    for (const [reply, message] of [[{ status: 200, body: { show: corrupt } }, MESSAGES.damaged], [{ status: 200, body: { show: lower } }, MESSAGES.damaged], [{ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }, MESSAGES.gone]] as const) {
      const p = await mount({ ...routes, [`GET /api/shows/${ID}`]: reply });
      p.button('Hello')!.click(); await p.panel.idle();
      expect(p.text()).toContain(message);
      expect(p.button('Load as drafts')).toBeUndefined();
    }
    const p = await mount(routes);
    p.button('Newer')!.click(); await p.panel.idle();
    expect(p.text()).toContain(MESSAGES.newer);
    expect(p.api.calls.some(c => c.url === `/api/shows/${ID}`)).toBe(false);   // a not-loadable item is never fetched
  });

  it('an invalid stored item (loadable:false, fixed title, no stored value) shows "cannot load" and is never fetched or loaded', async () => {
    const p = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [item(), INVALID_ITEM], nextCursor: null } } });
    expect(p.text()).toContain('Hello · 2 movements');
    expect(p.text()).toContain('Invalid saved show · cannot load');
    p.button('Invalid saved show')!.click(); await p.panel.idle();
    expect(p.text()).toContain(MESSAGES.damaged);
    expect(p.button('Load as drafts')).toBeUndefined();
    expect(p.api.calls.some(c => c.url.startsWith('/api/shows/'))).toBe(false);
  });

  it('a disabled module (503 DATABASE_UNAVAILABLE, MODULE_DISABLED) is state 1, never retried', async () => {
    const disabled = { status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'x', details: [{ path: '', reason: 'MODULE_DISABLED' }] } } };
    const listed = await mount({ 'GET /api/health': UP, 'GET /api/shows': disabled });
    expect(listed.text()).toContain(MESSAGES.notConfigured);
    expect(listed.api.calls.filter(c => c.url.startsWith('/api/shows'))).toHaveLength(1);   // GET not retried
    const api = fakeApi({ 'POST /api/shows': disabled });
    const r = await saveShow(request, 'k', api.options);
    expect(r.ok ? 'ok' : [r.code, r.retryable]).toEqual(['DATABASE_UNAVAILABLE', false]);
    expect(api.calls).toHaveLength(1);                                                        // POST not retried
  });

  it('stored strings render as text: a hostile title creates no img or script element', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>x</script>';
    const p = await mount({ 'GET /api/health': UP, 'GET /api/shows': { status: 200, body: { items: [item({ title: hostile.slice(0, 80) })], nextCursor: null } } });
    expect(p.text()).toContain('<img src=x onerror=alert(1)>');
    expect(p.el.findTag('img')).toHaveLength(0);
    expect(p.el.findTag('script')).toHaveLength(0);
  });
});

describe('build flag and banned sinks', () => {
  const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
  it('main.ts mounts the panel only behind VITE_SHOW_LIBRARY === "1", by a dynamic import, in exactly one line', () => {
    const lines = read('src/app/main.ts').split('\n').filter(l => /SavedCompositions|live\//.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^if \(import\.meta\.env\.VITE_SHOW_LIBRARY === '1'\) void import\('\.\/live\/SavedCompositions'\)/);
    expect(read('src/app/main.ts')).not.toMatch(/^import .*live\//m);
  });
  it('the client and panel use no HTML sink (MDB-T22)', () => {
    for (const f of ['src/app/live/shows.ts', 'src/app/live/SavedCompositions.ts']) {
      const code = read(f).replace(/\/\/.*$/gm, '');
      for (const sink of [/\.innerHTML\b/, /\.outerHTML\b/, /\bhtml\s*:/, /\besc\(/, /insertAdjacentHTML/, /document\.write/, /srcdoc/]) expect(code, `${f} ${sink}`).not.toMatch(sink);
    }
  });
  it('no credentials or VITE_* secrets in the client', () => {
    for (const f of ['src/app/live/shows.ts', 'src/app/live/SavedCompositions.ts']) {
      const code = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');   // code, not comments
      expect(code, f).not.toMatch(/MONGODB|mongodb\+srv|import\.meta\.env|apiKey|password/i);
    }
  });
});
