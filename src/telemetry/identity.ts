// src/telemetry/identity.ts
// Canonical identity, `hashVersion` 1 (RFC §4; TD-4, TCR-13, TCR-14). Pure: sha256 is injected. `hashVersion` fixes
// the canonical-JSON rules, the input object shapes below, the hash algorithm and the run_id namespace; any change
// is `hashVersion` 2 and a full rebuild (RFC §4.5). `run_id` (UUIDv5 from `artifactHash`) needs SHA-1, so the
// gateway computes it (TIG-02); it is not part of this module.
import type { RunRecord } from '../contracts/metrics';
import { canonicalHash, hashOf, recordDigests, type Sha256 } from './digest';

export const HASH_VERSION = 1 as const;

export interface RunIdentity {
  hashVersion: typeof HASH_VERSION;
  /** sha256 of the raw file bytes (first observation; differs from artifactHash for CLI files, TCR-13). */
  fileSha256: string;
  /** Size of those bytes (first observation, RFC §5). */
  fileBytes: number;
  /** sha256(canonicalJson(record)): one artifact, one hash. */
  artifactHash: string;
  /** Inputs identity: sha256(canonicalJson({hashVersion, scenario, seed, arm, n0, git, paramsHash, events, compositionId})). */
  experimentKey: string;
  /** The same object without `arm`; null when there is no composition identity (storable, not pairable). */
  pairKey: string | null;
  compositionId: string | null;
  /** `git` is exactly 40 hex: no `-dirty`, not `unknown` (RFC §4.3). */
  gitClean: boolean;
  seriesDigest: string;
  eventsDigest: string;
  summaryDigest: string;
  /** series.length and events.length (RFC §5 derived fields). */
  expectedSamples: number;
  eventCount: number;
}

const COMPOSITION_ID = /^(scenario:[A-Za-z0-9_-]{1,32}|sceneHash:[0-9a-f]{64}|contentHash:[0-9a-f]{64})$/;

/** `compositionId` for a CLI scenario record: `scenario:<id>` (RFC §4.2; meaningful only together with `git`). */
export function scenarioCompositionId(record: Pick<RunRecord, 'scenario'>): string {
  return `scenario:${record.scenario}`;
}

export function isGitClean(git: string): boolean {
  return /^[0-9a-f]{40}$/.test(git);
}

function keyObject(record: RunRecord, compositionId: string | null, withArm: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    hashVersion: HASH_VERSION, scenario: record.scenario, seed: record.seed, n0: record.n0, git: record.git,
    paramsHash: record.paramsHash, events: record.events, compositionId,
  };
  if (withArm) base.arm = record.arm;
  return base;
}

/** `experimentKey` for a record (RFC §4.2). */
export function experimentKeyOf(record: RunRecord, compositionId: string | null, sha256: Sha256): string {
  return canonicalHash(sha256, keyObject(record, compositionId, true));
}

/** `pairKey`: two runs are a fair pair iff their pairKeys are equal (non-null) and their arms differ. */
export function pairKeyOf(record: RunRecord, compositionId: string | null, sha256: Sha256): string | null {
  return compositionId === null ? null : canonicalHash(sha256, keyObject(record, compositionId, false));
}

/**
 * The identity of a validated record and the file it came from. `bytes` are the raw file bytes; `record` must be the
 * record `validateRunRecord` returned for them. Neither is mutated.
 */
export function computeIdentity(record: RunRecord, bytes: Uint8Array, compositionId: string | null, sha256: Sha256): RunIdentity {
  if (compositionId !== null && !COMPOSITION_ID.test(compositionId)) throw new Error('computeIdentity: malformed compositionId');
  return {
    hashVersion: HASH_VERSION,
    fileSha256: hashOf(sha256, bytes),
    fileBytes: bytes.byteLength,
    artifactHash: canonicalHash(sha256, record),
    experimentKey: experimentKeyOf(record, compositionId, sha256),
    pairKey: pairKeyOf(record, compositionId, sha256),
    compositionId,
    gitClean: isGitClean(record.git),
    ...recordDigests(record, sha256),
    expectedSamples: record.series.length,
    eventCount: record.events.length,
  };
}

/** Q2's advisory-lock key for an `experimentKey` (RFC §9): the first 16 hex digits as a signed 64-bit integer, the
 *  client equivalent of `('x' || substr(key, 1, 16))::bit(64)::bigint`. */
export function advisoryLockKey(experimentKey: string): bigint {
  if (!/^[0-9a-f]{64}$/.test(experimentKey)) throw new Error('advisoryLockKey: experimentKey must be 64 hex');
  return BigInt.asIntN(64, BigInt(`0x${experimentKey.slice(0, 16)}`));
}

/** True iff `a` and `b` are a fair pair under hashVersion 1: equal non-null pairKeys and different arms. */
export function isFairPair(a: Pick<RunIdentity, 'pairKey'> & { arm: string }, b: Pick<RunIdentity, 'pairKey'> & { arm: string }): boolean {
  return a.pairKey !== null && a.pairKey === b.pairKey && a.arm !== b.arm;
}
