// src/app/main.ts
// The stage-first app shell (#92; research/ui-prototype DESIGN.md §1, §2, §4): a dominant 3D stage, a
// one-line readout at the top right, one dock at the bottom, Disrupt / Lenses / Metrics / Help popovers, a
// legend while a lens needs one, toasts, and H for performance mode.
// Rules: the UI changes a world only through the one action API (src/app/actions.ts), which resolves each
// action once and schedules the same event into both worlds; everything shown comes from a snapshot, the radio
// layer's own tally or an observer MetricsSample.
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { DT, type EnvEvent, type MetricsSample, type Vec3, type WorldSnapshot } from '../contracts';
import { currentMovement } from '../score';
import { idsInSphere } from '../sim';
import { bindControls, type ControlIntent, type ControlResult } from './actions';
import { CameraRig, type CameraPreset } from './render/CameraRig';
import { resetViewMode, setViewMode } from './render/colourModes/viewMode';
import type { LayerFrame } from './render/Layer';
import { createSlotStatusFeed, type SlotStatusFeed } from './render/layers/GhostSlotLayer';
import { interpolateDrone, SnapshotBuffer } from './render/SnapshotBuffer';
import { WorldView } from './render/WorldView';
import { createDock } from './ui/Dock';
import { h } from './ui/dom';
import { HudModel } from './ui/Hud';
import { connectComposer, Drafts } from './ui/Composer';
import { connectConsole } from './ui/Console';
import { brainNote, connectDemo } from './ui/DemoScript';
import { connectInspector, createPanel as createInspectorPanel, type InspectorSource } from './ui/Inspector';
import { observerTruth } from './ui/inspectorTruth';
import { bindShortcuts } from './ui/keys';
import { createLegend } from './ui/Legend';
import { createDisrupt, createHelp, createLenses, createMetrics, type PopoverContext } from './ui/popovers';
import { createReadout } from './ui/Readout';
import { defaultUIState, Store, type ViewMode } from './ui/store';
import { handleEscape, Surfaces } from './ui/surfaces';
import { connectTimeline } from './ui/Timeline';
import { createToasts } from './ui/Toasts';
import { ARMS, controlContext, createFrameLoop, createTickPipeline, createWorlds, hudPayload, type Arm, type Pair } from './worlds';
import './ui/styles.css';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Missing app root');
const root: HTMLElement = appRoot;
if (import.meta.env.VITE_SIM_MODE === 'false') throw new Error('Encore supports simulation mode only');

// URL options: ?seed=<uint32> (default 1); ?n0=100|150|200 (roster, default 200; read once, kept across resets);
// ?split=1 or ?arm=static choose the first view; ?q=low lowers quality.
const query = new URLSearchParams(window.location.search);
const requestedSeed = Number(query.get('seed') ?? 1);
const initialSeed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xffffffff ? requestedSeed : 1;
const ROSTERS = [100, 150, 200] as const;
const requestedN0 = query.get('n0');
const n0 = ROSTERS.find(r => String(r) === requestedN0) ?? 200;
if (requestedN0 !== null && String(n0) !== requestedN0) console.info(`Encore: ?n0=${requestedN0} ignored; allowed rosters are ${ROSTERS.join(', ')}. Using ${n0}.`);
const initialView: ViewMode = query.get('split') === '1' ? 'split' : query.get('arm') === 'static' ? 'static' : 'encore';
const initialState = defaultUIState({ quality: query.get('q') === 'low' ? 'low' : 'auto', reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false });
// Tethers start on: the selected drone's tether is part of its neighbourhood (all tethers still need X-ray).
const store = new Store({ ...initialState, view: initialView, lenses: { ...initialState.lenses, tethers: true } });
resetViewMode();   // render view state is a module singleton (#25): every load and HMR reload starts from defaults

// ---------- worlds ----------
// The only place the app holds worlds. It changes them only by stepping and by scheduling through the controller.
const worlds = createWorlds({ seed: initialSeed, n0 });   // reset() rebuilds with the same params, so the roster stays
const params = worlds.params;
const transport = { playing: true, speed: 1 };
const first = worlds.stepBoth();
const buffers: Pair<SnapshotBuffer> = { encore: new SnapshotBuffer(first.encore), static: new SnapshotBuffer(first.static) };

