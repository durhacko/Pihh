// GF-WP-11 (#214): the RunRecord validator accepts a generated INJECT_SCORE recipe (GF-CC-01), checked structurally
// only. The record is the committed S5 run (results/S5_n200_encore_s1.json) with its injected movement's recipe
// replaced by a REAL generated recipe from makeGeneratedRecipe at n0 200 (runOne takes no custom events, so this is
// the closest real record shape; the rest of the record is the committed run, unchanged).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import { SCENARIO_TICKS } from '../../src/cli/scenarios';
import { makeGeneratedRecipe } from '../../src/score';
import { validateRunRecord } from '../../src/telemetry';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CTX = { sourceKind: 'cli-scenario' as const, expectedTicks: SCENARIO_TICKS };
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

const recipe = (() => {
  const dir = resolve(root, 'tests/fixtures/scenes');
  for (const file of readdirSync(dir).filter(f => f.startsWith('valid-')).sort()) {
    const made = makeGeneratedRecipe(JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as unknown, 200, makeParams(200));
    if (made.ok) return made.recipe;
  }
  throw new Error('no committed fixture compiles at n0 200');
})();

function s5With(replace: (r: typeof recipe) => unknown) {
  const s5 = JSON.parse(readFileSync(resolve(root, 'results/S5_n200_encore_s1.json'), 'utf8')) as { events: { type: string; score?: { movements: { recipe: unknown }[] } }[] };
  const at = s5.events.findIndex(e => e.type === 'INJECT_SCORE');
  expect(at).toBeGreaterThanOrEqual(0);
  const event = s5.events[at]!;
  const movements = event.score!.movements.map((m, i, all) => (i === all.length - 1 ? { ...m, recipe: replace(recipe) } : m));
  s5.events[at] = { ...event, score: { ...event.score!, movements } };
  return { record: s5, at, last: movements.length - 1 };
}
const errors = (value: unknown) => { const r = validateRunRecord(encode(value), CTX); return r.ok ? [] : r.errors.map(e => `${e.code} ${e.path}`); };

describe('telemetry: a generated INJECT_SCORE recipe in a RunRecord', () => {
  it('is accepted as it is (structurally checked, nothing re-derived)', () => {
    expect(errors(s5With(r => r).record)).toEqual([]);
  });

  it('a malformed generated recipe is still rejected, at its path', () => {
    const cases: [string, (r: typeof recipe) => unknown, RegExp][] = [
      ['sceneHash not hex', r => ({ ...r, sceneHash: 'XYZ' }), /BAD_EVENT .*\/sceneHash$/],
      ['compilerVersion 0', r => ({ ...r, compilerVersion: 0 }), /BAD_EVENT .*\/compilerVersion$/],
      ['digest not hex', r => ({ ...r, slotsDigest: { ...r.slotsDigest, digest: 'abc' } }), /BAD_EVENT .*\/slotsDigest\/digest$/],
      ['extra key', r => ({ ...r, palette: [[0, 0, 0], [1, 1, 1]] }), /UNKNOWN_KEY /],
      ['missing scene', r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'scene')), /MISSING_KEY .*\/scene$/],
      ['scene without title', r => ({ ...r, scene: { ...r.scene, title: 7 } }), /BAD_EVENT .*\/scene\/title$/],
    ];
    for (const [name, replace, pattern] of cases) {
      const found = errors(s5With(replace).record);
      expect(found.some(e => pattern.test(e)), `${name}: ${found.join('; ')}`).toBe(true);
    }
  });
});
