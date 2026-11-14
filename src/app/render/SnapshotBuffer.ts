import type { DroneSnap, RGB, Vec3, WorldSnapshot } from '../../contracts';

export interface SnapshotFrame {
  prev: WorldSnapshot;
  curr: WorldSnapshot;
  alpha: number;
  dtReal: number;
}

export function interpolateVector(a: Vec3 | RGB, b: Vec3 | RGB, alpha: number): Vec3 {
  const t = Math.max(0, Math.min(1, alpha));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Only continuous display values interpolate. Death and beliefs use the current tick. */
export function interpolateDrone(previous: DroneSnap | undefined, current: DroneSnap, alpha: number): DroneSnap {
  const before = previous?.id === current.id ? previous : current;
  return { ...current, pos: interpolateVector(before.pos, current.pos, alpha), colour: interpolateVector(before.colour, current.colour, alpha) };
}

/** Owns snapshot references, never mutates snapshots or computes simulation state. */
export class SnapshotBuffer {
  private prev: WorldSnapshot;
  private curr: WorldSnapshot;

  constructor(initial: WorldSnapshot) { this.prev = initial; this.curr = initial; }

  push(snapshot: WorldSnapshot): void {
    if (snapshot.tick < this.curr.tick) { this.prev = snapshot; this.curr = snapshot; return; }
    if (snapshot.tick === this.curr.tick) { this.curr = snapshot; return; }
    this.prev = this.curr;
    this.curr = snapshot;
  }

  frame(alpha: number, dtReal = 0): SnapshotFrame {
    return { prev: this.prev, curr: this.curr, alpha: Math.max(0, Math.min(1, alpha)), dtReal };
  }
}
