// Selection (FE-C #91, UI-07): four white arcs around the selected drone (a different shape from the white full deaf
// ring, DESIGN §1), its sensing sphere (rSense), its radio ring (rRadio) and a white cross at its own belief.target.
// The selected id comes from the view-mode singleton that the controls' selectDrone sets. The layer reads only that
// one drone: its drawn position (so the arcs sit on the dot DroneLayer draws) and its Belief. It never imports
// WorldSnapshot or src/agent (tests/app/stage/isolation.test.ts).
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, RingGeometry, type Camera, type Scene } from 'three';
import type { Layer } from '../Layer';
import { readViewMode } from '../colourModes/viewMode';
import { interpolateDrone } from '../SnapshotBuffer';

/** Four arcs of a radius-0.95 circle, each a polyline of six short segments, with gaps at 45° between them. */
function arcGeometry(): BufferGeometry {
  const points: number[] = [];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) {
    const a0 = k * Math.PI / 2 + 0.25 + i * 0.18;
    const a1 = a0 + 0.18;
    points.push(Math.cos(a0) * 0.95, Math.sin(a0) * 0.95, 0, Math.cos(a1) * 0.95, Math.sin(a1) * 0.95, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
}

function crossGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5], 3));
  return geometry;
}

export interface SelectionState { id: number; alive: boolean; anchor: [number, number, number]; target: [number, number, number] }

export default function createLayer(): Layer {
  const group = new Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(value: T): T => { owned.push(value); return value; };
  // Overlays draw on top of the swarm (no depth test), so a selection is never hidden behind other drones.
  const white = own(new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  const arcs = new LineSegments(own(arcGeometry()), white);
  const cross = new LineSegments(own(crossGeometry()), white);
  let sensing: LineSegments;
  let radio: Mesh;
  let scene: Scene;
  let camera: Camera;
  let visible = true;
  return {
    id: 'selection',
    init(ctx) {
      scene = ctx.scene; camera = ctx.camera;
      sensing = new LineSegments(own(new EdgesGeometry(own(new IcosahedronGeometry(ctx.params.rSense, 2)))), own(new LineBasicMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.12, depthWrite: false })));
      radio = new Mesh(own(new RingGeometry(ctx.params.rRadio - 0.06, ctx.params.rRadio + 0.06, 96)), own(new MeshBasicMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false })));
      radio.rotation.x = -Math.PI / 2;   // a horizontal ring in the y-up world
      sensing.name = 'sensing'; radio.name = 'radio'; arcs.name = 'arcs'; cross.name = 'target';
      for (const object of [arcs, cross]) object.renderOrder = 10;
      group.add(arcs, sensing, radio, cross);
      group.visible = false;
      scene.add(group);
    },
    update(frame) {
      const id = readViewMode().selectedDroneId;
      const drone = id === null ? undefined : frame.curr.drones[id];
      if (!visible || id === null || !drone || drone.id !== id) {
        group.visible = false; group.userData.selection = null;
        return;
      }
      // A live drone is drawn interpolated; a dead one is no longer drawn, so the arcs mark where it fell.
      const shown = drone.alive ? interpolateDrone(frame.prev.drones[id], drone, frame.alpha) : drone;
      const target = drone.belief.target;
      arcs.position.set(...shown.pos); arcs.quaternion.copy(camera.quaternion);
      sensing.position.set(...shown.pos); radio.position.set(...shown.pos);
      cross.position.set(...target);
      // Sensing range, radio range and the flying-to cross describe a working drone; a dead one keeps only the arcs.
      sensing.visible = drone.alive; radio.visible = drone.alive; cross.visible = drone.alive;
      group.visible = true;
      const state: SelectionState = { id, alive: drone.alive, anchor: [...shown.pos], target: [...target] };
      group.userData.selection = state;
    },
    setVisible(value) { visible = value; if (!value) group.visible = false; },
    dispose() { scene?.remove(group); for (const item of owned) item.dispose(); },
  };
}
