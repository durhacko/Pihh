// integrations/gateway/src/tiger/config.ts
// The `tiger` module's connection settings (TIG-03 "Proposed interfaces"; TIGER_TELEMETRY_AND_INGESTION_RFC.md §13).
// Offline and pure: no driver, no connection, no file read. Three credentials, one per process:
//   reader   TIGER_READ_DATABASE_URL   - the gateway HTTP server (loadTigerReaderConfig)
//   importer TIGER_DATABASE_URL        - the importer CLI, from src/tiger/.env.importer (loadTigerImporterConfig)
//   admin    TIGER_ADMIN_DATABASE_URL  - tiger:migrate, the live-test harness, the owner tools (loadTigerAdminConfig)
// A process refuses a credential it must not hold. TLS never comes from the URL: it is verify-full, or require only
// when TIGER_TLS_UNVERIFIED=1 (RFC §13 names; no other TLS setting exists).
// Errors name the variable and the rule, never a value: no host, user, password or URL reaches a message (T31).
import { secret, type Env, type Secret } from '../config.ts';

export type TigerSslMode = 'require' | 'verify-full';

/** The `ssl` option the live connection (TIG-03 live, D3) passes to the driver, built only from `sslMode`. */
export type TigerSsl = { readonly rejectUnauthorized: true; readonly servername: string } | { readonly rejectUnauthorized: false };

export interface TigerConnSettings {
  /** The connection URL, which carries the password. Only `reveal()` returns it; JSON and logs see `[redacted]`. */
  readonly url: Secret;
  readonly sslMode: TigerSslMode;
  readonly ssl: TigerSsl;
  /** Client-side statement timeout in ms; 0 = none set by the gateway (the role's own setting applies). */
  readonly statementTimeoutMs: number;
}

/** Budgets from RFC §13: `max_connections` = 25 on shared compute and no pooler on free services. */
export const TIGER_BUDGETS = Object.freeze({
  apiPoolMax: 3,
  importerConnections: 2,
  /** Mirrors the role settings of §13 (`ALTER ROLE … SET statement_timeout`). */
  readerStatementTimeoutMs: 5_000,
  importerStatementTimeoutMs: 30_000,
  /** §13 sets no timeout for the owner; migrations and owner tools run by hand. */
  adminStatementTimeoutMs: 0,
});

export const TIGER_ENV = Object.freeze({
  reader: 'TIGER_READ_DATABASE_URL',
  importer: 'TIGER_DATABASE_URL',
  admin: 'TIGER_ADMIN_DATABASE_URL',
  liveWrite: 'TIGER_LIVE_WRITE_URL',
  tlsUnverified: 'TIGER_TLS_UNVERIFIED',
});

/** Query parameters that would set TLS from the URL and override the `ssl` object (RFC §13): always refused. */
export const URL_TLS_PARAMS: readonly string[] = Object.freeze(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']);

/** A configuration the process must refuse. `reason` is SCREAMING_SNAKE; the message never contains a value. */
export class TigerConfigError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'TigerConfigError';
    this.reason = reason;
  }
}

/** "Present" means set at all, even to an empty string: a process must not even be handed the variable. */
function present(env: Env, name: string): boolean {
  return env[name] !== undefined;
}

function refuseHeld(env: Env, names: readonly string[], process: string): void {
  for (const name of names) {
    if (present(env, name)) {
      throw new TigerConfigError('FORBIDDEN_CREDENTIAL', `the ${process} must not hold ${name}; unset it for this process`);
    }
  }
}

function parseUrl(env: Env, name: string): { url: Secret; host: string } {
  const raw = (env[name] ?? '').trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TigerConfigError('INVALID_URL', `${name} is not a valid URL`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TigerConfigError('INVALID_URL', `${name} must use the postgres or postgresql scheme`);
  }
  if (url.hostname === '') throw new TigerConfigError('INVALID_URL', `${name} has no host`);
  for (const key of url.searchParams.keys()) {
    if (URL_TLS_PARAMS.includes(key.toLowerCase())) {
      throw new TigerConfigError('URL_SETS_TLS', `${name} must not carry TLS parameters (${URL_TLS_PARAMS.join(', ')}); remove them (TLS is verify-full, or require with ${TIGER_ENV.tlsUnverified}=1)`);
    }
  }
  return { url: secret(raw), host: url.hostname };
}

