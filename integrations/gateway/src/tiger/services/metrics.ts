// integrations/gateway/src/tiger/services/metrics.ts
// GET /api/runs/:runId/metrics (analytics RFC §3.5): samples with simSeconds and per-interval counter deltas,
// completeness against the expected schedule, event markers, summary cells, recovery state and integrity checks.
// Every value comes from the stored rows; nothing is recomputed from a metric, and NULL stays null.
import { DT } from './bridge.ts';
import type { MetricRow, RunRows } from './bridge.ts';
import { QueryError, runMetaOf, type Provenance, type RunMeta } from './runs.ts';
import type { ReadSourceKind, StoredRun } from './source.ts';

export const SAMPLE_TICKS = 5;   // contract metrics.ts "one per 5 ticks"; ingestion Q7 (TCR-11)
const STREAK_SAMPLES = 12;        // summary.ts: 12 consecutive hold samples
export const SYNTHETIC_TIME_NOTE = 'sample_time is SYNTHETIC (2020-01-01Z + tick x 50 ms), never wall clock; the tick is authoritative';

export type CounterField = 'hb' | 'score' | 'delivered' | 'lost' | 'blocked' | 'collisions' | 'nearMisses' | 'slotChanges';
const COUNTERS: readonly [CounterField, keyof MetricRow][] = [
  ['hb', 'hb_total'], ['score', 'score_total'], ['delivered', 'delivered_total'], ['lost', 'lost_total'],
  ['blocked', 'blocked_total'], ['collisions', 'collisions_total'], ['nearMisses', 'near_misses_total'], ['slotChanges', 'slot_changes_total'],
];

export interface SampleRow {
  tick: number; simSeconds: number;
  alive: number; coverage: number; pwc: number; npwc: number | null; sfMean: number | null; sfMax: number | null;
  dupSlots: number; versions: Record<string, number>;
  totals: Record<CounterField, number>;
  deltas: Record<CounterField, number> | null;
  intervalTicks: number; sinceRunStart: boolean; spansGap: boolean;
}
export interface EventMarker { index: number; tick: number; type: string; details: unknown; killCount?: number; scoreVersion?: unknown }
export type SummaryCell = { present: false } | { present: true; value: number | null };
export type RecoveryState =
  | { state: 'recovered'; tRec: number; killTick: number; tRecZero: boolean; streakStartTick: number | null; bandEndTickExclusive: number | null }
  | { state: 'censored'; killTick: number }
  | { state: 'not-applicable' };
export interface RunMetricsResponse {
  run: RunMeta;
  timeAxis: { authoritative: 'tick'; dtSeconds: number; sampleTicks: number; syntheticTimeNote: string };
  page: { afterTick: number; returned: number; nextAfterTick: number | null };
  samples: SampleRow[];
  counters: { check: 'ok' | 'decreasing'; firstDecrease: { field: CounterField; tick: number } | null };
  completeness: { expected: number; present: number; missingTicks: number[]; offScheduleTicks: number[] };
  events: EventMarker[];
  summary: { cells: Record<string, SummaryCell>; recovery: RecoveryState; integrity: string[] };
}

export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METRICS_PARAMS = ['afterTick', 'toTick', 'limit'];

export interface MetricsQuery { afterTick: number; toTick: number | null; limit: number }

