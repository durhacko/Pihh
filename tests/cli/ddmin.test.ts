// P2-WP-02 part a: ddmin (known minimal sets, 1-minimality, the budget flag, determinism) and the p2-repro/1 round trip.
import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR } from '../../src/contracts';
import { INVARIANT_DEFAULTS } from '../../src/observer/invariants';
import { ddmin } from '../../src/cli/ddmin';
import { parseRepro, REPRO_VERSION, reproFileName, serialiseRepro, type Repro } from '../../src/cli/repro';
import { paramsHash } from '../../src/cli/run';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** A test that passes iff every unit of `needed` is present; counts its calls. */
function needs(needed: number[]) {
  let calls = 0;
  const test = (subset: number[]) => { calls++; return needed.every(u => subset.includes(u)); };
  return { test, calls: () => calls };
}
/** 1-minimal: the test passes on `result` and fails with any single unit removed. */
const oneMinimal = (result: number[], test: (s: number[]) => boolean) =>
  test(result) && result.every((_, i) => !test(result.filter((__, j) => j !== i)));

describe('ddmin', () => {
  it.each<[string, number, number[]]>([
    ['one culprit among 16', 16, [11]],
    ['two culprits far apart', 16, [3, 12]],
    ['two adjacent culprits', 10, [4, 5]],
    ['three culprits', 20, [0, 9, 19]],
    ['every unit needed', 5, [0, 1, 2, 3, 4]],
    ['the first and the last', 2, [0, 1]],
  ])('finds the known minimal set: %s', (_name, n, needed) => {
    const { test } = needs(needed);
    const result = ddmin(range(n), test, 1000);
    expect(result.units).toEqual(needed);
    expect(result.oneMinimal).toBe(true);
    expect(oneMinimal(result.units, needs(needed).test)).toBe(true);
  });

  it('returns a 1-minimal subset for a non-monotone test (any 2 of a 3-set)', () => {
    const test = (s: number[]) => [2, 5, 7].filter(u => s.includes(u)).length >= 2;
    const result = ddmin(range(12), test, 1000);
    expect(result.units).toHaveLength(2);
    expect(result.oneMinimal).toBe(true);
    expect(oneMinimal(result.units, test)).toBe(true);
  });

  it('shrinks to nothing when the property holds with no units at all', () => {
    expect(ddmin(range(4), () => true, 100)).toMatchObject({ units: [], oneMinimal: true });
  });

  it('keeps a single unit that is needed, and calls that 1-minimal after testing the empty set', () => {
    expect(ddmin([42], s => s.includes(42), 10)).toEqual({ units: [42], tests: 1, oneMinimal: true });
  });

  it('stops at the budget with oneMinimal false, returning a subset on which the test still passes', () => {
    const { test, calls } = needs([3, 12, 25]);
    const result = ddmin(range(32), test, 4);
    expect(calls()).toBe(4);
    expect(result.tests).toBe(4);
    expect(result.oneMinimal).toBe(false);
    expect(test(result.units)).toBe(true);
    expect(ddmin(range(8), needs([1]).test, 0)).toEqual({ units: range(8), tests: 0, oneMinimal: false });
  });

  it('is deterministic, never tests a subset twice and preserves order', () => {
    const seen: string[] = [];
    const test = (s: number[]) => { seen.push(s.join(',')); return s.includes(6) && s.includes(9); };
    const a = ddmin(range(16), test, 1000);
    const first = [...seen];
    seen.length = 0;
    const b = ddmin(range(16), test, 1000);
    expect(b).toEqual(a);
    expect(seen).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(a.units).toEqual([6, 9]);
  });

  it('works on any unit type and rejects a bad budget', () => {
    expect(ddmin(['a', 'b', 'c', 'd'], s => s.includes('c'), 50).units).toEqual(['c']);
    expect(() => ddmin([1], () => true, -1)).toThrow(RangeError);
    expect(() => ddmin([1], () => true, 1.5)).toThrow(RangeError);
  });
});

describe('p2-repro/1', () => {
  const params = makeParams(40, { loss: 0.2 });
  const repro: Repro = {
    v: REPRO_VERSION, git: 'abc123', campaign: 'FZ1', campaignSeed: 7, run: 3, arm: 'encore', seed: 99, n0: 40, ticks: 1200,
    params, paramsHash: paramsHash(params),
    score: { version: { issuedTick: 0, origin: OPERATOR }, movements: [{ startTick: 0, transitionTicks: 241, recipe: { kind: 'text', text: 'ENCORE' } }] },
    events: [{ type: 'KILL', tick: 306, ids: [1, 2] }, { type: 'JAM_ON', tick: 400, id: 'fz-j0', centre: [0, 30, 0], radius: 6 }, { type: 'JAM_OFF', tick: 500, id: 'fz-j0' }],
    thresholds: { ...INVARIANT_DEFAULTS },
    violation: { inv: 'INV-QUIET', firstTick: 710, ids: [4], slot: 2, knownLimit: null, detail: 'commit 404 ticks after its anchor' },
    shrink: { fromUnits: 9, toUnits: 2, tests: 31, oneMinimal: true },
    stateHash: '0123456789abcdef',
  };

  it('round-trips, and equal inputs give byte-identical files (canonicalJson plus a newline)', () => {
    const text = serialiseRepro(repro);
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseRepro(text)).toEqual(repro);
    const shuffled = JSON.parse(JSON.stringify(repro)) as Repro;
    expect(serialiseRepro({ ...shuffled, stateHash: shuffled.stateHash, v: shuffled.v })).toBe(text);
    expect(serialiseRepro(parseRepro(text))).toBe(text);
    expect(text).not.toMatch(/"(time|date|createdAt|wallMs)"/i);
  });

  it('names files by campaign, seed, run and INV', () => {
    expect(reproFileName(repro)).toBe('fz1-s7-r3-inv-quiet.json');
  });

  it.each<[string, (r: Record<string, unknown>) => void]>([
    ['the version', r => { r.v = 'p2-repro/2'; }],
    ['the arm', r => { r.arm = 'both'; }],
    ['params for another n0', r => { r.params = { ...params, n0: 41 }; }],
    ['the paramsHash', r => { r.paramsHash = 'x'; }],
    ['an event tick', r => { r.events = [{ type: 'KILL', tick: 1.5, ids: [1] }]; }],
    ['the INV', r => { r.violation = { ...repro.violation, inv: 'INV-OTHER' }; }],
    ['the knownLimit', r => { r.violation = { ...repro.violation, knownLimit: 3 }; }],
    ['the thresholds', r => { r.thresholds = { Q: 400 }; }],
    ['the shrink record', r => { r.shrink = { ...repro.shrink, oneMinimal: 'yes' }; }],
  ])('rejects a bad %s', (_name, mutate) => {
    const bad = JSON.parse(JSON.stringify(repro)) as Record<string, unknown>;
    mutate(bad);
    expect(() => parseRepro(JSON.stringify(bad))).toThrow(/repro: bad or missing field/);
  });

  it('rejects text that is not a JSON object', () => {
    expect(() => parseRepro('not json')).toThrow(/not JSON/);
    expect(() => parseRepro('[]')).toThrow(/not an object/);
  });
});
