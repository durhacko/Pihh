// P2-WP-05 (#208): score linter findings as composer warnings before injection. Warnings never block (P2-T09).
// "Transition not linted" is a muted note, never a warning; the caches are keyed by content, so resets are safe.
// Headless: real worlds, real controller (the pattern of inject.test.ts); no DOM, no WebGL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeParams, type EnvEvent, type Params, type Recipe, type Score } from '../../../src/contracts';
import { composeNext, currentMovement, makeScore } from '../../../src/score';
import * as realLint from '../../../src/cli/lint';
import { createActionController } from '../../../src/app/actions';
import { resetViewMode } from '../../../src/app/render/colourModes/viewMode';
import { Drafts, injectFromComposer, validateDraft, type Draft } from '../../../src/app/ui/Composer';
import { createConsoleEngine, type ConsoleContext, type ConsoleLine } from '../../../src/app/ui/Console';
import { lintDraft, newMovementTransition, resetDraftLintCache, TRANSITION_NOT_LINTED } from '../../../src/app/ui/draftLint';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';

// The linter as shipped, with a switch to make it throw and a call counter (for the exception and caching tests).
const lintSwitch = vi.hoisted(() => ({ throws: false, formationCalls: 0, transitionCalls: 0 }));
vi.mock('../../../src/cli/lint', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/cli/lint')>();
  return {
    ...real,
    lintFormation: (...args: Parameters<typeof real.lintFormation>) => {
      lintSwitch.formationCalls++;
      if (lintSwitch.throws) throw new Error('linter exploded');
      return real.lintFormation(...args);
    },
    lintTransition: (...args: Parameters<typeof real.lintTransition>) => {
      lintSwitch.transitionCalls++;
      if (lintSwitch.throws) throw new Error('linter exploded');
      return real.lintTransition(...args);
    },
  };
});

beforeEach(() => { resetDraftLintCache(); });   // content-keyed caches persist across tests otherwise
afterEach(() => { resetViewMode(); vi.restoreAllMocks(); lintSwitch.throws = false; lintSwitch.formationCalls = 0; lintSwitch.transitionCalls = 0; });

