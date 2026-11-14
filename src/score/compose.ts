// src/score/compose.ts
// Building scores: the launch grid, the preloaded score, and the next composition (contract section 6).
import { OPERATOR } from '../contracts';
import type { Movement, Params, Recipe, RGB, Score, Vec3 } from '../contracts';
import { expandRecipe } from './expand';
import { currentMovement, transitionTicksBetween } from './timing';

const LAUNCH_PITCH = 1.5;          // metres between neighbours on the ground grid
const DEFAULT_HOLD_TICKS = 600;    // 30 s

/**
 * Where drone `id` stands at launch: a centred ground grid with 1.5 m pitch, filled row by row.
 * The world uses the same convention (agreed on issue #13).
 */
export function launchPos(id: number, n0: number): Vec3 {
  const cols = Math.ceil(Math.sqrt(n0));
  const rows = Math.ceil(n0 / cols);
  return [
    (id % cols - (cols - 1) / 2) * LAUNCH_PITCH,
    0,
    (Math.floor(id / cols) - (rows - 1) / 2) * LAUNCH_PITCH,
  ];
}

function slotPositions(recipe: Recipe, n0: number, params: Params): Vec3[] {
  return expandRecipe(recipe, n0, params).slots.map((s) => s.pos);
}

function copyRecipe(recipe: Recipe): Recipe {
  if (recipe.palette === undefined) return { ...recipe };
  const [a, b] = recipe.palette;
  const palette: [RGB, RGB] = [[a[0], a[1], a[2]], [b[0], b[1], b[2]]];
  return { ...recipe, palette };
}

function copyMovement(m: Movement): Movement {
  return { startTick: m.startTick, transitionTicks: m.transitionTicks, recipe: copyRecipe(m.recipe) };
}

/**
 * The score an operator injects at `tick`: version `{ issuedTick: tick, origin }`; movements are the
 * old score's current movement, unchanged, followed by `recipe` starting at `tick + params.scoreLead`.
 * The new movement's transition time is measured from the current formation's slots.
 */
export function composeNext(
  score: Score, tick: number, recipe: Recipe, origin: number, n0: number, params: Params,
): Score {
  const current = currentMovement(score, tick).movement;
  const next: Movement = {
    startTick: tick + params.scoreLead,
    transitionTicks: transitionTicksBetween(
      slotPositions(current.recipe, n0, params), slotPositions(recipe, n0, params), params,
    ),
    recipe: copyRecipe(recipe),
  };
  return { version: { issuedTick: tick, origin }, movements: [copyMovement(current), next] };
}

/**
 * Authoring helper for the preloaded score: version `{ issuedTick: 0, origin: OPERATOR }`. The first
 * movement starts at tick 0, with its transition measured from the launch grid. Each later movement
 * starts `holdTicks` after the previous movement's hold began, with its transition measured from the
 * previous formation.
 */
export function makeScore(recipes: Recipe[], n0: number, params: Params, holdTicks: number = DEFAULT_HOLD_TICKS): Score {
  if (recipes.length === 0) throw new RangeError('makeScore: at least one recipe is needed');
  let from: Vec3[] = [];
  for (let id = 0; id < n0; id++) from.push(launchPos(id, n0));
  const movements: Movement[] = [];
  let startTick = 0;
  for (const recipe of recipes) {
    const to = slotPositions(recipe, n0, params);
    const transitionTicks = transitionTicksBetween(from, to, params);
    movements.push({ startTick, transitionTicks, recipe: copyRecipe(recipe) });
    startTick += transitionTicks + holdTicks;
    from = to;
  }
  return { version: { issuedTick: 0, origin: OPERATOR }, movements };
}