export function parseMetricsQuery(query: Readonly<Record<string, string>>): MetricsQuery {
  for (const key of Object.keys(query)) if (!METRICS_PARAMS.includes(key)) throw new QueryError(400, 'INVALID_QUERY', key, 'unknown query parameter');
  const int = (key: string, min: number, max: number): number | undefined => {
    const raw = query[key];
    if (raw === undefined) return undefined;
    if (!/^(-1|0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
      throw new QueryError(400, 'INVALID_QUERY', key, `${key} must be an integer in ${min}..${max}`);
    }
    return Number(raw);
  };
  return { afterTick: int('afterTick', -1, Number.MAX_SAFE_INTEGER) ?? -1, toTick: int('toTick', 0, Number.MAX_SAFE_INTEGER) ?? null, limit: int('limit', 1, 2000) ?? 2000 };
}

function totalsOf(m: MetricRow): Record<CounterField, number> {
  const out = {} as Record<CounterField, number>;
  for (const [field, column] of COUNTERS) out[field] = m[column] as number;
  return out;
}

/** The first counter that decreases between consecutive stored samples, over the whole run (not just the page). */
function counterCheck(metrics: readonly MetricRow[]): RunMetricsResponse['counters'] {
  for (let i = 1; i < metrics.length; i++) {
    for (const [field, column] of COUNTERS) {
      if ((metrics[i]![column] as number) < (metrics[i - 1]![column] as number)) return { check: 'decreasing', firstDecrease: { field, tick: metrics[i]!.tick } };
    }
  }
  return { check: 'ok', firstDecrease: null };
}

function completenessOf(rows: RunRows): RunMetricsResponse['completeness'] {
  const expected = rows.run.expected_samples;
  const stored = new Set(rows.metrics.map((m) => m.tick));
  const missingTicks: number[] = [];
  for (let k = 1; k <= expected; k++) if (!stored.has(k * SAMPLE_TICKS)) missingTicks.push(k * SAMPLE_TICKS);
  const offScheduleTicks = rows.metrics.map((m) => m.tick).filter((t) => t % SAMPLE_TICKS !== 0 || t < SAMPLE_TICKS || t > expected * SAMPLE_TICKS);
  return { expected, present: rows.metrics.length, missingTicks, offScheduleTicks };
}

function markersOf(rows: RunRows): EventMarker[] {
  return rows.events.map((e) => {
    const marker: EventMarker = { index: e.event_index, tick: e.tick, type: e.event_type, details: e.details };
    if (e.details.type === 'KILL') marker.killCount = e.details.ids.length;
    if (e.details.type === 'INJECT_SCORE') marker.scoreVersion = e.details.score.version;
    return marker;
  });
}

/** The three TD-7 states from the summary only (§2.5, §7.3): tRec absent, null (censored), or a number. */
function recoveryOf(rows: RunRows): RecoveryState {
  const summary = rows.summary.summary_json;
  const kill = rows.events.find((e) => e.event_type === 'KILL');
  if (!Object.prototype.hasOwnProperty.call(summary, 'tRec') || kill === undefined) return { state: 'not-applicable' };
  const tRec = summary.tRec;
  if (tRec === null || tRec === undefined) return { state: 'censored', killTick: kill.tick };
  if (tRec === 0) return { state: 'recovered', tRec, killTick: kill.tick, tRecZero: true, streakStartTick: null, bandEndTickExclusive: null };
  const streakStartTick = kill.tick + Math.round(tRec / DT);
  return { state: 'recovered', tRec, killTick: kill.tick, tRecZero: false, streakStartTick, bandEndTickExclusive: streakStartTick + STREAK_SAMPLES * SAMPLE_TICKS };
}

function integrityOf(rows: RunRows, recovery: RecoveryState): string[] {
  const out: string[] = [];
  const summary = rows.summary.summary_json;
  const hasKill = rows.events.some((e) => e.event_type === 'KILL');
  const hasTRec = Object.prototype.hasOwnProperty.call(summary, 'tRec');
  if (hasKill !== hasTRec) out.push(hasKill ? 'KILL_WITHOUT_TREC' : 'TREC_WITHOUT_KILL');
  if (recovery.state === 'recovered' && recovery.streakStartTick !== null && recovery.streakStartTick % SAMPLE_TICKS !== 0) out.push('STREAK_START_OFF_SAMPLE');
  const last = rows.metrics[rows.metrics.length - 1];
  if (last) {
    const checks: [string, keyof MetricRow][] = [['collisions', 'collisions_total'], ['nearMisses', 'near_misses_total'], ['slotChanges', 'slot_changes_total']];
    for (const [key, column] of checks) if (summary[key] !== last[column]) out.push(`${key.toUpperCase()}_TOTAL_MISMATCH`);
  }
  return out;
}

/**
 * Verification on the metrics route (§2.1). That route's 'verified' needs the per-read digest recomputation, which
 * this build does not do yet, so it never says 'verified' (or 'verified-without-series'): a stored mismatch stays
 * 'mismatch' (a known failure is never hidden), and everything else is 'not-checked' until recomputation exists.
 */
export function metricsVerification(run: StoredRun): Provenance['verification'] {
  return run.verification === 'mismatch' ? 'mismatch' : 'not-checked';
}

export function runMetrics(run: StoredRun, rows: RunRows, q: MetricsQuery, kind: ReadSourceKind): RunMetricsResponse {
  const recovery = recoveryOf(rows);
  const counters = counterCheck(rows.metrics);
  const metrics = run.telemetryState === 'archived' ? [] : rows.metrics;
  const inRange = metrics.filter((m) => m.tick > q.afterTick && (q.toTick === null || m.tick <= q.toTick));
  const page = inRange.slice(0, q.limit);
  const samples: SampleRow[] = page.map((m) => {
    const i = metrics.indexOf(m);
    const prev = i > 0 ? metrics[i - 1] : undefined;
    const totals = totalsOf(m);
    let deltas: Record<CounterField, number> | null = null;
    if (counters.check === 'ok') {
      deltas = {} as Record<CounterField, number>;
      const before = prev ? totalsOf(prev) : null;
      for (const [field] of COUNTERS) deltas[field] = totals[field] - (before ? before[field] : 0);
    }
    const intervalTicks = m.tick - (prev ? prev.tick : 0);
    return {
      tick: m.tick, simSeconds: m.tick * DT,
      alive: m.alive, coverage: m.coverage, pwc: m.pwc, npwc: m.npwc, sfMean: m.sf_mean, sfMax: m.sf_max,
      dupSlots: m.dup_slots, versions: { ...m.versions },
      totals, deltas, intervalTicks, sinceRunStart: prev === undefined, spansGap: intervalTicks > SAMPLE_TICKS,
    };
  });
  const last = page[page.length - 1];
  const cells: Record<string, SummaryCell> = {};
  for (const [key, value] of Object.entries(rows.summary.summary_json)) cells[key] = { present: true, value };
  if (!('tRec' in cells)) cells.tRec = { present: false };
  return {
    run: runMetaOf(run, kind, metricsVerification(run)),
    timeAxis: { authoritative: 'tick', dtSeconds: DT, sampleTicks: SAMPLE_TICKS, syntheticTimeNote: SYNTHETIC_TIME_NOTE },
    page: { afterTick: q.afterTick, returned: samples.length, nextAfterTick: inRange.length > page.length && last ? last.tick : null },
    samples,
    counters,
    completeness: completenessOf(rows),
    events: markersOf(rows),
    summary: { cells, recovery, integrity: integrityOf(rows, recovery) },
  };
}
