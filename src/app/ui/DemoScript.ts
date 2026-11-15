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
import { cascadeOptIn } from '../render/layers/CascadeLayer';
import { parseQuality } from '../render/quality';
import type { PanelContext } from './index';

// --- Frozen demo inputs. Placements are measured for the app's default roster (n0 = 200) and preloaded score
// (ENCORE text, then sphere, then helix); tests/app/demo.test.ts checks them. Times are sim ticks at 1× (20 per s).
export const DEMO_SEED = 101;
export const DEMO_N0 = 200;
const SECOND = Math.round(1 / DT);
/**
 * When each beat lands. FORMATION is the default score's movement 1 start; NEW_MOVEMENT is INJECT + scoreLead.
 * REPAIR is measured (seed 101, Encore brain, this script's events): the first claim heartbeat goes out at tick 455,
 * the first slot commit is at 475, and the observer sees the first vacated slot occupied at 495 (7 of 20 by 505).
 * nPWC dips to 0.921 at 490 while the claimers leave their own slots, then 0.958 at 505 and 0.972 from 675; the
 * static arm stays at 0.931. So the caption lands at 23 s, just after the first claim, and the repair beat turns
 * X-ray off (it dims the show to 25%) so the hole and its refill show; the jam beat turns it back on.
 * With paced steering targets (#96) the swarm arrives on the sphere about 60 ticks before its hold: every live drone
 * is within rOcc of its own target from tick 1216 (measured, seed 101, either brain). The jam therefore starts at
 * 61 s, on the formed sphere, so it covers a cap of it rather than whoever is passing through mid-flight.
 */
export const DEMO_TICKS = Object.freeze({
  LAUNCH: 1, XRAY: 12 * SECOND, SPLIT: 16 * SECOND, KILL: 20 * SECOND, REPAIR: 23 * SECOND, FORMATION: 963,
  JAM_ON: 61 * SECOND, INJECT: 64 * SECOND, NEW_MOVEMENT: 64 * SECOND + 60, JAM_OFF: 73 * SECOND,
  FINAL: 82 * SECOND, END: 90 * SECOND,
});
/** Regional kill: half of the first E of ENCORE, during its hold. 20 drones (10% of n0), none from another letter. */
export const KILL_CENTRE: Vec3 = [-35, 30.4, 0];
export const KILL_RADIUS = 6;
/** Jam: the top cap of the formed sphere (it reaches down to y = 33 on the axis; 18 of 180 live drones at JAM_ON). */
export const JAM_CENTRE: Vec3 = [0, 39, 0];
export const JAM_RADIUS = 6;
/** Score injection target: near the bottom of the sphere (slot y ≈ 21), far below the jam; in the last E during
 * the text, far from the kill. */
export const INJECT_DRONE = 151;
export const INJECT_RECIPE: Recipe = { kind: 'helix' };
/** Timed world events are sent this many ticks early with an explicit `at`, so they land on their exact tick
 * although the panel only hears control status a few times a second. */
export const LEAD_TICKS = 3 * SECOND;

export type DemoAction =
  | { kind: 'control'; intent: ControlIntent }
  | { kind: 'camera'; preset: CameraPreset }
  | { kind: 'view'; xray: boolean; beliefColours: boolean }
  /** Which world(s) the stage shows (#92 shell: Encore · Split · Static). A page without that control ignores it. */
  | { kind: 'layout'; view: 'encore' | 'split' | 'static' };
/** An empty caption keeps the one on screen. */
export interface DemoBeat { id: string; tick: number; action: DemoAction | null; caption: string }

