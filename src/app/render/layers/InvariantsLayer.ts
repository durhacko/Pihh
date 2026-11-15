// Live invariant readout in X-ray (#209, P2-WP-06). Opt-in only: it shows when the page was opened with ?p2=inv AND
// X-ray is on AND the render quality level is 0. Without the flag it is an empty hidden Group whose ingest and update
// return at once (no checker, no per-tick work, no DOM), so the default demo is unchanged. Opted in, it feeds every
// tick's snapshot to the P2-WP-01 checker (src/observer/invariants.ts), also while hidden, and draws a small DOM legend
// only while shown. It reads snapshots only: it never touches a world or brain.
//
// What a layer can check (PHASE2_WORK_PACKAGES §P2-WP-06 step 1): a layer sees snapshots only, so it knows neither its
// arm nor the recorded events nor the registered scores. The checker is created with arm 'unknown', no score,
// eventsRecorded false, and asked for INV-DUP and INV-MONO only. Nothing is inferred:
// - INV-DUP and INV-MONO run live (heartbeats and slots are in every snapshot). They are the subset compared with the
//   CLI's runCustom report (tests/app/xray/invariantsLayer.test.ts).
// - The other four are never asked for, so the checker allocates nothing for them (INV-SILENCE's heard matrix alone
//   is about 480 KB per view at n0 200). The legend says "not checkable live (see CLI)" with the reason from
//   NOT_LIVE_WHY: INV-SILENCE and INV-QUIET need a registered score, INV-STATIC needs the static arm, and INV-CONVERGE
//   needs the recorded events (live it would run on partitionSide with SET_LOSS unseen, and in the static pane an
//   uplinked score that the static brain never relays would read as a stall; a false violation on stage is worse
//   than none, PHASE2_EVALUATION §7).
// - The dupContactRuns diagnostic needs the truth-contact model and so the recorded events: unavailable live.
// Wording follows requirements §5: "checked on this run, not proofs". No colour suggests a guarantee.
import { Group, type Scene } from 'three';
import { DT, type Params, type WorldSnapshot } from '../../../contracts';
import { createInvariantChecker, INVARIANT_IDS, type InvariantChecker, type InvariantId, type InvariantReport } from '../../../observer/invariants';
import type { Layer } from '../Layer';
import { readViewMode } from '../colourModes/viewMode';

export const INVARIANTS_TITLE = 'Checked on this run, not proofs';
/** The snapshot-checkable subset: the only invariants asked of the checker live, and the ones whose live result equals
 *  the CLI's on the same run. */
export const LIVE_COMPARED: readonly InvariantId[] = ['INV-DUP', 'INV-MONO'];
export const LIVE_REQUESTED: readonly InvariantId[] = LIVE_COMPARED;
/** Why the others are not checkable live (PHASE2_WORK_PACKAGES §P2-WP-06 step 1); the CLI checks them on recorded runs. */
export const NOT_LIVE_WHY: Readonly<Partial<Record<InvariantId, string>>> = Object.freeze({
  'INV-SILENCE': 'needs a registered score (slot positions) and the recorded events; a layer sees snapshots only',
  'INV-QUIET': 'needs a registered score (hold starts); a layer sees snapshots only',
  'INV-CONVERGE': 'needs the recorded events (every partition and SET_LOSS); a layer sees snapshots only',
  'INV-STATIC': 'static arm only, and a layer does not know its arm',
});
const NOT_LIVE = 'not checkable live (see CLI)';
/** WorldView gives its canvas this label and appends it to its pane before it inits the layers (WorldView.ts). */
export const AIRSPACE_CANVAS = 'canvas[aria-label="Three dimensional drone airspace"]';
/** In its pane: top right, below the readout bar. The pane hides it with the pane and the shell's panels cover it. */
export const IN_PANE_CSS = 'position:absolute;right:16px;top:64px';
/** Without a pane (no WorldView canvas found): fixed, stacked down the right column. */
export const FALLBACK_TOP = 410;
export const FALLBACK_STEP = 150;

/** The Phase 2 opt-in flag (§2.1 of the work packages): `?p2=<name>[,<name>…]` contains `inv`. */
export function invariantsOptIn(search: string): boolean {
  const value = new URLSearchParams(search).get('p2');
  return value !== null && value.split(',').map(part => part.trim()).includes('inv');
}

