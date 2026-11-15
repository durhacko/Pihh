// The inspector's observer box (FE-C #91, UI-07): ground truth the selected drone cannot see, pre-labelled
// `source: 'observer'`. Built here, from the snapshot and the throttled Observer.slotStatus, so that Inspector.ts
// never receives a WorldSnapshot. No createPanel export: the panel loader (ui/index.ts) skips this module.
import type { SlotStatus, Vec3, WorldSnapshot } from '../../contracts';
import type { ObserverTruth } from './Inspector';

/** What a slot feed last computed (createSlotStatusFeed().latest() in render/layers/GhostSlotLayer.ts). */
export interface SlotStatusReading {
  tick: number;
  slots: { status: readonly SlotStatus[]; formation: { slots: readonly { pos: Vec3 }[] } };
}

function distance2(a: readonly number[], b: readonly number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Observer truth about drone `id`, or null when the snapshot has no such drone. Never derived from the brain. */
export function observerTruth(snapshot: WorldSnapshot, slots: SlotStatusReading | null, params: { rRadio: number; rOcc: number }, id: number): ObserverTruth | null {
  const drone = snapshot.drones[id];
  if (!drone || drone.id !== id) return null;
  let live = 0;
  let dead = 0;
  // P2-WP-09: every other drone by id, for the peer diff (alive in radio range, alive out of range, dead).
  const peers = { liveInRange: [] as number[], liveOutOfRange: [] as number[], dead: [] as number[] };
  for (const other of snapshot.drones) {
    if (other.id === id) continue;
    const inRange = distance2(other.pos, drone.pos) <= params.rRadio ** 2;
    if (!other.alive) peers.dead.push(other.id);
    else (inRange ? peers.liveInRange : peers.liveOutOfRange).push(other.id);
    if (!inRange) continue;
    if (other.alive) live++; else dead++;
  }
  const slot = drone.belief.slot;
  // belief.slot indexes the drone's OWN score; Observer.slotStatus indexes the observer's reference formation (the
  // newest version any live drone believes). They describe the same place only when that reference slot is where the
  // drone is flying. Otherwise (it flies an older or different score) the status is not about its slot at all.
  const reference = slots?.slots.formation.slots[slot];
  const sameFormation = slots ? !!reference && distance2(reference.pos, drone.belief.target) <= params.rOcc ** 2 : null;
  return {
    source: 'observer',
    id, tick: snapshot.tick,
    alive: drone.alive, diedTick: drone.diedTick,
    believedSlot: slot,
    sameFormation,
    believedSlotStatus: sameFormation ? slots!.slots.status[slot] ?? null : null,
    slotStatusTick: slots?.tick ?? null,
    jammedBy: snapshot.jams.filter(jam => distance2(jam.centre, drone.pos) <= jam.radius ** 2).map(jam => jam.id),
    partitionSide: drone.partitionSide,
    inRadioRange: { live, dead },
    peers,
  };
}
