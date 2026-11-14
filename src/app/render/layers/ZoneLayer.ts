import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Scene, SphereGeometry, Vector3 } from 'three';
import type { Layer } from '../Layer';
import { readViewMode } from '../colourModes/viewMode';

export default function createLayer(): Layer {
  const group = new Group();
  let scene: Scene;
  let signature = '';
  let visible = true;
  function clear() {
    for (const child of [...group.children]) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      group.remove(mesh);
    }
  }
  return {
    id: 'zones',
    init(ctx) { scene = ctx.scene; scene.add(group); },
    update(frame) {
      const next = JSON.stringify([frame.curr.jams, frame.curr.partitions]);
      if (next !== signature) {
        signature = next; clear();
        for (const jam of frame.curr.jams) {
          const sphere = new Mesh(new SphereGeometry(jam.radius, 24, 16), new MeshBasicMaterial({ color: 0xd55e00, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }));
          sphere.position.set(...jam.centre); sphere.userData.jamId = jam.id; group.add(sphere);
        }
        for (const partition of frame.curr.partitions) {
          const plane = new Mesh(new PlaneGeometry(130, 100, 10, 10), new MeshBasicMaterial({ color: 0xf0e442, wireframe: true, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide }));
          plane.position.set(...partition.point);
          const normal = new Vector3(...partition.normal).normalize();
          plane.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal));
          plane.userData.partitionId = partition.id; group.add(plane);
        }
      }
      group.visible = visible && readViewMode().xray;
    },
    setVisible(value) { visible = value; group.visible = value && readViewMode().xray; },
    dispose() { clear(); scene?.remove(group); },
  };
}
