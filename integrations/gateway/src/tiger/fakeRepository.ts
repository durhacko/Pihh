// integrations/gateway/src/tiger/fakeRepository.ts
// An in-memory TigerRepository (TIG-04; evaluation "Mocked TigerRepository"). It enforces the same unique keys as the
// RFC §6 DDL (artifact_hash; experiment_key among clean-git runs; (run_id, sample_time); (run_id, event_index); the
// import_conflicts key) and the row CHECKs, applies a transaction all or nothing, keeps run_verifications append-only,
// and never returns a value it was not given (every read is a deep copy). Fault hooks inject the T11 failures.
// It is a test and dry-run double: nothing it holds is ever "imported into Tiger".
import type {
  ConflictRow, IdentityHit, ImportInput, ImportOutcome, RunPage, StoredRun, StoredRunRow, TelemetryState,
  TigerRepository, VerificationRow,
} from './repository.ts';
import { CommitUnknownError, LIST_LIMIT_MAX } from './repository.ts';

/** T11 fault injection. Each fault applies to the next importRun only, then clears. */
export interface FakeFaults {
  /** Throw after this many metric rows were staged (the transaction rolls back). */
  failAfterMetricRows?: number;
  /** Fail one in-transaction check (Q7–Q12): rolls back with `failed` / `CHECK_FAILED`. */
  failCheck?: boolean;
  /** COMMIT succeeds but its acknowledgement is lost: the rows are stored and importRun throws CommitUnknownError. */
  loseCommitAck?: boolean;
}

interface Stored { run: StoredRunRow; rows: StoredRun['rows'] }

const HEX64 = /^[0-9a-f]{64}$/;
const PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SYNTHETIC_EPOCH_MS = 1_577_836_800_000;