function setup(seed = 11, n0 = 40) {
  const worlds = createWorlds({ seed, n0 });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); },
    display: viewModeDisplay,
  }));
  const handle = vi.spyOn(controller, 'handle');
  const ctx: ConsoleContext = {
    controller, store: new Store(), drafts: new Drafts(), params: worlds.params,
    snapshots: () => worlds.latest()!, samples: () => worlds.samples(), events: new EventTarget(),
    score: () => worlds.score,
  };
  const lines: ConsoleLine[] = [];
  const engine = createConsoleEngine(ctx, line => lines.push(line));
  return { worlds, controller, handle, ctx, lines, engine };
}
const injects = (log: EnvEvent[]) => log.filter((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');
const lintLines = (warnings: readonly string[]) => warnings.filter(w => w.startsWith('Lint ') || w.startsWith('Transition not linted'));
const draft = (text: string, kind: Draft['kind'] = 'text'): Draft => ({ id: 'dx', name: 'X', kind, text, palette: null, sent: [] });
const evalLike = (n0: number, params: Params): Score => makeScore([{ kind: 'text', text: 'ENCORE' }, { kind: 'sphere' }, { kind: 'helix' }], n0, params);

describe('P2-T09: lint never blocks', () => {
  it('a draft with findings still validates ok and injects exactly one INJECT_SCORE, from the Composer and the console', async () => {
    for (const path of ['composer', 'console'] as const) {
      const fx = setup();
      const lint = { score: fx.worlds.score, tick: fx.worlds.latest()!.encore.tick };
      const v = validateDraft(fx.ctx.drafts.current, fx.ctx.params, lint);
      expect(v.ok).toBe(true);
      expect(v.errors).toEqual([]);
      expect(lintLines(v.warnings).some(w => w.startsWith('Lint L1 · '))).toBe(true);   // findings, not a clean pass
      if (path === 'composer') expect((await injectFromComposer(fx.ctx, 'd1', 5)).status).toBe('done');
      else await fx.engine.run('inject --drone 5 --draft d1');
      expect(injects(fx.controller.getEventLog())).toHaveLength(1);
      expect(fx.handle).toHaveBeenCalled();
    }
  });

  it('a throwing linter gives no lint lines and changes nothing else: ok, errors, recipe and the one INJECT_SCORE', async () => {
    const fx = setup();
    const lint = { score: fx.worlds.score, tick: fx.worlds.latest()!.encore.tick };
    lintSwitch.throws = true;
    const v = validateDraft(fx.ctx.drafts.current, fx.ctx.params, lint);
    expect(lintSwitch.formationCalls).toBeGreaterThan(0);                // the linter really ran, and threw
    expect(v).toMatchObject({ ok: true, errors: [], recipe: { kind: 'text', text: 'DURHACK' } });
    expect(lintLines(v.warnings)).toEqual([]);
    expect(v.notes).toEqual([]);
    const outcome = await injectFromComposer(fx.ctx, 'd1', 5);
    expect(outcome.status).toBe('done');
    expect(injects(fx.controller.getEventLog())).toHaveLength(1);
  });

  it('lint never changes ok, errors or recipe, for valid and invalid drafts, with or without a score', () => {
    const params = makeParams(40);
    const score = evalLike(40, params);
    for (const d of [draft('DURHACK'), draft('A B'), draft('ENCORE'), draft('', 'sphere'), draft('', 'helix'), draft('ÉTÉ!'), { ...draft('OK'), name: ' ' }, draft('ABCDEFGHIJKLMNOPQRSTUVWXYZ')]) {
      const plain = validateDraft(d, params);
      const linted = validateDraft(d, params, { score, tick: 5 });
      expect({ ok: linted.ok, errors: linted.errors, recipe: linted.recipe }).toEqual({ ok: plain.ok, errors: plain.errors, recipe: plain.recipe });
      if (!plain.ok) expect([lintLines(linted.warnings), linted.notes]).toEqual([[], []]);   // the linter only sees valid drafts
    }
  });
});

describe('"Transition not linted" is a muted note, never a warning (#208 follow-up)', () => {
  it('no draft, with or without a score, ever has a "Transition not linted" warning', () => {
    const params = makeParams(40);
    const score = evalLike(40, params);
    let notes = 0;
    for (const d of [draft('DURHACK'), draft('ENCORE'), draft('A B'), draft('', 'sphere'), draft('', 'helix')]) {
      for (const lint of [undefined, { score, tick: 5 }, { score, tick: 1000 }, { score, tick: 1700 }]) {
        const v = validateDraft(d, params, lint);
        expect(v.warnings.filter(w => /not linted/i.test(w)), `${d.text || d.kind} ${lint?.tick}`).toEqual([]);
        notes += (v.notes ?? []).length;
      }
    }
    expect(notes).toBeGreaterThan(5);   // the notes exist: 5 drafts without a score, plus the unpaced ENCORE → ENCORE and sphere → sphere
  });
});

describe('transition linting matches the CLI report', () => {
  it('composer L1/L5 counts equal lintScore (what lintReport prints) for the same score, tick and recipe', () => {
    for (const n0 of [40, 200]) {
      const params = makeParams(n0);
      const score = evalLike(n0, params);
      for (const tick of [5, 1000, 1600]) {
        for (const recipe of [{ kind: 'text', text: 'DURHACK' }, { kind: 'text', text: 'A B' }, { kind: 'sphere' }, { kind: 'helix' }] as Recipe[]) {
          const composed = composeNext(score, tick, recipe, 0, n0, params);
          const cli = realLint.lintScore(composed, n0, params).at(-1)!;
          const ours = newMovementTransition(composed, params);
          expect(ours.transition).toEqual(cli.transition);
          const cliTransition = cli.findings.filter(f => f.check === 'L1' || f.check === 'L5');
          if (cli.transition.paced) expect(ours.findings).toEqual(cliTransition);
          const { warnings, notes } = lintDraft(recipe, params, { score, tick });
          const l1 = cliTransition.find(f => f.check === 'L1')!;
          const l5 = cliTransition.find(f => f.check === 'L5')!;
          if (!cli.transition.paced) expect(notes).toEqual([`Transition not linted: ${cli.transition.reason}.`]);
          else {
            expect(notes).toEqual([]);
            expect(warnings.some(w => w.startsWith(`Lint L1 · ${l1.count} ${realLint.L1_LABEL}`))).toBe(l1.count > 0);
            expect(warnings.some(w => w.startsWith(`Lint L5 · ${l5.count} slot`))).toBe(l5.count > 0);
          }
        }
      }
    }
  });

  it('L1 is worded only as predicted conflicts under ideal paced flight (no avoidance), never a collision forecast', () => {
    const params = makeParams(200);
    const lines = lintDraft({ kind: 'text', text: 'DURHACK' }, params, { score: evalLike(200, params), tick: 5 }).warnings;
    const l1 = lines.filter(w => w.startsWith('Lint L1'));
    expect(l1).toHaveLength(1);
    expect(l1[0]).toContain('predicted conflicts under ideal paced flight (no avoidance) — not a collision forecast');
    expect(lines.join(' ')).not.toMatch(/will collide|collisions expected|crash/i);
  });

  it('the composed transition depends on the tick only through which movement is current', () => {
    const params = makeParams(40);
    const score = evalLike(40, params);
    const recipe: Recipe = { kind: 'text', text: 'DURHACK' };
    const counts = (tick: number) => newMovementTransition(composeNext(score, tick, recipe, 0, 40, params), params).findings.map(f => [f.check, f.count, f.value]);
    const byMovement = new Map<number, unknown>();
    for (let tick = 0; tick < 2000; tick += 37) {
      const index = currentMovement(score, tick).index;
      if (!byMovement.has(index)) byMovement.set(index, counts(tick));
      else expect(counts(tick)).toEqual(byMovement.get(index));
    }
    expect(byMovement.size).toBe(3);
    expect(byMovement.get(0)).not.toEqual(byMovement.get(1));            // a different current movement does change it
  });
});

describe('formation-only path and caching', () => {
  it('without a score: formation checks only, and a muted note says the transition was not linted', () => {
    const params = makeParams(200);
    const { warnings, notes } = lintDraft({ kind: 'text', text: 'A B' }, params);
    expect(notes).toEqual([TRANSITION_NOT_LINTED]);
    expect(warnings.some(w => w.startsWith('Lint L2 · 2 separate radio groups'))).toBe(true);   // a real formation finding
    expect(warnings.some(w => w.startsWith('Lint L1') || w.startsWith('Lint L5'))).toBe(false);
    expect(lintSwitch.transitionCalls).toBe(0);
    expect(lintDraft({ kind: 'text', text: 'A B' }, params, { score: evalLike(200, params), tick: 5 }).notes).toEqual([]);
  });

  it('a mounted composer without ctx.score (today’s shell) gets the note through validateDraft, not a warning', () => {
    const fx = setup();
    delete fx.ctx.score;
    const v = validateDraft(fx.ctx.drafts.current, fx.ctx.params);
    expect(v.notes).toEqual([TRANSITION_NOT_LINTED]);
    expect(v.warnings).not.toContain(TRANSITION_NOT_LINTED);
  });

  it('caches per recipe, score content and current movement: no relint for another tick in the same movement', () => {
    const params = makeParams(40);
    const score = evalLike(40, params);
    const recipe: Recipe = { kind: 'text', text: 'DURHACK' };
    const first = lintDraft(recipe, params, { score, tick: 5 });
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual([1, 1]);
    expect(lintDraft(recipe, params, { score, tick: 200 })).toEqual(first);                  // same movement
    expect(lintDraft(recipe, params)).toEqual({ warnings: first.warnings.filter(w => !w.startsWith('Lint L1') && !w.startsWith('Lint L5')), notes: [TRANSITION_NOT_LINTED] });
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual([1, 1]);
    lintDraft(recipe, params, { score, tick: 1000 });                                        // movement 1: relint the transition only
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual([1, 2]);
    lintDraft(recipe, params, { score: { ...score, version: { issuedTick: 7, origin: 3 } }, tick: 1000 });   // another score
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual([1, 3]);
    lintDraft({ kind: 'text', text: 'DURHAM' }, params, { score, tick: 5 });               // another recipe
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual([2, 4]);
  });

  it('is reset-safe: keyed by content, so a new score that reuses a version is relinted, and equal content is not', () => {
    const params = makeParams(40);
    const score = evalLike(40, params);
    const recipe: Recipe = { kind: 'text', text: 'DURHACK' };
    const before = lintDraft(recipe, params, { score, tick: 5 });
    // After a reset, an authored score can carry the same version with other movements (here: other recipes).
    const other: Score = { version: { ...score.version }, movements: makeScore([{ kind: 'helix' }, { kind: 'sphere' }], 40, params).movements };
    expect(other.version).toEqual(score.version);
    const after = lintDraft(recipe, params, { score: other, tick: 5 });
    expect(lintSwitch.transitionCalls).toBe(2);                                              // not served from the cache
    expect(after.warnings).not.toEqual(before.warnings);                                     // and really different
    const fresh = newMovementTransition(composeNext(other, 5, recipe, 0, 40, params), params).findings.find(f => f.check === 'L1')!;
    expect(after.warnings.some(w => w.startsWith(`Lint L1 · ${fresh.count} `))).toBe(fresh.count > 0);
    // Equal content in new objects (a structured clone, a re-made params) is a cache hit: no further lint calls.
    const calls = [lintSwitch.formationCalls, lintSwitch.transitionCalls];   // `fresh` above called lintTransition itself
    expect(lintDraft(recipe, makeParams(40), { score: structuredClone(score), tick: 5 })).toEqual(before);
    expect([lintSwitch.formationCalls, lintSwitch.transitionCalls]).toEqual(calls);
  });
});

describe.runIf(process.env.P2_PERF === '1')('P2_PERF: uncached validation at n0 200', () => {
  it('prints the uncached validateDraft time with lint, per draft', () => {
    const texts = ['DURHACK', 'ENCORE', 'HELLO WORLD', 'A', 'A B', 'SWARM 2026', 'XYZ', 'PIHH', 'OK GO'];
    const times: number[] = [];
    const cachedTimes: number[] = [];
    for (const [i, text] of texts.entries()) {
      const params = makeParams(200);
      const score = evalLike(200, params);
      resetDraftLintCache();            // uncached: the caches are keyed by content, so a fresh Params object is not enough
      const t0 = performance.now();
      validateDraft({ ...draft(text), id: `p${i}` }, params, { score, tick: 5 });
      times.push(performance.now() - t0);
      const t1 = performance.now();
      for (let k = 0; k < 100; k++) validateDraft({ ...draft(text), id: `p${i}` }, params, { score, tick: 5 });   // cached: the 4 Hz render path
      cachedTimes.push((performance.now() - t1) / 100);
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`uncached validateDraft + lint, n0 200: ${texts.map((t, i) => `${t} ${times[i]!.toFixed(1)}`).join(', ')} ms; median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)}, max ${sorted.at(-1)!.toFixed(1)} ms; cached max ${Math.max(...cachedTimes).toFixed(3)} ms`);
  });
});
