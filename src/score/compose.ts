// src/score/compose.ts
// Building scores: the launch grid, the preloaded score, and the next composition (contract section 6). Also the
// generated-recipe helpers of GF-CC-01 / GF-CC-02: makeGeneratedRecipe, copyRecipe and the brain's acceptsRecipe.
import { OPERATOR } from '../contracts';
import type { GeneratedRecipe, Movement, Params, Recipe, RGB, SceneSpec, Score, Vec3 } from '../contracts';
import { compiledSlotsDigest, expandRecipeStrict, wellFormedDigest } from './expand';
import { compileGeneratedScene, COMPILER_VERSION, type CompileWarning, type RejectCode } from './generated/compile';
import { sceneHash } from './generated/hashing';
import { validateScene } from './generated/validation';
import { currentMovement, transitionTicksBetween } from './timing';

const LAUNCH_PITCH = 1.5;          // metres between neighbours on the ground grid
const DEFAULT_HOLD_TICKS = 600;    // 30 s

// Scenes this package deep-froze (spec §8.7): the only scenes whose hash may be cached by identity (GF-WP-08, §8.3).
const frozenScenes = new WeakSet<object>();

/** True for a scene object this package deep-froze in `copyRecipe` (for GF-WP-08's hash cache). */
export function isPackageFrozenScene(scene: unknown): boolean {
  return typeof scene === 'object' && scene !== null && frozenScenes.has(scene);
}

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