const T = DEMO_TICKS;
const control = (intent: ControlIntent): DemoAction => ({ kind: 'control', intent });
export const DEMO_BEATS: readonly DemoBeat[] = [
  { id: 'launch', tick: T.LAUNCH, action: { kind: 'camera', preset: 'audience' }, caption: '200 drones and no central controller: each flies a preloaded score on a shared clock, steering by what it senses nearby.' },
  { id: 'xray', tick: T.XRAY, action: { kind: 'view', xray: true, beliefColours: false }, caption: 'X-ray on. Each line is a real heartbeat from the radio log, sampled. The static baseline sends none.' },
  { id: 'split', tick: T.SPLIT, action: { kind: 'layout', view: 'split' }, caption: 'In split view, the static baseline flies below: same seed, same physics, same failures, no radio.' },
  { id: 'kill', tick: T.KILL, action: control({ type: 'kill-region', centre: KILL_CENTRE, radius: KILL_RADIUS, at: T.KILL }), caption: 'Knock out part of one letter in both worlds: about 10% of the swarm, the same drones on the same tick.' },
  { id: 'repair', tick: T.REPAIR, action: { kind: 'view', xray: false, beliefColours: false }, caption: 'Encore arm: neighbours sense the gap and claim its most important slots by heartbeat, so part of the hole refills from its rim. Static baseline: the hole stays.' },
  { id: 'formation', tick: T.FORMATION, action: null, caption: 'Next movement: the survivors re-form as a sphere by the shared clock; no message is needed to do it.' },
  { id: 'jam', tick: T.JAM_ON, action: control({ type: 'jam', centre: JAM_CENTRE, radius: JAM_RADIUS, at: T.JAM_ON }), caption: 'Jam the radio over the top of the formation: nothing in or out. Encore arm: drones inside turn deaf and keep flying their score.' },
  { id: 'belief', tick: T.JAM_ON, action: { kind: 'view', xray: true, beliefColours: true }, caption: '' },
  { id: 'select', tick: T.JAM_ON, action: control({ type: 'select', id: INJECT_DRONE }), caption: '' },
  // Selected again in the same poll that sends the injection, so a presenter's click since 54 s cannot retarget it.
  { id: 'target', tick: T.INJECT - LEAD_TICKS, action: control({ type: 'select', id: INJECT_DRONE }), caption: '' },
  { id: 'inject', tick: T.INJECT, action: control({ type: 'inject', recipe: INJECT_RECIPE, at: T.INJECT }), caption: 'A new score, a helix, goes to one drone below the jam. Encore arm: it spreads along real SCORE messages, and the jam stops it at the cap.' },
  // The injection's target was fixed when it was sent (LEAD_TICKS early), so deselect as it lands: with a drone
  // selected X-ray draws only that drone's links, and the spread (and later the jam-off crossing) would not show (#134).
  { id: 'deselect', tick: T.INJECT, action: control({ type: 'select', id: null }), caption: '' },
  { id: 'slow', tick: T.INJECT, action: control({ type: 'speed', speed: 0.5 }), caption: '' },
  { id: 'new-movement', tick: T.NEW_MOVEMENT, action: control({ type: 'speed', speed: 1 }), caption: 'The new movement starts. Encore drones that heard it fly the helix; drones still cut off keep the old score. Static baseline: sphere. The Encore headline dips while that arm flies to the new formation.' },
  { id: 'jam-off', tick: T.JAM_OFF, action: control({ type: 'jam', at: T.JAM_OFF }), caption: 'Jam off. Encore arm: the new score crosses into the drones that were cut off, and they join it by the clock.' },
  { id: 'final-layout', tick: T.FINAL, action: { kind: 'layout', view: 'split' }, caption: '' },
  { id: 'final-view', tick: T.FINAL, action: { kind: 'view', xray: false, beliefColours: false }, caption: 'Audience view, still split: the observer measures each arm against its own formation (Encore: the injected helix; static: its preloaded sphere), so the readout marks the two as not comparable. Same seed, same failures.' },
  { id: 'final', tick: T.FINAL, action: { kind: 'camera', preset: 'audience' }, caption: '' },
  { id: 'end', tick: T.END, action: null, caption: 'End of the 90-second demo. Press D to run it again.' },
];
/**
 * Opt-in cascade trail (#232, P2-WP-03; ?p2=cascade, PHASE2_WORK_PACKAGES §2.1). The trail layer draws only in X-ray,
 * and the default script turns X-ray off at the repair beat, so with the flag the demo would show no arrow. With the
 * flag only, the repair beat keeps X-ray on and `trail-off` turns it off once the measured arrows have faded; the
 * jam beat turns it back on as before. Nothing else changes: same world events, same ticks, same other captions.
 * Measured (seed 101, Encore brain, this script, layer opted in; tests/app/demo.test.ts): 18 observed slot changes;
 * between the repair beat and the jam, arrows are drawn on 298 ticks, from 491 to 788 (the last one fades by 788).
 * So TRAIL_OFF, at 45 s (tick 900), shows every one of them and leaves X-ray off again before the next movement.
 */
