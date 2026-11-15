// integrations/gateway/src/tiger/module.ts
// The `tiger` module (Tiger Data analytics, #142, TIG-03 offline part). The skeleton's registry imports this file and
// passes only TIGER_* variables. The optional live writer `src/tiger-live/server.ts` (OIB-Q5) is not a registry module.
// This build has no database driver (pg arrives with TIG-03 live, under D3) and no routes (TIG-06), so the module is
// always disabled: health is `{ enabled: false, db: 'disabled' }` (analytics RFC §3.1), and the routes TIG-06 adds
// answer `moduleDisabled()` while it is not configured.
//
// A credential the HTTP server must not hold (TIGER_DATABASE_URL, TIGER_ADMIN_DATABASE_URL, TIGER_LIVE_WRITE_URL), a
// URL carrying TLS parameters or an unacknowledged `require` makes `createModule` throw: the registry then disables
// this module and lists the problem. Refusing the whole server start (T31) needs a skeleton hook (see README).
import { errorResponse, type ErrorEnvelope } from '../errors.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';
import { loadTigerReaderConfig } from './config.ts';

export const createModule: ModuleFactory = (env): GatewayModule => {
  // Validated even though this build cannot connect, so a bad or forbidden setting is caught now, not at TIG-06.
  loadTigerReaderConfig(env);
  return Object.freeze({
    name: 'tiger',
    routes: Object.freeze([]),
    // Never says why it is disabled (module.ts contract) and never contains a setting.
    health: () => ({ enabled: false, db: 'disabled' }),
  });
};

/** The answer of any tiger route while the module is not configured: 503, reason MODULE_DISABLED, no Retry-After. */
export function moduleDisabled(requestId?: string): { status: number; body: ErrorEnvelope } {
  return errorResponse('DATABASE_UNAVAILABLE', 'Database analytics are not enabled in this build', {
    details: [{ path: '', reason: 'MODULE_DISABLED' }],
    requestId,
  });
}
