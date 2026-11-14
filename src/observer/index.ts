import type { EnvEvent, MetricsSample, Observer, Params, Score, WorldSnapshot } from '../contracts';
import { currentMovement, expandRecipe } from '../score';
import { TickEvidence } from './evidence';
import { measureFormation, versionKey } from './measure';
import { ReferenceScores } from './reference';
import { calculateSummary, type SummarySample } from './summary';

/** Read-only evidence sink. It has no World reference and cannot command a drone. */
export function createObserver(sourceParams: Params): Observer {
  const params = structuredClone(sourceParams);
  const registry = new ReferenceScores();
  const evidence = new TickEvidence();
  const events: EnvEvent[] = [];
  const samples: SummarySample[] = [];
  let retainedScore: Score | null = null;
  let cache: { snapshot: WorldSnapshot; scoreKey: string; value: ReturnType<typeof geometry> } | null = null;

  function geometry(snapshot: WorldSnapshot) {
    const believed = registry.reference(snapshot);
    if (believed) retainedScore = believed;
    if (!retainedScore) throw new Error('Register the preloaded score before observing snapshots');
    // When every drone is dead, retain the last known shape solely for vacant-slot display.
    // Its undefined normalisation/fidelity is explicitly null, never claimed as a reference win.
    const movement = currentMovement(retainedScore, snapshot.tick);
    const formation = expandRecipe(movement.movement.recipe, params.n0, params);
    return { formation, inHold: movement.inHold, measured: measureFormation(snapshot, formation, params) };
  }
  function observedGeometry(snapshot: WorldSnapshot) {
    const believed = registry.reference(snapshot);
    if (believed) retainedScore = believed;
    const scoreKey = retainedScore ? versionKey(retainedScore.version) : '';
    if (!cache || cache.snapshot !== snapshot || cache.scoreKey !== scoreKey) {
      cache = { snapshot, scoreKey, value: geometry(snapshot) };
    }
    return cache.value;
  }

  return {
    registerScore(score) {
      registry.register(score);
      retainedScore ??= structuredClone(score);
      cache = null;
    },
    recordEvent(event) {
      if (!Number.isInteger(event.tick) || event.tick < 1) throw new Error('Invalid event tick');
      events.push(structuredClone(event));
    },
    sample(snapshot) {
      if (!evidence.ingest(snapshot)) return null;
      const believed = registry.reference(snapshot);
      if (believed) retainedScore = believed;
      if (snapshot.tick % 5 !== 0) return null;
      const { measured, inHold } = observedGeometry(snapshot);
      const metrics: MetricsSample = {
        tick: snapshot.tick, alive: measured.alive,
        coverage: measured.coverage, pwc: measured.pwc, npwc: measured.npwc,
        sfMean: measured.sfMean, sfMax: measured.sfMax,
        dupSlots: measured.dupSlots, versions: structuredClone(measured.versions),
        msgs: { ...evidence.totals.msgs }, collisions: evidence.totals.collisions,
        nearMisses: evidence.totals.nearMisses, slotChanges: evidence.slotChanges.length,
      };
      samples.push({ metrics: structuredClone(metrics), inHold, capacityLoss: measured.capacityLoss, coordLoss: measured.coordLoss });
      return metrics;
    },
    slotStatus(snapshot) {
      const { formation, inHold, measured } = observedGeometry(snapshot);
      return { formation: structuredClone(formation), inHold, status: [...measured.status] };
    },
    summary() {
      const newest = registry.newestAt(evidence.tick);
      return calculateSummary({
        tick: evidence.tick, events, samples,
        timeline: evidence.timeline, slotChanges: evidence.slotChanges,
        adoptions: evidence.adoptions, finalLive: evidence.finalLive,
        newestRegisteredVersion: newest ? versionKey(newest.version) : null,
        totals: evidence.totals,
      });
    },
  };
}
