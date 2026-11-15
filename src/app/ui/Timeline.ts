// src/app/ui/Timeline.ts
// Show timeline tray (FE-E, #94; research/ui-prototype DESIGN.md §3B and §4). Lanes, deliberately separate:
//   PLAN    what the operator issued: the preloaded movements plus each injected composeNext result.
//   EVENTS  every EnvEvent scheduled into both worlds, from the action controller's log.
//   HOLDS   per world, from observer MetricsSamples only: the share of live drones believing each score version,
//           and nPWC (dimmed while that world's reference score is in transition).
// Nothing here is invented: every mark comes from the score, the event log or a sample. "Scheduled" (tick not
// yet reached) is drawn and labelled differently from "applied". No seeking: replay-to-tick is not built.
//
// The DOM is diffed, not rebuilt: every element is keyed and kept across updates, and an element is only
// inserted or moved when the order really changes, so keyboard focus on a cue survives the 4 Hz refresh.
// Not a panel: it exports connectTimeline (not createPanel), so the loader in ./index.ts ignores it.
// No side effects at import.
import { DT } from '../../contracts';
import type { EnvEvent, MetricsSample, RGB, Recipe, Score } from '../../contracts';
import { versionKey } from '../../observer/measure';
import { currentMovement, newerVersion } from '../../score';
import type { Arm, Pair } from '../worlds';
import { fmtTime } from './dom';
import { VersionPalette } from './store';

// ------------------------------------------------------------------------------------------- model

export type CueSource = 'preloaded' | 'injected';
export type CueStatus = 'upcoming' | 'in transition' | 'holding' | 'done';

export interface Cue {
  /** Stable across updates: version key and start tick. */
  key: string;
  name: string;
  source: CueSource;
  versionKey: string;
  startTick: number;
  transitionTicks: number;
  /** The next cue's start, or null for the last cue (it holds until something replaces it). */
  endTick: number | null;
  /**
   * Where this movement ends in its OWN score (the next movement of that score), or null if it is the score's last.
   * Drones on this version fly this movement exactly while the shared show clock is in [startTick, scoreEndTick).
   */
  scoreEndTick: number | null;
  palette: [RGB, RGB] | null;
  /** The drone that received the uplink, for injected cues. */
  droneId: number | null;
}

/** "ENCORE", "Sphere", "Helix". */
export function recipeName(recipe: Recipe): string {
  return recipe.kind === 'text' ? recipe.text : recipe.kind === 'sphere' ? 'Sphere' : 'Helix';
}

/**
 * The operator's plan. Starts from the preloaded score; each INJECT_SCORE in the log (in order) replaces every
 * planned movement that starts after its issue tick (composeNext keeps only the movement current at that tick)
 * and adds its new movement as an injected cue.
 */
export function planCues(preloaded: Score, events: readonly EnvEvent[]): Cue[] {
  const preKey = versionKey(preloaded.version);
  let cues: Omit<Cue, 'endTick'>[] = preloaded.movements.map((m, i) => ({
    key: `${preKey}@${m.startTick}`, name: recipeName(m.recipe), source: 'preloaded', versionKey: preKey,
    startTick: m.startTick, transitionTicks: m.transitionTicks, palette: m.recipe.palette ?? null, droneId: null,
    scoreEndTick: preloaded.movements[i + 1]?.startTick ?? null,
  }));
  // Applied in tick order: since `at` (#104) the log can hold an event scheduled for an earlier tick after a later one.
  for (const event of byTick(events)) {
    if (event.type !== 'INJECT_SCORE') continue;
    const { score } = event;
    const added = score.movements[score.movements.length - 1];
    if (!added) continue;
    const key = versionKey(score.version);
    cues = cues.filter(c => c.startTick <= score.version.issuedTick);
    cues.push({
      key: `${key}@${added.startTick}`, name: recipeName(added.recipe), source: 'injected', versionKey: key,
      startTick: added.startTick, transitionTicks: added.transitionTicks, palette: added.recipe.palette ?? null, droneId: event.droneId,
      scoreEndTick: null,   // composeNext adds its movement last
    });
  }
  cues.sort((a, b) => a.startTick - b.startTick);
  return cues.map((c, i) => ({ ...c, endTick: cues[i + 1]?.startTick ?? null }));
}

