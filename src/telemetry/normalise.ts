// src/telemetry/normalise.ts
// RunRecord ⇄ database rows (RFC §6.6). Row field names are the RFC §6 DDL column names, so the gateway maps them
// to SQL parameters one to one. It never recalculates a metric and never mutates the record; `rowsToRecord` is the
// exact inverse (absent stays absent, null stays null), which verification (§11) and report reconstruction use.
//
// Columns the record cannot supply are the gateway's, from the manifest and the import (RFC §6.1):
// manifest_version, validator_version, importer_version, source_kind, dt_seconds, telemetry_state (default
// 'present') and imported_at (default now()), plus the first-observation columns artifact_path, file_bytes and
// file_sha256, which come from the manifest as first written (RFC §5), never from the bytes of a later attempt.
// `RunRow` leaves them out on purpose.
import type { MetricsSample, RunRecord } from '../contracts/metrics';
import type { EnvEvent } from '../contracts/world';
import type { RunIdentity } from './identity';

/** RFC §8: 2020-01-01T00:00:00Z in ms. */
export const SYNTHETIC_EPOCH_MS = 1_577_836_800_000;
/** RFC §8 and `encore.synthetic_time`: 50 ms per tick, a guarded duplicate of DT = 0.05 s. */
export const SYNTHETIC_MS_PER_TICK = 50;

/** SYNTHETIC sample time in ms since the Unix epoch (RFC §8): never wall clock. */
export function syntheticSampleTimeMs(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('syntheticSampleTimeMs: tick must be an integer ≥ 0');
  return SYNTHETIC_EPOCH_MS + tick * SYNTHETIC_MS_PER_TICK;
}

/** `experiment_runs` columns derived from the record and its identity (§6.1). */
export interface RunRow {
  run_id: string;
  experiment_key: string;
  pair_key: string | null;
  artifact_hash: string;
  hash_version: number;
  scenario: string;
  arm: 'encore' | 'static';
  seed: number;
  n0: number;
  git_revision: string;
  git_clean: boolean;
  params_hash: string;
  state_hash: string;
  composition_id: string | null;
  record_version: number;
  expected_samples: number;
  event_count: number;
  series_digest: string;
  events_digest: string;
  summary_digest: string;
}

/** `simulation_metrics` (§6.2). `sample_time` is the synthetic ms value; the database recomputes it from `tick`. */
export interface MetricRow {
  sample_time: number;
  run_id: string;
  tick: number;
  alive: number;
  coverage: number;
  pwc: number;
  npwc: number | null;
  sf_mean: number | null;
  sf_max: number | null;
  dup_slots: number;
  versions: Record<string, number>;
  hb_total: number;
  score_total: number;
  delivered_total: number;
  lost_total: number;
  blocked_total: number;
  collisions_total: number;
  near_misses_total: number;
  slot_changes_total: number;
}

/** `simulation_events` (§6.3): `details` is the complete event, verbatim. */
export interface EventRow {
  run_id: string;
  event_index: number;
  tick: number;
  event_type: EnvEvent['type'];
  details: EnvEvent;
}

/** `run_summaries` (§6.4): every key kept, nulls kept, an absent `tRec` stays absent. */
export interface SummaryRow {
  run_id: string;
  summary_json: Record<string, number | null>;
}

export interface RunRows { run: RunRow; metrics: MetricRow[]; events: EventRow[]; summary: SummaryRow }

/** A deep copy of JSON data, so rows never alias the record (and the record never aliases rows). Keys are defined
 *  as own data properties (CreateDataProperty), so an own `__proto__` key is copied as data: it can neither vanish
 *  nor re-parent the copy, and digest verification sees exactly what the rows hold. */
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

function metricRow(sample: MetricsSample, runId: string): MetricRow {
  return {
    sample_time: syntheticSampleTimeMs(sample.tick),
    run_id: runId,
    tick: sample.tick,
    alive: sample.alive,
    coverage: sample.coverage,
    pwc: sample.pwc,
    npwc: sample.npwc,
    sf_mean: sample.sfMean,
    sf_max: sample.sfMax,
    dup_slots: sample.dupSlots,
    versions: copy(sample.versions),
    hb_total: sample.msgs.hb,
    score_total: sample.msgs.score,
    delivered_total: sample.msgs.delivered,
    lost_total: sample.msgs.lost,
    blocked_total: sample.msgs.blocked,
    collisions_total: sample.collisions,
    near_misses_total: sample.nearMisses,
    slot_changes_total: sample.slotChanges,
  };
}

/** Record + identity → rows. `runId` is the gateway's UUIDv5(artifactHash). */
export function recordToRows(record: RunRecord, id: RunIdentity, runId: string): RunRows {
  const run: RunRow = {
    run_id: runId,
    experiment_key: id.experimentKey,
    pair_key: id.pairKey,
    artifact_hash: id.artifactHash,
    hash_version: id.hashVersion,
    scenario: record.scenario,
    arm: record.arm,
    seed: record.seed,
    n0: record.n0,
    git_revision: record.git,
    git_clean: id.gitClean,
    params_hash: record.paramsHash,
    state_hash: record.stateHash,
    composition_id: id.compositionId,
    record_version: record.v,
    expected_samples: id.expectedSamples,
    event_count: id.eventCount,
    series_digest: id.seriesDigest,
    events_digest: id.eventsDigest,
    summary_digest: id.summaryDigest,
  };
  return {
    run,
    metrics: record.series.map(sample => metricRow(sample, runId)),
    events: record.events.map((event, index) => ({ run_id: runId, event_index: index, tick: event.tick, event_type: event.type, details: copy(event) })),
    summary: { run_id: runId, summary_json: copy(record.summary) },
  };
}

/** Rows → record: the exact inverse of `recordToRows`. Metrics are ordered by tick and events by event_index, as
 *  the database returns them in no particular order. Throws if the rows are not one run's. */
export function rowsToRecord(rows: RunRows): RunRecord {
  const runId = rows.run.run_id;
  if (rows.summary.run_id !== runId || rows.metrics.some(m => m.run_id !== runId) || rows.events.some(e => e.run_id !== runId)) {
    throw new Error('rowsToRecord: rows belong to more than one run');
  }
  if (rows.run.record_version !== 1) throw new Error('rowsToRecord: only record_version 1 is supported');
  const metrics = [...rows.metrics].sort((a, b) => a.tick - b.tick);
  const events = [...rows.events].sort((a, b) => a.event_index - b.event_index);
  if (events.some((e, i) => e.event_index !== i)) throw new Error('rowsToRecord: event_index is not 0..n-1');
  return {
    v: 1,
    git: rows.run.git_revision,
    paramsHash: rows.run.params_hash,
    scenario: rows.run.scenario,
    arm: rows.run.arm,
    seed: rows.run.seed,
    n0: rows.run.n0,
    events: events.map(e => copy(e.details)),
    series: metrics.map(m => ({
      tick: m.tick,
      alive: m.alive,
      coverage: m.coverage,
      pwc: m.pwc,
      npwc: m.npwc,
      sfMean: m.sf_mean,
      sfMax: m.sf_max,
      dupSlots: m.dup_slots,
      versions: copy(m.versions),
      msgs: { hb: m.hb_total, score: m.score_total, delivered: m.delivered_total, lost: m.lost_total, blocked: m.blocked_total },
      collisions: m.collisions_total,
      nearMisses: m.near_misses_total,
      slotChanges: m.slot_changes_total,
    })),
    summary: copy(rows.summary.summary_json),
    stateHash: rows.run.state_hash,
  };
}
