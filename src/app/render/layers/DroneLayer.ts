import { AdditiveBlending, Color, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial, Object3D, Scene, SphereGeometry } from 'three';
import type { Layer } from '../Layer';
import { interpolateDrone } from '../SnapshotBuffer';
import { droneColour } from '../colourModes/droneColour';

/** Bright points and translucent instanced halos use exactly the snapshot's RGB. */
export default function createLayer(): Layer {
  const group = new Group();
  let points: InstancedMesh;
  let halos: InstancedMesh;
  let scene: Scene;
  const transform = new Object3D();
  const colour = new Color();
  const geometry = new SphereGeometry(0.16, 8, 6);
  const pointMaterial = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const haloMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.11, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  return {
    id: 'drones',
    init(ctx) {
      scene = ctx.scene;
      points = new InstancedMesh(geometry, pointMaterial, ctx.params.n0);
      halos = new InstancedMesh(geometry, haloMaterial, ctx.params.n0);
      for (const mesh of [points, halos]) {
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.frustumCulled = false;
      }
      group.add(points, halos);
      scene.add(group);
    },
    update(frame) {
      if (frame.curr.drones.length > points.instanceMatrix.count) throw new Error('Snapshot roster exceeds view capacity');
      let count = 0;
      for (const drone of frame.curr.drones) {
        if (!drone.alive) continue;
        const before = frame.prev.drones[drone.id];
        const shown = interpolateDrone(before, drone, frame.alpha);
        transform.position.set(...shown.pos);
        transform.scale.setScalar(1);
        transform.updateMatrix();
        points.setMatrixAt(count, transform.matrix);
        colour.setRGB(...droneColour(drone, shown.colour));
        points.setColorAt(count, colour);
        halos.setColorAt(count, colour);
        transform.scale.setScalar(3.8);
        transform.updateMatrix();
        halos.setMatrixAt(count, transform.matrix);
        count++;
      }
      for (const mesh of [points, halos]) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    setVisible(visible) { group.visible = visible; },
    dispose() { scene?.remove(group); geometry.dispose(); pointMaterial.dispose(); haloMaterial.dispose(); points?.dispose(); halos?.dispose(); },
  };
}