// ---------- stage: one WorldView per world, always mounted; the shown ones render ----------
root.replaceChildren();
// z-index 0 makes the stage its own stacking context, so the panes' z-order never lifts a canvas over the chrome.
const stage = h('div', { class: 'stage', style: { zIndex: '0' } });
const panes: Pair<HTMLElement> = {
  encore: h('div', { 'data-arm': 'encore', style: { position: 'absolute', left: '0', right: '0' } }),
  static: h('div', { 'data-arm': 'static', style: { position: 'absolute', left: '0', right: '0' } }),
};
stage.append(panes.encore, panes.static);
root.append(stage);
const rig = new CameraRig();
const views: { arm: Arm; view: WorldView }[] = [];
try {
  for (const arm of ARMS) views.push({ arm, view: new WorldView(panes[arm], params, rig) });
} catch (error) {
  for (const { view } of views) view.dispose();
  root.replaceChildren(h('p', { class: 'banner', style: { position: 'absolute', inset: '40% 20%' } }, 'WebGL could not start. Enable browser graphics acceleration and reload.'));
  throw error;
}
rig.attach(stage);
const viewOf = (arm: Arm): WorldView => views.find(v => v.arm === arm)!.view;
// Ghost slots (#102): one throttled Observer.slotStatus feed per world (at most 4 Hz), read only while the lens is on.
const slotFeeds: Pair<SlotStatusFeed> = { encore: createSlotStatusFeed(() => worlds.observers.encore), static: createSlotStatusFeed(() => worlds.observers.static) };
function applyLayerLenses(): void {
  for (const { view } of views) for (const layer of view.layers) {
    if (layer.id === 'ghost-slots') layer.setVisible(store.state.lenses.ghosts);
    if (layer.id === 'tethers') layer.setVisible(store.state.lenses.tethers);
  }
}
applyLayerLenses();
for (const { arm, view } of views) view.ingest(first[arm]);
const pipeline = createTickPipeline(worlds, buffers, () => views.map(({ arm, view }) => ({ arm, ingest: (s: WorldSnapshot) => view.ingest(s), reset: () => view.reset() })));
/** Newest snapshots, read-only (never steps). After a reset whose first tick failed, the last drawn ones. */
function snapshots(): Pair<WorldSnapshot> {
  return pipeline.current() ?? { encore: buffers.encore.frame(0).curr, static: buffers.static.frame(0).curr };
}

// Panes: both keep the same size in single views (the hidden one stays laid out, so the shared camera's aspect
// is never set from a hidden pane); split stacks them. Only shown panes render.
const shown: Pair<boolean> = { encore: true, static: false };
const divider = h('div', { class: 'vp-divider', hidden: true });
const vpTop = h('div', { class: 'vp-label chrome', style: { top: '64px' } });
const vpBottom = h('div', { class: 'vp-label chrome' });
root.append(divider, vpTop, vpBottom);
function layoutViews(view: ViewMode): void {
  const place = (arm: Arm, top: string, height: string, visible: boolean) => {
    Object.assign(panes[arm].style, { top, height, visibility: visible ? 'visible' : 'hidden', zIndex: visible ? '1' : '0' });
    shown[arm] = visible;
  };
  if (view === 'split') { place('encore', '0', '50%', true); place('static', '50%', '50%', true); }
  else if (view === 'encore') { place('encore', '0', '100%', true); place('static', '0', '100%', false); }
  else { place('static', '0', '100%', true); place('encore', '0', '100%', false); }
  divider.hidden = view !== 'split';
  Object.assign(vpBottom.style, { top: 'calc(50% + 12px)' });
  // style.display, not `hidden`: the .vp-label class sets display:flex, which overrides the hidden attribute.
  vpBottom.style.display = view === 'split' ? '' : 'none';
  vpTop.style.display = view === 'encore' ? 'none' : '';
  for (const { view: v } of views) v.resize();
}
layoutViews(initialView);

// ---------- chrome ----------
const toaster = createToasts();
const brand = h('div', { class: 'brand chrome' },
  h('div', { class: 'wordmark' }, 'ENCORE', h('span', {}, 'swarm stage')));
const readout = createReadout(() => surfaces.toggle('metrics'));
const legend = createLegend();
const pickbar = h('div', { class: 'pickbar surface', hidden: true, role: 'status' });
const hoverLabel = h('div', { class: 'hover-label', hidden: true });
const hiddenHint = h('div', { class: 'hidden-hint', style: { opacity: '0' } }, 'Press H to show controls');
const surfaces = new Surfaces();
const hudModel = new HudModel();

