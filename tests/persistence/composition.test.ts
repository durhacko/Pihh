// MDB-WP-02 (#230): the pure SavedShowComposition validator, src/app/compose/validate.ts, against the shared fixture
// corpus (tests/persistence/fixtures/*.json, also read by the gateway's tests in MDB-WP-03) and MDB-T01-T10.
// Every expected verdict, path and reason in the corpus was written by hand from the canonical spec (section 9).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeParams, type Params, type Recipe } from '../../src/contracts';
import { expandRecipe } from '../../src/score';
import { canonicalJson } from '../../src/score/canonical';
import { FONT } from '../../src/score/font';
import {
  COMPOSITION_LIMITS, compositionPreview, TEXT_MAX, validateComposition, validateShowRequest, validateText,
  type CompositionIssue, type SavedShowComposition,
} from '../../src/app/compose/validate';
import * as commands from '../../src/app/ui/commands';

// Counts trial expansions (MDB-T02: an unsupported kind is never expanded); the real expandRecipe runs.
const expansions = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/score', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/score')>();
  return { ...real, expandRecipe: (...args: Parameters<typeof real.expandRecipe>) => { expansions.calls++; return real.expandRecipe(...args); } };
});
afterEach(() => { expansions.calls = 0; });

type Expect = { ok: true; output: unknown; contentHash: string } | { ok: false; errors: { path: string; reason: string }[] };
interface Case { name: string; target: 'composition' | 'request'; input: unknown; expect: Expect }
interface Fixture { id: string; description: string; cases: Case[] }

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const corpus: Fixture[] = readdirSync(fixtureDir).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(resolve(fixtureDir, f), 'utf8')) as Fixture);
const cases = corpus.flatMap(f => f.cases.map(c => ({ ...c, id: `${f.id} · ${c.name}` })));
const N0S = [40, 200];   // the app's test and show rosters; the gateway runs its own smallest and largest (MDB-T08)
const contentHash = (c: SavedShowComposition) => createHash('sha256').update(canonicalJson(c), 'utf8').digest('hex');
const pairs = (errors: CompositionIssue[]) => errors.map(e => `${e.path} ${e.reason}`).sort();
const run = (c: Case, params: Params) => (c.target === 'request' ? validateShowRequest(c.input, params) : validateComposition(c.input, params));
const one = (recipe: unknown, holdTicks: unknown = 600) => ({ v: 1, movements: [{ recipe, holdTicks }] });

describe('the shared fixture corpus', () => {
  it('has the expected families and an accepted, manually authored saved show', () => {
    expect(corpus.map(f => f.id)).toEqual(['FX-BAD/hold', 'FX-BAD/keys', 'FX-BAD/kind', 'FX-BAD/movements', 'FX-BAD/palette', 'FX-BAD/proto', 'FX-BAD/request', 'FX-BAD/text', 'FX-V', 'FX-VALID', 'FX-WILLIAM-S4']);
    expect(cases.find(c => c.name === 'FX-SHOW')?.expect.ok).toBe(true);
    expect(cases.length).toBeGreaterThan(100);
  });

  for (const n0 of N0S) {
    it(`every fixture gets its expected verdict, paths and reasons at n0 ${n0}`, () => {
      const params = makeParams(n0);
      const wrong: string[] = [];
      for (const c of cases) {
        const result = run(c, params);
        if (c.expect.ok) {
          if (!result.ok) { wrong.push(`${c.id}: rejected ${JSON.stringify(result.errors)}`); continue; }
          const output = 'request' in result ? result.request : result.composition;
          const composition = 'request' in result ? result.request.composition : result.composition;
          if (JSON.stringify(output) !== JSON.stringify(c.expect.output) || canonicalJson(output) !== canonicalJson(c.expect.output)) wrong.push(`${c.id}: output ${JSON.stringify(output)}`);
          if (contentHash(composition) !== c.expect.contentHash) wrong.push(`${c.id}: contentHash ${contentHash(composition)}`);
        } else if (result.ok) wrong.push(`${c.id}: accepted`);
        else if (JSON.stringify(pairs(result.errors)) !== JSON.stringify(c.expect.errors.map(e => `${e.path} ${e.reason}`).sort())) wrong.push(`${c.id}: errors ${JSON.stringify(pairs(result.errors))}`);
      }
      expect(wrong).toEqual([]);
    });
  }

  it('every error names one of rules R2-R16', () => {
    const params = makeParams(40);
    for (const c of cases) {
      const result = run(c, params);
      if (!result.ok) for (const e of result.errors) expect(e.rule, c.id).toMatch(/^R([2-9]|1[0-6])$/);
    }
  });
});

