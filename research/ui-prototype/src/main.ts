// Encore UI prototype — application shell.
// Layers: Session (sim + adapter) → Stage (render) → UI (surfaces, dock, console). The render loop only
// reads snapshots; UI panels update at 4 Hz; the simulation steps at 20 Hz × speed.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles.css';
import { Session } from './engine/session';
import { Stage } from './render/Stage';
import { Actions, Drafts, validateDraft, type App } from './ui/app';
import { createComposer } from './ui/Composer';
import { createConsole } from './ui/Console';
import { startDemo } from './ui/demo';
import { fmt, fmtTime, h, isTyping } from './ui/dom';
import { icon } from './ui/icons';
import { createInspector } from './ui/Inspector';
import { createDisrupt, createHelp, createLenses, createMetrics } from './ui/popovers';
import { Store, VersionPalette } from './ui/store';
import { Surfaces } from './ui/surfaces';
import { createTimeline } from './ui/Timeline';
import { createGuide } from './ui/Guide';

type Tickable = HTMLElement & { tick?(dt: number): void; render?(): void; focusInput?(): void };

const root = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const session = new Session(Number(params.get('seed') ?? 42), 200);
const store = new Store({
  lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true },
  view: 'encore', selected: null, hovered: null, pick: null, pickPoint: null, preview: null,
  quality: params.get('q') === 'low' ? 'low' : 'auto',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  chromeHidden: false, camera: null,
});
const palette = new VersionPalette();
const stageHost = h('div', { class: 'stage' });
root.append(stageHost);
const stage = new Stage(stageHost, session, store, palette);
const surfaces = new Surfaces();
const drafts = new Drafts();

// ---------- toasts & captions ----------
const toasts = h('div', { class: 'toasts chrome', 'aria-live': 'polite' });
const captionEl = h('div', { class: 'caption surface', hidden: true, 'aria-live': 'polite' });
const app: App = {
  session, store, stage, palette, surfaces, drafts, actions: null as unknown as Actions,
  toast(text, kind = 'info', action) {
    const t = h('div', { class: `toast surface ${kind === 'err' ? 'err' : ''}`, role: kind === 'err' ? 'alert' : 'status' },
      h('span', { style: { color: kind === 'err' ? 'var(--danger)' : kind === 'ok' ? '#8fd9b6' : 'var(--text-3)' } }, kind === 'err' ? '▲' : kind === 'ok' ? '●' : '·'), h('span', {}, text),
      action ? h('button', { class: 'btn small act', onclick: () => { action.run(); t.remove(); } }, action.label) : null);
    toasts.append(t);
    while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), kind === 'err' ? 6000 : 4200);
  },
  caption(text, sub) {
    captionEl.hidden = !text;
    captionEl.innerHTML = '';
    if (text) captionEl.append(text, sub ? h('small', {}, sub) : '');
    layoutBottom();
  },
  validate: d => validateDraft(d, session.params.n0, session.params),
  runDemo() {
    app.actions.demo?.stop();
    guide.collapse();
    demo = startDemo(app, () => { demo = null; });
    surfaces.open('timeline');
  },
};
app.actions = new Actions(app);
let demo: { stop(): void; update(): void } | null = null;

// ---------- corners ----------
const brand = h('div', { class: 'brand chrome' },
  h('div', { class: 'wordmark' }, 'ENCORE', h('span', {}, 'swarm stage')),
  h('button', { class: 'tag proto badge-proto', title: 'This build runs a prototype engine. Open Help → Labels.', onclick: () => surfaces.open('help') }, 'Prototype · mock engine'));
