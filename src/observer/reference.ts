import type { Score, WorldSnapshot } from '../contracts';
import { newerVersion } from '../score';
import { versionKey } from './measure';

/** A registered injection is not a world's reference until a live drone believes it. */
export class ReferenceScores {
  private readonly scores = new Map<string, Score>();

  register(score: Score): void {
    const key = versionKey(score.version);
    const previous = this.scores.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(score)) {
      throw new Error(`Conflicting contents for score version ${key}`);
    }
    this.scores.set(key, structuredClone(score));
  }

  reference(snapshot: WorldSnapshot): Score | null {
    let chosen: Score | null = null;
    for (const drone of snapshot.drones) {
      if (!drone.alive) continue;
      const key = versionKey(drone.belief.version);
      const candidate = this.scores.get(key);
      if (!candidate) throw new Error(`Register score ${key} before observing it`);
      if (!chosen || newerVersion(candidate.version, chosen.version)) chosen = candidate;
    }
    // No live drone means no score satisfies the contract's reference rule.
    return chosen ? structuredClone(chosen) : null;
  }

  newestAt(tick: number): Score | null {
    let chosen: Score | null = null;
    for (const candidate of this.scores.values()) {
      if (candidate.version.issuedTick > tick) continue;
      if (!chosen || newerVersion(candidate.version, chosen.version)) chosen = candidate;
    }
    return chosen ? structuredClone(chosen) : null;
  }
}