export type RowState = 'holding' | 'idle' | 'violated' | 'unavailable';
export interface LegendRow { inv: InvariantId; state: RowState; text: string; why?: string }
export interface InvariantsLegend { title: string; rows: LegendRow[]; footer: string; failure: string | null }
export interface LegendLine { text: string; strong: boolean }
/** Whether this run has offered anything to check yet: without it, "holding" would be vacuous. */
export interface LiveEvidence { heartbeats: boolean; slotChanges: boolean }

const seconds = (tick: number) => `${(tick * DT).toFixed(2)} s`;

/** The legend's content, from a checker report. Pure: the unit tests read it without a DOM. */
export function buildLegend(report: InvariantReport, evidence: LiveEvidence, failure: string | null): InvariantsLegend {
  if (failure !== null) return { title: INVARIANTS_TITLE, rows: [], footer: `Readout unavailable (${failure}) until the show is reset`, failure };
  if (report.lastTick === 0) return { title: INVARIANTS_TITLE, rows: [], footer: 'Waiting for the first tick', failure: null };
  const rows = INVARIANT_IDS.map((inv): LegendRow => {
    if (!report.checked.includes(inv)) {
      const why = report.unavailable.find(u => u.inv === inv)?.why ?? NOT_LIVE_WHY[inv] ?? 'not asked for live';
      return { inv, state: 'unavailable', text: `${inv} – ${NOT_LIVE}`, why };
    }
    const derived = report.derived.find(d => d.inv === inv);
    const note = derived ? ' (derived)' : '';
    const count = report.counts[inv];
    if (count > 0) {
      const first = report.violations.find(v => v.inv === inv);
      if (first) {
        const who = first.ids.length === 1 ? `drone ${first.ids[0]}` : `drones ${first.ids.join(' and ')}`;
        const tag = first.knownLimit === null ? '' : ` · matches known limit ${first.knownLimit}`;
        const more = count > 1 ? ` · ${count} in total` : '';
        return { inv, state: 'violated', text: `${inv} ✗ violated${note} · first t=${first.tick} (${seconds(first.tick)}), ${who}${tag}${more}`, why: first.detail };
      }
    }
    if (inv === 'INV-DUP' && !evidence.heartbeats) return { inv, state: 'idle', text: `${inv} · nothing to check yet (no delivered heartbeats)` };
    if (inv === 'INV-MONO' && !evidence.slotChanges) return { inv, state: 'idle', text: `${inv} · nothing to check yet (no slot changes)` };
    return { inv, state: 'holding', text: `${inv} ✓ holding${note}`, ...(derived ? { why: derived.why } : {}) };
  });
  return { title: INVARIANTS_TITLE, rows, footer: `${report.checked.length} of ${INVARIANT_IDS.length} checkable live · dupContactRuns unavailable live`, failure: null };
}

/** What the DOM legend shows, line by line: the not-checkable rows share one line, so the legend stays short. */
export function legendLines(legend: InvariantsLegend, label: string): LegendLine[] {
  const lines: LegendLine[] = [{ text: `${label} · ${legend.title}`, strong: true }];
  const unavailable = legend.rows.filter(row => row.state === 'unavailable').map(row => row.inv);
  for (const row of legend.rows) if (row.state !== 'unavailable') lines.push({ text: row.text, strong: row.state === 'violated' });
  if (unavailable.length) lines.push({ text: `Not checkable live (see CLI): ${unavailable.join(', ')}`, strong: false });
  lines.push({ text: legend.footer, strong: false });
  return lines;
}

export interface InvariantsLayerOptions {
  /** Test seam. Default: read once in init from location.search (off when there is no location). */
  optIn?: boolean;
}

/** Built in init only when opted in: without the flag none of it exists. */
interface Live {
  checker: InvariantChecker;
  n0: number;
  lastTick: number;
  failure: string | null;
  evidence: LiveEvidence;
  prevSlot: Int32Array;
  /** The report changed since the legend was last built. */
  dirty: boolean;
  legend: InvariantsLegend | null;
  key: string;
  element: HTMLDivElement | null;
  /** This view's pane (the element WorldView appended its canvas to), or null: then the legend is fixed on body. */
  pane: HTMLElement | null;
  /** Watches the pane's style: the layout hides a pane by visibility and stops rendering it (main.ts layoutViews). */
  paneWatch: MutationObserver | null;
}

