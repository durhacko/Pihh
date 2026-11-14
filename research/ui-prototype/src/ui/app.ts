// Shared application context and the action layer. Buttons, keys, the console and the demo script all call
// these same actions, so every path produces the same Intent → EnvEvent (FR-34: "the same EnvEvent goes to both worlds").
import type { Recipe, RGB, Vec3 } from '@encore/contracts';
import { expandRecipe } from '@encore/score';
import { FONT } from '@encore/score/font';
import type { Arm, DispatchResult, Intent, Session } from '../engine/session';
import type { Stage } from '../render/Stage';
import type { Surfaces } from './surfaces';
import type { CameraPreset, Lenses, PickRequest, Store, VersionPalette, ViewMode } from './store';

export interface Draft { id: string; name: string; kind: Recipe['kind']; text: string; palette: [RGB, RGB] | null; sent: string[] }

export class Drafts {
  list: Draft[] = [];
  currentId: string;
  private seq = 0;
  private listeners = new Set<() => void>();
  constructor() {
    this.currentId = this.add({ name: 'Durhack', kind: 'text', text: 'DURHACK', palette: [[0.0, 0.72, 0.62], [0.98, 0.78, 0.22]] }).id;
    this.add({ name: 'Orb', kind: 'sphere', text: '', palette: null });
    this.currentId = this.list[0].id;
  }
  get current(): Draft { return this.list.find(d => d.id === this.currentId)!; }
  add(d: Omit<Draft, 'id' | 'sent'>): Draft {
    const draft = { ...d, id: `d${++this.seq}`, sent: [] };
    this.list.push(draft); this.currentId = draft.id; this.emit();
    return draft;
  }
  update(patch: Partial<Draft>) { Object.assign(this.current, patch); this.emit(); }
  select(id: string) { if (this.list.some(d => d.id === id)) { this.currentId = id; this.emit(); } }
  remove(id: string) { if (this.list.length <= 1) return; this.list = this.list.filter(d => d.id !== id); if (this.currentId === id) this.currentId = this.list[0].id; this.emit(); }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }
}

export interface Validation { ok: boolean; errors: string[]; warnings: string[]; recipe: Recipe | null }

/** Validate a draft against the score package itself (font table, expandRecipe), not a UI copy of its rules. */
export function validateDraft(d: Draft, n0: number, params: Parameters<typeof expandRecipe>[2]): Validation {
  const errors: string[] = [], warnings: string[] = [];
  if (!d.name.trim()) errors.push('Give the formation a name.');
  let recipe: Recipe | null = null;
  if (d.kind === 'text') {
    const bad = [...new Set([...d.text].filter(c => !(c in FONT)))];
    if (!d.text.trim()) errors.push('Type at least one letter or digit.');
    else if (bad.length) errors.push(`${bad.map(c => c === ' ' ? 'space' : `“${c}”`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not in the 5×7 font. Use A–Z, 0–9 and space.`);
    if (d.text.length > 10) warnings.push(`${d.text.length} characters: at ${n0} drones each letter gets ~${Math.round(n0 / d.text.replace(/ /g, '').length)} drones and reads thinly.`);
    recipe = { kind: 'text', text: d.text, ...(d.palette ? { palette: d.palette } : {}) };
  } else recipe = { kind: d.kind, ...(d.palette ? { palette: d.palette } : {}) } as Recipe;
  if (d.palette) for (const c of d.palette) {
    const [r, g, b] = c;
    if (r > 0.92 && g > 0.92 && b > 0.92) warnings.push('White is reserved for selection and deaf markers; it may read as a diagnostic.');
    else if (b > 0.75 && r < 0.25 && g < 0.35) warnings.push('Pure blue renders dim against the night sky.');
    else if (r > 0.9 && g > 0.25 && g < 0.45 && b < 0.2) warnings.push('Vermilion is reserved for vacant slots and jams.');
  }
  if (!errors.length && recipe) {
    try { expandRecipe(recipe, n0, params); } catch (e) { errors.push(`The score package rejected it: ${(e as Error).message}`); recipe = null; }
  } else recipe = null;
  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], recipe };
}

export interface App {
  session: Session; store: Store; stage: Stage; palette: VersionPalette; surfaces: Surfaces; drafts: Drafts;
  actions: Actions;
  toast(text: string, kind?: 'ok' | 'err' | 'info', action?: { label: string; run(): void }): void;
  caption(text: string | null, sub?: string): void;
  validate(d: Draft): Validation;
  runDemo(): void;
}

export class Actions {
  demo: { stop(): void } | null = null;
  /** Set by the console while it runs a command: feedback then goes to the event log, not to toasts. */
  quiet = false;
  constructor(private app: App) {}

  notify(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
    if (this.quiet) this.app.session.log(kind === 'err' ? 'error' : 'info', text);
    else this.app.toast(text, kind);
  }
  private result(r: DispatchResult, quiet = false): DispatchResult {
    if (this.quiet) return r;              // the session already logged it
    if (!r.ok) this.app.toast(r.error, 'err');
    else if (!quiet) this.app.toast(r.summary, 'ok');
    return r;
  }
  dispatch(intent: Intent, quiet = false) { return this.result(this.app.session.dispatch(intent), quiet); }