/** Where the plan clock is for a cue. A cue replaced during its own transition is done at the next cue's start. */
export function cueStatus(cue: Cue, tick: number): CueStatus {
  if (tick < cue.startTick) return 'upcoming';
  if (cue.endTick !== null && tick >= cue.endTick) return 'done';
  return tick < cue.startTick + cue.transitionTicks ? 'in transition' : 'holding';
}

/** Events in tick order, stable for equal ticks, each with its index in the log (for keys that survive re-sorting). */
function byTick(events: readonly EnvEvent[]): EnvEvent[] {
  return indexedByTick(events).map(entry => entry.event);
}
function indexedByTick(events: readonly EnvEvent[]): { event: EnvEvent; index: number }[] {
  return events.map((event, index) => ({ event, index })).sort((a, b) => a.event.tick - b.event.tick || a.index - b.index);
}

/**
 * Who flies this cue, per world, from the latest sample (null: no sample). A drone holds a cue when it believes the
 * cue's score version AND the shared show clock is inside that movement of that score: before the movement starts
 * the cue is 'not started', after its score moves on it is 'over'. So an upcoming cue never reads as held.
 */
export interface Held { count: number; alive: number; flying: 'not started' | 'flying' | 'over' }
export function heldBy(cue: Cue, latest: Pair<MetricsSample | null>): Pair<Held | null> {
  const one = (s: MetricsSample | null): Held | null => {
    if (!s) return null;
    const flying = s.tick < cue.startTick ? 'not started' : cue.scoreEndTick !== null && s.tick >= cue.scoreEndTick ? 'over' : 'flying';
    return { count: flying === 'flying' ? s.versions[cue.versionKey] ?? 0 : 0, alive: s.alive, flying };
  };
  return { encore: one(latest.encore), static: one(latest.static) };
}

/** "held by 12/40 Encore, static: not started", for labels and the cue detail. */
export function heldText(held: Pair<Held | null>): string {
  const one = (name: string, h: Held | null) => (!h ? `no ${name} sample` : h.flying === 'flying' ? `held by ${h.count}/${h.alive} ${name}` : `${name}: ${h.flying}`);
  return `${one('Encore', held.encore)}, ${one('static', held.static)}`;
}

export interface EventMark { key: string; kind: 'kill' | 'inject' | 'loss'; tick: number; scheduled: boolean; label: string }
export interface EventBand { key: string; kind: 'jam' | 'partition'; id: string; start: number; end: number | null; scheduled: boolean; label: string }

/** Marks and on/off bands from the scheduled-event log. A band with no OFF yet is open (end = null). */
export function eventLane(events: readonly EnvEvent[], tick: number): { marks: EventMark[]; bands: EventBand[] } {
  const marks: EventMark[] = [];
  const bands: EventBand[] = [];
  const open = new Map<string, EventBand>();
  const when = (t: number) => (t > tick ? `scheduled for ${fmtTime(t)}` : `at ${fmtTime(t)}`);
  // In tick order, so an OFF logged before its ON (`at`, #104) still closes the right band; keys keep the log index.
  indexedByTick(events).forEach(({ event, index: i }) => {
    const scheduled = event.tick > tick;
    if (event.type === 'KILL') marks.push({ key: `kill@${event.tick}#${i}`, kind: 'kill', tick: event.tick, scheduled, label: `KILL ${event.ids.length} drone${event.ids.length === 1 ? '' : 's'} ${when(event.tick)}` });
    else if (event.type === 'INJECT_SCORE') marks.push({ key: `inject@${event.tick}#${i}`, kind: 'inject', tick: event.tick, scheduled, label: `INJECT_SCORE v${versionKey(event.score.version)} into drone ${event.droneId} ${when(event.tick)}` });
    else if (event.type === 'SET_LOSS') marks.push({ key: `loss@${event.tick}#${i}`, kind: 'loss', tick: event.tick, scheduled, label: `Packet loss ${Math.round(event.loss * 100)}% ${when(event.tick)}` });
    else if (event.type === 'JAM_ON' || event.type === 'PARTITION_ON') {
      const kind = event.type === 'JAM_ON' ? 'jam' : 'partition';
      const band: EventBand = { key: `${kind}:${event.id}@${event.tick}`, kind, id: event.id, start: event.tick, end: null, scheduled, label: '' };
      open.set(`${kind}:${event.id}`, band);
      bands.push(band);
    } else if (event.type === 'JAM_OFF' || event.type === 'PARTITION_OFF') {
      const kind = event.type === 'JAM_OFF' ? 'jam' : 'partition';
      const band = open.get(`${kind}:${event.id}`);
      if (band) { band.end = event.tick; open.delete(`${kind}:${event.id}`); }
    }
  });
  for (const band of bands) {
    const name = band.kind === 'jam' ? 'Jam' : 'Partition';
    const off = band.end === null ? (band.scheduled ? '' : ', still on') : `, off ${when(band.end)}`;
    band.label = `${name} ${band.id}: on ${when(band.start)}${off}`;
  }
  return { marks, bands };
}

