// PROTOTYPE-ONLY review guide (not product UI): walks a reviewer through mockups A, B and C.
// Every "Show me" button drives the real UI through the same actions a user would trigger.
import type { App } from './app';
import { h } from './dom';
import { icon } from './icons';

interface Step { text: string; run?(app: App): void | Promise<void>; check?(app: App): boolean }
const far = (app: App) => {
  const snap = app.session.arms.encore.curr;
  const jam = snap.jams[0];
  const live = snap.drones.filter(d => d.alive);
  if (!jam) return live[Math.floor(live.length * 0.8)]?.id ?? 0;
  return live.sort((a, b) => Math.hypot(b.pos[0] - jam.centre[0], b.pos[1] - jam.centre[1]) - Math.hypot(a.pos[0] - jam.centre[0], a.pos[1] - jam.centre[1]))[0].id;
};
const edgeDrone = (app: App) => {
  const live = app.session.arms.encore.curr.drones.filter(d => d.alive);
  return live.sort((a, b) => a.pos[0] - b.pos[0])[Math.floor(live.length * 0.1)].id;
};

const TOURS: Record<'A' | 'B' | 'C', { title: string; short: string; steps: Step[] }> = {
  A: { title: 'Main stage', short: 'Stage', steps: [
    { text: 'Drag to orbit, right-drag to pan, scroll to zoom. The swarm is real 3D positions.', check: a => a.store.state.camera === null && a.stage.camera.position.distanceTo({ x: 0, y: 6, z: 95 } as never) > 3 },
    { text: 'Camera presets: 1 audience, 2 three-quarter, 3 top.', run: a => a.actions.camera('quarter') },
    { text: 'Pause with Space, then step single ticks with “.”.', run: a => a.actions.togglePlay(false), check: a => !a.session.playing },
    { text: 'Open Lenses from the dock, then dismiss it with Esc or a click outside.', run: a => a.surfaces.open('lenses'), check: a => a.surfaces.isOpen('lenses') },
    { text: 'Open the metrics readout (top right, or M).', run: a => a.surfaces.open('metrics'), check: a => a.surfaces.isOpen('metrics') },
    { text: 'Performance mode: H hides every control. H or Esc brings them back.', run: a => { a.actions.togglePlay(true); a.actions.camera('audience'); a.store.set({ chromeHidden: true }); }, check: a => a.store.state.chromeHidden },
  ] },
  B: { title: 'Compose & transmit', short: 'Compose', steps: [
    { text: 'Open Compose (F). Drafts are local; nothing is sent while you edit.', run: a => a.surfaces.open('composer'), check: a => a.surfaces.isOpen('composer') },
    { text: 'Type your own word. Try “HI!” to see validation from the real font table.', run: a => { a.surfaces.open('composer'); a.drafts.update({ kind: 'text', text: 'HI!' }); } },
    { text: 'Fix it, choose two colours, and preview in the stage.', run: a => { a.drafts.update({ kind: 'text', text: 'DURHACK', name: 'Durhack', palette: [[0, 0.76, 0.66], [0.71, 0.96, 0]] }); const v = a.validate(a.drafts.current); a.store.set({ preview: { recipe: v.recipe!, label: 'Durhack' } }); }, check: a => a.store.state.preview !== null },
    { text: 'Pick ONE drone in the stage and inject. Only that drone receives the uplink.', run: a => { a.store.set({ preview: null }); a.actions.inject(edgeDrone(a)); a.actions.lens('colour', 'belief'); }, check: a => a.session.injections.length > 0 },
    { text: 'Watch adoption spread by radio: belief colours, the X-ray, and the Show timeline.', run: a => { a.actions.lens('xray', true); a.surfaces.open('timeline'); } },
    { text: 'Same thing from the console: form text, then inject --pick. Tab completes.', run: async a => { a.surfaces.open('console'); const c = document.querySelector('.console') as HTMLElement & { type(l: string): Promise<void> }; await c.type('form text "ENCORE" --colors #FFB000 #FF3D7F'); } },
  ] },
  C: { title: 'Distributed systems', short: 'Analyse', steps: [
    { text: 'Click a drone to inspect it: agent knowledge above, observer truth below.', run: a => a.actions.select(edgeDrone(a)), check: a => a.store.state.selected !== null },
    { text: 'Radio X-ray (X): lines are drawn only from the real radio log.', run: a => a.actions.lens('xray', true), check: a => a.store.state.lenses.xray },
    { text: 'Destroy a region (K) with ghost slots on (G). Watch claims (cyan) refill it.', run: a => { a.actions.lens('ghosts', true); const s = a.store.state.selected; const p = a.session.arms.encore.curr.drones[s?.id ?? edgeDrone(a)].pos; a.actions.dispatch({ kind: 'killRegion', centre: p, radius: 5 }); }, check: a => a.session.scheduled.some(e => e.type === 'KILL') },
    { text: 'Jam the radio (J). White rings mark drones that have gone deaf.', run: a => { a.actions.select(null); a.actions.dispatch({ kind: 'jamOn', centre: [0, 40, 0], radius: 14 }); }, check: a => a.session.arms.encore.curr.jams.length > 0 },
    { text: 'Inject outside the jam with belief colours on (C): versions diverge.', run: a => { a.actions.lens('colour', 'belief'); a.actions.inject(far(a), a.drafts.list.find(d => d.kind === 'sphere')?.id); } },
    { text: 'Compare: split view (B) puts the static baseline below. Open metrics (M).', run: a => { a.actions.setView('split'); a.surfaces.open('metrics'); }, check: a => a.store.state.view === 'split' },
  ] },
};

