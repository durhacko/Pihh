// integrations/gateway/src/tiger/repository.ts
// The repository seam (TIGER_TELEMETRY_AND_INGESTION_RFC.md §1, §9–§11; TIG-04). The importer and the read routes
// reach the database only through these interfaces. `fakeRepository.ts` implements them in memory with the DDL's
// unique keys and all-or-nothing transactions; `pgRepository.ts` (TIG-03 live, D3) will implement the same contract
// and must pass the same suite (test/tiger/repository.contract.test.ts). Types only: no driver, no I/O.
import type { ImportManifestV1, RecordDigests, RunRow, RunRows } from '../../../../src/telemetry/index.ts';

export type TelemetryState = 'present' | 'archived';

/** The `experiment_runs` columns that do not come from the record (RFC §6.1): from the manifest as first written
 *  (first observation) and from the importer. Stored once, at the first successful import, never updated. */
export interface ImportColumns {
  manifest_version: number;
  validator_version: string;
  importer_version: string;
  source_kind: ImportManifestV1['sourceKind'];
  artifact_path: string;
  file_bytes: number;
  file_sha256: string;
  dt_seconds: number;
}

/** One stored `experiment_runs` row: record-derived columns, import columns and the database's own. */
export type StoredRunRow = RunRow & ImportColumns & { telemetry_state: TelemetryState; imported_at: string };

/** Everything the database holds for one run, read back over a fresh connection (Q10–Q12, Q14), ordered:
 *  metrics by tick, events by event_index. `rows.run` holds the record-derived columns only. */
export interface StoredRun {
  run: StoredRunRow;
  rows: RunRows;
}

/** Q1 (RFC §10 step 2): what already exists for an artifact and its experiment. */
export interface IdentityHit {
  /** The row with this `artifact_hash`, if any (cases a, a′, c). */
  byArtifact: { runId: string; experimentKey: string; telemetryState: TelemetryState } | null;
  /** A CLEAN-git row with this `experiment_key` and a different artifact (case b), if any. */
  byExperiment: { runId: string; artifactHash: string } | null;
}

export type ImportOutcome =
  | { kind: 'imported'; runId: string }
  | { kind: 'identical'; runId: string }                                             // Q1 under the lock found the same artifactHash
  | { kind: 'archived'; runId: string }                                              // … and its telemetry is archived (case a′)
  | { kind: 'conflict'; experimentKey: string; existingRunId: string; existingArtifactHash: string }   // clean git only; never overwritten
  | { kind: 'failed'; code: string };                                                // rolled back: zero rows; `code` is sanitised

export interface ImportInput {
  rows: RunRows;
  manifest: ImportManifestV1;
  /** Gateway package version plus its git (RFC §6.1 importer_version). */
  importerVersion: string;
}

export interface VerificationRow {
  verificationId: number;
  runId: string;
  verifiedAt: string;
  verifierVersion: string;
  digests: RecordDigests;
  outcome: 'verified' | 'mismatch';
}

export interface ConflictRow {
  conflictId: number;
  hashVersion: number;
  experimentKey: string;
  existingRunId: string;
  existingArtifactHash: string;
  incomingArtifactHash: string;
  incomingFileSha256: string;
  incomingArtifactPath: string;
  detectedAt: string;
}

export interface RunPage { runs: StoredRunRow[]; next: string | null }

/** The reader role (encore_reader, RFC §13): what the analytics routes (TIG-06) may use. Read-only. */
export interface TigerReader {
  /** Runs ordered by run_id; `after` is the last run_id of the previous page. `limit` is 1–200. */
  listRuns(query: { limit: number; after?: string | null }): Promise<RunPage>;
  readBack(runId: string): Promise<StoredRun | null>;
  verifications(runId: string): Promise<VerificationRow[]>;
  conflicts(): Promise<ConflictRow[]>;
}

/** The importer role (encore_importer): INSERT only, never UPDATE, DELETE or TRUNCATE (RFC §13). */
export interface TigerRepository extends TigerReader {
  findIdentity(artifactHash: string, experimentKey: string): Promise<IdentityHit>;   // Q1
  /** One transaction: Q2 (advisory lock on experimentKey), Q1 again under the lock, Q3–Q6 inserts, Q7–Q12 checks,
   *  COMMIT only if every check passes. Any failure rolls back to zero rows for the run. */
  importRun(input: ImportInput): Promise<ImportOutcome>;
  /** Q13: append-only; a row is never updated or removed. */
  recordVerification(runId: string, digests: RecordDigests, outcome: 'verified' | 'mismatch', verifierVersion: string): Promise<void>;
  /** Q15: idempotent on (hash_version, experiment_key, incoming_artifact_hash); never touches the existing run. */
  recordConflict(manifest: ImportManifestV1, existing: { runId: string; artifactHash: string }): Promise<void>;
}

export const LIST_LIMIT_MAX = 200;
