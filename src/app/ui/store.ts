// src/app/ui/store.ts
// Presentation-layer state (research/ui-prototype DESIGN.md §4 "Store"). Owned by the UI; never read by the
// simulation, and never a source of simulated facts: drones, beliefs and metrics come from snapshots and
// observers, not from here. Shared module: it does not export createPanel, so the panel loader in ./index.ts
// imports it without effect. No side effects at import.
import type { Recipe, Vec3 } from '../../contracts';
import type { Arm } from '../worlds';

export type ColourMode = 'show' | 'belief';
export type ViewMode = 'encore' | 'split' | 'static';

/** One arm's name over its pane: which arm, its name and a one-line description. */
export interface PaneLabel { arm: Arm; name: string; desc: string }

/**
 * The arm labels over the stage for a view (#134). Every view names its top pane. A single view uses the same
 * name and wording as that arm's pane in split, without the ▲/▼ arrow. Only split has a bottom label.
 */
export function paneLabels(view: ViewMode): { top: PaneLabel; bottom: PaneLabel | null } {
  const encore = { arm: 'encore', desc: 'decentralised, self-healing' } as const;
  const baseline = { arm: 'static', desc: 'pre-programmed baseline · sends no radio' } as const;
  if (view === 'split') return { top: { ...encore, name: '▲ ENCORE' }, bottom: { ...baseline, name: '▼ STATIC' } };
  return { top: view === 'static' ? { ...baseline, name: 'STATIC' } : { ...encore, name: 'ENCORE' }, bottom: null };
}
export type CameraPreset = 'audience' | 'quarter' | 'top';
export type Quality = 'auto' | 'high' | 'low';
export interface Lenses { colour: ColourMode; xray: boolean; ghosts: boolean; tethers: boolean; zones: boolean; neighbourhood: boolean }

/** A pending "click in the scene" request from a panel or the console. `resolve(null)` cancels it. */
export interface PickRequest {
  purpose: 'select' | 'inject' | 'killRegion' | 'jam';
  radius?: number;
  prompt: string;
  resolve(result: { droneId: number | null; point: Vec3 } | null): void;
}

/** The operator's region-kill radius (m) by default: the demo's kill (DemoScript KILL_RADIUS) and the controller's own default (params.rClaim). */
export const DEFAULT_KILL_RADIUS = 6;
/** The operator's jam radius (m) by default (J and the Disrupt slider). */
export const DEFAULT_JAM_RADIUS = 12;

export interface UIState {
  lenses: Lenses;
  view: ViewMode;
  selected: { id: number; arm: Arm } | null;
  hovered: { id: number; arm: Arm } | null;
  pick: PickRequest | null;
  pickPoint: Vec3 | null;
  preview: { recipe: Recipe; label: string } | null;   // local only: drawn over the stage, never sent
  quality: Quality;
  reducedMotion: boolean;
  chromeHidden: boolean;
  camera: CameraPreset | null;
  /** The one radius (m) K, the Disrupt popover and its pick use for a region kill; the Region radius slider writes it. */
  killRadius: number;
  /** The one radius (m) J, the Disrupt popover and its pick use for a jam; the Jam radius slider writes it. */
  jamRadius: number;
}

/**
 * The state the shell starts from (main.ts): the caller's defaults with the view from the URL. No lens is
 * overridden: tethers stay off (#134; before, main.ts switched them on and X-ray drew them as if they were radio).
 */
export function initialShellState(initial: UIState, view: ViewMode): UIState {
  return { ...initial, view };
}

export type StoreListener = (state: Readonly<UIState>, changed: (keyof UIState)[]) => void;

/** The prototype's start state. The caller reads the environment (URL, OS reduced-motion setting) and passes it in. */
export function defaultUIState(options: { quality?: Quality; reducedMotion?: boolean } = {}): UIState {
  return {
    lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true },
    view: 'encore', selected: null, hovered: null, pick: null, pickPoint: null, preview: null,
    quality: options.quality ?? 'auto',
    reducedMotion: options.reducedMotion ?? false,
    chromeHidden: false, camera: null,
    killRadius: DEFAULT_KILL_RADIUS, jamRadius: DEFAULT_JAM_RADIUS,
  };
}

/**
 * Holds UIState and notifies subscribers with the list of keys whose value changed (by identity). A patch
 * that changes nothing notifies no one. State is replaced, never mutated, so listeners may keep old states.
 */
export class Store {
  private current: UIState;
  private readonly listeners = new Set<StoreListener>();

  constructor(initial: UIState = defaultUIState()) {
    this.current = initial;
  }

  get state(): Readonly<UIState> {
    return this.current;
  }

  get<K extends keyof UIState>(key: K): UIState[K] {
    return this.current[key];
  }

  set(patch: Partial<UIState>): void {
    const changed = (Object.keys(patch) as (keyof UIState)[]).filter((k) => this.current[k] !== patch[k]);
    if (changed.length === 0) return;
    this.current = { ...this.current, ...patch };
    // Iterate over a copy, so a listener that unsubscribes (or subscribes) during notification is safe.
    for (const fn of [...this.listeners]) fn(this.current, changed);
  }

  /** Changes one lens; notifies with changed = ['lenses'] only if the value differs. */
  lens<K extends keyof Lenses>(key: K, value: Lenses[K]): void {
    if (this.current.lenses[key] === value) return;
    this.set({ lenses: { ...this.current.lenses, [key]: value } });
  }

  /** Returns the unsubscribe function. */
  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

/** Okabe–Ito, colour-blind-safe, in order of first appearance (DESIGN §1). Vermilion is reserved for vacancy. */
export const VERSION_HUES: readonly string[] = ['#E69F00', '#009E73', '#CC79A7', '#F0E442', '#56B4E9', '#D9D9D9'];

/** Assigns each score version key ("issuedTick:origin") a stable hue in order of first appearance. */
export class VersionPalette {
  private order: string[] = [];

  colour(key: string): string {
    return VERSION_HUES[this.index(key) % VERSION_HUES.length] as string;
  }

  index(key: string): number {
    let i = this.order.indexOf(key);
    if (i < 0) {
      this.order.push(key);
      i = this.order.length - 1;
    }
    return i;
  }

  reset(): void {
    this.order = [];
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Expected a colour like #RRGGBB, got '${hex}'`);
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: readonly number[]): string {
  return '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