/**
 * The RFC §13 names only: `verify-full` by default; `require` (encrypted, server not authenticated: free services have
 * no certificate) only when TIGER_TLS_UNVERIFIED=1, with the risks RFC §13 lists. Any other value of the flag is
 * refused rather than guessed (`true`, `yes` and `0` are not `1`), and no other mode exists.
 */
function sslFrom(env: Env, host: string): { sslMode: TigerSslMode; ssl: TigerSsl } {
  const flag = (env[TIGER_ENV.tlsUnverified] ?? '').trim();
  if (flag === '') return { sslMode: 'verify-full', ssl: Object.freeze({ rejectUnauthorized: true, servername: host }) };
  if (flag === '1') return { sslMode: 'require', ssl: Object.freeze({ rejectUnauthorized: false }) };
  throw new TigerConfigError('INVALID_TLS_FLAG', `${TIGER_ENV.tlsUnverified} must be 1 (TLS require) or unset (TLS verify-full)`);
}

function settings(env: Env, name: string, statementTimeoutMs: number): TigerConnSettings {
  const { url, host } = parseUrl(env, name);
  return Object.freeze({ url, ...sslFrom(env, host), statementTimeoutMs });
}

/**
 * The HTTP server's settings: TIGER_READ_DATABASE_URL only. `null` = not configured, so the module is disabled and
 * the other modules are unaffected (XI-1). Throws if the importer, admin or live-write credential is present: the
 * API process must never hold them (T31).
 */
export function loadTigerReaderConfig(env: Env): (TigerConnSettings & { readonly apiPoolMax: 3 }) | null {
  refuseHeld(env, [TIGER_ENV.importer, TIGER_ENV.admin, TIGER_ENV.liveWrite], 'gateway HTTP server');
  if ((env[TIGER_ENV.reader] ?? '').trim() === '') return null;
  return Object.freeze({ ...settings(env, TIGER_ENV.reader, TIGER_BUDGETS.readerStatementTimeoutMs), apiPoolMax: TIGER_BUDGETS.apiPoolMax });
}

/**
 * The importer CLI's settings. `env` is what the CLI read from src/tiger/.env.importer plus its own process
 * environment (the file reading is the CLI's, TIG-04). Throws if TIGER_ADMIN_DATABASE_URL is present or
 * TIGER_DATABASE_URL is missing.
 */
export function loadTigerImporterConfig(env: Env): TigerConnSettings & { readonly importerConnections: 2 } {
  refuseHeld(env, [TIGER_ENV.admin], 'importer');
  if ((env[TIGER_ENV.importer] ?? '').trim() === '') throw new TigerConfigError('MISSING_CREDENTIAL', `${TIGER_ENV.importer} is not set`);
  return Object.freeze({ ...settings(env, TIGER_ENV.importer, TIGER_BUDGETS.importerStatementTimeoutMs), importerConnections: TIGER_BUDGETS.importerConnections });
}

/** tiger:migrate, the live-test harness and the owner tools only (TIG-D15); supplied only for that command. */
export function loadTigerAdminConfig(env: Env): TigerConnSettings {
  if ((env[TIGER_ENV.admin] ?? '').trim() === '') throw new TigerConfigError('MISSING_CREDENTIAL', `${TIGER_ENV.admin} is not set`);
  return settings(env, TIGER_ENV.admin, TIGER_BUDGETS.adminStatementTimeoutMs);
}

/** The one start-up line stating the effective TLS mode (RFC §13). Contains no host, user or URL. */
export function tlsModeLine(process: string, s: Pick<TigerConnSettings, 'sslMode'>): string {
  return s.sslMode === 'verify-full'
    ? `tiger ${process}: TLS verify-full (server certificate and host name verified)`
    : `tiger ${process}: WARNING TLS require: encrypted but the server is NOT authenticated (TIGER_TLS_UNVERIFIED=1); trusted networks only, see TIGER_TELEMETRY_AND_INGESTION_RFC.md §13`;
}
