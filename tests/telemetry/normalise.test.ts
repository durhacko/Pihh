// TIG-02 normalisation (RFC §6.6, §8): TIG-T10, the row halves of T05 and T07, and E1 offline
// (canonicalJson(rowsToRecord(recordToRows(r))) === canonicalJson(r)) over every REAL committed record (read-only).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_TICKS } from '../../src/cli/scenarios';
import { canonicalJson } from '../../src/score/canonical';
import type { RunRecord } from '../../src/contracts/metrics';
import {
  computeIdentity, recordToRows, rowsToRecord, scenarioCompositionId, SYNTHETIC_EPOCH_MS, syntheticSampleTimeMs,
  validateRunRecord, type RunRows, type Sha256,
} from '../../src/telemetry';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');
const CTX = { sourceKind: 'cli-scenario' as const, expectedTicks: SCENARIO_TICKS };
const sha256: Sha256 = data => createHash('sha256').update(data).digest('hex');
const RUN_ID = '6f0f3c1e-0b1a-5c3d-8e2f-1a2b3c4d5e6f';
const ALL = ['', 'full/n200', 'full/n100', 'superseded-571c8e4'].flatMap(set =>
  readdirSync(join(RESULTS, set)).filter(n => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(n)).sort().map(n => join(RESULTS, set, n)));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function loadFrozen(file: string): { record: RunRecord; rows: RunRows } {
  const bytes = new Uint8Array(readFileSync(file));
  const result = validateRunRecord(bytes, CTX);
  if (!result.ok) throw new Error(`${file} does not validate`);
  const record = deepFreeze(result.record);
  return { record, rows: recordToRows(record, computeIdentity(record, bytes, scenarioCompositionId(record), sha256), RUN_ID) };
}

describe('E1 offline: rows → record is the exact inverse', () => {
  it('round-trips every real record (canonicalJson equal, artifactHash restored), from deep-frozen input', () => {
    expect(ALL.length).toBe(420);
    for (const file of ALL) {
      const { record, rows } = loadFrozen(file);
      const back = rowsToRecord(rows);
      expect(canonicalJson(back)).toBe(canonicalJson(record));
      expect(sha256(canonicalJson(back))).toBe(rows.run.artifact_hash);
    }
  }, 180_000);

  it('restores order from shuffled rows (the database returns rows in no particular order)', () => {
    const { record, rows } = loadFrozen(join(RESULTS, 'S3_n200_encore_s1.json'));
    const shuffled: RunRows = { ...rows, metrics: [...rows.metrics].reverse(), events: [...rows.events].reverse() };
    expect(canonicalJson(rowsToRecord(shuffled))).toBe(canonicalJson(record));
  });

  it('refuses rows from two runs, a gap in event_index and another record_version', () => {
    const { rows } = loadFrozen(join(RESULTS, 'S3_n200_encore_s1.json'));
    expect(() => rowsToRecord({ ...rows, metrics: [{ ...rows.metrics[0]!, run_id: 'other' }, ...rows.metrics.slice(1)] })).toThrow();
    expect(() => rowsToRecord({ ...rows, events: [{ ...rows.events[0]!, run_id: 'other' }, ...rows.events.slice(1)] })).toThrow();
    expect(() => rowsToRecord({ ...rows, summary: { ...rows.summary, run_id: 'other' } })).toThrow();
    expect(() => rowsToRecord({ ...rows, events: rows.events.slice(1) })).toThrow();
    expect(() => rowsToRecord({ ...rows, run: { ...rows.run, record_version: 2 } })).toThrow();
  });
});