export const TRAIL_OFF = 45 * SECOND;
/** Two lines, like the caption it replaces: the arrows are the refill, so they replace "part of the hole refills". */
export const REPAIR_TRAIL_CAPTION = 'Encore arm: neighbours sense the gap and claim its most important slots by heartbeat; each green arrow is one observed slot change. Static baseline: the hole stays.';

/** The demo's beats: exactly DEMO_BEATS (the same array) without the cascade flag. */
export function demoBeatsFor(options: { cascade: boolean }): readonly DemoBeat[] {
  if (!options.cascade) return DEMO_BEATS;
  return DEMO_BEATS.flatMap(beat => beat.id !== 'repair' ? [beat] : [
    { ...beat, action: { kind: 'view', xray: true, beliefColours: false }, caption: REPAIR_TRAIL_CAPTION },
    { id: 'trail-off', tick: TRAIL_OFF, action: { kind: 'view', xray: false, beliefColours: false }, caption: '' },
  ]);
}

/**
 * The beats for this page: the URL is read once per call (off when there is no location, as in node). A forced render
 * quality above 0 (?q=low, ?q=1..4) hides the trail layer (WP §2.4), so the flag then keeps today's script rather than
 * an X-ray view whose caption promises arrows that are never drawn. An automatic step-down during the show cannot be
 * known here: the rehearsal confirms the level stays at 0 (storyboard §1).
 */
export function activeDemoBeats(): readonly DemoBeat[] {
  const search = typeof location !== 'undefined' ? location.search : '';
  return demoBeatsFor({ cascade: cascadeOptIn(search) && parseQuality(search).level === 0 });
}

/** Beats whose caption describes what only the Encore brain shows. While the live Encore world flies another brain
 * (status.brains, the HUD's brainKinds source), the bar marks them; with the Encore brain in the app (#107) the mark
 * goes by itself, and these beats are the ones to re-check on screen. */
export const BRAIN_DEPENDENT_BEATS: readonly string[] = ['xray', 'repair', 'jam', 'inject', 'new-movement', 'jam-off', 'final-view'];

/**
 * The note under an Encore-only caption, from the brains the live worlds actually fly (status.brains, the same
 * config.brain.kind the HUD's brainKinds reports): empty when the Encore world flies the Encore brain, or when the
 * caption on screen is not an Encore-only one.
 */
export function brainNote(status: Pick<ControlStatus, 'brains'> | undefined, captionBeat: DemoBeat | null): string {
  if (!captionBeat || !BRAIN_DEPENDENT_BEATS.includes(captionBeat.id) || !status?.brains || status.brains.encore === 'encore') return '';
  return status.brains.static === 'static' ? 'Static brain in both arms: no difference shows yet.' : 'The Encore arm is not flying the Encore brain: no difference shows yet.';
}

/** When the runner sends a beat's action: timed world events LEAD_TICKS early, everything else on its tick. */
export function dispatchTick(beat: DemoBeat): number {
  const timed = beat.action?.kind === 'control' && 'at' in beat.action.intent && beat.action.intent.at !== undefined;
  return timed ? beat.tick - LEAD_TICKS : beat.tick;
}

/** The overlays the script has set by `tick`: its clean show starts with both off, then each view beat due by then. */
export function demoViewAt(tick: number, beats: readonly DemoBeat[] = DEMO_BEATS): { xray: boolean; beliefColours: boolean } {
  let view = { xray: false, beliefColours: false };
  for (const beat of beats) if (beat.action?.kind === 'view' && dispatchTick(beat) <= tick) view = { xray: beat.action.xray, beliefColours: beat.action.beliefColours };
  return view;
}

