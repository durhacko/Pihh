import type { EnvEvent, Params, Recipe, Score, Vec3, World, WorldSnapshot } from '../contracts';
import { idsInSphere, randomIds } from '../sim';
import { generatedRecipeProblem } from '../cli/generated';

/** The longest per-injection lead (GF-WP-11 step 2): 60 s at 20 ticks per second. */
export const MAX_LEAD_TICKS = 1200;

/**
 * `at` and `centre` exist for the scripted demo (#27), which drives these same intents from the DOM: `at` lands
 * an event on an exact later tick instead of the next one, and `centre` fixes a region instead of the selected
 * drone's position. Buttons and keys never pass them.
 */
export type ControlIntent =
  | { type: 'play' } | { type: 'step' } | { type: 'reset'; seed: number } | { type: 'speed'; speed: number }
  | { type: 'select'; id: number | null } | { type: 'kill-region'; radius?: number; centre?: Vec3; at?: number }
  | { type: 'kill-selected' } | { type: 'kill-random' } | { type: 'kill-ids'; ids: number[] } | { type: 'jam'; radius?: number; centre?: Vec3; at?: number }
  | { type: 'partition' } | { type: 'loss'; loss: number } | { type: 'inject'; recipe: Recipe; at?: number; lead?: number }
  | { type: 'xray' } | { type: 'belief' }
  /** GF-WP-11 replay: reset from `seed`, then schedule the logged events exactly (a checked ReplayLogFile, #214). */
  | { type: 'replay'; seed: number; events: EnvEvent[] };

export interface ControlContext {
  params: Params;
  getWorlds(): { encore: World; static: World };
  getSnapshots(): { encore: WorldSnapshot; static: WorldSnapshot };
  getScore(): Score;
  getTransport(): { playing: boolean; speed: number; seed: number };
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  reset(seed: number): void;
  composeScore?: (score: Score, tick: number, recipe: Recipe, origin: number, n0: number, params: Params) => Score;
  /** Must register the score with both observers, if observers are attached. */
  registerScore?: (score: Score) => void;
  onScheduledEvent?: (event: EnvEvent) => void;
  /** Explicitly true only when the world implements WP-2b faults and injection. */
  radioFaults?: boolean;
  display?: { setSelected(id: number | null): void; toggleXray(): void; toggleBelief(): void };
  /** Advance exactly one tick while paused (the `.` key / dock step button). */
  step?(): void;
  /** One path into both worlds. When given, the controller schedules through it instead of calling each
   *  world (so a latched failure refuses), and it must register injected scores / record events itself. */
  scheduleBoth?(event: EnvEvent): void;
  /** Why the show cannot run right now (e.g. a failed tick), or null. Play and step say so instead. */
  blockedReason?(): string | null;
  /** The world the current selection was made in. Faults and injections are centred in the Encore world, so a
   *  selection made in the static pane cannot centre one (the same drone id can be metres away there). Absent: Encore. */
  selectionWorld?(): 'encore' | 'static';
}

/** Why a fault or injection centred on the selection refuses while that selection was made in the static pane. */
export const STATIC_SELECTION_REFUSAL = 'Faults are centred in the Encore world: select in the Encore pane.';

export interface ControlStatus {
  available: boolean; playing: boolean; speed: number; seed: number; loss: number;
  /** The shared tick of both worlds (always set by the controller; optional for older status fixtures). */
  tick?: number;
  selectedId: number | null; selectedAlive: boolean; radioFaults: boolean; composition: boolean; display: boolean;
  message: string;
  /** Only on the status emitted right after an intent: that intent's result. */
  result?: ControlResult;
  /** The brain each live world actually flies (its config.brain.kind), as the HUD's brainKinds reports it. */
  brains?: { encore: World['config']['brain']['kind']; static: World['config']['brain']['kind'] };
}
export interface ControlResult { ok: boolean; message: string; event?: EnvEvent }

/** The radius a regional kill uses: positive and finite (idsInSphere itself accepts 0). */
function killRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Radius must be positive.');
  return radius;
}

/** The ids of the one jam and the one partition an operator toggles (the controls, the keys and the console). */
export const OPERATOR_JAM_ID = 'operator-jam';
export const OPERATOR_PARTITION_ID = 'operator-partition';

/**
 * THE toggle rule, shared by the controller and the console's preconditions (ui/commands.ts liveState): whether the
 * operator jam or partition `id` will be on at tick `at`. Start from `current` (what the latest snapshot shows), then
 * apply every scheduled on/off for that id with now < tick ≤ at, in tick order; same-tick events keep log order.
 * Log order alone is not tick order once an intent can name a later tick with `at`, so it must never decide this.
 */
