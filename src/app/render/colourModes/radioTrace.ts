import { DT, type RadioEvent, type RGB, type Vec3, type WorldSnapshot } from '../../../contracts';

export interface RadioSegment { from: Vec3; to: Vec3; colour: RGB; opacity: number; sender: number; receiver: number }
export interface DropStub { from: Vec3; to: Vec3; colour: RGB; opacity: number; reason: 'lost' | 'jammed' | 'partitioned'; count: number }
interface Broadcast { tick: number; event: RadioEvent; positions: Map<number, Vec3>; ordinal: number; drawn: Set<number> }
const plain: RGB = [0.22, 0.34, 0.43];
const claim: RGB = [0.12, 0.95, 1];
const score: RGB = [1, 0.12, 0.72];
const reasons = [
  { name: 'lost' as const, colour: [0.45, 0.5, 0.55] as RGB, offset: [0.8, 0.3, 0] as Vec3 },
  { name: 'jammed' as const, colour: [0.84, 0.37, 0] as RGB, offset: [-0.5, 0.7, 0] as Vec3 },
  { name: 'partitioned' as const, colour: [0.94, 0.89, 0.26] as RGB, offset: [0, 0.7, 0.5] as Vec3 },
];
export const RADIO_FADE_SECONDS = 0.3;
export const HIGHLIGHT_RECEIVER_CAP = 24;

/** Retains only events actually received from snapshots. Repeated render frames never replay sends. */
export class RadioTrace {
  private history: Broadcast[] = [];
  private lastTick = -1;
  private ordinal = 0;

  /**
   * Per-tick evidence (#46): call once for every simulation tick, in order. Each tick's broadcasts are kept
   * exactly once, so a frame that advances several ticks loses nothing and repeated calls add nothing.
   */
  ingest(snapshot: WorldSnapshot): void {
    if (snapshot.tick < this.lastTick) this.reset();
    this.record(snapshot);
  }

  /** Drop all retained evidence (the world was rebuilt). */
  reset(): void { this.history = []; this.lastTick = -1; this.ordinal = 0; }

  /** Render-frame fallback for views without per-tick ingestion: sees only the frame's prev/curr snapshots. */
  update(prev: WorldSnapshot, curr: WorldSnapshot): void {
    if (curr.tick < this.lastTick) this.reset();
    this.record(prev);
    this.record(curr);
  }

  private record(snapshot: WorldSnapshot): void {
    if (snapshot.tick <= this.lastTick) return;
    if (snapshot.radio.length > 0) {
      const positions = new Map(snapshot.drones.map(drone => [drone.id, [...drone.pos] as Vec3]));
      for (const event of snapshot.radio) this.history.push({ tick: snapshot.tick, event: structuredClone(event), positions, ordinal: this.ordinal++, drawn: new Set() });
    }
    this.lastTick = snapshot.tick;
    this.history = this.history.filter(broadcast => (snapshot.tick - broadcast.tick) * DT < 1);
  }

  plan(tick: number, alpha: number, selectedDroneId: number | null = null, enabled = true, plainLines = true) {
    const segments: RadioSegment[] = [];
    const stubs: DropStub[] = [];
    let logged = 0;
    let drawn = 0;
    // With a drone selected only its links are drawn, so `drawn` counts only them: `involving` is the matching
    // denominator (observed deliveries sent by or to the selected drone), so a label can compare like with like
    // (#134 P1-4). Absent without a selection.
    let involving = 0;
    const ordered = [...this.history].sort((a, b) => Number(this.highlighted(b.event)) - Number(this.highlighted(a.event)) || a.tick - b.tick || a.ordinal - b.ordinal);
    for (const broadcast of ordered) {
      const { event, positions } = broadcast;
      logged += event.delivered.length;
      if (selectedDroneId !== null) involving += event.from === selectedDroneId ? event.delivered.length : event.delivered.filter(id => id === selectedDroneId).length;
      const start = positions.get(event.from);
      if (!start) continue;
      const highlight = this.highlighted(event);
      const age = Math.max(0, (tick - broadcast.tick + Math.max(0, Math.min(alpha, 1))) * DT);
      const opacity = Math.max(0, 1 - age / RADIO_FADE_SECONDS);
      const candidates = event.delivered.filter(id => positions.has(id) && (selectedDroneId === null || event.from === selectedDroneId || id === selectedDroneId));
      // plainLines false (quality level >= 1): plain heartbeats draw nothing; claims and SCOREs are unaffected.
      const recipients = highlight ? candidates.slice(0, HIGHLIGHT_RECEIVER_CAP) : plainLines && broadcast.ordinal % 4 === 0 ? candidates.slice(0, 3) : [];
      if (opacity > 0 && enabled) {
        const colour = event.type === 'SCORE' ? score : event.claimSlot !== null ? claim : plain;
        for (const receiver of recipients) {
          broadcast.drawn.add(receiver);
          segments.push({ from: [...start], to: [...positions.get(receiver)!], colour: [...colour], opacity, sender: event.from, receiver });
        }
        if (selectedDroneId === null || selectedDroneId === event.from) {
          for (const reason of reasons) if (event[reason.name] > 0) stubs.push({
            from: [...start], to: [start[0] + reason.offset[0], start[1] + reason.offset[1], start[2] + reason.offset[2]],
            colour: [...reason.colour], opacity, reason: reason.name, count: event[reason.name],
          });
        }
      }
      drawn += [...broadcast.drawn].filter(id => selectedDroneId === null || event.from === selectedDroneId || id === selectedDroneId).length;
    }
    return selectedDroneId === null
      ? { segments, stubs, drawn, logged }
      : { segments, stubs, drawn, logged, involving, filteredTo: selectedDroneId };
  }

  private highlighted(event: RadioEvent): boolean { return event.type === 'SCORE' || event.claimSlot !== null; }
}
