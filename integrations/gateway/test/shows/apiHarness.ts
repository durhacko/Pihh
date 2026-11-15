// Test harness for the shows routes (MDB-WP-04): calls a route handler directly with a RouteRequest, as the skeleton's
// router would after its guard. Not a *.test.ts file, so importing it registers no tests.
import assert from 'node:assert/strict';
import type { ModuleRoute, RouteRequest } from '../../src/module.ts';
import { createMemoryRepository, type MemoryShowsRepository } from '../../src/shows/memoryRepository.ts';
import { createShowsRoutes, SHOWS_PATH } from '../../src/shows/routes.ts';

export const KEY = '3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f71';
/** Spec section 7.2's example as a POST body (title untrimmed and text lower-case, to exercise normalisation). */
export const SHOW = {
  schemaVersion: 1,
  title: '  HELLO to Helix ',
  source: 'manual',
  composition: { v: 1, movements: [
    { recipe: { kind: 'text', text: 'hello', palette: [[1, 0.6, 0.1], [0.2, 0.5, 1]] }, holdTicks: 600 },
    { recipe: { kind: 'sphere' }, holdTicks: 600 },
    { recipe: { kind: 'helix' }, holdTicks: 600 },
  ] },
};

/** Response bodies are read as loose JSON in these tests; every field read is asserted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export function api(repository: MemoryShowsRepository = createMemoryRepository(), opts: { now?: () => Date; deadlineMs?: number } = {}) {
  const routes: ModuleRoute[] = createShowsRoutes({ repository, ...opts });
  const call = (method: 'GET' | 'POST', path: string, init: { body?: unknown; raw?: string; query?: Record<string, string> } = {}) => {
    const id = path.startsWith(`${SHOWS_PATH}/`) ? path.slice(SHOWS_PATH.length + 1) : undefined;
    const route = routes.find(r => r.method === method && r.path === (id === undefined ? SHOWS_PATH : `${SHOWS_PATH}/:id`));
    assert.ok(route, `${method} ${path}`);
    const request: RouteRequest = {
      method, path, params: id === undefined ? {} : { id }, query: init.query ?? {},
      rawBody: init.raw ?? (init.body === undefined ? '' : JSON.stringify(init.body)),
    };
    return route.handle(request) as Promise<{ status: number; body: Json }>;
  };
  return { repository, call, save: (body: unknown) => call('POST', SHOWS_PATH, { body }) };
}

/** The error details as "path REASON" strings. */
export const reasons = (body: Json): string[] => (body.error.details ?? []).map((d: { path: string; reason: string }) => `${d.path} ${d.reason}`);
