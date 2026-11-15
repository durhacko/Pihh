// Formation composer (FE-B2 #93; UI-03, UI-05): define → validate → preview locally → choose ONE drone → inject.
// Editing never commands the swarm. The only thing that leaves this panel is an INJECT_SCORE into one drone, and it
// leaves through the console grammar and the one action controller: the Inject button parses the same
// `inject --drone N --draft D` line the console would, so both paths produce the same EnvEvent (FR-34).
//
// This module also holds the inject path the console shares (drafts, validation, plan dispatch, picks, adoption),
// because the issue's allowed files are Composer.ts, Console.ts and PreviewLayer.ts. No createPanel export: the
// panel loader skips it, and the shell mounts it with connectComposer(ctx).
import type { EnvEvent, MetricsSample, Params, Recipe, RGB, WorldSnapshot } from '../../contracts';
import { expandRecipe } from '../../score';
import { defaultPalette } from '../../score/shapes';
import type { ControlIntent, ControlResult, ControlStatus } from '../actions';
import { versionColour, versionKey } from '../render/colourModes/belief';
import { readViewMode } from '../render/colourModes/viewMode';
import { connectPreview } from '../render/layers/PreviewLayer';
import type { Pair } from '../worlds';
import { liveState, NAME_MAX, parse, shouldDispatch, TEXT_MAX, validateText, withRecipe, type ControlPlan, type InjectPlan, type ParseContext } from './commands';
import { h } from './dom';
import { icon } from './icons';
import { hexToRgb, rgbToHex, type PickRequest, type Store } from './store';
import type { Surfaces } from './surfaces';

// ------------------------------------------------------------------------------------------- drafts

export interface Draft { id: string; name: string; kind: Recipe['kind']; text: string; palette: [RGB, RGB] | null; sent: string[] }
export type DraftInput = Omit<Draft, 'id' | 'sent'>;

const DEFAULT_DRAFTS: readonly DraftInput[] = [
  { name: 'Durhack', kind: 'text', text: 'DURHACK', palette: [[0, 0.72, 0.62], [0.98, 0.78, 0.22]] },
  { name: 'Orb', kind: 'sphere', text: '', palette: null },
];

/** Local drafts. Nothing here reaches a world until one is injected. */
export class Drafts {
  private items: Draft[] = [];
  private currentId = '';
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(initial: readonly DraftInput[] = DEFAULT_DRAFTS) {
    for (const draft of initial) this.add(draft, false);
    this.currentId = this.items[0]?.id ?? '';
  }
  get list(): readonly Draft[] { return this.items; }
  get current(): Draft {
    const found = this.items.find(draft => draft.id === this.currentId);
    if (!found) throw new Error('No drafts');
    return found;
  }
  get(id: string): Draft | undefined { return this.items.find(draft => draft.id === id); }
  /** The draft `id`, or the current one for null; undefined (never a throw) when the store has none. */
  find(id: string | null): Draft | undefined { return id === null ? this.items.find(draft => draft.id === this.currentId) : this.get(id); }
  /** Adds a draft and makes it current. */
  add(input: DraftInput, notify = true): Draft {
    const draft: Draft = { ...structuredClone(input), id: `d${++this.seq}`, sent: [] };
    this.items.push(draft);
    this.currentId = draft.id;
    if (notify) this.emit();
    return draft;
  }
  update(patch: Partial<DraftInput>, id = this.currentId): void {
    const draft = this.get(id);
    if (!draft) return;
    Object.assign(draft, structuredClone(patch));
    this.emit();
  }
  select(id: string): boolean {
    if (!this.get(id)) return false;
    this.currentId = id; this.emit();
    return true;
  }
  markSent(id: string, key: string): void { this.get(id)?.sent.push(key); this.emit(); }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of [...this.listeners]) fn(); }
}

/** A console `form …` result (a recipe) as a draft. */
export function draftFromRecipe(name: string, recipe: Recipe): DraftInput {
  return { name, kind: recipe.kind, text: recipe.kind === 'text' ? recipe.text : '', palette: recipe.palette ? structuredClone(recipe.palette) : null };
}

export interface Validation { ok: boolean; errors: string[]; warnings: string[]; recipe: Recipe | null }

