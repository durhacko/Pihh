// integrations/gateway/test/no-network.mjs — the gateway test suite's network TRIPWIRE (D3 for Gemini, #218).
//
// Why: once the gemini module is live under GEMINI_ENABLED + GEMINI_API_KEY, a test that started the real gateway
// with those set made real HTTPS requests to Google (twice, with the committed fake key). This makes that impossible.
//
// How it is loaded, so that no way of running a test skips it:
//   - `npm test` loads it with `--import` (package.json), before every test file, in every test process;
//   - every test file that can reach the real gemini module (test/noNetwork.test.ts walks the import graph and
//     enforces this) imports it as its FIRST import, so `node --test <file>` or an IDE run gets it too. First, because
//     src/gemini/module.ts captures `fetch` when it is evaluated;
//   - it appends itself to NODE_OPTIONS, so a `node` child process that inherits the environment loads it as well.
// It installs once per process (a global marker), however many times it is imported.
//
// What it refuses (throws or rejects NetworkDisabledInTests, and counts the refusal):
//   - global `fetch` and `WebSocket`: any destination except loopback http;
//   - `http.request` / `http.get` / `new http.ClientRequest`: any host except loopback. The host is the one Node
//     would use: `hostname || host` of the URL's options merged with the given ones (so a URL's hostname beats an
//     options `host`). A request that names no host (Node would default to localhost), or brings its own
//     `socketPath`, `createConnection` or `lookup`, is refused;
//   - `https.request` / `https.get`, `tls.connect`: always (nothing in the suite serves TLS);
//   - `http2.connect`: anything but an `http:` loopback authority;
//   - every TCP connect, whoever starts it: `net.connect` / `net.createConnection` and `net.Socket.prototype.connect`
//     (the chokepoint under http, undici's fetch and tls): loopback hosts only; IPC/Unix paths and a missing host
//     are refused.
//   - `worker_threads.Worker`: every Worker gets this file in its execArgv; `eval: true` Workers are refused.
// Loopback = 127.0.0.1, ::1 (or [::1]) and localhost, exactly. Other loopback spellings (127.1, ::ffff:127.0.0.1,
// 'localhost.') are refused: over-strict, never a bypass.
//
// KNOWN GAPS (not network-proof): child processes that are not `node`, or that are given an explicit `env` without
// NODE_OPTIONS (test/tiger/importer.test.ts spawns node and inherits the environment, so it is covered;
// test/gemini/geminiLive.test.ts spawns bash and passes NODE_OPTIONS on); DNS lookups (`dns.*`, which send only a
// name) and UDP (`dgram`).
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);

export class NetworkDisabledInTests extends Error {
  constructor(where) {
    super(`network disabled in gateway tests (test/no-network.mjs): ${where}`);
    this.name = 'NetworkDisabledInTests';
  }
}

const MARK = Symbol.for('encore.gateway.noNetwork');
const REFUSALS = Symbol.for('encore.gateway.noNetwork.refusals');
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** A host as Node would compare it: lower case, IPv6 brackets removed. Anything else is not a host (null). */
function normalHost(value) {
  if (typeof value !== 'string' || value === '') return null;
  const host = value.toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

const isLoopback = host => host !== null && LOOPBACK.has(host);

function refuse(where) {
  globalThis[REFUSALS] = (globalThis[REFUSALS] ?? 0) + 1;
  return new NetworkDisabledInTests(where);
}

/** The URL's hostname, or null if it is not a URL. */
function urlHost(value) {
  try {
    return normalHost(new URL(String(value)).hostname);
  } catch {
    return null;
  }
}

/** The host an http(s).request / ClientRequest argument list targets, exactly as Node resolves it, or null when it
 *  names none or brings its own transport. Node merges the URL's options (which carry `hostname`, never `host`) with
 *  the given options, then uses `hostname || host || 'localhost'`. So with a URL, the URL's hostname wins unless the
 *  options set `hostname`; `host` counts only without a URL or hostname. A missing host is refused (null). */
function requestHost(args) {
  const [first, second] = args;
  let merged;
  if (typeof first === 'string' || first instanceof URL) {
    let url;
    try { url = new URL(String(first)); } catch { return null; }
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    merged = { hostname, ...(second !== null && typeof second === 'object' ? second : {}) };
  } else if (first !== null && typeof first === 'object') {
    merged = first;
  } else {
    return null;
  }
  if (merged.socketPath != null || typeof merged.createConnection === 'function' || typeof merged.lookup === 'function') return null;
  const host = merged.hostname || merged.host;
  return host ? normalHost(String(host)) : null;
}

/** The host a socket connect targets (net.connect / Socket#connect argument lists, normalised or not), or null. */
function connectHost(args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];                         // net's internal normalised form
  if (options !== null && typeof options === 'object') {
    if (options.path != null) return null;                                   // IPC / Unix socket
    const host = normalHost(options.host == null ? '' : String(options.host));
    if (typeof options.lookup === 'function' && host !== '127.0.0.1' && host !== '::1') return null;
    return host;
  }
  if (typeof options === 'number' || (typeof options === 'string' && /^\d+$/.test(options))) {
    return normalHost(typeof args[1] === 'string' ? args[1] : '');
  }
  return null;                                                               // a path string, or unreadable
}

/** The flag that loads this file in another process or thread. A file URL has no spaces to quote. */
const FLAG = `--import=${import.meta.url}`;

/** Flags that take their value as the next argument when written without `=`. */
const VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--conditions', '-C', '--disable-warning']);

