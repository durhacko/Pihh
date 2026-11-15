// integrations/gateway/src/server.ts
// The one server of the optional gateway (OPTIONAL_INTEGRATION_BOUNDARIES.md §6.2, XI-12, XI-20) and its entry point.
// Skeleton-owned. It is the only file that imports `node:http`, and only `createServer`: it accepts local requests,
// it never makes one. Modules never build their own HTTP stack.
//
// Per request: collect the facts, run the shared guard, read the body (counted while streaming, capped, strict
// UTF-8), hand it to the router, and write the JSON response. No CORS headers (OIB-Q2 undecided).
//
// Run: `npm start` in integrations/gateway (Node >= 22.12, type stripping). Environment only; nothing is loaded
// from a file.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOPBACK, type Env } from './config.ts';
import { errorResponse, sanitise, type RouteResponse } from './errors.ts';
import { guardRequest, type GuardSettings, type RequestFacts } from './guard.ts';
import type { ModuleEntry } from './modules.ts';
import { buildGateway, type Gateway } from './router.ts';

export interface RunningGateway {
  readonly url: string;
  readonly port: number;
  /** The per-launch token, or null when none is required. Printed once at start; never logged again. */
  readonly token: string | null;
  readonly gateway: Gateway;
  readonly server: Server;
  close(): Promise<void>;
}

export interface StartOptions {
  /** Overrides `GATEWAY_PORT` (tests use 0 for any free port). */
  readonly port?: number;
  /** Overrides the module registry (tests). */
  readonly registry?: readonly ModuleEntry[];
  /** Receives one entry per finished request (the entry point prints them). Defaults to no logging. */
  readonly log?: AccessLog;
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

function send(res: ServerResponse, response: RouteResponse<unknown>, close = false): void {
  let status = response.status;
  let text: string;
  try {
    text = JSON.stringify(response.body);
    if (typeof text !== 'string' || !Number.isInteger(status) || status < 100 || status > 599) throw new Error('bad response');
  } catch {
    const fallback = errorResponse('INTERNAL', 'The response could not be written.');
    status = fallback.status;
    text = JSON.stringify(fallback.body);
  }
  res.writeHead(status, { ...HEADERS, 'content-length': Buffer.byteLength(text), ...(close ? { connection: 'close' } : {}) });
  res.end(text);
}

type Body = { ok: true; text: string } | { ok: false; response: RouteResponse<unknown>; close: boolean };

/** Reads the body, counting bytes as they arrive. Over the cap it stops buffering and answers 413. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Body> {
  return new Promise(done => {
    const chunks: Buffer[] = [];
    let total = 0;
    let finished = false;
    const finish = (body: Body) => {
      if (!finished) {
        finished = true;
        done(body);
      }
    };
    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      total += chunk.length;
      if (total > maxBytes) {
        chunks.length = 0;
        finish({ ok: false, close: true, response: errorResponse('PAYLOAD_TOO_LARGE', 'The request body is too large.', { details: [{ path: '', reason: 'REQUEST_TOO_LARGE' }] }) });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        finish({ ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) });
      } catch {
        finish({ ok: false, close: false, response: errorResponse('VALIDATION_FAILED', 'The request body is not valid UTF-8.', { details: [{ path: '', reason: 'INVALID_JSON' }] }) });
      }
    });
    req.on('error', () => finish({ ok: false, close: true, response: errorResponse('VALIDATION_FAILED', 'The request body could not be read.', { details: [{ path: '', reason: 'BAD_REQUEST' }] }) }));
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

/** One access-log entry (spec §10.3 "Logging", GF-T33 (8)). The gateway's own id, never the client's `requestId`;
 *  the path without its query; no body, header, prompt or key. */
export interface AccessEntry {
  readonly serverId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ms: number;
}
export type AccessLog = (entry: AccessEntry) => void;

function logPath(url: string): string {
  const q = url.indexOf('?');
  return sanitise(q === -1 ? url : url.slice(0, q)).slice(0, 120);
}

/** The request listener: guard, body, router. Exported for tests; `settings` is read per request. Each request
 *  gets a server id (`g-1`, `g-2`, …) that goes to `log` when its response finishes. */
export function requestListener(gateway: Gateway, settings: () => GuardSettings, log: AccessLog = () => {}) {
  let next = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const serverId = `g-${++next}`;
    const started = Date.now();
    res.on('finish', () => {
      try {
        log({ serverId, method: sanitise(req.method ?? '').slice(0, 16), path: logPath(req.url ?? ''), status: res.statusCode, ms: Date.now() - started });
      } catch {
        // A failing logger never affects a response.
      }
    });
    try {
      const facts: RequestFacts = {
        method: req.method ?? '',
        url: req.url ?? '',
        remoteAddress: req.socket.remoteAddress,
        host: header(req, 'host'),
        origin: header(req, 'origin'),
        contentType: header(req, 'content-type'),
        contentLength: header(req, 'content-length'),
        transferEncoding: header(req, 'transfer-encoding'),
        authorization: header(req, 'authorization'),
      };
      const current = settings();
      const rejected = guardRequest(facts, current);
      if (rejected) {
        send(res, rejected, true);
        res.on('finish', () => req.destroy());
        return;
      }
      const body = await readBody(req, current.maxBodyBytes);
      if (!body.ok) {
        send(res, body.response, body.close);
        if (body.close) res.on('finish', () => req.destroy());
        return;
      }
      send(res, await gateway.handle({ method: facts.method, url: facts.url, rawBody: body.text }));
    } catch {
      if (!res.headersSent) send(res, errorResponse('INTERNAL', 'The gateway failed to handle the request.'), true);
      else res.destroy();
    }
  };
}

