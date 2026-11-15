import { DoubleSide, DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D, RingGeometry, type Camera, type Scene } from 'three';
import type { Layer } from '../Layer';
import { resetVersionColours, versionColour, versionKey } from '../colourModes/belief';
import { readViewMode } from '../colourModes/viewMode';
import { interpolateDrone } from '../SnapshotBuffer';

export default function createLayer(): Layer {
  const geometry = new RingGeometry(0.45, 0.51, 24);
  const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const transform = new Object3D();
  let rings: InstancedMesh;
  let scene: Scene;
  let camera: Camera;
  let visible = true;
  let legend: HTMLDivElement | undefined;
  return {
    id: 'belief',
    init(ctx) {
      scene = ctx.scene; camera = ctx.camera;
      rings = new InstancedMesh(geometry, material, ctx.params.n0);
      rings.instanceMatrix.setUsage(DynamicDrawUsage); rings.frustumCulled = false; scene.add(rings);
      if (typeof document !== 'undefined') {
        legend = document.createElement('div');
        const index = document.querySelectorAll('[data-belief-legend]').length;
        legend.dataset.beliefLegend = String(index + 1);
        legend.style.cssText = `position:fixed;right:40px;top:${190 + index * 100}px;color:#b8cbd4;font:12px system-ui;line-height:1.8;pointer-events:none;z-index:2`;
        document.body.append(legend);
      }
    },
    update(frame) {
      let count = 0;
      const versions = new Map<string, { colour: [number, number, number]; count: number }>();
      for (const drone of frame.curr.drones) if (drone.alive) {
        const key = versionKey(drone.belief.version);
        const colour = versionColour(drone.belief.version);
        const version = versions.get(key) ?? { colour, count: 0 }; version.count++; versions.set(key, version);
        if (!drone.belief.deaf) continue;
        const shown = interpolateDrone(frame.prev.drones[drone.id], drone, frame.alpha);
        transform.position.set(...shown.pos); transform.quaternion.copy(camera.quaternion); transform.updateMatrix();
        rings.setMatrixAt(count++, transform.matrix);
      }
      rings.count = count; rings.instanceMatrix.needsUpdate = true; rings.visible = visible;
      if (legend) {
        legend.hidden = !visible || !readViewMode().beliefColours;
        legend.replaceChildren();
        const title = document.createElement('div'); title.textContent = `View ${legend.dataset.beliefLegend} · score beliefs (live)`; legend.append(title);
        for (const [key, version] of versions) {
          const row = document.createElement('div');
          row.textContent = `● ${key} · ${version.count}`;
          row.style.color = `rgb(${version.colour.map(value => Math.round(value * 255)).join(',')})`; legend.append(row);
        }
      }
    },
    // The world was rebuilt: its versions start over, so their colours do too (#134 P1-10).
    reset() { resetVersionColours(); },
    setVisible(value) { visible = value; rings.visible = value; if (legend) legend.hidden = !value || !readViewMode().beliefColours; },
    dispose() { scene?.remove(rings); rings?.dispose(); geometry.dispose(); material.dispose(); legend?.remove(); },
  };
}
