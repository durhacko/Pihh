// Ghost slots (FE-C #91, absorbs #28): where the observer's reference formation wants drones, and which of its slots
// are unfilled. Positions and status come ONLY from Observer.slotStatus, passed in as LayerFrame.slots; the app never
// recomputes a slot's status. The app feeds LayerFrame.slots through createSlotStatusFeed (throttled to 4 Hz);
// without that feed the layer draws nothing.
import { DoubleSide, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial, Object3D, RingGeometry, SphereGeometry, type BufferGeometry, type Camera, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Observer, SlotStatus, WorldSnapshot } from '../../../contracts';
import type { Layer, LayerFrame } from '../Layer';

export type SlotFrame = NonNullable<LayerFrame['slots']>;
type Highlight = Exclude<SlotStatus, 'occupied'>;
const HIGHLIGHTS: readonly Highlight[] = ['vacant', 'inTransit', 'contested'];

/** DESIGN §1: amber = in transit, vermilion = vacant, magenta = contested. Colour carries this meaning only. */
export const GHOST_COLOURS: Readonly<Record<Highlight, number>> = { inTransit: 0xffb547, vacant: 0xff5a1f, contested: 0xff4fd8 };
const SLOT_DOT_COLOUR = 0x5d7482;   // achromatic: "a slot exists here", no status meaning
/** Observer.slotStatus costs about 1.6 ms per call, so the feed calls it at most this often (4 Hz). */
export const SLOT_STATUS_INTERVAL_MS = 250;

export interface SlotStatusFeed {
  /** The newest slot status for this snapshot's world, recomputed at most every intervalMs (or at once after a reset). */
  read(snapshot: WorldSnapshot): SlotFrame;
  /** What read() last returned, with the tick it was computed for; null before the first read, and null after a
   *  reset until the next read (the cached reading belongs to the old observer and the old run). */
  latest(): { tick: number; slots: SlotFrame } | null;
}

/**
 * A throttled reader of Observer.slotStatus for one world. `observer` is a getter because the app rebuilds
 * observers on reset; a new observer, or a tick that goes backwards, invalidates the cache immediately.
 *
 * Cost: the observer caches its formation geometry per snapshot object, and its own sample() fills that cache only on
 * ticks divisible by 5. So a slotStatus call here reuses the observer's work only when it lands on such a tick for the
 * same snapshot; on every other tick it computes the geometry itself (~1.6 ms at n0 = 200). The 4 Hz throttle, not the
 * observer's cache, is what keeps the feed cheap.
 */
export function createSlotStatusFeed(observer: () => Pick<Observer, 'slotStatus'>, options: { intervalMs?: number; now?: () => number } = {}): SlotStatusFeed {
  const intervalMs = options.intervalMs ?? SLOT_STATUS_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  let cached: { source: Pick<Observer, 'slotStatus'>; tick: number; at: number; slots: SlotFrame } | null = null;
  return {
    read(snapshot) {
      const source = observer();
      const time = now();
      const stale = !cached || cached.source !== source || snapshot.tick < cached.tick
        || (snapshot.tick !== cached.tick && time - cached.at >= intervalMs);
      if (stale) cached = { source, tick: snapshot.tick, at: time, slots: source.slotStatus(snapshot) };
      return cached!.slots;
    },
    latest: () => (cached && cached.source === observer() ? { tick: cached.tick, slots: cached.slots } : null),
  };
}

/** Three ring shapes, so status never depends on colour alone (DESIGN §8.3): thin, thick, and double. */
function ringGeometry(status: Highlight): BufferGeometry {
  if (status === 'vacant') return new RingGeometry(0.38, 0.56, 28);
  if (status === 'inTransit') return new RingGeometry(0.42, 0.47, 28);
  const inner = new RingGeometry(0.36, 0.43, 28);
  const outer = new RingGeometry(0.58, 0.65, 28);
  const merged = mergeGeometries([inner, outer])!;
  inner.dispose(); outer.dispose();
  return merged;
}

export interface GhostCounts { slots: number; vacant: number; inTransit: number; contested: number; occupied: number }