export function toggleOnAt(log: readonly EnvEvent[], kind: 'jam' | 'partition', id: string, now: number, at: number, current: boolean): boolean {
  const on = kind === 'jam' ? 'JAM_ON' : 'PARTITION_ON';
  const off = kind === 'jam' ? 'JAM_OFF' : 'PARTITION_OFF';
  const pending = log.filter(event => (event.type === on || event.type === off) && event.id === id && event.tick > now && event.tick <= at);
  pending.sort((a, b) => a.tick - b.tick);   // stable: same-tick events keep log order
  return pending.length ? pending[pending.length - 1].type === on : current;
}

/** App boundary: resolve an intent once, then schedule equal explicit events into both arms. */
export function createActionController(context: ControlContext) {
  const log: EnvEvent[] = [];
  let selectedId: number | null = null;
  let authoredScore = structuredClone(context.getScore());
  let message = 'Real simulation controls connected.';
  const jamId = OPERATOR_JAM_ID;
  const partitionId = OPERATOR_PARTITION_ID;

  function status(): ControlStatus {
    const snapshot = context.getSnapshots().encore;
    const lossEvent = [...log].reverse().find((event): event is Extract<EnvEvent, { type: 'SET_LOSS' }> => event.type === 'SET_LOSS');
    const worlds = context.getWorlds();
    return { available: true, ...context.getTransport(), tick: snapshot.tick, brains: { encore: worlds.encore.config.brain.kind, static: worlds.static.config.brain.kind }, loss: lossEvent?.loss ?? context.params.loss, selectedId, selectedAlive: snapshot.drones.some(drone => drone.id === selectedId && drone.alive), radioFaults: !!context.radioFaults, composition: !!context.radioFaults && !!context.composeScore, display: !!context.display, message };
  }
  function selected(snapshot: WorldSnapshot) {
    const drone = snapshot.drones.find(drone => drone.id === selectedId && drone.alive);
    if (!drone) throw new Error('Select a live drone first.');
    return drone;
  }
  /** The selected drone as a fault or injection centre: only a selection made in the Encore world can be one. */
  function centreDrone(snapshot: WorldSnapshot) {
    if (context.selectionWorld?.() === 'static') throw new Error(STATIC_SELECTION_REFUSAL);
    return selected(snapshot);
  }
  function schedule(event: EnvEvent): ControlResult {
    if (context.scheduleBoth) context.scheduleBoth(structuredClone(event));
    else {
      const worlds = context.getWorlds();
      worlds.encore.schedule(structuredClone(event));
      worlds.static.schedule(structuredClone(event));
    }
    log.push(structuredClone(event));
    if (event.type === 'INJECT_SCORE') {
      authoredScore = structuredClone(event.score);
      if (!context.scheduleBoth) context.registerScore?.(structuredClone(event.score));
    }
    if (!context.scheduleBoth) context.onScheduledEvent?.(structuredClone(event));
    return { ok: true, message: `${event.type} scheduled for tick ${event.tick} in both worlds.`, event: structuredClone(event) };
  }
  function centre(value: Vec3 | undefined, fallback: () => Vec3): Vec3 {
    if (value === undefined) return [...fallback()];
    if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error('A region centre must be three finite numbers.');
    return [...value];
  }

  function handle(intent: ControlIntent): ControlResult {
    try {
      if (intent.type === 'play' || intent.type === 'step') {
        const starting = intent.type === 'step' || !context.getTransport().playing;
        const blocked = starting ? context.blockedReason?.() : null;
        if (blocked) { message = `Cannot ${intent.type === 'step' ? 'step' : 'play'}: ${blocked}. Press R to reset.`; return { ok: false, message }; }
        if (intent.type === 'step') {
          if (!context.step) throw new Error('Single-step is not connected.');
          if (context.getTransport().playing) context.setPlaying(false);
          context.step(); message = 'Stepped one tick.'; return { ok: true, message };
        }
        context.setPlaying(!context.getTransport().playing); message = context.getTransport().playing ? 'Playing.' : 'Paused.'; return { ok: true, message };
      }
      if (intent.type === 'speed') {
        if (![0.25, 0.5, 1, 2, 4].includes(intent.speed)) throw new Error('Choose a supported playback speed.');
        context.setSpeed(intent.speed); message = `Playback ${intent.speed}×.`; return { ok: true, message };
      }
      if (intent.type === 'reset') {
        if (!Number.isSafeInteger(intent.seed) || intent.seed < 0 || intent.seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer.');
        context.reset(intent.seed); log.length = 0; selectedId = null; context.display?.setSelected(null); authoredScore = structuredClone(context.getScore());
        message = `Reset from seed ${intent.seed}.`; return { ok: true, message };
      }
      if (intent.type === 'replay') {
        // Every generated scene is checked BEFORE anything is reset; then the worlds are rebuilt from the seed and the
        // logged events are scheduled through the one schedule() path (logged, observers told), never adapted.
        if (!Number.isSafeInteger(intent.seed) || intent.seed < 0 || intent.seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer.');
        for (const e of intent.events) {
          if (e.type !== 'INJECT_SCORE') continue;
          for (const m of e.score.movements) {
            const problem = generatedRecipeProblem(m.recipe);
            if (problem) throw new Error(`The replay was refused: ${problem}.`);
          }
        }
        context.reset(intent.seed); log.length = 0; selectedId = null; context.display?.setSelected(null); authoredScore = structuredClone(context.getScore());
        const now = context.getSnapshots().encore.tick;
        const early = intent.events.find(e => !Number.isSafeInteger(e.tick) || e.tick <= now);
        if (early) throw new Error(`The replay was refused after the reset: an event at tick ${String(early.tick)} is not after tick ${now}.`);
        for (const e of intent.events) schedule(e);
        message = `Replay from seed ${intent.seed}: ${intent.events.length} event${intent.events.length === 1 ? '' : 's'} scheduled.`; return { ok: true, message };
      }
      if (intent.type === 'select') {
        if (intent.id !== null && (!Number.isSafeInteger(intent.id) || !context.getSnapshots().encore.drones.some(drone => drone.id === intent.id))) throw new Error('Drone id is not in this roster.');
        selectedId = intent.id; context.display?.setSelected(selectedId); message = selectedId === null ? 'Selection cleared.' : `Drone ${selectedId} selected.`; return { ok: true, message };
      }
      if (intent.type === 'xray' || intent.type === 'belief') {
        if (!context.display) throw new Error('Display layers are not connected.');
        if (intent.type === 'xray') context.display.toggleXray(); else context.display.toggleBelief();
        message = 'Display mode changed.'; return { ok: true, message };
      }
      const snapshots = context.getSnapshots();
      if (snapshots.encore.tick !== snapshots.static.tick) throw new Error('World clocks are not aligned.');
      const at = 'at' in intent ? intent.at : undefined;
      if (at !== undefined && (!Number.isSafeInteger(at) || at <= snapshots.encore.tick)) throw new Error('A timed action must land after the current tick.');
      const tick = at ?? snapshots.encore.tick + 1;
      let event: EnvEvent;
      if (intent.type === 'kill-region') event = { type: 'KILL', tick, ids: idsInSphere(snapshots.encore, centre(intent.centre, () => centreDrone(snapshots.encore).pos), killRadius(intent.radius ?? context.params.rClaim)) };
      else if (intent.type === 'kill-selected') event = { type: 'KILL', tick, ids: [selected(snapshots.encore).id] };
      else if (intent.type === 'kill-ids') {
        // Explicit ids (console, scripts): validated against the roster, sorted and de-duplicated once.
        for (const id of intent.ids) if (!Number.isInteger(id) || id < 0 || id >= context.params.n0) throw new Error(`Drone id ${id} is not in this roster.`);
        if (intent.ids.length === 0) throw new Error('No drone ids given.');
        event = { type: 'KILL', tick, ids: [...new Set(intent.ids)].sort((x, y) => x - y) };
      }
      else if (intent.type === 'kill-random') {
        const live = snapshots.encore.drones.filter(drone => drone.alive).map(drone => drone.id);
        event = { type: 'KILL', tick, ids: randomIds((context.getTransport().seed ^ tick ^ log.length) >>> 0, live, Math.ceil(context.params.n0 * 0.1)) };
      }
      else {
        if (!context.radioFaults) throw new Error('Radio fault controls are not connected yet.');
        if (intent.type === 'jam') {
          const on = toggleOnAt(log, 'jam', jamId, snapshots.encore.tick, tick, snapshots.encore.jams.some(jam => jam.id === jamId));
          event = on ? { type: 'JAM_OFF', tick, id: jamId } : { type: 'JAM_ON', tick, id: jamId, centre: centre(intent.centre, () => centreDrone(snapshots.encore).pos), radius: intent.radius ?? context.params.rRadio };
          if (event.type === 'JAM_ON' && (!Number.isFinite(event.radius) || event.radius <= 0)) throw new Error('Radius must be positive.');
        } else if (intent.type === 'partition') {
          const on = toggleOnAt(log, 'partition', partitionId, snapshots.encore.tick, tick, snapshots.encore.partitions.some(partition => partition.id === partitionId));
          event = on ? { type: 'PARTITION_OFF', tick, id: partitionId } : { type: 'PARTITION_ON', tick, id: partitionId, point: [0, 30, 0], normal: [1, 0, 0] };
        } else if (intent.type === 'loss') {
          if (!Number.isFinite(intent.loss) || intent.loss < 0 || intent.loss > 1) throw new Error('Packet loss must be between 0 and 1.');
          event = { type: 'SET_LOSS', tick, loss: intent.loss };
        } else {
          if (!context.composeScore) throw new Error('Score composer is not connected yet.');
          if (log.some(event => event.type === 'INJECT_SCORE' && event.tick === tick)) throw new Error('A composition is already scheduled for this tick. Advance the show before injecting another.');
          const id = centreDrone(snapshots.encore).id;
          if (intent.recipe.kind === 'text' && (!intent.recipe.text.trim() || !/^[A-Z0-9 ]{1,20}$/i.test(intent.recipe.text))) throw new Error('Use 1–20 letters, digits or spaces.');
          // GF-WP-11 step 1, defence in depth: a generated scene is re-validated and re-hashed here, whatever the
          // caller, before composeScore's strict compile. A tampered or other-compiler recipe is never scheduled.
          const generatedProblem = generatedRecipeProblem(intent.recipe);
          if (generatedProblem) throw new Error(`The generated scene was refused: ${generatedProblem}.`);
          const recipe = intent.recipe.kind === 'text' ? { ...intent.recipe, text: intent.recipe.text.toUpperCase() } : intent.recipe;
          // GF-WP-11 step 2: an optional per-injection lead, read only by composeScore through a params copy (no Params
          // default or contract changes). Longer than the default only, at most 60 s: a longer lead lengthens the window
          // in which a drone on a stale base may fly back (contract §8.5 limit 9).
          if (intent.lead !== undefined && (!Number.isSafeInteger(intent.lead) || intent.lead < context.params.scoreLead || intent.lead > MAX_LEAD_TICKS)) {
            throw new Error(`The lead must be a whole number of ticks from ${context.params.scoreLead} to ${MAX_LEAD_TICKS}.`);
          }
          const composeParams = intent.lead === undefined ? context.params : { ...context.params, scoreLead: intent.lead };
          event = { type: 'INJECT_SCORE', tick, droneId: id, score: context.composeScore(authoredScore, tick, recipe, id, context.params.n0, composeParams) };
        }
      }
      const result = schedule(event); message = result.message; return result;
    } catch (error) { message = error instanceof Error ? error.message : String(error); return { ok: false, message }; }
  }
  return {
    handle, status, getEventLog: () => structuredClone(log), selectDrone: (id: number | null) => handle({ type: 'select', id }),
    /** The score the next injection is composed from (a copy): the preloaded score, then each scheduled INJECT_SCORE's.
     *  For the Composer's transition lint (#208) through ComposeContext.score. */
    authoredScore: (): Score => structuredClone(authoredScore),
  };
}

/** Panels dispatch DOM intents only; the bootstrap explicitly connects real-world authority here. */
export function bindControls(host: HTMLElement, context: ControlContext) {
  const controller = createActionController(context);
  // The status sent straight after an intent carries that intent's result, so a DOM-only sender (the scripted
  // demo) can tell a failed action from a scheduled one.
  const emit = (result?: ControlResult) => host.dispatchEvent(new CustomEvent('encore:control-status', { detail: { ...controller.status(), ...(result ? { result } : {}) } }));
  const onIntent = (event: Event) => { emit(controller.handle((event as CustomEvent<ControlIntent>).detail)); };
  const onQuery = () => emit();
  host.addEventListener('encore:control', onIntent);
  host.addEventListener('encore:control-query', onQuery);
  emit();
  return {
    ...controller,
    handle(intent: ControlIntent) { const result = controller.handle(intent); emit(result); return result; },
    selectDrone(id: number | null) { const result = controller.selectDrone(id); emit(result); return result; },
    refresh: () => emit(),
    dispose() {
      host.removeEventListener('encore:control', onIntent); host.removeEventListener('encore:control-query', onQuery);
      host.dispatchEvent(new CustomEvent('encore:control-status', { detail: { ...controller.status(), available: false, message: 'Real simulation controls unavailable.' } }));
    },
  };
}
