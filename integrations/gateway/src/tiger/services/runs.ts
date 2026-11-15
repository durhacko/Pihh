// integrations/gateway/src/tiger/services/runs.ts
// GET /api/runs (analytics RFC §3.3, §3.4): query validation, RunMeta and Provenance, ordering, opaque cursor paging.
import { DT } from './bridge.ts';
import type { StoredRun, ReadSourceKind } from './source.ts';

export interface Provenance {
  source: 'tiger' | 'local-artifact' | 'live-provisional' | 'fixture';
  verified: boolean;
  verification: 'verified' | 'verified-at-import' | 'verified-without-series' | 'mismatch' | 'not-checked' | null;
  importedAt: string | null;
  artifactHash: string | null;
  git: string | null;
  gitClean: boolean | null;
}

export interface RunMeta {
  runId: string; scenario: string; arm: 'encore' | 'static'; seed: number; n0: number;
  git: string; gitClean: boolean; paramsHash: string; compositionId: string | null;
  experimentKey: string; pairKey: string | null; hashVersion: number;
  stateHash: string; recordVersion: 1; expectedSamples: number; dtSeconds: number;
  eventsDigest: string;
  telemetryState: 'present' | 'archived';
  contested: boolean;
  pairable: boolean;
  provenance: Provenance;
}

export interface RunListResponse { items: RunMeta[]; nextCursor: string | null }

/** A refusal the route turns into the XI-3 envelope. */
export class QueryError extends Error {
  readonly status: number; readonly reason: string; readonly path: string;
  constructor(status: number, reason: string, path: string, message: string) {
    super(message);
    this.status = status; this.reason = reason; this.path = path;
  }
}

/**
 * Provenance (§3.2). For the Tiger source on the list route, Q17's verification maps to 'verified-at-import'
 * (present) or 'verified-without-series' (archived), else 'mismatch' / 'not-checked'. The offline fake is
 * `source: 'fixture'` with `verified: false` and `verification: null`: it is never presented as Tiger or as live.
 */
export function provenanceOf(run: StoredRun, kind: ReadSourceKind, verification: Provenance['verification']): Provenance {
  const r = run.run;
  if (kind === 'fixture') {
    return { source: 'fixture', verified: false, verification: null, importedAt: null, artifactHash: r.artifact_hash, git: r.git_revision, gitClean: r.git_clean };
  }
  const verified = verification === 'verified' || verification === 'verified-at-import';
  return { source: 'tiger', verified, verification, importedAt: run.importedAt, artifactHash: r.artifact_hash, git: r.git_revision, gitClean: r.git_clean };
}

export function listVerification(run: StoredRun): Provenance['verification'] {
  if (run.verification === 'ok') return run.telemetryState === 'archived' ? 'verified-without-series' : 'verified-at-import';
  return run.verification === 'mismatch' ? 'mismatch' : 'not-checked';
}

export function runMetaOf(run: StoredRun, kind: ReadSourceKind, verification: Provenance['verification']): RunMeta {
  const r = run.run;
  return {
    runId: r.run_id, scenario: r.scenario, arm: r.arm, seed: r.seed, n0: r.n0,
    git: r.git_revision, gitClean: r.git_clean, paramsHash: r.params_hash, compositionId: r.composition_id,
    experimentKey: r.experiment_key, pairKey: r.pair_key, hashVersion: r.hash_version,
    stateHash: r.state_hash, recordVersion: 1, expectedSamples: r.expected_samples, dtSeconds: DT,
    eventsDigest: r.events_digest,
    telemetryState: run.telemetryState,
    contested: run.contested,
    pairable: r.composition_id !== null && r.pair_key !== null && r.git_clean,
    provenance: provenanceOf(run, kind, verification),
  };
}

// ---------- query validation (§3.4 table) ----------

const LIST_PARAMS = ['scenario', 'seed', 'arm', 'n0', 'git', 'paramsHash', 'compositionId', 'telemetry', 'includeConflicts', 'includeDirty', 'limit', 'cursor'];

export interface ListQuery {
  scenario?: string; seed?: number; arm?: 'encore' | 'static'; n0?: number; git?: string; paramsHash?: string;
  compositionId?: string; telemetry: 'present' | 'archived' | 'any'; includeConflicts: boolean; includeDirty: boolean;
  limit: number; after: SortKey | null;
}

type SortKey = [scenario: string, n0: number, seed: number, arm: string, runId: string];

const bad = (path: string, message: string) => new QueryError(400, 'INVALID_QUERY', path, message);