// ---------- controls: the one action API ----------
// Selection and lenses are presentation state (the store); the render layers' view mode follows the store.
const display = {
  setSelected(id: number | null) { setViewMode({ selectedDroneId: id }); store.set({ selected: id === null ? null : { id, arm: 'encore' } }); },
  toggleXray() { store.lens('xray', !store.state.lenses.xray); },
  toggleBelief() { store.lens('colour', store.state.lenses.colour === 'belief' ? 'show' : 'belief'); },
};
let loopError: string | null = null;
const controls = bindControls(root, controlContext(worlds, {
  getSnapshots: snapshots,
  getTransport: () => ({ ...transport, seed: worlds.seed }),
  setPlaying,
  setSpeed,
  reset,
  step,
  display,
}));

/** Runs an intent through the controller (the same path as keys and, later, the console) and reports it. */
function run(intent: ControlIntent, quiet = false): ControlResult {
  const result = controls.handle(intent);
  if (!result.ok) toaster.toast(result.message, 'err');
  else if (!quiet && result.event) toaster.toast(result.event.type === 'KILL' ? `${result.message.replace('.', '')} · ${result.event.ids.length} drone${result.event.ids.length === 1 ? '' : 's'}.` : result.message, 'ok');
  refreshChrome();
  return result;
}

function setPlaying(playing: boolean): void {
  if (playing && worlds.broken) return;                // the controller says why (blockedReason)
  if (playing && loopError) loopError = null;          // a render-only failure: playing again clears the report
  transport.playing = playing;
  refreshChrome();
}
function setSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed <= 0 || speed > 8) throw new RangeError('Speed must be in (0, 8]');
  transport.speed = speed;
  refreshChrome();
}
function step(): void {
  try { pipeline.advance(); } catch (error) { report(error, 'tick'); }
  feedHud();
  refreshChrome();
}
function reset(seed: number): void {
  const recovering = loopError !== null;
  loopError = null;
  try { pipeline.restart(seed); } catch (error) { report(error, 'tick'); }   // a failed first tick keeps its root cause
  if (recovering && !worlds.broken) transport.playing = true;              // R after a stop is the recovery: run the new show
  feedHud();
  refreshChrome();
}
/** The error boundary's report. Keeps the root cause of a latched tick failure; toasts once per new message. */
function report(error: unknown, phase: 'tick' | 'render'): void {
  const message = worlds.broken?.message ?? (error instanceof Error ? error.message : String(error));
  transport.playing = false;
  if (message === loopError) return;
  loopError = message;
  console.error(`Encore loop stopped (${phase})`, error);
  toaster.toast(`Simulation error: ${message}. Paused: press R to reset.`, 'err');
  refreshChrome();
}

