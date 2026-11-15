// integrations/gateway/src/modules.ts
// The module registry. Skeleton-owned. It lists every approved integration's module once (gemini #117, shows #130,
// tiger #142; boundaries §6.2, XI-20) with its environment prefix. Each lane owns `src/<name>/` and plugs in by
// replacing `src/<name>/module.ts`; this file changes only when a new integration is approved.
import type { ModuleFactory } from './module.ts';
import { createModule as createGemini } from './gemini/module.ts';
import { createModule as createShows } from './shows/module.ts';
import { createModule as createTiger } from './tiger/module.ts';

export interface ModuleEntry {
  readonly name: string;
  /** The only environment variables the module's factory receives. */
  readonly envPrefix: string;
  readonly create: ModuleFactory;
}

export const MODULES: readonly ModuleEntry[] = Object.freeze([
  { name: 'gemini', envPrefix: 'GEMINI_', create: createGemini },
  { name: 'shows', envPrefix: 'MONGODB_', create: createShows },
  { name: 'tiger', envPrefix: 'TIGER_', create: createTiger },
]);
