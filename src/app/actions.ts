import type { EnvEvent, Params, Recipe, Score, Vec3, World, WorldSnapshot } from '../contracts';
import { idsInSphere, randomIds } from '../sim';

/**
 * `at` and `centre` exist for the scripted demo (#27), which drives these same intents from the DOM: `at` lands
 * an event on an exact later tick instead of the next one, and `centre` fixes a region instead of the selected
 * drone's position. Buttons and keys never pass them.
 */
export type ControlIntent =
  | { type: 'play' } | { type: 'reset'; seed: number } | { type: 'speed'; speed: number }
  | { type: 'select'; id: number | null } | { type: 'kill-region'; radius?: number; centre?: Vec3; at?: number }
  | { type: 'kill-selected' } | { type: 'kill-random' } | { type: 'jam'; radius?: number; centre?: Vec3; at?: number }
  | { type: 'partition' } | { type: 'loss'; loss: number } | { type: 'inject'; recipe: Recipe; at?: number }
  | { type: 'xray' } | { type: 'belief' };

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
}

export interface ControlStatus {
  available: boolean; playing: boolean; speed: number; seed: number; loss: number;
  /** The shared tick of both worlds (always set by the controller; optional for older status fixtures). */
  tick?: number;
  selectedId: number | null; selectedAlive: boolean; radioFaults: boolean; composition: boolean; display: boolean;
  message: string;
  /** Only on the status emitted right after an intent: that intent's result. */
  result?: ControlResult;
}
export interface ControlResult { ok: boolean; message: string; event?: EnvEvent }

/** The radius a regional kill uses: positive and finite (idsInSphere itself accepts 0). */
function killRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Radius must be positive.');
  return radius;
}

