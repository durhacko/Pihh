// Tethers (FE-C #91): a line from a live drone to where IT believes it is flying, belief.target, and never to a
// reference slot. Amber (DESIGN §1: in transit / tethers). A drone already within rOcc of its own target draws none.
// Without a lens switch yet (FE-A2 owns lenses), the selected drone's tether is always drawn, and every drone's
// tether is drawn while X-ray is on. setVisible(false) hides them all.
import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Scene } from 'three';
import type { Layer } from '../Layer';
import { readViewMode } from '../colourModes/viewMode';

export const TETHER_COLOUR = 0xffb547;

export default function createLayer(): Layer {
  const geometry = new BufferGeometry();
  const material = new LineBasicMaterial({ color: TETHER_COLOUR, transparent: true, opacity: 0.5, depthWrite: false });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  let positions: Float32BufferAttribute;
  let scene: Scene;
  let rOcc2 = 0;
  let visible = true;
  return {
    id: 'tethers',
    init(ctx) {
      scene = ctx.scene;
      rOcc2 = ctx.params.rOcc ** 2;
      positions = new Float32BufferAttribute(new Float32Array(ctx.params.n0 * 6), 3);
      positions.setUsage(DynamicDrawUsage);
      geometry.setAttribute('position', positions);
      geometry.setDrawRange(0, 0);
      scene.add(lines);
    },
    update(frame) {
      const mode = readViewMode();
      const capacity = positions.count / 2;
      const array = positions.array as Float32Array;
      const t = Math.max(0, Math.min(1, frame.alpha));   // interpolateVector's clamp
      let count = 0;
      if (visible) for (const drone of frame.curr.drones) {
        if (!drone.alive || count >= capacity) continue;
        if (!mode.xray && drone.id !== mode.selectedDroneId) continue;
        const target = drone.belief.target;
        const dx = drone.pos[0] - target[0], dy = drone.pos[1] - target[1], dz = drone.pos[2] - target[2];
        if (dx * dx + dy * dy + dz * dz <= rOcc2) continue;
        // The interpolated start, written straight into the buffer: no per-drone arrays or objects on this per-frame
        // path (in X-ray it runs for every live drone). Same result as interpolateDrone(prev, drone, alpha).pos.
        const previous = frame.prev.drones[drone.id];
        const before = previous?.id === drone.id ? previous.pos : drone.pos;
        const o = count * 6;
        array[o] = before[0] + (drone.pos[0] - before[0]) * t;
        array[o + 1] = before[1] + (drone.pos[1] - before[1]) * t;
        array[o + 2] = before[2] + (drone.pos[2] - before[2]) * t;
        array[o + 3] = target[0]; array[o + 4] = target[1]; array[o + 5] = target[2];
        count++;
      }
      positions.needsUpdate = true;
      geometry.setDrawRange(0, count * 2);
      lines.visible = count > 0;
      lines.userData.tethers = count;
    },
    setVisible(value) { visible = value; if (!value) lines.visible = false; },
    dispose() { scene?.remove(lines); geometry.dispose(); material.dispose(); },
  };
}
