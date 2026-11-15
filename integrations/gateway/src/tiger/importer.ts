// integrations/gateway/src/tiger/importer.ts
// The batch importer (TIG-04; TIGER_TELEMETRY_AND_INGESTION_RFC.md §5, §9–§11). For each artifact it runs the RFC
// §10 decision procedure, which is always safe to repeat: validate → identity → DT → manifest (written once, before any
// connection) → Q1 → one import transaction, a verification or a conflict → post-commit re-read and digest checks.
// Every state transition is a ledger line. It never opens an artifact for writing and never writes into results/.
// All I/O is injected (repository, manifest store, ledger sink, file list), so this file is the same code for the
// dry-run CLI over the in-memory repository and, later, for pgRepository (D3). It is the tiger module's one XI-2
// bridge to src/telemetry for values.
import {
  buildManifest, canonicalHash, computeIdentity, digestMismatches, digestsFromRows, manifestMismatches,
  normaliseArtifactPath, recordToRows, refusesDevSeed, rowsToRecord, validateRunRecord, VALIDATOR_VERSION,
  type FileForm, type ImportManifestV1, type LedgerLine, type LedgerState, type RecordDigests, type Sha256,
  type SourceKind, type Validation,
} from '../../../../src/telemetry/index.ts';
import { CommitUnknownError, type TigerRepository } from './repository.ts';

// Re-exported for the file stores, so the bridge into src/ stays in this file and repository.ts only.
export { formatLedgerLine, ledgerAppendText, manifestFileName, parseLedger, replayLedger } from '../../../../src/telemetry/index.ts';
export type { ImportManifestV1, LedgerLine } from '../../../../src/telemetry/index.ts';

/** The record type, as the validator returns it (the gateway imports only src/telemetry/index.ts). */
export type ValidRecord = Extract<Validation, { ok: true }>['record'];

/**
 * UUIDv5 namespace for `run_id` (RFC §4.2, TIG-D4), "chosen once at implementation and frozen in hashVersion 1".
 * Chosen for #261. PROVISIONAL until Arnav confirms it: once a database holds rows, changing it means hashVersion 2
 * and a full rebuild (RFC §4.5).
 */
export const ENCORE_TIGER_NS_V1 = '8d3a5e2c-7b41-4c9e-9f06-2a1d4b7c6e53';

/** Injected SHA-1, used only as the RFC 4122 name-to-id mapping (integrity rests on artifactHash). 40 hex. */
export type Sha1 = (data: Uint8Array) => string;

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('not a UUID');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}

