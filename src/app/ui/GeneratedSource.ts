// src/app/ui/GeneratedSource.ts
// GF-WP-10 (#265 preview part, #213 completion): the Composer's "Generated" source.
// - Offline fixtures (the default): pick one of the COMMITTED fixture scenes (tests/fixtures/scenes/valid-*.json,
//   validated by #203). Every one is labelled "offline fixture".
// - Live generation (#213; off unless the build flag AND `?p2=generated,live`): a prompt goes to the gateway's `gemini`
//   module through src/app/live/generate.ts. D3 is not granted, so today it answers "live Gemini unavailable (D3 not
//   granted)". A scene from any model whose id is not a Gemini id (the gateway's `offline-fake` test provider) is
//   labelled as not Gemini. The returned scene is untrusted: it is re-validated here (validateScene) before compiling.
// Either way the scene compiles off the main thread in the preview worker through #259's compiler, and the stage
// previews the slots as a target arrangement, never flown.
//
// G3: Accept re-checks the compiled scene (injectPreflight, #214) and builds its generated recipe (GF-WP-07, #215);
// the Composer then injects it into ONE chosen live drone through d1's injectGeneratedRecipe, and the observer shows
// adoption spreading by radio. Accept and Inject are enabled only on a page that loaded that inject path. Nothing
// here moves a drone: the swarm flies the formation only through that one uplink and the existing gossip.
// Scene strings (titles, prompts, provider messages) are rendered as text only, never through `h(tag, { html })`
// (GF-T34).
import type { Formation, GeneratedRecipe, Params, Recipe } from '../../contracts';
import { injectPreflight, provenanceFromCompile, replayFromProvenance, type GeneratedProvenance, type ReplayResult } from '../../cli/generated';
import { makeGeneratedRecipe } from '../../score';
import type { CompileResult, CompileWarning, SceneSpec } from '../../score/generated';
import { validateScene } from '../../score/generated/validation';
import { D3_UNAVAILABLE, type GenerateClient, type LiveMode } from '../live/generate';
import type { FormationClient } from '../workers/formationClient';
import type { ComposeContext, InjectOutcome } from './Composer';
import { h } from './dom';
import type { Store } from './store';

/** The opt-in URL flag (`?p2=<name>[,<name>…]`, as the other Phase 2 visuals use). */
export const GENERATED_FLAG = 'generated';
export function generatedOptIn(search: string): boolean {
  const value = new URLSearchParams(search).get('p2');
  return value !== null && value.split(',').map(part => part.trim()).includes(GENERATED_FLAG);
}

/** Why Accept and Inject are off on a page whose inject path is not loaded (d1's generatedInject, #214). */
export const NOT_CONNECTED = 'Injection is not connected on this page.';
/** Placeholder recipe carried by a fixture preview (StagePreview.recipe is required); never flown, sent or expanded. */
export const PLACEHOLDER_RECIPE: Readonly<Recipe> = Object.freeze({ kind: 'sphere' });
/** The source label of a committed fixture. */
export const OFFLINE_FIXTURE = 'offline fixture';
export { D3_UNAVAILABLE };

export interface FixtureEntry { id: string; file: string; load(): Promise<unknown> }

/** The committed valid fixture scenes, loaded lazily (one chunk each), in file order. */
export function fixtureEntries(): FixtureEntry[] {
  const modules = import.meta.glob<unknown>('../../../tests/fixtures/scenes/valid-*.json', { import: 'default' });
  return Object.keys(modules).sort().map((path) => {
    const file = path.slice(path.lastIndexOf('/') + 1);
    return { id: file.replace(/^valid-/, '').replace(/\.json$/, ''), file, load: modules[path] };
  });
}

/** Where a scene came from. Only `gemini: true` (a Gemini model id from the gateway) may ever be called Gemini. */
export type SceneOrigin = { kind: 'fixture' } | { kind: 'live'; provider: string; gemini: boolean };
/** The pseudo fixture id of a live-generated scene. */
export const LIVE_ID = 'live';

