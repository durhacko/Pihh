import type { EnvEvent, Params, Recipe, Score, Vec3, World, WorldSnapshot } from '../contracts';
import { idsInSphere, randomIds } from '../sim';

export type ControlIntent =
  | { type: 'play' } | { type: 'step' } | { type: 'reset'; seed: number } | { type: 'speed'; speed: number }
  | { type: 'select'; id: number | null } | { type: 'kill-region'; radius?: number; centre?: Vec3 }
  | { type: 'kill-selected' } | { type: 'kill-random' } | { type: 'kill-ids'; ids: number[] } | { type: 'jam'; radius?: number; centre?: Vec3 }
  | { type: 'partition' } | { type: 'loss'; loss: number } | { type: 'inject'; recipe: Recipe }
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
  /** Advance exactly one tick while paused (the `.` key / dock step button). */
  step?(): void;
  /** One path into both worlds. When given, the controller schedules through it instead of calling each
   *  world (so a latched failure refuses), and it must register injected scores / record events itself. */
  scheduleBoth?(event: EnvEvent): void;
  /** Why the show cannot run right now (e.g. a failed tick), or null. Play and step say so instead. */
  blockedReason?(): string | null;
}

export interface ControlStatus {
  available: boolean; playing: boolean; speed: number; seed: number; loss: number;
  selectedId: number | null; selectedAlive: boolean; radioFaults: boolean; composition: boolean; display: boolean;
  message: string;
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
    return { available: true, ...context.getTransport(), loss: lossEvent?.loss ?? context.params.loss, selectedId, selectedAlive: snapshot.drones.some(drone => drone.id === selectedId && drone.alive), radioFaults: !!context.radioFaults, composition: !!context.radioFaults && !!context.composeScore, display: !!context.display, message };
  }
  function selected(snapshot: WorldSnapshot) {
    const drone = snapshot.drones.find(drone => drone.id === selectedId && drone.alive);
    if (!drone) throw new Error('Select a live drone first.');
    return drone;
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
  function pendingToggle(on: 'JAM_ON' | 'PARTITION_ON', off: 'JAM_OFF' | 'PARTITION_OFF', id: string, tick: number, current: boolean): boolean {
    for (let i = log.length - 1; i >= 0; i--) {
      const event = log[i];
      if ((event.type === on || event.type === off) && event.id === id && event.tick > tick) return event.type === on;
    }
    return current;
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
      const tick = snapshots.encore.tick + 1;
      let event: EnvEvent;
      if (intent.type === 'kill-region') event = { type: 'KILL', tick, ids: idsInSphere(snapshots.encore, intent.centre ? [...intent.centre] : selected(snapshots.encore).pos, killRadius(intent.radius ?? context.params.rClaim)) };
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
          const on = pendingToggle('JAM_ON', 'JAM_OFF', jamId, snapshots.encore.tick, snapshots.encore.jams.some(jam => jam.id === jamId));
          event = on ? { type: 'JAM_OFF', tick, id: jamId } : { type: 'JAM_ON', tick, id: jamId, centre: [...(intent.centre ?? selected(snapshots.encore).pos)], radius: intent.radius ?? context.params.rRadio };
          if (event.type === 'JAM_ON' && (!Number.isFinite(event.radius) || event.radius <= 0)) throw new Error('Radius must be positive.');
        } else if (intent.type === 'partition') {
          const on = pendingToggle('PARTITION_ON', 'PARTITION_OFF', partitionId, snapshots.encore.tick, snapshots.encore.partitions.some(partition => partition.id === partitionId));
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
  const emit = () => host.dispatchEvent(new CustomEvent('encore:control-status', { detail: controller.status() }));
  const onIntent = (event: Event) => { controller.handle((event as CustomEvent<ControlIntent>).detail); emit(); };
  host.addEventListener('encore:control', onIntent);
  host.addEventListener('encore:control-query', emit);
  emit();
  return {
    ...controller,
    handle(intent: ControlIntent) { const result = controller.handle(intent); emit(); return result; },
    selectDrone(id: number | null) { const result = controller.selectDrone(id); emit(); return result; },
    refresh: emit,
    dispose() {
      host.removeEventListener('encore:control', onIntent); host.removeEventListener('encore:control-query', emit);
      host.dispatchEvent(new CustomEvent('encore:control-status', { detail: { ...controller.status(), available: false, message: 'Real simulation controls unavailable.' } }));
    },
  };
}
