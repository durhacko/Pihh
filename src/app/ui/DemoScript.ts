// src/app/ui/DemoScript.ts
// WP-9a (#27): the scripted 90-second demo (docs/design/experience-and-demo.md §9). A list of
// { tick, action, caption } beats. Every world change goes through the same `encore:control` intents as the
// buttons and keys (src/app/actions.ts), so the demo is never special-cased: it resets from a fixed seed and
// schedules real EnvEvents into both worlds. The panel only sends intents and reads control status.
import { DT } from '../../contracts';
import type { Recipe, Vec3 } from '../../contracts';
import type { ControlIntent, ControlResult, ControlStatus } from '../actions';
import type { CameraPreset } from '../render/CameraRig';
import { readViewMode } from '../render/colourModes/viewMode';
import { encoreBrainIsFixture } from '../worlds';
import type { PanelContext } from './index';

// --- Frozen demo inputs. Placements are measured for the app's default roster (n0 = 200) and preloaded score
// (ENCORE text, then sphere, then helix); tests/app/demo.test.ts pins them. Times are sim ticks at 1× (20 per s).
export const DEMO_SEED = 101;
export const DEMO_N0 = 200;
const SECOND = Math.round(1 / DT);
/** When each beat lands. FORMATION is the default score's movement 1 start; NEW_MOVEMENT is INJECT + scoreLead. */
export const DEMO_TICKS = Object.freeze({
  LAUNCH: 1, XRAY: 12 * SECOND, SPLIT: 16 * SECOND, KILL: 20 * SECOND, REPAIR: 21 * SECOND, FORMATION: 963,
  JAM_ON: 54 * SECOND, INJECT: 58 * SECOND, NEW_MOVEMENT: 58 * SECOND + 60, JAM_OFF: 68 * SECOND,
  FINAL: 82 * SECOND, END: 90 * SECOND,
});
/** Regional kill: the first E of ENCORE during its hold. 20 drones, 10% of n0, none from another letter. */
export const KILL_CENTRE: Vec3 = [-35, 30.4, 0];
export const KILL_RADIUS = 6;
/** Jam: the upper third of the sphere (y ≥ 33). */
export const JAM_CENTRE: Vec3 = [0, 39, 0];
export const JAM_RADIUS = 6;
/** Score injection target: holds the lowest sphere slot, far from the jam; flew in the last E, far from the kill. */
export const INJECT_DRONE = 151;
export const INJECT_RECIPE: Recipe = { kind: 'helix' };
/** Timed world events are sent this many ticks early with an explicit `at`, so they land on their exact tick
 * although the panel only hears control status a few times a second. */
export const LEAD_TICKS = 3 * SECOND;

export type DemoAction =
  | { kind: 'control'; intent: ControlIntent }
  | { kind: 'camera'; preset: CameraPreset }
  | { kind: 'view'; xray: boolean; beliefColours: boolean };
/** An empty caption keeps the one on screen. */
export interface DemoBeat { id: string; tick: number; action: DemoAction | null; caption: string }