describe('MDB-T01 round trip and contentHash', () => {
  const params = makeParams(200);
  const accepted = cases.filter(c => c.expect.ok && c.target === 'composition');

  it('canonical form → parse → validate (stored) is the identity, palette numbers bit for bit', () => {
    for (const c of accepted) {
      const first = validateComposition(c.input, params);
      if (!first.ok) throw new Error(c.id);
      const again = validateComposition(JSON.parse(canonicalJson(first.composition)), params, { mode: 'stored' });
      expect(again.ok, c.id).toBe(true);
      if (!again.ok) continue;
      expect(again.composition, c.id).toStrictEqual(first.composition);
      first.composition.movements.forEach((m, i) => m.recipe.palette?.flat().forEach((x, j) =>
        expect(Object.is(x, again.composition.movements[i]!.recipe.palette!.flat()[j]), `${c.id} channel ${j}`).toBe(true)));
      expect(contentHash(again.composition)).toBe(contentHash(first.composition));
    }
  });

  it('contentHash is independent of key order, and lower-case 64 hex', () => {
    const reversed = (v: unknown): unknown => Array.isArray(v) ? v.map(reversed)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;
    for (const c of accepted) {
      const a = validateComposition(c.input, params);
      const b = validateComposition(reversed(c.input), params);
      if (!a.ok || !b.ok) throw new Error(c.id);
      expect(JSON.stringify(Object.keys(reversed(c.input) as object))).not.toBe(JSON.stringify(Object.keys(c.input as object)));
      expect(contentHash(b.composition), c.id).toBe(contentHash(a.composition));
      expect(contentHash(a.composition)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('outputs are fresh: mutating the input afterwards changes nothing', () => {
    const input = one({ kind: 'text', text: 'hi', palette: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] });
    const result = validateComposition(input, params);
    if (!result.ok) throw new Error('rejected');
    (input.movements[0]!.recipe as { palette: number[][] }).palette[0]![0] = 0.9;
    expect(result.composition.movements[0]!.recipe).toEqual({ kind: 'text', text: 'HI', palette: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] });
  });
});

describe('MDB-T02 unsupported kinds are never expanded', () => {
  it('rejects every FX-BAD/kind case without calling expandRecipe', () => {
    const params = makeParams(40);
    for (const c of corpus.find(f => f.id === 'FX-BAD/kind')!.cases) {
      expansions.calls = 0;
      expect(validateComposition(c.input, params).ok, c.name).toBe(false);
      expect(expansions.calls, c.name).toBe(0);
    }
    expect(validateComposition(one({ kind: 'sphere' }), params).ok).toBe(true);
    expect(expansions.calls).toBe(1);   // the counter works: a supported kind is expanded once
  });
});

describe('MDB-T03 text glyphs', () => {
  const params = makeParams(200);
  const textOf = (r: ReturnType<typeof validateComposition>) => (r.ok && r.composition.movements[0]!.recipe.kind === 'text' ? r.composition.movements[0]!.recipe.text : null);

  it('accepts every FONT glyph (alone, or framed by letters for the space) and stores it upper-case', () => {
    for (const ch of Object.keys(FONT)) {
      const text = ch === ' ' ? 'A B' : ch;
      expect(textOf(validateComposition(one({ kind: 'text', text }), params)), JSON.stringify(ch)).toBe(text);
    }
    expect(textOf(validateComposition(one({ kind: 'text', text: 'abc xyz 09' }), params))).toBe('ABC XYZ 09');
    expect(TEXT_MAX).toBe(20);
  });

  it('read back from storage, non-canonical (lower-case) text is rejected, not normalised', () => {
    const stored = validateComposition(one({ kind: 'text', text: 'hello' }), params, { mode: 'stored' });
    expect(stored.ok ? 'accepted' : pairs(stored.errors)).toEqual(['movements[0].recipe.text INVALID_TEXT']);
    expect(validateComposition(one({ kind: 'text', text: 'HELLO' }), params, { mode: 'stored' }).ok).toBe(true);
  });

  it('agrees with validateText on a sweep of characters, and commands.ts re-exports the same function', () => {
    expect(commands.validateText).toBe(validateText);
    expect(commands.TEXT_MAX).toBe(TEXT_MAX);
    for (let code = 0; code < 0x3000; code += 7) {
      const text = `A${String.fromCodePoint(code)}`;
      expect(validateComposition(one({ kind: 'text', text }), params).ok, `U+${code.toString(16)}`).toBe(validateText(text) === null);
    }
  });
});

describe('MDB-T04/T05 values JSON cannot carry', () => {
  const params = makeParams(40);
  it('NaN and ±Infinity palette channels are INVALID_COLOUR', () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      const r = validateComposition(one({ kind: 'sphere', palette: [[0, x, 0], [0, 0, 0]] }), params);
      expect(r.ok ? 'accepted' : pairs(r.errors)).toEqual(['movements[0].recipe.palette[0] INVALID_COLOUR']);
    }
  });
  it('NaN and Infinity holdTicks are INVALID_TIMING; -0 is stored as 0', () => {
    for (const x of [NaN, Infinity]) {
      const r = validateComposition(one({ kind: 'sphere' }, x), params);
      expect(r.ok ? 'accepted' : pairs(r.errors)).toEqual(['movements[0].holdTicks INVALID_TIMING']);
    }
    const zero = validateComposition(one({ kind: 'sphere', palette: [[-0, 0, 0], [0, 0, 0]] }, -0), params);
    expect(zero.ok && Object.is(zero.composition.movements[0]!.holdTicks, 0) && Object.is(zero.composition.movements[0]!.recipe.palette![0][0], 0)).toBe(true);
  });
});