export interface DemoHost {
  /** Sends an intent exactly as a button would; returns its result when the transport reports one. */
  send(intent: ControlIntent): ControlResult | void;
  /** The newest control status, or undefined before the controls connect. */
  status(): ControlStatus | undefined;
  view(): { xray: boolean; beliefColours: boolean };
  camera(preset: CameraPreset): void;
  /** Sets the stage layout (#92). Optional: a host without layouts ignores 'layout' beats. */
  layout?(view: 'encore' | 'split' | 'static'): void;
  /** Sets the tethers lens (#134). The clean show turns it off: with X-ray on, tethers would read as radio. */
  tethers?(on: boolean): void;
  /** Called whenever the runner's state or caption changes. */
  changed(): void;
}
export type DemoState = 'idle' | 'running' | 'stopped' | 'finished';
const beatName = (beat: DemoBeat | null) => `The ${beat ? beat.id.replace('-', ' ') : 'demo'} step`;

/** The demo's clock: driven only by control status, so a test can run it headless against the real controls. */
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

  function setView(xray: boolean, beliefColours: boolean) {
    if (host.view().xray !== xray) host.send({ type: 'xray' });
    if (host.view().beliefColours !== beliefColours) host.send({ type: 'belief' });
  }
  function run(action: DemoAction, tick: number, late: boolean) {
    if (action.kind === 'camera') { host.camera(action.preset); return; }
    if (action.kind === 'view') { setView(action.xray, action.beliefColours); return; }
    if (action.kind === 'layout') { host.layout?.(action.view); return; }
    let intent = action.intent;
    if (late && 'at' in intent) {
      // Its exact tick has passed (the show stalled or ran fast): land it next tick and say this run is off-script.
      intent = { ...intent, at: undefined };
      problems.push(`${beatName(beat)} was due at ${((beat?.tick ?? 0) / SECOND).toFixed(1)} s but went out at ${(tick / SECOND).toFixed(1)} s, so this run is off-script.`);
    }
    const result = host.send(intent);
    if (result && !result.ok) problems.push(`${beatName(beat)} failed: ${result.message}`);
  }

  function poll(): void {
    if (busy || state !== 'running') return;   // intents re-emit status synchronously; ignore that echo
    const status = host.status();
    if (!status?.available || status.tick === undefined) return;
    const tick = status.tick;
    // Any reset or seed change not made by the demo means the show is no longer the scripted one.
    if (tick < lastTick || status.seed !== DEMO_SEED) { halt('The show was reset outside the demo, so the demo stopped.'); return; }
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

  /** Reset to the demo seed at 1× with the overlays off. A reset also discards every event still pending. */
  function cleanShow() {
    host.send({ type: 'reset', seed: DEMO_SEED });
    host.send({ type: 'speed', speed: 1 });
    if (!host.status()?.playing) host.send({ type: 'play' });
    setView(false, false);
    host.tethers?.(false);   // a presenter's earlier Lenses ▸ Tethers must not draw amber lines under the show's X-ray (#134)
    host.layout?.('encore');
  }

  function start(): boolean {
    if (!host.status()?.available) { problems.push('Real simulation controls unavailable. Waiting for the simulation connection.'); host.changed(); return false; }
    busy = true;
    try {
      state = 'idle';
      problems.length = 0; next = 0; nextCaption = 0; beat = null; captionBeat = null; caption = '';
      cleanShow();
      lastTick = 0;   // the demo's own reset: status ticks restart from 1
      state = 'running';
    } finally { busy = false; }
    poll();
    host.changed();
    return true;
  }

  function halt(reason: string) {
    state = 'stopped'; caption = reason; beat = null; captionBeat = null;
    host.changed();
  }

  /** Stops the script and resets the show, so nothing it already scheduled (up to LEAD_TICKS ahead) still lands. */
  function stop(): void {
    if (state !== 'running') return;
    busy = true;
    try { state = 'stopped'; cleanShow(); } finally { busy = false; }
    halt(`Demo stopped. The show was reset to seed ${DEMO_SEED}.`);
  }

  return {
    start, stop, poll,
    /** Stops without touching the show (used when the panel is torn down). */
    abandon() { if (state === 'running') halt('Demo stopped.'); },
    restart() { if (state === 'running') state = 'stopped'; return start(); },
    get state() { return state; },
    get caption() { return caption; },
    get beat() { return beat; },
    get captionBeat() { return captionBeat; },
    get problems(): readonly string[] { return [...problems]; },
  };
}

