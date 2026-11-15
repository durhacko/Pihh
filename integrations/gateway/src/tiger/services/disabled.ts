// integrations/gateway/src/tiger/disabled.ts
// The answer of any tiger route while the module has no read source: 503 DATABASE_UNAVAILABLE, reason
// MODULE_DISABLED, no Retry-After (analytics RFC §3.1, §3.7). Re-exported by module.ts.
import { errorResponse, type ErrorEnvelope } from '../../errors.ts';

export function moduleDisabled(requestId?: string): { status: number; body: ErrorEnvelope } {
  return errorResponse('DATABASE_UNAVAILABLE', 'Database analytics are not enabled in this build', {
    details: [{ path: '', reason: 'MODULE_DISABLED' }],
    requestId,
  });
}
