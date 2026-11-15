// integrations/gateway/src/config.ts
// Gateway-level configuration and environment handling (boundaries §6.2, gemini spec §10.3). Skeleton-owned.
// Values come only from the gateway process's environment, which the entry point passes in. Nothing is committed
// (only `.env.example` files, which hold no values) and nothing is bundled to the client: the app never imports
// `integrations/`, and no value is read from a Vite build variable.
//
// Each module receives only the variables with its own prefix (`moduleEnv`), so it cannot read another module's
// secret. Module settings (keys, models, timeouts) are parsed by the module itself, in `src/<name>/`.

/** A secret that does not leak through `String()`, JSON or `util.inspect`. Only `reveal()` returns the value. */
export interface Secret {
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

const REDACTED = '[redacted]';

export function secret(value: string): Secret {
  return Object.freeze({
    reveal: () => value,
    toString: () => REDACTED,
    toJSON: () => REDACTED,
    [Symbol.for('nodejs.util.inspect.custom')]: () => REDACTED,
  });
}

export type Env = Readonly<Record<string, string | undefined>>;

/** A copy of `env` holding only the variables whose names start with `prefix`. */
export function moduleEnv(env: Env, prefix: string): Env {
  if (!/^[A-Z][A-Z0-9]*_$/.test(prefix)) throw new Error(`bad module env prefix ${prefix}`);
  const out: Record<string, string | undefined> = {};
  for (const name of Object.keys(env)) if (name.startsWith(prefix)) out[name] = env[name];
  return Object.freeze(out);
}

/** True for `1` or `true` (any case). Every module enable flag uses this. */
export function envFlag(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true'].includes(value.trim().toLowerCase());
}

/** An integer setting in [min, max]; anything else falls back and is reported in `problems` (never the value). */
export function envInteger(env: Env, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (Number.isSafeInteger(value) && value >= min && value <= max) return value;
  problems.push(`${name} must be an integer in [${min}, ${max}]; using ${fallback}`);
  return fallback;
}

export const GATEWAY_DEFAULTS = Object.freeze({
  port: 8787,
  /** The X-IN gate (boundaries §3.1) and the shows v1 cap: 64 KiB, counted while streaming. */
  maxBodyBytes: 64 * 1024,
});

/** The only bind address (boundaries §6.2). Another address needs a server-side authorisation (MDB-D3), which
 *  this build does not have, so `GATEWAY_BIND` set to anything else makes the gateway refuse to start. */
export const LOOPBACK = '127.0.0.1';

export interface GatewayConfig {
  readonly port: number;
  /** Requested bind address; `startGateway` refuses anything but `LOOPBACK`. */
  readonly bind: string;
  /** Exact origins allowed on non-GET requests (boundaries §6.2). Empty by default: every non-GET is refused
   *  until the operator names the app's origin. Each entry is a serialised origin, e.g. `http://localhost:5173`. */
  readonly allowedOrigins: readonly string[];
  /** When true, the server makes a per-launch token at start, prints it once, and every route except
   *  `GET /api/health` needs `Authorization: Bearer <token>`. */
  readonly requireToken: boolean;
  readonly maxBodyBytes: number;
  /** Notes about ignored values (never contains a value). */
  readonly problems: readonly string[];
}

function readOrigins(raw: string | undefined, problems: string[]): string[] {
  const out: string[] = [];
  for (const item of (raw ?? '').split(',').map(s => s.trim()).filter(s => s !== '')) {
    let origin: string | null = null;
    try {
      const url = new URL(item);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === item) origin = url.origin;
    } catch {
      origin = null;
    }
    if (origin === null) problems.push('GATEWAY_ALLOWED_ORIGINS has an entry that is not an exact http(s) origin; it is ignored');
    else if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Gateway-level settings (prefix `GATEWAY_`). */
export function readGatewayConfig(env: Env): GatewayConfig {
  const problems: string[] = [];
  const own = moduleEnv(env, 'GATEWAY_');
  const port = envInteger(own, 'GATEWAY_PORT', GATEWAY_DEFAULTS.port, 1, 65_535, problems);
  const bind = (own.GATEWAY_BIND ?? '').trim() || LOOPBACK;
  const allowedOrigins = Object.freeze(readOrigins(own.GATEWAY_ALLOWED_ORIGINS, problems));
  const requireToken = envFlag(own.GATEWAY_REQUIRE_TOKEN);
  const maxBodyBytes = envInteger(own, 'GATEWAY_MAX_BODY_BYTES', GATEWAY_DEFAULTS.maxBodyBytes, 1024, 1024 * 1024, problems);
  return Object.freeze({ port, bind, allowedOrigins, requireToken, maxBodyBytes, problems: Object.freeze(problems) });
}
