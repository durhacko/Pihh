// src/app/ui/generatedInject.ts: the one inject entry for an accepted generated scene (GF-WP-11, #214).
// The Composer's generated source (durhack-18, #213) calls it after injectPreflight (src/cli/generated.ts) and
// makeGeneratedRecipe (GF-WP-07). It takes a RECIPE, not a draft, and uses exactly the existing path:
// select the one drone → `inject` intent → the one action controller → one INJECT_SCORE into that drone's inbox.
// Other drones learn the score only by gossip over the existing radio (delay, loss, jams and partitions as the
// simulation models them). Nothing here moves a drone or writes a world.
// No createPanel export: the panel loader skips this module.
import type { EnvEvent, Recipe } from '../../contracts';
import { versionKey } from '../render/colourModes/belief';
import { withRecipe, type InjectPlan } from './commands';
import { runControlPlan, type ComposeContext, type InjectOutcome, type SentRecord } from './Composer';

/** SentRecord.draftId for a generated injection: it has no draft (the Composer marks drafts only for draft injections). */
export const GENERATED_SENT_ID = 'generated';

/**
 * Injects `recipe` into the one drone `droneId` through the controller, as the console's `inject --drone N` does.
 * Returns the same InjectOutcome as the Composer's draft path, with `sent` for the adoption bar (observer data only).
 * `options.lead`: an optional per-injection lead in ticks (default params.scoreLead; up to MAX_LEAD_TICKS).
 */
export async function injectGeneratedRecipe(ctx: ComposeContext, recipe: Recipe, droneId: number, label: string, options: { lead?: number } = {}): Promise<InjectOutcome> {
  if (!Number.isSafeInteger(droneId) || droneId < 0) return { status: 'failed', message: `No drone ${String(droneId)}.`, results: [] };
  const plan: InjectPlan = { kind: 'inject', command: 'inject', steps: [{ type: 'select', id: droneId }], draftId: null };
  const control = withRecipe(plan, recipe);
  // The optional lead (GF-WP-11 step 2) rides on the inject step; the controller validates it.
  const steps = options.lead === undefined ? control.steps : control.steps.map(s => (s.type === 'inject' ? { ...s, lead: options.lead } : s));
  const outcome = await runControlPlan(ctx, { ...control, steps });
  if (outcome.status !== 'done') return outcome;
  const event = outcome.events.find((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');
  if (!event) return outcome;
  const sent: SentRecord = { key: versionKey(event.score.version), name: label, draftId: GENERATED_SENT_ID, droneId: event.droneId, tick: event.tick };
  ctx.store.set({ preview: null });   // the target-arrangement preview is done: the swarm now flies it (as dispatchInject does)
  return { ...outcome, sent };
}
