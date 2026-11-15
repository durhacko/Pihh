// The tripwire (test/no-network.mjs) is really in force, however this file is run (`npm test`, `node --test` on this
// file alone, an IDE): every outbound route it guards throws, loopback still works, node child processes and worker
// threads inherit it, the live gemini module enabled with the flag and a (fake) key cannot reach the network, and every
// test file that can reach the real gemini module loads the tripwire first.
import './no-network.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ClientRequest, get as httpGet, request as httpRequest } from 'node:http';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import { connect as http2Connect } from 'node:http2';
import { connect as netConnect, createConnection, Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Worker } from 'node:worker_threads';
// The root repo's TypeScript (as test/offline.test.ts uses it); the gateway package itself has no dependencies.
import ts from 'typescript';
import { startGateway } from '../src/server.ts';
import { createModule, type LastUpstream } from '../src/gemini/module.ts';

assert.equal(fetch.name, 'guardedFetch', 'the network tripwire (test/no-network.mjs) is not in force');

const KEY = 'test-key-not-real-0123456789';
const REFUSED = { name: 'NetworkDisabledInTests' } as const;
const refusals = (): number => (globalThis as unknown as Record<symbol, number>)[Symbol.for('encore.gateway.noNetwork.refusals')] ?? 0;
const TRIPWIRE_URL = new URL('./no-network.mjs', import.meta.url).href;

test('fetch: anything but loopback http rejects (https, outside hosts, Request objects, https loopback)', async () => {
  await assert.rejects(fetch('https://generativelanguage.googleapis.com/v1beta/models'), REFUSED);
  await assert.rejects(fetch(new URL('http://example.com/')), REFUSED);
  await assert.rejects(fetch(new Request('https://example.com/')), REFUSED);
  await assert.rejects(fetch('https://127.0.0.1:1/'), REFUSED);
  await assert.rejects(fetch('not a url'), REFUSED);
});

test('http(s).request / get: the host Node would use decides (URL hostname beats options.host; hostname beats host); no host is refused', () => {
  assert.throws(() => httpRequest({ host: 'example.com', path: '/' }), REFUSED);
  assert.throws(() => httpRequest('http://93.184.216.34/'), REFUSED);
  assert.throws(() => httpRequest('http://192.0.2.1/', { host: '127.0.0.1' }), REFUSED, 'Node connects to the URL hostname, not options.host');
  assert.throws(() => httpRequest('http://127.0.0.1/', { hostname: 'example.com' }), REFUSED, 'options.hostname overrides the URL');
  assert.throws(() => httpRequest({ hostname: 'example.com', host: '127.0.0.1' }), REFUSED, 'hostname wins over host');
  assert.throws(() => httpRequest({ port: 1, path: '/' }), REFUSED, 'no host at all (Node would default to localhost) is refused');
  assert.throws(() => httpRequest({ host: '127.0.0.1', socketPath: '/tmp/x.sock' }), REFUSED);
  assert.throws(() => httpRequest({ host: '127.0.0.1', createConnection: () => new Socket() }), REFUSED);
  assert.throws(() => httpRequest({ host: 'localhost', lookup: () => {} }), REFUSED, 'a custom lookup could map localhost anywhere');
  assert.throws(() => httpGet('http://example.com/'), REFUSED);
  assert.throws(() => httpsRequest('https://generativelanguage.googleapis.com/'), REFUSED);
  assert.throws(() => httpsGet({ hostname: '127.0.0.1', port: 1 }), REFUSED, 'https refuses even loopback');
  // A loopback URL with an outside options.host goes to the URL's 127.0.0.1, as Node does: allowed (port 9, refused).
  const req = httpRequest('http://127.0.0.1:9/', { host: 'example.com' });
  req.on('error', () => {});
  req.destroy();
});

test('new http.ClientRequest is guarded the same way, and instanceof still holds for requests http.request makes', () => {
  assert.throws(() => new ClientRequest({ host: 'example.com', path: '/' }), REFUSED);
  assert.throws(() => new ClientRequest('http://example.com/'), REFUSED);
  const req = httpRequest({ host: '127.0.0.1', port: 9, path: '/' });
  req.on('error', () => {});
  assert.ok(req instanceof ClientRequest);
  req.destroy();
});

test('raw sockets: net.connect / createConnection / Socket#connect to outside, unnamed or path targets, tls and http2 all throw', () => {
  assert.throws(() => netConnect({ host: 'example.com', port: 80 }), REFUSED);
  assert.throws(() => netConnect(80, '93.184.216.34'), REFUSED);
  assert.throws(() => netConnect(80), REFUSED, 'a port without a host is refused');
  assert.throws(() => createConnection({ host: 'example.com', port: 443 }), REFUSED);
  assert.throws(() => netConnect({ path: '/tmp/x.sock' }), REFUSED);
  assert.throws(() => new Socket().connect(443, '142.250.0.1'), REFUSED, 'the chokepoint under http, fetch and tls');
  assert.throws(() => new Socket().connect({ host: 'localhost', port: 1, lookup: () => {} }), REFUSED);
  assert.throws(() => tlsConnect({ host: '127.0.0.1', port: 1 }), REFUSED);
  assert.throws(() => http2Connect('https://generativelanguage.googleapis.com'), REFUSED);
  assert.throws(() => http2Connect('http://example.com'), REFUSED);
  if (typeof globalThis.WebSocket === 'function') assert.throws(() => new WebSocket('wss://example.com/'), REFUSED);
});

