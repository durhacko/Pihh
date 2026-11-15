// Repair-cascade trail layer (#202, P2-WP-03). Opt-in only: it draws when the page was opened with ?p2=cascade AND
// X-ray is on AND the render quality level is 0. Without the flag it is an empty hidden Group whose ingest and update
// return at once (no per-tick work, no trail, no buffers), so the default demo is unchanged. Opted in, it ingests every
// tick, also while hidden (the trail is pure and O(n0) per tick); it never touches a world or brain.
// Each arrow is one observed belief.slot change (colourModes/cascadeTrail.ts), drawn from the drone's previous target
// to its new one only once the drone has arrived within rOcc, and only while it stays there (so never together with
// its tether), fading over 6 s. Colours reuse no existing X-ray meaning (experience §3): commit (to a more important
// slot) spring green, pop (to a less important one) violet.
import { AdditiveBlending, BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, type Scene } from 'three';
import type { RGB, Vec3 } from '../../../contracts';
import type { Layer } from '../Layer';
import { CASCADE_CAPACITY, CascadeTrail, type CascadeEntry, type CascadeKind } from '../colourModes/cascadeTrail';
import { readViewMode } from '../colourModes/viewMode';

export const CASCADE_COMMIT_COLOUR = 0x4cff8f;
export const CASCADE_POP_COLOUR = 0xa98bff;
const RGB_OF: Record<CascadeKind, RGB> = {
  commit: [0x4c / 255, 0xff / 255, 0x8f / 255],
  pop: [0xa9 / 255, 0x8b / 255, 0xff / 255],
};
const HEAD_LENGTH = 1.2;     // m, at most 30% of the shaft
const HEAD_SPREAD = 0.5;     // half-width of the head as a fraction of its length

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
  material: LineBasicMaterial;
  shaftGeometry: BufferGeometry; headGeometry: BufferGeometry;
  attributes: Float32BufferAttribute[];
  /** Writes the arrows of `tick` + `alpha` into the preallocated buffers; returns how many. No allocation. */
  write(tick: number, alpha: number): number;
}

function buildDrawing(group: Group, n0: number, rOcc: number, capacity: number): Drawing {
  const trail = new CascadeTrail(n0, rOcc, capacity);
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const shaftGeometry = new BufferGeometry();
  const headGeometry = new BufferGeometry();
  const shafts = new LineSegments(shaftGeometry, material);
  const heads = new LineSegments(headGeometry, material);
  shafts.frustumCulled = false; heads.frustumCulled = false;
  group.add(shafts, heads);
  const shaftPos = new Float32BufferAttribute(new Float32Array(capacity * 2 * 3), 3);
  const shaftCol = new Float32BufferAttribute(new Float32Array(capacity * 2 * 3), 3);
  const headPos = new Float32BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
  const headCol = new Float32BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
  const attributes = [shaftPos, shaftCol, headPos, headCol];
  for (const attribute of attributes) attribute.setUsage(DynamicDrawUsage);
  shaftGeometry.setAttribute('position', shaftPos); shaftGeometry.setAttribute('color', shaftCol);
  headGeometry.setAttribute('position', headPos); headGeometry.setAttribute('color', headCol);
  shaftGeometry.setDrawRange(0, 0); headGeometry.setDrawRange(0, 0);
  const sp = shaftPos.array as Float32Array, sc = shaftCol.array as Float32Array;
  const hp = headPos.array as Float32Array, hc = headCol.array as Float32Array;
  let count = 0;
  /** Created once: no per-frame closure or array. */
  const writeOne = (entry: CascadeEntry, brightness: number) => {
    if (count >= capacity) return;
    const colour = RGB_OF[entry.kind];
    writeArrow(sp, hp, count, entry.from, entry.to);
    for (let v = 0; v < 2; v++) for (let c = 0; c < 3; c++) sc[count * 6 + v * 3 + c] = colour[c] * brightness;
    for (let v = 0; v < 4; v++) for (let c = 0; c < 3; c++) hc[count * 12 + v * 3 + c] = colour[c] * brightness;
    count++;
  };
  return {
    trail, material, shaftGeometry, headGeometry, attributes,
    write(tick, alpha) {
      count = 0;
      trail.forEachArrow(tick, alpha, writeOne);
      for (const attribute of attributes) attribute.needsUpdate = true;
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
  let qualityOk = true;
  const publish = (drawn: number) => {
    const counts = drawing ? drawing.trail.counts() : { changes: 0, commits: 0, pops: 0, pending: 0 };
    group.userData.cascade = { drawn, changes: counts.changes, commits: counts.commits, pops: counts.pops, pending: counts.pending, optIn };
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
      const { trail, shaftGeometry, headGeometry } = drawing;
      // Fallback for a view without per-tick ingestion: a repeated tick is a no-op inside the trail.
      if (frame.curr.tick > trail.lastTick) trail.ingest(frame.curr);
      const show = visible && qualityOk && readViewMode().xray;
      const count = show ? drawing.write(frame.curr.tick, frame.alpha) : 0;
      shaftGeometry.setDrawRange(0, count * 2);
      headGeometry.setDrawRange(0, count * 4);
      group.visible = show && count > 0;
      publish(count);
    },
    reset() {
      if (!drawing) return;
      drawing.trail.reset(); drawing.shaftGeometry.setDrawRange(0, 0); drawing.headGeometry.setDrawRange(0, 0);
      group.visible = false; publish(0);
    },
    setQuality(level) { qualityOk = level <= 0; if (!qualityOk) group.visible = false; },
    setVisible(value) { visible = value; if (!value) group.visible = false; },
    dispose() {
      scene?.remove(group);
      if (drawing) { drawing.shaftGeometry.dispose(); drawing.headGeometry.dispose(); drawing.material.dispose(); }
    },
  };
}

/** Writes arrow `k`: its shaft (2 vertices) and a two-stroke head at `to` (4 vertices). No allocation. */
function writeArrow(sp: Float32Array, hp: Float32Array, k: number, from: Vec3, to: Vec3): void {
  const s = k * 6, h = k * 12;
  sp[s] = from[0]; sp[s + 1] = from[1]; sp[s + 2] = from[2];
  sp[s + 3] = to[0]; sp[s + 4] = to[1]; sp[s + 5] = to[2];
  let dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) { for (let v = 0; v < 4; v++) { hp[h + v * 3] = to[0]; hp[h + v * 3 + 1] = to[1]; hp[h + v * 3 + 2] = to[2]; } return; }
  dx /= length; dy /= length; dz /= length;
  // A perpendicular: d × up, or d × x when d is (anti)parallel to up.
  let px = -dz, py = 0, pz = dx;                     // d × (0, 1, 0)
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-3) { px = 0; py = dz; pz = -dy; pl = Math.hypot(px, py, pz); }   // d × (1, 0, 0)
  px /= pl; py /= pl; pz /= pl;
  const head = Math.min(HEAD_LENGTH, 0.3 * length), spread = head * HEAD_SPREAD;
  const bx = to[0] - dx * head, by = to[1] - dy * head, bz = to[2] - dz * head;
  for (let v = 0; v < 2; v++) {
    const o = h + v * 6, sign = v === 0 ? 1 : -1;
    hp[o] = to[0]; hp[o + 1] = to[1]; hp[o + 2] = to[2];
    hp[o + 3] = bx + px * spread * sign; hp[o + 4] = by + py * spread * sign; hp[o + 5] = bz + pz * spread * sign;
  }
}

export default function createLayer(): Layer { return createCascadeLayer(); }