describe('MDB-T07 safety: total over unknown, shape-directed', () => {
  const params = makeParams(40);
  const deep = (depth: number) => { let v: unknown = []; for (let i = 0; i < depth; i++) v = [v]; return v; };
  const FX_DEEP = deep(32 * 1024);   // about 64 KiB of `[[[[…]]]]` as JSON: passed as a parsed value
  const hostile: [string, unknown][] = [
    ['undefined', undefined], ['null', null], ['0', 0], ['string', 'show'], ['true', true], ['bigint', 10n], ['symbol', Symbol('x')],
    ['function', () => 1], ['Date', new Date(0)], ['Map', new Map()], ['class instance', new (class Show { v = 1; movements = [] })()],
    ['FX-DEEP', FX_DEEP],
    ['throwing getter', Object.defineProperty({ v: 1 }, 'movements', { enumerable: true, get() { throw new Error('boom'); } })],
    ['throwing proxy', new Proxy({}, { ownKeys() { throw new Error('boom'); }, get() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); }, getPrototypeOf() { throw new Error('boom'); } })],
    ['symbol key', { v: 1, movements: [{ recipe: { kind: 'sphere' }, holdTicks: 600 }], [Symbol('k')]: 1 }],
    ['sparse movements', { v: 1, movements: [, { recipe: { kind: 'sphere' }, holdTicks: 600 }] }],   // eslint-disable-line no-sparse-arrays
  ];
  const places = (v: unknown): [string, unknown, unknown][] => [
    ['composition', v, null],
    ['movements', { v: 1, movements: v }, null],
    ['movement', { v: 1, movements: [v] }, null],
    ['recipe', one(v), null],
    ['palette', one({ kind: 'sphere', palette: v }), null],
    ['request', null, v],
    ['request.composition', null, { schemaVersion: 1, title: 'T', source: 'manual', composition: v }],
    ['request.generator', null, { schemaVersion: 1, title: 'T', source: 'gemini', generator: v, composition: one({ kind: 'sphere' }) }],
  ];

  it('never throws and never accepts, whatever the value and wherever it sits', () => {
    for (const [name, value] of hostile) {
      for (const [where, composition, request] of places(value)) {
        const label = `${name} as ${where}`;
        const result = composition !== null ? validateComposition(composition, params) : validateShowRequest(request, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) for (const e of result.errors) expect(['UNKNOWN_KEY', 'INVALID_FIELD', 'INVALID_COLOUR', 'INVALID_TIMING', 'UNSUPPORTED_RECIPE', 'TOO_MANY_MOVEMENTS'], label).toContain(e.reason);
      }
    }
  });

  it('FX-DEEP is rejected as INVALID_FIELD at the place it sits, without recursion', () => {
    const r = validateComposition({ v: 1, movements: [{ recipe: FX_DEEP, holdTicks: 600 }] }, params);
    expect(r.ok ? 'accepted' : pairs(r.errors)).toEqual(['movements[0].recipe INVALID_FIELD']);
    expect(() => canonicalJson(FX_DEEP)).toThrow(RangeError);   // what the shape-directed check spares canonicalJson
  });

  it('$-prefixed, dotted and prototype keys are rejected under R2 at any depth, even where no key is allowed', () => {
    const r2 = (input: unknown, request = false) => {
      const r = request ? validateShowRequest(input, params) : validateComposition(input, params);
      return r.ok ? [] : r.errors.filter(e => e.rule === 'R2').map(e => `${e.path} ${e.reason}`);
    };
    const show = { schemaVersion: 1, title: 'T', source: 'manual', composition: one({ kind: 'sphere' }) };
    expect(r2({ ...show, $set: 1, 'a.b': 1, constructor: 1 }, true)).toEqual(['$set UNKNOWN_KEY', '["a.b"] UNKNOWN_KEY', 'constructor UNKNOWN_KEY']);
    expect(r2({ v: 1, movements: [{ recipe: { kind: 'sphere', $inc: 1 }, holdTicks: 600, prototype: 1 }] })).toEqual(['movements[0].prototype UNKNOWN_KEY', 'movements[0].recipe.$inc UNKNOWN_KEY']);
    expect(r2({ ...show, source: 'gemini', generator: { model: 'm', integrationVersion: '1', $where: 'x' } }, true)).toEqual(['generator.$where UNKNOWN_KEY']);
  });

  it('prototype keys leave Object.prototype unchanged', () => {
    for (const c of corpus.find(f => f.id === 'FX-BAD/proto')!.cases) run(c, params);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn((corpus.find(f => f.id === 'FX-BAD/proto')!.cases[0]!.input as object), '__proto__')).toBe(true);   // the fixture really carries it
  });
});