// ---------- picking a centre in the stage (region kill, jam) and selecting drones ----------
const PICK_PX = 14;
const projected = new Vector3();
const raycaster = new Raycaster();
const formationPlane = new Plane(new Vector3(0, 0, 1), 0);   // the formations face the audience on z = 0
let lastAlpha = 0;
const encoreCanvas = viewOf('encore').renderer.domElement;
function screenPositions(): { id: number; x: number; y: number }[] {
  if (!shown.encore) return [];
  const rect = encoreCanvas.getBoundingClientRect();
  const frame = buffers.encore.frame(lastAlpha);
  const out: { id: number; x: number; y: number }[] = [];
  for (const drone of frame.curr.drones) {
    if (!drone.alive) continue;
    projected.set(...interpolateDrone(frame.prev.drones[drone.id], drone, frame.alpha).pos).project(rig.camera);
    if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1) continue;
    out.push({ id: drone.id, x: rect.left + (projected.x + 1) / 2 * rect.width, y: rect.top + (1 - projected.y) / 2 * rect.height });
  }
  return out;
}
const screenOf = (id: number): [number, number] | null => { const hit = screenPositions().find(e => e.id === id); return hit ? [hit.x, hit.y] : null; };
function pickDrone(x: number, y: number): number | null {
  let best: number | null = null;
  let bestD2 = PICK_PX ** 2;
  for (const p of screenPositions()) { const d2 = (p.x - x) ** 2 + (p.y - y) ** 2; if (d2 < bestD2) { bestD2 = d2; best = p.id; } }
  return best;
}
/** The point under the pointer: a drone's position if one is under it, else where the ray meets the formation plane. */
function pointAt(x: number, y: number): Vec3 | null {
  const id = pickDrone(x, y);
  if (id !== null) return [...snapshots().encore.drones[id].pos];
  const rect = encoreCanvas.getBoundingClientRect();
  raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), rig.camera);
  const hit = raycaster.ray.intersectPlane(formationPlane, new Vector3());
  return hit ? [Math.round(hit.x * 10) / 10, Math.round(hit.y * 10) / 10, Math.round(hit.z * 10) / 10] : null;
}
function pickCentre(purpose: 'killRegion' | 'jam', radius: number): void {
  if (!shown.encore) { toaster.toast('Switch to Encore or Split to pick a point in the Encore stage.', 'err'); return; }
  store.state.pick?.resolve(null);
  store.set({ pick: {
    purpose, radius,
    prompt: purpose === 'killRegion' ? `Click the centre of a ${radius} m region to destroy` : `Click where to centre a ${radius} m radio jam`,
    resolve: result => {
      store.set({ pick: null, pickPoint: null });
      if (result) run(purpose === 'killRegion' ? { type: 'kill-region', radius, centre: result.point } : { type: 'jam', radius, centre: result.point });
    },
  } });
}
// A click is one primary pointer down and up within 5 px; a second pointer (pinch), a drag (orbit) or a cancel is not.
let pressed: { pointerId: number; x: number; y: number } | null = null;
let pointersDown = 0;
const onPointerDown = (e: PointerEvent) => { pointersDown++; pressed = pointersDown === 1 && e.isPrimary && e.button === 0 ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY } : null; };
const onPointerUp = (e: PointerEvent) => {
  const start = pressed?.pointerId === e.pointerId ? pressed : null;
  pressed = null;
  pointersDown = Math.max(0, pointersDown - 1);
  if (!start || e.button !== 0 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
  const pick = store.state.pick;
  if (pick) {
    // Only a real stage click answers a pick. A drone pick (inject / select) needs a drone under the pointer.
    const droneId = pickDrone(e.clientX, e.clientY);
    if ((pick.purpose === 'inject' || pick.purpose === 'select') && droneId === null) return;
    const point = pointAt(e.clientX, e.clientY);
    if (point) pick.resolve({ droneId, point });
    return;
  }
  const id = pickDrone(e.clientX, e.clientY);
  if (id !== null) controls.selectDrone(id);
  else if (store.state.selected) controls.selectDrone(null);
  refreshChrome();
};
const onPointerCancel = () => { pressed = null; pointersDown = Math.max(0, pointersDown - 1); };
const onPointerMove = (e: PointerEvent) => {
  const id = pressed ? null : pickDrone(e.clientX, e.clientY);
  stage.classList.toggle('hovering', id !== null && !store.state.pick);
  if (id !== null) {
    const d = snapshots().encore.drones[id];
    hoverLabel.hidden = false;
    Object.assign(hoverLabel.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
    hoverLabel.textContent = `#${id} · slot ${d.belief.slot} · v${d.belief.version.issuedTick}:${d.belief.version.origin}${d.belief.deaf ? ' · deaf' : ''}`;
  } else hoverLabel.hidden = true;
  const pick = store.state.pick;
  if (pick?.radius) {
    const centre = pointAt(e.clientX, e.clientY);
    const meta = pickbar.querySelector('.meta');
    if (meta) meta.textContent = centre ? `${idsInSphere(snapshots().encore, centre, pick.radius).length} live drones inside` : '';
  }
};
encoreCanvas.addEventListener('pointerdown', onPointerDown);
encoreCanvas.addEventListener('pointermove', onPointerMove);
encoreCanvas.addEventListener('pointerleave', () => { hoverLabel.hidden = true; });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerCancel);

// ---------- popovers ----------
function radioTally(arm: Arm): { drawn: number; observed: number } | null {
  const group = viewOf(arm).scene.children.find(child => child.userData.radio);
  return group ? { drawn: group.userData.radio.drawn as number, observed: group.userData.radio.observed as number } : null;
}
let lastFps: number | null = null;
const popCtx: PopoverContext = {
  store, surfaces, run,
  status: () => controls.status(),
  encore: () => snapshots().encore,
  pick: pickCentre,
  camera: preset => setCamera(preset),
  hud: () => hudModel.present(),
  series: () => worlds.series(),
  meta: () => ({ tick: worlds.tick, seed: worlds.seed, roster: params.n0, fps: lastFps, speed: transport.speed, radio: store.state.lenses.xray ? radioTally('encore') : null }),
};
const lenses = createLenses(popCtx);
const disrupt = createDisrupt(popCtx);
const metrics = createMetrics(popCtx);
const help = createHelp(popCtx);

// ---------- dock ----------
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const cycleView = () => store.set({ view: (['encore', 'split', 'static'] as const)[(['encore', 'split', 'static'].indexOf(store.state.view) + 1) % 3] });
const dock = createDock({
  play: () => run({ type: 'play' }, true),
  step: () => run({ type: 'step' }, true),
  speed: () => run({ type: 'speed', speed: SPEEDS[(SPEEDS.indexOf(transport.speed) + 1) % SPEEDS.length] }, true),
  reset: () => run({ type: 'reset', seed: worlds.seed }, true),
  compose: () => surfaces.toggle('composer'),
  disrupt: () => surfaces.toggle('disrupt'),
  lenses: () => surfaces.toggle('lenses'),
  view: v => store.set({ view: v }),
  show: () => toggleDemo(),
  console: () => surfaces.toggle('console'),
  help: () => surfaces.toggle('help'),
});
root.append(brand, readout.el, legend.el, pickbar, hoverLabel, toaster.el, hiddenHint, dock.el, lenses.el, disrupt.el, metrics.el, help.el);
surfaces.register({ id: 'lenses', kind: 'popover', el: lenses.el, anchor: () => dock.buttons.lenses, onOpen: lenses.render });
surfaces.register({ id: 'disrupt', kind: 'popover', el: disrupt.el, anchor: () => dock.buttons.disrupt, onOpen: disrupt.render });
surfaces.register({ id: 'metrics', kind: 'popover', el: metrics.el, anchor: () => readout.button, place: 'below-right', onOpen: metrics.render, focusOnOpen: () => metrics.el });
surfaces.register({ id: 'help', kind: 'popover', el: help.el, anchor: () => dock.buttons.help, onOpen: help.render });
const expanders: [string, HTMLElement][] = [['disrupt', dock.buttons.disrupt], ['lenses', dock.buttons.lenses], ['help', dock.buttons.help], ['metrics', readout.button], ['composer', dock.buttons.compose], ['console', dock.buttons.console]];
const offSurfaces = surfaces.onChange(open => { for (const [id, b] of expanders) b.setAttribute('aria-expanded', String(open.includes(id))); layoutBottom(); });
// Mounted explicitly. The demo bar (DemoScript's createDemoBar) is opt-in and not mounted here: the shell drives the
// same runner from Show / D and shows its captions above the dock.
const inspectorPanel = createInspectorPanel({ host: root });

// ---------- store reactions ----------
let hintTimer: ReturnType<typeof setTimeout> | undefined;
const offStore = store.subscribe((s, changed) => {
  if (changed.includes('lenses')) { setViewMode({ xray: s.lenses.xray, beliefColours: s.lenses.colour === 'belief' }); applyLayerLenses(); }
  if (changed.includes('view')) layoutViews(s.view);
  if (changed.includes('reducedMotion')) root.classList.toggle('reduced', s.reducedMotion);
  if (changed.includes('chromeHidden')) {
    root.classList.toggle('chrome-hidden', s.chromeHidden);
    if (s.chromeHidden) for (const id of surfaces.openIds()) surfaces.close(id, false);
    hiddenHint.style.opacity = s.chromeHidden ? '1' : '0';
    clearTimeout(hintTimer);
    if (s.chromeHidden) hintTimer = setTimeout(() => { hiddenHint.style.opacity = '0'; }, 2200);
  }
  if (changed.includes('pick')) {
    stage.classList.toggle('picking', s.pick !== null);
    pickbar.hidden = s.pick === null;
    if (s.pick) {
      const pick = s.pick;
      pickbar.replaceChildren(h('span', { class: 'reticle' }), h('span', {}, pick.prompt), h('span', { class: 'meta' }),
        h('button', { type: 'button', class: 'btn small', onclick: () => pick.resolve(null) }, 'Cancel', h('kbd', {}, 'Esc')));
    }
  }
  refreshChrome();
});
root.classList.toggle('reduced', store.state.reducedMotion);

// ---------- keyboard ----------
function setCamera(preset: CameraPreset): void { rig.preset(preset); store.set({ camera: preset }); }
function selectedLive(): number | null { const s = controls.status(); return s.selectedAlive ? s.selectedId : null; }
const unbindKeys = bindShortcuts({
  play: () => run({ type: 'play' }, true),
  step: () => run({ type: 'step' }, true),
  slower: () => run({ type: 'speed', speed: SPEEDS[Math.max(0, SPEEDS.indexOf(transport.speed) - 1)] }, true),
  faster: () => run({ type: 'speed', speed: SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(transport.speed) + 1)] }, true),
  reset: () => run({ type: 'reset', seed: worlds.seed }, true),
  'camera-audience': () => setCamera('audience'), 'camera-quarter': () => setCamera('quarter'), 'camera-top': () => setCamera('top'),
  'kill-region': () => { const id = selectedLive(); if (id !== null) run({ type: 'kill-region', radius: 8 }); else pickCentre('killRegion', 8); },
  jam: () => {
    if (snapshots().encore.jams.length > 0) run({ type: 'jam' });
    else if (selectedLive() !== null) run({ type: 'jam', radius: 12 });
    else pickCentre('jam', 12);
  },
  partition: () => run({ type: 'partition' }),
  xray: () => run({ type: 'xray' }, true),
  belief: () => run({ type: 'belief' }, true),
  ghosts: () => store.lens('ghosts', !store.state.lenses.ghosts),
  view: cycleView,
  metrics: () => surfaces.toggle('metrics'),
  hide: () => store.set({ chromeHidden: !store.state.chromeHidden }),
  help: () => surfaces.toggle('help'),
  compose: () => surfaces.toggle('composer'), inject: () => surfaces.open('composer'),
  timeline: () => surfaces.toggle('timeline'), console: () => surfaces.open('console'), demo: () => toggleDemo(),
}, () => { handleEscape(store, surfaces, () => controls.selectDrone(null)); refreshChrome(); });

