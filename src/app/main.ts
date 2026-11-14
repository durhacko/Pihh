import { DT } from '../contracts';
import type { EnvEvent, MetricsSample, Vec3, WorldSnapshot } from '../contracts';
import { bindControls } from './actions';
import { CameraRig, type CameraPreset } from './render/CameraRig';
import { SnapshotBuffer } from './render/SnapshotBuffer';
import { WorldView } from './render/WorldView';
import { createPanels } from './ui';
import { ARMS, controlContext, createWorlds, encoreBrainIsFixture, idsInRegion, killEvent, type Arm, type Pair } from './worlds';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing app root');
if (import.meta.env.VITE_SIM_MODE === 'false') throw new Error('Encore supports simulation mode only');

// URL options: ?seed=<uint32> (default 1), ?arm=static shows the static world in the single view,
// ?split=1 builds a second view for the static world below the Encore one (the real split view is #24).
const query = new URLSearchParams(window.location.search);
const requestedSeed = Number(query.get('seed') ?? 1);
const initialSeed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0xffffffff ? requestedSeed : 1;
const split = query.get('split') === '1';
const shownArm: Arm = query.get('arm') === 'static' ? 'static' : 'encore';

app.innerHTML = `<div class="airspace"></div>
  <header class="masthead"><div><p class="brand">ENCORE / AIRSPACE</p><h1 class="title">A composition of independent minds.</h1><p class="caption">Live simulation · Encore and static worlds in lockstep · seed <span class="seed"></span><br>${encoreBrainIsFixture ? 'Encore brain not merged yet: both arms fly the static baseline.' : 'Encore brain in the Encore arm, static baseline in the other.'}</p></div><span class="preview-badge">${encoreBrainIsFixture ? 'STATIC BRAIN IN BOTH ARMS' : 'LIVE SIMULATION'}</span></header>
  <p class="help">Drag to orbit · right-drag to pan · scroll to zoom</p>
  <nav class="view-controls" aria-label="Camera presets"><button data-preset="audience" aria-pressed="true">1 Audience</button><button data-preset="quarter" aria-pressed="false">2 Three-quarter</button><button data-preset="top" aria-pressed="false">3 Top</button></nav>
  <output class="frame-readout" aria-live="off"></output>`;

const host = app.querySelector<HTMLElement>('.airspace')!;
const readout = app.querySelector<HTMLOutputElement>('.frame-readout')!;
const seedLabel = app.querySelector<HTMLElement>('.seed')!;

// The only place the app holds worlds. It changes them only through stepBoth / scheduleBoth / reset.
const worlds = createWorlds({ seed: initialSeed });
const params = worlds.params;
const transport = { playing: true, speed: 1 };
const first = worlds.stepBoth();
const buffers: Pair<SnapshotBuffer> = { encore: new SnapshotBuffer(first.encore), static: new SnapshotBuffer(first.static) };
seedLabel.textContent = String(worlds.seed);

/** A per-tick evidence hook a view may grow (issue #46). Called defensively; WorldView does not have it yet. */
type IngestingView = WorldView & { ingest?: (snapshot: WorldSnapshot) => void };
interface MountedView { arm: Arm; view: IngestingView }

const rig = new CameraRig();
const views: MountedView[] = [];
try {
  if (split) {
    // Two stacked panes sharing one camera. Inline styles only: style.css belongs to the render/UI lane.
    host.innerHTML = ARMS.map((arm, i) => `<div data-arm="${arm}" style="position:absolute;left:0;right:0;top:${i * 50}%;height:50%"><span style="position:absolute;top:8px;right:12px;font-size:10px;letter-spacing:.2em;color:#80b8c7;pointer-events:none">${arm.toUpperCase()}</span></div>`).join('');
    for (const arm of ARMS) views.push({ arm, view: new WorldView(host.querySelector<HTMLElement>(`[data-arm="${arm}"]`)!, params, rig) });
    rig.attach(host);
  } else {
    views.push({ arm: shownArm, view: new WorldView(host, params, rig) });
    rig.attach(views[0].view.renderer.domElement);
  }
} catch (error) {
  for (const { view } of views) view.dispose();
  host.innerHTML = '<p class="error">WebGL could not start. Enable browser graphics acceleration and reload.</p>';
  throw error;
}
for (const { arm, view } of views) view.ingest?.(first[arm]);
const panels = createPanels({ host: app });

/** One simulation tick for both worlds; every view sees every tick's snapshot, not only the drawn ones. */
function advance(): Pair<WorldSnapshot> {
  const snapshots = worlds.stepBoth();
  for (const arm of ARMS) buffers[arm].push(snapshots[arm]);
  for (const { arm, view } of views) view.ingest?.(snapshots[arm]);
  return snapshots;
}

