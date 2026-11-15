// Repair-cascade trail layer (#202, P2-WP-03). Opt-in only: it draws when the page was opened with ?p2=cascade AND
// X-ray is on. Without the flag it is an empty hidden Group whose ingest and update return at once (no per-tick work,
// no trail, no buffers), so the default demo is unchanged. Opted in, it ingests every tick, also while hidden (the
// trail is pure and O(n0) per tick); it never touches a world or brain.
// Each arrow is one observed belief.slot change (colourModes/cascadeTrail.ts), drawn from the drone's previous target
// to its new one only once the drone has arrived within rOcc, and only while it stays there (so never together with
// its tether), fading over 6 s.
//
// Visibility (E3): the arrows are solid 3D arrows (an instanced cylinder shaft and cone head), sized in metres so they
// read at the audience camera (about 95 m away: roughly 4-8 px for the shaft, against the 1 px heartbeat lines),
// not 1 px lines. Colours reuse no existing X-ray meaning (experience §3) and stay clear of the cyan claim heartbeats:
// commit (to a more important slot) a yellow-green, pop (to a less important one) violet. Opted in, the trail stays
// on at every render quality level: it costs two instanced draws of at most `capacity` arrows, and silently dropping
// it on an automatic step-down would leave the demo caption promising arrows that are not drawn (#232).
import {
  AdditiveBlending, Color, ConeGeometry, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial,
  Object3D, Quaternion, Vector3, type Scene,
} from 'three';
import type { Layer } from '../Layer';
import { CASCADE_CAPACITY, CascadeTrail, type CascadeEntry } from '../colourModes/cascadeTrail';
import { readViewMode } from '../colourModes/viewMode';

/** Commit: yellow-green, well away from the cyan claim heartbeats (0.12, 0.95, 1) and the reserved yellow and amber. */
export const CASCADE_COMMIT_COLOUR = 0x7dff3a;
export const CASCADE_POP_COLOUR = 0xa98bff;
/** Arrow size in metres (at the audience camera, 1 m is about 5 px in split view and 10 px full screen). */
export const ARROW_SHAFT_RADIUS = 0.35;
export const ARROW_HEAD_RADIUS = 0.85;
export const ARROW_HEAD_LENGTH = 1.8;
/** The head never takes more than this share of a short arrow. */
const HEAD_SHARE = 0.4;

/** The Phase 2 opt-in flag (§2.1 of the work packages): `?p2=<name>[,<name>…]` contains `cascade`. */
export function cascadeOptIn(search: string): boolean {
  const value = new URLSearchParams(search).get('p2');
  return value !== null && value.split(',').map(part => part.trim()).includes('cascade');
}

export interface CascadeLayerOptions {
  /** Test seam. Default: read once in init from location.search (off when there is no location). */
  optIn?: boolean;
  capacity?: number;
}

/** Everything the layer draws with. Built in init only when opted in: without the flag none of it exists. */
interface Drawing {
  trail: CascadeTrail;
  shafts: InstancedMesh; heads: InstancedMesh;
  dispose(): void;
  /** Writes the arrows of `tick` + `alpha` into the preallocated instances; returns how many. No allocation. */
  write(tick: number, alpha: number): number;
}

