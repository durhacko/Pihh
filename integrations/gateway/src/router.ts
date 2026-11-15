// integrations/gateway/src/router.ts
// Builds the gateway from the registry and routes requests. Skeleton-owned. Pure: no socket. `server.ts` runs the
// shared guard, turns each HTTP request into a `GatewayRequest` and writes the `RouteResponse`.
//
// One module failing never disables another (boundaries §6.2): a factory that throws, or a module whose routes are
// invalid or collide, is replaced by a disabled module and reported in `problems`; a handler that throws answers
// 500 INTERNAL for that request only.
import { moduleEnv, readGatewayConfig, type Env, type GatewayConfig } from './config.ts';
import { errorResponse, sanitise, type RouteResponse } from './errors.ts';
import { healthBody, type HealthBody } from './health.ts';
import { disabledModule, type GatewayModule, type HttpMethod, type ModuleHealth, type ModuleRoute } from './module.ts';
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

const NOTE_MAX = 10;

/** The module object's shape, or why it is unusable. Reads each field once (a getter may lie on a second read). */
function moduleShape(value: unknown, name: string): { module: GatewayModule; routes: ModuleRoute[]; notes: string[] } | string {
  if (typeof value !== 'object' || value === null) return 'createModule did not return an object';
  const candidate = value as Record<string, unknown>;
  const reported = candidate.name;
  const routes = candidate.routes;
  const health = candidate.health;
  const problems = candidate.problems;
  if (reported !== name) return `reports the name ${typeof reported === 'string' ? sanitise(reported) : typeof reported}`;
  if (!Array.isArray(routes)) return 'routes is not an array';
  if (typeof health !== 'function') return 'health is not a function';
  if (problems !== undefined && (!Array.isArray(problems) || !problems.every(p => typeof p === 'string'))) return 'problems is not a list of strings';
  const list = [...routes] as unknown[];
  if (!list.every(r => typeof r === 'object' && r !== null)) return 'a route is not an object';
  const notes = ((problems as string[] | undefined) ?? []).slice(0, NOTE_MAX).map(p => sanitise(p));
  const module: GatewayModule = Object.freeze({ name, routes: list as ModuleRoute[], health: () => (health as () => ModuleHealth).call(value) });
  return { module, routes: list as ModuleRoute[], notes };
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
    // Everything a module hands back is checked inside one try: a factory that throws, an object of the wrong
    // shape, a getter that throws or a bad route disables that module only (XI-1). Routes are copied, so a module
    // cannot change them after registration.
    let accepted: { module: GatewayModule; routes: ModuleRoute[]; own: Set<string>; notes: string[] } | null = null;
    let problem: string;
    try {
      const made: unknown = entry.create(moduleEnv(env, entry.envPrefix));
      const shape = moduleShape(made, entry.name);
      if (typeof shape === 'string') problem = `module ${entry.name}: ${shape}`;
      else {
        const own = new Set<string>();
        const copies: ModuleRoute[] = [];
        let why: string | null = null;
        for (const route of shape.routes) {
          why = routeProblem(route, new Set([...taken, ...own]));
          if (why) break;
          copies.push(Object.freeze({ method: route.method, path: route.path, handle: route.handle }));
          own.add(shapeKey(route.method, segmentsOf(route.path)));
        }
        if (why) problem = `module ${entry.name}: ${why}`;
        else {
          problem = '';
          accepted = { module: shape.module, routes: copies, own, notes: shape.notes };
        }
      }
    } catch {
      problem = `module ${entry.name} failed to start`;
      accepted = null;
    }
    if (accepted === null) {
      problems.push(`${problem}; it is disabled`);
      modules.push(disabledModule(entry.name));
      continue;
    }
    for (const note of accepted.notes) problems.push(`module ${entry.name}: ${note}`);
    for (const key of accepted.own) taken.add(key);
    for (const route of accepted.routes) routes.push({ module: entry.name, route, segments: segmentsOf(route.path) });
    modules.push(accepted.module);
  }

  const frozenModules = Object.freeze(modules);
  const health = (): HealthBody => healthBody(frozenModules);

  async function handle(request: GatewayRequest): Promise<RouteResponse<unknown>> {
    const notFound = errorResponse('NOT_FOUND', 'No such route.', { details: [{ path: '', reason: 'NO_ROUTE' }] });
    const badTarget = errorResponse('VALIDATION_FAILED', 'The request target is not a valid path.', { details: [{ path: '', reason: 'BAD_TARGET' }] });
    // Only an origin-form target ("/path?query"). "//host/..." and "/\host/..." would otherwise parse as another
    // authority, so the parsed URL must keep the base's host.
    if (typeof request.url !== 'string' || !request.url.startsWith('/') || request.url.startsWith('//')) return badTarget;
    let url: URL;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      return badTarget;
    }
    if (url.host !== '127.0.0.1') return badTarget;
    const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
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
