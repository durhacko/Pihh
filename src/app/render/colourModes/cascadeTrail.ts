// Repair-cascade trail (#202, P2-WP-03): the OBSERVED belief.slot changes of live drones, as arrows from the target a
// drone had on the tick before its change to the target it changed to. Pure: no three, no DOM, no clock. It reads
// snapshots only and is never read by a world or a brain, so it cannot change what the swarm does. It invents
// nothing: every entry is one slot change the snapshots show, counted by TickEvidence's rule (src/observer/evidence.ts),
// so `changes` equals the observer's slotChanges over the same ticks.
import type { Vec3, WorldSnapshot } from '../../../contracts';

/** An arrow fades linearly to nothing over this many ticks (6 s at 20 ticks/s) from the tick it first shows. */
export const CASCADE_FADE_TICKS = 120;
export const CASCADE_CAPACITY = 256;

/** commit: moved to a more important slot (a lower index, contract §8); pop: to a less important one. */
export type CascadeKind = 'commit' | 'pop';

export interface CascadeEntry {
  readonly tick: number;           // the tick whose snapshot first showed the new belief.slot
  readonly id: number;
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly from: Vec3;             // belief.target on the previous ingested tick
  readonly to: Vec3;               // belief.target on the change tick
  readonly kind: CascadeKind;
  /** The first ingested tick on which the drone was within rOcc of `to` (alive); null until then. */
  shownAt: number | null;
  /** The drone died, or changed slot again, before it arrived: counted, never drawn. */
  superseded: boolean;
}

export interface CascadeArrow { from: Vec3; to: Vec3; kind: CascadeKind; brightness: number; id: number; tick: number }

export interface CascadeCounts { changes: number; commits: number; pops: number; pending: number; superseded: number }

export class CascadeTrail {
  /** The last tick ingested (0: none since construction or reset). */
  lastTick = 0;
  changes = 0;
  commits = 0;
  pops = 0;
  superseded = 0;
  private readonly prevSlot: Int32Array;
  private readonly prevTarget: Float32Array;
  private readonly seen: Uint8Array;         // 1 once this drone has been seen alive: prevTarget holds a real target
  /** Per drone, from the last ingested snapshot: alive and within rOcc of its own belief.target (no tether drawn). */
  private readonly settled: Uint8Array;
  private readonly ring: (CascadeEntry | null)[];
  private next = 0;                          // ring write index
  private readonly rOcc2: number;