  togglePlay(force?: boolean) { const s = this.app.session; s.playing = force ?? !s.playing; }
  setSpeed(v: number) { this.app.session.speed = Math.max(0.25, Math.min(4, v)); }
  nudgeSpeed(dir: 1 | -1) {
    const steps = [0.25, 0.5, 1, 2, 4];
    const i = steps.indexOf(this.app.session.speed);
    this.setSpeed(steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? 2 : i) + dir))]);
  }
  step() { const s = this.app.session; s.playing = false; s.stepOnce(); }
  reset(seed?: number) {
    this.demo?.stop();
    this.app.palette.reset();
    this.app.session.reset(seed);
    this.app.store.set({ selected: null, hovered: null });
  }

  select(id: number | null, arm: Arm = 'encore') { this.app.store.set({ selected: id === null ? null : { id, arm } }); if (id !== null) this.app.surfaces.open('inspector'); else this.app.surfaces.close('inspector'); }
  setView(v: ViewMode) { this.app.store.set({ view: v }); }
  cycleView() { const order: ViewMode[] = ['encore', 'split', 'static']; const v = this.app.store.state.view; this.setView(order[(order.indexOf(v) + 1) % 3]); }
  lens<K extends keyof Lenses>(k: K, v?: Lenses[K]) {
    const cur = this.app.store.state.lenses[k];
    this.app.store.lens(k, (v ?? (typeof cur === 'boolean' ? !cur : cur)) as Lenses[K]);
  }
  camera(p: CameraPreset) { this.app.store.set({ camera: null }); this.app.store.set({ camera: p }); }

  /** Ask the user to click in the stage. Resolves null on Escape. */
  pick(purpose: PickRequest['purpose'], prompt: string, radius?: number): Promise<{ droneId: number | null; point: Vec3 } | null> {
    this.app.store.state.pick?.resolve(null);
    return new Promise(resolve => {
      this.app.store.set({ pick: { purpose, prompt, radius, resolve: r => { this.app.store.set({ pick: null, pickPoint: null }); resolve(r); } } });
    });
  }

  selectedLive(): number | null {
    const s = this.app.store.state.selected;
    if (!s) return null;
    return this.app.session.arms.encore.curr.drones[s.id]?.alive ? s.id : null;
  }

  killSelected() {
    const id = this.selectedLive();
    if (id === null) { this.notify('Select a live drone first (click one in the stage).', 'err'); return; }
    this.dispatch({ kind: 'kill', ids: [id] });
  }
  async killRegion(radius = 8, centre?: Vec3) {
    if (!centre) {
      const r = await this.pick('killRegion', `Click the centre of a ${radius} m region to destroy`, radius);
      if (!r) return;
      centre = r.droneId !== null ? this.app.session.arms.encore.curr.drones[r.droneId].pos : r.point;
    }
    this.dispatch({ kind: 'killRegion', centre, radius });
  }
  killRandom(fraction = 0.1) { this.dispatch({ kind: 'killRandom', fraction }); }
  async jam(radius = 12, centre?: Vec3) {
    if (!centre) {
      const r = await this.pick('jam', `Click where to centre a ${radius} m radio jam`, radius);
      if (!r) return;
      centre = r.droneId !== null ? this.app.session.arms.encore.curr.drones[r.droneId].pos : r.point;
    }
    this.dispatch({ kind: 'jamOn', centre: centre.map(v => Math.round(v * 10) / 10) as Vec3, radius });
  }
  unjam(id?: string) { this.dispatch({ kind: 'jamOff', id }); }
  toggleJam() { if (this.app.session.arms.encore.curr.jams.length) this.unjam(); else void this.jam(); }
  partition(on?: boolean) {
    const active = this.app.session.arms.encore.curr.partitions.length > 0;
    if (on ?? !active) this.dispatch({ kind: 'partitionOn', point: [0, 30, 0], normal: [1, 0, 0] });
    else this.dispatch({ kind: 'partitionOff' });
  }
  setLoss(loss: number) { this.dispatch({ kind: 'setLoss', loss }); }

  /** Inject the current (or given) draft into one drone. Returns the dispatch result. */
  inject(droneId: number, draftId?: string): DispatchResult {
    const d = draftId ? this.app.drafts.list.find(x => x.id === draftId) : this.app.drafts.current;
    if (!d) { this.notify(`No draft ${draftId}. Type drafts to list them.`, 'err'); return { ok: false, error: 'no draft' }; }
    const v = validateDraft(d, this.app.session.params.n0, this.app.session.params);
    if (!v.ok || !v.recipe) { this.notify(`Draft “${d.name}” is not valid: ${v.errors[0]}`, 'err'); return { ok: false, error: 'invalid draft' }; }
    const r = this.dispatch({ kind: 'inject', droneId, recipe: v.recipe, name: d.name });
    if (r.ok && r.event.type === 'INJECT_SCORE') { this.app.store.set({ preview: null }); d.sent.push(`${r.event.score.version.issuedTick}:${r.event.score.version.origin}`); this.app.drafts.update({}); }
    return r;
  }
}