// ---------- #104: the scripted demo, driven by Show and D; its captions sit above the dock ----------
// (Set up before the composer and console: connecting them updates the store, which refreshes the chrome, which reads the demo.)
const caption = h('div', { class: 'caption surface chrome', hidden: true, 'aria-live': 'polite' });
// connectDemo queries the controls while connecting, so `changed` fires before `demo` is assigned: wait for it.
let demoReady = false;
const demo = connectDemo(root, { camera: preset => setCamera(preset), changed: () => { if (demoReady) renderCaption(); } });
demoReady = true;
function toggleDemo(): void {
  if (demo.runner.state === 'running') demo.runner.stop(); else demo.runner.start();
  refreshChrome();
}
let lastCaption = '';
function renderCaption(): void {
  if (!demoReady) return;
  const runner = demo.runner;
  const running = runner.state === 'running';
  const note = running ? brainNote(demo.status(), runner.captionBeat) : '';
  const sub = running ? `Scripted show · ${Math.min(90, Math.floor(worlds.tick * DT))} s${note ? ` · ${note}` : ''}` : runner.caption ? 'Scripted show' : '';
  const key = `${runner.caption}|${sub}`;
  if (key === lastCaption) return;
  lastCaption = key;
  caption.hidden = !runner.caption;
  caption.replaceChildren(runner.caption, sub ? h('small', {}, sub) : '');
  layoutBottom();
}

