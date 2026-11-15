// Linter findings as composer warnings (P2-WP-05, #208; choreography RFC section 9). Warnings only: nothing here can
// make a draft invalid or stop an injection (P2-T09). validateDraft appends these lines after its own checks pass.
//
// - Formation checks (L2 radio graph, L3 islands, L4 altitude) always run on the draft's own formation.
// - Transition checks (L1 predicted conflicts, L5 paced speed) run only when the authored score and the current tick
//   are given. They lint the score composeNext would inject at that tick, through the same lintScore definition the
//   CLI report uses, so the composer and `lintReport` count the same pairs and slots for the same score, tick and recipe.
// - Any exception from the linter is caught and gives no lint lines at all.
// - Findings are `warnings`. A transition that was not checked (no authored score, or an unpaced flight) is a muted
//   `note`, never a warning: it describes what was linted, not the draft (#208 follow-up).
//
// No createPanel export: the panel loader skips this module.
import type { Params, Recipe, Score } from '../../contracts';
import { composeNext, currentMovement, expandRecipe } from '../../score';
import { canonicalJson } from '../../score/canonical';
import { L1_LABEL, lintFormation, lintTransition, scoreTransitions, type LintFinding, type ScoreTransition } from '../../cli/lint';

/** The authored score the controller composes from, and the tick the composition would happen at. */
export interface DraftLintContext { score: Score; tick: number }

/** Lint output: findings to show as warnings, and muted notes about what was not checked. */
export interface DraftLint { warnings: string[]; notes: string[] }

/** Shown (as a muted note) when no authored score is available, so the transition was not checked. */
export const TRANSITION_NOT_LINTED = 'Transition not linted: the composer has no authored score to compose from, so only the formation was checked.';

// Caches are keyed by CONTENT, never object identity: the params values, the recipe, and the authored score itself
// (canonicalJson, which includes its version). A reset, a re-created params object or a new score with a reused
// version therefore can never return another score's lint. Each cache keeps at most CACHE_LIMIT entries.
const CACHE_LIMIT = 64;
const formationCache = new Map<string, string[]>();
const transitionCache = new Map<string, DraftLint>();

/** Empties both caches. Never needed for correctness (keys are content); tests use it to measure uncached work. */
export function resetDraftLintCache(): void { formationCache.clear(); transitionCache.clear(); }

function cached<T>(store: Map<string, T>, key: string, compute: () => T): T {
  const hit = store.get(key);
  if (hit) return hit;
  const value = compute();
  if (store.size >= CACHE_LIMIT) store.delete(store.keys().next().value as string);   // oldest first
  store.set(key, value);
  return value;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One warning line per finding with severity 'warn'. Info findings (clean results, diameters) are not shown. */
function formationLines(findings: readonly LintFinding[], params: Params): string[] {
  const lines: string[] = [];
  for (const f of findings) {
    if (f.severity !== 'warn') continue;
    if (f.check === 'L2') lines.push(`Lint L2 · ${f.count} separate radio groups at ${params.rRadio} m: a score injected into one cannot reach the others while this formation holds.`);
    else if (f.check === 'L3') lines.push(`Lint L3 · ${plural(f.count, 'island slot')} with no other slot within ${params.rClaim} m: a drone lost there cannot be replaced.`);
    else if (f.check === 'L4') lines.push(`Lint L4 · ${plural(f.count, 'slot')} below ${f.threshold} m (lowest ${(f.value ?? 0).toFixed(2)} m).`);
  }
  return lines;
}

function transitionLines(transition: ScoreTransition, findings: readonly LintFinding[], params: Params): DraftLint {
  if (!transition.paced) return { warnings: [], notes: [`Transition not linted: ${transition.reason ?? 'not paced'}.`] };
  const warnings: string[] = [];
  for (const f of findings) {
    if (f.severity !== 'warn') continue;
    if (f.check === 'L1') warnings.push(`Lint L1 · ${f.count} ${L1_LABEL} (pairs closer than ${params.dCollide} m on the way to this formation).`);
    else if (f.check === 'L5') warnings.push(`Lint L5 · ${plural(f.count, 'slot')} would fly faster than ${f.threshold} m/s (half vMax) on the paced flight; the fastest at ${(f.value ?? 0).toFixed(2)} m/s.`);
  }
  return { warnings, notes: [] };
}

/**
 * The transition into the new (last) movement of `composed` and its L1/L5 findings. This is lintScore's transition
 * branch for that one movement (tests/app/composer/lintWarnings.test.ts checks it against lintScore), without linting
 * every formation of the composed score. The new movement is the last one, so no later movement cuts its flight (fMax 1).
 */
export function newMovementTransition(composed: Score, params: Params): { transition: ScoreTransition; findings: LintFinding[] } {
  const transitions = scoreTransitions(composed, params.n0, params);
  const t = transitions[transitions.length - 1] as ScoreTransition;
  if (!t.paced) return { transition: t, findings: [] };
  return { transition: t, findings: lintTransition(t.from, t.to, t.span, params, { begin: t.begin, movement: t.movement }) };
}

/**
 * Lint for a structurally valid `recipe`: formation checks always, transition checks only with `ctx`.
 * Never throws: any linter exception returns no warnings and no notes.
 */
export function lintDraft(recipe: Recipe, params: Params, ctx?: DraftLintContext): DraftLint {
  try {
    const baseKey = `${canonicalJson(params)}|${canonicalJson(recipe)}`;
    const formation = cached(formationCache, baseKey, () => formationLines(lintFormation(expandRecipe(recipe, params.n0, params), params), params));
    if (!ctx) return { warnings: [...formation], notes: [TRANSITION_NOT_LINTED] };
    // The composed transition depends on the tick only through which movement is current: composeNext copies that
    // movement and starts the new one scoreLead after the tick, and L1/L5 counts do not depend on the start tick.
    const { index } = currentMovement(ctx.score, ctx.tick);
    const transition = cached(transitionCache, `${baseKey}|${canonicalJson(ctx.score)}|${index}`, () => {
      const { transition: t, findings } = newMovementTransition(composeNext(ctx.score, ctx.tick, recipe, 0, params.n0, params), params);
      return transitionLines(t, findings, params);
    });
    return { warnings: [...formation, ...transition.warnings], notes: [...transition.notes] };
  } catch {
    return { warnings: [], notes: [] };
  }
}
