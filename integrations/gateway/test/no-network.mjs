// integrations/gateway/test/no-network.mjs — the gateway test suite's network TRIPWIRE (D3 for Gemini, #218).
// Loaded with `--import` by `npm test` (package.json), so it runs before every test file, in every test process.
//
// Why: once the gemini module is live under GEMINI_ENABLED + GEMINI_API_KEY, a test that started the real gateway
// with those set made real HTTPS requests to Google (twice, with the committed fake key). This makes that impossible:
// the global `fetch`, and `http.request` / `http.get` / `https.request` / `https.get`, refuse every destination except
// loopback (127.0.0.1, ::1, localhost), which the gateway's own tests need to talk to the gateway under test.
// `https` refuses loopback too: nothing in the suite serves TLS. A refusal throws NetworkDisabledInTests.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');

export class NetworkDisabledInTests extends Error {
  constructor(where) {
    super(`network disabled in gateway tests (test/no-network.mjs): ${where}`);
    this.name = 'NetworkDisabledInTests';
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/** The host an http(s).request / fetch argument list targets, or null if it cannot be read (then: refused). */
function hostOf(first, second) {
  try {
    if (typeof first === 'string' || first instanceof URL) return new URL(String(first)).hostname;
    if (first && typeof first === 'object') {
      if (typeof first.url === 'string') return new URL(first.url).hostname;          // a fetch Request
      return String(first.hostname ?? first.host ?? 'localhost').replace(/:\d+$/, ''); // request options
    }
    if (second && typeof second === 'object') return String(second.hostname ?? second.host ?? 'localhost');
  } catch {
    return null;
  }
  return null;
}

const isLoopback = host => host !== null && LOOPBACK.has(host);

const originalFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  const host = hostOf(input);
  if (!isLoopback(host)) return Promise.reject(new NetworkDisabledInTests(`fetch to ${host ?? 'an unreadable target'}`));
  return originalFetch(input, init);
};

for (const [name, mod, allowLoopback] of [['http', http, true], ['https', https, false]]) {
  for (const method of ['request', 'get']) {
    const original = mod[method];
    mod[method] = function guarded(...args) {
      const host = hostOf(args[0], args[1]);
      if (!(allowLoopback && isLoopback(host))) throw new NetworkDisabledInTests(`${name}.${method} to ${host ?? 'an unreadable target'}`);
      return original.apply(this, args);
    };
  }
}
// Make `import { request } from 'node:http'` (ESM named imports) see the guarded functions too.
syncBuiltinESMExports();
