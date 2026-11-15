// TIG-02 validation (RFC §3): TIG-T01–T07 over the REAL committed RunRecords in results/ (read-only, never copied
// or written). Bad fixtures (FX-BAD/*, FX-NULL) are derived in memory from a real file, as the evaluation doc's
// fixture table says.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_IDS as CLI_SCENARIO_IDS, SCENARIO_TICKS } from '../../src/cli/scenarios';
import { CAPS, MAX_ISSUES, SCENARIO_IDS, SUMMARY_BASE_KEYS, validateRecordObject, validateRunRecord, type Validation } from '../../src/telemetry';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESULTS = join(root, 'results');
const CTX = { sourceKind: 'cli-scenario' as const, expectedTicks: SCENARIO_TICKS };
const SETS = ['', 'full/n200', 'full/n100', 'superseded-571c8e4'];

function recordFiles(dir: string): string[] {
  return readdirSync(dir).filter(name => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(name)).sort().map(name => join(dir, name));
}
const FILES = SETS.flatMap(set => recordFiles(join(RESULTS, set)));
const read = (name: string) => new Uint8Array(readFileSync(join(RESULTS, name)));
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const parse = (name: string) => JSON.parse(readFileSync(join(RESULTS, name), 'utf8'));

function errorsOf(result: Validation): { code: string; path: string }[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors.map(({ code, path }) => ({ code, path }));
}
function rejectsWith(value: unknown, code: string, path?: string): void {
  const errors = errorsOf(validateRunRecord(encode(value), CTX));
  expect(errors.some(e => e.code === code && (path === undefined || e.path === path)), JSON.stringify(errors.slice(0, 5))).toBe(true);
}

describe('real records (FX-50 and the full freeze)', () => {
  it('finds every committed record set', () => {
    expect(FILES.length).toBe(420);
    expect(recordFiles(RESULTS).length).toBe(50);
  });

  it('accepts all 420 records in CLI writer form, with no warnings (T02, T04, T05, T06)', () => {
    const rejected: string[] = [];
    let warnings = 0;
    for (const file of FILES) {
      const result = validateRunRecord(new Uint8Array(readFileSync(file)), CTX);
      if (!result.ok) rejected.push(`${relative(RESULTS, file)}: ${JSON.stringify(result.errors.slice(0, 3))}`);
      else {
        expect(result.fileForm).toBe('cli-writer');
        warnings += result.warnings.length;
      }
    }
    expect(rejected).toEqual([]);
    expect(warnings).toBe(0);
  }, 120_000);

  it('keeps the summary key rule exact: 23 base keys, plus tRec iff a KILL (censored null and absent preserved)', () => {
    const counts = { absent: 0, censored: 0, recovered: 0 };
    for (const file of FILES) {
      const record = JSON.parse(readFileSync(file, 'utf8'));
      const kill = record.events.some((e: { type: string }) => e.type === 'KILL');
      expect(Object.keys(record.summary).sort()).toEqual([...SUMMARY_BASE_KEYS, ...(kill ? ['tRec'] : [])].sort());
      if (!kill) counts.absent++;
      else if (record.summary.tRec === null) counts.censored++;
      else counts.recovered++;
    }
    // Real counts over the four sets (top level, full/n200, full/n100, superseded): nothing synthetic.
    expect(counts).toEqual({ absent: 30 + 120 + 0 + 30, censored: 10 + 60 + 40 + 10, recovered: 10 + 60 + 40 + 10 });
  });

  it('agrees with the CLI scenario ids it may not import', () => {
    expect(SCENARIO_IDS).toEqual([...CLI_SCENARIO_IDS]);
    expect(SCENARIO_TICKS).toBe(1800);
  });
});

describe('T01: unsupported record version', () => {
  it('rejects v 2 with SCHEMA_VERSION_UNSUPPORTED and nothing else', () => {
    const record = { ...parse('S0_n200_encore_s1.json'), v: 2 };
    expect(errorsOf(validateRunRecord(encode(record), CTX))).toEqual([{ code: 'SCHEMA_VERSION_UNSUPPORTED', path: '/v' }]);
  });
});