/** RFC 4122 §4.3 name-based UUID, version 5. */
export function uuidV5(namespace: string, name: string, sha1: Sha1): string {
  const ns = uuidBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const digest = sha1(input);
  if (!/^[0-9a-f]{40}$/.test(digest)) throw new Error('sha1 must return 40 lower-case hex characters');
  const b = Uint8Array.from({ length: 16 }, (_, i) => parseInt(digest.slice(2 * i, 2 * i + 2), 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function runIdFor(artifactHash: string, sha1: Sha1): string {
  return uuidV5(ENCORE_TIGER_NS_V1, artifactHash, sha1);
}

/** DT at a record's git (RFC §8, TIG-D14 open). `DT_ASSUMED` is a warning (unknown git); `null` dt is a rejection. */
export type DtAnswer = { dt: number; code: null | 'DT_ASSUMED' } | { dt: null; code: 'DT_UNVERIFIABLE' };
export type DtResolver = (git: string) => DtAnswer;

/** The operator vouches that `commits` (40-hex) use `dtSeconds` (read from a params.ts the operator passes). A
 *  `-dirty` record is checked at its 40-hex prefix; an `unknown` record takes `dtSeconds` with DT_ASSUMED. With no
 *  file, every record is DT_UNVERIFIABLE. No git process is spawned (XI-23). */
export function operatorDt(dtSeconds: number | null, commits: readonly string[]): DtResolver {
  const vouched = new Set(commits);
  return git => {
    if (dtSeconds === null) return { dt: null, code: 'DT_UNVERIFIABLE' };
    if (git === 'unknown') return { dt: dtSeconds, code: 'DT_ASSUMED' };
    return vouched.has(git.slice(0, 40)) ? { dt: dtSeconds, code: null } : { dt: null, code: 'DT_UNVERIFIABLE' };
  };
}

/** `export const DT = <number>;` from a params.ts text, or null. */
export function parseDt(paramsSource: string): number | null {
  const match = /^export const DT = ([0-9]+(?:\.[0-9]+)?);/m.exec(paramsSource);
  const dt = match ? Number(match[1]) : NaN;
  return Number.isFinite(dt) && dt > 0 ? dt : null;
}

export interface ArtifactFile {
  /** POSIX, repo-relative label (RFC §5); never opened through a path read from the database. */
  path: string;
  bytes: Uint8Array;
}

export interface ManifestStore {
  read(artifactHash: string): ImportManifestV1 | null;
  /** Atomic; refuses to overwrite an existing manifest. */
  write(manifest: ImportManifestV1): void;
}
export interface LedgerSink { append(line: LedgerLine): void }

export interface ImporterDeps {
  repo: TigerRepository;
  manifests: ManifestStore;
  ledger: LedgerSink;
  sha256: Sha256;
  sha1: Sha1;
  /** Wall clock for ledger `at` and manifest `createdAt` only; never part of a record or identity. */
  now: () => string;
  /** A new UUID v4 per attempt. */
  attemptId: () => string;
  dtFor: DtResolver;
  /** Target schema, for the DEV_SEED policy (`encore` refuses seeds 101–105). */
  schema: string;
  importerVersion: string;
  sourceKind?: SourceKind;
  /** Default: `scenario:<id>` for cli-scenario (TCR-20), null otherwise. */
  compositionOf?: (record: ValidRecord) => string | null;
}

/** The final state of one attempt, with the code that explains it. */
export interface AttemptResult {
  path: string;
  state: LedgerState;
  code: string | null;
  runId: string | null;
  /** True when this attempt stored new rows. */
  inserted: boolean;
}

export interface ImportReport {
  discovered: number;
  imported: number;
  /** Already present and re-verified: zero new rows (RFC §10 case 2a). */
  identical: number;
  rejected: number;
  conflicts: number;
  incomplete: number;
  archived: number;
  /** Rolled back and retryable: still `validated`. */
  retryable: number;
  results: AttemptResult[];
}

export const VERIFIER_VERSION = '1.0.0';
const HASH_VERSION = 1;

/** RFC §11.1: re-read over the repository, recompute digests and the artifact hash, compare with the manifest. */
async function verify(repo: TigerRepository, manifest: ImportManifestV1, sha256: Sha256): Promise<{ ok: boolean; digests: RecordDigests } | null> {
  const stored = await repo.readBack(manifest.runId);
  if (!stored) return null;
  const digests = digestsFromRows(stored.rows, sha256);
  const run = stored.run;
  const identityOk = run.run_id === manifest.runId && run.artifact_hash === manifest.artifactHash && run.experiment_key === manifest.experimentKey
    && run.pair_key === manifest.pairKey && run.git_clean === manifest.gitClean && run.composition_id === manifest.compositionId
    && run.hash_version === manifest.hashVersion && run.dt_seconds === manifest.dtSeconds && run.expected_samples === manifest.expectedSamples
    && run.event_count === manifest.eventCount;
  const ok = identityOk && digestMismatches(manifest, digests).length === 0 && canonicalHash(sha256, rowsToRecord(stored.rows)) === manifest.artifactHash;
  return { ok, digests };
}

/** One attempt for one artifact: the RFC §10 decision procedure. Never throws for a bad artifact. */
export async function importArtifact(file: ArtifactFile, deps: ImporterDeps): Promise<AttemptResult> {
  const attemptId = deps.attemptId();
  const sourceKind = deps.sourceKind ?? 'cli-scenario';
  let state: LedgerState | null = null;
  let artifactHash: string | null = null;
  let experimentKey: string | null = null;
  let runId: string | null = null;
  const step = (to: LedgerState, code: string | null = null, extra: Partial<LedgerLine> = {}) => {
    deps.ledger.append({ ledgerVersion: 1, at: deps.now(), attemptId, artifactHash, experimentKey, runId, from: state, to, code, detail: null, ...extra });
    state = to;
  };
  const done = (code: string | null, inserted = false): AttemptResult => ({ path: file.path, state: state!, code, runId, inserted });

  const label = normaliseArtifactPath(file.path);
  const validation = validateRunRecord(file.bytes, { sourceKind, expectedTicks: 1800 });
  const fileForm: FileForm = validation.ok && validation.fileForm ? validation.fileForm : 'other';
  step('discovered', null, label ? { file: { artifactPath: label, fileSha256: deps.sha256(file.bytes), fileBytes: file.bytes.byteLength, fileForm } } : {});
  if (label === null) { step('rejected', 'BAD_PATH'); return done('BAD_PATH'); }
  if (!validation.ok) { const code = validation.errors[0]?.code ?? 'INVALID'; step('rejected', code); return done(code); }

  const record = validation.record;
  const compositionId = (deps.compositionOf ?? (r => (sourceKind === 'cli-scenario' ? `scenario:${r.scenario}` : null)))(record);
  const id = computeIdentity(record, file.bytes, compositionId, deps.sha256);
  artifactHash = id.artifactHash;
  experimentKey = id.experimentKey;
  runId = runIdFor(id.artifactHash, deps.sha1);
  if (refusesDevSeed(record.seed, deps.schema)) { step('rejected', 'DEV_SEED'); return done('DEV_SEED'); }
  const dt = deps.dtFor(record.git);
  if (dt.dt === null) { step('rejected', 'DT_UNVERIFIABLE'); return done('DT_UNVERIFIABLE'); }

  // Manifest: written once, before any connection; an existing one is reused only if its identity fields match.
  const fresh = buildManifest(id, { artifactPath: label, runId, sourceKind, validatorVersion: VALIDATOR_VERSION, fileForm, dtSeconds: dt.dt, createdAt: deps.now() });
  let existing: ImportManifestV1 | null;
  try {
    existing = deps.manifests.read(id.artifactHash);
  } catch {
    // An unreadable or mismatched manifest file rejects this artifact only; the batch goes on. Never overwritten.
    step('rejected', 'MANIFEST_CORRUPT');
    return done('MANIFEST_CORRUPT');
  }
  if (existing && manifestMismatches(existing, fresh).length > 0) { step('rejected', 'MANIFEST_MISMATCH'); return done('MANIFEST_MISMATCH'); }
  const manifest = existing ?? fresh;
  if (!existing) deps.manifests.write(fresh);
  step('validated', dt.code);

  const repo = deps.repo;
  const settleExisting = async (hit: { runId: string; telemetryState: 'present' | 'archived' }): Promise<AttemptResult> => {
    if (hit.telemetryState === 'archived') { step('archived', 'ARCHIVED'); return done('ARCHIVED'); }
    const checked = await verify(repo, manifest, deps.sha256);
    if (!checked) { step('incomplete', 'VERIFY_MISMATCH'); return done('VERIFY_MISMATCH'); }
    await repo.recordVerification(manifest.runId, checked.digests, checked.ok ? 'verified' : 'mismatch', VERIFIER_VERSION);
    if (checked.ok) { step('verified'); return done(null); }
    step('incomplete', 'VERIFY_MISMATCH');
    return done('VERIFY_MISMATCH');
  };
  const conflict = async (existingRun: { runId: string; artifactHash: string }): Promise<AttemptResult> => {
    await repo.recordConflict(manifest, existingRun);
    step('conflict');
    return done('CONFLICT');
  };

  // Q1
  const hit = await repo.findIdentity(manifest.artifactHash, manifest.experimentKey);
  if (hit.byArtifact) {
    if (hit.byArtifact.experimentKey !== manifest.experimentKey) { step('rejected', 'IDENTITY_MISMATCH'); return done('IDENTITY_MISMATCH'); }
    return settleExisting(hit.byArtifact);
  }
  if (manifest.gitClean && hit.byExperiment) return conflict(hit.byExperiment);

  // One transaction (Q2–Q12)
  let outcome;
  try {
    outcome = await repo.importRun({ rows: recordToRows(record, id, manifest.runId), manifest, importerVersion: deps.importerVersion });
  } catch (error) {
    if (error instanceof CommitUnknownError) { step('incomplete', 'COMMIT_UNKNOWN'); return done('COMMIT_UNKNOWN'); }
    step('validated', 'ROLLED_BACK');
    return done('ROLLED_BACK');
  }
  switch (outcome.kind) {
    case 'identical': return settleExisting({ runId: outcome.runId, telemetryState: 'present' });
    case 'archived': step('archived', 'ARCHIVED'); return done('ARCHIVED');
    case 'conflict': return conflict({ runId: outcome.existingRunId, artifactHash: outcome.existingArtifactHash });
    case 'failed': step('validated', outcome.code); return done(outcome.code);
    case 'imported': break;
  }
  step('imported');
  const checked = await verify(repo, manifest, deps.sha256);
  if (!checked) { step('incomplete', 'VERIFY_MISMATCH'); return done('VERIFY_MISMATCH', true); }
  await repo.recordVerification(manifest.runId, checked.digests, checked.ok ? 'verified' : 'mismatch', VERIFIER_VERSION);
  if (!checked.ok) { step('incomplete', 'VERIFY_MISMATCH'); return done('VERIFY_MISMATCH', true); }
  step('verified');
  return done(null, true);
}

/** Imports the files in the given order (the CLI passes them sorted, like runReport). Sequential (RFC §14). */
export async function importFiles(files: readonly ArtifactFile[], deps: ImporterDeps): Promise<ImportReport> {
  const report: ImportReport = { discovered: 0, imported: 0, identical: 0, rejected: 0, conflicts: 0, incomplete: 0, archived: 0, retryable: 0, results: [] };
  for (const file of files) {
    const result = await importArtifact(file, deps);
    report.discovered++;
    report.results.push(result);
    if (result.state === 'verified') { if (result.inserted) report.imported++; else report.identical++; }
    else if (result.state === 'rejected') report.rejected++;
    else if (result.state === 'conflict') report.conflicts++;
    else if (result.state === 'incomplete') report.incomplete++;
    else if (result.state === 'archived') report.archived++;
    else if (result.state === 'validated') report.retryable++;
  }
  return report;
}

export { HASH_VERSION };