export function createGuide(app: App): HTMLElement & { tick(): void; collapse(): void } {
  let tour: 'A' | 'B' | 'C' = 'A';
  let collapsed = false;
  const done: Record<string, boolean> = {};
  const list = h('ol');
  const tabs = h('div', { class: 'gtabs' });
  const head = h('button', { class: 'ghead', 'aria-expanded': 'true', onclick: () => { collapsed = !collapsed; el.classList.toggle('collapsed', collapsed); head.setAttribute('aria-expanded', String(!collapsed)); } },
    h('span', { class: 'tag proto' }, 'Review'), h('b', {}, 'Prototype walkthroughs'), h('span', { html: icon.chevL, style: { width: '14px', transform: 'rotate(-90deg)', display: 'inline-flex' } }));
  const el = h('div', { class: 'guide surface chrome', 'aria-label': 'Prototype review guide (not part of the product)' }, head, h('div', { class: 'gbody' }, tabs, list, h('div', { class: 'hint', style: { padding: '0 12px 12px' } }, 'Not product UI. “Show me” drives the same actions as the controls.'))) as unknown as HTMLElement & { tick(): void; collapse(): void };
  el.collapse = () => { collapsed = true; el.classList.add('collapsed'); head.setAttribute('aria-expanded', 'false'); };
  function render() {
    tabs.innerHTML = '';
    for (const k of ['A', 'B', 'C'] as const) tabs.append(h('button', { class: 'btn small', 'aria-pressed': String(k === tour), style: k === tour ? { borderColor: 'var(--ice)' } : {}, onclick: () => { tour = k; render(); } }, `${k} · ${TOURS[k].short}`));
    list.innerHTML = '';
    TOURS[tour].steps.forEach((s, i) => {
      const id = `${tour}${i}`;
      list.append(h('li', { class: done[id] ? 'done' : '' }, h('span', {}, s.text), s.run ? h('button', { class: 'btn small', onclick: async () => { await s.run!(app); done[id] = true; render(); } }, 'Show me') : h('span', {})));
    });
  }
  let acc = 0;
  el.tick = () => {
    if (++acc % 30) return;
    let changed = false;
    TOURS[tour].steps.forEach((s, i) => { const id = `${tour}${i}`; if (!done[id] && s.check?.(app)) { done[id] = true; changed = true; } });
    if (changed) render();
  };
  if (window.innerWidth < 1280) { collapsed = true; el.classList.add('collapsed'); head.setAttribute('aria-expanded', 'false'); }
  render();
  return el;
}