const readoutBtn = h('button', { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Open metrics (M)', onclick: () => surfaces.toggle('metrics') });
const readout = h('div', { class: 'readout surface chrome' }, readoutBtn);
const vpTop = h('div', { class: 'vp-label chrome' });
const vpBottom = h('div', { class: 'vp-label chrome' });
const vpDivider = h('div', { class: 'vp-divider', hidden: true });
const vpNote = h('div', { class: 'vp-note chrome' });
const hoverLabel = h('div', { class: 'hover-label', hidden: true });
const pickbar = h('div', { class: 'pickbar surface', hidden: true, role: 'status' });
const legend = h('div', { class: 'legend surface chrome', hidden: true, 'aria-label': 'Legend' });
const hiddenHint = h('div', { class: 'hidden-hint', style: { opacity: '0' } }, 'Press H to show controls');
root.append(vpDivider, vpTop, vpBottom, vpNote, hoverLabel, brand, readout, legend, pickbar, toasts, hiddenHint);

// ---------- surfaces ----------
const composer: Tickable = createComposer(app);
const inspector: Tickable = createInspector(app);
const timeline: Tickable = createTimeline(app);
const consoleEl: Tickable = createConsole(app);
const lenses: Tickable = createLenses(app);
const disrupt: Tickable = createDisrupt(app);
const metrics: Tickable = createMetrics(app);
const help: Tickable = createHelp(app);
const guide = createGuide(app);

// ---------- dock ----------
const dockBtn = (ic: string, label: string, key: string, opts: Record<string, unknown> = {}) =>
  h('button', { class: 'dock-btn', 'data-tip': '', 'aria-label': `${label} (${key})`, ...opts }, h('span', { html: ic }), h('span', { class: 'lbl' }, label), h('span', { class: 'tip' }, label, h('kbd', {}, key)));
const playBtn = h('button', { class: 'dock-btn play', 'data-tip': '', 'aria-label': 'Play or pause (Space)', onclick: () => app.actions.togglePlay() });
const clock = h('div', { class: 'clock', 'aria-live': 'off' }, h('span', { class: 't' }), h('span', { class: 's' }));
const speedBtn = h('button', { class: 'dock-btn speed', 'data-tip': '', 'aria-label': 'Playback speed ([ and ])', onclick: () => app.actions.setSpeed(session.speed >= 4 ? 0.25 : session.speed * 2) });
const resetBtn = dockBtn(icon.reset, 'Reset', 'R', { onclick: () => app.actions.reset() });
const btnCompose = dockBtn(icon.compose, 'Compose', 'F', { 'aria-expanded': 'false', onclick: () => surfaces.toggle('composer') });
const btnDisrupt = dockBtn(icon.disrupt, 'Disrupt', 'K J P', { 'aria-expanded': 'false', 'aria-haspopup': 'dialog', onclick: () => surfaces.toggle('disrupt') });
const btnLenses = dockBtn(icon.lenses, 'Lenses', 'X C G', { 'aria-expanded': 'false', 'aria-haspopup': 'dialog', onclick: () => surfaces.toggle('lenses') });
const cmp = h('div', { class: 'seg compare', role: 'radiogroup', 'aria-label': 'World shown (B)' },
  ...(['encore', 'split', 'static'] as const).map(v => h('button', { role: 'radio', 'data-view': v, 'aria-checked': 'false', onclick: () => app.actions.setView(v), title: v === 'split' ? 'Encore above, static baseline below (B)' : `${v === 'encore' ? 'Encore' : 'Static baseline'} only (B)` }, v === 'encore' ? 'Encore' : v === 'split' ? 'Split' : 'Static')));
const btnTimeline = dockBtn(icon.timeline, 'Show', 'T', { 'aria-expanded': 'false', onclick: () => surfaces.toggle('timeline') });
const btnConsole = dockBtn(icon.console, 'Console', '/', { 'aria-expanded': 'false', onclick: () => surfaces.toggle('console') });
const btnHelp = dockBtn(icon.help, 'Help', '?', { 'aria-expanded': 'false', 'aria-haspopup': 'dialog', onclick: () => surfaces.toggle('help') });
const dock = h('nav', { class: 'dock surface chrome', 'aria-label': 'Encore controls' },
  playBtn, clock, speedBtn, resetBtn, h('span', { class: 'sep' }),
  btnCompose, btnDisrupt, btnLenses, h('span', { class: 'sep' }), cmp, h('span', { class: 'sep' }),
  btnTimeline, btnConsole, h('span', { class: 'sep' }), btnHelp);
const bottom = h('div', { class: 'bottom' }, captionEl, consoleEl, timeline, dock);
root.append(bottom, composer, inspector, lenses, disrupt, metrics, help, guide);

surfaces.register({ id: 'composer', kind: 'panel', el: composer, onOpen: () => composer.render?.(), focusOnOpen: () => composer.querySelector('#cmp-text') ?? composer.querySelector('#cmp-name') });
surfaces.register({ id: 'inspector', kind: 'panel', el: inspector, onClose: () => { if (store.state.selected) store.set({ selected: null }); } });
surfaces.register({ id: 'timeline', kind: 'panel', el: timeline, onOpen: () => timeline.render?.() });
surfaces.register({ id: 'console', kind: 'panel', el: consoleEl, focusOnOpen: () => consoleEl.querySelector('input') });
surfaces.register({ id: 'lenses', kind: 'popover', el: lenses, anchor: () => btnLenses, onOpen: () => lenses.render?.() });
surfaces.register({ id: 'disrupt', kind: 'popover', el: disrupt, anchor: () => btnDisrupt, onOpen: () => disrupt.render?.() });
surfaces.register({ id: 'metrics', kind: 'popover', el: metrics, anchor: () => readoutBtn, place: 'below-right', onOpen: () => metrics.render?.() });
surfaces.register({ id: 'help', kind: 'popover', el: help, anchor: () => btnHelp, onOpen: () => help.render?.() });
const expanders: [string, HTMLElement][] = [['composer', btnCompose], ['disrupt', btnDisrupt], ['lenses', btnLenses], ['timeline', btnTimeline], ['console', btnConsole], ['help', btnHelp], ['metrics', readoutBtn]];
surfaces.onChange(open => {
  for (const [id, b] of expanders) b.setAttribute('aria-expanded', String(open.includes(id)));
  root.classList.toggle('composer-open', open.includes('composer'));
  if (open.length) guide.collapse();
  layoutBottom();
});
function layoutBottom() {
  requestAnimationFrame(() => {
    const top = bottom.getBoundingClientRect().top;
    const inset = Math.max(82, window.innerHeight - top + 12);
    root.style.setProperty('--bottom-h', `${inset}px`);
    stage.insetBottom = inset - 8;
    root.style.setProperty('--split-mid', `${Math.max(200, window.innerHeight - stage.insetBottom) / 2}px`);
    root.classList.toggle('has-bottom', true);
  });
}

// ---------- store reactions ----------
store.subscribe((s, changed) => {
  if (changed.includes('view')) for (const b of cmp.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.view === s.view));
  if (changed.includes('chromeHidden')) {
    root.classList.toggle('chrome-hidden', s.chromeHidden);
    hiddenHint.style.opacity = s.chromeHidden ? '1' : '0';
    if (s.chromeHidden) setTimeout(() => { hiddenHint.style.opacity = '0'; }, 2200);
  }
  if (changed.includes('reducedMotion')) root.classList.toggle('reduced', s.reducedMotion);
  if (changed.includes('pick')) {
    stageHost.classList.toggle('picking', !!s.pick);
    pickbar.hidden = !s.pick;
    if (s.pick) { pickbar.innerHTML = ''; pickbar.append(h('span', { class: 'reticle' }), h('span', {}, s.pick.prompt), h('span', { class: 'meta' }), h('button', { class: 'btn small', onclick: () => s.pick?.resolve(null) }, 'Cancel', h('kbd', {}, 'Esc'))); }
    else stage.setPickSphere(null);
  }
  if (changed.includes('selected') && s.selected && !surfaces.isOpen('inspector')) surfaces.open('inspector');
});
for (const b of cmp.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.view === 'encore'));