/**
 * Connects a runner to a page's controls over DOM events only, exactly as the control panel talks to them: it sends
 * `encore:control` intents and reads `encore:control-status`, including the result reported right after each intent.
 */
export function connectDemo(host: EventTarget, hooks: { camera(preset: CameraPreset): void; changed(): void; layout?(view: 'encore' | 'split' | 'static'): void; tethers?(on: boolean): void }, beats: readonly DemoBeat[] = activeDemoBeats()) {
  let status: ControlStatus | undefined;
  let result: ControlResult | undefined;
  const runner = createDemoRunner({
    send(intent) {
      result = undefined;
      host.dispatchEvent(new CustomEvent('encore:control', { detail: intent }));
      return result;
    },
    status: () => status,
    view: () => readViewMode(),
    camera: hooks.camera,
    layout: hooks.layout,
    tethers: hooks.tethers,
    changed: hooks.changed,
  }, beats);
  const onStatus = (event: Event) => {
    status = (event as CustomEvent<ControlStatus>).detail;
    if (status.result) result = status.result;
    runner.poll();
    hooks.changed();
  };
  host.addEventListener('encore:control-status', onStatus);
  host.dispatchEvent(new Event('encore:control-query'));
  return {
    runner,
    status: () => status,
    dispose() { runner.abandon(); host.removeEventListener('encore:control-status', onStatus); },
  };
}

/**
 * The bar: Run / Stop, Restart, the D key, progress and the caption. Hidden below 860 px wide; D still works.
 * Opt-in (#92): not named createPanel, so the panel loader does not mount it. The app shell drives the same runner
 * from its dock (Show, D) and shows the captions itself; a page without that shell can mount this bar explicitly.
 * `camera` moves the camera for the demo's camera beats; without it, the bar presses a [data-preset] page button.
 */
