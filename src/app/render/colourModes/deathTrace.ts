import { DT, type DroneSnap, type Vec3, type WorldSnapshot } from '../../../contracts';

interface Death { id: number; pos: Vec3; tick: number | null }
export class DeathTrace {
  private deaths = new Map<number, Death>();
  private previous = new Map<number, DroneSnap>();
  private lastTick = -1;

  update(prev: WorldSnapshot, curr: WorldSnapshot): void {
    if (curr.tick < this.lastTick) { this.deaths.clear(); this.previous.clear(); this.lastTick = -1; }
    if (curr.tick === this.lastTick) return;
    for (const drone of curr.drones) {
      const before = this.previous.get(drone.id) ?? prev.drones.find(candidate => candidate.id === drone.id);
      if (drone.alive) this.deaths.delete(drone.id);
      else if (!this.deaths.has(drone.id)) this.deaths.set(drone.id, { id: drone.id, pos: [...drone.pos], tick: before?.alive ? curr.tick : null });
    }
    this.previous = new Map(curr.drones.map(drone => [drone.id, drone]));
    this.lastTick = curr.tick;
  }

  markers(tick: number, alpha: number, xray: boolean) {
    return [...this.deaths.values()].flatMap(death => {
      const age = death.tick === null ? Infinity : Math.max(0, (tick - death.tick + Math.max(0, Math.min(alpha, 1))) * DT);
      const flash = age < 0.4 ? 1 - age / 0.4 : 0;
      return flash > 0 || xray ? [{ ...death, pos: [...death.pos] as Vec3, flash, cross: xray }] : [];
    });
  }
}