function buildDrawing(group: Group, n0: number, rOcc: number, capacity: number): Drawing {
  const trail = new CascadeTrail(n0, rOcc, capacity);
  const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  // Unit shapes along +y from 0 to 1, so an instance's scale.y is its length and its origin is its base.
  const shaftGeometry = new CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0);
  const headGeometry = new ConeGeometry(1, 1, 14).translate(0, 0.5, 0);
  const shafts = new InstancedMesh(shaftGeometry, material, capacity);
  const heads = new InstancedMesh(headGeometry, material, capacity);
  for (const mesh of [shafts, heads]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.setColorAt(0, new Color(0, 0, 0));               // allocates instanceColor once, at full capacity
    mesh.instanceColor!.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }
  group.add(shafts, heads);
  // Scratch objects, created once: no per-frame allocation.
  const place = new Object3D(), up = new Vector3(0, 1, 0), dir = new Vector3(), turn = new Quaternion(), colour = new Color();
  let count = 0;
  const writeOne = (entry: CascadeEntry, brightness: number) => {
    if (count >= capacity) return;
    const [fx, fy, fz] = entry.from, [tx, ty, tz] = entry.to;
    dir.set(tx - fx, ty - fy, tz - fz);
    const length = dir.length();
    if (length < 1e-6) return;
    dir.divideScalar(length);
    turn.setFromUnitVectors(up, dir);
    const head = Math.min(ARROW_HEAD_LENGTH, HEAD_SHARE * length);
    const headRadius = Math.min(ARROW_HEAD_RADIUS, head * 0.5);
    const shaftRadius = Math.min(ARROW_SHAFT_RADIUS, headRadius * 0.45);
    place.quaternion.copy(turn);
    place.position.set(fx, fy, fz); place.scale.set(shaftRadius, length - head, shaftRadius); place.updateMatrix();
    shafts.setMatrixAt(count, place.matrix);
    place.position.set(tx - dir.x * head, ty - dir.y * head, tz - dir.z * head); place.scale.set(headRadius, head, headRadius); place.updateMatrix();
    heads.setMatrixAt(count, place.matrix);
    colour.setHex(entry.kind === 'commit' ? CASCADE_COMMIT_COLOUR : CASCADE_POP_COLOUR).multiplyScalar(brightness);
    shafts.setColorAt(count, colour); heads.setColorAt(count, colour);
    count++;
  };
  return {
    trail, shafts, heads,
    dispose() { shaftGeometry.dispose(); headGeometry.dispose(); material.dispose(); },
    write(tick, alpha) {
      count = 0;
      trail.forEachArrow(tick, alpha, writeOne);
      for (const mesh of [shafts, heads]) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
      return count;
    },
  };
}

export function createCascadeLayer(options: CascadeLayerOptions = {}): Layer {
  const capacity = options.capacity ?? CASCADE_CAPACITY;
  const group = new Group();
  group.visible = false;
  /** null unless opted in: then ingest and update return at once, and nothing else is ever allocated. */
  let drawing: Drawing | null = null;
  let scene: Scene | undefined;
  let optIn = false;
  let visible = true;
  let quality = 0;
  const publish = (drawn: number) => {
    const counts = drawing ? drawing.trail.counts() : { changes: 0, commits: 0, pops: 0, pending: 0 };
    group.userData.cascade = { drawn, changes: counts.changes, commits: counts.commits, pops: counts.pops, pending: counts.pending, optIn, ...(drawing ? { quality } : {}) };
  };
  publish(0);

  return {
    id: 'cascade',
    init(ctx) {
      scene = ctx.scene;
      optIn = options.optIn ?? (typeof location !== 'undefined' && cascadeOptIn(location.search));
      if (optIn) drawing = buildDrawing(group, ctx.params.n0, ctx.params.rOcc, capacity);
      scene.add(group);   // without the flag: an empty, hidden Group, never updated
      publish(0);
    },
    ingest(snapshot) {
      if (!drawing) return;
      drawing.trail.ingest(snapshot);
    },
    update(frame) {
      if (!drawing) return;
      const { trail, shafts, heads } = drawing;
      // Fallback for a view without per-tick ingestion: a repeated tick is a no-op inside the trail.
      if (frame.curr.tick > trail.lastTick) trail.ingest(frame.curr);
      const show = visible && readViewMode().xray;
      const count = show ? drawing.write(frame.curr.tick, frame.alpha) : 0;
      if (!show) { shafts.count = 0; heads.count = 0; }
      group.visible = show && count > 0;
      publish(count);
    },
    reset() {
      if (!drawing) return;
      drawing.trail.reset(); drawing.shafts.count = 0; drawing.heads.count = 0;
      group.visible = false; publish(0);
    },
    // The trail stays on at every level (see the header); the level is only recorded.
    setQuality(level) { quality = level; if (drawing) publish(group.userData.cascade.drawn); },
    setVisible(value) { visible = value; if (!value) group.visible = false; },
    dispose() {
      scene?.remove(group);
      drawing?.dispose();
    },
  };
}

export default function createLayer(): Layer { return createCascadeLayer(); }
