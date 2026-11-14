// Show timeline. Three lanes, deliberately separate:
//   Plan    — what the operator has issued (preloaded movements + injected compositions).
//   Events  — environment events scheduled into both worlds.
//   Holds   — what the swarm actually believes over time (observer `versions`), per world.
// No seeking: the deterministic sim could replay to a tick by reset + fast-forward, but that is not built.
import type { Cue } from '../engine/session';
import type { App } from './app';
import { fmtTime, h } from './dom';
import { icon } from './icons';

export function createTimeline(app: App): HTMLElement {
  const { session } = app;
  const lanes = h('div', { class: 'lanes' });
  const detail = h('div', { class: 'cue-detail', 'aria-live': 'polite' });
  const demoBtn = h('button', { class: 'btn small', onclick: () => (app.actions.demo ? app.actions.demo.stop() : app.runDemo()) });
  const el = h('section', { class: 'tray timeline surface chrome', 'aria-label': 'Show timeline' },
    h('div', { class: 'tray-head' }, h('span', { class: 'eyebrow' }, 'Show'), h('span', { class: 'hint' }, 'Operator plan above, what drones actually hold below.'), h('span', { class: 'grow' }),
      h('span', { class: 'tag later', title: 'Cue editing, save/load and seeking are designed but not built' }, 'Edit cues · later'),
      demoBtn, h('button', { class: 'icon-btn', 'aria-label': 'Close timeline', html: icon.close, onclick: () => app.surfaces.close('timeline') })),
    lanes, detail);
  let selectedCue: number | null = null;
  let planSig = '';
  let cueBtns: HTMLButtonElement[] = [];
  const plan = h('div', { class: 'lane plan' });
  const dyn = h('div');
  const playhead = h('div', { class: 'playhead' });
  lanes.append(plan, dyn, playhead);

  function render() {
    const cues = session.cues();
    const now = session.tick;
    const lastStart = Math.max(...cues.map(c => c.startTick + c.transitionTicks));
    const end = Math.max(now + 600, lastStart + 400);
    const x = (t: number) => `${(Math.max(0, Math.min(end, t)) / end * 100).toFixed(3)}%`;
    const w = (a: number, b: number) => `${(Math.max(0, Math.min(end, b) - Math.max(0, a)) / end * 100).toFixed(3)}%`;
    demoBtn.innerHTML = app.actions.demo ? '■ Stop demo' : `${icon.play.replace('<svg', '<svg width="12" height="12"')} Run 90 s demo <kbd>D</kbd>`;

    // Plan: buttons are created once per cue set and only restyled afterwards, so a click is never lost to a rebuild.
    const sig = cues.map(c => `${c.versionKey}@${c.startTick}`).join('|') + `#${selectedCue}`;
    if (sig !== planSig) {
      planSig = sig;
      plan.innerHTML = '';
      plan.append(h('span', { class: 'lname' }, 'PLAN'));
      cueBtns = cues.map((c, i) => {
        const pal = c.recipe.palette ?? null;
        const sw = pal ? `linear-gradient(90deg, rgb(${pal[0].map(v => v * 255).join(',')}), rgb(${pal[1].map(v => v * 255).join(',')}))` : 'var(--text-3)';
        const tr = h('span', { class: 'tr' });
        const btn = h('button', { class: `cue ${c.source === 'injected' ? 'injected' : ''}`, 'aria-pressed': String(selectedCue === i), onclick: () => { selectedCue = selectedCue === i ? null : i; render(); } },
          tr, h('span', { class: 'hold' }),
          h('span', { class: 'lbl' }, h('span', { class: 'sw2', style: { background: sw } }), c.name, c.source === 'injected' ? h('span', { class: 'hint' }, ` v${c.versionKey}`) : null));
        plan.append(btn);
        return btn;
      });
    }
    cues.forEach((c, i) => {
      const btn = cueBtns[i]; if (!btn) return;
      const next = cues[i + 1]?.startTick ?? end;
      const status = now < c.startTick ? 'upcoming' : now < c.startTick + c.transitionTicks ? 'in transition' : now < next ? 'holding' : 'done';
      btn.style.left = x(c.startTick); btn.style.width = w(c.startTick, next);
      btn.classList.toggle('now', status === 'holding' || status === 'in transition');
      btn.title = `${c.name} · ${status}`;
      btn.setAttribute('aria-label', `Cue ${i + 1}: ${c.name}, ${c.source}, starts ${fmtTime(c.startTick)}, ${status}`);
      (btn.firstElementChild as HTMLElement).style.width = `${(c.transitionTicks / Math.max(1, next - c.startTick)) * 100}%`;
    });
    dyn.innerHTML = '';

    // Events
    const ev = h('div', { class: 'lane' }, h('span', { class: 'lname' }, 'EVENTS'));
    const ons = new Map<string, number>();
    for (const e of session.scheduled) {
      if (e.type === 'JAM_ON') ons.set(e.id, e.tick);
      if (e.type === 'JAM_OFF') { const s = ons.get(e.id); if (s !== undefined) { ev.append(h('span', { class: 'band jam', style: { left: x(s), width: w(s, e.tick) }, title: `Jam ${e.id}` })); ons.delete(e.id); } }
      if (e.type === 'PARTITION_ON') ons.set('part', e.tick);
      if (e.type === 'PARTITION_OFF') { const s = ons.get('part'); if (s !== undefined) { ev.append(h('span', { class: 'band part', style: { left: x(s), width: w(s, e.tick) }, title: 'Partition' })); ons.delete('part'); } }
      if (e.type === 'KILL') ev.append(h('span', { class: 'ev', style: { left: x(e.tick), color: 'var(--danger)' }, title: `KILL ${e.ids.length} at ${fmtTime(e.tick)}` }, '✕'));
      if (e.type === 'INJECT_SCORE') ev.append(h('span', { class: 'ev', style: { left: x(e.tick), color: 'var(--score)' }, title: `INJECT_SCORE into #${e.droneId} at ${fmtTime(e.tick)}` }, '◆'));
      if (e.type === 'SET_LOSS') ev.append(h('span', { class: 'ev', style: { left: x(e.tick) }, title: `Loss ${(e.loss * 100).toFixed(0)}%` }, '∿'));
    }
    for (const [id, s] of ons) ev.append(h('span', { class: `band ${id === 'part' ? 'part' : 'jam'}`, style: { left: x(s), width: w(s, now), borderRightStyle: 'dashed' }, title: id === 'part' ? 'Partition (active)' : `Jam ${id} (active)` }));

    // Holds: stacked share of live drones per believed version (observer samples).
    const holdLane = (armName: 'encore' | 'static', label: string) => {
      const lane = h('div', { class: 'lane' }, h('span', { class: 'lname' }, label));
      const wrap = h('div', { class: 'holds' });
      const cv = h('canvas', { width: 1000, height: 44, role: 'img', 'aria-label': `${label}: score versions held over time` }) as HTMLCanvasElement;
      wrap.append(cv); lane.append(wrap);
      const g = cv.getContext('2d')!;
      const series = session.arms[armName].series;
      for (const s of series) {
        const px = Math.floor(s.tick / end * 1000), pw = Math.max(1, Math.ceil(5 / end * 1000));
        let y = 44;
        const total = Math.max(1, s.alive);
        for (const [k, n] of Object.entries(s.versions).sort((a, b) => app.palette.index(a[0]) - app.palette.index(b[0]))) {
          const hh = n / total * 40;
          g.fillStyle = app.palette.colour(k); g.globalAlpha = 0.75;
          g.fillRect(px, y - hh, pw, hh); y -= hh;
        }
      }
      return lane;
    };
    dyn.append(ev, holdLane('encore', 'HOLDS · ENC'), holdLane('static', 'HOLDS · STA'));
    playhead.style.left = `calc(92px + (100% - 106px) * ${now / end})`;
    const axis = h('div', { class: 'axis' });
    const stepS = end * 0.05 > 240 ? 60 : end * 0.05 > 100 ? 20 : 10;
    for (let s = 0; s <= end * 0.05; s += stepS) axis.append(h('span', { style: { left: x(s * 20) } }, `${s}s`));
    dyn.append(axis);

    detail.innerHTML = '';
    if (selectedCue !== null && cues[selectedCue]) {
      const c: Cue = cues[selectedCue];
      const next = cues[selectedCue + 1]?.startTick;
      detail.append(h('b', {}, c.name), h('span', {}, c.source === 'injected' ? `injected · v${c.versionKey}` : 'preloaded'),
        h('span', {}, `starts ${fmtTime(c.startTick)}`), h('span', {}, `transition ${(c.transitionTicks * 0.05).toFixed(1)} s`),
        h('span', {}, next ? `hold ${((next - c.startTick - c.transitionTicks) * 0.05).toFixed(1)} s` : 'holds until the next cue'),
        h('span', { class: 'hint' }, 'Drones that never received this version keep flying their own.'),
        h('button', { class: 'btn small', disabled: true, title: 'Cue editing is planned, not built' }, 'Edit · later'));
    } else detail.append(h('span', { class: 'hint' }, 'Select a cue for timing. Hatched = transition, solid = hold. Seeking is disabled: replay-to-tick is not built.'));
  }
  let acc = 0;
  Object.assign(el, { tick: (dt: number) => { acc += dt; if (acc > 0.25 && app.surfaces.isOpen('timeline')) { acc = 0; render(); } } });
  Object.assign(el, { render });
  return el;
}