function integerIn(raw: string, path: string, min: number, max: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw bad(path, `${path} must be an integer in ${min}..${max}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw bad(path, `${path} must be an integer in ${min}..${max}`);
  return n;
}

function bool(raw: string, path: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw bad(path, `${path} must be true or false`);
}

export function parseListQuery(query: Readonly<Record<string, string>>): ListQuery {
  for (const key of Object.keys(query)) if (!LIST_PARAMS.includes(key)) throw bad(key, 'unknown query parameter');
  const q: ListQuery = { telemetry: 'present', includeConflicts: false, includeDirty: false, limit: 50, after: null };
  const v = (k: string) => query[k];
  if (v('scenario') !== undefined) { if (!/^S[0-9]{1,2}$/.test(v('scenario')!)) throw bad('scenario', 'scenario must match S<1-2 digits>'); q.scenario = v('scenario'); }
  if (v('seed') !== undefined) q.seed = integerIn(v('seed')!, 'seed', 0, 4_294_967_295);
  if (v('arm') !== undefined) { const a = v('arm'); if (a !== 'encore' && a !== 'static') throw bad('arm', 'arm must be encore or static'); q.arm = a; }
  if (v('n0') !== undefined) q.n0 = integerIn(v('n0')!, 'n0', 1, 10_000);
  if (v('git') !== undefined) { if (!/^([0-9a-f]{40}(-dirty)?|unknown)$/.test(v('git')!)) throw bad('git', 'git must be a 40-hex revision, optionally -dirty, or unknown'); q.git = v('git'); }
  if (v('paramsHash') !== undefined) { if (!/^[0-9a-f]{64}$/.test(v('paramsHash')!)) throw bad('paramsHash', 'paramsHash must be 64 lower-case hex'); q.paramsHash = v('paramsHash'); }
  if (v('compositionId') !== undefined) { const c = v('compositionId')!; if (c.length > 128 || !/^[A-Za-z0-9:_.-]+$/.test(c)) throw bad('compositionId', 'compositionId must be ≤ 128 of [A-Za-z0-9:_.-]'); q.compositionId = c; }
  if (v('telemetry') !== undefined) { const t = v('telemetry'); if (t !== 'present' && t !== 'archived' && t !== 'any') throw bad('telemetry', 'telemetry must be present, archived or any'); q.telemetry = t; }
  if (v('includeConflicts') !== undefined) q.includeConflicts = bool(v('includeConflicts')!, 'includeConflicts');
  if (v('includeDirty') !== undefined) q.includeDirty = bool(v('includeDirty')!, 'includeDirty');
  if (v('limit') !== undefined) q.limit = integerIn(v('limit')!, 'limit', 1, 200);
  if (v('cursor') !== undefined) q.after = decodeCursor(v('cursor')!);
  return q;
}

// ---------- ordering and cursor (Q17: ORDER BY scenario, n0, seed, arm, run_id) ----------

function keyOf(run: StoredRun): SortKey {
  const r = run.run;
  return [r.scenario, r.n0, r.seed, r.arm, r.run_id];
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as string | number, y = b[i] as string | number;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function encodeCursor(key: SortKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): SortKey {
  const invalid = new QueryError(400, 'INVALID_CURSOR', 'cursor', 'cursor is not one this gateway issued');
  if (raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw invalid; }
  if (!Array.isArray(value) || value.length !== 5) throw invalid;
  const [s, n0, seed, arm, id] = value as unknown[];
  if (typeof s !== 'string' || typeof arm !== 'string' || typeof id !== 'string' || !Number.isSafeInteger(n0) || !Number.isSafeInteger(seed)) throw invalid;
  return [s, n0 as number, seed as number, arm, id];
}

export function listRuns(runs: readonly StoredRun[], q: ListQuery, kind: ReadSourceKind): RunListResponse {
  const matching = runs.filter((run) => {
    const r = run.run;
    if (q.scenario !== undefined && r.scenario !== q.scenario) return false;
    if (q.seed !== undefined && r.seed !== q.seed) return false;
    if (q.arm !== undefined && r.arm !== q.arm) return false;
    if (q.n0 !== undefined && r.n0 !== q.n0) return false;
    if (q.git !== undefined && r.git_revision !== q.git) return false;
    if (q.paramsHash !== undefined && r.params_hash !== q.paramsHash) return false;
    if (q.compositionId !== undefined && r.composition_id !== q.compositionId) return false;
    if (q.telemetry !== 'any' && run.telemetryState !== q.telemetry) return false;
    if (!q.includeDirty && !r.git_clean) return false;
    if (!q.includeConflicts && run.contested) return false;
    return true;
  }).sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  const after = q.after;
  const start = after === null ? matching : matching.filter((run) => compareKeys(keyOf(run), after) > 0);
  const page = start.slice(0, q.limit);
  const more = start.length > page.length;
  const last = page[page.length - 1];
  return {
    items: page.map((run) => runMetaOf(run, kind, listVerification(run))),
    nextCursor: more && last ? encodeCursor(keyOf(last)) : null,
  };
}