describe('T02: structure, events, strings and caps', () => {
  const base = () => parse('S3_n200_encore_s1.json');

  it('rejects an unknown top-level key, including __proto__, and a missing one', () => {
    rejectsWith({ ...base(), extra: 1 }, 'UNKNOWN_KEY', '');
    const text = readFileSync(join(RESULTS, 'S0_n200_encore_s1.json'), 'utf8').replace(/^\{/, '{"__proto__":{"polluted":true},');
    expect(errorsOf(validateRunRecord(new TextEncoder().encode(text), CTX)).map(e => e.code)).toContain('UNKNOWN_KEY');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const missing = base();
    delete missing.stateHash;
    rejectsWith(missing, 'MISSING_KEY', '/stateHash');
  });

  it('rejects arm central, a bad seed, n0, git, paramsHash and stateHash', () => {
    rejectsWith({ ...base(), arm: 'central' }, 'BAD_VALUE', '/arm');
    rejectsWith({ ...base(), scenario: 'S9' }, 'BAD_VALUE', '/scenario');
    rejectsWith({ ...base(), seed: -1 }, 'BAD_VALUE', '/seed');
    rejectsWith({ ...base(), seed: 2 ** 32 }, 'BAD_VALUE', '/seed');
    rejectsWith({ ...base(), n0: 0 }, 'BAD_VALUE', '/n0');
    rejectsWith({ ...base(), git: 'main' }, 'BAD_VALUE', '/git');
    rejectsWith({ ...base(), paramsHash: 'ABC' }, 'BAD_VALUE', '/paramsHash');
    rejectsWith({ ...base(), stateHash: 'x'.repeat(16) }, 'BAD_VALUE', '/stateHash');
  });

  it('accepts -dirty and unknown git (they only change identity, T09)', () => {
    const record = base();
    expect(validateRunRecord(encode({ ...record, git: `${record.git}-dirty` }), CTX).ok).toBe(true);
    expect(validateRunRecord(encode({ ...record, git: 'unknown' }), CTX).ok).toBe(true);
  });

  it('rejects an unknown event type, a KILL id outside [0, n0), a bad JAM_ON id, and out-of-order ticks', () => {
    const s3 = base();
    rejectsWith({ ...s3, events: [{ type: 'NUKE', tick: 10 }] }, 'BAD_EVENT', '/events/0/type');
    const s1 = parse('S1_n200_encore_s1.json');
    rejectsWith({ ...s1, events: [{ ...s1.events[0], ids: [...s1.events[0].ids.slice(1), 200] }] }, 'BAD_EVENT', '/events/0/ids');
    rejectsWith({ ...s1, events: [{ ...s1.events[0], ids: [1, 1] }] }, 'BAD_EVENT', '/events/0/ids');
    const jamOn = s3.events.findIndex((e: { type: string }) => e.type === 'JAM_ON');
    const badId = s3.events.map((e: object, i: number) => (i === jamOn ? { ...e, id: 'has space' } : e));
    rejectsWith({ ...s3, events: badId }, 'BAD_EVENT', `/events/${jamOn}/id`);
    rejectsWith({ ...s3, events: [...s3.events].reverse() }, 'BAD_EVENT');
    rejectsWith({ ...s3, events: [{ ...s3.events[0], extra: true }, ...s3.events.slice(1)] }, 'UNKNOWN_KEY', '/events/0');
  });

  it('checks INJECT_SCORE structurally (the S5 movement with startTick −40 is valid)', () => {
    const s5 = parse('S5_n200_encore_s1.json');
    const at = s5.events.findIndex((e: { type: string }) => e.type === 'INJECT_SCORE');
    expect(at).toBeGreaterThanOrEqual(0);
    const withScore = (score: unknown) => s5.events.map((e: object, i: number) => (i === at ? { ...e, score } : e));
    const score = s5.events[at].score;
    rejectsWith({ ...s5, events: withScore({ ...score, movements: [] }) }, 'BAD_EVENT', `/events/${at}/score/movements`);
    rejectsWith({ ...s5, events: withScore({ ...score, movements: [{ ...score.movements[0], recipe: { kind: 'cloud' } }] }) }, 'BAD_EVENT');
    rejectsWith({ ...s5, events: withScore({ ...score, movements: [{ ...score.movements[0], recipe: { kind: 'text', text: 'HI!' } }] }) }, 'BAD_EVENT');
    rejectsWith({ ...s5, events: withScore({ ...score, movements: [{ ...score.movements[0], recipe: { kind: 'sphere', palette: [[0, 0, 2], [0, 0, 0]] } }] }) }, 'BAD_EVENT');
    expect(validateRunRecord(encode({ ...s5, events: withScore({ ...score, movements: [{ ...score.movements[0], recipe: { kind: 'text', text: 'hi 42' } }] }) }), CTX).ok).toBe(true);
  });

  it('rejects U+0000 and a lone surrogate anywhere, keys included, after parsing', () => {
    const text = readFileSync(join(RESULTS, 'S3_n200_encore_s1.json'), 'utf8');
    for (const bad of ['"J\\u0000"', '"J\\ud800"', '"\\udc00J"']) {
      const changed = text.replace('"id":"J"', `"id":${bad}`);
      expect(changed).not.toBe(text);
      expect(errorsOf(validateRunRecord(new TextEncoder().encode(changed), CTX)).map(e => e.code)).toContain('BAD_STRING');
    }
    const key = text.replace('"versions":{"0:-1"', '"versions":{"0:-1\\u0000"');
    expect(errorsOf(validateRunRecord(new TextEncoder().encode(key), CTX)).map(e => e.code)).toContain('BAD_STRING');
  });

  it('checks the file size before parsing, and rejects invalid UTF-8 and non-JSON', () => {
    const big = new Uint8Array(CAPS.fileBytes + 1).fill(0x20);
    expect(errorsOf(validateRunRecord(big, CTX))).toEqual([{ code: 'CAP_EXCEEDED', path: '' }]);
    expect(errorsOf(validateRunRecord(new Uint8Array([0x7b, 0xff, 0x7d]), CTX))).toEqual([{ code: 'NOT_UTF8', path: '' }]);
    expect(errorsOf(validateRunRecord(new TextEncoder().encode('{"v":1,'), CTX))).toEqual([{ code: 'NOT_JSON', path: '' }]);
    expect(errorsOf(validateRunRecord(new TextEncoder().encode('[]'), CTX))).toEqual([{ code: 'NOT_OBJECT', path: '' }]);
  });

  it('applies the event, event-size and versions caps at cap + 1', () => {
    const s0 = parse('S0_n200_encore_s1.json');
    const loss = (i: number) => ({ type: 'SET_LOSS', tick: 10 + Math.floor(i / 10), loss: 0 });
    expect(validateRunRecord(encode({ ...s0, events: Array.from({ length: CAPS.events }, (_, i) => loss(i)) }), CTX).ok).toBe(true);
    rejectsWith({ ...s0, events: Array.from({ length: CAPS.events + 1 }, (_, i) => loss(i)) }, 'CAP_EXCEEDED', '/events');

    const s5 = parse('S5_n200_encore_s1.json');
    const at = s5.events.findIndex((e: { type: string }) => e.type === 'INJECT_SCORE');
    const movement = s5.events[at].score.movements[0];
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...movement, startTick: movement.startTick + i }));
    const huge = s5.events.map((e: { score: object }, i: number) => (i === at ? { ...e, score: { ...e.score, movements: many } } : e));
    rejectsWith({ ...s5, events: huge }, 'CAP_EXCEEDED', `/events/${at}`);

    const versions = Object.fromEntries(Array.from({ length: CAPS.versionKeys + 1 }, (_, i) => [`${i}:-1`, i === 0 ? s0.series[0].alive : 0]));
    rejectsWith({ ...s0, series: s0.series.map((s: object, i: number) => (i === 0 ? { ...s, versions } : s)) }, 'CAP_EXCEEDED', '/series/0/versions');
  });

  it('lists every error, capped at MAX_ISSUES', () => {
    const s0 = parse('S0_n200_encore_s1.json');
    const result = validateRunRecord(encode({ ...s0, series: s0.series.map((s: object) => ({ ...s, coverage: 2, pwc: 2 })) }), CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(MAX_ISSUES + 1);
      expect(result.errors.at(-1)?.code).toBe('TOO_MANY_ERRORS');
    }
  });

  it('never echoes payload values in messages', () => {
    const secret = 'zz-secret-zz';
    const result = validateRunRecord(encode({ ...base(), arm: secret, [secret]: 1 }), CTX);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('warns, without rejecting, on an unmatched _OFF and an _ON that never closes', () => {
    const s3 = base();
    const result = validateRunRecord(encode({ ...s3, events: s3.events.filter((e: { type: string }) => e.type !== 'JAM_ON') }), CTX);
    expect(result.ok).toBe(true);
    expect(result.warnings.map(w => w.code)).toContain('UNMATCHED_EVENT');
  });

  it('warns on a non-writer form (pretty-printed) and still accepts it', () => {
    const result = validateRunRecord(new TextEncoder().encode(JSON.stringify(parse('S0_n200_encore_s1.json'), null, 2)), CTX);
    expect(result.ok && result.fileForm).toBe('other');
    expect(result.warnings.map(w => w.code)).toEqual(['WRITER_FORM']);
  });
});