export type Phase = 'transition' | 'hold';
export interface HoldColumn {
  tick: number;
  alive: number;
  /** Live drones per believed version, oldest version first. */
  shares: { key: string; count: number }[];
  npwc: number | null;
  /** The phase of this world's reference score at the sample; null with no live drone, or when unknown (below). */
  phase: Phase | null;
  /** Versions held in the sample whose score is not in the plan or the event log: the reference cannot be known. */
  unknown: string[];
}

/**
 * One column per observer sample. The reference score follows the observer's rule (evaluation doc §2): the
 * newest registered score that at least one live drone believes. Registered = preloaded plus every injected score.
 */
export function holdColumns(series: readonly MetricsSample[], preloaded: Score, events: readonly EnvEvent[]): HoldColumn[] {
  const scores = [preloaded, ...events.flatMap(e => (e.type === 'INJECT_SCORE' ? [e.score] : []))];
  const byKey = new Map(scores.map(s => [versionKey(s.version), s]));
  const order = (key: string) => { const s = byKey.get(key); return s ? s.version.issuedTick * 1e6 + s.version.origin : Number.MAX_SAFE_INTEGER; };
  return series.map(sample => {
    let reference: Score | null = null;
    for (const [key, count] of Object.entries(sample.versions)) {
      const score = byKey.get(key);
      if (count > 0 && score && (!reference || newerVersion(score.version, reference.version))) reference = score;
    }
    const shares = Object.entries(sample.versions).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count })).sort((a, b) => order(a.key) - order(b.key));
    const unknown = shares.filter(s => !byKey.has(s.key)).map(s => s.key);
    const phase = reference && !unknown.length ? (currentMovement(reference, sample.tick).inHold ? 'hold' : 'transition') : null;
    return { tick: sample.tick, alive: sample.alive, shares, npwc: sample.npwc, phase, unknown };
  });
}

/** The visible window, in ticks: 30 s past now, and past the last cue's hold start plus 20 s. */
export function windowEnd(cues: readonly Cue[], events: readonly EnvEvent[], tick: number): number {
  const lastCue = Math.max(0, ...cues.map(c => c.startTick + c.transitionTicks));
  const lastEvent = Math.max(0, ...events.map(e => e.tick));
  return Math.max(tick + 600, lastCue + 400, lastEvent + 100);
}

// --------------------------------------------------------------------------------------------- DOM

export interface TimelineContext {
  /** The preloaded score (worlds.score). */
  getScore(): Score;
  /**
   * Every event scheduled into both worlds since the last build or reset, oldest first: the worlds' scripted
   * events plus everything scheduled live. In the app today that is controls.getEventLog() alone; anything that
   * calls worlds.scheduleBoth directly (the console debug handle, a demo script) must be added here too.
   */
  getEvents(): readonly EnvEvent[];
  /** Observer samples per world since the last build or reset (worlds.series()). */
  getSeries(): Pair<readonly MetricsSample[]>;
  /** The shared tick of both worlds (worlds.tick). */
  getTick(): number;
  /** The scripted demo (#27). Absent until it lands: the button then says so and does nothing. */
  demo?: { start(): void; stop(): void; isRunning(): boolean };
  /** The close button calls this (e.g. () => surfaces.close('timeline')). No close button without it. */
  onClose?(): void;
  /** Share the app's palette so versions have the same colour everywhere. */
  palette?: VersionPalette;
}

export interface TimelineOptions {
  /** Injected for headless tests; defaults to the global document. */
  document?: Document;
}

export interface TimelineHandle {
  /** The tray element: register it with Surfaces as { id: 'timeline', kind: 'tray' }. */
  readonly el: HTMLElement;
  /** Re-reads the context and patches the DOM. Call at the UI cadence (4 Hz) while the tray is open. */
  update(): void;
  dispose(): void;
}