/** True if an execArgv list preloads this file (`--import=<url or path>` or `--import <url or path>`). */
function loadsTripwire(argv) {
  const { pathToFileURL } = require('node:url');
  for (let i = 0; i < argv.length; i++) {
    let value = null;
    if (argv[i].startsWith('--import=')) value = argv[i].slice('--import='.length);
    else if (argv[i] === '--import' && i + 1 < argv.length) value = argv[i + 1];
    if (value === null) continue;
    try {
      const href = value.startsWith('file:') ? new URL(value).href : pathToFileURL(require('node:path').resolve(value)).href;
      if (href === import.meta.url) return true;
    } catch { /* not this file */ }
  }
  return false;
}

/** The part of an execArgv list a Worker accepts and needs to load code as its parent does (module loaders, imports,
 *  experimental and warning switches); the rest (V8, TLS, snapshot flags) is dropped, as Node refuses it for Workers. */
function workerSafeArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.split('=')[0];
    if (!(VALUE_FLAGS.has(name) || /^--(no-)?experimental-[a-z0-9-]+$/.test(name))) continue;
    out.push(arg);
    if (!arg.includes('=') && VALUE_FLAGS.has(arg) && i + 1 < argv.length) out.push(argv[++i]);
  }
  return out;
}

function install() {
  const http = require('node:http');
  const https = require('node:https');
  const http2 = require('node:http2');
  const net = require('node:net');
  const tls = require('node:tls');
  const workerThreads = require('node:worker_threads');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    const url = input !== null && typeof input === 'object' && !(input instanceof URL) && typeof input.url === 'string' ? input.url : input;
    let protocol = null;
    try { protocol = new URL(String(url)).protocol; } catch { /* refused below */ }
    const host = urlHost(url);
    if (protocol !== 'http:' || !isLoopback(host)) return Promise.reject(refuse(`fetch to ${host ?? 'an unreadable target'}`));
    return originalFetch(input, init);
  };

  if (typeof globalThis.WebSocket === 'function') {
    globalThis.WebSocket = function GuardedWebSocket() { throw refuse('WebSocket'); };
  }

  for (const [name, mod, allowLoopback] of [['http', http, true], ['https', https, false]]) {
    for (const method of ['request', 'get']) {
      const original = mod[method];
      mod[method] = function guarded(...args) {
        const host = requestHost(args);
        if (!(allowLoopback && isLoopback(host))) throw refuse(`${name}.${method} to ${host ?? 'an unnamed or custom target'}`);
        return original.apply(this, args);
      };
    }
  }

  const OriginalClientRequest = http.ClientRequest;
  http.ClientRequest = class GuardedClientRequest extends OriginalClientRequest {
    // `http.request` builds the original class internally; `instanceof http.ClientRequest` must stay true for those.
    static [Symbol.hasInstance](value) { return value instanceof OriginalClientRequest; }
    constructor(...args) {
      const host = requestHost(args);
      if (!isLoopback(host)) throw refuse(`new http.ClientRequest to ${host ?? 'an unnamed or custom target'}`);
      super(...args);
    }
  };

  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const host = connectHost(args);
    if (!isLoopback(host)) throw refuse(`socket connect to ${host ?? 'a path or unnamed host'}`);
    return originalConnect.apply(this, args);
  };
  for (const method of ['connect', 'createConnection']) {
    const original = net[method];
    net[method] = function guardedNetConnect(...args) {
      const host = connectHost(args);
      if (!isLoopback(host)) throw refuse(`net.${method} to ${host ?? 'a path or unnamed host'}`);
      return original.apply(this, args);
    };
  }

  tls.connect = function guardedTlsConnect() { throw refuse('tls.connect'); };

  const originalHttp2Connect = http2.connect;
  http2.connect = function guardedHttp2Connect(authority, ...rest) {
    let protocol = null;
    try { protocol = new URL(String(authority)).protocol; } catch { /* refused below */ }
    const host = urlHost(authority);
    if (protocol !== 'http:' || !isLoopback(host)) throw refuse(`http2.connect to ${host ?? 'an unreadable target'}`);
    return originalHttp2Connect.call(this, authority, ...rest);
  };

  // Worker threads have their own globals and built-ins, and do not re-read NODE_OPTIONS: every Worker gets this file
  // in its execArgv (whatever execArgv it was given), and an `eval: true` Worker, which cannot load it first, is refused.
  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class GuardedWorker extends OriginalWorker {
    static [Symbol.hasInstance](value) { return value instanceof OriginalWorker; }
    constructor(filename, options = {}) {
      const opts = options !== null && typeof options === 'object' ? options : {};
      if (opts.eval) throw refuse('a Worker with eval: true (it cannot load the tripwire first)');
      let execArgv;
      if (Array.isArray(opts.execArgv)) execArgv = loadsTripwire(opts.execArgv) ? opts.execArgv : [...opts.execArgv, FLAG];
      else if (!loadsTripwire(process.execArgv)) execArgv = [...workerSafeArgs(process.execArgv), FLAG];
      // Otherwise the Worker inherits process.execArgv, which already loads the tripwire (the npm test path).
      super(filename, execArgv === undefined ? opts : { ...opts, execArgv });
    }
  };

  // Make ESM named imports (`import { request } from 'node:http'`) see the guarded functions too.
  syncBuiltinESMExports();

  // A `node` child process that inherits the environment loads this file too.
  const current = process.env.NODE_OPTIONS ?? '';
  if (!current.split(/\s+/).includes(FLAG)) process.env.NODE_OPTIONS = current === '' ? FLAG : `${current} ${FLAG}`;

  globalThis[REFUSALS] = 0;
  globalThis[MARK] = true;
}

if (globalThis[MARK] !== true) install();