// The control binder (if any) only re-sends its status after an intent; the simulation moving on (a drone
// dying at the tick its KILL lands, a reset or pause from the console) must push a fresh one too.
let refreshControls = (): void => {};

function reset(seed: number): void {
  worlds.reset(seed);
  advance();
  seedLabel.textContent = String(worlds.seed);
  refreshControls();
}

function setSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed <= 0 || speed > 8) throw new RangeError('Speed must be in (0, 8]');
  transport.speed = speed;
  refreshControls();
}

function setPlaying(playing: boolean): void {
  transport.playing = playing;
  refreshControls();
}

function current(): Pair<WorldSnapshot> {
  return worlds.latest() ?? advance();
}

/** Resolve once from the Encore world, then schedule the same explicit KILL into both worlds. */
function scheduleKill(ids: readonly number[]): EnvEvent {
  const event = killEvent(worlds, ids);
  worlds.scheduleBoth(event);
  return structuredClone(event);
}

// --- Controls (#22). The binder resolves each intent once and schedules the same event into both worlds.
const controls = bindControls(app, controlContext(worlds, {
  getSnapshots: current,
  getTransport: () => ({ ...transport, seed: worlds.seed }),
  setPlaying,
  setSpeed,
  reset,
}));
refreshControls = () => controls.refresh();

// --- Console handle for manual checks. Only schedules KILL events, steps or resets; never edits a drone.
interface EncoreDebug {
  killIds(ids: number[]): EnvEvent;
  killRegion(centre: Vec3, radius: number): EnvEvent;
  reset(seed?: number): void;
  snapshots(): Pair<WorldSnapshot>;
  alive(): Pair<number>;
  stateHashes(): Pair<string>;
  /** Newest observer MetricsSample per world (every 5 ticks); the HUD is #24. */
  samples(): Pair<MetricsSample | null>;
  series(): Pair<readonly MetricsSample[]>;
  tick(): number;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
}
declare global { interface Window { encore?: EncoreDebug } }
window.encore = {
  killIds: ids => scheduleKill(ids),
  killRegion(centre, radius) {
    const ids = idsInRegion(current().encore, centre, radius);
    if (ids.length === 0) throw new Error('No live Encore drones in that region');
    return scheduleKill(ids);
  },
  reset: (seed = worlds.seed) => reset(seed),
  snapshots: current,
  alive: () => { const s = current(); return { encore: s.encore.drones.filter(d => d.alive).length, static: s.static.drones.filter(d => d.alive).length }; },
  stateHashes: () => ({ encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() }),
  samples: () => worlds.samples(),
  series: () => worlds.series(),
  tick: () => worlds.tick,
  setPlaying,
  setSpeed,
};

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
let lastControlRefresh = 0;
function draw(now: number) {
  const dtReal = Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  if (transport.playing) accumulator += Math.min(dtReal, 0.1) * transport.speed;
  let steps = 0;
  while (accumulator >= DT && steps < 5) { advance(); accumulator -= DT; steps++; }
  if (steps === 5) accumulator = Math.min(accumulator, DT);   // fell behind: drop the backlog, never fake ticks
  if (steps > 0 && now - lastControlRefresh >= 200) { refreshControls(); lastControlRefresh = now; }   // ≤ 5 Hz
  for (const { arm, view } of views) view.render(buffers[arm].frame(accumulator / DT, dtReal));
  measuredTime += dtReal;
  measuredFrames++;
  if (measuredTime >= 1) {
    const snapshots = current();
    const alive = { encore: snapshots.encore.drones.filter(d => d.alive).length, static: snapshots.static.drones.filter(d => d.alive).length };
    const fps = measuredFrames / measuredTime;
    readout.dataset.fps = fps.toFixed(1);
    readout.dataset.tick = String(snapshots.encore.tick);
    readout.dataset.visible = String(alive[views[0].arm]);
    readout.dataset.aliveEncore = String(alive.encore);
    readout.dataset.aliveStatic = String(alive.static);
    readout.textContent = `encore ${alive.encore} / static ${alive.static} alive of ${params.n0}${split ? '' : ` · showing ${views[0].arm}`}\n${fps.toFixed(0)} rendered fps · tick ${snapshots.encore.tick}${transport.playing ? '' : ' · paused'}`;
    measuredTime = 0;
    measuredFrames = 0;
  }
  animation = requestAnimationFrame(draw);
}
animation = requestAnimationFrame(draw);

if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(animation);
  window.removeEventListener('keydown', onKey);
  controls.dispose();
  delete window.encore;
  for (const panel of panels) panel.dispose();
  rig.dispose();
  for (const { view } of views) view.dispose();
});