const LANE_PAD = { left: 92, right: 14 };   // .timeline .lanes padding in styles.css
const FALLBACK_W = 1000;                     // canvas backing size when the layout cannot be measured (headless)
const FALLBACK_H = 44;

export function connectTimeline(ctx: TimelineContext, options: TimelineOptions = {}): TimelineHandle {
  const doc = options.document ?? document;
  const palette = ctx.palette ?? new VersionPalette();
  const cleanups: (() => void)[] = [];
  const written = new WeakMap<object, Map<string, string>>();   // last style value written per node and property

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function on(target: EventTarget, type: string, fn: (e: Event) => void) {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  }
  /** Writes a style only when it differs from what this module last wrote (browsers normalise read-backs). */
  function setStyle(node: HTMLElement, prop: string, value: string) {
    let props = written.get(node);
    if (!props) { props = new Map(); written.set(node, props); }
    if (props.get(prop) === value) return;
    props.set(prop, value);
    (node.style as unknown as Record<string, string>)[prop] = value;
  }

  // --- static structure, built once
  const root = el('section', 'tray timeline surface chrome');
  root.setAttribute('aria-label', 'Show timeline');
  const head = el('div', 'tray-head');
  const demoBtn = el('button', 'btn small');
  demoBtn.type = 'button';
  head.append(el('span', 'eyebrow', 'Show'), el('span', 'hint', 'Operator plan above, what drones actually hold below.'), el('span', 'grow'));
  const later = el('span', 'tag later', 'Edit cues · later');
  later.title = 'Cue editing, save/load and seeking are designed but not built';
  head.append(later, demoBtn);
  if (ctx.onClose) {
    const close = el('button', 'icon-btn', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close timeline');
    on(close, 'click', () => ctx.onClose?.());
    head.append(close);
  }
  const lanes = el('div', 'lanes');
  const lane = (cls: string, name: string) => {
    const node = el('div', cls);
    const items = el('div');
    Object.assign(items.style, { position: 'absolute', left: '0', right: '0', top: '0', bottom: '0' });
    node.append(el('span', 'lname', name), items);
    lanes.append(node);
    return items;
  };
  const planItems = lane('lane plan', 'PLAN');
  planItems.setAttribute('role', 'group');
  planItems.setAttribute('aria-label', 'Plan: cues issued by the operator. Arrow keys move between cues.');
  const eventItems = lane('lane events', 'EVENTS');
  eventItems.setAttribute('role', 'list');
  eventItems.setAttribute('aria-label', 'Events scheduled into both worlds');
  const holds: Pair<HoldLane> = { encore: holdLane('encore', 'HOLDS · ENC'), static: holdLane('static', 'HOLDS · STA') };
  const playhead = el('div', 'playhead');
  playhead.setAttribute('aria-hidden', 'true');
  lanes.append(playhead);
  const axis = el('div', 'axis');
  axis.setAttribute('aria-hidden', 'true');
  const detail = el('div', 'cue-detail');
  detail.setAttribute('aria-live', 'polite');
  root.append(head, lanes, axis, detail);

  interface HoldLane { canvas: HTMLCanvasElement; series: readonly MetricsSample[] | null; sig: string }
  function holdLane(arm: Arm, name: string): HoldLane {
    const items = lane('lane', name);
    const wrap = el('div', 'holds');
    const canvas = el('canvas');
    canvas.width = FALLBACK_W;
    canvas.height = FALLBACK_H;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${arm === 'encore' ? 'Encore' : 'Static'} world: no observer samples yet`);
    wrap.append(canvas);
    items.append(wrap);
    return { canvas, series: null, sig: '' };
  }

  // --- interaction: the cue detail follows keyboard focus (a click focuses the button, so it follows clicks too)
  let focused: string | null = null;
  const cueEls = new Map<string, HTMLButtonElement>();
  on(planItems, 'focusin', e => { focused = keyOf(e.target); queueMicrotask(update); });   // like focusout: never re-enter the DOM mid-event
  on(planItems, 'focusout', () => { focused = null; queueMicrotask(update); });
  on(planItems, 'keydown', e => {
    const key = (e as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    const keys = [...cueEls.keys()];
    const at = keys.indexOf(keyOf(e.target) ?? '');
    if (at < 0) return;
    const next = key === 'Home' ? 0 : key === 'End' ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, at + (key === 'ArrowRight' ? 1 : -1)));
    e.preventDefault();
    cueEls.get(keys[next] as string)?.focus();
  });
  on(demoBtn, 'click', () => {
    if (!ctx.demo) return;
    if (ctx.demo.isRunning()) ctx.demo.stop(); else ctx.demo.start();
    update();
  });
  function keyOf(target: EventTarget | null): string | null {
    for (const [key, node] of cueEls) if (node === target || (node as Node).contains(target as Node)) return key;
    return null;
  }

  const eventEls = new Map<string, HTMLElement>();
  const axisEls = new Map<string, HTMLElement>();
  let detailSig = '';

  // --- update: read the context, diff the DOM
  function update(): void {
    const tick = ctx.getTick();
    const score = ctx.getScore();
    const events = ctx.getEvents();
    const series = ctx.getSeries();
    const latest: Pair<MetricsSample | null> = { encore: series.encore.at(-1) ?? null, static: series.static.at(-1) ?? null };
    const cues = planCues(score, events);
    const end = windowEnd(cues, events, tick);
    const pct = (t: number) => `${((Math.max(0, Math.min(end, t)) / end) * 100).toFixed(3)}%`;
    const span = (a: number, b: number) => `${((Math.max(0, Math.min(end, b) - Math.max(0, a)) / end) * 100).toFixed(3)}%`;

    // demo control
    if (ctx.demo) {
      setText(demoBtn, ctx.demo.isRunning() ? '■ Stop demo' : '▶ Run 90 s demo');
      setProp(demoBtn, 'disabled', false);
      setAttr(demoBtn, 'title', null);
    } else {
      setText(demoBtn, 'Demo · not connected');
      setProp(demoBtn, 'disabled', true);
      setAttr(demoBtn, 'title', 'The scripted demo is not wired into this build yet (#27)');
    }

    // plan lane. If the focused cue is about to go (superseded), focus moves to the cue at its place, not to <body>.
    const activeKey = keyOf(doc.activeElement);
    const refocus = activeKey !== null && !cues.some(c => c.key === activeKey) ? Math.min([...cueEls.keys()].indexOf(activeKey), cues.length - 1) : -1;
    reconcile(planItems, cues, c => c.key, cueEls, c => {
      const button = el('button', 'cue');
      button.type = 'button';
      const lbl = el('span', 'lbl');
      const sw = el('span', 'sw2');
      const pal = c.palette;
      sw.style.background = pal ? `linear-gradient(90deg, ${rgb(pal[0])}, ${rgb(pal[1])})` : 'var(--text-3)';
      lbl.append(sw, el('span', '', c.name));
      if (c.source === 'injected') lbl.append(el('span', 'hint', ` v${c.versionKey}`));
      button.append(el('span', 'tr'), el('span', 'hold'), lbl);
      return button;
    }, (button, c, i) => {
      const status = cueStatus(c, tick);
      const held = heldBy(c, latest);
      const flown = (held.encore?.count ?? 0) + (held.static?.count ?? 0) > 0;
      const until = c.endTick ?? end;
      // "now" only when the plan clock says so AND some world measures drones holding this version
      setAttr(button, 'class', `cue${c.source === 'injected' ? ' injected' : ''}${(status === 'holding' || status === 'in transition') && flown ? ' now' : ''}`);
      setAttr(button, 'aria-label', `Cue ${i + 1}: ${c.name}, ${c.source}, starts ${fmtTime(c.startTick)}, planned ${status}; ${heldText(held)}`);
      setAttr(button, 'title', `${c.name} · planned ${status} · ${heldText(held)}`);
      setStyle(button, 'left', pct(c.startTick));
      setStyle(button, 'width', span(c.startTick, until));
      setStyle(button.firstElementChild as HTMLElement, 'width', `${((Math.min(c.transitionTicks, until - c.startTick) / Math.max(1, until - c.startTick)) * 100).toFixed(3)}%`);
    });
    if (refocus >= 0) [...cueEls.values()][refocus]?.focus();

    // events lane
    const { marks, bands } = eventLane(events, tick);
    type Item = { key: string; mark?: EventMark; band?: EventBand };
    const items: Item[] = [...bands.map(band => ({ key: band.key, band })), ...marks.map(mark => ({ key: mark.key, mark }))];
    reconcile(eventItems, items, it => it.key, eventEls, it => {
      if (it.band) return el('span', `band ${it.band.kind === 'jam' ? 'jam' : 'part'}`);
      const mark = it.mark as EventMark;
      const node = el('span', 'ev', mark.kind === 'kill' ? '✕' : mark.kind === 'inject' ? '◆' : '∿');
      node.style.color = mark.kind === 'kill' ? 'var(--danger)' : mark.kind === 'inject' ? 'var(--score)' : '';
      return node;
    }, (node, it) => {
      const item = (it.band ?? it.mark) as EventBand | EventMark;
      setAttr(node, 'role', 'listitem');
      setAttr(node, 'title', item.label);
      setAttr(node, 'aria-label', item.label);
      setAttr(node, 'data-state', item.scheduled ? 'scheduled' : 'applied');
      setStyle(node, 'opacity', item.scheduled ? '0.45' : '');
      if (it.band) {
        const b = it.band;
        setStyle(node, 'left', pct(b.start));
        // an open band runs to the playhead; one not yet started gets a visible stub, not a 0-width sliver
        setStyle(node, 'width', `max(4px, ${span(b.start, b.end ?? Math.max(tick, b.start))})`);
        setStyle(node, 'borderRightStyle', b.end === null || b.end > tick ? 'dashed' : '');
      } else setStyle(node, 'left', pct((it.mark as EventMark).tick));
    });

    // holds lanes
    for (const arm of ['encore', 'static'] as const) drawHolds(arm, series[arm], holdColumns(series[arm], score, events), end);

    // playhead and axis
    setStyle(playhead, 'left', `calc(${LANE_PAD.left}px + (100% - ${LANE_PAD.left + LANE_PAD.right}px) * ${(tick / end).toFixed(5)})`);
    const seconds = end * DT;
    const step = seconds > 240 ? 60 : seconds > 100 ? 20 : 10;
    const ticks: number[] = [];
    for (let s = 0; s <= seconds; s += step) ticks.push(s);
    reconcile(axis, ticks, s => String(s), axisEls, s => el('span', '', `${s}s`), (node, s) => {
      setStyle(node, 'left', `calc(${LANE_PAD.left}px + (100% - ${LANE_PAD.left + LANE_PAD.right}px) * ${((s / DT) / end).toFixed(5)})`);
    });

    renderDetail(cues.find(c => c.key === focused) ?? null, tick, latest);
  }

  function renderDetail(cue: Cue | null, tick: number, latest: Pair<MetricsSample | null>) {
    let parts: [string, string][];
    if (cue) {
      const cut = cue.endTick !== null && cue.endTick < cue.startTick + cue.transitionTicks;
      const hold = cue.endTick === null ? 'holds until the next cue'
        : cut ? `replaced ${((cue.startTick + cue.transitionTicks - cue.endTick) * DT).toFixed(1)} s before its transition ended`
          : `hold ${((cue.endTick - cue.startTick - cue.transitionTicks) * DT).toFixed(1)} s`;
      parts = [
        ['b', cue.name],
        ['span', cue.source === 'injected' ? `injected · v${cue.versionKey}${cue.droneId === null ? '' : ` into drone ${cue.droneId}`}` : 'preloaded'],
        ['span', `starts ${fmtTime(cue.startTick)}`],
        ['span', `transition ${(cue.transitionTicks * DT).toFixed(1)} s`],
        ['span', hold],
        ['span', `planned ${cueStatus(cue, tick)}`],
        ['span', heldText(heldBy(cue, latest))],
        ['span hint', cue.source === 'injected' ? 'Drones that never received this version keep flying their own.' : 'Preloaded on every drone before launch.'],
      ];
    } else parts = [['span hint', 'Focus a cue for its timing. Hatched = transition, solid = hold. Faded marks are scheduled, not yet applied. Seeking is not built.']];
    const sig = JSON.stringify(parts);
    if (sig === detailSig) return;
    detailSig = sig;
    detail.textContent = '';
    for (const [tag, text] of parts) {
      const [name, cls] = tag.split(' ');
      detail.append(el(name as 'span', cls, text));
    }
  }

  function drawHolds(arm: Arm, series: readonly MetricsSample[], columns: HoldColumn[], end: number) {
    const lane = holds[arm];
    const canvas = lane.canvas;
    // Back the canvas with device pixels at its laid-out size; keep the fallback size when it cannot be measured.
    const box = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const W = box && box.width > 0 ? Math.round(box.width * dpr) : FALLBACK_W;
    const H = box && box.height > 0 ? Math.round(box.height * dpr) : FALLBACK_H;
    const last = columns.at(-1);
    // The series array is replaced on reset, so its identity is part of the signature: no stale run is ever shown.
    const sig = `${columns.length}:${last?.tick ?? -1}:${end}:${W}x${H}`;
    if (series === lane.series && sig === lane.sig) return;
    lane.series = series;
    lane.sig = sig;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const label = arm === 'encore' ? 'Encore' : 'Static';
    setAttr(canvas, 'aria-label', last
      ? `${label} world: ${columns.length} observer samples; at ${fmtTime(last.tick)} nPWC ${last.npwc === null ? 'none' : last.npwc.toFixed(2)}${last.phase ? ` (${last.phase})` : ''}; versions held ${last.shares.map(s => `v${s.key} ${s.count}`).join(', ') || 'none'}${last.unknown.length ? `; not in the event log: ${last.unknown.map(k => `v${k}`).join(', ')}` : ''}`
      : `${label} world: no observer samples yet`);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const x = (t: number) => Math.floor((t / end) * W);
    const pad = Math.max(1, Math.round(2 * (H / FALLBACK_H)));
    columns.forEach((col, i) => {
      const left = x(col.tick);
      const right = i + 1 < columns.length ? x((columns[i + 1] as HoldColumn).tick) : x(col.tick + 5);
      const w = Math.max(1, right - left);
      if (col.phase === 'transition') { g.globalAlpha = 1; g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(left, 0, w, H); }
      let y = H;
      const total = Math.max(1, col.alive);
      for (const share of col.shares) {
        const hh = (share.count / total) * (H - 2 * pad);
        g.globalAlpha = 0.55;
        g.fillStyle = palette.colour(share.key);
        g.fillRect(left, y - hh, w, hh);
        y -= hh;
      }
    });
    // nPWC: a line, full strength in hold, faint in transition (or unknown phase); broken where nPWC is null.
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = '#d6ecf3';
    const yOf = (v: number) => H - pad - v * (H - 2 * pad);
    for (let i = 1; i < columns.length; i++) {
      const a = columns[i - 1] as HoldColumn;
      const b = columns[i] as HoldColumn;
      if (a.npwc === null || b.npwc === null) continue;
      g.globalAlpha = b.phase === 'hold' ? 1 : 0.3;
      g.beginPath();
      g.moveTo(x(a.tick), yOf(a.npwc));
      g.lineTo(x(b.tick), yOf(b.npwc));
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  update();
  return {
    el: root,
    update,
    dispose() { for (const fn of cleanups.splice(0)) fn(); },
  };
}

// ------------------------------------------------------------------------------------- DOM helpers

/**
 * Keyed reconciliation: one element per key, created once and patched afterwards. Stale elements are removed;
 * an element is moved only when it is out of order, so a focused element is never detached by an update.
 */
function reconcile<T, E extends HTMLElement>(parent: HTMLElement, items: readonly T[], key: (item: T) => string, cache: Map<string, E>, create: (item: T) => E, patch: (el: E, item: T, index: number) => void): void {
  const wanted = new Set(items.map(key));
  for (const [k, node] of cache) if (!wanted.has(k)) { node.remove(); cache.delete(k); }
  let cursor = parent.firstChild;
  items.forEach((item, i) => {
    const k = key(item);
    let node = cache.get(k);
    if (!node) { node = create(item); cache.set(k, node); }
    if (node !== cursor) parent.insertBefore(node, cursor);
    else cursor = cursor.nextSibling;
    patch(node, item, i);
  });
  // Keep the map in display order for keyboard navigation.
  const ordered = items.map(item => [key(item), cache.get(key(item)) as E] as const);
  cache.clear();
  for (const [k, node] of ordered) cache.set(k, node);
}

function setAttr(node: Element, name: string, value: string | null) {
  if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}
function setProp(node: HTMLButtonElement, prop: 'disabled', value: boolean) {
  if (node[prop] !== value) node[prop] = value;
}
function rgb(c: RGB): string {
  return `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
}