export type GeneratedStatus =
  | { state: 'idle' }
  | { state: 'loading'; fixtureId: string }
  | { state: 'generating'; fixtureId: typeof LIVE_ID; prompt: string; mode: LiveMode }
  | { state: 'compiling'; fixtureId: string; title: string; mode: SceneSpec['mode']; requestId: string | null; origin: SceneOrigin; scene: SceneSpec }
  | { state: 'ready'; fixtureId: string; title: string; mode: SceneSpec['mode']; requestId: string; result: Extract<CompileResult, { ok: true }>; origin: SceneOrigin; scene: SceneSpec }
  | { state: 'rejected'; fixtureId: string; title: string; mode: SceneSpec['mode'] | null; code: string; detail: string; warnings: CompileWarning[]; origin: SceneOrigin; issues?: string[] };

/**
 * An accepted scene, ready to inject (G3): its provenance from the worker's own compile (#214), checked by
 * injectPreflight at this page's n0, and the generated recipe built by makeGeneratedRecipe (GF-WP-07, #215).
 */
export interface AcceptedGeneratedScene {
  scene: SceneSpec; title: string; origin: SceneOrigin;
  provenance: GeneratedProvenance; recipe: GeneratedRecipe; warnings: CompileWarning[];
}
export type AcceptOutcome = { ok: true; handoff: AcceptedGeneratedScene } | { ok: false; reason: string };
/** d1's injectGeneratedRecipe (src/app/ui/generatedInject.ts): one INJECT_SCORE into one drone via the controller. */
export type InjectRecipe = (ctx: ComposeContext, recipe: Recipe, droneId: number, label: string) => Promise<InjectOutcome>;

/**
 * Injects an accepted scene into the one drone `droneId`: injectPreflight again at the moment of sending (the scene,
 * hash, compiler and digest must still check out), then `inject` (d1's path: select → inject intent → controller →
 * one INJECT_SCORE). After a successful injection, `replay` re-derives the formation from the scene and its
 * provenance alone, so the operator sees the flown formation is reproducible. Never throws.
 */
export async function injectAccepted(ctx: ComposeContext, accepted: AcceptedGeneratedScene, droneId: number, inject: InjectRecipe):
  Promise<{ outcome: InjectOutcome; replay: ReplayResult | null }> {
  const pre = injectPreflight(accepted.scene, accepted.provenance, ctx.params);
  if (!pre.ok) return { outcome: { status: 'failed', message: `The scene no longer checks out (${pre.reason}): ${pre.detail}`, results: [] }, replay: null };
  const outcome = await inject(ctx, accepted.recipe, droneId, accepted.title);
  // The provenance the send-time preflight issued for THIS page's parameters, not the one remembered from Accept.
  return { outcome, replay: outcome.status === 'done' ? replayFromProvenance(accepted.scene, pre.provenance) : null };
}

/** The reproducibility line shown after an injection ("Reproducible:", distinct from the event-log replay). */
export function replayText(replay: ReplayResult | null): string {
  if (!replay) return '';
  return replay.ok
    ? `Reproducible: the scene and its provenance alone re-derive the same formation (slots ${replay.provenance.slotsDigest.slice(0, 12)}…).`
    : `Not reproducible (${replay.reason}): ${replay.detail}`;
}

export interface GeneratedSourceContext {
  params: Params;
  client: FormationClient;
  /** With `subscribe`, the tab also redraws when anything else (Escape, the console) changes the stage preview. */
  store: Pick<Store, 'state' | 'set'> & Partial<Pick<Store, 'subscribe'>>;
  fixtures?: FixtureEntry[];
  /** The live generation client; absent unless the build flag and `?p2=generated,live` are both set. */
  live?: GenerateClient | null;
  /** True only when the page has loaded the inject path (d1's injectGeneratedRecipe). Accept is off otherwise. */
  injectConnected?: boolean;
  /** Told when a scene is accepted (the Composer re-renders Transmit). */
  onAccept?: (scene: AcceptedGeneratedScene) => void;
}