/** The opted-in layers on this page, in creation order: without a pane, the index places them and names them "View n". */
const views: object[] = [];
/** Panes already holding a readout: each WorldView inits its layers right after appending its own canvas. */
const claimed = new Set<Element>();

/** The pane of the WorldView being built: the first airspace canvas whose pane no readout has claimed yet. */
function claimPane(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
  for (const canvas of document.querySelectorAll(AIRSPACE_CANVAS)) {
    const pane = canvas.parentElement;
    if (pane && !claimed.has(pane)) { claimed.add(pane); return pane; }
  }
  return null;
}

function makeLive(params: Params): Live {
  return {
    checker: createInvariantChecker({ params, arm: 'unknown', checks: [...LIVE_REQUESTED], eventsRecorded: false }),
    n0: params.n0,
    lastTick: 0,
    failure: null,
    evidence: { heartbeats: false, slotChanges: false },
    prevSlot: Int32Array.from({ length: params.n0 }, (_, id) => id),
    dirty: true,
    legend: null,
    key: '',
    element: null,
    pane: claimPane(),
    paneWatch: null,
  };
}

/** A Layer plus a read-only test seam: the live checker's report (null without the flag). */
export type InvariantsLayer = Layer & { report(): InvariantReport | null };

export function createInvariantsLayer(options: InvariantsLayerOptions = {}): InvariantsLayer {
  const group = new Group();
  group.visible = false;
  const token = {};
  /** null unless opted in: then ingest and update return at once, and nothing else is ever allocated. */
  let live: Live | null = null;
  let scene: Scene | undefined;
  let optIn = false;
  let visible = true;
  let qualityOk = true;
  const publish = () => {
    group.userData.invariants = { optIn, lastTick: live?.lastTick ?? 0, failure: live?.failure ?? null, legend: live?.legend ?? null, inDom: !!live?.element };
  };
  publish();

  /** Whether the legend may be on screen now. A hidden pane (main.ts layoutViews sets only its visibility, and
   *  never renders it) counts as hidden: "no legend element exists while hidden" (P2-WP-06 step 3). */
  const shouldShow = () => visible && qualityOk && readViewMode().xray && live?.pane?.style.visibility !== 'hidden';

  function ingest(snapshot: WorldSnapshot): void {
    if (!live) return;
    // ingest runs every tick for every view, rendered or not: drop the element of a view that is no longer shown.
    if (live.element && !shouldShow()) hide();
    if (live.failure !== null) return;
    const before = live.lastTick;
    try {
      if (live.checker.ingest(snapshot).length > 0) live.dirty = true;
    } catch (error) {
      // The checker refuses a gap or a backwards tick (TickEvidence's rules). Never crash a render frame for it:
      // the readout goes unavailable until the world is rebuilt (reset).
      const message = error instanceof Error ? error.message : String(error);
      live.failure = /every simulation tick/.test(message) ? 'tick gap' : snapshot.tick < before ? 'tick went backwards' : `checker error: ${message}`;
      live.dirty = true;
      return;
    }
    if (snapshot.tick <= before) return;   // a repeated tick is a no-op, as in the checker
    live.lastTick = snapshot.tick;
    if (before === 0) live.dirty = true;   // the first tick fills checked and unavailable
    const evidence = live.evidence;
    if (!evidence.heartbeats) {
      for (const event of snapshot.radio) if (event.type === 'HB' && event.delivered.length > 0) { evidence.heartbeats = true; live.dirty = true; break; }
    }
    if (!evidence.slotChanges) {
      for (const drone of snapshot.drones) {
        if (drone.alive && drone.belief.slot !== live.prevSlot[drone.id]) { evidence.slotChanges = true; live.dirty = true; }
        live.prevSlot[drone.id] = drone.belief.slot;
      }
    }
  }

  function removeElement(): void {
    if (!live?.element) return;
    live.element.remove();
    live.element = null;
    live.key = '';
  }

  function hide(): void {
    group.visible = false;
    if (live?.element) { removeElement(); publish(); }
  }

  /** Builds or refreshes the DOM legend; only when the content changed. */
  function show(): void {
    if (!live) return;
    if (live.dirty || !live.legend) {
      live.legend = buildLegend(live.checker.report(), live.evidence, live.failure);
      live.dirty = false;
    }
    const legend = live.legend;
    const key = JSON.stringify(legend);
    if (key === live.key && live.element) return;
    if (typeof document === 'undefined') { live.key = key; publish(); return; }
    const index = views.indexOf(token);
    // A display label only (the pane's own data-arm): the checker still runs with arm 'unknown'.
    const arm = live.pane?.dataset.arm;
    const label = arm === 'encore' ? 'Encore arm' : arm === 'static' ? 'Static arm' : `View ${index + 1}`;
    if (!live.element) {
      live.element = document.createElement('div');
      live.element.dataset.invariantsLegend = arm ?? String(index + 1);
      live.element.setAttribute('aria-label', `Invariant readout, ${label}`);
      const place = live.pane ? IN_PANE_CSS : `position:fixed;right:40px;top:${FALLBACK_TOP + index * FALLBACK_STEP}px;z-index:2`;
      live.element.style.cssText = `${place};max-width:330px;padding:4px 8px;border-radius:4px;background:#06121dcc;color:#b8cbd4;font:12px system-ui;line-height:1.6;pointer-events:none`;
      (live.pane ?? document.body).append(live.element);
    }
    live.element.replaceChildren(...legendLines(legend, label).map(({ text, strong }) => {
      const row = document.createElement('div');
      row.textContent = text;
      if (strong) row.style.fontWeight = '600';
      return row;
    }));
    live.key = key;
    publish();
  }

  return {
    id: 'invariants',
    report: () => (live ? live.checker.report() : null),
    init(ctx) {
      scene = ctx.scene;
      optIn = options.optIn ?? (typeof location !== 'undefined' && invariantsOptIn(location.search));
      if (optIn) {
        live = makeLive(ctx.params); views.push(token);
        // A layout change hides a pane without a render or a tick (also while paused): drop the element at once, so
        // no legend element exists while hidden (P2-WP-06 step 3). The next render of a shown pane rebuilds it.
        const pane = live.pane;
        if (pane && typeof MutationObserver !== 'undefined') {
          live.paneWatch = new MutationObserver(() => { if (live?.element && !shouldShow()) hide(); });
          live.paneWatch.observe(pane, { attributes: true, attributeFilter: ['style'] });
        }
      }
      scene.add(group);   // without the flag: an empty, hidden Group, never updated
      publish();
    },
    ingest,
    update(frame) {
      if (!live) return;
      // Fallback for a view without per-tick ingestion: a repeated tick is a no-op, a skipped one a tick gap. Never
      // before the first real ingest after a reset: if the new show's first tick failed, the frame still holds the
      // discarded world's last snapshot (createTickPipeline.restart), which must not be judged as part of the new one.
      if (live.lastTick > 0 && frame.curr.tick > live.lastTick) ingest(frame.curr);
      const shown = shouldShow();
      group.visible = shown;
      if (shown) show(); else hide();
      if (group.userData.invariants.lastTick !== live.lastTick || group.userData.invariants.failure !== live.failure) publish();
    },
    reset() {
      if (!live) return;
      live.checker.reset();
      live.lastTick = 0;
      live.failure = null;
      live.evidence = { heartbeats: false, slotChanges: false };
      for (let id = 0; id < live.n0; id++) live.prevSlot[id] = id;
      live.dirty = true;
      live.legend = null;
      hide();
      publish();
    },
    setQuality(level) { qualityOk = level <= 0; if (!qualityOk) hide(); },
    setVisible(value) { visible = value; if (!value) hide(); },
    dispose() {
      scene?.remove(group);
      if (live) {
        live.paneWatch?.disconnect();
        removeElement();
        const at = views.indexOf(token); if (at >= 0) views.splice(at, 1);
        if (live.pane) claimed.delete(live.pane);
        live = null;
      }
      publish();
    },
  };
}

export default function createLayer(): Layer {
  return createInvariantsLayer();
}
