// src/app/worlds.ts
// Two worlds, one script (docs/design/experience-and-demo.md §1): an Encore arm and a static baseline arm,
// built from the same seed, params, preloaded score and scripted events. Only `brain` differs. They step in
// lockstep, so they always share a tick. The app changes a world only by scheduling EnvEvents and stepping;
// it never sets a drone's slot, target or belief. Pure TypeScript: no DOM, no clock, no randomness.
import { DT, makeParams } from '../contracts';
import type { AgentBrain, EnvEvent, MetricsSample, Observer, Params, Recipe, Score, World, WorldSnapshot } from '../contracts';
import { staticBrain } from '../agent/staticBrain';
import { createObserver } from '../observer';
import { composeNext, makeScore } from '../score';
import { createWorld } from '../sim';
import type { ControlContext } from './actions';
import { readViewMode, setViewMode } from './render/colourModes/viewMode';

// G2 fixture: the Encore brain (#16) is not on this branch yet, so BOTH arms fly the static brain.
const ENCORE_BRAIN: AgentBrain = staticBrain; // swap to encoreBrain when #16 merges

export type Arm = 'encore' | 'static';
export const ARMS: readonly Arm[] = ['encore', 'static'];
export interface Pair<T> { encore: T; static: T }

/** True while the Encore arm still runs a stand-in brain, so the UI can say so instead of implying otherwise. */
export const encoreBrainIsFixture: boolean = ENCORE_BRAIN.kind !== 'encore';

export const DEFAULT_N0 = 200;
export const DEFAULT_RECIPES: readonly Recipe[] = [{ kind: 'text', text: 'ENCORE' }, { kind: 'sphere' }, { kind: 'helix' }];

export interface WorldsOptions {
  seed: number;
  n0?: number;            // default 200; must equal params.n0 when both are given
  params?: Params;        // default makeParams(n0)
  score?: Score;          // default makeScore(ENCORE, sphere, helix)
  events?: EnvEvent[];    // scripted events, scheduled into both worlds at build time
  /** Test seam only: replace an arm's brain. The app never passes this. */
  brains?: Partial<Pair<AgentBrain>>;
}

export interface Worlds {
  /** One read-only observer per world (src/observer), rebuilt on reset. */
  readonly observers: Pair<Observer>;
  /** The newest MetricsSample per world (one every 5 ticks), or null before the first. */
  samples(): Pair<MetricsSample | null>;
  /** Every sample since the last build or reset, per world, oldest first. */
  series(): Pair<readonly MetricsSample[]>;
  /** Registers a score with BOTH observers. Call before any drone can believe it (INJECT_SCORE). */
  registerScore(score: Score): void;
  /** Tells BOTH observers about an event that both worlds accepted. scheduleBoth calls this itself. */
  recordEvent(event: EnvEvent): void;
  readonly params: Params;
  readonly score: Score;
  readonly seed: number;
  /** The current pair. A reset replaces both, so read this again after reset() rather than keeping it. */
  readonly worlds: Pair<World>;
  /** The shared tick of both worlds: 0 before the first step. */
  readonly tick: number;
  /** The snapshots returned by the last stepBoth(), or null before the first step after a build or reset. */
  latest(): Pair<WorldSnapshot> | null;
  /** Advances both worlds by exactly one tick, feeds each snapshot to its observer, returns both snapshots. */
  stepBoth(): Pair<WorldSnapshot>;
  /**
   * Schedules the SAME event object into both worlds (its tick must be later than the shared tick), then
   * records it with both observers. An INJECT_SCORE's score is registered with both observers first.
   */
  scheduleBoth(event: EnvEvent): void;
  /** Rebuilds both worlds from `seed` (default: the current seed) with the same params, score and scripted events. */
  reset(seed?: number): void;
}

function checkSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError(`Seed must be an unsigned 32-bit integer, got ${seed}`);
  return seed;
}