export interface GeneratedSource {
  readonly fixtures: readonly FixtureEntry[];
  readonly status: GeneratedStatus;
  /** True when this page offers live generation (a client exists); its answers may still be "unavailable". */
  readonly liveAvailable: boolean;
  /** Loads and compiles one fixture. A selection superseded by a newer one is never applied. */
  select(fixtureId: string): Promise<void>;
  /** Asks the gateway for a scene, re-validates it and compiles it. Without a live client it does nothing. */
  generate(prompt: string, mode: LiveMode, token?: string): Promise<void>;
  /** Shows or hides the stage preview of the compiled scene. Returns whether it is now shown. Hiding also cancels
   *  an in-flight selection, so a hidden preview never comes back when its compile finishes. */
  preview(on: boolean): boolean;
  /** Abandons an in-flight selection (its reply is ignored); the status returns to idle if it was in flight. */
  cancel(): void;
  previewOn(): boolean;
  /** Checks the compiled scene again (injectPreflight) and builds its generated recipe; refuses with a reason. */
  accept(): AcceptOutcome;
  /** The accepted scene, ready to inject; cleared by any new selection or generation. */
  readonly accepted: AcceptedGeneratedScene | null;
  /** Whether the page can inject at all (the inject path is loaded). */
  readonly injectConnected: boolean;
  /** Drops the accepted scene (after a successful send, so the same scene is not re-injected by accident). */
  clearAccepted(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const modeLabel = (mode: SceneSpec['mode'] | null): string => (mode === 'scene3d' ? '3D' : mode === 'silhouette2d' ? '2D' : '?');

/** Plain-language reasons for #259's typed rejection codes, the gateway's codes and the local validation layers. */
const REASONS: Record<string, string> = {
  parse: 'The scene is not readable JSON, or uses a forbidden key.',
  schema: 'The scene does not have the expected shape (a missing, unknown or wrongly typed field).',
  'too-large': 'The scene is larger than the 16 KB limit.',
  'unsupported-version': 'The scene uses a schema version this compiler does not implement.',
  'unsupported-mode': 'This compiler cannot compile scenes of this mode yet.',
  reference: 'A part names a material or an id that does not exist, or ids repeat.',
  range: 'A number is outside its allowed range (positions within ±1.5, sizes 0.005–1, colours 0–1).',
  geometry: 'A shape is malformed (a self-crossing polygon, a bad curve, or a part outside the scene box).',
  complexity: 'The scene has more parts, points or segments than the limits allow.',
  'empty-geometry': 'The scene draws nothing once its parts are combined.',
  'too-few-candidates': 'The shape is too small or too thin to place this many drones.',
  'infeasible-count': 'This many drones cannot be placed at the safe spacing on this shape.',
  'dense-coverage': 'The compiled slots do not cover the shape densely enough.',
  'below-floor': 'The formation would sit below the 2 m minimum altitude.',
  'too-large-world': 'The formation would be larger than 120 m.',
  internal: 'An internal error stopped the compile (a bug, not your scene).',
  'empty-prompt': 'Type a prompt first.',
  UNREACHABLE: 'The gateway could not be reached.',
  PROVIDER_UNAVAILABLE: 'Live generation is switched off on the gateway.',
  VALIDATION_FAILED: 'The gateway refused the request or the model\'s scene as invalid.',
  PAYLOAD_TOO_LARGE: 'The prompt is too long.',
  RATE_LIMITED: 'Too many requests: wait a moment and try again.',
  UNAUTHORIZED: 'The gateway needs its launch token.',
  FORBIDDEN: 'The gateway refused this page (origin or host not allowed).',
  PROVIDER_ERROR: 'The model provider returned an error.',
  TIMEOUT: 'No answer in time.',
  INVALID_RESPONSE: 'The gateway\'s answer could not be read.',
};
export function rejectionReason(code: string): string { return REASONS[code] ?? `Rejected (${code}).`; }

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
  const live = ctx.live ?? null;
  let status: GeneratedStatus = { state: 'idle' };
  let selection = 0;
  /** The accepted scene (G3); any new selection or generation clears it, so Inject never sends a stale one. */
  let accepted: AcceptedGeneratedScene | null = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const set = (next: GeneratedStatus) => { status = next; emit(); };
  // This tab's previews: a committed fixture, or a scene the gateway generated (#213 review: never labelled a fixture).
  const previewOn = () => { const s = ctx.store.state.preview?.source; return s === 'fixture' || s === 'generated'; };
  const showPreview = () => {
    if (status.state !== 'ready') return false;
    const origin = status.origin;
    ctx.store.set({ preview: {
      recipe: { ...PLACEHOLDER_RECIPE }, label: status.title, formation: toFormation(status.result),
      ...(origin.kind === 'fixture' ? { source: 'fixture' as const } : { source: 'generated' as const, provider: origin.provider }),
    } });
    return true;
  };
  /** Never leave an older scene's slots on the stage once this selection has failed. */
  const clearFixturePreview = () => { if (previewOn()) ctx.store.set({ preview: null }); };
  /** The in-flight gateway request, aborted when superseded, cancelled or disposed. */
  let inflight: AbortController | null = null;
  const abortLive = () => { inflight?.abort(); inflight = null; };
  const cancel = () => {
    selection++;
    abortLive();
    if (status.state === 'loading' || status.state === 'compiling' || status.state === 'generating') set({ state: 'idle' });
  };
  const reject = (fixtureId: string, title: string, mode: SceneSpec['mode'] | null, origin: SceneOrigin, code: string, detail: string, warnings: CompileWarning[] = [], issues?: string[]) => {
    clearFixturePreview();
    set({ state: 'rejected', fixtureId, title, mode, code, detail, warnings, origin, ...(issues ? { issues } : {}) });
  };
  // Escape, the console or a draft preview can change the stage preview behind the tab's back: redraw the tab then.
  const offStore = ctx.store.subscribe?.((_state, changed) => { if (changed.includes('preview')) emit(); }) ?? (() => {});

  /** The shared tail of both sources: compile in the worker, then show (or reject). `mine` guards staleness. */
  async function compile(mine: number, fixtureId: string, parsed: { scene: SceneSpec; title: string; mode: SceneSpec['mode'] }, origin: SceneOrigin) {
    set({ state: 'compiling', fixtureId, title: parsed.title, mode: parsed.mode, requestId: null, origin, scene: parsed.scene });
    const pending = ctx.client.compile({ scene: parsed.scene, n0: ctx.params.n0, params: ctx.params });
    if (status.state === 'compiling' && mine === selection) status = { ...status, requestId: ctx.client.latest };
    const reply = await pending;
    if (reply === 'stale' || mine !== selection) return;   // a newer request, a hide or a leave owns the panel now
    const result = reply.result;
    if (result.ok) {
      set({ state: 'ready', fixtureId, title: parsed.title, mode: parsed.mode, requestId: reply.requestId, result, origin, scene: parsed.scene });
      // Re-checked NOW, not remembered from the request: a preview hidden meanwhile (Hide, Escape, the console, a
      // draft preview, leaving the tab) stays hidden, so the stage never shows a scene the operator turned off.
      if (previewOn()) showPreview();
    } else {
      reject(fixtureId, parsed.title, parsed.mode, origin, result.code, result.detail, result.warnings);
    }
  }

  return {
    fixtures,
    get status() { return status; },
    get liveAvailable() { return live !== null; },
    async select(fixtureId) {
      const mine = ++selection;
      accepted = null;
      abortLive();                                    // a fixture pick supersedes any gateway request
      const origin: SceneOrigin = { kind: 'fixture' };
      const entry = fixtures.find(f => f.id === fixtureId);
      if (!entry) { reject(fixtureId, fixtureId, null, origin, 'reference', `no fixture named ${fixtureId}`); return; }
      set({ state: 'loading', fixtureId });
      let raw: unknown;
      try { raw = await entry.load(); } catch (error) {
        if (mine !== selection) return;
        reject(fixtureId, entry.file, null, origin, 'parse', `could not load ${entry.file}: ${String(error)}`);
        return;
      }
      if (mine !== selection) return;                 // a newer selection (or a cancel) happened while this one loaded
      const parsed = asScene(raw);
      if (!parsed) { reject(fixtureId, entry.file, null, origin, 'schema', `${entry.file} is not a scene`); return; }
      await compile(mine, fixtureId, parsed, origin);
    },
    async generate(prompt, mode, token) {
      if (!live) return;                              // no client: the tab shows D3_UNAVAILABLE and never sends
      const mine = ++selection;
      accepted = null;
      abortLive();                                    // a newer request supersedes the older one, which is aborted
      const text = prompt.trim();
      if (text === '') { reject(LIVE_ID, 'live request', mode, { kind: 'live', provider: 'gateway', gemini: false }, 'empty-prompt', 'Nothing was sent.'); return; }
      const controller = new AbortController();
      inflight = controller;
      set({ state: 'generating', fixtureId: LIVE_ID, prompt: text, mode });
      const outcome = await live.generate({ prompt: text, mode, ...(token ? { token } : {}), signal: controller.signal });
      if (inflight === controller) inflight = null;
      if (mine !== selection || (!outcome.ok && outcome.kind === 'cancelled')) return;
      if (!outcome.ok) {
        reject(LIVE_ID, 'live request', mode, { kind: 'live', provider: 'gateway', gemini: false }, outcome.code, outcome.message, [], outcome.details.map(d => `${d.reason}${d.path ? ` at ${d.path}` : ''}`));
        return;
      }
      const origin: SceneOrigin = { kind: 'live', provider: outcome.provider, gemini: outcome.gemini };
      // The gateway's scene is untrusted data: validate it here, with the same validator the compiler uses.
      const checked = validateScene(outcome.scene);
      if (!checked.ok) {
        const title = asScene(outcome.scene)?.title ?? 'generated scene';
        reject(LIVE_ID, title, mode, origin, checked.errors[0]?.code ?? 'schema', 'The returned scene failed validation.', [],
          checked.errors.slice(0, 8).map(e => `${e.code} at ${e.path || '/'}: ${e.message}`));
        return;
      }
      const parsed = asScene(checked.scene);
      if (!parsed || parsed.mode !== mode) { reject(LIVE_ID, 'generated scene', mode, origin, 'schema', `The gateway returned a ${parsed?.mode ?? 'non-scene'} for a ${mode} request.`); return; }
      await compile(mine, LIVE_ID, parsed, origin);
    },
    preview(on) {
      if (!on) { cancel(); clearFixturePreview(); emit(); return false; }
      const shown = showPreview();
      emit();
      return shown;
    },
    cancel,
    previewOn,
    accept() {
      if (!ctx.injectConnected) return { ok: false, reason: NOT_CONNECTED };
      if (status.state !== 'ready') return { ok: false, reason: 'Compile a scene first.' };
      const st = status;
      const source = st.origin.kind === 'fixture' ? 'fixture' : 'live';
      const provenance = provenanceFromCompile(st.scene, st.result, ctx.params, source, source === 'fixture' ? st.fixtureId : undefined);
      if (!provenance) return { ok: false, reason: 'The compile has no provenance.' };
      // The same checks the moment before injecting does, at this page's n0 (#214), then the recipe (GF-WP-07).
      const pre = injectPreflight(st.scene, provenance, ctx.params);
      if (!pre.ok) return { ok: false, reason: `The scene does not check out (${pre.reason}): ${pre.detail}` };
      const made = makeGeneratedRecipe(st.scene, ctx.params.n0, ctx.params);
      if (!made.ok) return { ok: false, reason: `No recipe (${made.code}): ${rejectionReason(made.code)} ${made.detail}`.trim() };
      accepted = { scene: st.scene, title: st.title, origin: st.origin, provenance: pre.provenance, recipe: made.recipe, warnings: made.warnings };
      emit();
      ctx.onAccept?.(accepted);
      return { ok: true, handoff: accepted };
    },
    get accepted() { return accepted; },
    get injectConnected() { return !!ctx.injectConnected; },
    clearAccepted() { if (accepted !== null) { accepted = null; emit(); } },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      selection++;
      abortLive();
      offStore();
      listeners.clear();
      clearFixturePreview();
      ctx.client.dispose();
    },
  };
}

