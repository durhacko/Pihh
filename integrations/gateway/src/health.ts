// integrations/gateway/src/health.ts
// Body of `GET /api/health`. Skeleton-owned. The envelope (`service`, `version`) is the skeleton's; each module
// defines its own `modules.<name>` entry, which always has `enabled: boolean` (mongodb spec §10.4, Tiger analytics
// RFC §3.1). A module is `enabled` only when it can actually answer. Pure: `server.ts` only serialises it.
import type { GatewayModule, ModuleHealth } from './module.ts';

export const GATEWAY_SERVICE = 'encore-gateway';
/** Keep equal to `package.json` "version" (a test checks it). */
export const GATEWAY_VERSION = '0.0.0';

export interface HealthBody {
  service: string;
  version: string;
  modules: Record<string, ModuleHealth>;
}

/** A module's health entry as plain JSON data, at most this many bytes when serialised. */
export const HEALTH_ENTRY_MAX = 4096;

/** One module's entry, contained (XI-1): a `health()` that throws, returns something that is not a plain object, or
 *  cannot be serialised (a cycle, a BigInt, a throwing getter, `toJSON` that throws) reads as `{ enabled: false }`,
 *  so `/api/health` always answers. The entry is a JSON round-trip, so it holds data only. */
function entryOf(module: GatewayModule): ModuleHealth {
  try {
    const text = JSON.stringify(module.health());
    if (typeof text !== 'string' || text.length > HEALTH_ENTRY_MAX) return { enabled: false };
    const plain: unknown = JSON.parse(text);
    if (typeof plain !== 'object' || plain === null || Array.isArray(plain)) return { enabled: false };
    return { ...(plain as Record<string, unknown>), enabled: (plain as { enabled?: unknown }).enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function healthBody(modules: readonly GatewayModule[]): HealthBody {
  const entries: Record<string, ModuleHealth> = {};
  for (const module of modules) entries[module.name] = entryOf(module);
  return { service: GATEWAY_SERVICE, version: GATEWAY_VERSION, modules: entries };
}
