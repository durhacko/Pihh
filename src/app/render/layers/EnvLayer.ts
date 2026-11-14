import { Color, GridHelper, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, FogExp2 } from 'three';
import type { Layer } from '../Layer';

export default function createLayer(): Layer {
  const group = new Group();
  const grid = new GridHelper(180, 60, 0x183d4d, 0x102632);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  const ground = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: 0x050c12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  group.add(ground, grid);
  let scene: Scene;
  return {
    id: 'environment',
    init(ctx) {
      scene = ctx.scene;
      scene.background = new Color(0x03080e);
      scene.fog = new FogExp2(0x03080e, 0.003);
      scene.add(group);
    },
    update() {},
    setVisible(visible) { group.visible = visible; },
    dispose() { scene?.remove(group); ground.geometry.dispose(); ground.material.dispose(); grid.geometry.dispose(); grid.material.dispose(); },
  };
}