// ---------- pointer on the stage ----------
const canvas = stage.renderer.domElement;
let downAt: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', e => {
  const hit = stage.pick(e.clientX, e.clientY);
  const prev = store.state.hovered;
  if (hit?.id !== prev?.id || hit?.arm !== prev?.arm) store.set({ hovered: hit });
  stageHost.classList.toggle('hovering', !!hit && !store.state.pick);
  if (hit) {
    const d = session.arms[hit.arm].curr.drones[hit.id];
    const r = root.getBoundingClientRect();
    hoverLabel.hidden = false; hoverLabel.style.left = `${e.clientX - r.left}px`; hoverLabel.style.top = `${e.clientY - r.top}px`;
    hoverLabel.textContent = `#${hit.id} · slot ${d.belief.slot} · v${d.belief.version.issuedTick}:${d.belief.version.origin}${d.belief.deaf ? ' · deaf' : ''}`;
  } else hoverLabel.hidden = true;
  const pk = store.state.pick;
  if (pk && pk.radius) {
    const centre = hit ? session.arms.encore.curr.drones[hit.id].pos : stage.pointAt(e.clientX, e.clientY);
    stage.setPickSphere(centre, pk.radius);
    const n = session.arms.encore.curr.drones.filter(d => d.alive && Math.hypot(d.pos[0] - centre[0], d.pos[1] - centre[1], d.pos[2] - centre[2]) <= pk.radius!).length;
    const meta = pickbar.querySelector('.meta'); if (meta) meta.textContent = `${n} live drone${n === 1 ? '' : 's'} inside`;
  }
});
canvas.addEventListener('pointerleave', () => { hoverLabel.hidden = true; if (store.state.hovered) store.set({ hovered: null }); });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5 || e.button !== 0) return;
  const hit = stage.pick(e.clientX, e.clientY);
  const pk = store.state.pick;
  if (pk) {
    if (pk.purpose === 'inject' || pk.purpose === 'select') { if (hit) pk.resolve({ droneId: hit.id, point: session.arms.encore.curr.drones[hit.id].pos }); return; }
    pk.resolve({ droneId: hit?.id ?? null, point: stage.pointAt(e.clientX, e.clientY) });
    return;
  }
  if (hit) app.actions.select(hit.id, hit.arm);
  else if (store.state.selected) app.actions.select(null);
});