describe('T03: finite numbers', () => {
  it('rejects 1e999 in a sample (JSON.parse makes it Infinity), by an explicit check', () => {
    const text = readFileSync(join(RESULTS, 'S0_n200_encore_s1.json'), 'utf8');
    const changed = text.replace(/"sfMax":[0-9.e-]+/, '"sfMax":1e999');
    expect(errorsOf(validateRunRecord(new TextEncoder().encode(changed), CTX))).toContainEqual({ code: 'NON_FINITE', path: '/series/0/sfMax' });
  });

  it('rejects an in-memory NaN instead of turning it into null', () => {
    const record = parse('S0_n200_encore_s1.json');
    record.series[3].npwc = NaN;
    record.summary.npwcEnd = Infinity;
    const codes = errorsOf(validateRecordObject(record, CTX));
    expect(codes).toContainEqual({ code: 'NON_FINITE', path: '/series/3/npwc' });
    expect(codes).toContainEqual({ code: 'NON_FINITE', path: '/summary/npwcEnd' });
  });
});

describe('T04: sample schedule', () => {
  const s0 = () => parse('S0_n200_encore_s1.json');
  it('has 360 samples, ticks 5 … 1800 step 5, in every real record', () => {
    for (const file of FILES) {
      const ticks = JSON.parse(readFileSync(file, 'utf8')).series.map((s: { tick: number }) => s.tick);
      expect(ticks).toEqual(Array.from({ length: 360 }, (_, i) => 5 * (i + 1)));
    }
  });
  it('rejects tick 905 missing, duplicated, a tick-0 sample and one sample too many', () => {
    const record = s0();
    const at = record.series.findIndex((s: { tick: number }) => s.tick === 905);
    rejectsWith({ ...record, series: record.series.filter((_: unknown, i: number) => i !== at) }, 'BAD_TICKS');
    rejectsWith({ ...record, series: [...record.series.slice(0, at + 1), record.series[at], ...record.series.slice(at + 2)] }, 'BAD_TICKS', `/series/${at + 1}/tick`);
    rejectsWith({ ...record, series: [{ ...record.series[0], tick: 0 }, ...record.series.slice(1)] }, 'BAD_TICKS', '/series/0/tick');
    rejectsWith({ ...record, series: [...record.series, { ...record.series.at(-1), tick: 1805 }] }, 'BAD_TICKS', '/series');
  });
});