export function createWorlds(options: WorldsOptions): Worlds {
  const n0 = options.n0 ?? options.params?.n0 ?? DEFAULT_N0;
  const params = options.params ?? makeParams(n0);
  if (params.n0 !== n0) throw new RangeError(`n0 (${n0}) does not match params.n0 (${params.n0})`);
  const score = options.score ?? makeScore([...DEFAULT_RECIPES], n0, params);
  const scripted = options.events ?? [];
  let seed = checkSeed(options.seed);
  const brains: Pair<AgentBrain> = { encore: options.brains?.encore ?? ENCORE_BRAIN, static: options.brains?.static ?? staticBrain };
  let pair: Pair<World>;
  let observers: Pair<Observer>;
  let latest: Pair<WorldSnapshot> | null;
  let latestSamples: Pair<MetricsSample | null>;
  let series: Pair<MetricsSample[]>;
  let tick: number;

  function registerScore(next: Score): void {
    for (const arm of ARMS) observers[arm].registerScore(next);
  }
  function recordEvent(event: EnvEvent): void {
    for (const arm of ARMS) observers[arm].recordEvent(event);
  }
  function build(): void {
    // createWorld deep-copies params, score and events, so both arms may share these inputs.
    pair = {
      encore: createWorld({ seed, params, score, brain: brains.encore, events: scripted }),
      static: createWorld({ seed, params, score, brain: brains.static, events: scripted }),
    };
    observers = { encore: createObserver(params), static: createObserver(params) };
    registerScore(score);
    for (const event of scripted) {
      if (event.type === 'INJECT_SCORE') registerScore(event.score);
      recordEvent(event);
    }
    latest = null;
    latestSamples = { encore: null, static: null };
    series = { encore: [], static: [] };
    tick = 0;
  }
  build();

  return {
    params, score,
    get seed() { return seed; },
    get worlds() { return pair; },
    get observers() { return observers; },
    get tick() { return tick; },
    latest: () => latest,
    samples: () => ({ ...latestSamples }),
    series: () => ({ encore: series.encore, static: series.static }),
    registerScore,
    recordEvent,
    stepBoth() {
      const next = { encore: pair.encore.step(), static: pair.static.step() };
      if (next.encore.tick !== next.static.tick || next.encore.tick !== tick + 1) {
        throw new Error(`Worlds left lockstep: encore ${next.encore.tick}, static ${next.static.tick}, expected ${tick + 1}`);
      }
      tick = next.encore.tick;
      latest = next;
      // Every tick, exactly once per snapshot: the observer keeps per-tick evidence and returns a sample
      // only every fifth tick (and null on a repeated tick), so the non-null result must be kept here.
      // Both observers see the tick even if one throws, so one bad tick cannot break the other observer.
      let failure: { error: unknown } | null = null;
      for (const arm of ARMS) {
        try {
          const sample = observers[arm].sample(next[arm]);
          if (sample) { latestSamples[arm] = sample; series[arm].push(sample); }
        } catch (error) {
          failure ??= { error };
        }
      }
      if (failure) throw failure.error;
      return next;
    },
    scheduleBoth(event) {
      // Checked here first so a bad tick cannot reach one world and not the other. The remaining checks in
      // World.schedule do not depend on the brain, so both worlds accept or reject the same event.
      if (!Number.isInteger(event.tick) || event.tick <= tick) throw new Error(`Event tick ${event.tick} must be after the current tick ${tick}`);
      if (event.type === 'INJECT_SCORE') registerScore(event.score);   // before any drone can believe it
      pair.encore.schedule(event);
      pair.static.schedule(event);
      recordEvent(event);
    },
    reset(next = seed) {
      seed = checkSeed(next);
      build();
    },
  };
}

/** A KILL for the next tick with explicit, validated, sorted, de-duplicated ids. */
export function killEvent(worlds: Pick<Worlds, 'tick' | 'params'>, ids: readonly number[]): Extract<EnvEvent, { type: 'KILL' }> {
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id >= worlds.params.n0) throw new RangeError(`Drone id ${id} is not in this roster (0..${worlds.params.n0 - 1})`);
  }
  return { type: 'KILL', tick: worlds.tick + 1, ids: [...new Set(ids)].sort((a, b) => a - b) };
}