function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(out, key, { value: copy((value as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
    }
    return out as T;
  }
  return value;
}

class CheckFailed extends Error {
  readonly check: string;
  constructor(check: string) {
    super(check);
    this.check = check;
    this.name = 'CheckFailed';
  }
}

/** The DDL CHECKs and the Q7–Q12 in-transaction checks, over one staged run. Throws CheckFailed. */
function checkRun(stored: Stored): void {
  const { run, rows } = stored;
  const need = (ok: boolean, check: string) => { if (!ok) throw new CheckFailed(check); };
  need(HEX64.test(run.experiment_key) && HEX64.test(run.artifact_hash) && HEX64.test(run.file_sha256) && HEX64.test(run.params_hash), 'hex columns');
  need(run.pair_key === null || HEX64.test(run.pair_key), 'pair_key');
  need((run.composition_id === null) === (run.pair_key === null), 'composition_id ⇔ pair_key');
  need(run.git_clean === /^[0-9a-f]{40}$/.test(run.git_revision), 'git_clean');
  need(run.arm === 'encore' || run.arm === 'static', 'arm');
  need(Number.isSafeInteger(run.seed) && run.seed >= 0 && run.seed <= 4_294_967_295, 'seed');
  need(Number.isSafeInteger(run.n0) && run.n0 > 0, 'n0');
  need(run.dt_seconds === 0.05, 'dt_seconds');
  need(run.record_version === 1 && run.hash_version >= 1 && run.manifest_version >= 1, 'versions');
  need(run.file_bytes > 0, 'file_bytes');
  need(PATH.test(run.artifact_path) && !/(^|\/)\.\.(\/|$)/.test(run.artifact_path), 'artifact_path');
  need(run.source_kind === 'cli-scenario' || run.source_kind === 'app-export', 'source_kind');
  // Q7–Q9: counts equal the run row
  need(rows.metrics.length === run.expected_samples, 'Q7 sample count');
  need(rows.events.length === run.event_count, 'Q8 event count');
  need(rows.summary.run_id === run.run_id, 'Q9 summary');
  const ticks = new Set<number>();
  for (const m of rows.metrics) {
    need(m.run_id === run.run_id, 'metric run_id');
    need(Number.isSafeInteger(m.tick) && m.tick >= 0 && m.tick % 5 === 0, 'tick');
    need(m.sample_time === SYNTHETIC_EPOCH_MS + m.tick * 50, 'sample_time = synthetic_time(tick)');
    need(!ticks.has(m.tick), 'PK (run_id, sample_time)');
    ticks.add(m.tick);
    need(m.alive >= 0 && m.coverage >= 0 && m.coverage <= 1 && m.dup_slots >= 0, 'metric ranges');
    need(m.pwc >= 0 && m.pwc <= 1 + 1e-9, 'pwc');
    need((m.alive === 0) === (m.npwc === null), '(alive = 0) = (npwc IS NULL)');
    need(m.npwc === null || m.npwc >= 0, 'npwc ≥ 0');
    need(m.alive > 0 || (m.sf_mean === null && m.sf_max === null), 'sf null at alive 0');
    need(typeof m.versions === 'object' && m.versions !== null && !Array.isArray(m.versions), 'versions object');
    need(Math.min(m.hb_total, m.score_total, m.delivered_total, m.lost_total, m.blocked_total, m.collisions_total, m.near_misses_total, m.slot_changes_total) >= 0, 'counters ≥ 0');
  }
  const indexes = new Set<number>();
  for (const e of rows.events) {
    need(e.run_id === run.run_id, 'event run_id');
    need(Number.isSafeInteger(e.event_index) && e.event_index >= 0 && !indexes.has(e.event_index), 'PK (run_id, event_index)');
    indexes.add(e.event_index);
    need(e.details.type === e.event_type && e.details.tick === e.tick && e.tick >= 0, 'event details');
  }
  need(typeof rows.summary.summary_json === 'object' && rows.summary.summary_json !== null, 'summary_json object');
}

export interface FakeRepository extends TigerRepository {
  /** Next importRun only. */
  inject(faults: FakeFaults): void;
  /** Owner tools (not the importer role): Q16 archive and Q16b restore. */
  owner: {
    archive(runId: string): void;
    restore(runId: string, rows: StoredRun['rows']): void;
  };
  /** Row counts, for tests and the dry-run report. */
  counts(): { runs: number; metrics: number; events: number; summaries: number; verifications: number; conflicts: number };
}

/** `now` supplies the database's own timestamps (imported_at, verified_at, detected_at): wall clock in real use. */
export function createFakeRepository(now: () => string): FakeRepository {
  const runs = new Map<string, Stored>();
  const byArtifact = new Map<string, string>();
  const byCleanExperiment = new Map<string, string>();
  const verifications: VerificationRow[] = [];
  const conflictRows: ConflictRow[] = [];
  let faults: FakeFaults = {};

  function identity(artifactHash: string, experimentKey: string): IdentityHit {
    const runId = byArtifact.get(artifactHash);
    const hit = runId ? runs.get(runId) : undefined;
    const expRun = byCleanExperiment.get(experimentKey);
    const exp = expRun ? runs.get(expRun) : undefined;
    return {
      byArtifact: hit ? { runId: hit.run.run_id, experimentKey: hit.run.experiment_key, telemetryState: hit.run.telemetry_state } : null,
      byExperiment: exp && exp.run.artifact_hash !== artifactHash ? { runId: exp.run.run_id, artifactHash: exp.run.artifact_hash } : null,
    };
  }

  const repo: FakeRepository = {
    async findIdentity(artifactHash, experimentKey) {
      return identity(artifactHash, experimentKey);
    },

    async importRun(input: ImportInput): Promise<ImportOutcome> {
      const active = faults;
      faults = {};
      const { manifest, rows } = input;
      // Q2 is a no-op here (single-threaded); Q1 again "under the lock".
      const hit = identity(manifest.artifactHash, manifest.experimentKey);
      if (hit.byArtifact) {
        return hit.byArtifact.telemetryState === 'archived' ? { kind: 'archived', runId: hit.byArtifact.runId } : { kind: 'identical', runId: hit.byArtifact.runId };
      }
      if (manifest.gitClean && hit.byExperiment) {
        return { kind: 'conflict', experimentKey: manifest.experimentKey, existingRunId: hit.byExperiment.runId, existingArtifactHash: hit.byExperiment.artifactHash };
      }
      // Stage the whole transaction; nothing is visible until every check passes.
      try {
        const staged: Stored = {
          run: {
            ...copy(rows.run),
            manifest_version: manifest.manifestVersion,
            validator_version: manifest.validatorVersion,
            importer_version: input.importerVersion,
            source_kind: manifest.sourceKind,
            artifact_path: manifest.artifactPath,
            file_bytes: manifest.fileBytes,
            file_sha256: manifest.fileSha256,
            dt_seconds: manifest.dtSeconds,
            telemetry_state: 'present',
            imported_at: now(),
          },
          rows: { run: copy(rows.run), metrics: [], events: copy(rows.events), summary: copy(rows.summary) },
        };
        for (const [i, metric] of rows.metrics.entries()) {
          if (active.failAfterMetricRows !== undefined && i === active.failAfterMetricRows) throw new Error('injected fault');
          staged.rows.metrics.push(copy(metric));
        }
        if (staged.run.run_id !== manifest.runId || staged.run.artifact_hash !== manifest.artifactHash || staged.run.experiment_key !== manifest.experimentKey) {
          throw new CheckFailed('rows and manifest disagree');
        }
        if (runs.has(staged.run.run_id)) throw new CheckFailed('PK run_id');
        checkRun(staged);
        if (active.failCheck) throw new CheckFailed('injected check');
        // COMMIT
        runs.set(staged.run.run_id, staged);
        byArtifact.set(staged.run.artifact_hash, staged.run.run_id);
        if (staged.run.git_clean) byCleanExperiment.set(staged.run.experiment_key, staged.run.run_id);
      } catch (error) {
        if (error instanceof CheckFailed) return { kind: 'failed', code: 'CHECK_FAILED' };
        return { kind: 'failed', code: 'ROLLED_BACK' };
      }
      if (active.loseCommitAck) throw new CommitUnknownError();
      return { kind: 'imported', runId: manifest.runId };
    },

    async recordVerification(runId, digests, outcome, verifierVersion) {
      if (!runs.has(runId)) throw new Error('FK run_verifications.run_id');
      for (const d of [digests.seriesDigest, digests.eventsDigest, digests.summaryDigest]) if (!HEX64.test(d)) throw new Error('digest CHECK');
      verifications.push({ verificationId: verifications.length + 1, runId, verifiedAt: now(), verifierVersion, digests: copy(digests), outcome });
    },

    async recordConflict(manifest, existing) {
      if (!runs.has(existing.runId)) throw new Error('FK import_conflicts.existing_run_id');
      if (existing.artifactHash === manifest.artifactHash) throw new Error('CHECK existing <> incoming');
      const duplicate = conflictRows.some(c => c.hashVersion === manifest.hashVersion && c.experimentKey === manifest.experimentKey && c.incomingArtifactHash === manifest.artifactHash);
      if (duplicate) return;   // ON CONFLICT DO NOTHING: the correctness decision was already made by Q1 (RFC §10 Q15)
      conflictRows.push({
        conflictId: conflictRows.length + 1, hashVersion: manifest.hashVersion, experimentKey: manifest.experimentKey,
        existingRunId: existing.runId, existingArtifactHash: existing.artifactHash, incomingArtifactHash: manifest.artifactHash,
        incomingFileSha256: manifest.fileSha256, incomingArtifactPath: manifest.artifactPath, detectedAt: now(),
      });
    },

    async listRuns({ limit, after }): Promise<RunPage> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) throw new Error(`limit must be 1–${LIST_LIMIT_MAX}`);
      const ids = [...runs.keys()].sort().filter(id => after == null || id > after);
      const page = ids.slice(0, limit);
      return { runs: page.map(id => copy(runs.get(id)!.run)), next: ids.length > limit ? page.at(-1)! : null };
    },

    async readBack(runId) {
      const stored = runs.get(runId);
      if (!stored) return null;
      const rows = copy(stored.rows);
      rows.metrics.sort((a, b) => a.tick - b.tick);
      rows.events.sort((a, b) => a.event_index - b.event_index);
      return { run: copy(stored.run), rows };
    },

    async verifications(runId) {
      return verifications.filter(v => v.runId === runId).map(copy);
    },

    async conflicts() {
      return conflictRows.map(copy);
    },

    inject(next) {
      faults = { ...next };
    },

    owner: {
      archive(runId) {
        const stored = runs.get(runId);
        if (!stored) throw new Error('no such run');
        stored.rows.metrics = [];
        stored.run.telemetry_state = 'archived' satisfies TelemetryState;
      },
      restore(runId, rows) {
        const stored = runs.get(runId);
        if (!stored || stored.run.telemetry_state !== 'archived') throw new Error('not archived');
        stored.rows.metrics = copy(rows.metrics);
        stored.run.telemetry_state = 'present';
      },
    },

    counts() {
      let metrics = 0;
      let events = 0;
      for (const s of runs.values()) { metrics += s.rows.metrics.length; events += s.rows.events.length; }
      return { runs: runs.size, metrics, events, summaries: runs.size, verifications: verifications.length, conflicts: conflictRows.length };
    },
  };
  return repo;
}