describe('MDB-T08 trial expansion', () => {
  /** A deterministic stream (no Math.random). */
  const lcg = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; };

  it('every accepted movement expands to exactly n0 slots at n0 40 and 200', () => {
    for (const n0 of N0S) {
      const params = makeParams(n0);
      for (const c of cases.filter(x => x.expect.ok)) {
        const r = run(c, params);
        if (!r.ok) throw new Error(c.id);
        const composition = 'request' in r ? r.request.composition : r.composition;
        for (const m of composition.movements) expect(expandRecipe(m.recipe, n0, params).slots).toHaveLength(n0);
      }
    }
  });

  it('property sweep: nothing passes the validator and then fails expandRecipe, and valid inputs are accepted', () => {
    const rand = lcg(230);
    const alphabet = [...'ABCXYZ09 az', '!', 'é', 'ß', '\t', '🙂'];
    const params = makeParams(200);
    let accepted = 0;
    for (let i = 0; i < 400; i++) {
      const text = Array.from({ length: Math.floor(rand() * 23) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
      const channel = () => [0, 1, rand(), rand() * 1.2 - 0.1][Math.floor(rand() * 4)]!;
      const palette = rand() < 0.5 ? undefined : [[channel(), channel(), channel()], [channel(), channel(), channel()]];
      const recipe: Record<string, unknown> = rand() < 0.6 ? { kind: 'text', text } : { kind: rand() < 0.5 ? 'sphere' : 'helix' };
      if (palette) recipe.palette = palette;
      const r = validateComposition(one(recipe, Math.floor(rand() * 7000)), params);
      const textOk = recipe.kind !== 'text' || validateText(text) === null;
      const paletteOk = !palette || palette.flat().every(x => x >= 0 && x <= 1);
      const holdOk = r.ok || !pairs(r.errors).some(e => e.endsWith('INVALID_TIMING'));
      if (r.ok) {
        accepted++;
        expect(() => expandRecipe(r.composition.movements[0]!.recipe as Recipe, 200, params)).not.toThrow();
      } else if (textOk && paletteOk && holdOk) throw new Error(`valid input rejected: ${JSON.stringify(recipe)} ${JSON.stringify(r.errors)}`);
    }
    expect(accepted).toBeGreaterThan(40);
  });
});

describe('limits and preview', () => {
  it('COMPOSITION_LIMITS are the canonical bounds and frozen', () => {
    expect(COMPOSITION_LIMITS).toEqual({ maxMovements: 16, maxHoldTicks: 6000, maxTitleChars: 80, maxPromptChars: 2000, maxBodyBytes: 65536 });
    expect(Object.isFrozen(COMPOSITION_LIMITS)).toBe(true);
  });
  it('compositionPreview gives the listing summary', () => {
    const r = validateComposition(cases.find(c => c.name === 'FX-SHOW composition')!.input, makeParams(40));
    if (!r.ok) throw new Error('rejected');
    expect(compositionPreview(r.composition)).toEqual({ movementCount: 3, kinds: ['text', 'sphere', 'helix'] });
  });
});