// Operator side: the strict expansion, so a rejected generated scene throws instead of composing the fallback.
function slotPositions(recipe: Recipe, n0: number, params: Params): Vec3[] {
  return expandRecipeStrict(recipe, n0, params).slots.map((s) => s.pos);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * A copy of a recipe that shares nothing with it. For text, sphere and helix this is the same copy as before
 * GF-CC-01. For a generated recipe the scene is a deep-frozen clone (spec §8.7), so a later edit of the caller's
 * draft cannot reach a score, and an edit of the copy is a TypeError instead of silent corruption.
 */
export function copyRecipe(recipe: Recipe): Recipe {
  if (recipe.kind === 'generated') {
    const scene = deepFreeze(JSON.parse(JSON.stringify(recipe.scene)) as GeneratedRecipe['scene']);
    frozenScenes.add(scene);
    const { n0, slotSpacingMin, digest } = recipe.slotsDigest;
    return { kind: 'generated', compilerVersion: recipe.compilerVersion, sceneHash: recipe.sceneHash, slotsDigest: { n0, slotSpacingMin, digest }, scene };
  }
  if (recipe.palette === undefined) return { ...recipe };
  const [a, b] = recipe.palette;
  const palette: [RGB, RGB] = [[a[0], a[1], a[2]], [b[0], b[1], b[2]]];
  return { ...recipe, palette };
}

function copyMovement(m: Movement): Movement {
  return { startTick: m.startTick, transitionTicks: m.transitionTicks, recipe: copyRecipe(m.recipe) };
}

/**
 * The copy of `recipe` a new movement carries. A generated recipe gets the slotsDigest of the compile that also
 * sets the movement's transitionTicks, at this roster (GF-CC-02: composeNext and makeScore compute it). Other kinds
 * are copied as before.
 */
function movementRecipe(recipe: Recipe, n0: number, params: Params): Recipe {
  const copy = copyRecipe(recipe);
  if (copy.kind !== 'generated') return copy;
  const digest = compiledSlotsDigest(copy, n0, params);
  if (digest === null) throw new Error('movementRecipe: the strict expansion accepted a scene the compile rejected');
  return { ...copy, slotsDigest: { n0, slotSpacingMin: params.slotSpacingMin, digest } };
}

/**
 * The score an operator injects at `tick`: version `{ issuedTick: tick, origin }`; movements are the
 * old score's current movement, unchanged, followed by `recipe` starting at `tick + params.scoreLead`.
 * The new movement's transition time is measured from the current formation's slots.
 * A generated `recipe` the compiler rejects, or whose labels do not match, throws `GeneratedSceneRejected`.
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
    recipe: movementRecipe(recipe, n0, params),
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
    movements.push({ startTick, transitionTicks, recipe: movementRecipe(recipe, n0, params) });
    startTick += transitionTicks + holdTicks;
    from = to;
  }
  return { version: { issuedTick: 0, origin: OPERATOR }, movements };
}

/**
 * A generated recipe for `scene`, labelled from one compile at this roster (GF-CC-01): the canonical scene,
 * its sceneHash, COMPILER_VERSION and the slotsDigest at (n0, params.slotSpacingMin). Never throws: an invalid
 * scene gives the validator's issues, a rejected compile the compiler's code.
 */
export function makeGeneratedRecipe(scene: unknown, n0: number, params: Params):
  | { ok: true; recipe: GeneratedRecipe; warnings: CompileWarning[] }
  | { ok: false; code: RejectCode; detail: string } {
  // The compiler validates and maps every validation code to a typed rejection; the canonical scene it compiled is
  // then the validator's (the same pure function, so the same object shape).
  const compile = compileGeneratedScene(scene as SceneSpec, { n0, slotSpacingMin: params.slotSpacingMin, rClaim: params.rClaim, claimGap: params.claimGap }, n0);
  if (!compile.ok) return { ok: false, code: compile.code, detail: compile.detail };
  const validated = validateScene(scene);
  if (!validated.ok) return { ok: false, code: 'internal', detail: 'the scene compiled but did not validate' };
  const canonical: SceneSpec = validated.scene;
  const recipe = copyRecipe({
    kind: 'generated', compilerVersion: compile.compilerVersion, sceneHash: compile.sceneHash,
    slotsDigest: { n0, slotSpacingMin: params.slotSpacingMin, digest: compile.slotsDigest }, scene: canonical,
  }) as GeneratedRecipe;
  return { ok: true, recipe, warnings: compile.warnings };
}

/**
 * The brain's adoption check (GF-CC-02, contract section 9 "Adopt"). Pure and total: never throws. Text, sphere and
 * helix are always accepted, with no work. A generated recipe is refused only for causes every honest drone computes
 * the same way from the recipe and its own constants: `compilerVersion` is not COMPILER_VERSION; the `sceneHash`
 * label is not the hash of the scene; the compile is rejected; or the `slotsDigest` disagrees with this drone's
 * compile when its n0 and slotSpacingMin are this drone's. A digest made for another roster is not compared.
 */
export function acceptsRecipe(recipe: Recipe, n0: number, params: Params): boolean {
  if (recipe.kind !== 'generated') return true;
  try {
    if (recipe.compilerVersion !== COMPILER_VERSION) return false;
    if (!wellFormedDigest(recipe.slotsDigest)) return false;          // copyRecipe on adoption needs it; the type requires it
    if (typeof recipe.sceneHash !== 'string') return false;
    // The labels are compared on every call; only what is recomputed from the scene is memoised (sceneFacts).
    const facts = sceneFacts(recipe, n0, params);
    if (facts.hash === null || facts.hash !== recipe.sceneHash) return false;
    if (facts.digest === null) return false;
    const label = recipe.slotsDigest;
    if (label.n0 === n0 && label.slotSpacingMin === params.slotSpacingMin && label.digest !== facts.digest) return false;
    return true;
  } catch {
    return false;
  }
}

// Adoption memo (GF-CC-02, #289): what the adoption check recomputes from a scene, keyed on the scene's exact JSON.
// Every drone that adopts one injection checks the same scene, so it is validated, hashed and compiled once per world
// instead of once per drone. A memo of pure results; the oldest entry is dropped beyond SCENE_FACTS_MAX.
const SCENE_FACTS_MAX = 16;
const hashes = new Map<string, string | null>();
const digests = new Map<string, string | null>();

function memo<V>(map: Map<string, V>, key: string, compute: () => V): V {
  if (map.has(key)) return map.get(key) as V;
  const value = compute();
  if (map.size >= SCENE_FACTS_MAX) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
  return value;
}

/**
 * The hash of the scene whose JSON is `json`: the validator (its size caps run before any canonicalising or hashing),
 * then sceneHash of the canonical scene; null if it does not validate. Computed on `JSON.parse(json)`, never on the
 * caller's object, so the result depends on the JSON alone. Brains check JSON copies, for which the two agree.
 */
function hashOfJson(json: string): string | null {
  return memo(hashes, json, () => {
    try {
      const validated = validateScene(JSON.parse(json) as unknown);
      return validated.ok ? sceneHash(validated.scene) : null;
    } catch {
      return null;
    }
  });
}

/** The recomputed sceneHash, and the slotsDigest of this drone's compile at (n0, slotSpacingMin); null if rejected. */
function sceneFacts(recipe: GeneratedRecipe, n0: number, params: Params): { hash: string | null; digest: string | null } {
  const json = JSON.stringify(recipe.scene) as string | undefined;
  if (typeof json !== 'string') return { hash: null, digest: null };
  const hash = hashOfJson(json);
  if (hash === null) return { hash, digest: null };
  const digest = memo(digests, `${n0}|${params.slotSpacingMin}|${json}`, () =>
    // The compile reads only the scene; the parsed copy keeps it a function of the JSON.
    compiledSlotsDigest({ ...recipe, scene: JSON.parse(json) as GeneratedRecipe['scene'] }, n0, params));
  return { hash, digest };
}

/**
 * The hash of a generated recipe's scene recomputed from the scene's JSON, never its label: null if the scene does
 * not pass the validator (its size caps run before any canonicalising or hashing). Brains key refusal memory on it
 * (GF-CC-02). Memoised on that JSON, shared with `acceptsRecipe`.
 */
export function sceneHashOf(recipe: GeneratedRecipe): string | null {
  try {
    const json = JSON.stringify(recipe.scene) as string | undefined;
    return typeof json === 'string' ? hashOfJson(json) : null;   // memoised on the scene's exact JSON
  } catch {
    return null;
  }
}