// ---------- keyboard ----------
window.addEventListener('resize', layoutBottom);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (store.state.pick) { store.state.pick.resolve(null); return; }
    if (store.state.chromeHidden) { store.set({ chromeHidden: false }); return; }
    if (surfaces.escape()) return;
    if (store.state.preview) { store.set({ preview: null }); return; }
    if (store.state.selected) { app.actions.select(null); return; }
    return;
  }
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const map: Record<string, () => void> = {
    ' ': () => app.actions.togglePlay(), '.': () => app.actions.step(), '[': () => app.actions.nudgeSpeed(-1), ']': () => app.actions.nudgeSpeed(1),
    r: () => app.actions.reset(), '1': () => app.actions.camera('audience'), '2': () => app.actions.camera('quarter'), '3': () => app.actions.camera('top'),
    f: () => surfaces.toggle('composer'), t: () => surfaces.toggle('timeline'), '/': () => surfaces.open('console'), '`': () => surfaces.toggle('console'),
    k: () => void app.actions.killRegion(8), j: () => app.actions.toggleJam(), p: () => app.actions.partition(),
    x: () => app.actions.lens('xray'), c: () => app.actions.lens('colour', store.state.lenses.colour === 'belief' ? 'show' : 'belief'), g: () => app.actions.lens('ghosts'),
    b: () => app.actions.cycleView(), m: () => surfaces.toggle('metrics'), d: () => (app.actions.demo ? app.actions.demo.stop() : app.runDemo()),
    h: () => store.set({ chromeHidden: !store.state.chromeHidden }), '?': () => surfaces.toggle('help'),
    i: () => {
      const id = app.actions.selectedLive();
      if (id === null) { surfaces.open('composer'); app.toast('Select a drone to receive the uplink, then press I again — or use the composer.', 'info'); return; }
      app.actions.inject(id);
    },
  };
  const fn = map[k.toLowerCase()] ?? map[k];
  if (fn) { e.preventDefault(); fn(); }
});

