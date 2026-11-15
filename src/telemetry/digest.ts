// src/telemetry/digest.ts
// Hashing helpers and the three row-verification digests (RFC §4.2, §11). sha256 is injected, so this module has
// no node:crypto and runs in Node or the browser. Every hash is sha256 over UTF-8 canonical JSON, 64 lower-case hex.
import type { RunRecord } from '../contracts/metrics';
import { canonicalJson } from '../score/canonical';
import { rowsToRecord, type RunRows } from './normalise';

/** Injected sha256: returns 64 lower-case hex characters. A string is hashed as its UTF-8 bytes. */
export type Sha256 = (data: string | Uint8Array) => string;

const HEX64 = /^[0-9a-f]{64}$/;

/** Calls `sha256` and checks its output shape, so a wrong injection fails loudly instead of storing garbage. */
export function hashOf(sha256: Sha256, data: string | Uint8Array): string {
  const hex = sha256(data);
  if (typeof hex !== 'string' || !HEX64.test(hex)) throw new Error('sha256 must return 64 lower-case hex characters');
  return hex;
}

/** sha256(canonicalJson(value)). */
export function canonicalHash(sha256: Sha256, value: unknown): string {
  return hashOf(sha256, canonicalJson(value));
}

export interface RecordDigests { seriesDigest: string; eventsDigest: string; summaryDigest: string }

export function recordDigests(record: RunRecord, sha256: Sha256): RecordDigests {
  return {
    seriesDigest: canonicalHash(sha256, record.series),
    eventsDigest: canonicalHash(sha256, record.events),
    summaryDigest: canonicalHash(sha256, record.summary),
  };
}

/** RFC §11.1: the digests recomputed from stored rows (series by tick, events by event_index, summary_json), to
 *  compare with the manifest. The re-read itself is the gateway's. */
export function digestsFromRows(rows: RunRows, sha256: Sha256): RecordDigests {
  return recordDigests(rowsToRecord(rows), sha256);
}

/** The names of the digests that differ (RFC §11: a re-read whose digests differ is a `mismatch`). */
export function digestMismatches(expected: RecordDigests, actual: RecordDigests): (keyof RecordDigests)[] {
  return (['seriesDigest', 'eventsDigest', 'summaryDigest'] as const).filter(name => expected[name] !== actual[name]);
}
