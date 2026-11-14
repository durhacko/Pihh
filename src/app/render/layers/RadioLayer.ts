import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Scene } from 'three';
import type { Layer } from '../Layer';
import { RadioTrace } from '../colourModes/radioTrace';
import { readViewMode } from '../colourModes/viewMode';

export default function createLayer(): Layer {
  const trace = new RadioTrace();
  const group = new Group();
  const geometry = new BufferGeometry();
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
  group.add(new LineSegments(geometry, material));
  let scene: Scene;
  let visible = true;
  let counter: HTMLOutputElement | undefined;
  return {
    id: 'radio',
    init(ctx) {
      scene = ctx.scene; scene.add(group);
      if (typeof document !== 'undefined') {
        counter = document.createElement('output');
        const index = document.querySelectorAll('[data-radio-counter]').length;
        counter.dataset.radioCounter = String(index + 1);
        counter.style.cssText = `position:fixed;right:40px;top:${130 + index * 28}px;color:#91acb8;font:12px system-ui;pointer-events:none;z-index:2`;
        counter.setAttribute('aria-live', 'off');
        document.body.append(counter);
      }
    },
    update(frame) {
      const mode = readViewMode();
      const enabled = visible && mode.xray;
      trace.update(frame.prev, frame.curr);
      const plan = trace.plan(frame.curr.tick, frame.alpha, mode.selectedDroneId, enabled);
      const positions: number[] = [];
      const colours: number[] = [];
      for (const segment of [...plan.segments, ...plan.stubs]) {
        positions.push(...segment.from, ...segment.to);
        const colour = segment.colour.map(value => value * segment.opacity);
        colours.push(...colour, ...colour);
      }
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
      geometry.computeBoundingSphere();
      group.visible = enabled;
      group.userData.radio = { drawn: plan.drawn, observed: plan.logged, currentSegments: plan.segments.length, droppedStubs: plan.stubs.length };
      if (counter) {
        counter.hidden = !enabled;
        counter.textContent = `Radio view ${counter.dataset.radioCounter} · drawn ${plan.drawn} / ${plan.logged} observed deliveries · last 1 s`;
        counter.dataset.drawn = String(plan.drawn);
        counter.dataset.observed = String(plan.logged);
      }
    },
    ingest(snapshot) { trace.ingest(snapshot); },
    reset() { trace.reset(); },
    setVisible(value) { visible = value; group.visible = value && readViewMode().xray; if (counter) counter.hidden = !group.visible; },
    dispose() { scene?.remove(group); geometry.dispose(); material.dispose(); counter?.remove(); },
  };
}
