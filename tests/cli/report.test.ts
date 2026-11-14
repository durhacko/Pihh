import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../../src/contracts';
import { buildReport, median, quantile, stats, verdict } from '../../src/cli/report';

function rec(scenario: string, arm: 'static' | 'encore', seed: number, summary: Record<string, number | null>): RunRecord {
  return { v: 1, git: 'abc', paramsHash: 'f'.repeat(64), scenario, arm, seed, n0: 200, events: [], series: [], summary, stateHash: 'h' };
}

describe('statistics', () => {
  it('median and IQR use linear interpolation (type 7)', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(median([])).toBeNull();
    expect(stats([1, null, 3])).toEqual({ n: 2, median: 2, q1: 1.5, q3: 2.5, nulls: 1 });
  });

  it('verdict follows the ±0.02 rule on Δ = Encore − static', () => {
    expect(verdict(0.03)).toBe('WIN');
    expect(verdict(0.02)).toBe('TIE');
    expect(verdict(0)).toBe('TIE');
    expect(verdict(-0.02)).toBe('TIE');
    expect(verdict(-0.021)).toBe('LOSS');
  });
});

describe('buildReport', () => {
  const records: RunRecord[] = [
    // Binary-exact values, so formatting cannot round either way.
    // seed 1: win (+0.125), seed 2: tie (0), seed 3: loss (-0.125), seed 4: win (+0.125)
    rec('S2', 'static', 1, { npwcEnd: 0.5, tRec: null, slotChanges: 0 }),
    rec('S2', 'encore', 1, { npwcEnd: 0.625, tRec: 12, slotChanges: 20 }),
    rec('S2', 'static', 2, { npwcEnd: 0.75, tRec: null, slotChanges: 0 }),
    rec('S2', 'encore', 2, { npwcEnd: 0.75, tRec: null, slotChanges: 30 }),
    rec('S2', 'static', 3, { npwcEnd: 0.625, tRec: null, slotChanges: 0 }),
    rec('S2', 'encore', 3, { npwcEnd: 0.5, tRec: 18, slotChanges: 25 }),
    rec('S2', 'static', 4, { npwcEnd: 0.875, tRec: null, slotChanges: 0 }),
    rec('S2', 'encore', 4, { npwcEnd: 1, tRec: 9, slotChanges: 40 }),
    rec('S5', 'static', 1, { npwcEnd: 1, unadopted: 200 }),
    rec('S5', 'encore', 1, { npwcEnd: 0.5, unadopted: 0 }),
  ];
  const md = buildReport(records);

  it('gives the median and IQR per arm and the median paired delta', () => {
    // static sorted .5 .625 .75 .875: median .6875, q1 .59375, q3 .78125
    // encore sorted .5 .625 .75 1: median .6875, q1 .59375, q3 .8125; deltas -.125 0 .125 .125: median .0625
    expect(md).toContain('| `npwcEnd` | 0.688 [0.594–0.781] (n=4) | 0.688 [0.594–0.813] (n=4) | 0.063 (4 pairs) |');
    expect(md).toContain('| `slotChanges` | 0 [0–0] (n=4) | 27.500 [23.750–32.500] (n=4) | 27.500 (4 pairs) |');
  });

  it('counts win/tie/loss and keeps the LOSS row', () => {
    expect(md).toContain('Win/tie/loss: **2 / 1 / 1** of 4 paired seeds.');
    expect(md).toContain('| 3 | 0.625 | 0.500 | -0.125 | **LOSS** |');
    expect(md).toContain('| 2 | 0.750 | 0.750 | 0 | TIE |');
    expect(md).toContain('Worst seed (lowest Δ npwcEnd): seed 3, Δ -0.125.');
  });

  it('counts censored tRec per arm', () => {
    expect(md).toContain('tRec censored (not recovered): static 4 of 4, encore 1 of 4.');
    expect(md).toContain('| `tRec` | censored ×4 | 12 [10.500–15] (n=3, censored ×1) |');
  });

  it('prints a null npwcDeficitSec (no event yet, e.g. S0) as n/a, not as missing', () => {
    const s0 = buildReport([rec('S0', 'static', 1, { npwcEnd: 1, npwcDeficitSec: null }), rec('S0', 'encore', 1, { npwcEnd: 1, npwcDeficitSec: null })]);
    expect(s0).toContain('| `npwcDeficitSec` | n/a ×1 | n/a ×1 | — |');
  });

  it('gives S5 no win/tie/loss, and S5 does not show a LOSS even with a negative delta', () => {
    const s5 = md.slice(md.indexOf('### S5'));
    expect(s5).toContain('no win/tie/loss');
    expect(s5).not.toContain('LOSS');
    expect(s5).not.toContain('Win/tie/loss:');
  });

  it('warns when records mix commits or params', () => {
    expect(md).not.toContain('WARNING');
    expect(buildReport([...records, { ...rec('S0', 'static', 1, {}), git: 'other' }])).toContain('WARNING');
  });

  it('rejects duplicate records for the same run', () => {
    expect(() => buildReport([records[0] as RunRecord, records[0] as RunRecord])).toThrow(/Two records/);
  });
});