  constructor(readonly n0: number, rOcc: number, readonly capacity = CASCADE_CAPACITY) {
    if (!Number.isInteger(n0) || n0 < 0) throw new Error(`n0 must be a non-negative integer, got ${n0}`);
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`capacity must be a positive integer, got ${capacity}`);
    this.rOcc2 = rOcc * rOcc;
    this.prevSlot = new Int32Array(n0);
    this.prevTarget = new Float32Array(3 * n0);
    this.seen = new Uint8Array(n0);
    this.settled = new Uint8Array(n0);
    this.ring = new Array<CascadeEntry | null>(capacity).fill(null);
    this.reset();
  }

  /** Forget everything (the world was rebuilt). */
  reset(): void {
    this.lastTick = 0;
    this.changes = 0; this.commits = 0; this.pops = 0; this.superseded = 0;
    for (let i = 0; i < this.n0; i++) this.prevSlot[i] = i;   // the observer's baseline: launch slot = id
    this.prevTarget.fill(0);
    this.seen.fill(0);
    this.settled.fill(0);
    this.ring.fill(null);
    this.next = 0;
  }

  /**
   * One simulation tick's snapshot, in order (the Layer.ingest contract, #46). TickEvidence's tick rules: a repeated
   * or older-but-not-reset tick adds nothing, a backwards tick (the world was rebuilt) resets first. A skipped tick
   * is accepted (the app never skips one; the observer would refuse it), so `from` is then the last tick seen.
   */
  ingest(snapshot: WorldSnapshot): void {
    if (snapshot.tick < this.lastTick) this.reset();
    if (snapshot.tick <= this.lastTick) return;
    const tick = snapshot.tick;
    this.lastTick = tick;
    for (const drone of snapshot.drones) {
      const i = drone.id;
      if (!Number.isInteger(i) || i < 0 || i >= this.n0) continue;
      if (!drone.alive) { this.settled[i] = 0; continue; }     // dead drones are skipped, as evidence.ts skips them
      const slot = drone.belief.slot;
      const target = drone.belief.target;
      const o = 3 * i;
      if (slot !== this.prevSlot[i]) {
        const from: Vec3 = this.seen[i] ? [this.prevTarget[o], this.prevTarget[o + 1], this.prevTarget[o + 2]] : [target[0], target[1], target[2]];
        this.supersedePending(i);
        const kind: CascadeKind = slot < this.prevSlot[i] ? 'commit' : 'pop';
        this.push({ tick, id: i, fromSlot: this.prevSlot[i], toSlot: slot, from, to: [target[0], target[1], target[2]], kind, shownAt: null, superseded: false });
        this.changes++;
        if (kind === 'commit') this.commits++; else this.pops++;
      }
      // Every tick, every live drone: `from` is always the previous tick's target, also across a movement change
      // with no slot change (belief.target moves with the movement).
      this.prevSlot[i] = slot;
      this.prevTarget[o] = target[0]; this.prevTarget[o + 1] = target[1]; this.prevTarget[o + 2] = target[2];
      this.seen[i] = 1;
      const dx = drone.pos[0] - target[0], dy = drone.pos[1] - target[1], dz = drone.pos[2] - target[2];
      this.settled[i] = dx * dx + dy * dy + dz * dz <= this.rOcc2 ? 1 : 0;   // TetherLayer's rule, inverted
    }
    // Onset after arrival; a drone that died with an arrow still pending never shows it.
    for (const entry of this.ring) {
      if (!entry || entry.superseded || entry.shownAt !== null) continue;
      const drone = snapshot.drones[entry.id]?.id === entry.id ? snapshot.drones[entry.id] : snapshot.drones.find(d => d.id === entry.id);
      if (!drone || !drone.alive) { entry.superseded = true; this.superseded++; continue; }
      const dx = drone.pos[0] - entry.to[0], dy = drone.pos[1] - entry.to[1], dz = drone.pos[2] - entry.to[2];
      if (dx * dx + dy * dy + dz * dz <= this.rOcc2) entry.shownAt = tick;
    }
  }

  /**
   * The arrows to draw at `tick` (+ alpha in [0, 1) of the way to the next): shown entries younger than the fade whose
   * drone is, on the last ingested tick, alive and within rOcc of its own current target, so never while its tether
   * is drawn. Oldest first. Never more than one per observed change.
   */
  arrows(tick: number, alpha = 0): CascadeArrow[] {
    const out: CascadeArrow[] = [];
    this.forEachArrow(tick, alpha, (entry, brightness) => out.push({ from: entry.from, to: entry.to, kind: entry.kind, brightness, id: entry.id, tick: entry.tick }));
    return out;
  }

  /** arrows() without allocating: the render path calls this every frame. Returns how many were visited. */
  forEachArrow(tick: number, alpha: number, visit: (entry: CascadeEntry, brightness: number) => void): number {
    const a = Math.max(0, Math.min(1, alpha));
    let n = 0;
    for (let k = 0; k < this.capacity; k++) {
      const entry = this.ring[(this.next + k) % this.capacity];
      if (!entry || entry.superseded || entry.shownAt === null || entry.shownAt > tick) continue;
      if (!this.settled[entry.id]) continue;
      const brightness = 1 - (tick - entry.shownAt + a) / CASCADE_FADE_TICKS;
      if (brightness <= 0) continue;
      visit(entry, brightness);
      n++;
    }
    return n;
  }

  /** Cumulative counts since the last reset; `pending` = retained entries not yet arrived and not superseded. */
  counts(): CascadeCounts {
    let pending = 0;
    for (const entry of this.ring) if (entry && !entry.superseded && entry.shownAt === null) pending++;
    return { changes: this.changes, commits: this.commits, pops: this.pops, pending, superseded: this.superseded };
  }

  /** The retained entries, oldest first (tests and diagnostics). */
  entries(): readonly CascadeEntry[] {
    const out: CascadeEntry[] = [];
    for (let k = 0; k < this.capacity; k++) { const e = this.ring[(this.next + k) % this.capacity]; if (e) out.push(e); }
    return out;
  }

  /** Whether drone `id` was, on the last ingested tick, alive and within rOcc of its own target. */
  isSettled(id: number): boolean { return this.settled[id] === 1; }

  private push(entry: CascadeEntry): void {
    this.ring[this.next] = entry;   // a full ring overwrites its oldest entry; the cumulative counts keep it
    this.next = (this.next + 1) % this.capacity;
  }

  private supersedePending(id: number): void {
    for (const entry of this.ring) if (entry && entry.id === id && !entry.superseded && entry.shownAt === null) { entry.superseded = true; this.superseded++; }
  }
}
