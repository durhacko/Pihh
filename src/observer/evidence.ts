import type { MetricsSample, WorldSnapshot } from '../contracts';
import { versionKey } from './measure';

/** Copies only observations. No World or brain reference can enter this accumulator. */
export class TickEvidence {
  tick = 0;
  readonly timeline: { tick: number; alive: number; versions: Record<string, number> }[] = [];
  readonly slotChanges: { tick: number; id: number }[] = [];
  readonly adoptions: { tick: number; id: number; version: string }[] = [];
  finalLive: { id: number; version: string }[] = [];
  readonly totals: { msgs: MetricsSample['msgs']; collisions: number; nearMisses: number } = {
    msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0,
  };
  private previousSlots = new Map<number, number>();
  private versionsSeen = new Set<string>();

  ingest(snapshot: WorldSnapshot): boolean {
    if (snapshot.tick < this.tick) throw new Error('Create a new observer when resetting the simulation');
    if (snapshot.tick === this.tick) return false;
    if (snapshot.tick !== this.tick + 1) throw new Error('Observer must receive every simulation tick');
    this.tick = snapshot.tick;
    const versions: Record<string, number> = {};
    this.finalLive = [];
    for (const drone of snapshot.drones) {
      if (!drone.alive) continue;
      const previous = this.previousSlots.get(drone.id) ?? drone.id;
      if (drone.belief.slot !== previous) this.slotChanges.push({ tick: snapshot.tick, id: drone.id });
      this.previousSlots.set(drone.id, drone.belief.slot);
      const version = versionKey(drone.belief.version);
      versions[version] = (versions[version] ?? 0) + 1;
      this.finalLive.push({ id: drone.id, version });
      const key = `${drone.id}/${version}`;
      if (!this.versionsSeen.has(key)) {
        this.versionsSeen.add(key);
        this.adoptions.push({ tick: snapshot.tick, id: drone.id, version });
      }
    }
    for (const event of snapshot.radio) {
      if (event.type === 'HB') this.totals.msgs.hb++;
      else this.totals.msgs.score++;
      this.totals.msgs.delivered += event.delivered.length;
      this.totals.msgs.lost += event.lost;
      this.totals.msgs.blocked += event.jammed + event.partitioned;
    }
    this.totals.collisions += snapshot.collisions.length;
    this.totals.nearMisses += snapshot.nearMisses.length;
    this.timeline.push({ tick: snapshot.tick, alive: this.finalLive.length, versions });
    return true;
  }
}