/** Builds the gateway from `env` and listens on 127.0.0.1 only. Refuses any other bind address. */
export async function startGateway(env: Env, options: StartOptions = {}): Promise<RunningGateway> {
  const gateway = buildGateway(env, options.registry);
  if (gateway.config.bind !== LOOPBACK) {
    throw new Error('The gateway binds 127.0.0.1 only. Another address needs server-side authorisation (MDB-D3), which this build does not have.');
  }
  const token = gateway.config.requireToken ? randomBytes(24).toString('base64url') : null;
  let settings: GuardSettings | null = null;
  const server = createServer(requestListener(gateway, () => {
    if (settings === null) throw new Error('not listening');
    return settings;
  }, options.log));
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  server.maxHeadersCount = 64;
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? gateway.config.port, LOOPBACK, () => {
      server.off('error', fail);
      ok();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  settings = Object.freeze({ port, allowedOrigins: gateway.config.allowedOrigins, maxBodyBytes: gateway.config.maxBodyBytes, token });
  return Object.freeze({
    url: `http://${LOOPBACK}:${port}`,
    port,
    token,
    gateway,
    server,
    close: () => new Promise<void>(ok => {
      server.closeAllConnections();
      server.close(() => ok());
    }),
  });
}

/** Lines the entry point prints at start. Never a secret other than the per-launch token, printed once. */
export function startupLines(running: RunningGateway): string[] {
  const lines = [`encore-gateway listening on ${running.url}`];
  for (const [name, health] of Object.entries(running.gateway.health().modules)) lines.push(`  module ${name}: ${health.enabled ? 'enabled' : 'disabled'}`);
  for (const problem of running.gateway.problems) lines.push(`  note: ${problem}`);
  if (running.gateway.config.allowedOrigins.length === 0) lines.push('  note: GATEWAY_ALLOWED_ORIGINS is empty, so every non-GET request is refused');
  if (running.token !== null) lines.push(`  launch token (send as "Authorization: Bearer <token>"): ${running.token}`);
  return lines;
}

/** The entry point: environment in, one server out. */
export async function main(env: Env, log: (line: string) => void): Promise<RunningGateway> {
  const running = await startGateway(env, { log: e => log(`access ${e.serverId} ${e.method} ${e.path} ${e.status} ${e.ms}ms`) });
  for (const line of startupLines(running)) log(line);
  return running;
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const log = (line: string) => process.stderr.write(`${line}\n`);
  main(process.env, log).then(
    running => {
      const stop = () => void running.close();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    },
    (error: unknown) => {
      log(`encore-gateway did not start: ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exitCode = 1;
    },
  );
}