/** Validates a draft against the score package itself (its font table and expandRecipe), not a UI copy of its rules. */
export function validateDraft(draft: Draft, params: Params): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!draft.name.trim()) errors.push('Give the formation a name.');
  else if ([...draft.name].length > NAME_MAX) errors.push(`The name is longer than ${NAME_MAX} characters.`);
  let recipe: Recipe;
  if (draft.kind === 'text') {
    const problem = validateText(draft.text);
    if (problem) errors.push(problem);
    const letters = draft.text.replace(/ /g, '').length;
    if (!problem && draft.text.length > 10 && letters) warnings.push(`${draft.text.length} characters: at ${params.n0} drones each glyph gets about ${Math.round(params.n0 / letters)} drones and reads thinly.`);
    recipe = { kind: 'text', text: draft.text.toUpperCase(), ...(draft.palette ? { palette: draft.palette } : {}) };
  } else recipe = { kind: draft.kind, ...(draft.palette ? { palette: draft.palette } : {}) };
  for (const [r, g, b] of draft.palette ?? []) {
    if (r > 0.92 && g > 0.92 && b > 0.92) warnings.push('White is reserved for selection and deaf markers; it may read as a diagnostic.');
    else if (r > 0.9 && g > 0.25 && g < 0.45 && b < 0.2) warnings.push('Vermilion is reserved for vacant slots and jams.');
    else if (b > 0.75 && r < 0.25 && g < 0.35) warnings.push('Pure blue renders dim against the night sky.');
  }
  if (!errors.length) {
    try { expandRecipe(recipe, params.n0, params); } catch (error) { errors.push(`The score package rejected it: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], recipe: errors.length ? null : recipe };
}

// ------------------------------------------------------------------------- the shared action path

/** What bindControls (src/app/actions.ts) returns, as far as the composer and console need it. */
export interface ControllerLike {
  handle(intent: ControlIntent): ControlResult;
  status(): ControlStatus;
  getEventLog(): EnvEvent[];
}

/** Everything the inject path reads. The console's context extends it. */
export interface ComposeContext {
  controller: ControllerLike;
  store: Store;
  drafts: Drafts;
  params: Params;
  snapshots(): Pair<WorldSnapshot>;
  /** Newest observer MetricsSample per world (worlds.samples()). The adoption bar reads only this. */
  samples(): Pair<MetricsSample | null>;
  /** Where bindControls emits 'encore:control-status' (the app root). The Composer listens there to follow the selection. */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

export function parseContext(ctx: ComposeContext): ParseContext {
  const status = ctx.controller.status();
  return { snapshot: ctx.snapshots().encore, seed: status.seed, drafts: ctx.drafts.list.map(draft => draft.id), selectedId: status.selectedId, killRadius: ctx.store.state.killRadius, jamRadius: ctx.store.state.jamRadius };
}

/**
 * Asks the user to click a drone. Resolves with its id, or null when cancelled (Escape via handleEscape, another pick,
 * or a new command). Answered ONLY by the stage resolving store.pick from a real click on a drone (the shell, #113).
 * A selection change (a Select button, `inspect`, the controls) never answers it: otherwise a waiting
 * `fault kill-region --pick` would kill around whatever drone was selected next.
 */
export function requestPick(ctx: Pick<ComposeContext, 'store'>, purpose: PickRequest['purpose'], prompt: string): Promise<number | null> {
  ctx.store.state.pick?.resolve(null);
  return new Promise(resolve => {
    let done = false;
    let unsubscribe = () => {};
    const finish = (id: number | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      if (ctx.store.state.pick === request) ctx.store.set({ pick: null, pickPoint: null });
      resolve(id);
    };
    const request: PickRequest = { purpose, prompt, resolve: result => finish(result?.droneId ?? null) };
    // Something replaced or cleared the request without resolving it (e.g. handleEscape clears, then resolves): cancel.
    unsubscribe = ctx.store.subscribe((state, changed) => { if (changed.includes('pick') && state.pick !== request) finish(null); });
    ctx.store.set({ pick: request, pickPoint: null });
  });
}

/** A new command cancels a pick that is still waiting; it never answers it (only a stage click may). */
export function cancelPendingPick(ctx: Pick<ComposeContext, 'store'>): void { ctx.store.state.pick?.resolve(null); }

export type PlanOutcome =
  /** `logStart`: the controller event-log index of this plan's first event (its events follow in order). */
  | { status: 'done'; message: string; results: ControlResult[]; events: EnvEvent[]; logStart: number }
  | { status: 'already'; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'failed'; message: string; results: ControlResult[] };

function purposeOf(plan: ControlPlan): PickRequest['purpose'] {
  return plan.command === 'inject' ? 'inject' : plan.command === 'fault kill-region' ? 'killRegion' : plan.command === 'fault jam' ? 'jam' : 'select';
}

/**
 * Runs a parsed plan through the one action controller, exactly as the buttons do: precondition, optional stage
 * pick, then each ControlIntent step in order, stopping at the first failure. A selection made by the plan's own
 * leading select step is undone if a later step fails (commands.ts contract).
 */
export async function runControlPlan(ctx: ComposeContext, plan: ControlPlan): Promise<PlanOutcome> {
  const inEffect = () => !shouldDispatch(plan, liveState(ctx.controller.status(), ctx.snapshots().encore, ctx.controller.getEventLog()));
  const already = { status: 'already', message: `${plan.command}: already in effect. Nothing was sent.` } as const;
  if (inEffect()) return already;
  const previous = ctx.controller.status().selectedId;
  let steps = plan.steps;
  if (plan.pick) {
    const id = await requestPick(ctx, purposeOf(plan), plan.pick);
    if (id === null) return { status: 'cancelled', message: `${plan.command}: pick cancelled. Nothing was sent.` };
    if (inEffect()) return already;   // the state may have changed while waiting for the click (e.g. J pressed)
    steps = [{ type: 'select', id }, ...steps];
  } else cancelPendingPick(ctx);
  const logStart = ctx.controller.getEventLog().length;
  const results: ControlResult[] = [];
  for (const [index, step] of steps.entries()) {
    const result = ctx.controller.handle(step);
    results.push(result);
    if (!result.ok) {
      if (index > 0 && steps[0].type === 'select' && results[0].ok && ctx.controller.status().selectedId !== previous) ctx.controller.handle({ type: 'select', id: previous });
      return { status: 'failed', message: result.message, results };
    }
  }
  return { status: 'done', message: results[results.length - 1]?.message ?? 'Done.', results, events: results.flatMap(result => (result.event ? [result.event] : [])), logStart };
}

/** What a successful inject produced: enough to follow its adoption in the observer. */
export interface SentRecord { key: string; name: string; draftId: string; droneId: number; tick: number }
export type InjectOutcome = PlanOutcome & { sent?: SentRecord };

/** The inject path shared by the console and the Composer button. An invalid draft never reaches the controller. */
export async function dispatchInject(ctx: ComposeContext, plan: InjectPlan): Promise<InjectOutcome> {
  const draft = ctx.drafts.find(plan.draftId);
  if (!draft) return { status: 'failed', message: plan.draftId === null ? 'There is no draft. Create one with form text "WORD" (or form sphere).' : `No draft "${plan.draftId}". Type drafts.`, results: [] };
  const validation = validateDraft(draft, ctx.params);
  if (!validation.ok || !validation.recipe) return { status: 'failed', message: `Draft “${draft.name}” is not valid: ${validation.errors[0]}`, results: [] };
  // Captured together with the recipe, before any pick: what is reported as sent is the draft as it was when the
  // command was given, even if the user edits or renames it while the stage waits for a click.
  const name = draft.name;
  const draftId = draft.id;
  const outcome = await runControlPlan(ctx, withRecipe(plan, validation.recipe));
  if (outcome.status !== 'done') return outcome;
  const event = outcome.events.find((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');
  if (!event) return outcome;
  const sent: SentRecord = { key: versionKey(event.score.version), name, draftId, droneId: event.droneId, tick: event.tick };
  ctx.drafts.markSent(draftId, sent.key);
  ctx.store.set({ preview: null });
  return { ...outcome, sent };
}

/** The console line the Composer's Inject button runs. */
export function injectCommand(draftId: string, droneId: number): string { return `inject --drone ${droneId} --draft ${draftId}`; }

/** The Composer button: the same console grammar, the same dispatch. */
export async function injectFromComposer(ctx: ComposeContext, draftId: string, droneId: number): Promise<InjectOutcome> {
  const parsed = parse(injectCommand(draftId, droneId), parseContext(ctx));
  if (!parsed.ok) return { status: 'failed', message: parsed.error, results: [] };
  if (parsed.intent.kind !== 'inject') return { status: 'failed', message: 'Not an inject command.', results: [] };
  return dispatchInject(ctx, parsed.intent);
}

/** "Preview in stage": local only. It sets store.preview (drawn by PreviewLayer) and never touches the controller. */
export function setPreview(ctx: Pick<ComposeContext, 'store' | 'drafts' | 'params'>, on: boolean): Validation {
  const draft = ctx.drafts.find(null);
  if (!draft) {
    ctx.store.set({ preview: null });
    return { ok: false, errors: ['There is no draft to preview.'], warnings: [], recipe: null };
  }
  const validation = validateDraft(draft, ctx.params);
  ctx.store.set({ preview: on && validation.ok && validation.recipe ? { recipe: validation.recipe, label: draft.name } : null });
  return validation;
}

export interface ArmAdoption { count: number; alive: number; share: number }
/** 'scheduled' until the observer has a sample at or after the injection tick; then the measured counts. */
export interface Adoption { state: 'scheduled' | 'measured'; sampleTick: number | null; encore: ArmAdoption | null; static: ArmAdoption | null }

/** Adoption of an injected version, read ONLY from observer MetricsSample.versions (never from beliefs or guesses). */
export function adoption(samples: Pair<MetricsSample | null>, sent: Pick<SentRecord, 'key' | 'tick'>): Adoption {
  const arm = (sample: MetricsSample | null): ArmAdoption | null => {
    if (!sample || sample.tick < sent.tick) return null;
    const count = sample.versions[sent.key] ?? 0;
    return { count, alive: sample.alive, share: sample.alive ? count / sample.alive : 0 };
  };
  const encore = arm(samples.encore);
  return { state: encore ? 'measured' : 'scheduled', sampleTick: samples.encore?.tick ?? null, encore, static: arm(samples.static) };
}

// ---------------------------------------------------------------------------------------- the panel

const SWATCHES = ['#FFB000', '#FF3D7F', '#00C2A8', '#B6F500', '#9B7BFF', '#FFD84D', '#36C5F0', '#FF8C42'] as const;
const LATER_TYPES = ['Point cloud', 'SVG outline', 'Parametric', 'Preset library', 'Light patterns'];
const css = (rgb: readonly number[]) => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
/** The colours a draft without its own palette will really fly: the score package's defaults, not a UI copy. */
const paletteOf = (draft: Draft): [RGB, RGB] => draft.palette ?? defaultPalette(draft.kind);

export interface ComposerContext extends ComposeContext {
  /** The element the panel is appended to (the app root). Also used as `events` when that is not given. */
  host: HTMLElement;
  /** When given, the panel registers as the 'composer' panel surface (closed until opened). */
  surfaces?: Surfaces;
}
export interface ComposerHandle { el: HTMLElement; open(): void; render(): void; dispose(): void }

/**
 * Mounts the Composer panel and connects the stage preview to the store. Call once; dispose on HMR.
 * The text fields (name, text, target id) are created once and never rebuilt, so typing, IME composition and native
 * undo survive every refresh. The other regions are rebuilt on change and restore focus by a stable data-fk key.
 */
export function connectComposer(input: ComposerContext): ComposerHandle {
  const ctx: ComposerContext = { ...input, events: input.events ?? input.host };
  const { drafts, store, params } = ctx;
  // The panel always edits a current draft: an empty store (e.g. new Drafts([])) gets the default first draft.
  if (!drafts.find(null)) drafts.add(DEFAULT_DRAFTS[0]);
  const disconnectPreview = connectPreview(store);

  // Per-panel state
  let pickedDrone: number | null = null;
  let ownPick: PickRequest | null = null;
  let pickSeq = 0;
  let busy = false;
  let lastSent: SentRecord | null = null;
  let feedback: { ok: boolean; text: string } | null = null;
  let nextEnd: 0 | 1 = 0;
  let paletteDraft = '';
  let thumbKey = '';
  let thumbFormation: ReturnType<typeof expandRecipe> | null = null;
  let targetSig = '';

  // Persistent fields
  const nameInput = h('input', { class: 'input', id: 'cmp-name', maxlength: NAME_MAX, autocomplete: 'off' });
  const textInput = h('input', { class: 'input mono', id: 'cmp-text', maxlength: TEXT_MAX, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-describedby': 'cmp-text-hint' });
  const textHint = h('div', { class: 'hint', id: 'cmp-text-hint' });
  const idInput = h('input', { class: 'input mono', id: 'cmp-target', inputmode: 'numeric', placeholder: 'id', 'aria-label': 'Target drone id', autocomplete: 'off' });
  const textField = h('div', { class: 'field' }, h('label', { for: 'cmp-text' }, 'Text'), textInput, textHint);

  // Regions
  const chipsBox = h('div', { class: 'field' });
  const stepperBox = h('div', { class: 'stepper', 'aria-hidden': 'true' });
  const typeBox = h('div', { class: 'field' });
  const errorsBox = h('div', {});
  const lightBox = h('div', { class: 'field' });
  const previewBox = h('div', { class: 'field' });
  const warningsBox = h('div', {});
  const pickBox = h('span', {});
  const statusBox = h('div', { class: 'status-line', role: 'status' });
  const actionBox = h('div', {});
  const sentBox = h('div', {});
  const body = h('div', { class: 'body' }, chipsBox, stepperBox, h('div', { class: 'field' }, h('label', { for: 'cmp-name' }, 'Name'), nameInput), typeBox, textField, errorsBox, lightBox, previewBox, warningsBox);
  const foot = h('div', { class: 'foot' },
    h('div', { class: 'sec-title' }, h('span', { class: 'eyebrow' }, 'Transmit')),
    h('div', { class: 'target-row' }, idInput, pickBox), statusBox, actionBox,
    h('div', { class: 'hint' }, 'Other drones learn the score only from delivered SCORE messages. The static baseline ignores uplinks: a capability difference, not a score.'),
    sentBox);
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close composer', html: icon.close });
  const el = h('aside', { class: 'side left surface chrome', 'aria-label': 'Formation composer' },
    h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, 'Compose'), h('div', { class: 'sub' }, 'Drafts stay local until you transmit one.')), h('span', { class: 'spacer' }), closeBtn),
    body, foot);
  ctx.host.append(el);
  if (ctx.surfaces) ctx.surfaces.register({ id: 'composer', kind: 'panel', el, onOpen: () => render(), focusOnOpen: () => (drafts.current.kind === 'text' ? textInput : nameInput) });
  closeBtn.addEventListener('click', () => { if (ctx.surfaces?.isOpen('composer')) ctx.surfaces.close('composer'); else el.hidden = true; });

  const visible = () => !el.hidden;
  const previewOn = () => store.state.preview !== null;
  const refreshPreview = () => { if (previewOn()) setPreview(ctx, true); };
  nameInput.addEventListener('input', () => drafts.update({ name: nameInput.value }));
  textInput.addEventListener('input', () => { drafts.update({ text: textInput.value.toUpperCase() }); refreshPreview(); });
  idInput.addEventListener('input', () => {
    const n = Number(idInput.value);
    pickedDrone = idInput.value.trim() !== '' && Number.isSafeInteger(n) ? n : null;
    renderTransmit();
  });

  /** Rebuilds `box` with `children`, keeping keyboard focus on the element with the same data-fk key. */
  function fill(box: HTMLElement, ...children: (Node | null)[]) {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && box.contains(active) ? active.dataset.fk : undefined;
    box.replaceChildren(...children.filter((c): c is Node => c !== null));
    if (key) box.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`)?.focus();
  }

  function render() {
    if (!visible()) return;
    const draft = drafts.current;
    const v = validateDraft(draft, params);
    if (draft.id !== paletteDraft) { paletteDraft = draft.id; nextEnd = 0; }
    if (document.activeElement !== nameInput && nameInput.value !== draft.name) nameInput.value = draft.name;
    if (document.activeElement !== textInput && textInput.value !== draft.text) textInput.value = draft.text;

    fill(chipsBox, h('span', { class: 'eyebrow' }, 'Drafts'),
      h('div', { class: 'drafts', role: 'group', 'aria-label': 'Drafts' },
        ...drafts.list.map(item => h('button', { type: 'button', class: 'chip', 'data-fk': `chip-${item.id}`, 'aria-pressed': String(item.id === draft.id), onclick: () => { drafts.select(item.id); refreshPreview(); } },
          h('span', { class: 'dot', style: { background: rgbToHex(paletteOf(item)[0]) } }), item.name,
          item.sent.length ? h('span', { class: 'hint' }, ' · sent') : null)),
        h('button', { type: 'button', class: 'chip add', 'data-fk': 'add', onclick: () => { drafts.add({ name: `Draft ${drafts.list.length + 1}`, kind: 'text', text: 'ENCORE', palette: null }); refreshPreview(); } }, '+ New')));

    stepperBox.replaceChildren(
      h('span', { class: v.ok ? 'on' : '' }, h('span', { class: 'n' }, '1')), 'Shape', h('span', { class: 'line' }),
      h('span', { class: previewOn() ? 'on' : '' }, h('span', { class: 'n' }, '2')), 'Preview', h('span', { class: 'line' }),
      h('span', { class: lastSent ? 'on' : '' }, h('span', { class: 'n' }, '3')), 'Transmit');

    const kinds: [Recipe['kind'], string, string][] = [['text', 'Text', icon.text], ['sphere', 'Sphere', icon.sphere], ['helix', 'Double helix', icon.helix]];
    fill(typeBox, h('span', { class: 'label', id: 'cmp-type-label' }, 'Formation'),
      h('div', { class: 'types', role: 'radiogroup', 'aria-labelledby': 'cmp-type-label' },
        ...kinds.map(([kind, label, glyph]) => h('button', { type: 'button', class: 'type', role: 'radio', 'data-fk': `type-${kind}`, 'aria-checked': String(draft.kind === kind), onclick: () => { drafts.update({ kind, text: kind === 'text' ? draft.text || 'ENCORE' : draft.text }); refreshPreview(); } }, h('span', { html: glyph }), label))),
      h('div', { class: 'future-types' }, h('span', { class: 'tag later' }, 'Later'),
        ...LATER_TYPES.map(type => h('span', { class: 'ft', title: `${type}: not in the Recipe contract yet; needs a new Recipe kind through a [contract] PR.` }, type))));

    // Text, validated live against the font table and expandRecipe
    textField.hidden = draft.kind !== 'text';
    textInput.setAttribute('aria-invalid', String(draft.kind === 'text' && !v.ok));
    const letters = draft.text.replace(/ /g, '').length;
    textHint.textContent = `5×7 bitmap font: A–Z, 0–9, space · ${[...draft.text].length}/${TEXT_MAX}${letters ? ` · about ${Math.round(params.n0 / letters)} drones per glyph` : ''}`;
    errorsBox.replaceChildren(...v.errors.map(error => h('div', { class: 'hint err', role: 'alert' }, '✕ ', error)));

    // Light: a two-colour gradient. Swatches fill the start, then the end, alternately.
    const palette = paletteOf(draft);
    const setEnd = (index: 0 | 1, hex: string) => { const next: [RGB, RGB] = [[...palette[0]], [...palette[1]]]; next[index] = hexToRgb(hex); drafts.update({ palette: next }); refreshPreview(); };
    const endpoint = (index: 0 | 1) => {
      const picker = h('input', { type: 'color', 'data-fk': `picker-${index}`, value: rgbToHex(palette[index]).toLowerCase(), 'aria-label': index ? 'End colour' : 'Start colour' });
      const swatch = h('label', { class: 'swatch-btn', style: { background: rgbToHex(palette[index]) }, title: index ? 'End colour (right edge)' : 'Start colour (left edge)' }, picker);
      picker.addEventListener('input', () => { swatch.style.background = picker.value; });
      picker.addEventListener('change', () => setEnd(index, picker.value));
      return swatch;
    };
    fill(lightBox, h('span', { class: 'label' }, 'Light · two-colour gradient across the formation'),
      h('div', { class: 'palette' }, endpoint(0), h('div', { class: 'grad', style: { background: `linear-gradient(90deg, ${rgbToHex(palette[0])}, ${rgbToHex(palette[1])})` } }), endpoint(1)),
      h('div', { class: 'swatches', role: 'group', 'aria-label': `Suggested colours (next: ${nextEnd ? 'end' : 'start'})` },
        ...SWATCHES.map(hex => h('button', { type: 'button', class: 'sw', 'data-fk': `sw-${hex}`, style: { background: hex }, 'aria-label': `Use ${hex} for the ${nextEnd ? 'end' : 'start'} colour`, title: hex, onclick: () => { const end = nextEnd; nextEnd = nextEnd ? 0 : 1; setEnd(end, hex); } }))),
      h('div', { class: 'hint' }, draft.palette
        ? h('button', { type: 'button', class: 'btn ghost small', 'data-fk': 'default-palette', onclick: () => { nextEnd = 0; drafts.update({ palette: null }); refreshPreview(); } }, 'Use the default palette')
        : 'Default palette from the score package. Swatches fill the start, then the end.'));

    // Thumbnail, front view (x, y), from expandRecipe itself
    const canvas = h('canvas', { class: 'thumb', width: 640, height: 216, role: 'img', 'aria-label': `Front view of ${draft.name}` });
    if (v.ok && v.recipe) {
      const key = JSON.stringify(v.recipe);
      if (key !== thumbKey) { thumbKey = key; thumbFormation = expandRecipe(v.recipe, params.n0, params); }
      const formation = thumbFormation!;
      const g = canvas.getContext('2d');
      if (g) {
        const w = formation.bounds.max[0] - formation.bounds.min[0];
        const hgt = formation.bounds.max[1] - formation.bounds.min[1];
        const scale = Math.min(560 / Math.max(w, 1), 170 / Math.max(hgt, 1));
        for (const slot of formation.slots) {
          const x = 320 + (slot.pos[0] - (formation.bounds.min[0] + w / 2)) * scale;
          const y = 108 - (slot.pos[1] - (formation.bounds.min[1] + hgt / 2)) * scale;
          g.fillStyle = css(slot.colour); g.globalAlpha = 0.9 - 0.5 * slot.index / formation.slots.length;
          g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill();
        }
      }
    }
    fill(previewBox,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'label', style: { flex: '1' } }, `Preview · ${params.n0} priority-ordered slots`),
        h('button', { type: 'button', class: 'btn small', 'data-fk': 'preview', 'aria-pressed': String(previewOn()), disabled: !v.ok, onclick: () => { setPreview(ctx, !previewOn()); render(); } }, h('span', { html: icon.eye }), previewOn() ? 'Hide stage preview' : 'Preview in stage')),
      canvas, h('div', { class: 'hint' }, 'Brighter dots are higher-priority slots. The stage preview is drawn locally and sends nothing.'));
    warningsBox.replaceChildren(...v.warnings.map(warning => h('div', { class: 'hint warn' }, '▲ ', warning)));
    renderTransmit();
  }

  function targetSignature(): string {
    const id = pickedDrone ?? ctx.controller.status().selectedId;
    const snapshot = ctx.snapshots().encore;
    const drone = id === null ? undefined : snapshot.drones[id];
    if (!drone) return `none:${id}`;
    const jams = snapshot.jams.filter(jam => (drone.pos[0] - jam.centre[0]) ** 2 + (drone.pos[1] - jam.centre[1]) ** 2 + (drone.pos[2] - jam.centre[2]) ** 2 <= jam.radius ** 2).map(jam => jam.id);
    return `${drone.id}|${drone.alive}|${jams.join(',')}|${drone.partitionSide}|${versionKey(drone.belief.version)}|${ctx.controller.status().composition}`;
  }

  // Transmit: one live drone, its status, then inject
  function renderTransmit() {
    if (!visible()) return;
    targetSig = targetSignature();
    const draft = drafts.current;
    const v = validateDraft(draft, params);
    const status = ctx.controller.status();
    const targetId = pickedDrone ?? status.selectedId;
    const snapshot = ctx.snapshots().encore;
    const target = targetId === null ? undefined : snapshot.drones[targetId];
    if (document.activeElement !== idInput) idInput.value = targetId === null ? '' : String(targetId);
    const picking = ownPick !== null && store.state.pick === ownPick;
    fill(pickBox, h('button', { type: 'button', class: 'btn', 'data-fk': 'pick', 'aria-pressed': String(picking), onclick: () => (picking ? cancelPendingPick(ctx) : void pick()) },
      h('span', { html: icon.target }), picking ? 'Click a drone in the stage… (click to cancel)' : 'Pick in stage'));
    const parts: HTMLElement[] = [];
    if (target) {
      const inJam = snapshot.jams.filter(jam => (target.pos[0] - jam.centre[0]) ** 2 + (target.pos[1] - jam.centre[1]) ** 2 + (target.pos[2] - jam.centre[2]) ** 2 <= jam.radius ** 2);
      parts.push(h('span', { class: target.alive ? 'ok' : 'no' }, `drone ${target.id} · ${target.alive ? 'alive' : 'dead'}`));
      parts.push(h('span', { class: inJam.length ? 'bad' : 'ok' }, inJam.length ? 'inside a jam: it receives the uplink but cannot relay it until it leaves' : 'radio clear'));
      if (target.partitionSide !== null) parts.push(h('span', { class: 'bad' }, `partition group ${target.partitionSide}: the score stays on this side`));
      parts.push(h('span', {}, `holds score v${versionKey(target.belief.version)}`));
    } else parts.push(h('span', { class: 'hint' }, targetId === null ? 'Choose a drone: the uplink reaches only that one.' : `No drone ${targetId} in this roster.`));
    statusBox.replaceChildren(...parts);
    const reason = !status.composition ? 'Score injection is not connected to the simulation.' : !v.ok ? 'Fix the draft first.' : !target?.alive ? 'Choose a live drone.' : busy ? 'Sending…' : '';
    const command = targetId === null ? `inject --drone <id> --draft ${draft.id}` : injectCommand(draft.id, targetId);
    fill(actionBox,
      h('button', { type: 'button', class: 'btn primary', 'data-fk': 'inject', disabled: !!reason, 'aria-describedby': reason ? 'cmp-inject-reason' : undefined, onclick: () => void inject(draft.id, targetId) },
        h('span', { html: icon.inject }), targetId !== null ? `Inject “${draft.name}” into drone ${targetId}` : 'Inject into one drone'),
      reason && !busy ? h('div', { class: 'hint', id: 'cmp-inject-reason' }, reason) : null,
      h('div', { class: 'cmd-echo', title: 'The same action as a console command' }, h('span', {}, `› ${command}`)),
      feedback ? h('div', { class: `hint ${feedback.ok ? '' : 'err'}`, role: feedback.ok ? 'status' : 'alert' }, feedback.text) : null);
    fill(sentBox, lastSent ? sentCard(lastSent) : null);
    updateAdoption();
  }

  async function pick() {
    const mine = ++pickSeq;
    const pending = requestPick(ctx, 'inject', 'Click the drone that will receive the uplink (Esc cancels)');
    ownPick = store.state.pick;
    renderTransmit();
    const id = await pending;
    if (mine !== pickSeq) return;
    ownPick = null;
    if (id !== null) pickedDrone = id;
    renderTransmit();
  }

  async function inject(draftId: string, targetId: number | null) {
    if (targetId === null || busy) return;
    busy = true; renderTransmit();
    const outcome = await injectFromComposer(ctx, draftId, targetId);
    busy = false;
    if (outcome.sent) { lastSent = outcome.sent; feedback = { ok: true, text: `${outcome.message} Adoption is measured by the observer below.` }; }
    else feedback = { ok: outcome.status === 'done', text: outcome.message };
    render();
  }

  const bar = h('div', { class: 'bar', role: 'meter', 'aria-label': 'Adoption of the injected score (observer)', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' });
  const barFill = h('i', { style: { width: '0%' } });
  bar.append(barFill);
  const barText = h('span', { class: 'mono hint' });
  function sentCard(sent: SentRecord): HTMLElement {
    const colour = css(versionColour(parseVersion(sent.key)));
    barFill.style.background = colour;
    const beliefButton = readViewMode().beliefColours ? null
      : h('button', { type: 'button', class: 'btn small', 'data-fk': 'beliefs', onclick: () => { if (!readViewMode().beliefColours) ctx.controller.handle({ type: 'belief' }); renderTransmit(); } }, 'Show belief colours');
    return h('div', { class: 'sent' },
      h('div', { class: 'top' }, h('span', { class: 'dot', style: { width: '8px', height: '8px', borderRadius: '50%', background: colour } }), h('b', {}, `${sent.name} · v${sent.key}`), h('span', { class: 'hint', style: { marginLeft: 'auto' } }, `via drone ${sent.droneId}`)),
      bar, barText, beliefButton);
  }

  function updateAdoption() {
    if (!lastSent) return;
    // A reset clears the controller's event log: the injection no longer exists in this run.
    const sent = lastSent;
    if (!ctx.controller.getEventLog().some(event => event.type === 'INJECT_SCORE' && event.tick === sent.tick && event.droneId === sent.droneId)) { lastSent = null; feedback = null; render(); return; }
    const reading = adoption(ctx.samples(), sent);
    const share = reading.encore?.share ?? 0;
    barFill.style.width = `${(share * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', (share * 100).toFixed(0));
    barText.textContent = reading.state === 'scheduled'
      ? `scheduled for tick ${sent.tick}: waiting for the observer's first sample after it`
      : `observer, t${reading.sampleTick}: Encore ${reading.encore!.count}/${reading.encore!.alive} live drones hold v${sent.key} · static ${reading.static ? `${reading.static.count}/${reading.static.alive}` : '—'}`;
  }

  const offDrafts = drafts.onChange(() => render());
  const offStore = store.subscribe((_state, changed) => {
    if (changed.includes('preview') || changed.includes('lenses')) render();
    else if (changed.includes('selected') || changed.includes('pick')) renderTransmit();
  });
  let lastSelected = ctx.controller.status().selectedId;
  const onStatus = (event: Event) => {
    const id = (event as CustomEvent<Partial<ControlStatus>>).detail?.selectedId ?? null;
    if (id === lastSelected) return;
    lastSelected = id;
    if (!ownPick) pickedDrone = null;   // a new stage selection becomes the target, unless a pick is answering it
    renderTransmit();
  };
  ctx.events?.addEventListener('encore:control-status', onStatus);
  // 4 Hz: adoption from the observer, and the target's status when it changes (killed, jammed, adopted a version).
  const timer = setInterval(() => {
    if (!visible()) return;
    if (targetSignature() !== targetSig) renderTransmit(); else updateAdoption();
  }, 250);
  render();
  return {
    el,
    open() { if (ctx.surfaces) ctx.surfaces.open('composer'); else { el.hidden = false; render(); } },
    render,
    dispose() {
      clearInterval(timer);
      offDrafts(); offStore();
      ctx.events?.removeEventListener('encore:control-status', onStatus);
      if (ownPick && store.state.pick === ownPick) ownPick.resolve(null);   // only the pick this panel started
      disconnectPreview();
      el.remove();
    },
  };
}

function parseVersion(key: string): { issuedTick: number; origin: number } {
  const [issuedTick, origin] = key.split(':').map(Number);
  return { issuedTick, origin };
}