/** What the app shell owns and the control binder needs: the clock (transport) and the view. */
export type ShellHooks = Pick<ControlContext, 'getSnapshots' | 'getTransport' | 'setPlaying' | 'setSpeed' | 'reset' | 'display'>;

/** The ControlContext the app hands to bindControls (#22): real worlds, real score composer, radio faults on, both observers. */
export function controlContext(worlds: Worlds, shell: ShellHooks): ControlContext {
  return {
    ...shell,
    params: worlds.params,
    getWorlds: () => worlds.worlds,
    getScore: () => worlds.score,
    composeScore: composeNext,
    radioFaults: true,   // the world implements JAM, PARTITION, SET_LOSS and INJECT_SCORE (#19)
    // The adapter schedules into both worlds itself, then calls these: the injected score (synchronously, so
    // well before its tick is reached) and every accepted event go to BOTH observers.
    registerScore: next => worlds.registerScore(next),
    onScheduledEvent: event => worlds.recordEvent(event),
  };
}

/**
 * The display adapter for the controls (#22): X-ray, belief colours and the selected drone are view state only,
 * held by the X-ray layers' viewMode module (#25). It never touches a world.
 */
export const viewModeDisplay: NonNullable<ControlContext['display']> = {
  setSelected: id => { setViewMode({ selectedDroneId: id }); },
  toggleXray: () => { setViewMode({ xray: !readViewMode().xray }); },
  toggleBelief: () => { setViewMode({ beliefColours: !readViewMode().beliefColours }); },
};

/** What the comparison HUD (#24) is fed: both observers' latest samples plus view telemetry. After a reset the
 *  samples are null, so the HUD shows "waiting" at once instead of the old run's numbers. */
export function hudPayload(worlds: Pick<Worlds, 'samples' | 'params' | 'worlds'>, view: { fps: number | null; layout: Arm | 'split' }) {
  return {
    ...worlds.samples(), rosterSize: worlds.params.n0, fps: view.fps, layout: view.layout,
    brainKinds: { encore: worlds.worlds.encore.config.brain.kind, static: worlds.worlds.static.config.brain.kind },
  };
}

// --- Frame loop: fixed simulation step, rendering once per animation frame.
export const MAX_STEPS_PER_FRAME = 5;
export interface FrameHooks {
  /** One simulation tick of both worlds. */
  advance(): void;
  /** Draw the frame; alpha is the interpolation between the last two ticks. */
  render(alpha: number, dtReal: number, steps: number, now: number): void;
  /** A tick or the render threw: the transport is already paused. Report it; R / reset recovers. */
  onError(error: unknown): void;
  /** Schedule the next frame (requestAnimationFrame in the app). Always called, even after a throw. */
  request(frame: (now: number) => void): void;
}
/**
 * `acc += min(frameDt, 0.1) * speed`; step while `acc >= DT`, at most MAX_STEPS_PER_FRAME per frame (the
 * backlog is then dropped, never faked). A throw from a tick or the render pauses the transport and reports,
 * and the loop keeps running, so the app recovers with a reset instead of a page reload.
 */
export function createFrameLoop(transport: { playing: boolean; speed: number }, hooks: FrameHooks, start: number) {
  let previous = start;
  let accumulator = 0;
  function frame(now: number): void {
    try {
      const dtReal = Math.max(0, (now - previous) / 1000);
      previous = now;
      if (transport.playing) accumulator += Math.min(dtReal, 0.1) * transport.speed;
      let steps = 0;
      while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) { hooks.advance(); accumulator -= DT; steps++; }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = Math.min(accumulator, DT);
      hooks.render(accumulator / DT, dtReal, steps, now);
    } catch (error) {
      transport.playing = false;
      accumulator = 0;
      try { hooks.onError(error); } catch { /* reporting must never stop the loop */ }
    } finally {
      hooks.request(frame);
    }
  }
  return { frame };
}