// ---------- legend ----------
function renderLegend() {
  const l = store.state.lenses;
  const snap = session.arms.encore.curr;
  const items: (HTMLElement | null)[] = [];
  const deaf = snap.drones.filter(d => d.alive && d.belief.deaf).length;
  if (l.xray) {
    const rc = stage.radioCounter(store.state.view === 'static' ? 'static' : 'encore');
    items.push(h('div', { class: 'eyebrow' }, 'Radio · real log'),
      h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: 'var(--hb)' } }), 'Heartbeat (1 in 4 drawn)'),
      h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: 'var(--claim)' } }), 'Heartbeat carrying a claim'),
      h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: 'var(--score)' } }), 'SCORE message'),
      h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: 'var(--lost)', width: '7px' } }), h('span', { class: 'ln', style: { background: 'var(--jam)', width: '7px', marginLeft: '-6px' } }), h('span', { class: 'ln', style: { background: 'var(--partition)', width: '7px', marginLeft: '-6px' } }), 'Dropped: lost · jammed · split'),
      h('div', { class: 'honest', title: 'Links drawn over links in the radio log, last second of sim time' }, `radio drawn ${rc.drawn} / ${rc.logged.toLocaleString('en-GB')} · 1 s`));
  }
  if (l.colour === 'belief') {
    const s = session.arms.encore.sample;
    items.push(h('div', { class: 'eyebrow' }, 'Score version held'));
    for (const [k, n] of Object.entries(s?.versions ?? {})) items.push(h('div', { class: 'li' }, h('span', { class: 'rg', style: { background: palette.colour(k) } }), `v${k}${k.endsWith(':-1') ? ' preloaded' : ''}`, h('span', { class: 'ct' }, String(n))));
  }
  if (l.ghosts) items.push(h('div', { class: 'eyebrow' }, 'Slots · observer view'),
    h('div', { class: 'li' }, h('span', { class: 'rg', style: { border: '2px solid var(--transit)', width: '11px', height: '11px' } }), 'In transit'),
    h('div', { class: 'li' }, h('span', { class: 'rg', style: { border: '3.5px solid var(--vacant)', width: '12px', height: '12px' } }), 'Vacant'),
    h('div', { class: 'li' }, h('span', { class: 'rg', style: { border: '1.5px double var(--contested)', outline: '1.5px solid var(--contested)', outlineOffset: '1px', width: '9px', height: '9px' } }), 'Contested (2+ holders)'));
  if (deaf) items.push(h('div', { class: 'li' }, h('span', { class: 'rg', style: { border: '1.5px solid #fff' } }), 'Deaf: heard no radio for 2 s', h('span', { class: 'ct' }, String(deaf))));
  if (snap.partitions.length && l.zones) items.push(l.colour === 'show'
    ? h('div', { class: 'li' }, h('span', { class: 'rg', style: { background: '#56B4E9' } }), h('span', { class: 'rg', style: { background: '#F0E442', marginLeft: '-6px' } }), 'Partition groups (fixed at split)')
    : h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: 'var(--partition)' } }), 'Partition active: groups untinted while colour shows versions'));
  legend.hidden = items.length === 0;
  legend.innerHTML = ''; legend.append(...items.filter(Boolean) as HTMLElement[]);
}

