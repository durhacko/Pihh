// src/app/render/quality.ts
// The render quality ladder (experience-and-demo §10 "Degrade order", system-architecture §6, DESIGN §8.3).
// Rendering only: no level changes the simulation, the observers or any measured number. Each level keeps the ones
// above it and drops one more cost, in the documented order:
//   0 full · 1 plain heartbeat lines off · 2 halos off (the glow: this renderer has no bloom pass)
//   3 pixel ratio 1 · 4 static view at half rate (split only)
// The last rung of the documented ladder, a lower drone-count preset, needs a new world and therefore a reload with
// another roster: it is not automatic (see `?n0=`, issue #113).
//
// Automatic, as a safety net for weak (software-GL) machines: only when rendered fps stays below AUTO_FPS_FLOOR for
// SUSTAIN_WINDOWS consecutive windows (about 4.5 s) does it step down one level (after a warm-up, with a hold between
// steps), never back up, so a demo does not flicker between levels. `?q=low` forces the lowest level, `?q=high` the
// highest, `?q=0`..`?q=4` a given level; a forced level never changes.

export const QUALITY_LADDER = [
  'full',
  'plain heartbeat lines off',
  'halos off',
  'pixel ratio 1',
  'static view at half rate',
] as const;
export const LOWEST_QUALITY = QUALITY_LADDER.length - 1;
/** Step down when the measured rendered frame rate is below this. */
export const AUTO_FPS_FLOOR = 30;
/** Rendered fps is measured over windows of this length. */
export const FPS_WINDOW_MS = 1500;
/** Ignore start-up (shader compilation, first layout) before judging. */
export const WARMUP_MS = 3000;
/** After a step, let the new level settle for at least this long before judging again. */
export const HOLD_MS = 2000;
/** A gap between two frames longer than this (hidden tab, debugger) restarts the window instead of counting. */
export const GAP_MS = 500;
/** Step only after this many CONSECUTIVE windows below the floor (about 4.5 s): a brief dip never degrades. */
export const SUSTAIN_WINDOWS = 3;

export type QualityMode = 'auto' | 'forced';
export type QualityListener = (level: number) => void;

/** `?q=` → the starting level and whether it may change. */
export function parseQuality(search: string): { level: number; mode: QualityMode } {
  const q = new URLSearchParams(search).get('q');
  if (q === 'low') return { level: LOWEST_QUALITY, mode: 'forced' };
  if (q === 'high') return { level: 0, mode: 'forced' };
  if (q !== null && /^\d$/.test(q) && Number(q) <= LOWEST_QUALITY) return { level: Number(q), mode: 'forced' };
  return { level: 0, mode: 'auto' };
}

export class QualityController {
  level: number;
  readonly mode: QualityMode;
  /** The last measured rendered fps, or null before the first full window. */
  fps: number | null = null;
  private listeners = new Set<QualityListener>();
  private started: number | null = null;
  private windowStart = 0;
  private lastFrame = 0;
  private frames = 0;
  private lastChange = -Infinity;
  private lowWindows = 0;

  constructor(initial: { level: number; mode: QualityMode } = { level: 0, mode: 'auto' }) {
    this.level = initial.level;
    this.mode = initial.mode;
  }

  /** One rendered frame at time `now` (ms, requestAnimationFrame clock). Returns true when the level changed. */
  frame(now: number): boolean {
    if (this.started === null || now - this.lastFrame > GAP_MS) {
      this.started ??= now;
      this.windowStart = now;
      this.lastFrame = now;
      this.frames = 0;
      return false;
    }
    this.lastFrame = now;
    this.frames++;
    const span = now - this.windowStart;
    if (span < FPS_WINDOW_MS) return false;
    this.fps = (this.frames * 1000) / span;
    this.windowStart = now;
    this.frames = 0;
    if (this.mode !== 'auto' || now - this.started < WARMUP_MS || now - this.lastChange < HOLD_MS) return false;
    // At or above the floor nothing changes, ever; below it, only a sustained drop steps one level down.
    this.lowWindows = this.fps < AUTO_FPS_FLOOR ? this.lowWindows + 1 : 0;
    if (this.lowWindows >= SUSTAIN_WINDOWS && this.level < LOWEST_QUALITY) {
      this.lowWindows = 0;
      this.set(this.level + 1, now);
      return true;
    }
    return false;
  }

  /** Called at once with the current level, then on every change. Returns an unsubscribe function. */
  subscribe(listener: QualityListener): () => void {
    this.listeners.add(listener);
    listener(this.level);
    return () => { this.listeners.delete(listener); };
  }

  /** One line for the HUD and the readout. */
  describe(): string {
    const how = this.mode === 'auto' ? `auto below ${AUTO_FPS_FLOOR} fps` : 'forced by ?q=';
    return `Quality ${this.level}/${LOWEST_QUALITY} · ${QUALITY_LADDER[this.level]} · ${how}`;
  }

  private set(level: number, now: number): void {
    this.level = level;
    this.lastChange = now;
    for (const listener of this.listeners) listener(level);
  }
}

let shared: QualityController | null = null;

/**
 * The app's one controller, created on first use from `?q=`. In a browser it also starts its own
 * requestAnimationFrame monitor (every rendered frame of the page) and mirrors the level on
 * `<html data-quality>`; in tests (no window) it does neither.
 */
export function sharedQuality(): QualityController {
  if (shared) return shared;
  const browser = typeof window !== 'undefined' && typeof requestAnimationFrame === 'function';
  const controller = new QualityController(parseQuality(browser ? window.location.search : ''));
  shared = controller;
  if (browser) {
    controller.subscribe(level => { document.documentElement.dataset.quality = String(level); });
    const monitor = (now: number) => { controller.frame(now); requestAnimationFrame(monitor); };
    requestAnimationFrame(monitor);
  }
  return controller;
}
