import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, type Camera, type Scene } from 'three';
import type { Layer } from '../Layer';
import { DeathTrace } from '../colourModes/deathTrace';
import { readViewMode } from '../colourModes/viewMode';

export default function createLayer(): Layer {
  const trace = new DeathTrace();
  const group = new Group();
  const geometry = new SphereGeometry(0.45, 8, 6);
  const crossGeometry = new BufferGeometry();
  crossGeometry.setAttribute('position', new Float32BufferAttribute([-0.35,-0.35,0, 0.35,0.35,0, -0.35,0.35,0, 0.35,-0.35,0], 3));
  const markers = new Map<number, { flash: Mesh; cross: LineSegments; material: MeshBasicMaterial; crossMaterial: LineBasicMaterial }>();
  let scene: Scene;
  let camera: Camera;
  let visible = true;
  return {
    id: 'deaths',
    init(ctx) { scene = ctx.scene; camera = ctx.camera; scene.add(group); },
    update(frame) {
      trace.update(frame.prev, frame.curr);
      const deaths = trace.markers(frame.curr.tick, frame.alpha, readViewMode().xray);
      const current = new Set(deaths.map(death => death.id));
      for (const [id, marker] of markers) if (!current.has(id)) {
        group.remove(marker.flash, marker.cross); marker.material.dispose(); marker.crossMaterial.dispose(); markers.delete(id);
      }
      for (const death of deaths) {
        let marker = markers.get(death.id);
        if (!marker) {
          const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
          const crossMaterial = new LineBasicMaterial({ color: 0x637783, transparent: true, opacity: 0.6, depthWrite: false });
          marker = { flash: new Mesh(geometry, material), cross: new LineSegments(crossGeometry, crossMaterial), material, crossMaterial };
          markers.set(death.id, marker); group.add(marker.flash, marker.cross);
        }
        marker.flash.position.set(...death.pos); marker.cross.position.set(...death.pos);
        marker.flash.scale.setScalar(1 + (1 - death.flash) * 1.5);
        marker.material.opacity = death.flash;
        marker.flash.visible = death.flash > 0;
        marker.cross.visible = death.cross;
        marker.cross.quaternion.copy(camera.quaternion);
      }
      group.visible = visible;
    },
    setVisible(value) { visible = value; group.visible = value; },
    dispose() { for (const marker of markers.values()) { marker.material.dispose(); marker.crossMaterial.dispose(); } markers.clear(); geometry.dispose(); crossGeometry.dispose(); scene?.remove(group); },
  };
}