// ---------- #112: the Composer panel and the Console tray (they register their own surfaces) ----------
const drafts = new Drafts();
const compose = { controller: controls, store, surfaces, drafts, params, host: root, snapshots, samples: () => worlds.samples() };
const composer = connectComposer(compose);   // also connects the stage preview to the store
const consoleTray = connectConsole({ ...compose, hooks: {
  step: () => { run({ type: 'step' }, true); },
  inspect: (id, arm) => { controls.selectDrone(id); connectInspector(inspectorSource, { arm }); },
  demo: action => {
    if (action === 'stop') { demo.runner.stop(); refreshChrome(); return 'Demo stopped.'; }
    demo.runner.start(); refreshChrome();
    return demo.runner.state === 'running' ? 'Demo running: the scripted 90-second show.' : `The demo did not start. ${demo.runner.problems.join(' ')}`.trim();
  },
} });

// ---------- #109: the Show timeline tray (T) ----------
const timeline = connectTimeline({
  getScore: () => worlds.score, getEvents: () => controls.getEventLog(), getSeries: () => worlds.series(), getTick: () => worlds.tick,
  onClose: () => surfaces.close('timeline'),
  demo: { start: () => { demo.runner.start(); refreshChrome(); }, stop: () => { demo.runner.stop(); refreshChrome(); }, isRunning: () => demo.runner.state === 'running' },
});
surfaces.register({ id: 'timeline', kind: 'tray', el: timeline.el, onOpen: () => timeline.update() });

