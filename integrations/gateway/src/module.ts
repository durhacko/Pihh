// integrations/gateway/src/module.ts
// The plug-in interface every gateway module implements (boundaries §6.2, XI-12, XI-20). Skeleton-owned.
// A module lives in `src/<name>/`, owned by its lane, and exports `createModule` from `src/<name>/module.ts`. The
// skeleton's registry (`modules.ts`) already imports every approved module's entry point, so a lane plugs in by
// replacing its own folder's files and never edits a skeleton file.
import type { Env } from './config.ts';
import type { RouteResponse } from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** What a route handler receives. The server (later PR) builds it after the shared guard has passed the request
 *  (Host, Origin, Content-Type, token, body size); a handler never re-implements those checks. */
export interface RouteRequest {
  readonly method: HttpMethod;
  /** Path without the query string, e.g. `/api/runs/abc/metrics`. */
  readonly path: string;
  /** Values of `:name` segments in the route pattern. */
  readonly params: Readonly<Record<string, string>>;
  /** Query string values (last one wins). */
  readonly query: Readonly<Record<string, string>>;
  /** Raw UTF-8 body ('' for none). The module parses and validates it. */
  readonly rawBody: string;
}

export interface ModuleRoute {
  readonly method: HttpMethod;
  /** Must start with `/api/`. Segments starting with `:` are parameters. `/api/health` is reserved for the skeleton. */
  readonly path: string;
  handle(request: RouteRequest): Promise<RouteResponse<unknown>>;
}

/** A module's entry in `GET /api/health`. `enabled` is required; each module spec defines its other fields
 *  (shows: `db`, `writable`; tiger: `db`). It must never contain a secret or say why a module is disabled. */
export interface ModuleHealth {
  readonly enabled: boolean;
  readonly [field: string]: unknown;
}

export interface GatewayModule {
  readonly name: string;
  /** Routes are registered even when the module is disabled, so it can answer its own MODULE_DISABLED. */
  readonly routes: readonly ModuleRoute[];
  health(): ModuleHealth;
}

/**
 * `createModule` in `src/<name>/module.ts`. `env` holds ONLY the variables with the module's own prefix (see
 * `modules.ts`), so a module cannot read another module's secret. It must not throw for missing configuration: a
 * module with no key is a disabled module, not a failure. If it throws anyway, the gateway disables that module only.
 */
export type ModuleFactory = (env: Env) => GatewayModule;

/** A module that does nothing: no routes, `enabled: false`. Used for placeholders and for a factory that threw. */
export function disabledModule(name: string, health: Omit<ModuleHealth, 'enabled'> = {}): GatewayModule {
  return { name, routes: [], health: () => ({ ...health, enabled: false }) };
}
