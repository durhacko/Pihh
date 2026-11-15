// src/app/ui/GeneratedSource.ts
// GF-WP-10 (#265, preview-only part): the Composer's "Generated" source. The operator picks one of the COMMITTED
// fixture scenes (tests/fixtures/scenes/valid-*.json, validated by #203). It compiles off the main thread in the
// preview worker through #259's compiler, and the stage previews the resulting slots as a target arrangement.
//
// What it is not:
// - no model or provider is called: every scene is a checked-in fixture and is labelled "fixture", never as live
//   or model output (offline only; D3 not granted);
// - nothing is injected: the formation is never flown, and Inject stays disabled ("needs GF-WP-07 (D2)", the
//   generated Recipe kind is a contract change). The stage preview's recipe is a placeholder that is never sent;
// - opt-in only: the Composer offers this source only with `?p2=generated`; without it, nothing here is loaded.
//
// Scene strings (titles, file names) are rendered as text only, never through `h(tag, { html })` (GF-T34).
import type { Formation, Params, Recipe } from '../../contracts';
import type { CompileResult, CompileWarning, SceneSpec } from '../../score/generated';
import type { FormationClient } from '../workers/formationClient';
import { h } from './dom';
import type { Store } from './store';

/** The opt-in URL flag (`?p2=<name>[,<name>…]`, as the other Phase 2 visuals use). */
export const GENERATED_FLAG = 'generated';
export function generatedOptIn(search: string): boolean {
  const value = new URLSearchParams(search).get('p2');
  return value !== null && value.split(',').map(part => part.trim()).includes(GENERATED_FLAG);
}

/** Why the generated source cannot be injected yet: the generated Recipe kind is GF-WP-07, a D2 contract change. */
export const INJECT_BLOCKED = 'needs GF-WP-07 (D2)';
/** Placeholder recipe carried by a fixture preview (StagePreview.recipe is required); never flown, sent or expanded. */
export const PLACEHOLDER_RECIPE: Readonly<Recipe> = Object.freeze({ kind: 'sphere' });

export interface FixtureEntry { id: string; file: string; load(): Promise<unknown> }

/** The committed valid fixture scenes, loaded lazily (one chunk each), in file order. */
export function fixtureEntries(): FixtureEntry[] {
  const modules = import.meta.glob<unknown>('../../../tests/fixtures/scenes/valid-*.json', { import: 'default' });
  return Object.keys(modules).sort().map((path) => {
    const file = path.slice(path.lastIndexOf('/') + 1);
    return { id: file.replace(/^valid-/, '').replace(/\.json$/, ''), file, load: modules[path] };
  });
}

export type GeneratedStatus =
  | { state: 'idle' }
  | { state: 'loading'; fixtureId: string }
  | { state: 'compiling'; fixtureId: string; title: string; mode: SceneSpec['mode']; requestId: string | null }
  | { state: 'ready'; fixtureId: string; title: string; mode: SceneSpec['mode']; requestId: string; result: Extract<CompileResult, { ok: true }> }
  | { state: 'rejected'; fixtureId: string; title: string; mode: SceneSpec['mode'] | null; code: string; detail: string; warnings: CompileWarning[] };

export interface GeneratedSourceContext {
  params: Params;
  client: FormationClient;
  store: Pick<Store, 'state' | 'set'>;
  fixtures?: FixtureEntry[];
}

