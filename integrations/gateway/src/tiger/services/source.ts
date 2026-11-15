// integrations/gateway/src/tiger/services/source.ts
// What the read routes need from storage, adapted from the TIG-04 repository seam (`TigerReader`, repository.ts,
// owner durhack-41): run rows, a run's full rows for the metrics route, and the per-run state the database adds
// (verification, conflicts, telemetry state). Read-only by construction: the adapter calls reader methods only.
import type { RunRow, RunRows } from './bridge.ts';
import type { StoredRunRow, TigerReader } from '../repository.ts';
import { LIST_LIMIT_MAX } from '../repository.ts';

/** `source` of the provenance block (analytics RFC §3.2). The offline fake is 'fixture', never 'tiger'. */
export type ReadSourceKind = 'tiger' | 'fixture';

export interface StoredRun {
  readonly run: RunRow;
  /** The run's full rows (metrics by tick, events by index); filled only by `getRun`. */
  readonly rows: RunRows | null;
  /** Ingestion wall-clock time, ISO 8601. */
  readonly importedAt: string | null;
  readonly telemetryState: 'present' | 'archived';
  /** Latest run_verifications outcome (Q17 `table_verification`): 'ok', 'mismatch', or null when none exists. */
  readonly verification: 'ok' | 'mismatch' | null;
  /** An import_conflicts row names this run or its experimentKey. */
  readonly contested: boolean;
}

export interface RunReadSource {
  readonly kind: ReadSourceKind;
  /** Every stored run (rows null). The list service filters, orders (Q17's order) and pages. */
  listRuns(): Promise<readonly StoredRun[]>;
  getRun(runId: string): Promise<StoredRun | null>;
}

/** The record-derived columns only (RunRow), so no import column leaks into a response by accident. */
function recordColumns(row: StoredRunRow): RunRow {
  const { run_id, experiment_key, pair_key, artifact_hash, hash_version, scenario, arm, seed, n0, git_revision, git_clean,
    params_hash, state_hash, composition_id, record_version, expected_samples, event_count, series_digest, events_digest,
    summary_digest } = row;
  return { run_id, experiment_key, pair_key, artifact_hash, hash_version, scenario, arm, seed, n0, git_revision, git_clean,
    params_hash, state_hash, composition_id, record_version, expected_samples, event_count, series_digest, events_digest,
    summary_digest };
}

/** Adapts a `TigerReader` (the Tiger reader role, or the TIG-04 in-memory fake) to the routes' read port. */
export function readSourceFrom(reader: TigerReader, kind: ReadSourceKind): RunReadSource {
  async function stateOf(row: StoredRunRow, conflicts: Awaited<ReturnType<TigerReader['conflicts']>>) {
    const v = await reader.verifications(row.run_id);
    const latest = [...v].sort((a, b) => b.verificationId - a.verificationId)[0];
    // Q17's full condition for 'ok': the latest verification row says 'verified' AND its three digests equal the
    // run's stored digests. Any other latest row is 'mismatch'; no row at all is null ('not-checked').
    const ok = latest !== undefined && latest.outcome === 'verified'
      && latest.digests.seriesDigest === row.series_digest
      && latest.digests.eventsDigest === row.events_digest
      && latest.digests.summaryDigest === row.summary_digest;
    return {
      importedAt: row.imported_at,
      telemetryState: row.telemetry_state,
      verification: latest === undefined ? null : ok ? 'ok' as const : 'mismatch' as const,
      contested: conflicts.some((c) => c.existingRunId === row.run_id || c.experimentKey === row.experiment_key),
    };
  }
  return {
    kind,
    async listRuns() {
      const conflicts = await reader.conflicts();
      const out: StoredRun[] = [];
      let after: string | null = null;
      for (;;) {
        const page = await reader.listRuns({ limit: LIST_LIMIT_MAX, after });
        for (const row of page.runs) out.push({ run: recordColumns(row), rows: null, ...(await stateOf(row, conflicts)) });
        if (page.next === null || page.runs.length === 0) break;
        after = page.next;
      }
      return out;
    },
    async getRun(runId) {
      const stored = await reader.readBack(runId);
      if (stored === null) return null;
      return { run: recordColumns(stored.run), rows: stored.rows, ...(await stateOf(stored.run, await reader.conflicts())) };
    },
  };
}