// Trays stack above the dock (caption ▸ console ▸ timeline ▸ dock); split view shrinks to fit above them.
const dockNav = dock.el.lastElementChild!;
dock.el.insertBefore(caption, dockNav);
dock.el.insertBefore(consoleTray.el, dockNav);
dock.el.insertBefore(timeline.el, dockNav);
let layoutQueued = false;
function layoutBottom(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const top = dock.el.getBoundingClientRect().top;
    root.style.setProperty('--bottom-h', `${Math.max(82, window.innerHeight - top + 12)}px`);
    root.classList.add('has-bottom');
    const trayTop = [consoleTray.el, timeline.el].filter(el => !el.hidden).map(el => el.getBoundingClientRect().top);
    stage.style.bottom = trayTop.length ? `${Math.max(0, window.innerHeight - Math.min(...trayTop) + 8)}px` : '0';
    legend.el.style.left = surfaces.isOpen('composer') ? '384px' : '';   // beside the composer panel, never under it
    // The inspector (#102, right, from top 120 px) ends above the bottom stack, so it never covers an open tray.
    const inspector = root.querySelector<HTMLElement>('.encore-inspector');
    if (inspector) {
      inspector.style.maxHeight = `${Math.max(160, top - 120 - 12)}px`;
      inspector.style.width = 'min(336px, calc(100vw - 48px))';   // room for the vertical scrollbar, so rows never scroll sideways
    }
  });
}
window.addEventListener('resize', layoutBottom);
layoutBottom();

// ---------- #102 hooks: ghost slots in the frame, and the drone inspector ----------
/** The single place a view's LayerFrame is built. Ghost slots ride on it while their lens is on. */
function frameFor(arm: Arm, alpha: number, dtReal: number): LayerFrame {
  const frame = buffers[arm].frame(alpha, dtReal);
  // Read the observer's slot status while ghosts are on, and while a drone is selected (the inspector's
  // observer box needs it). The ghost layer itself stays hidden unless its lens is on.
  return store.state.lenses.ghosts || store.state.selected ? { ...frame, slots: slotFeeds[arm].read(frame.curr) } : frame;
}
// The inspector's agent section gets only inspect() + Belief; the observer box a pre-labelled truth object.
const inspectorSource: InspectorSource = {
  agent: (id, arm) => { const drone = snapshots()[arm].drones[id]; return drone ? { id, inspect: worlds.worlds[arm].inspect(id), belief: drone.belief } : null; },
  truth: (id, arm) => observerTruth(snapshots()[arm], slotFeeds[arm].latest(), params, id),
  select: id => { controls.selectDrone(id); },
};
connectInspector(inspectorSource);

// ---------- 4 Hz chrome refresh ----------
function ghostCounts(arm: Arm): { vacant: number; inTransit: number; contested: number; inHold: boolean } | null {
  const reading = store.state.lenses.ghosts ? slotFeeds[arm].latest() : null;
  if (!reading) return null;
  const count = (status: string) => reading.slots.status.filter(s => s === status).length;
  return { vacant: count('vacant'), inTransit: count('inTransit'), contested: count('contested'), inHold: reading.slots.inHold };
}
function feedHud(): void { hudModel.update(hudPayload(worlds, { fps: lastFps, layout: store.state.view })); }
function refreshChrome(): void {
  const samples = worlds.samples();
  const view = store.state.view;
  const snaps = snapshots();
  let phase: { inHold: boolean; name: string } | null = null;
  try {
    const now = currentMovement(worlds.score, worlds.tick);
    const recipe = now.movement.recipe;
    phase = { inHold: now.inHold, name: recipe.kind === 'text' ? `“${recipe.text}”` : recipe.kind === 'sphere' ? 'Sphere' : 'Double helix' };
  } catch { phase = null; }
  readout.update({ samples, view, n0: params.n0, phase, fps: lastFps, stopped: loopError });
  readout.el.dataset.tick = String(worlds.tick);
  dock.update({ playing: transport.playing, tick: worlds.tick, speed: transport.speed, view, stopped: loopError !== null });
  const legendArm: Arm = view === 'static' ? 'static' : 'encore';
  legend.update({
    xray: store.state.lenses.xray, belief: store.state.lenses.colour === 'belief',
    versions: samples[legendArm]?.versions ?? null, radio: radioTally(legendArm),
    deaf: snaps[legendArm].drones.filter(d => d.alive && d.belief.deaf).length, partitions: snaps[legendArm].partitions.length,
    ghosts: ghostCounts(legendArm),
  });
  const label = (name: string, desc: string, sample: MetricsSample | null) => [h('span', { class: 'name' }, name), h('span', { class: 'desc' }, desc), h('span', { class: 'num' }, `nPWC ${sample?.npwc === null || sample?.npwc === undefined ? '—' : sample.npwc.toFixed(3)}`)];
  if (view === 'split') {
    vpTop.replaceChildren(...label('▲ ENCORE', 'decentralised, self-healing', samples.encore));
    vpBottom.replaceChildren(...label('▼ STATIC', 'pre-programmed baseline · sends no radio', samples.static));
  } else if (view === 'static') vpTop.replaceChildren(...label('STATIC', 'pre-programmed baseline · sends no radio', samples.static));
  if (surfaces.isOpen('metrics')) metrics.render();
  if (surfaces.isOpen('timeline')) timeline.update();
  if (surfaces.isOpen('composer')) composer.render();
  if (demoReady) dock.buttons.show.setAttribute('aria-pressed', String(demo.runner.state === 'running'));
  renderCaption();
}

