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

export function healthBody(modules: readonly GatewayModule[]): HealthBody {
  const entries: Record<string, ModuleHealth> = {};
  for (const module of modules) {
    let health: ModuleHealth;
    try {
      const reported = module.health();
      health = { ...reported, enabled: reported.enabled === true };
    } catch {
      health = { enabled: false };
    }
    entries[module.name] = health;
  }
  return { service: GATEWAY_SERVICE, version: GATEWAY_VERSION, modules: entries };
}
