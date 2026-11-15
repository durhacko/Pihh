// Linter findings as composer warnings (P2-WP-05, #208; choreography RFC section 9). Warnings only: nothing here can
// make a draft invalid or stop an injection (P2-T09). validateDraft appends these lines after its own checks pass.
//
// - Formation checks (L2 radio graph, L3 islands, L4 altitude) always run on the draft's own formation.
// - Transition checks (L1 predicted conflicts, L5 paced speed) run only when the authored score and the current tick
//   are given. They lint the score composeNext would inject at that tick, through the same lintScore definition the
//   CLI report uses, so the composer and `lintReport` count the same pairs and slots for the same score, tick and recipe.
// - Any exception from the linter is caught and gives no lint lines at all.
//
// No createPanel export: the panel loader skips this module.
import type { Params, Recipe, Score } from '../../contracts';
import { composeNext, currentMovement, expandRecipe } from '../../score';
import { L1_LABEL, lintFormation, lintTransition, scoreTransitions, type LintFinding, type ScoreTransition } from '../../cli/lint';

/** The authored score the controller composes from, and the tick the composition would happen at. */
export interface DraftLintContext { score: Score; tick: number }

/** Shown when no authored score is available, so the transition was not checked. */
export const TRANSITION_NOT_LINTED = 'Transition not linted: the composer has no authored score to compose from, so only the formation was checked.';

const CACHE_LIMIT = 64;
const formationCache = new WeakMap<Params, Map<string, string[]>>();
const transitionCache = new WeakMap<Params, Map<string, string[]>>();

function cached(store: WeakMap<Params, Map<string, string[]>>, params: Params, key: string, compute: () => string[]): string[] {
  let map = store.get(params);
  if (!map) { map = new Map(); store.set(params, map); }
  const hit = map.get(key);
  if (hit) return hit;
  const lines = compute();
  if (map.size >= CACHE_LIMIT) map.delete(map.keys().next().value as string);   // oldest first
  map.set(key, lines);
  return lines;
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

function transitionLines(transition: ScoreTransition, findings: readonly LintFinding[], params: Params): string[] {
  if (!transition.paced) return [`Transition not linted: ${transition.reason ?? 'not paced'}.`];
  const lines: string[] = [];
  for (const f of findings) {
    if (f.severity !== 'warn') continue;
    if (f.check === 'L1') lines.push(`Lint L1 · ${f.count} ${L1_LABEL} (pairs closer than ${params.dCollide} m on the way to this formation).`);
    else if (f.check === 'L5') lines.push(`Lint L5 · ${plural(f.count, 'slot')} would fly faster than ${f.threshold} m/s (half vMax) on the paced flight; the fastest at ${(f.value ?? 0).toFixed(2)} m/s.`);
  }
  return lines;
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
 * Lint lines for a structurally valid `recipe`. Formation checks always; transition checks only with `ctx`.
 * Never throws: any linter exception returns [].
 */
export function lintWarnings(recipe: Recipe, params: Params, ctx?: DraftLintContext): string[] {
  try {
    const recipeKey = JSON.stringify(recipe);
    const formation = cached(formationCache, params, recipeKey, () => formationLines(lintFormation(expandRecipe(recipe, params.n0, params), params), params));
    if (!ctx) return [...formation, TRANSITION_NOT_LINTED];
    // The composed transition depends on the tick only through which movement is current: composeNext copies that
    // movement and starts the new one scoreLead after the tick, and L1/L5 counts do not depend on the start tick.
    const { index } = currentMovement(ctx.score, ctx.tick);
    const key = `${recipeKey}|${ctx.score.version.issuedTick}:${ctx.score.version.origin}|${index}`;
    const transition = cached(transitionCache, params, key, () => {
      const { transition: t, findings } = newMovementTransition(composeNext(ctx.score, ctx.tick, recipe, 0, params.n0, params), params);
      return transitionLines(t, findings, params);
    });
    return [...formation, ...transition];
  } catch {
    return [];
  }
}
