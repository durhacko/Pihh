// integrations/gateway/src/shows/module.ts — entry point of the `shows` module (MongoDB Atlas show library, #130;
// MDB-WP-03 offline half, #241), registered by the skeleton in `../modules.ts` with the `MONGODB_` prefix, so it sees
// MONGODB_* variables only.
//
// THIS BUILD HAS NO DRIVER (no `mongodb` package, no network: the live repository comes under D3). So `createModule`
// always builds a DISABLED module, whatever the environment holds: health { enabled: false, db: 'disabled',
// writable: false }, and the shows routes (MDB-WP-04) answer 503 DATABASE_UNAVAILABLE with reason MODULE_DISABLED
// (`moduleDisabledResponse`). The memory repository is deliberately NOT the default: a gateway restart would drop
// every "saved" show without a word. `showsModule` takes an explicit repository (tests, and the live PR).
import { secret, type Env, type Secret } from '../config.ts';
import { errorResponse, type ErrorEnvelope } from '../errors.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import type { ShowsRepository } from './repository.ts';
import type { ShowsHealth } from './types.ts';

/** Spec section 10.6 planning values. serverSelectionTimeoutMS and maxTimeMS go to the driver (live PR). */
export const SHOWS_TIMEOUTS: Readonly<{ serverSelectionTimeoutMS: number; maxTimeMS: number; handlerDeadlineMs: number }> =
  Object.freeze({ serverSelectionTimeoutMS: 3000, maxTimeMS: 2000, handlerDeadlineMs: 5000 });
/** Health's `db` comes from a cached ping, refreshed at most this often (spec section 10.4). */
export const HEALTH_TTL_MS = 10_000;
/** Database name when MONGODB_DB is unset (spec section 7: database `encore`, collection `saved_shows`). */
export const DEFAULT_DB_NAME = 'encore';
export const COLLECTION_NAME = 'saved_shows';

const URI_SCHEME = /^mongodb(\+srv)?:\/\//;
const DB_NAME = /^[A-Za-z0-9_-]{1,63}$/;   // conservative subset of MongoDB's rules (no / \ . " $ space; < 64 bytes)

export interface ShowsConfig {
  /** True when MONGODB_URI is a mongodb:// or mongodb+srv:// URI. Not enough on its own: the module also needs a repository. */
  readonly configured: boolean;
  readonly uri: Secret | null;
  readonly dbName: string;
  /** Notes about ignored values. Never contains a value. */
  readonly problems: readonly string[];
}

/** Reads MONGODB_URI and MONGODB_DB only (XI-12). Never throws; a missing or malformed URI is a disabled module. */
export function readShowsConfig(env: Env): ShowsConfig {
  const problems: string[] = [];
  const rawUri = env.MONGODB_URI?.trim() ?? '';
  let uri: Secret | null = null;
  if (rawUri !== '') {
    if (URI_SCHEME.test(rawUri)) uri = secret(rawUri);
    else problems.push('MONGODB_URI is not a mongodb:// or mongodb+srv:// URI; the shows module stays disabled');
  }
  const rawDb = env.MONGODB_DB?.trim() ?? '';
  let dbName = DEFAULT_DB_NAME;
  if (rawDb !== '') {
    if (DB_NAME.test(rawDb)) dbName = rawDb;
    else problems.push(`MONGODB_DB is not a valid database name; using ${DEFAULT_DB_NAME}`);
  }
  return Object.freeze({ configured: uri !== null, uri, dbName, problems: Object.freeze(problems) });
}

/**
 * The answer of every shows route while the module is disabled (spec sections 10.2, 10.6; MDB-T18): 503
 * DATABASE_UNAVAILABLE with reason MODULE_DISABLED, in the shared envelope. The message names no configuration.
 */
export function moduleDisabledResponse(requestId?: string): { status: number; body: ErrorEnvelope } {
  return errorResponse('DATABASE_UNAVAILABLE', 'Saved shows are not available.', {
    details: [{ path: '', reason: 'MODULE_DISABLED' }],
    ...(requestId !== undefined ? { requestId } : {}),
  });
}

export interface ShowsDeps {
  config: ShowsConfig;
  /** null in this build: no driver, so no persistent repository. */
  repository: ShowsRepository | null;
  /** Clock for the health cache (ms). Default Date.now. */
  now?: () => number;
  /** A ping that has not answered by then counts as down. Default SHOWS_TIMEOUTS.handlerDeadlineMs. */
  pingDeadlineMs?: number;
}

export interface ShowsModule extends GatewayModule {
  health(): ShowsHealth;
  /** Pings the repository if the cached state is older than HEALTH_TTL_MS, then returns health. Never rejects. */
  refreshHealth(): Promise<ShowsHealth>;
  /** True when a configured repository is wired (routes then use it; MDB-WP-04). */
  readonly enabled: boolean;
}

/** Builds the module from explicit deps (tests, and the live PR once a MongoDB repository exists). */
export function showsModule(deps: ShowsDeps): ShowsModule {
  const repository = deps.config.configured ? deps.repository : null;
  const enabled = repository !== null;
  const now = deps.now ?? Date.now;
  const deadline = deps.pingDeadlineMs ?? SHOWS_TIMEOUTS.handlerDeadlineMs;
  let db: 'up' | 'down' | null = null;   // null: never pinged
  let pingedAt = -Infinity;
  let inFlight: Promise<void> | null = null;

  const health = (): ShowsHealth => {
    if (!enabled) return { enabled: false, db: 'disabled', writable: false };
    const state = db ?? 'down';   // not yet confirmed reachable: an honest 'down', never a guessed 'up'
    // The MongoDB repository will also require its index confirmation before writable (spec section 11); the memory
    // repository has no such step, so a reachable repository is writable.
    return { enabled: true, db: state, writable: state === 'up' };
  };

  async function ping(repo: ShowsRepository): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'down'>(resolve => { timer = setTimeout(() => resolve('down'), deadline); });
    try {
      // Deferred, so a ping that throws synchronously is a 'down' too, never an escape.
      const answered = Promise.resolve().then(() => repo.ping()).then(v => (v === 'up' ? 'up' : 'down') as 'up' | 'down', () => 'down' as const);
      db = await Promise.race([answered, late]);
    } finally {
      clearTimeout(timer);
      pingedAt = now();
    }
  }

  return {
    name: 'shows',
    enabled,
    routes: [],   // MDB-WP-04 adds POST/GET /api/shows and GET /api/shows/:id; each answers moduleDisabledResponse() while disabled
    health,
    async refreshHealth() {
      if (repository === null) return health();
      if (now() - pingedAt >= HEALTH_TTL_MS) {
        inFlight ??= ping(repository).finally(() => { inFlight = null; });
        await inFlight;
      }
      return health();
    },
  };
}

/** The registry's factory. No driver in this build, so the module is always disabled (see the header). */
export const createModule: ModuleFactory = (env: Env) => showsModule({ config: readShowsConfig(env), repository: null });