const T = DEMO_TICKS;
const control = (intent: ControlIntent): DemoAction => ({ kind: 'control', intent });
export const DEMO_BEATS: readonly DemoBeat[] = [
  { id: 'launch', tick: T.LAUNCH, action: { kind: 'camera', preset: 'audience' }, caption: '200 drones, no central controller: each one decides for itself, flying a preloaded score on a shared clock.' },
  { id: 'xray', tick: T.XRAY, action: { kind: 'view', xray: true, beliefColours: false }, caption: 'X-ray on. Each line is a real heartbeat from the radio log, sampled. The static baseline sends none.' },
  { id: 'split', tick: T.SPLIT, action: null, caption: 'With ?split=1, the static baseline flies below: same seed, same physics, same failures, no radio.' },
  { id: 'kill', tick: T.KILL, action: control({ type: 'kill-region', centre: KILL_CENTRE, radius: KILL_RADIUS, at: T.KILL }), caption: 'Knock out part of one letter in both worlds: about 10% of the swarm, the same drones on the same tick.' },
  { id: 'repair', tick: T.REPAIR, action: null, caption: 'Encore arm: neighbours sense the gap, claim its most important slots by heartbeat, and the letter refills from its rim. Static arm: the hole stays.' },
  { id: 'formation', tick: T.FORMATION, action: null, caption: 'Next movement: the survivors re-form as a sphere without a single message, by the shared clock.' },
  { id: 'jam', tick: T.JAM_ON, action: control({ type: 'jam', centre: JAM_CENTRE, radius: JAM_RADIUS, at: T.JAM_ON }), caption: 'Jam the radio over the top of the formation: nothing in or out. Encore arm: drones inside turn deaf and keep flying their score.' },
  { id: 'belief', tick: T.JAM_ON, action: { kind: 'view', xray: true, beliefColours: true }, caption: '' },
  { id: 'select', tick: T.JAM_ON, action: control({ type: 'select', id: INJECT_DRONE }), caption: '' },
  { id: 'inject', tick: T.INJECT, action: control({ type: 'inject', recipe: INJECT_RECIPE, at: T.INJECT }), caption: 'A new score, a helix, goes to one drone below the jam. Encore arm: it spreads along real SCORE messages, and the jam stops it at the cap.' },
  { id: 'slow', tick: T.INJECT, action: control({ type: 'speed', speed: 0.5 }), caption: '' },
  { id: 'new-movement', tick: T.NEW_MOVEMENT, action: control({ type: 'speed', speed: 1 }), caption: 'The new movement starts. Encore drones that heard it fly the helix; drones still cut off keep the old score. Static arm: sphere.' },
  { id: 'jam-off', tick: T.JAM_OFF, action: control({ type: 'jam', at: T.JAM_OFF }), caption: 'Jam off. Encore arm: the new score crosses into the drones that were cut off, and they join it by the clock.' },
  { id: 'final-view', tick: T.FINAL, action: { kind: 'view', xray: false, beliefColours: false }, caption: 'Audience view. Every number in the HUD comes from the observer: same seed, same failures in both arms.' },
  { id: 'final', tick: T.FINAL, action: { kind: 'camera', preset: 'audience' }, caption: '' },
  { id: 'end', tick: T.END, action: null, caption: 'End of the 90-second demo. Press D to run it again.' },
];
/** Beats whose caption describes what only the Encore brain shows. Check these once #16 is swapped in. */
export const BRAIN_DEPENDENT_BEATS: readonly string[] = ['xray', 'repair', 'jam', 'inject', 'new-movement', 'jam-off'];

/** When the runner sends a beat's action: timed world events LEAD_TICKS early, everything else on its tick. */
export function dispatchTick(beat: DemoBeat): number {
  const timed = beat.action?.kind === 'control' && 'at' in beat.action.intent && beat.action.intent.at !== undefined;
  return timed ? beat.tick - LEAD_TICKS : beat.tick;
}

export interface DemoHost {
  /** Sends an intent exactly as a button would. The DOM panel cannot see the result, so it returns nothing. */
  send(intent: ControlIntent): ControlResult | void;
  /** The newest control status, or undefined before the controls connect. */
  status(): ControlStatus | undefined;
  view(): { xray: boolean; beliefColours: boolean };
  camera(preset: CameraPreset): void;
  /** Called whenever the runner's state, beat or caption changes. */
  changed(): void;
}
export type DemoState = 'idle' | 'running' | 'stopped' | 'finished';

