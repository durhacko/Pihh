// Lane 3: the narrow dev-server proxy to the gateway (vite.config.ts). A real Vite dev server with this config, and a
// stub gateway that records what reaches it: exactly GET /api/health and POST /api/generate-formation are forwarded;
// nothing else under /api is; Host becomes 127.0.0.1:<GATEWAY_PORT> (what the gateway's Host check allows); the
// browser's Origin and Authorization pass through unchanged (the guard still judges them); preview and build have no proxy.
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import config, { GATEWAY_PROXY_PATHS, gatewayTarget } from '../vite.config';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listen = (server: Server) => new Promise<number>(res => server.listen(0, '127.0.0.1', () => res((server.address() as AddressInfo).port)));

describe('the gateway proxy config', () => {
  it('has exactly the two full-path rules, on the dev server only', () => {
    const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {};
    expect(Object.keys(proxy)).toEqual([...GATEWAY_PROXY_PATHS]);
    const matches = (path: string) => Object.keys(proxy).some(key => new RegExp(key).test(path));
    for (const path of ['/api/health', '/api/health?x=1', '/api/generate-formation']) expect(matches(path), path).toBe(true);
    for (const path of ['/api/shows', '/api/shows/0123', '/api/runs', '/api/healthz', '/api/health/x', '/api/generate-formation/x', '/api', '/x/api/health', '/']) expect(matches(path), path).toBe(false);
    expect((config as { preview?: { proxy?: unknown } }).preview?.proxy).toBeUndefined();
    expect((config as { build?: unknown }).build).toBeUndefined();
  });

  it('targets 127.0.0.1 on GATEWAY_PORT (default 8787) and never a remote host', () => {
    expect(gatewayTarget({})).toBe('http://127.0.0.1:8787');
    expect(gatewayTarget({ GATEWAY_PORT: '9123' })).toBe('http://127.0.0.1:9123');
    for (const bad of ['', 'x', '0', '70000', '80; rm', 'evil.example:80']) expect(gatewayTarget({ GATEWAY_PORT: bad })).toBe('http://127.0.0.1:8787');
  });
});

describe('a real Vite dev server forwards exactly the two paths to a stub gateway', () => {
  const seen: { method: string; url: string; headers: IncomingHttpHeaders }[] = [];
  let stub: Server;
  let vite: ViteDevServer;
  let base = '';
  let gatewayPort = 0;
  const previous = process.env.GATEWAY_PORT;

  beforeAll(async () => {
    stub = createHttpServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ stub: true }));
    });
    gatewayPort = await listen(stub);
    process.env.GATEWAY_PORT = String(gatewayPort);
    const probe = createHttpServer();
    const devPort = await listen(probe);
    await new Promise(res => probe.close(res));
    vite = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'silent', server: { host: '127.0.0.1', port: devPort, strictPort: true, hmr: false } });
    await vite.listen();
    base = `http://127.0.0.1:${devPort}`;
  }, 60_000);

  afterAll(async () => {
    await vite?.close();
    await new Promise(res => stub?.close(res));
    if (previous === undefined) delete process.env.GATEWAY_PORT; else process.env.GATEWAY_PORT = previous;
  });

  it('GET /api/health and POST /api/generate-formation reach the gateway with its Host, the browser Origin and the token', async () => {
    seen.length = 0;
    const health = await fetch(`${base}/api/health`);
    expect(await health.json()).toEqual({ stub: true });
    const origin = base;   // the dev origin, as a same-origin browser request sends it
    const gen = await fetch(`${base}/api/generate-formation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer typed-by-user' }, body: '{"prompt":"x"}',
    });
    expect(await gen.json()).toEqual({ stub: true });
    expect(seen.map(s => `${s.method} ${s.url}`)).toEqual(['GET /api/health', 'POST /api/generate-formation']);
    for (const s of seen) expect(s.headers.host).toBe(`127.0.0.1:${gatewayPort}`);
    expect(seen[1]?.headers.origin).toBe(origin);
    expect(seen[1]?.headers.authorization).toBe('Bearer typed-by-user');
  });

  it('never rewrites a foreign Origin: it reaches the gateway as sent, so the guard refuses it there', async () => {
    seen.length = 0;
    await fetch(`${base}/api/generate-formation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    expect(seen[0]?.headers.origin).toBe('https://evil.example');
  });

  it('forwards nothing else under /api', async () => {
    seen.length = 0;
    for (const path of ['/api/shows', '/api/shows/0123456789abcdef01234567', '/api/runs', '/api/healthz', '/api/generate-formation/x']) await (await fetch(`${base}${path}`)).arrayBuffer();
    await (await fetch(`${base}/api/shows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).arrayBuffer();
    expect(seen).toEqual([]);
  });
});