export interface GeneratedSource {
  readonly fixtures: readonly FixtureEntry[];
  readonly status: GeneratedStatus;
  /** Loads and compiles one fixture. A selection superseded by a newer one is never applied. */
  select(fixtureId: string): Promise<void>;
  /** Shows or hides the stage preview of the compiled fixture. Returns whether it is now shown. */
  preview(on: boolean): boolean;
  previewOn(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const modeLabel = (mode: SceneSpec['mode'] | null): string => (mode === 'scene3d' ? '3D' : mode === 'silhouette2d' ? '2D' : '?');

function asScene(raw: unknown): { scene: SceneSpec; title: string; mode: SceneSpec['mode'] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { mode?: unknown; title?: unknown };
  if (value.mode !== 'scene3d' && value.mode !== 'silhouette2d') return null;
  return { scene: raw as SceneSpec, title: typeof value.title === 'string' ? value.title : '(untitled)', mode: value.mode };
}

/** Structurally the contract's Formation; copied so the stage never holds the worker's message object. */
function toFormation(result: Extract<CompileResult, { ok: true }>): Formation {
  const f = result.formation;
  return {
    slots: f.slots.map(s => ({ index: s.index, pos: [s.pos[0], s.pos[1], s.pos[2]], colour: [s.colour[0], s.colour[1], s.colour[2]] })),
    dense: f.dense.map(p => [p[0], p[1], p[2]]),
    bounds: { min: [...f.bounds.min], max: [...f.bounds.max] },
  };
}

export function createGeneratedSource(ctx: GeneratedSourceContext): GeneratedSource {
  const fixtures = ctx.fixtures ?? fixtureEntries();
  let status: GeneratedStatus = { state: 'idle' };
  let selection = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const set = (next: GeneratedStatus) => { status = next; emit(); };
  const previewOn = () => ctx.store.state.preview?.source === 'fixture';
  const showPreview = () => {
    if (status.state !== 'ready') return false;
    ctx.store.set({ preview: { recipe: { ...PLACEHOLDER_RECIPE }, label: status.title, formation: toFormation(status.result), source: 'fixture' } });
    return true;
  };

  return {
    fixtures,
    get status() { return status; },
    async select(fixtureId) {
      const mine = ++selection;
      const entry = fixtures.find(f => f.id === fixtureId);
      if (!entry) { set({ state: 'rejected', fixtureId, title: fixtureId, mode: null, code: 'reference', detail: `no fixture named ${fixtureId}`, warnings: [] }); return; }
      set({ state: 'loading', fixtureId });
      let raw: unknown;
      try { raw = await entry.load(); } catch (error) {
        if (mine === selection) set({ state: 'rejected', fixtureId, title: entry.file, mode: null, code: 'parse', detail: `could not load ${entry.file}: ${String(error)}`, warnings: [] });
        return;
      }
      if (mine !== selection) return;                 // a newer selection started while this one loaded
      const parsed = asScene(raw);
      if (!parsed) { set({ state: 'rejected', fixtureId, title: entry.file, mode: null, code: 'schema', detail: `${entry.file} is not a scene`, warnings: [] }); return; }
      const wasPreviewing = previewOn();
      set({ state: 'compiling', fixtureId, title: parsed.title, mode: parsed.mode, requestId: null });
      const pending = ctx.client.compile({ scene: parsed.scene, n0: ctx.params.n0, params: ctx.params });
      if (status.state === 'compiling' && mine === selection) status = { ...status, requestId: ctx.client.latest };
      const reply = await pending;
      if (reply === 'stale' || mine !== selection) return;   // a newer request owns the panel now
      const result = reply.result;
      if (result.ok) {
        set({ state: 'ready', fixtureId, title: parsed.title, mode: parsed.mode, requestId: reply.requestId, result });
        if (wasPreviewing) showPreview();             // keep the stage in step with the newest compile
      } else {
        if (previewOn()) ctx.store.set({ preview: null });   // never leave an older fixture's slots on stage
        set({ state: 'rejected', fixtureId, title: parsed.title, mode: parsed.mode, code: result.code, detail: result.detail, warnings: result.warnings });
      }
    },
    preview(on) {
      if (!on) { if (previewOn()) ctx.store.set({ preview: null }); emit(); return false; }
      const shown = showPreview();
      emit();
      return shown;
    },
    previewOn,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      selection++;
      listeners.clear();
      if (previewOn()) ctx.store.set({ preview: null });
      ctx.client.dispose();
    },
  };
}

/** The status line, as plain text (also used by tests). Always says "fixture"; never claims a live or model source. */
export function statusText(status: GeneratedStatus, n0: number): string {
  switch (status.state) {
    case 'idle': return 'Pick a fixture scene to compile it for preview.';
    case 'loading': return `Loading fixture ${status.fixtureId}…`;
    case 'compiling': return `Compiling fixture “${status.title}” (${modeLabel(status.mode)}) in the preview worker…`;
    case 'ready': {
      const s = status.result.stats;
      return `Fixture “${status.title}” (${modeLabel(status.mode)}): ${status.result.formation.slots.length} of ${n0} slots · ${s.size.map(v => v.toFixed(0)).join(' × ')} m · digest ${status.result.slotsDigest.slice(0, 8)}`;
    }
    case 'rejected': return `Fixture “${status.title}” was rejected: ${status.code}. ${status.detail}`;
  }
}

/** The tab's DOM. Every scene-derived string goes in as a text child. */
export function renderGeneratedSource(source: GeneratedSource, n0: number, onPreviewChange: () => void): HTMLElement {
  const root = h('div', { class: 'field', 'data-generated': '' });
  const draw = () => {
    const st = source.status;
    const active = st.state === 'idle' ? null : st.fixtureId;
    const list = h('div', { class: 'drafts', role: 'radiogroup', 'aria-label': 'Fixture scenes' },
      ...source.fixtures.map(f => h('button', {
        type: 'button', class: 'chip', role: 'radio', 'data-fk': `fixture-${f.id}`, 'aria-checked': String(f.id === active),
        onclick: () => { void source.select(f.id); },
      }, f.id, h('span', { class: 'hint' }, ' · fixture'))));
    const warnings = st.state === 'ready' ? st.result.warnings : st.state === 'rejected' ? st.warnings : [];
    root.replaceChildren(
      h('span', { class: 'label' }, 'Generated · committed fixture scenes (offline)'),
      list,
      h('div', { class: st.state === 'rejected' ? 'hint err' : 'hint', role: st.state === 'rejected' ? 'alert' : 'status' }, statusText(st, n0)),
      ...warnings.slice(0, 6).map(w => h('div', { class: 'hint warn' }, '▲ ', `${w.code}${w.partId ? ` (${w.partId})` : ''}: ${w.detail}`)),
      h('button', {
        type: 'button', class: 'btn small', 'data-fk': 'generated-preview', 'aria-pressed': String(source.previewOn()), disabled: st.state !== 'ready',
        onclick: () => { source.preview(!source.previewOn()); onPreviewChange(); },
      }, source.previewOn() ? 'Hide stage preview' : 'Preview in stage'),
      h('div', { class: 'hint' }, 'Scenes come from the repository\'s test fixtures; no model is called. The stage shows the target arrangement only: it is not flown, and it cannot be injected yet (', INJECT_BLOCKED, ').'));
  };
  source.subscribe(draw);
  draw();
  return root;
}