// ---------- 4 Hz chrome refresh ----------
function refreshChrome() {
  const a = session.arms.encore.sample, b = session.arms.static.sample;
  playBtn.innerHTML = session.playing ? icon.pause : icon.play;
  playBtn.setAttribute('aria-pressed', String(!session.playing));
  (clock.children[0] as HTMLElement).textContent = fmtTime(session.tick);
  (clock.children[1] as HTMLElement).textContent = `tick ${session.tick}`;
  speedBtn.textContent = `${session.speed}×`;
  const mv = session.movementAt();
  readoutBtn.innerHTML = '';
  readoutBtn.append(
    h('span', { class: `npwc ${mv.inHold ? '' : 'transit'}`, title: mv.inHold ? 'Priority-weighted coverage, normalised' : 'In transition: coverage is expected to be low' }, h('span', { class: 'k' }, 'nPWC'), h('span', { class: 'v' }, fmt(a?.npwc, 3)), store.state.view !== 'encore' ? h('span', { class: 'v', style: { color: 'var(--text-3)' } }, ` / ${fmt(b?.npwc, 3)}`) : ''),
    h('span', {}, h('span', { class: 'k' }, 'Alive'), h('span', { class: 'v' }, `${a?.alive ?? session.params.n0}`)),
    h('span', {}, h('span', { class: 'k' }, mv.inHold ? 'Hold' : 'Transition'), h('span', { class: 'v' }, session.cues().find(c => c.startTick === mv.movement.startTick)?.name ?? '')),
    h('span', {}, h('span', { class: 'v', style: { color: 'var(--text-3)' } }, `${stage.fps.toFixed(0)} fps`)));
  const split = store.state.view === 'split';
  vpDivider.hidden = !split;
  vpTop.innerHTML = ''; vpBottom.innerHTML = '';
  if (store.state.view !== 'encore') {
    const label = (name: string, desc: string, n: number | null | undefined) => [h('span', { class: 'name' }, name), h('span', { class: 'desc' }, desc), h('span', { class: 'num' }, `nPWC ${fmt(n, 3)}`)];
    vpTop.style.top = split ? 'calc(var(--split-mid) - 30px)' : '108px'; vpTop.style.bottom = 'auto';
    if (split) {
      vpTop.append(h('span', { class: 'name' }, '▲'), ...label('ENCORE', 'decentralised, self-healing', a?.npwc));
      vpBottom.style.top = 'calc(var(--split-mid) + 12px)';
      vpBottom.append(h('span', { class: 'name' }, '▼'), ...label('STATIC', 'pre-programmed baseline · sends no radio', b?.npwc));
    } else vpTop.append(...label('STATIC', 'pre-programmed baseline · sends no radio', b?.npwc));
  }
  vpNote.style.top = split ? 'calc(var(--split-mid) + 12px)' : '108px';
  vpNote.textContent = store.state.view !== 'encore' && session.injections.length ? 'Static drones ignore injected scores by design. That is a capability difference, not a performance result.' : '';
  renderLegend();
  if (store.state.preview) {
    if (!pickbar.hidden) return;
  }
}

// ---------- preview banner ----------
const previewBar = h('div', { class: 'pickbar surface chrome', hidden: true, style: { top: '64px' } });
root.append(previewBar);
store.subscribe((s, c) => {
  if (!c.includes('preview') && !c.includes('pick')) return;
  previewBar.hidden = !s.preview || !!s.pick;
  if (s.preview) { previewBar.innerHTML = ''; previewBar.append(h('span', { class: 'reticle', style: { borderStyle: 'dashed' } }), h('span', {}, `Previewing “${s.preview.label}” — local only, nothing sent`), h('button', { class: 'btn small', onclick: () => store.set({ preview: null }) }, 'Hide', h('kbd', {}, 'Esc'))); }
});

// ---------- loop ----------
let last = performance.now();
let chromeAcc = 1;
function frame(now: number) {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  try {
    session.advance(dt);
    demo?.update();
    stage.render(dt);
    chromeAcc += dt;
    if (chromeAcc > 0.25) { chromeAcc = 0; refreshChrome(); composer.tick?.(0); }
    inspector.tick?.(dt); timeline.tick?.(dt); metrics.tick?.(dt);
    guide.tick();
  } catch (err) {
    // Error boundary: keep the page alive and say what failed instead of freezing silently.
    console.error(err);
    session.playing = false;
    app.toast(`Simulation error: ${(err as Error).message}. Paused — press R to reset.`, 'err');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
refreshChrome();
layoutBottom();
if (params.get('demo') === '1') app.runDemo();
(window as unknown as { encore: unknown }).encore = { app, session, store, surfaces };
