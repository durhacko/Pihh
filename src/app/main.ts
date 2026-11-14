import { DT, makeParams } from '../contracts';
import { CameraRig, type CameraPreset } from './render/CameraRig';
import { SnapshotBuffer } from './render/SnapshotBuffer';
import { WorldView } from './render/WorldView';
import { createSnapshotSource } from './snapshotSource';
import { createPanels } from './ui';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing app root');
if (import.meta.env.VITE_SIM_MODE === 'false') throw new Error('Encore supports simulation mode only');

app.innerHTML = `<div class="airspace"></div>
  <header class="masthead"><div><p class="brand">ENCORE / AIRSPACE</p><h1 class="title">A composition of independent minds.</h1><p class="caption">Renderer preview · fixture snapshots only<br>No live simulation or recovery results yet.</p></div><span class="preview-badge">FIXTURE PREVIEW</span></header>
  <p class="help">Drag to orbit · right-drag to pan · scroll to zoom</p>
  <nav class="view-controls" aria-label="Camera presets"><button data-preset="audience" aria-pressed="true">1 Audience</button><button data-preset="quarter" aria-pressed="false">2 Three-quarter</button><button data-preset="top" aria-pressed="false">3 Top</button></nav>
  <output class="frame-readout" aria-live="off"></output>`;

const host = app.querySelector<HTMLElement>('.airspace')!;
const readout = app.querySelector<HTMLOutputElement>('.frame-readout')!;
const params = makeParams(200);
const source = createSnapshotSource(params);
const buffer = new SnapshotBuffer(source.initial);
const rig = new CameraRig();
let view: WorldView;
try { view = new WorldView(host, params, rig); }
catch (error) {
  host.innerHTML = '<p class="error">WebGL could not start. Enable browser graphics acceleration and reload.</p>';
  throw error;
}
rig.attach(view.renderer.domElement);
const panels = createPanels({ host: app });

const buttons = [...app.querySelectorAll<HTMLButtonElement>('[data-preset]')];
function setPreset(preset: CameraPreset) {
  rig.preset(preset);
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.preset === preset));
}
for (const button of buttons) button.addEventListener('click', () => setPreset(button.dataset.preset as CameraPreset));
function onKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable=true]')) return;
  const preset = ({ '1': 'audience', '2': 'quarter', '3': 'top' } as const)[event.key as '1' | '2' | '3'];
  if (preset) setPreset(preset);
}
window.addEventListener('keydown', onKey);

let previousTime = performance.now();
let accumulator = 0;
let measuredTime = 0;
let measuredFrames = 0;
let animation = 0;
function draw(now: number) {
  const dtReal = Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  accumulator += Math.min(dtReal, 0.1);
  let steps = 0;
  while (accumulator >= DT && steps < 5) { buffer.push(source.step()); accumulator -= DT; steps++; }
  const frame = buffer.frame(accumulator / DT, dtReal);
  view.render(frame);
  measuredTime += dtReal;
  measuredFrames++;
  if (measuredTime >= 1) {
    readout.dataset.fps = (measuredFrames / measuredTime).toFixed(1);
    readout.dataset.tick = String(frame.curr.tick);
    readout.dataset.visible = String(frame.curr.drones.filter(drone => drone.alive).length);
    readout.textContent = `${frame.curr.drones.filter(drone => drone.alive).length} visible / ${frame.curr.drones.length} fixture drones\n${(measuredFrames / measuredTime).toFixed(0)} rendered fps · tick ${frame.curr.tick}`;
    measuredTime = 0;
    measuredFrames = 0;
  }
  animation = requestAnimationFrame(draw);
}
animation = requestAnimationFrame(draw);

if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(animation);
  window.removeEventListener('keydown', onKey);
  for (const panel of panels) panel.dispose();
  rig.dispose();
  view.dispose();
});
