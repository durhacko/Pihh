// integrations/gateway/src/router.ts
// Builds the gateway from the registry and routes requests. Skeleton-owned. Pure: no socket. `server.ts` runs the
// shared guard, turns each HTTP request into a `GatewayRequest` and writes the `RouteResponse`.
//
// One module failing never disables another (boundaries §6.2): a factory that throws, or a module whose routes are
// invalid or collide, is replaced by a disabled module and reported in `problems`; a handler that throws answers
// 500 INTERNAL for that request only.
import { moduleEnv, readGatewayConfig, type Env, type GatewayConfig } from './config.ts';
import { errorResponse, type RouteResponse } from './errors.ts';
import { healthBody, type HealthBody } from './health.ts';
import { disabledModule, type GatewayModule, type HttpMethod, type ModuleRoute } from './module.ts';
import { MODULES, type ModuleEntry } from './modules.ts';

export const HEALTH_PATH = '/api/health';
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SEGMENT = /^(:[a-zA-Z][a-zA-Z0-9]*|[a-z0-9][a-z0-9._-]*)$/;

export interface GatewayRequest {
  readonly method: string;
  /** Request target as sent: path plus optional query, e.g. `/api/runs?limit=5`. */
  readonly url: string;
  readonly rawBody: string;
}

export interface Gateway {
  readonly config: GatewayConfig;
  readonly modules: readonly GatewayModule[];
  /** Configuration and module problems found at build time (never a value). */
  readonly problems: readonly string[];
  health(): HealthBody;
  handle(request: GatewayRequest): Promise<RouteResponse<unknown>>;
}

interface Registered { module: string; route: ModuleRoute; segments: string[] }

function segmentsOf(path: string): string[] {
  return path.split('/').slice(1);
}

/** Why a route is invalid, or null. `taken` holds method + shape keys of routes already registered. */
function routeProblem(route: ModuleRoute, taken: ReadonlySet<string>): string | null {
  if (!METHODS.has(route.method)) return `unsupported method ${String(route.method)}`;
  if (typeof route.path !== 'string' || !route.path.startsWith('/api/')) return 'path must start with /api/';
  if (route.path === HEALTH_PATH) return `${HEALTH_PATH} is reserved for the skeleton`;
  const segments = segmentsOf(route.path);
  if (!segments.every(s => SEGMENT.test(s))) return `bad path ${route.path}`;
  if (typeof route.handle !== 'function') return 'route has no handler';
  if (taken.has(shapeKey(route.method, segments))) return `${route.method} ${route.path} collides with another route`;
  return null;
}

function shapeKey(method: string, segments: readonly string[]): string {
  return `${method} /${segments.map(s => (s.startsWith(':') ? ':' : s)).join('/')}`;
}

function checkRegistry(registry: readonly ModuleEntry[]): void {
  const names = new Set<string>();
  for (const entry of registry) {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name) || names.has(entry.name)) throw new Error(`bad or duplicate module name ${entry.name}`);
    names.add(entry.name);
    for (const other of registry) {
      if (other !== entry && other.envPrefix.startsWith(entry.envPrefix)) throw new Error(`env prefix ${entry.envPrefix} overlaps ${other.envPrefix}`);
    }
  }
}

function match(segments: readonly string[], pattern: readonly string[]): Record<string, string> | null {
  if (segments.length !== pattern.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i] ?? '';
    const got = segments[i] ?? '';
    if (want.startsWith(':')) {
      if (got === '') return null;
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) return null;
  }
  return params;
}

export function buildGateway(env: Env, registry: readonly ModuleEntry[] = MODULES): Gateway {
  checkRegistry(registry);
  const config = readGatewayConfig(env);
  const problems: string[] = [...config.problems];
  const modules: GatewayModule[] = [];
  const routes: Registered[] = [];
  const taken = new Set<string>();

  for (const entry of registry) {
    let module: GatewayModule;
    try {
      module = entry.create(moduleEnv(env, entry.envPrefix));
    } catch {
      problems.push(`module ${entry.name} failed to start; it is disabled`);
      modules.push(disabledModule(entry.name));
      continue;
    }
    const own = new Set<string>();
    let problem = module.name === entry.name ? null : `module ${entry.name} reports the name ${String(module.name)}`;
    for (const route of module.routes) {
      if (problem) break;
      const why = routeProblem(route, new Set([...taken, ...own]));
      if (why) problem = `module ${entry.name}: ${why}`;
      else own.add(shapeKey(route.method, segmentsOf(route.path)));
    }
    if (problem) {
      problems.push(`${problem}; it is disabled`);
      modules.push(disabledModule(entry.name));
      continue;
    }
    for (const key of own) taken.add(key);
    for (const route of module.routes) routes.push({ module: entry.name, route, segments: segmentsOf(route.path) });
    modules.push(module);
  }

  const frozenModules = Object.freeze(modules);
  const health = (): HealthBody => healthBody(frozenModules);

  async function handle(request: GatewayRequest): Promise<RouteResponse<unknown>> {
    const notFound = errorResponse('NOT_FOUND', 'No such route.', { details: [{ path: '', reason: 'NO_ROUTE' }] });
    if (typeof request.url !== 'string' || !request.url.startsWith('/')) return notFound;
    const url = new URL(request.url, 'http://127.0.0.1');
    const method = request.method.toUpperCase();
    if (url.pathname === HEALTH_PATH) return method === 'GET' ? { status: 200, body: health() } : notFound;
    if (!METHODS.has(method)) return notFound;
    const segments = segmentsOf(url.pathname);
    for (const entry of routes) {
      if (entry.route.method !== method) continue;
      const params = match(segments, entry.segments);
      if (!params) continue;
      const query: Record<string, string> = {};
      for (const [name, value] of url.searchParams) query[name] = value;
      try {
        return await entry.route.handle({ method: method as HttpMethod, path: url.pathname, params, query, rawBody: request.rawBody });
      } catch {
        return errorResponse('INTERNAL', 'The module failed to handle the request.');
      }
    }
    return notFound;
  }

  return Object.freeze({ config, modules: frozenModules, problems: Object.freeze(problems), health, handle });
}
