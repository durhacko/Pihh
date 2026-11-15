// TIG-02 digests (RFC §4.2, §11): the offline half of TIG-T13. Digests computed from rows equal the record's, and
// detect a 1-ulp npwc change, one event-details change and one summary-key change that a count-only check misses.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_TICKS } from '../../src/cli/scenarios';
import {
  canonicalHash, computeIdentity, digestMismatches, digestsFromRows, hashOf, recordDigests, recordToRows, rowsToRecord,
  validateRunRecord, type RunRows, type Sha256,
} from '../../src/telemetry';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');
const CTX = { sourceKind: 'cli-scenario' as const, expectedTicks: SCENARIO_TICKS };
const sha256: Sha256 = data => createHash('sha256').update(data).digest('hex');
const RUN_ID = '6f0f3c1e-0b1a-5c3d-8e2f-1a2b3c4d5e6f';

function rowsOf(name: string): RunRows {
  const bytes = new Uint8Array(readFileSync(join(RESULTS, name)));
  const result = validateRunRecord(bytes, CTX);
  if (!result.ok) throw new Error(`${name} does not validate`);
  return recordToRows(result.record, computeIdentity(result.record, bytes, `scenario:${result.record.scenario}`, sha256), RUN_ID);
}
/** The next double above `x` (x > 0): exactly one ulp. */
function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}
const counts = (rows: RunRows) => [rows.metrics.length, rows.events.length, Object.keys(rows.summary.summary_json).length];

describe('digests from rows', () => {
  it('equal the identity digests of the record the rows came from', () => {
    for (const name of ['S0_n200_encore_s1.json', 'S3_n200_static_s4.json', 'S5_n200_encore_s2.json', 'full/n100/S2_n100_encore_s10.json']) {
      const rows = rowsOf(name);
      expect(digestMismatches({ seriesDigest: rows.run.series_digest, eventsDigest: rows.run.events_digest, summaryDigest: rows.run.summary_digest }, digestsFromRows(rows, sha256))).toEqual([]);
    }
  });

  it('detect changes that keep every count equal (why counts are not enough)', () => {
    const rows = rowsOf('S3_n200_encore_s1.json');
    const expected = digestsFromRows(rows, sha256);
    const metric = rows.metrics[200]!;
    expect(metric.npwc).toBeGreaterThan(0);
    const ulp: RunRows = { ...rows, metrics: rows.metrics.map((m, i) => (i === 200 ? { ...m, npwc: nextUp(metric.npwc as number) } : m)) };
    expect(ulp.metrics[200]!.npwc).not.toBe(metric.npwc);
    const event: RunRows = { ...rows, events: rows.events.map((e, i) => (i === 0 ? { ...e, details: { ...e.details, tick: e.details.tick } as typeof e.details } : e)) };
    const firstJam = rows.events.findIndex(e => e.event_type === 'JAM_ON');
    const eventChanged: RunRows = { ...rows, events: rows.events.map((e, i) => (i === firstJam ? { ...e, details: { ...e.details, radius: 12.000000001 } as typeof e.details } : e)) };
    const summary: RunRows = { ...rows, summary: { ...rows.summary, summary_json: { ...rows.summary.summary_json, collisions: (rows.summary.summary_json.collisions as number) + 1 } } };

    expect(digestMismatches(expected, digestsFromRows(event, sha256))).toEqual([]);   // same content, new objects
    expect(digestMismatches(expected, digestsFromRows(ulp, sha256))).toEqual(['seriesDigest']);
    expect(digestMismatches(expected, digestsFromRows(eventChanged, sha256))).toEqual(['eventsDigest']);
    expect(digestMismatches(expected, digestsFromRows(summary, sha256))).toEqual(['summaryDigest']);
    for (const changed of [ulp, eventChanged, summary]) expect(counts(changed)).toEqual(counts(rows));
  });

  it('detect an own __proto__ key injected into summary_json; the copy keeps it as data (#253 review)', () => {
    const rows = rowsOf('S0_n200_encore_s1.json');
    const expected = digestsFromRows(rows, sha256);
    const injected: Record<string, number | null> = { ...rows.summary.summary_json };
    Object.defineProperty(injected, '__proto__', { value: { polluted: 1 }, enumerable: true, writable: true, configurable: true });
    expect(Object.keys(injected)).toContain('__proto__');
    const tampered: RunRows = { ...rows, summary: { ...rows.summary, summary_json: injected } };
    expect(digestMismatches(expected, digestsFromRows(tampered, sha256))).toEqual(['summaryDigest']);
    const back = rowsToRecord(tampered).summary;
    expect(Object.keys(back)).toContain('__proto__');
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('are order-sensitive for events and samples only through tick and event_index', () => {
    const rows = rowsOf('S3_n200_encore_s1.json');
    const shuffled: RunRows = { ...rows, metrics: [...rows.metrics].reverse(), events: [...rows.events].reverse() };
    expect(digestsFromRows(shuffled, sha256)).toEqual(digestsFromRows(rows, sha256));
  });
});

describe('hash helpers', () => {
  it('hash UTF-8 canonical JSON and check the injected sha256', () => {
    expect(canonicalHash(sha256, { b: 1, a: [2, { d: null, c: 'é' }] })).toBe(sha256('{"a":[2,{"c":"é","d":null}],"b":1}'));
    expect(() => hashOf(() => 'abc', 'x')).toThrow();
    expect(() => hashOf(() => 'A'.repeat(64), 'x')).toThrow();
  });
  it('recordDigests covers series, events and summary only', () => {
    const record = JSON.parse(readFileSync(join(RESULTS, 'S0_n200_encore_s1.json'), 'utf8'));
    const a = recordDigests(record, sha256);
    expect(recordDigests({ ...record, stateHash: '0'.repeat(16), seed: 99 }, sha256)).toEqual(a);
  });
});
