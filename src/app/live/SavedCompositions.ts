// src/app/live/SavedCompositions.ts: the Saved compositions panel (MDB-WP-05, #264; spec §12).
// Save composition (from the Composer's drafts), the library list, and Load as drafts (the MVP load; the scheduling
// runner, states 9a/10a/10c, is a follow-up). Mounted only by the flag-guarded line in main.ts; never in the default
// build. It talks to the simulation only through the Drafts store; availability never disables the Composer.
//
// Rendering: messages are fixed strings chosen here; stored strings (titles, kinds) reach the DOM only as h() text
// children or textContent. No innerHTML, outerHTML, html: key, esc(, insertAdjacentHTML, document.write or srcdoc.
import type { Params } from '../../contracts';
import { validateComposition, validateShowRequest, type SavedShowComposition, type ShowRequest } from '../compose/validate';
import { draftFromRecipe, validateDraft, type Drafts } from '../ui/Composer';
import { h } from '../ui/dom';
import { getShow, listShows, newOperationId, probeShows, saveShow, summaryOf, type ClientOptions, type ShowSummary, type ShowsAvailability } from './shows';

export interface SavedCompositionsOptions {
  host: HTMLElement;
  drafts: Drafts;
  params: Params;
  /** The action controller (reserved for the scheduling runner follow-up; Load as drafts does not use it). */
  controls?: unknown;
  /** Client options: tests inject a fake fetch and an instant sleep. */
  client?: ClientOptions;
  /** Clock for the probe backoff (default Date.now). */
  now?: () => number;
}
export interface SavedCompositionsHandle {
  el: HTMLElement;
  open(): Promise<void>;
  /** Settles when the in-flight probe, list, save or load finishes (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export const MESSAGES = {
  notConfigured: 'Saved compositions are not configured on this gateway. Encore runs fully without them.',
  fetching: 'Fetching saved compositions…',
  empty: 'No saved compositions yet. Compose a formation and press Save composition.',
  unavailable: 'Cloud library unavailable. Local simulation is unaffected.',
  readOnly: "Saving is unavailable until the library's duplicate check is confirmed. Browsing still works.",
  conflict: 'This save conflicts with an earlier attempt.',
  forbidden: 'Saving is not allowed from this page.',
  newer: 'Saved by a newer Encore; update to load it.',
  damaged: 'This saved show is damaged and cannot be loaded.',
  gone: 'This show no longer exists. Refresh the list.',
} as const;

const DEFAULT_HOLD = 600;
const PROBE_MIN_MS = 2000;
const PROBE_MAX_MS = 30000;
const NAME_PREFIX_MAX = 20;   // draft names are at most 24 code points (NAME_MAX): prefix + " 16"

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; title: string }
  | { kind: 'saved'; title: string }
  | { kind: 'failed-retryable'; reason: string; request: ShowRequest; key: string }
  | { kind: 'failed-definitive'; message: string; reasons: string[]; conflict: boolean };
type Selection =
  | { kind: 'none' }
  | { kind: 'selected'; summary: ShowSummary; composition: SavedShowComposition }
  | { kind: 'invalid'; message: string }
  | { kind: 'retrieve-failed'; message: string };

/** Mounts the panel (collapsed) and probes once. */
export function createPanel(o: SavedCompositionsOptions): SavedCompositionsHandle {
  const now = o.now ?? (() => Date.now());
  const client = o.client ?? {};
  let availability: ShowsAvailability = 'probing';
  let lastProbeAt = -Infinity;
  let probeGap = PROBE_MIN_MS;
  let items: ShowSummary[] | null = null;
  let listing = false;
  let save: SaveState = { kind: 'idle' };
  let selection: Selection = { kind: 'none' };
  let loaded: number | null = null;
  let title = '';
  let titleTouched = false;
  const chosen = new Set<string>();
  const holds = new Map<string, number>();
  let busy: Promise<void> = Promise.resolve();
  let disposed = false;

  const toggle = h('button', { type: 'button', class: 'btn small', 'aria-expanded': 'false' }, 'Saved compositions');
  const body = h('div', { class: 'body' });
  body.hidden = true;
  const el = h('aside', { class: 'surface chrome', 'aria-label': 'Saved compositions', style: { position: 'fixed', right: '16px', top: '72px', width: '320px', maxHeight: '70vh', overflow: 'auto', zIndex: '5' } }, toggle, body);
  o.host.append(el);

  const track = (p: Promise<void>) => { busy = busy.then(() => p, () => p); return p; };

  let inFlight: Promise<void> | null = null;
  /** One probe, honouring the backoff (at least 2 s apart, doubling to 30 s while it fails). Never a loop; a probe
   *  already in flight is shared, not repeated. */
  function probe(): Promise<void> {
    if (inFlight) return inFlight;
    const t = now();
    if (t - lastProbeAt < probeGap) return Promise.resolve();
    lastProbeAt = t;
    inFlight = (async () => {
      availability = await probeShows(client);
      probeGap = availability === 'up' || availability === 'read-only' ? PROBE_MIN_MS : Math.min(probeGap * 2, PROBE_MAX_MS);
      if (availability === 'up' || availability === 'read-only') await refreshList();
      render();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function refreshList(): Promise<void> {
    listing = true; render();
    const r = await listShows(undefined, 20, client);
    listing = false;
    if (r.ok) items = r.value.items;
    else if (r.details.some(d => d.reason === 'MODULE_DISABLED')) { availability = 'disabled'; items = null; }   // state 1
    else if (r.retryable) { availability = 'unavailable'; items = null; }   // network, timeout, 503, 429: state 7
    else items = [];
    render();
  }

  // ------------------------------------------------------------------------------------------------- save
  const validDrafts = () => o.drafts.list.filter(d => validateDraft(d, o.params).ok);
  function buildRequest(): ShowRequest | { problems: string[] } {
    const picked = validDrafts().filter(d => chosen.has(d.id));
    if (!picked.length) return { problems: ['Choose at least one valid draft.'] };
    const input = {
      schemaVersion: 1, title, source: 'manual',
      composition: { v: 1, movements: picked.map(d => ({ recipe: validateDraft(d, o.params).recipe, holdTicks: holds.get(d.id) ?? DEFAULT_HOLD })) },
    };
    const checked = validateShowRequest(input, o.params);   // validation point (a): in the app, before save
    return checked.ok ? checked.request : { problems: checked.errors.map(e => `${e.path || 'request'}: ${e.reason}`) };
  }

  let editedDuringSave = false;
  async function submit(request: ShowRequest, key: string): Promise<void> {
    save = { kind: 'saving', title: request.title }; editedDuringSave = false; render();
    await probe();
    const r = await saveShow(request, key, client);
    if (disposed) return;
    if (r.ok) { save = { kind: 'saved', title: request.title }; await refreshList(); }
    // An edit while saving discarded this request (§10.5, 6a): a failure is not offered for Retry; the next Save
    // takes the edited form with a new key.
    else if (editedDuringSave) save = { kind: 'idle' };
    else if (r.details.some(d => d.reason === 'MODULE_DISABLED')) { availability = 'disabled'; save = { kind: 'failed-definitive', message: MESSAGES.notConfigured, reasons: [], conflict: false }; }
    else if (r.retryable) save = { kind: 'failed-retryable', reason: r.code === 'NETWORK' || r.code === 'TIMEOUT' ? 'the gateway did not answer' : r.status === 429 ? 'too many requests' : 'the library is unavailable', request, key };
    else if (r.status === 409) save = { kind: 'failed-definitive', message: MESSAGES.conflict, reasons: [], conflict: true };
    else if (r.status === 401 || r.status === 403) save = { kind: 'failed-definitive', message: MESSAGES.forbidden, reasons: [], conflict: false };
    else save = { kind: 'failed-definitive', message: `Not saved: ${r.code}.`, reasons: r.details.map(d => `${d.path || 'request'}: ${d.reason}`), conflict: false };
    render();
  }

  function startSave(): void {
    const request = buildRequest();
    if ('problems' in request) { save = { kind: 'failed-definitive', message: 'Not saved: fix the form first.', reasons: request.problems, conflict: false }; render(); return; }
    void track(submit(request, newOperationId()));
  }

  /**
   * Any edit to the form or its source drafts discards a pending or failed request; the next Save gets a new key.
   * It re-renders only the save status and the library notes, never the inputs (so typing keeps focus).
   */
  function edited(): void {
    if (save.kind === 'saving') editedDuringSave = true;
    else save = { kind: 'idle' };
    loaded = null;
    renderSave(); renderLibrary();
  }

  // ------------------------------------------------------------------------------------------------- load
  let selectSeq = 0;
  async function select(summary: ShowSummary): Promise<void> {
    const seq = ++selectSeq;   // only the latest selection may land: a stale getShow reply is ignored
    loaded = null;
    if (!summary.loadable) { selection = { kind: 'invalid', message: summary.problem === 'unsupported-schema' ? MESSAGES.newer : MESSAGES.damaged }; render(); return; }
    const r = await getShow(summary.id, client);
    if (seq !== selectSeq || disposed) return;
    if (!r.ok) {
      selection = { kind: 'retrieve-failed', message: r.status === 404 ? MESSAGES.gone : r.code === 'SCHEMA_VERSION_UNSUPPORTED' ? MESSAGES.newer : r.status === 503 || r.status <= 0 ? MESSAGES.unavailable : MESSAGES.damaged };
      render(); return;
    }
    const shown = summaryOf(r.value.show);
    const show = r.value.show as { composition?: unknown };
    // Validation point (c), app side: the strict validator, as stored data (non-canonical text is rejected).
    const checked = validateComposition(show.composition, o.params, { mode: 'stored' });
    if (shown.id !== summary.id) selection = { kind: 'invalid', message: MESSAGES.damaged };   // the reply is not the show asked for
    else if (!shown.loadable) selection = { kind: 'invalid', message: shown.problem === 'unsupported-schema' ? MESSAGES.newer : MESSAGES.damaged };
    else if (!checked.ok) {
      const onlyExpansion = checked.errors.every(e => e.reason === 'EXPANSION_FAILED');
      selection = { kind: 'invalid', message: onlyExpansion ? `This show cannot be flown with ${o.params.n0} drones on this page.` : MESSAGES.damaged };
    } else selection = { kind: 'selected', summary: shown, composition: checked.composition };
    render();
  }

  function loadAsDrafts(): void {
    if (selection.kind !== 'selected') return;
    const prefix = [...selection.summary.title].slice(0, NAME_PREFIX_MAX).join('').trim() || 'Saved';
    // A generated movement is not editable as a draft (GF-CC-01) and is skipped; v1 compositions have none.
    let added = 0;
    selection.composition.movements.forEach((m, i) => {
      const input = draftFromRecipe(`${prefix} ${i + 1}`, m.recipe);
      if (input) { o.drafts.add(input); added++; }
    });
    loaded = added;
    render();
  }

  // ----------------------------------------------------------------------------------------------- render
  // Regions. The form's inputs (the title, and one checkbox and hold field per draft) are created ONCE and never
  // re-inserted while they exist: re-inserting a node detaches it, and a detached field loses focus. Typing therefore
  // re-renders only the save status and the library notes (#270 review 1). The other regions hold no inputs.
  const text = (s: string, cls = 'hint') => h('div', { class: cls }, s);
  const usableNow = () => availability === 'up' || availability === 'read-only';
  const availBox = h('div', {});
  const titleInput = h('input', { class: 'input', 'aria-label': 'Composition title', maxlength: 80 });
  titleInput.addEventListener('input', () => { title = titleInput.value; titleTouched = true; edited(); });
  const rowsBox = h('div', {});
  const saveBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => startSave() }, 'Save composition');
  const saveStatus = h('div', {});
  const libraryBox = h('div', {});
  body.append(availBox, h('div', { class: 'sec-title' }, h('span', { class: 'eyebrow' }, 'Save composition')), h('div', { class: 'field' }, titleInput), rowsBox, saveBtn, saveStatus, libraryBox);

  interface Row { el: HTMLElement; label: HTMLElement; box: HTMLInputElement; hold: HTMLInputElement }
  const rows = new Map<string, Row>();
  let rowOrder = '';

  function renderAvailability(): void {
    const usable = usableNow();
    if (availability === 'probing') availBox.replaceChildren(h('div', { class: 'hint', role: 'status', 'aria-busy': 'true' }, MESSAGES.fetching));
    else if (availability === 'disabled') availBox.replaceChildren(text(MESSAGES.notConfigured), checkAgain());
    else if (!usable) availBox.replaceChildren(h('div', { class: 'hint', role: 'status' }, MESSAGES.unavailable), checkAgain());
    else availBox.replaceChildren();
  }

  /** One row per valid draft, reused across renders; the box is re-filled only when the set or order changes. */
  function renderRows(): void {
    const valid = validDrafts();
    if (chosen.size === 0 && valid[0]) {   // the current draft by default (§12), else the first valid one
      const current = o.drafts.find(null);
      chosen.add(current && valid.some(d => d.id === current.id) ? current.id : valid[0].id);
    }
    if (!titleTouched && document.activeElement !== titleInput) titleInput.value = title = valid.find(d => chosen.has(d.id))?.name ?? valid[0]?.name ?? '';
    for (const id of [...rows.keys()]) if (!valid.some(d => d.id === id)) { rows.delete(id); chosen.delete(id); }
    for (const d of valid) {
      let row = rows.get(d.id);
      if (!row) {
        const box = h('input', { type: 'checkbox', 'aria-label': `Include ${d.name}` });
        box.addEventListener('change', () => { if (box.checked) chosen.add(d.id); else chosen.delete(d.id); edited(); });
        const hold = h('input', { class: 'input mono', type: 'number', min: 0, max: 6000, step: 1, 'aria-label': `Hold ticks for ${d.name}`, value: String(holds.get(d.id) ?? DEFAULT_HOLD) });
        hold.addEventListener('input', () => { holds.set(d.id, Number(hold.value)); edited(); });
        const label = h('span', {});
        row = { el: h('div', { class: 'field' }, box, label, hold), label, box, hold };
        rows.set(d.id, row);
      }
      row.box.checked = chosen.has(d.id);
      if (row.label.textContent !== ` ${d.name} `) row.label.textContent = ` ${d.name} `;
    }
    const order = valid.map(d => d.id).join('|');
    if (order !== rowOrder) { rowOrder = order; rowsBox.replaceChildren(...valid.map(d => rows.get(d.id)!.el)); }
  }

  /** Save composition's status (states 4, 5, 6a, 6b) and the Save button's enabled state. No inputs here. */
  function renderSave(): void {
    if (disposed || body.hidden) return;
    const usable = usableNow();
    const saveReason = availability === 'read-only' ? MESSAGES.readOnly : !usable ? MESSAGES.unavailable : save.kind === 'saving' ? '' : rows.size === 0 ? 'Compose a valid draft first.' : '';
    if (saveReason || save.kind === 'saving' || save.kind === 'failed-retryable') saveBtn.setAttribute('disabled', ''); else saveBtn.removeAttribute('disabled');
    const parts: HTMLElement[] = [];
    if (saveReason) parts.push(text(saveReason));
    if (save.kind === 'saving') parts.push(h('div', { class: 'hint', role: 'status' }, `Saving “${save.title}”…`));
    if (save.kind === 'saved') parts.push(h('div', { class: 'hint', role: 'status' }, `Saved “${save.title}”.`));
    if (save.kind === 'failed-retryable') {
      const pending = save;
      parts.push(h('div', { class: 'hint err', role: 'alert' }, `Not saved: ${pending.reason}. Retry sends “${pending.request.title}”, ${pending.request.composition.movements.length} movements.`));
      if (!usable) parts.push(h('span', { class: 'tag' }, 'Library unavailable'));
      parts.push(h('button', { type: 'button', class: 'btn', onclick: () => { void track(submit(pending.request, pending.key)); } }, 'Retry'));
    }
    if (save.kind === 'failed-definitive') {
      parts.push(h('div', { class: 'hint err', role: 'alert' }, save.message), ...save.reasons.map(r => text(r, 'hint err')));
      if (save.conflict) parts.push(h('button', { type: 'button', class: 'btn', onclick: () => { save = { kind: 'idle' }; startSave(); } }, 'Save as new'));
    }
    saveStatus.replaceChildren(...parts);
  }

  /** The library (states 2, 3, the list), the selection (8, 9, retrieve failures) and Load as drafts (10b). */
  function renderLibrary(): void {
    if (disposed || body.hidden) return;
    const parts: HTMLElement[] = [];
    if (usableNow()) {
      parts.push(h('div', { class: 'sec-title' }, h('span', { class: 'eyebrow' }, 'Library')));
      if (listing && !items) parts.push(h('div', { class: 'hint', role: 'status', 'aria-busy': 'true' }, MESSAGES.fetching));
      else if (items && items.length === 0) parts.push(text(MESSAGES.empty));
      for (const item of items ?? []) {
        parts.push(h('button', { type: 'button', class: 'chip', onclick: () => { void track(select(item)); } },
          item.title, item.loadable ? ` · ${item.movementCount} movements` : ' · cannot load'));
      }
      parts.push(h('button', { type: 'button', class: 'btn ghost small', onclick: () => { void track(refreshList()); } }, 'Refresh'));
    }
    if (selection.kind === 'invalid' || selection.kind === 'retrieve-failed') parts.push(h('div', { class: 'hint err', role: 'alert' }, selection.message));
    if (selection.kind === 'selected') {
      const s = selection;
      parts.push(h('div', { class: 'field' }, h('b', {}, `${s.summary.title} · ${s.composition.movements.length} movements`), text(s.composition.movements.map(m => m.recipe.kind).join(', '))),
        h('button', { type: 'button', class: 'btn', onclick: () => loadAsDrafts() }, 'Load as drafts'));
    }
    if (loaded !== null) parts.push(h('div', { class: 'hint', role: 'status' }, `Added ${loaded} drafts to the Composer. Inject each one when you are ready.`));
    libraryBox.replaceChildren(...parts);
  }

  function render(): void {
    if (disposed || body.hidden) return;
    renderAvailability(); renderRows(); renderSave(); renderLibrary();
  }

  function checkAgain(): HTMLElement {
    // A user action: one probe now, still subject to the backoff gap (at least 2 s apart, doubling to 30 s).
    return h('button', { type: 'button', class: 'btn small', onclick: () => { void track(probe()); } }, 'Check again');
  }

  toggle.addEventListener('click', () => { if (body.hidden) void api.open(); else { body.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
  const offDrafts = o.drafts.onChange(() => { if (save.kind === 'failed-retryable' || save.kind === 'failed-definitive') save = { kind: 'idle' }; render(); });

  const api: SavedCompositionsHandle = {
    el,
    open: async () => { body.hidden = false; toggle.setAttribute('aria-expanded', 'true'); render(); await track(probe()); },
    idle: async () => { let last: Promise<void> | undefined; while (last !== busy) { last = busy; await busy; } },
    dispose: () => { disposed = true; offDrafts(); el.remove(); },
  };
  void track(probe());   // one probe on mount (flag-on builds only: this module is not in the default build)
  return api;
}
