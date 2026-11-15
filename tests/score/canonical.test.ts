// #221 (XI-7): canonicalJson moved byte for byte from src/cli/run.ts into the pure src/score/canonical.ts.
// Proves the move changed nothing: same function object through src/cli/run.ts, identical output to the
// pre-move definition on a corpus, the frozen paramsHash, and one committed evidence record's stateHash re-derived.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { RunRecord } from '../../src/contracts';
import { BRAINS } from '../../src/cli/brains';
import { getObserverFactory } from '../../src/cli/observer';
import { canonicalJson as fromCli, paramsHash, runOne } from '../../src/cli/run';
import { canonicalJson } from '../../src/score/canonical';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Test oracle only: the pre-move definition (src/cli/run.ts:26-36 at b2076d9), kept to compare outputs. */
function preMove(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(preMove).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${preMove(obj[k])}`).join(',')}}`;
}

/** The frozen evaluation params hash (results/PARAMS.md, every committed record). */
const FROZEN_PARAMS_HASH = '6342c662955320742188728c5ff096dbc1ef6afb0117fc2f04194b71c18091f2';

const corpus: [string, unknown][] = [
  ['null', null], ['true', true], ['false', false], ['zero', 0], ['negative zero', -0], ['int', 42],
  ['float', 0.1 + 0.2], ['tiny', 5e-324], ['huge', 1e21], ['max safe', Number.MAX_SAFE_INTEGER], ['negative', -1.5e-7],
  ['string', 'plain'], ['escapes', 'quote " backslash \\ newline \n tab \t nul \u0000'],
  ['unicode', 'café ünïcödé 日本語 😀'], ['lone surrogates', '\uD800 and \uDFFF'],
  ['empty object', {}], ['empty array', []],
  ['key order', { b: 1, a: 2, c: { z: 1, y: 2, x: [3, { q: 1, p: 2 }] } }],
  ['code-unit sort', { a: 1, B: 2, _: 3, '10': 4, '9': 5, é: 6, '￿': 7, '😀': 8, '': 9 }],
  ['negative zero nested', { a: [-0, { b: -0 }], c: -0 }],
  ['nested arrays', [[[]], [[1, [2, [3]]]], [{ a: [] }]]],
  ['undefined values dropped', { a: undefined, b: 1, c: { d: undefined } }],
  ['undefined in array', [1, undefined, 2]],
  ['unicode keys and values', { 名前: '値', clé: 'valeur', '😀': ['🎉', { ñ: 'ü' }] }],
  ['record-like', { v: 1, events: [{ tick: 400, type: 'KILL', ids: [3, 1, 2] }], summary: { npwcEnd: 0.9, collisions: 0 } }],
  ['params', makeParams(200)],
  ['params n0 40', makeParams(40, { loss: 0.1 })],
];

describe('canonicalJson (src/score/canonical.ts)', () => {
  it('is the same function that src/cli/run.ts exports: no second copy', () => {
    expect(fromCli).toBe(canonicalJson);
  });

  it.each(corpus)('matches the pre-move definition: %s', (_name, value) => {
    expect(canonicalJson(value)).toBe(preMove(value));
  });

  it('keeps the documented properties: sorted keys, no whitespace, -0 as 0', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(canonicalJson({ y: { b: 1, a: 2 }, x: 0 })).toBe(canonicalJson({ x: 0, y: { a: 2, b: 1 } }));
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
    expect(canonicalJson({ B: 1, a: 2, é: 3 })).toBe('{"B":1,"a":2,"é":3}');
  });

  it.each([NaN, Infinity, -Infinity])('throws the same error as before on %s, at any depth', (bad) => {
    for (const value of [bad, [1, bad], { a: { b: [bad] } }]) {
      expect(() => preMove(value)).toThrow(`canonicalJson: non-finite number ${bad}`);
      expect(() => canonicalJson(value)).toThrow(`canonicalJson: non-finite number ${bad}`);
    }
  });
});

describe('hashes are unchanged by the move', () => {
  it('paramsHash(makeParams(200)) is the frozen evidence hash', () => {
    expect(paramsHash(makeParams(200))).toBe(FROZEN_PARAMS_HASH);
    expect(createHash('sha256').update(canonicalJson(makeParams(200))).digest('hex')).toBe(FROZEN_PARAMS_HASH);
  });

  // stateHash and paramsHash only: other record fields (summary keys, series) may change in a declared Track P
  // revision without touching canonicalJson, and must not fail this test.
  it('re-derives a committed evidence record\'s stateHash and paramsHash: S0, seed 1, static, n0 = 200', () => {
    const committed = JSON.parse(readFileSync(resolve(root, 'results/S0_n200_static_s1.json'), 'utf8')) as RunRecord;
    expect(committed.paramsHash).toBe(FROZEN_PARAMS_HASH);
    const record = runOne({
      scenario: 'S0', seed: 1, arm: 'static', n0: 200, brains: BRAINS, makeObserver: getObserverFactory(), git: committed.git,
    });
    expect(record.stateHash).toBe(committed.stateHash);
    expect(record.paramsHash).toBe(committed.paramsHash);
  }, 120_000);
});