/** App boundary: resolve an intent once, then schedule equal explicit events into both arms. */
export function createActionController(context: ControlContext) {
  const log: EnvEvent[] = [];
  let selectedId: number | null = null;
  let authoredScore = structuredClone(context.getScore());
  let message = 'Real simulation controls connected.';
  const jamId = 'operator-jam';
  const partitionId = 'operator-partition';

  function status(): ControlStatus {
    const snapshot = context.getSnapshots().encore;
    const lossEvent = [...log].reverse().find((event): event is Extract<EnvEvent, { type: 'SET_LOSS' }> => event.type === 'SET_LOSS');
    return { available: true, ...context.getTransport(), tick: snapshot.tick, loss: lossEvent?.loss ?? context.params.loss, selectedId, selectedAlive: snapshot.drones.some(drone => drone.id === selectedId && drone.alive), radioFaults: !!context.radioFaults, composition: !!context.radioFaults && !!context.composeScore, display: !!context.display, message };
  }
  function selected(snapshot: WorldSnapshot) {
    const drone = snapshot.drones.find(drone => drone.id === selectedId && drone.alive);
    if (!drone) throw new Error('Select a live drone first.');
    return drone;
  }
  function schedule(event: EnvEvent): ControlResult {
    const worlds = context.getWorlds();
    worlds.encore.schedule(structuredClone(event));
    worlds.static.schedule(structuredClone(event));
    log.push(structuredClone(event));
    if (event.type === 'INJECT_SCORE') {
      authoredScore = structuredClone(event.score);
      context.registerScore?.(structuredClone(event.score));
    }
    context.onScheduledEvent?.(structuredClone(event));
    return { ok: true, message: `${event.type} scheduled for tick ${event.tick} in both worlds.`, event: structuredClone(event) };
  }
  /** Whether the toggle will be on at tick `at`: the current state, then every pending on/off for this id up to
   * `at`, in tick order. (Log order alone is not tick order once an intent can name a later tick with `at`.) */
  function pendingToggle(on: 'JAM_ON' | 'PARTITION_ON', off: 'JAM_OFF' | 'PARTITION_OFF', id: string, now: number, at: number, current: boolean): boolean {
    const pending = log.filter(event => (event.type === on || event.type === off) && event.id === id && event.tick > now && event.tick <= at);
    pending.sort((a, b) => a.tick - b.tick);   // stable: same-tick events keep log order
    return pending.length ? pending[pending.length - 1].type === on : current;
  }
  function centre(value: Vec3 | undefined, fallback: () => Vec3): Vec3 {
    if (value === undefined) return [...fallback()];
    if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error('A region centre must be three finite numbers.');
    return [...value];
  }

  function handle(intent: ControlIntent): ControlResult {
    try {
      if (intent.type === 'play') { context.setPlaying(!context.getTransport().playing); message = context.getTransport().playing ? 'Playing.' : 'Paused.'; return { ok: true, message }; }
      if (intent.type === 'speed') {
        if (![0.25, 0.5, 1, 2, 4].includes(intent.speed)) throw new Error('Choose a supported playback speed.');
        context.setSpeed(intent.speed); message = `Playback ${intent.speed}×.`; return { ok: true, message };
      }
      if (intent.type === 'reset') {
        if (!Number.isSafeInteger(intent.seed) || intent.seed < 0 || intent.seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer.');
        context.reset(intent.seed); log.length = 0; selectedId = null; context.display?.setSelected(null); authoredScore = structuredClone(context.getScore());
        message = `Reset from seed ${intent.seed}.`; return { ok: true, message };
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
      if (intent.type === 'kill-region') event = { type: 'KILL', tick, ids: idsInSphere(snapshots.encore, centre(intent.centre, () => selected(snapshots.encore).pos), killRadius(intent.radius ?? context.params.rClaim)) };
      else if (intent.type === 'kill-selected') event = { type: 'KILL', tick, ids: [selected(snapshots.encore).id] };
      else if (intent.type === 'kill-random') {
        const live = snapshots.encore.drones.filter(drone => drone.alive).map(drone => drone.id);
        event = { type: 'KILL', tick, ids: randomIds((context.getTransport().seed ^ tick ^ log.length) >>> 0, live, Math.ceil(context.params.n0 * 0.1)) };
      }
      else {
        if (!context.radioFaults) throw new Error('Radio fault controls are not connected yet.');
        if (intent.type === 'jam') {
          const on = pendingToggle('JAM_ON', 'JAM_OFF', jamId, snapshots.encore.tick, tick, snapshots.encore.jams.some(jam => jam.id === jamId));
          event = on ? { type: 'JAM_OFF', tick, id: jamId } : { type: 'JAM_ON', tick, id: jamId, centre: centre(intent.centre, () => selected(snapshots.encore).pos), radius: intent.radius ?? context.params.rRadio };
          if (event.type === 'JAM_ON' && (!Number.isFinite(event.radius) || event.radius <= 0)) throw new Error('Radius must be positive.');
        } else if (intent.type === 'partition') {
          const on = pendingToggle('PARTITION_ON', 'PARTITION_OFF', partitionId, snapshots.encore.tick, tick, snapshots.encore.partitions.some(partition => partition.id === partitionId));
          event = on ? { type: 'PARTITION_OFF', tick, id: partitionId } : { type: 'PARTITION_ON', tick, id: partitionId, point: [0, 30, 0], normal: [1, 0, 0] };
        } else if (intent.type === 'loss') {
          if (!Number.isFinite(intent.loss) || intent.loss < 0 || intent.loss > 1) throw new Error('Packet loss must be between 0 and 1.');
          event = { type: 'SET_LOSS', tick, loss: intent.loss };
        } else {
          if (!context.composeScore) throw new Error('Score composer is not connected yet.');
          if (log.some(event => event.type === 'INJECT_SCORE' && event.tick === tick)) throw new Error('A composition is already scheduled for this tick. Advance the show before injecting another.');
          const id = selected(snapshots.encore).id;
          if (intent.recipe.kind === 'text' && (!intent.recipe.text.trim() || !/^[A-Z0-9 ]{1,20}$/i.test(intent.recipe.text))) throw new Error('Use 1–20 letters, digits or spaces.');
          const recipe = intent.recipe.kind === 'text' ? { ...intent.recipe, text: intent.recipe.text.toUpperCase() } : intent.recipe;
          event = { type: 'INJECT_SCORE', tick, droneId: id, score: context.composeScore(authoredScore, tick, recipe, id, context.params.n0, context.params) };
        }
      }
      const result = schedule(event); message = result.message; return result;
    } catch (error) { message = error instanceof Error ? error.message : String(error); return { ok: false, message }; }
  }
  return { handle, status, getEventLog: () => structuredClone(log), selectDrone: (id: number | null) => handle({ type: 'select', id }) };
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