describe('T10: the row mapping', () => {
  it('maps William §8 fields one to one, with synthetic sample_time = 2020-01-01Z + tick × 50 ms', () => {
    const { record, rows } = loadFrozen(join(RESULTS, 'S2_n200_encore_s1.json'));
    expect(rows.metrics).toHaveLength(360);
    const s = record.series[180]!;
    expect(rows.metrics[180]).toEqual({
      sample_time: Date.UTC(2020, 0, 1) + s.tick * 50, run_id: RUN_ID, tick: s.tick, alive: s.alive, coverage: s.coverage, pwc: s.pwc,
      npwc: s.npwc, sf_mean: s.sfMean, sf_max: s.sfMax, dup_slots: s.dupSlots, versions: s.versions,
      hb_total: s.msgs.hb, score_total: s.msgs.score, delivered_total: s.msgs.delivered, lost_total: s.msgs.lost,
      blocked_total: s.msgs.blocked, collisions_total: s.collisions, near_misses_total: s.nearMisses, slot_changes_total: s.slotChanges,
    });
    expect(rows.metrics[180]!.versions).not.toBe(s.versions);   // a copy, never an alias of the record
  });

  it('keeps events whole, in array order, with event_index = position', () => {
    const { record, rows } = loadFrozen(join(RESULTS, 'S3_n200_encore_s1.json'));
    expect(rows.events.map(e => e.event_index)).toEqual(record.events.map((_, i) => i));
    rows.events.forEach((row, i) => {
      expect(row.details).toEqual(record.events[i]);
      expect(row.event_type).toBe(record.events[i]!.type);
      expect(row.tick).toBe(record.events[i]!.tick);
    });
  });

  it('keeps summary_json exactly: tRec absent stays absent, censored null stays null (TCR-25)', () => {
    const absent = loadFrozen(join(RESULTS, 'S0_n200_encore_s1.json'));
    expect(Object.hasOwn(absent.rows.summary.summary_json, 'tRec')).toBe(false);
    expect(Object.hasOwn(rowsToRecord(absent.rows).summary, 'tRec')).toBe(false);
    const censored = loadFrozen(join(RESULTS, 'S1_n200_static_s1.json'));
    expect(censored.rows.summary.summary_json.tRec).toBeNull();
    expect(rowsToRecord(censored.rows).summary.tRec).toBeNull();
    const recovered = loadFrozen(join(RESULTS, 'S1_n200_encore_s1.json'));
    expect(typeof recovered.rows.summary.summary_json.tRec).toBe('number');
    expect(recovered.rows.summary.summary_json).toEqual(recovered.record.summary);
  });

  it('fills the run row from the record and identity (dt, paths and versions are the importer\'s)', () => {
    const { record, rows } = loadFrozen(join(RESULTS, 'S2_n200_static_s1.json'));
    expect(rows.run).toMatchObject({
      run_id: RUN_ID, scenario: 'S2', arm: 'static', seed: 1, n0: 200, git_revision: record.git, git_clean: true,
      params_hash: record.paramsHash, state_hash: record.stateHash, composition_id: 'scenario:S2', record_version: 1,
      expected_samples: 360, event_count: 1, hash_version: 1,
    });
    // first-observation and import columns are the gateway's, from the manifest (RFC §5, §6.1)
    for (const column of ['dt_seconds', 'file_sha256', 'artifact_path', 'file_bytes']) expect(Object.keys(rows.run)).not.toContain(column);
  });
});

describe('T05 rows: unclamped, bit for bit', () => {
  it('stores every numeric value as the identical double (Object.is), including pwc 1.0000000000000004', () => {
    let overshoot = 0;
    for (const file of ALL.slice(0, 50)) {
      const { record, rows } = loadFrozen(file);
      rows.metrics.forEach((row, i) => {
        const s = record.series[i]!;
        for (const [a, b] of [[row.pwc, s.pwc], [row.coverage, s.coverage], [row.npwc, s.npwc], [row.sf_mean, s.sfMean], [row.sf_max, s.sfMax]]) {
          if (!Object.is(a, b)) throw new Error(`${file} sample ${i} changed a value`);
        }
        if (row.pwc > 1) overshoot++;
      });
      for (const [key, value] of Object.entries(record.summary)) expect(Object.is(rows.summary.summary_json[key], value)).toBe(true);
    }
    expect(overshoot).toBe(7943);   // the real count in the 50 top-level records
  });
});

describe('T07 rows: nulls stay null', () => {
  it('serialises npwc, sfMean and sfMax of a zero-alive tail as null, never 0 (FX-NULL)', () => {
    const record = JSON.parse(readFileSync(join(RESULTS, 'S1_n200_static_s1.json'), 'utf8'));
    record.series = record.series.map((s: object, i: number) => (i < 340 ? s : { ...s, alive: 0, dupSlots: 0, versions: {}, npwc: null, sfMean: null, sfMax: null }));
    record.summary.dupSlotsEnd = 0;
    const bytes = new TextEncoder().encode(`${JSON.stringify(record)}\n`);
    const result = validateRunRecord(bytes, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = recordToRows(result.record, computeIdentity(result.record, bytes, 'scenario:S1', sha256), RUN_ID);
    for (const row of rows.metrics.slice(340)) expect([row.npwc, row.sf_mean, row.sf_max, row.alive]).toEqual([null, null, null, 0]);
    expect(canonicalJson(rowsToRecord(rows))).toBe(canonicalJson(result.record));
  });
});

describe('§8 synthetic time', () => {
  it('is 1577836800000 + tick × 50, integer ticks ≥ 0 only, and needs no clock', () => {
    expect(SYNTHETIC_EPOCH_MS).toBe(Date.UTC(2020, 0, 1));
    expect(syntheticSampleTimeMs(0)).toBe(1_577_836_800_000);
    expect(syntheticSampleTimeMs(1800)).toBe(1_577_836_890_000);
    expect(() => syntheticSampleTimeMs(-5)).toThrow();
    expect(() => syntheticSampleTimeMs(2.5)).toThrow();
  });
});