test('loopback still works: the gateway under test answers on 127.0.0.1 (fetch and http.request)', async () => {
  const g = await startGateway({ GATEWAY_ALLOWED_ORIGINS: 'http://localhost:5173' }, { port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${g.port}/api/health`, { headers: { host: `127.0.0.1:${g.port}` } });
    assert.equal(r.status, 200);
    const status = await new Promise<number>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port: g.port, path: '/api/health', headers: { host: `127.0.0.1:${g.port}` } }, res => { res.resume(); done(res.statusCode ?? 0); });
      req.on('error', fail);
      req.end();
    });
    assert.equal(status, 200);
  } finally {
    await g.close();
  }
});

test('a node child process that inherits the environment loads the tripwire too (NODE_OPTIONS)', () => {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(fetch.name)'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'guardedFetch');
});

/** A worker file that reports what it sees, in a fresh temp dir. */
function workerFixture(): { dir: string; worker: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-worker-'));
  const worker = join(dir, 'w.mjs');
  writeFileSync(worker, "import { parentPort } from 'node:worker_threads';\nimport net from 'node:net';\nparentPort.postMessage(`${fetch.name} ${net.Socket.prototype.connect.name}`);\n");
  return { dir, worker };
}

test('worker threads: a Worker (default options or an explicit execArgv) gets the tripwire; an eval Worker is refused', async () => {
  const { dir, worker } = workerFixture();
  try {
    for (const options of [{}, { execArgv: [] as string[] }]) {
      const w = new Worker(worker, options);
      const seen = await new Promise<string>((done, fail) => { w.once('message', done); w.once('error', fail); });
      await w.terminate();
      assert.equal(seen, 'guardedFetch guardedSocketConnect', JSON.stringify(options));
    }
    assert.throws(() => new Worker('fetch("https://example.com")', { eval: true }), REFUSED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('worker threads also get it when the tripwire came only from a static first import (the node --test <file> / IDE path)', () => {
  const { dir, worker } = workerFixture();
  try {
    const main = join(dir, 'main.mjs');
    writeFileSync(main, `import ${JSON.stringify(TRIPWIRE_URL)};\nimport { Worker } from 'node:worker_threads';\nconst w = new Worker(${JSON.stringify(worker)});\nw.once('message', m => { process.stdout.write(m); w.terminate(); });\n`);
    const env = { ...process.env };
    delete env.NODE_OPTIONS;   // no preload: only the static import loads the tripwire in this process
    const child = spawnSync(process.execPath, [main], { encoding: 'utf8', env, timeout: 20_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'guardedFetch guardedSocketConnect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the live gemini module (flag + key) cannot reach the network in tests: exactly one refusal, lastUpstream status 0', async () => {
  const module = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.equal(module.health().enabled, true);
  const route = module.routes[0]!;
  const before = refusals();
  const reply = await route.handle({ rawBody: JSON.stringify({ prompt: 'a white sphere', mode: 'scene3d' }) } as Parameters<typeof route.handle>[0]);
  const text = JSON.stringify(reply);
  assert.ok(text.includes('PROVIDER_ERROR'), text.slice(0, 300));   // the refused transport is an upstream failure, never a call
  assert.ok(!text.includes(KEY));
  assert.equal(refusals() - before, 1, 'the one provider attempt was refused by the tripwire (not by a real network failure)');
  const last = (module.health() as { lastUpstream?: LastUpstream }).lastUpstream;
  assert.equal(last?.httpStatus, 0, 'no HTTP status: nothing was sent');
});

// ---- every test file that can reach the real gemini module loads the tripwire FIRST and checks it is in force ----
// Parsed with the TypeScript AST (no regexes over source): every import and `export ... from` in order, plus dynamic
// `import()`, `require` and `createRequire`, which make a file count as reaching the module (fail closed).

const gateway = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRIPWIRE = join(gateway, 'test/no-network.mjs');
const LIVE_TARGETS = ['src/gemini/module.ts', 'src/gemini/geminiProvider.ts'].map(p => join(gateway, p));
const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS, '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS, '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS,
};

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

interface ModuleRequest { readonly spec: string; readonly evaluates: boolean; readonly sideEffectOnly: boolean }

/** The module requests of a source text, in evaluation order (type-only ones marked as not evaluated), and whether
 *  it loads anything dynamically (import(), require, createRequire). */
function moduleRequests(text: string, kind: ts.ScriptKind = ts.ScriptKind.TS): { requests: ModuleRequest[]; dynamic: boolean } {
  const source = ts.createSourceFile('x', text, ts.ScriptTarget.Latest, true, kind);
  const requests: ModuleRequest[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      requests.push({ spec: statement.moduleSpecifier.text, evaluates: !statement.importClause?.isTypeOnly, sideEffectOnly: !statement.importClause });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      requests.push({ spec: statement.moduleSpecifier.text, evaluates: !statement.isTypeOnly, sideEffectOnly: false });
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
      const expr = statement.moduleReference.expression;
      requests.push({ spec: ts.isStringLiteral(expr) ? expr.text : '', evaluates: !statement.isTypeOnly, sideEffectOnly: false });
    }
  }
  let dynamic = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) dynamic = true;
      else if (ts.isIdentifier(callee) && (callee.text === 'require' || callee.text === 'createRequire')) dynamic = true;
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire') dynamic = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { requests, dynamic };
}

/** A specifier resolved as Node resolves a relative or file one (query and hash dropped), or null for a bare one. */
function resolveSpec(spec: string, from: string): string | null {
  if (!(spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('file:'))) return null;
  const url = new URL(spec, pathToFileURL(from));
  url.search = '';
  url.hash = '';
  return fileURLToPath(url);
}

/** True if `file`'s runtime import graph, inside the gateway package, reaches one of LIVE_TARGETS, or loads anything
 *  dynamically, or imports a gateway file that cannot be found or parsed (all fail closed). */
function reachesLive(file: string, seen = new Set<string>()): boolean {
  if (LIVE_TARGETS.includes(file)) return true;
  if (file === TRIPWIRE || seen.has(file) || !file.startsWith(gateway)) return false;
  seen.add(file);
  const kind = SCRIPT_KINDS[extname(file)];
  if (kind === undefined) return extname(file) !== '.json';
  if (!existsSync(file)) return true;
  const { requests, dynamic } = moduleRequests(readFileSync(file, 'utf8'), kind);
  if (dynamic) return true;
  return requests.some(r => {
    if (!r.evaluates) return false;
    const target = resolveSpec(r.spec, file);
    return target !== null && reachesLive(target, seen);
  });
}

test('the import scan: evaluation order, export-from, same-line imports, string names, query suffixes and dynamic loads', () => {
  const sample = [
    "import type { A } from './a.ts';",
    "export * from './b.ts'; import { 'quoted' as q } from './c.ts?x=1#h';",
    "import {\n  type D,\n} from './d.ts';",
    "export type { E } from './e.ts';",
    "export { f } from './f.mjs';",
    "import './g.mjs';",
    "const s = '/* not a comment'; import { h } from './h.ts'; const t = '*/';",
    "import x from 'node:fs';",
  ].join('\n');
  const { requests, dynamic } = moduleRequests(sample);
  assert.deepEqual(requests.filter(r => r.evaluates).map(r => r.spec), ['./b.ts', './c.ts?x=1#h', './d.ts', './f.mjs', './g.mjs', './h.ts', 'node:fs']);
  assert.deepEqual(requests.filter(r => !r.evaluates).map(r => r.spec), ['./a.ts', './e.ts']);
  assert.equal(dynamic, false);
  assert.equal(moduleRequests("const m = await import('./x.ts');").dynamic, true);
  assert.equal(moduleRequests("import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);").dynamic, true);
  assert.equal(resolveSpec('./c.ts?x=1#h', '/g/test/a.test.ts'), '/g/test/c.ts');
  assert.equal(resolveSpec('node:fs', '/g/test/a.test.ts'), null);
});

test('every test file that can reach the real gemini module evaluates the tripwire FIRST and asserts it is in force', () => {
  const reaching = testFiles(join(gateway, 'test')).filter(file => reachesLive(file));
  const names = reaching.map(file => relative(gateway, file).replaceAll('\\', '/'));
  for (const expected of ['test/noNetwork.test.ts', 'test/server.test.ts', 'test/gemini/e2e.test.ts', 'test/gemini/module.test.ts']) {
    assert.ok(names.includes(expected), `the scan should find ${expected} (found: ${names.join(', ')})`);
  }
  const problems: string[] = [];
  for (const file of reaching) {
    const name = relative(gateway, file).replaceAll('\\', '/');
    const text = readFileSync(file, 'utf8');
    const first = moduleRequests(text).requests.find(r => r.evaluates);
    const firstIsTripwire = first !== undefined && first.sideEffectOnly && resolveSpec(first.spec, file) === TRIPWIRE;
    if (!firstIsTripwire) problems.push(`${name}: the first evaluated import must be the tripwire, not: ${first?.spec ?? '(none)'}`);
    const check = text.indexOf("assert.equal(fetch.name, 'guardedFetch'");
    const firstTest = text.search(/(?:^|\n)test\(/);
    if (check < 0 || (firstTest >= 0 && check > firstTest)) problems.push(`${name}: assert fetch.name === 'guardedFetch' before the first test`);
  }
  assert.deepEqual(problems, []);
});