describe('T05: ranges with tolerance', () => {
  it('accepts the real pwc overshoot to 1.0000000000000004 and negative-epsilon summary values', () => {
    let overshoot = 0;
    let negative = 0;
    for (const file of FILES.slice(0, 50)) {
      const record = JSON.parse(readFileSync(file, 'utf8'));
      overshoot += record.series.filter((s: { pwc: number }) => s.pwc > 1).length;
      negative += Object.values(record.summary).filter(v => typeof v === 'number' && v < 0).length;
    }
    expect(overshoot).toBeGreaterThan(0);
    expect(negative).toBeGreaterThan(0);
  });
  it('rejects coverage above 1, pwc above 1 + 1e-9 and alive outside [0, n0]', () => {
    const record = parse('S0_n200_encore_s1.json');
    const at = (patch: object) => ({ ...record, series: record.series.map((s: object, i: number) => (i === 10 ? { ...s, ...patch } : s)) });
    rejectsWith(at({ coverage: 1 + 1e-12 }), 'BAD_SAMPLE', '/series/10/coverage');
    rejectsWith(at({ pwc: 1 + 2e-9 }), 'BAD_SAMPLE', '/series/10/pwc');
    expect(validateRunRecord(encode(at({ pwc: 1 + 1e-9 })), CTX).ok).toBe(true);
    rejectsWith(at({ alive: 201 }), 'BAD_SAMPLE', '/series/10/alive');
    rejectsWith(at({ alive: -1 }), 'BAD_SAMPLE', '/series/10/alive');
    rejectsWith(at({ npwc: -0.1 }), 'BAD_SAMPLE', '/series/10/npwc');
    expect(validateRunRecord(encode(at({ npwc: 3.5 })), CTX).ok).toBe(true);   // no upper bound on npwc
  });
  it('rejects an increase in alive and versions that do not sum to alive', () => {
    const record = parse('S1_n200_static_s1.json');
    const last = record.series.length - 1;
    rejectsWith({ ...record, series: record.series.map((s: { alive: number }, i: number) => (i === last ? { ...s, alive: s.alive + 1 } : s)) }, 'BAD_SAMPLE');
    rejectsWith({ ...record, series: record.series.map((s: object, i: number) => (i === 0 ? { ...s, versions: { '0:-1': 1 } } : s)) }, 'INCONSISTENT', '/series/0/versions');
  });
});