export default function createLayer(): Layer {
  const group = new Group();
  const transform = new Object3D();
  const dotGeometry = new SphereGeometry(0.07, 6, 4);
  const dotMaterial = new MeshBasicMaterial({ color: SLOT_DOT_COLOUR, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const ringGeometries = Object.fromEntries(HIGHLIGHTS.map(status => [status, ringGeometry(status)])) as Record<Highlight, BufferGeometry>;
  const ringMaterials = Object.fromEntries(HIGHLIGHTS.map(status => [status, new MeshBasicMaterial({
    color: GHOST_COLOURS[status], transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false, toneMapped: false,
  })])) as Record<Highlight, MeshBasicMaterial>;
  let dots: InstancedMesh;
  let rings: Record<Highlight, InstancedMesh<BufferGeometry, MeshBasicMaterial>>;
  let scene: Scene;
  let camera: Camera;
  let visible = true;
  let legend: HTMLDivElement | undefined;
  let legendSlots: SlotFrame | undefined | null = null;   // null: never built
  let legendShown = '';
  return {
    id: 'ghost-slots',
    init(ctx) {
      scene = ctx.scene; camera = ctx.camera;
      dots = new InstancedMesh(dotGeometry, dotMaterial, ctx.params.n0);
      rings = {
        vacant: new InstancedMesh(ringGeometries.vacant, ringMaterials.vacant, ctx.params.n0),
        inTransit: new InstancedMesh(ringGeometries.inTransit, ringMaterials.inTransit, ctx.params.n0),
        contested: new InstancedMesh(ringGeometries.contested, ringMaterials.contested, ctx.params.n0),
      };
      for (const mesh of [dots, ...Object.values(rings)]) {
        mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; group.add(mesh);
      }
      group.visible = false;
      scene.add(group);
      if (typeof document !== 'undefined') {
        legend = document.createElement('div');
        const index = document.querySelectorAll('[data-ghost-legend]').length;
        legend.dataset.ghostLegend = String(index + 1);
        // Bottom left, just above the camera help line and clear of the masthead caption (layout is FE-A2's to redo).
        legend.style.cssText = `position:fixed;left:40px;bottom:${128 + index * 24}px;padding:2px 8px;border-radius:4px;background:#06121dcc;color:#b8cbd4;font:12px system-ui;pointer-events:none;z-index:4`;
        legend.hidden = true;
        document.body.append(legend);
      }
    },
    update(frame) {
      const slots = frame.slots;
      const counts: GhostCounts = { slots: 0, vacant: 0, inTransit: 0, contested: 0, occupied: 0 };
      if (slots) {
        const capacity = dots.instanceMatrix.count;
        const n = Math.min(slots.formation.slots.length, slots.status.length, capacity);
        for (let i = 0; i < n; i++) {
          const slot = slots.formation.slots[i];
          const status = slots.status[i];
          transform.position.set(...slot.pos);
          transform.quaternion.identity(); transform.scale.setScalar(1); transform.updateMatrix();
          dots.setMatrixAt(counts.slots++, transform.matrix);
          if (status === 'occupied') { counts.occupied++; continue; }
          // Billboarded rings, a little larger for higher-priority slots (index 0 = most important).
          transform.quaternion.copy(camera.quaternion);
          transform.scale.setScalar(1.35 - 0.6 * (i / Math.max(1, n)));
          transform.updateMatrix();
          rings[status].setMatrixAt(counts[status]++, transform.matrix);
        }
      }
      dots.count = counts.slots;
      for (const status of HIGHLIGHTS) rings[status].count = counts[status];
      for (const mesh of [dots, ...Object.values(rings)]) mesh.instanceMatrix.needsUpdate = true;
      group.visible = visible && !!slots;
      group.userData.ghosts = counts;
      if (legend) {
        legend.hidden = !group.visible;
        // The DOM legend changes only when the slot reading (a new object from the feed) or its counts do, so it is
        // not rebuilt on every frame between the feed's 4 Hz readings.
        const legendKey = slots ? `${slots.inHold}:${counts.vacant}:${counts.inTransit}:${counts.contested}` : '';
        if (slots === legendSlots && legendKey === legendShown) return;
        legendSlots = slots; legendShown = legendKey;
        if (!slots) legend.replaceChildren();
        else {
          // Shape named in words and drawn in its colour, so the key never relies on colour or a font glyph alone.
          const key = (status: Highlight, text: string) => {
            const span = document.createElement('span');
            span.style.color = `#${GHOST_COLOURS[status].toString(16).padStart(6, '0')}`;
            span.textContent = text;
            return span;
          };
          legend.replaceChildren(
            `View ${legend.dataset.ghostLegend} · ghost slots, observer truth${slots.inHold ? '' : ' (in transition)'} · `,
            key('vacant', `thick ring vacant ${counts.vacant}`), ' · ',
            key('inTransit', `thin ring in transit ${counts.inTransit}`), ' · ',
            key('contested', `double ring contested ${counts.contested}`),
          );
        }
      }
    },
    setVisible(value) { visible = value; group.visible = value && dots.count > 0; if (legend) legend.hidden = !group.visible; },
    dispose() {
      scene?.remove(group);
      dots?.dispose(); for (const mesh of Object.values(rings ?? {})) mesh.dispose();
      dotGeometry.dispose(); dotMaterial.dispose();
      for (const status of HIGHLIGHTS) { ringGeometries[status].dispose(); ringMaterials[status].dispose(); }
      legend?.remove();
    },
  };
}