/** "Fixture “Sphere”" or "Generated scene “…” (offline-fake provider (not Gemini))". Never calls a fixture live. */
function noun(origin: SceneOrigin, title: string): string {
  return origin.kind === 'fixture' ? `Fixture “${title}”` : `Generated scene “${title}” (${origin.provider})`;
}

/** The status line, as plain text (also used by tests). */
export function statusText(status: GeneratedStatus, n0: number): string {
  switch (status.state) {
    case 'idle': return 'Pick a fixture scene to compile it for preview.';
    case 'loading': return `Loading fixture ${status.fixtureId}…`;
    case 'generating': return `Asking the gateway for a ${modeLabel(status.mode)} scene…`;
    case 'compiling': return `Compiling ${noun(status.origin, status.title).replace(/^F/, 'f').replace(/^G/, 'g')} (${modeLabel(status.mode)}) in the preview worker…`;
    case 'ready': {
      const s = status.result.stats;
      return `${noun(status.origin, status.title)} (${modeLabel(status.mode)}): ${status.result.formation.slots.length} of ${n0} slots · ${s.size.map(v => v.toFixed(0)).join(' × ')} m · digest ${status.result.slotsDigest.slice(0, 8)}`;
    }
    case 'rejected': {
      if (status.origin.kind === 'live' && status.origin.provider === 'gateway') {
        // An unavailable gateway's message already says it all (once): "live Gemini unavailable (gateway: …)".
        if (status.code === 'PROVIDER_UNAVAILABLE' || status.code === 'UNREACHABLE') return `Live generation did not run: ${status.detail}`;
        return `Live generation did not run: ${status.code}. ${rejectionReason(status.code)} ${status.detail}`.trim();
      }
      return `${noun(status.origin, status.title)} was rejected: ${status.code}. ${rejectionReason(status.code)} ${status.detail}`.trim();
    }
  }
}