describe('T06: cumulative counters', () => {
  it('rejects collisions decreasing at one sample, and a msgs counter decreasing', () => {
    const record = parse('S0_n200_encore_s1.json');
    type Sample = { collisions: number; msgs: { hb: number } };
    const series: Sample[] = record.series;
    const at = series.findIndex(s => s.collisions > 0);
    expect(at).toBeGreaterThanOrEqual(0);
    // sample at+1 drops one below sample at
    rejectsWith({ ...record, series: series.map((s, i) => (i === at + 1 ? { ...s, collisions: series[at]!.collisions - 1 } : s)) }, 'COUNTER_DECREASED', `/series/${at + 1}/collisions`);
    expect(series[100]!.msgs.hb).toBeGreaterThan(0);
    rejectsWith({ ...record, series: series.map((s, i) => (i === 101 ? { ...s, msgs: { ...s.msgs, hb: series[100]!.msgs.hb - 1 } } : s)) }, 'COUNTER_DECREASED', '/series/101/msgs/hb');
  });
  it('rejects a summary counter that disagrees with the last sample', () => {
    const record = parse('S0_n200_encore_s1.json');
    rejectsWith({ ...record, summary: { ...record.summary, collisions: record.summary.collisions + 1 } }, 'INCONSISTENT', '/summary/collisions');
    rejectsWith({ ...record, summary: { ...record.summary, collisions: null } }, 'BAD_SUMMARY', '/summary/collisions');
  });
});

describe('T07: nulls and zero alive (FX-NULL)', () => {
  // S1_n200_static_s1.json with the tail set to alive 0 and npwc, sfMean, sfMax null (evaluation FX-NULL).
  function fxNull() {
    const record = parse('S1_n200_static_s1.json');
    const from = record.series.length - 20;
    record.series = record.series.map((s: object, i: number) => (i < from ? s : { ...s, alive: 0, dupSlots: 0, versions: {}, npwc: null, sfMean: null, sfMax: null }));
    record.summary.dupSlotsEnd = 0;
    return record;
  }
  it('accepts the zero-alive tail with null quality values', () => {
    const result = validateRunRecord(encode(fxNull()), CTX);
    expect(result.ok, JSON.stringify(!result.ok && result.errors.slice(0, 3))).toBe(true);
    if (result.ok) expect(result.record.series.at(-1)?.npwc).toBeNull();
  });
  it('rejects alive 0 with a non-null quality value, and a null npwc with alive > 0', () => {
    const record = fxNull();
    record.series[359].sfMean = 0;
    rejectsWith(record, 'BAD_SAMPLE', '/series/359/sfMean');
    const live = parse('S1_n200_static_s1.json');
    live.series[5].npwc = null;
    rejectsWith(live, 'BAD_SAMPLE', '/series/5/npwc');
  });
  it('warns when sfMean is null with alive > 0', () => {
    const record = parse('S0_n200_static_s1.json');
    record.series[5].sfMean = null;
    const result = validateRunRecord(encode(record), CTX);
    expect(result.ok).toBe(true);
    expect(result.warnings.map(w => w.code)).toEqual(['NULL_SHAPE_FIDELITY']);
  });
});