// ---------- loop ----------
let measuredTime = 0;
let measuredFrames = 0;
let lastChrome = 0;
let lastControlRefresh = 0;
let lastHudTick = -1;
let animation = 0;
feedHud();
refreshChrome();
const loop = createFrameLoop(transport, {
  advance: () => { pipeline.advance(); },
  render(alpha, dtReal, steps, now) {
    if (steps > 0 && now - lastControlRefresh >= 200) { controls.refresh(); lastControlRefresh = now; }
    const sampleTick = worlds.samples().encore?.tick ?? -1;
    if (sampleTick !== lastHudTick) { lastHudTick = sampleTick; feedHud(); }
    lastAlpha = alpha;
    rig.update();   // both views share one damped camera: update it once per frame
    for (const { arm, view } of views) if (shown[arm]) view.render(frameFor(arm, alpha, dtReal), false);
    measuredTime += dtReal;
    measuredFrames++;
    if (measuredTime >= 1) { lastFps = measuredFrames / measuredTime; measuredTime = 0; measuredFrames = 0; feedHud(); }
    if (now - lastChrome >= 250) { lastChrome = now; refreshChrome(); }
  },
  onError: report,
  request(frame) { animation = requestAnimationFrame(frame); },
}, performance.now());
animation = requestAnimationFrame(loop.frame);

// ---------- console handle for manual and automated checks (schedules only through the action API) ----------
interface EncoreDebug {
  killIds(ids: number[]): EnvEvent;
  killRegion(centre: Vec3, radius: number): EnvEvent;
  reset(seed?: number): void;
  snapshots(): Pair<WorldSnapshot>;
  alive(): Pair<number>;
  stateHashes(): Pair<string>;
  samples(): Pair<MetricsSample | null>;
  series(): Pair<readonly MetricsSample[]>;
  tick(): number;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  screenOf(id: number): [number, number] | null;
  store: Store;
}
declare global { interface Window { encore?: EncoreDebug } }
function debugEvent(result: ControlResult): EnvEvent { if (!result.ok || !result.event) throw new Error(result.message); refreshChrome(); return result.event; }
window.encore = {
  // Through the controller, like every other control, so these kills appear in its event log (and the timeline).
  killIds(ids) { return debugEvent(controls.handle({ type: 'kill-ids', ids })); },
  killRegion(centre, radius) {
    if (idsInSphere(snapshots().encore, centre, Math.max(0, radius)).length === 0) throw new Error('No live Encore drones in that region');
    return debugEvent(controls.handle({ type: 'kill-region', centre, radius }));
  },
  reset(seed = worlds.seed) { const result = controls.handle({ type: 'reset', seed }); if (!result.ok) throw new Error(result.message); },
  snapshots,
  alive: () => { const s = snapshots(); return { encore: s.encore.drones.filter(d => d.alive).length, static: s.static.drones.filter(d => d.alive).length }; },
  stateHashes: () => ({ encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() }),
  samples: () => worlds.samples(),
  series: () => worlds.series(),
  tick: () => worlds.tick,
  setPlaying,
  setSpeed,
  screenOf,
  store,
};

if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(animation);
  unbindKeys(); offStore(); offSurfaces();
  encoreCanvas.removeEventListener('pointerdown', onPointerDown);
  encoreCanvas.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  clearTimeout(hintTimer);
  controls.dispose();
  surfaces.dispose();
  toaster.dispose();
  legend.dispose();
  delete window.encore;
  connectInspector(null);
  resetViewMode();
  composer.dispose(); consoleTray.dispose(); timeline.dispose(); demo.dispose(); inspectorPanel.dispose();
  window.removeEventListener('resize', layoutBottom);
  rig.dispose();
  for (const { view } of views) view.dispose();
});
