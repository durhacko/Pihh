// integrations/gateway/src/tiger/module.ts
// The `tiger` module (Tiger Data analytics, #142). The skeleton's registry imports this file and passes only TIGER_*
// variables. The optional live writer `src/tiger-live/server.ts` (OIB-Q5) is not a registry module.
//
// Routes (TIG-06 offline part): GET /api/runs and GET /api/runs/:runId/metrics, always registered. This build has no
// database driver (pg arrives with TIG-03 live, under D3), so there is no Tiger source: without one the routes answer
// 503 MODULE_DISABLED and health is `{ enabled: false, db: 'disabled' }` (analytics RFC §3.1).
//
// OFFLINE FIXTURE (never live): TIGER_OFFLINE_FIXTURE=1 serves the routes from an in-memory read source supplied by
// the caller (the TIG-04 fake repository fed by the importer). Every run it returns carries
// `provenance.source: 'fixture'`, `verified: false`, `verification: null`, and health says `source: 'fixture'`:
// fixture output is never presented as Tiger or as live data. Without a supplied source the flag changes nothing.
//
// T31: a credential the HTTP server must not hold (TIGER_DATABASE_URL, TIGER_ADMIN_DATABASE_URL, TIGER_LIVE_WRITE_URL)
// throws FatalConfigError, which the registry re-throws: the whole gateway refuses to start. Any other bad setting (a
// URL with TLS parameters, a bad TIGER_TLS_UNVERIFIED or TIGER_OFFLINE_FIXTURE, a malformed URL) throws a plain
// TigerConfigError, so the registry disables only this module and lists the problem.
import { FatalConfigError } from '../errors.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import type { Env } from '../config.ts';
import { loadTigerReaderConfig, TigerConfigError } from './config.ts';
import { tigerRoutes } from './routes/index.ts';
import type { RunReadSource } from './services/source.ts';

export { moduleDisabled } from './services/disabled.ts';

export const OFFLINE_FIXTURE_ENV = 'TIGER_OFFLINE_FIXTURE';

export interface TigerModuleDeps {
  /** The offline fixture source, used only with TIGER_OFFLINE_FIXTURE=1. Its `kind` must be 'fixture'. */
  readonly fixtureSource?: () => RunReadSource | null;
}

function fixtureRequested(env: Env): boolean {
  const raw = (env[OFFLINE_FIXTURE_ENV] ?? '').trim();
  if (raw === '') return false;
  if (raw === '1') return true;
  throw new TigerConfigError('INVALID_FIXTURE_FLAG', `${OFFLINE_FIXTURE_ENV} must be 1 or unset`);
}

export function createTigerModule(env: Env, deps: TigerModuleDeps = {}): GatewayModule {
  // Validated even though this build cannot connect, so a bad or forbidden setting is caught now.
  try {
    loadTigerReaderConfig(env);
  } catch (error) {
    // The message names the variable and the rule, never a value (config.ts).
    if (error instanceof TigerConfigError && error.reason === 'FORBIDDEN_CREDENTIAL') throw new FatalConfigError(`${error.message}; refusing to start`);
    throw error;
  }
  let source: RunReadSource | null = null;
  if (fixtureRequested(env)) {
    source = deps.fixtureSource?.() ?? null;
    if (source !== null && source.kind !== 'fixture') throw new TigerConfigError('FIXTURE_NOT_FIXTURE', 'the offline fixture source must be labelled fixture');
  }
  const health = source === null
    ? Object.freeze({ enabled: false, db: 'disabled' })
    // Enabled, but there is no database: the data are a fixture, and health says so.
    : Object.freeze({ enabled: true, db: 'disabled', source: 'fixture' });
  return Object.freeze({
    name: 'tiger',
    routes: tigerRoutes(source),
    // Never says why it is disabled (module.ts contract) and never contains a setting.
    health: () => ({ ...health }),
  });
}

export const createModule: ModuleFactory = (env): GatewayModule => createTigerModule(env);