describe('context', () => {
  it('refuses an expectedTicks that is not a positive multiple of 5', () => {
    expect(() => validateRunRecord(read('S0_n200_encore_s1.json'), { sourceKind: 'cli-scenario', expectedTicks: 1801 })).toThrow();
    expect(() => validateRunRecord(read('S0_n200_encore_s1.json'), { sourceKind: 'cli-scenario', expectedTicks: 0 })).toThrow();
  });
  it('never mutates the input bytes', () => {
    const bytes = read('S2_n200_encore_s1.json');
    const copy = bytes.slice();
    validateRunRecord(bytes, CTX);
    expect(bytes).toEqual(copy);
  });
});

describe('review follow-ups', () => {
  it('accepts a BOM copy as non-writer form with the same record (RFC §3.1 decoder strips it)', () => {
    const bytes = read('S0_n200_encore_s1.json');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    const result = validateRunRecord(bom, CTX);
    expect(result.ok && result.fileForm).toBe('other');
    expect(result.warnings.map(w => w.code)).toEqual(['WRITER_FORM']);
    const plain = validateRunRecord(bytes, CTX);
    expect(result.ok && plain.ok && JSON.stringify(result.record) === JSON.stringify(plain.record)).toBe(true);
  });

  it('rejects in-memory sparse arrays (holes are not JSON)', () => {
    const record = parse('S3_n200_encore_s1.json');
    const jam = record.events.findIndex((e: { type: string }) => e.type === 'JAM_ON');
    delete record.events[jam].centre[0];
    delete record.series[100];
    const errors = errorsOf(validateRecordObject(record, CTX));
    expect(errors).toContainEqual({ code: 'BAD_VALUE', path: `/events/${jam}/centre` });
    expect(errors).toContainEqual({ code: 'BAD_VALUE', path: '/series' });
  });

  it('reports dropped warnings with TOO_MANY_WARNINGS', () => {
    const s0 = parse('S0_n200_encore_s1.json');
    const offs = Array.from({ length: MAX_ISSUES + 5 }, (_, i) => ({ type: 'JAM_OFF', tick: 10, id: `J${i}` }));
    const result = validateRunRecord(encode({ ...s0, events: offs }), CTX);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(MAX_ISSUES + 1);
    expect(result.warnings.at(-1)?.code).toBe('TOO_MANY_WARNINGS');
  });

  it('enforces tRec iff KILL, and tRec ≥ 0 (RFC §3.5 rule 22–23)', () => {
    const s0 = parse('S0_n200_encore_s1.json');
    rejectsWith({ ...s0, summary: { ...s0.summary, tRec: null } }, 'UNKNOWN_KEY', '/summary');
    const censored = parse('S1_n200_static_s1.json');
    expect(censored.summary.tRec).toBeNull();
    delete censored.summary.tRec;
    rejectsWith(censored, 'MISSING_KEY', '/summary/tRec');
    const s1 = parse('S1_n200_encore_s1.json');
    rejectsWith({ ...s1, summary: { ...s1.summary, tRec: -1 } }, 'BAD_SUMMARY', '/summary/tRec');
    rejectsWith({ ...s1, summary: { ...s1.summary, collisions: 1.5 } }, 'BAD_SUMMARY', '/summary/collisions');
  });

  it('checks the remaining series and summary consistency rules (17, 19, 24)', () => {
    const s0 = parse('S0_n200_encore_s1.json');
    const at10 = (patch: object) => ({ ...s0, series: s0.series.map((s: object, i: number) => (i === 10 ? { ...s, ...patch } : s)) });
    rejectsWith(at10({ dupSlots: s0.series[10].alive + 1 }), 'BAD_SAMPLE', '/series/10/dupSlots');
    for (const key of ['dupSlotsEnd', 'nearMisses', 'slotChanges']) {
      rejectsWith({ ...s0, summary: { ...s0.summary, [key]: s0.summary[key] + 1 } }, 'INCONSISTENT', `/summary/${key}`);
    }
    const record = parse('S1_n200_static_s1.json');
    record.series = record.series.map((s: object, i: number) => (i < 340 ? s : { ...s, alive: 0, dupSlots: 0, versions: {}, npwc: null, sfMean: null, sfMax: null }));
    record.summary.dupSlotsEnd = 0;
    record.series[359].npwc = 0;
    rejectsWith(record, 'BAD_SAMPLE', '/series/359/npwc');
  });
});
