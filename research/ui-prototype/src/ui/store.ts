// Presentation-layer state. Owned by the UI; never read by the simulation.
import type { Recipe, Vec3 } from '@encore/contracts';
import type { Arm } from '../engine/session';

export type ColourMode = 'show' | 'belief';
export type ViewMode = 'encore' | 'split' | 'static';
export type CameraPreset = 'audience' | 'quarter' | 'top';
export interface Lenses { colour: ColourMode; xray: boolean; ghosts: boolean; tethers: boolean; zones: boolean; neighbourhood: boolean }

/** A pending "click in the scene" request from a panel or the console. */
export interface PickRequest {
  purpose: 'select' | 'inject' | 'killRegion' | 'jam';
  radius?: number;
  prompt: string;
  resolve(result: { droneId: number | null; point: Vec3 } | null): void;
}

export interface UIState {
  lenses: Lenses;
  view: ViewMode;
  selected: { id: number; arm: Arm } | null;
  hovered: { id: number; arm: Arm } | null;
  pick: PickRequest | null;
  pickPoint: Vec3 | null;
  preview: { recipe: Recipe; label: string } | null;
  quality: 'auto' | 'high' | 'low';
  reducedMotion: boolean;
  chromeHidden: boolean;
  camera: CameraPreset | null;
}

type Listener = (state: UIState, changed: (keyof UIState)[]) => void;

export class Store {
  state: UIState;
  private listeners = new Set<Listener>();
  constructor(initial: UIState) { this.state = initial; }
  get<K extends keyof UIState>(k: K): UIState[K] { return this.state[k]; }
  set(patch: Partial<UIState>): void {
    const changed = (Object.keys(patch) as (keyof UIState)[]).filter(k => this.state[k] !== patch[k]);
    if (!changed.length) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state, changed);
  }
  lens<K extends keyof Lenses>(k: K, v: Lenses[K]): void { this.set({ lenses: { ...this.state.lenses, [k]: v } }); }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

/** Okabe–Ito, colour-blind-safe, in order of first appearance (experience doc §3, §13). Vermilion reserved for vacancy. */
const VERSION_HUES = ['#E69F00', '#009E73', '#CC79A7', '#F0E442', '#56B4E9', '#D9D9D9'];
export class VersionPalette {
  private order: string[] = [];
  colour(key: string): string {
    let i = this.order.indexOf(key);
    if (i < 0) { this.order.push(key); i = this.order.length - 1; }
    return VERSION_HUES[i % VERSION_HUES.length];
  }
  index(key: string): number { this.colour(key); return this.order.indexOf(key); }
  reset(): void { this.order = []; }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(c: readonly number[]): string {
  return '#' + c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
