// integrations/gateway/src/tiger/routes/index.ts
// The two read-only routes of the TIG-06 offline part (analytics RFC §3.4, §3.5): GET /api/runs and
// GET /api/runs/:runId/metrics. Both are always registered; without a read source they answer MODULE_DISABLED.
// `requestId` may be sent as a query parameter; it is echoed in errors when it matches XI-11 and dropped otherwise.
import { errorResponse } from '../../errors.ts';
import type { ModuleRoute, RouteRequest } from '../../module.ts';
import { moduleDisabled } from '../services/disabled.ts';
import { parseMetricsQuery, runMetrics, RUN_ID_PATTERN } from '../services/metrics.ts';
import { listRuns, parseListQuery, QueryError } from '../services/runs.ts';
import type { RunReadSource } from '../services/source.ts';

export const RUNS_ROUTE = { method: 'GET', path: '/api/runs' } as const;
export const RUN_METRICS_ROUTE = { method: 'GET', path: '/api/runs/:runId/metrics' } as const;

function split(request: RouteRequest): { requestId: string | undefined; query: Record<string, string> } {
  const { requestId, ...query } = request.query;
  return { requestId, query };
}

function refusal(error: unknown, requestId: string | undefined) {
  if (error instanceof QueryError) {
    return errorResponse(error.status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED', error.message, { status: error.status, details: [{ path: error.path, reason: error.reason }], requestId });
  }
  // Never echo driver or internal text (§3.1 "Error text").
  return errorResponse('INTERNAL', 'The tiger module failed to answer.', { details: [{ path: '', reason: 'INTERNAL' }], requestId });
}

export function tigerRoutes(source: RunReadSource | null): readonly ModuleRoute[] {
  return Object.freeze([
    {
      ...RUNS_ROUTE,
      async handle(request: RouteRequest) {
        const { requestId, query } = split(request);
        if (source === null) return moduleDisabled(requestId);
        try {
          const q = parseListQuery(query);
          return { status: 200, body: listRuns(await source.listRuns(), q, source.kind) };
        } catch (error) {
          return refusal(error, requestId);
        }
      },
    },
    {
      ...RUN_METRICS_ROUTE,
      async handle(request: RouteRequest) {
        const { requestId, query } = split(request);
        if (source === null) return moduleDisabled(requestId);
        try {
          const runId = request.params.runId ?? '';
          // Checked before any query (§3.5).
          if (!RUN_ID_PATTERN.test(runId)) throw new QueryError(400, 'INVALID_ID', 'runId', 'runId must be a lower-case canonical UUID');
          const q = parseMetricsQuery(query);
          const run = await source.getRun(runId);
          if (run === null || run.rows === null) throw new QueryError(404, 'RUN_NOT_FOUND', 'runId', 'No run with this id.');
          return { status: 200, body: runMetrics(run, run.rows, q, source.kind) };
        } catch (error) {
          return refusal(error, requestId);
        }
      },
    },
  ]);
}