export function createDemoBar({ host }: PanelContext, options: { camera?(preset: CameraPreset): void } = {}) {
  const panel = document.createElement('aside');
  panel.className = 'encore-demo';
  panel.setAttribute('aria-label', 'Scripted demo');
  panel.innerHTML = `<style>
    .encore-demo{position:absolute;left:360px;right:250px;bottom:6px;max-width:900px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 16px;align-items:center;padding:8px 12px;border:1px solid #24404f;border-radius:10px;background:#06121de8;box-shadow:0 15px 40px #0005;color:#c4d9e2;font:12px system-ui;z-index:3}
    .encore-demo h2{font-size:11px;letter-spacing:.15em;color:#87adbe;margin:0}.encore-demo .row{display:flex;gap:7px;margin-top:6px}
    .encore-demo button{font:inherit;background:#102633;border:1px solid #2a4757;border-radius:5px;padding:6px 10px;color:#d2e7ef;cursor:pointer}.encore-demo button:hover:not(:disabled){background:#1b3d4d}.encore-demo :disabled{opacity:.38;cursor:not-allowed}.encore-demo :focus-visible{outline:2px solid #71d5dd;outline-offset:2px}.encore-demo kbd{font:10px system-ui;opacity:.55;margin-left:4px}
    .encore-demo .progress{font-size:11px;letter-spacing:0;font-weight:400;color:#7896a6;font-variant-numeric:tabular-nums;margin-left:8px}.encore-demo .caption{font-size:13px;line-height:1.4;color:#dcebf2;margin:0}.encore-demo [data-caption]:empty::before{content:'Press D to run the scripted 90-second demo from seed ${DEMO_SEED}.';color:#7896a6}.encore-demo .note{font-size:11px;color:#e7b677;margin-left:6px}.encore-demo output{display:block;color:#93b4c2;font-size:11px;line-height:1.5;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.encore-demo output:empty{display:none}
    @media(max-width:1279px){.encore-demo{left:350px;right:245px;bottom:4px;padding:7px 10px;grid-template-columns:1fr;gap:4px}.encore-demo>div:first-child{display:flex;align-items:center;gap:10px}.encore-demo .row{margin-top:0}.encore-demo .caption{font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
    @media(max-width:860px){.encore-demo{display:none}}
  </style><div><h2>SCRIPTED DEMO · 90 s<span class="progress" data-progress></span></h2><div class="row"><button data-demo="toggle">Run demo <kbd>D</kbd></button><button data-demo="restart" disabled>Restart</button></div></div>
  <div><p class="caption" aria-live="polite"><span data-caption></span><span class="note" data-note hidden></span></p><output role="status" data-status></output></div>`;
  host.append(panel);
  const toggle = panel.querySelector<HTMLButtonElement>('[data-demo=toggle]')!;
  const restart = panel.querySelector<HTMLButtonElement>('[data-demo=restart]')!;
  const captionEl = panel.querySelector<HTMLElement>('[data-caption]')!;
  const note = panel.querySelector<HTMLElement>('[data-note]')!;
  const progress = panel.querySelector<HTMLElement>('[data-progress]')!;
  const output = panel.querySelector<HTMLOutputElement>('[data-status]')!;

  const ref: { demo?: ReturnType<typeof connectDemo> } = {};   // the first status arrives while connecting
  function render() {
    if (!ref.demo) return;
    const runner = ref.demo.runner;
    const status = ref.demo.status();
    const running = runner.state === 'running';
    const label = running ? 'Stop demo' : 'Run demo';
    if (!toggle.textContent?.startsWith(label)) toggle.innerHTML = `${label} <kbd>D</kbd>`;
    toggle.disabled = !status?.available;
    restart.disabled = !status?.available || runner.state === 'idle';
    if (captionEl.textContent !== runner.caption) captionEl.textContent = runner.caption;   // re-announce only on change
    const text = running ? brainNote(status, runner.captionBeat) : '';
    note.hidden = !text;
    if (note.textContent !== text) note.textContent = text;
    progress.textContent = running ? ` · ${Math.min(90, Math.floor((status?.tick ?? 0) / SECOND))} s` : '';
    const problems = runner.problems.join(' ');
    if (output.textContent !== problems) output.textContent = problems;
  }
  // Camera presets are page buttons (main.ts): press the same one a person would.
  const connected = connectDemo(host, { camera: options.camera ?? (preset => host.querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)?.click()), changed: render });
  ref.demo = connected;
  const onToggle = () => { if (connected.runner.state === 'running') connected.runner.stop(); else connected.runner.start(); };
  const onRestart = () => { connected.runner.restart(); };
  function onKey(event: KeyboardEvent) {
    if (!connected.status()?.available || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'd') return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    event.preventDefault();
    onToggle();
  }
  toggle.addEventListener('click', onToggle);
  restart.addEventListener('click', onRestart);
  window.addEventListener('keydown', onKey);
  render();
  return {
    dispose() {
      connected.dispose();
      toggle.removeEventListener('click', onToggle); restart.removeEventListener('click', onRestart);
      window.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}

// ---------- for a shell that drives the runner itself (#92): refuse honestly, and never hide a failed beat ----------

/** Why the scripted demo must not start on this page, or null. Its beats (drone ids, the kill region) assume DEMO_N0. */
export function demoStartProblem(n0: number): string | null {
  return n0 === DEMO_N0 ? null : `The scripted demo is written for ${DEMO_N0} drones; this page runs ${n0} (?n0=${n0}). Reload without ?n0= to run it.`;
}

/** The line under a demo caption: progress, the brain note, and every problem so far (a failed or late beat). */
export function demoSubline(input: { running: boolean; seconds: number; note: string; problems: readonly string[] }): string {
  const parts: string[] = [];
  if (input.running) parts.push(`Scripted show · ${Math.min(90, Math.floor(input.seconds))} s`);
  else parts.push('Scripted show');
  if (input.note) parts.push(input.note);
  if (input.problems.length) parts.push(`${input.problems.length === 1 ? '1 problem' : `${input.problems.length} problems`}: ${input.problems[input.problems.length - 1]}`);
  return parts.join(' · ');
}