/** The demo's clock: pure, driven by control status, so a test can run it headless against the real controller. */
export function createDemoRunner(host: DemoHost, beats: readonly DemoBeat[] = DEMO_BEATS) {
  let state: DemoState = 'idle';
  let next = 0;          // the next beat whose action is due
  let nextCaption = 0;   // the next beat whose caption is due
  let lastTick = 0;
  let caption = '';
  let beat: DemoBeat | null = null;
  let captionBeat: DemoBeat | null = null;   // the beat whose caption is on screen
  let busy = false;
  const problems: string[] = [];

  function run(action: DemoAction, tick: number, late: boolean) {
    if (action.kind === 'camera') { host.camera(action.preset); return; }
    if (action.kind === 'view') {
      if (host.view().xray !== action.xray) host.send({ type: 'xray' });
      if (host.view().beliefColours !== action.beliefColours) host.send({ type: 'belief' });
      return;
    }
    let intent = action.intent;
    if (late && 'at' in intent) {
      // Its exact tick has passed (the show stalled or ran fast): land it next tick and say this run is off-script.
      intent = { ...intent, at: undefined };
      problems.push(`${beat?.id ?? 'beat'} was due at tick ${('at' in action.intent && action.intent.at) || '?'} but was sent at tick ${tick}.`);
    }
    const result = host.send(intent);
    if (result && !result.ok) problems.push(`${beat?.id ?? 'beat'}: ${result.message}`);
  }

  function poll(): void {
    if (busy || state !== 'running') return;   // intents re-emit status synchronously; ignore that echo
    const status = host.status();
    if (!status?.available || status.tick === undefined) return;
    const tick = status.tick;
    if (tick < lastTick) { stop('The show was reset outside the demo, so the demo stopped.'); return; }
    lastTick = tick;
    busy = true;
    let changed = false;
    try {
      // Actions go out at their dispatch tick (timed world events LEAD_TICKS early, with an exact `at`)...
      while (state === 'running' && next < beats.length && tick >= dispatchTick(beats[next])) {
        beat = beats[next++];
        if (beat.action) run(beat.action, tick, dispatchTick(beat) < beat.tick && tick >= beat.tick);
        changed = true;
      }
      // ...but a caption only appears once its beat's tick is reached, so it never announces what has not happened.
      while (state === 'running' && nextCaption < beats.length && tick >= beats[nextCaption].tick) {
        const shown = beats[nextCaption++];
        if (shown.caption) { caption = shown.caption; captionBeat = shown; }
        changed = true;
      }
      if (state === 'running' && next === beats.length && nextCaption === beats.length) state = 'finished';
    } finally { busy = false; }
    if (changed) host.changed();
  }

  function start(): boolean {
    const before = host.status();
    if (!before?.available) { problems.push('Simulation controls are not connected.'); host.changed(); return false; }
    busy = true;
    try {
      problems.length = 0; next = 0; nextCaption = 0; beat = null; captionBeat = null; caption = '';
      host.send({ type: 'reset', seed: DEMO_SEED });
      host.send({ type: 'speed', speed: 1 });
      if (!host.status()?.playing) host.send({ type: 'play' });
      lastTick = 0;   // the demo's own reset: status ticks restart from 1
      state = 'running';
    } finally { busy = false; }
    poll();
    host.changed();
    return true;
  }

  function stop(reason = 'Demo stopped.'): void {
    if (state !== 'running') return;
    state = 'stopped'; caption = reason; beat = null; captionBeat = null;
    host.changed();
  }

  return {
    start, stop, poll,
    restart() { stop(); return start(); },
    get state() { return state; },
    get caption() { return caption; },
    get beat() { return beat; },
    get captionBeat() { return captionBeat; },
    get problems(): readonly string[] { return [...problems]; },
  };
}

