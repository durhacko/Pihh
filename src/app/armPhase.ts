// src/app/armPhase.ts
// Each arm's score phase for the readout and the Metrics popover: hold or transition, and the name of the movement the
// observer measures that arm against. Both come from ONE observer reading (Observer.slotStatus, through the throttled
// slot feed): inHold is the reading's own, and the name is that of the registered movement whose expansion IS the
// reading's formation. The observer chooses and retains its reference itself (src/observer/index.ts, retainedScore),
// so the app keeps no copy of that choice: after every holder of the newest score dies, the observer still measures
// against it and its formation says so; a reset rebuilds the observer and the feed drops the old reading.
// Shared by main.ts and its tests. No DOM, no three.
import type { Formation, Params, Score, WorldSnapshot } from '../contracts';
import { currentMovement, expandRecipe, newerVersion } from '../score';
import { FONT } from '../score/font';
import type { Pair } from './worlds';

/** One arm's phase: hold or transition (observer), and the name of the movement its reference formation is. */
export interface ArmPhase { inHold: boolean; name: string }

/** An observer reading as the slot feed keeps it (SlotStatusFeed.latest()): the tick it was computed for. */
export interface PhaseReading { tick: number; slots: { formation: Formation; inHold: boolean } }
/** The part of SlotStatusFeed (render/layers/GhostSlotLayer.ts) the phase step uses. */
export interface PhaseFeed { read(snapshot: WorldSnapshot): unknown; latest(): PhaseReading | null }

type Recipe = Score['movements'][number]['recipe'];
/**
 * The text as it is drawn (score/font.ts litCells): upper case, a character without a glyph drawn as a space, and the
 * outer spaces dropped, since they light no cell and the formation is centred on its lit cells. So two text recipes
 * with the same slot positions get the same name ("ENCORE" and "ENCORE " are one formation), and naming a
 * formation by the newest matching movement can never show the name of a formation the observer is not using.
 */
const drawnText = (text: string): string => [...text.toUpperCase()].map(ch => (Object.hasOwn(FONT, ch) ? ch : ' ')).join('').trim();
export const movementName = (recipe: Recipe): string =>
  recipe.kind === 'generated' ? recipe.scene.title   // GF-CC-01: never mislabelled "Double helix"
    : recipe.kind === 'text' ? `“${drawnText(recipe.text)}”` : recipe.kind === 'sphere' ? 'Sphere' : 'Double helix';

const samePositions = (a: Formation, b: Formation): boolean =>
  a.slots.length === b.slots.length && a.slots.every((slot, i) => {
    const p = slot.pos, q = b.slots[i].pos;
    return p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  });

/**
 * The recipe the observer measures against at `tick`, read from its formation: the newest registered score whose
 * current movement at that tick expands (expandRecipe, the observer's own call) to exactly these slot positions.
 * null when no registered movement matches (a reading from a run whose scores are not these).
 */
export function observedRecipe(formation: Formation, tick: number, scores: readonly Score[], params: Params): Recipe | null {
  const newestFirst = [...scores].sort((a, b) => (newerVersion(a.version, b.version) ? -1 : newerVersion(b.version, a.version) ? 1 : 0));
  for (const score of newestFirst) {
    let recipe: Recipe;
    try { recipe = currentMovement(score, tick).movement.recipe; } catch { continue; }
    if (samePositions(expandRecipe(recipe, params.n0, params), formation)) return recipe;
  }
  return null;
}

/** An arm's phase from one observer reading; null without one. The name is '—' when no registered movement matches. */
export function armPhase(reading: PhaseReading | null, scores: readonly Score[], params: Params): ArmPhase | null {
  if (!reading) return null;
  const recipe = observedRecipe(reading.slots.formation, reading.tick, scores, params);
  return { inHold: reading.slots.inHold, name: recipe ? movementName(recipe) : '—' };
}

/**
 * The per-arm step main.ts runs at 4 Hz: let each arm's throttled feed read the newest snapshot (it recomputes at most
 * every 250 ms, or at once after a reset), then take that arm's phase from the feed's latest reading.
 */
export function readArmPhases(worlds: { scores(): readonly Score[]; readonly params: Params }, snapshots: Pair<WorldSnapshot>, feeds: Pair<PhaseFeed>): Pair<ArmPhase | null> {
  const at = (arm: 'encore' | 'static'): ArmPhase | null => {
    feeds[arm].read(snapshots[arm]);
    return armPhase(feeds[arm].latest(), worlds.scores(), worlds.params);
  };
  return { encore: at('encore'), static: at('static') };
}