/**
 * The provenance line of a compiled scene (agreed with #214): `sceneHash <12>… · compiler v<n> · slots <12>… · fixture
 * <id>` (or `· live <provider>`). Built from the worker's own CompileResult; the hash and digest are recomputed by the
 * compiler, never taken from the gateway.
 */
export function provenanceText(status: GeneratedStatus): string | null {
  if (status.state !== 'ready') return null;
  const r = status.result;
  const tail = status.origin.kind === 'fixture' ? `fixture ${status.fixtureId}` : status.origin.provider;   // the provider label alone
  return `sceneHash ${r.sceneHash.slice(0, 12)}… · compiler v${r.compilerVersion} · slots ${r.slotsDigest.slice(0, 12)}… · ${tail}`;
}

/** The source line: what the operator is looking at, in the honest terms #213 fixes. */
export function sourceText(status: GeneratedStatus): string {
  if (status.state === 'compiling' || status.state === 'ready' || status.state === 'rejected') {
    return status.origin.kind === 'fixture' ? `Source: ${OFFLINE_FIXTURE}` : `Source: ${status.origin.provider}`;
  }
  if (status.state === 'generating') return 'Source: gateway (pending)';
  return `Source: ${OFFLINE_FIXTURE}`;
}

/** The tab's DOM. Every scene-, prompt- or gateway-derived string goes in as a text child. */
export function renderGeneratedSource(source: GeneratedSource, n0: number, onPreviewChange: () => void): HTMLElement {
  const root = h('div', { class: 'field', 'data-generated': '' });
  const chipsBox = h('div', {});
  const statusBox = h('div', {});
  const actionsBox = h('div', {});
  // The live block is built once (its inputs keep focus, IME state and text across redraws).
  let liveBox: HTMLElement;
  let go: HTMLButtonElement | null = null;
  if (source.liveAvailable) {
    const prompt = h('textarea', { class: 'input', rows: 2, maxlength: 500, placeholder: 'Describe a formation…', 'aria-label': 'Formation prompt' });
    const mode = h('select', { class: 'input', 'aria-label': 'Scene mode' }, h('option', { value: 'scene3d' }, '3D'), h('option', { value: 'silhouette2d' }, '2D'));
    const token = h('input', { class: 'input mono', type: 'password', autocomplete: 'new-password', placeholder: 'gateway launch token (if required)', 'aria-label': 'Gateway launch token' });
    go = h('button', { type: 'button', class: 'btn small', 'data-fk': 'generate', onclick: () => { void source.generate(prompt.value, mode.value as LiveMode, token.value.trim() || undefined); } }, 'Generate');
    liveBox = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Live generation · through the gateway'), prompt, h('div', { style: { display: 'flex', gap: '6px' } }, mode, token, go));
  } else {
    liveBox = h('div', { class: 'hint' }, `Live generation: ${D3_UNAVAILABLE}. Scenes come from offline fixtures.`);
  }
  let lastActive: string | null = null;
  let acceptError = '';
  const draw = () => {
    const st = source.status;
    if (go) go.disabled = st.state === 'generating';   // one gateway request at a time
    const active = st.state === 'idle' ? null : st.fixtureId;
    chipsBox.replaceChildren(h('div', { class: 'drafts', role: 'radiogroup', 'aria-label': 'Fixture scenes' },
      ...source.fixtures.map(f => h('button', {
        type: 'button', class: 'chip', role: 'radio', 'data-fk': `fixture-${f.id}`, 'aria-checked': String(f.id === active),
        onclick: () => { void source.select(f.id); },
      }, f.id, h('span', { class: 'hint' }, ` · ${OFFLINE_FIXTURE}`)))));
    const warnings = st.state === 'ready' ? st.result.warnings : st.state === 'rejected' ? st.warnings : [];
    const issues = st.state === 'rejected' ? st.issues ?? [] : [];
    const provenance = provenanceText(st);
    statusBox.replaceChildren(
      h('div', { class: 'hint' }, sourceText(st)),
      h('div', { class: st.state === 'rejected' ? 'hint err' : 'hint', role: st.state === 'rejected' ? 'alert' : 'status' }, statusText(st, n0)),
      ...(provenance ? [h('div', { class: 'hint mono' }, provenance)] : []),
      ...issues.slice(0, 8).map(issue => h('div', { class: 'hint err' }, '✕ ', issue)),
      ...warnings.slice(0, 6).map(w => h('div', { class: 'hint warn' }, '▲ ', `${w.code}${w.partId ? ` (${w.partId})` : ''}: ${w.detail}`)));
    actionsBox.replaceChildren(
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h('button', {
          type: 'button', class: 'btn small', 'data-fk': 'generated-preview', 'aria-pressed': String(source.previewOn()), disabled: st.state !== 'ready',
          onclick: () => { source.preview(!source.previewOn()); onPreviewChange(); },
        }, source.previewOn() ? 'Hide stage preview' : 'Preview in stage'),
        h('button', {
          type: 'button', class: 'btn small', 'data-fk': 'generated-accept', 'aria-pressed': String(source.accepted !== null),
          disabled: !source.injectConnected || st.state !== 'ready' || source.accepted !== null, 'aria-describedby': 'gen-accept-reason',
          onclick: source.injectConnected ? () => { const r = source.accept(); acceptError = r.ok ? '' : r.reason; draw(); onPreviewChange(); } : undefined,
        }, source.accepted ? 'Accepted' : 'Accept for injection')),
      h('div', { class: acceptError ? 'hint err' : 'hint', id: 'gen-accept-reason', role: acceptError ? 'alert' : undefined },
        !source.injectConnected ? NOT_CONNECTED
          : acceptError ? acceptError
            : source.accepted ? `Accepted: recipe ready (slots ${source.accepted.provenance.slotsDigest.slice(0, 12)}…). Choose a live drone under Transmit, then inject.`
              : 'Accept checks the scene again and builds its recipe; then choose ONE live drone and inject.'),
      h('div', { class: 'hint' }, 'The stage shows the target arrangement only. The swarm flies it only after you inject into one drone and the score spreads by radio.'));
    if (st.state !== 'ready') acceptError = '';
    if (active !== lastActive) {
      lastActive = active;
      const chip = active ? chipsBox.querySelector<HTMLElement>(`[data-fk="fixture-${CSS.escape(active)}"]`) : null;
      chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };
  root.replaceChildren(h('span', { class: 'label' }, source.liveAvailable ? 'Generated · offline fixtures or the live gateway' : 'Generated · offline fixtures (committed scenes)'), chipsBox, liveBox, statusBox, actionsBox);
  source.subscribe(draw);
  draw();
  return root;
}
