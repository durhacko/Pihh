// Stage preview of a draft (FE-B2 #93, UI-03): hollow rings at the draft's slots, drawn over a dimmed live swarm, so
// the target shape reads clearly and is never mistaken for drones. Local only: it reads store.preview (set by the
// Composer or `preview on`) and expandRecipe, and it has no route to a world. Without connectPreview(store) it draws
// nothing.
import { Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, ShaderMaterial, type Camera, type Scene } from 'three';
import type { Formation, Params } from '../../../contracts';
import { expandRecipe } from '../../../score';
import type { StagePreview, Store } from '../../ui/store';
import type { Layer } from '../Layer';

type PreviewSource = Pick<Store, 'state'>;
let source: PreviewSource | null = null;

/** Connects every PreviewLayer to the UI store (the Composer does this). Returns the disconnect. */
export function connectPreview(store: PreviewSource | null): () => void {
  source = store;
  return () => { if (source === store) source = null; };
}

/** The preview to draw now, or null. */
export function currentPreview(): StagePreview | null { return source?.state.preview ?? null; }

/** The stage label. A precomputed fixture formation (GF-WP-10, #265) says it is a target arrangement, not a flight. */
export function previewLabel(preview: StagePreview): string {
  if (preview.formation) return `PREVIEW · target arrangement (preview), not flown · fixture “${preview.label}” · local only, nothing is sent`;
  return `PREVIEW · “${preview.label}” · local only, nothing is sent`;
}

/** How much the overlay darkens the live swarm while a preview is shown (0 = none, 1 = black). */
export const PREVIEW_DIM = 0.72;

// One label for the whole page, shared by every PreviewLayer (split view has two), counted by reference.
let label: HTMLDivElement | null = null;
let labelUsers = 0;
const labelShows = new Set<object>();
function acquireLabel(): void {
  if (typeof document === 'undefined') return;
  labelUsers++;
  if (label) return;
  label = document.createElement('div');
  label.dataset.previewLabel = '';
  label.setAttribute('role', 'status');
  label.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:96px;padding:4px 10px;border:1px dashed #6f8a97;border-radius:6px;background:#06121dcc;color:#d6ecf3;font:12px system-ui;letter-spacing:.04em;pointer-events:none;z-index:4';
  label.hidden = true;
  document.body.append(label);
}
function releaseLabel(owner: object): void {
  labelShows.delete(owner);
  if (!label || --labelUsers > 0) return;
  label.remove(); label = null; labelUsers = 0;
}
/** Shown while any layer draws a preview; the text is written only when it changes (it is a live region). */
function showLabel(owner: object, text: string | null): void {
  if (text === null) labelShows.delete(owner); else labelShows.add(owner);
  if (!label) return;
  label.hidden = labelShows.size === 0;
  if (text !== null && label.textContent !== text) label.textContent = text;
}

export default function createLayer(): Layer {
  const group = new Group();
  // A full-viewport quad in clip space, drawn after the swarm, darkens everything behind the rings.
  const dim = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    uniforms: { colour: { value: new Color(0x03080e) }, opacity: { value: PREVIEW_DIM } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform vec3 colour; uniform float opacity; void main() { gl_FragColor = vec4(colour, opacity); }',
    transparent: true, depthTest: false, depthWrite: false,
  }));
  dim.frustumCulled = false; dim.renderOrder = 900; dim.name = 'dim';
  const ringGeometry = new RingGeometry(0.3, 0.42, 20);
  const ringMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false });
  const transform = new Object3D();
  const colour = new Color();
  let rings: InstancedMesh;
  let scene: Scene;
  let camera: Camera;
  let params: Params;
  let visible = true;
  let key = '';
  let formation: Formation | null = null;
  const owner = {};
  return {
    id: 'preview',
    init(ctx) {
      scene = ctx.scene; camera = ctx.camera; params = ctx.params;
      rings = new InstancedMesh(ringGeometry, ringMaterial, ctx.params.n0);
      rings.instanceMatrix.setUsage(DynamicDrawUsage); rings.frustumCulled = false; rings.renderOrder = 901; rings.count = 0; rings.name = 'rings';
      group.add(dim, rings); group.visible = false;
      scene.add(group);
      acquireLabel();
    },
    update() {
      const preview = currentPreview();
      if (!visible || !preview) {
        group.visible = false; rings.count = 0;
        showLabel(owner, null);
        group.userData.preview = null;
        return;
      }
      if (preview.formation) { key = ''; formation = preview.formation; }   // precomputed (#265): drawn as given
      else {
        const next = JSON.stringify(preview.recipe);
        if (next !== key) { key = next; formation = expandRecipe(preview.recipe, params.n0, params); }
      }
      const slots = formation!.slots;
      const n = Math.min(slots.length, rings.instanceMatrix.count);
      for (let i = 0; i < n; i++) {
        transform.position.set(...slots[i].pos);
        transform.quaternion.copy(camera.quaternion);   // billboard: always a ring, never a sliver
        transform.updateMatrix();
        rings.setMatrixAt(i, transform.matrix);
        rings.setColorAt(i, colour.setRGB(...slots[i].colour));
      }
      rings.count = n;
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      group.visible = true;
      group.userData.preview = preview.formation ? { slots: n, label: preview.label, source: preview.source ?? 'fixture' } : { slots: n, label: preview.label };
      showLabel(owner, previewLabel(preview));
    },
    setVisible(value) { visible = value; if (!value) { group.visible = false; showLabel(owner, null); } },
    dispose() {
      scene?.remove(group);
      rings?.dispose(); ringGeometry.dispose(); ringMaterial.dispose();
      dim.geometry.dispose(); (dim.material as ShaderMaterial).dispose();
      releaseLabel(owner);
    },
  };
}