/** The bar: Run / Stop, Restart, the D key, progress and the caption overlay. */
export function createPanel({ host }: PanelContext) {
  const panel = document.createElement('aside');
  panel.className = 'encore-demo';
  panel.setAttribute('aria-label', 'Scripted demo');
  panel.innerHTML = `<style>
    .encore-demo{position:absolute;left:360px;right:250px;bottom:6px;max-width:900px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 16px;align-items:center;padding:8px 12px;border:1px solid #24404f;border-radius:10px;background:#06121de8;box-shadow:0 15px 40px #0005;color:#c4d9e2;font:12px system-ui;z-index:3}
    .encore-demo h2{font-size:11px;letter-spacing:.15em;color:#87adbe;margin:0;font-weight:600}.encore-demo .row{display:flex;gap:7px;margin-top:6px}
    .encore-demo button{font:inherit;background:#102633;border:1px solid #2a4757;border-radius:5px;padding:6px 10px;color:#d2e7ef;cursor:pointer}.encore-demo button:hover:not(:disabled){background:#1b3d4d}.encore-demo :disabled{opacity:.38;cursor:not-allowed}.encore-demo :focus-visible{outline:2px solid #71d5dd;outline-offset:2px}.encore-demo kbd{font:10px system-ui;opacity:.55;margin-left:4px}
    .encore-demo .progress{font-size:11px;letter-spacing:0;font-weight:400;color:#7896a6;font-variant-numeric:tabular-nums;margin-left:8px}.encore-demo .caption{font-size:13px;line-height:1.4;color:#dcebf2;margin:0}.encore-demo [data-caption]:empty::before{content:'Press D to run the scripted 90-second demo from seed ${DEMO_SEED}.';color:#7896a6}.encore-demo .note{font-size:11px;color:#e7b677;margin-left:6px}.encore-demo output{display:block;color:#93b4c2;font-size:11px;line-height:1.5;margin-top:4px}.encore-demo output:empty{display:none}
    @media(max-width:1100px){.encore-demo{left:auto;right:20px;bottom:auto;top:120px;width:min(440px,calc(100vw - 330px));grid-template-columns:1fr;gap:8px}}
  </style><div><h2>SCRIPTED DEMO · 90 S<span class="progress" data-progress></span></h2><div class="row"><button data-demo="toggle">Run demo <kbd>D</kbd></button><button data-demo="restart" disabled>Restart</button></div></div>
  <div><p class="caption" aria-live="polite"><span data-caption></span><span class="note" data-note hidden></span></p><output role="status" data-status></output></div>`;
  host.append(panel);
  const toggle = panel.querySelector<HTMLButtonElement>('[data-demo=toggle]')!;
  const restart = panel.querySelector<HTMLButtonElement>('[data-demo=restart]')!;
  const captionEl = panel.querySelector<HTMLElement>('[data-caption]')!;
  const note = panel.querySelector<HTMLElement>('[data-note]')!;
  const progress = panel.querySelector<HTMLElement>('[data-progress]')!;
  const output = panel.querySelector<HTMLOutputElement>('[data-status]')!;
  let status: ControlStatus | undefined;

  const runner = createDemoRunner({
    send: intent => { host.dispatchEvent(new CustomEvent('encore:control', { detail: intent })); },
    status: () => status,
    view: () => readViewMode(),
    // The camera presets are page buttons (main.ts); press the same one a person would.
    camera: preset => host.querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click(),
    changed: render,
  });

  const seconds = () => `${Math.min(90, Math.floor((status?.tick ?? 0) / SECOND))} s / 90 s`;
  function render() {
    const running = runner.state === 'running';
    toggle.innerHTML = running ? 'Stop demo <kbd>D</kbd>' : 'Run demo <kbd>D</kbd>';
    restart.disabled = runner.state === 'idle';
    toggle.disabled = !status?.available;
    captionEl.textContent = runner.caption;
    const brainNote = encoreBrainIsFixture && running && runner.captionBeat && BRAIN_DEPENDENT_BEATS.includes(runner.captionBeat.id);
    note.hidden = !brainNote;
    note.textContent = brainNote ? 'Static brain in both arms: no difference shows yet.' : '';
    progress.textContent = running ? seconds() : '';
    output.textContent = runner.problems.join(' ');
  }
  function onStatus(event: Event) {
    status = (event as CustomEvent<ControlStatus>).detail;
    runner.poll();
    if (runner.state === 'running') progress.textContent = seconds();
    toggle.disabled = !status.available;
  }
  const onToggle = () => { if (runner.state === 'running') runner.stop(); else runner.start(); };
  const onRestart = () => { runner.restart(); };
  function onKey(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'd') return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    event.preventDefault();
    onToggle();
  }
  toggle.addEventListener('click', onToggle);
  restart.addEventListener('click', onRestart);
  host.addEventListener('encore:control-status', onStatus);
  window.addEventListener('keydown', onKey);
  host.dispatchEvent(new Event('encore:control-query'));
  render();
  return {
    dispose() {
      runner.stop();
      toggle.removeEventListener('click', onToggle); restart.removeEventListener('click', onRestart);
      host.removeEventListener('encore:control-status', onStatus); window.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}
