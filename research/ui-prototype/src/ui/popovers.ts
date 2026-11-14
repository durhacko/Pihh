// Light-dismiss popovers: Lenses, Disrupt, Metrics, Help.
import type { MetricsSample } from '@encore/contracts';
import { EVENT_SUPPORT } from '../engine/session';
import type { App } from './app';
import { fmt, h } from './dom';
import { icon } from './icons';
import type { Lenses } from './store';

const supportTag = (t: keyof typeof EVENT_SUPPORT) => EVENT_SUPPORT[t] === 'main'
  ? h('span', { class: 'tag main', title: 'src/sim/world.ts on main accepts this event today' }, 'main')
  : h('span', { class: 'tag proto', title: 'Only the prototype engine accepts this event; main rejects it until #14 lands it' }, 'proto');

export function createLenses(app: App): HTMLElement {
  const el = h('div', { class: 'popover surface chrome', 'aria-label': 'Lenses' });
  function sw(key: keyof Lenses, label: string, desc: string, k: string) {
    const input = h('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
    input.checked = key === 'colour' ? app.store.state.lenses.colour === 'belief' : Boolean(app.store.state.lenses[key]);
    input.addEventListener('change', () => key === 'colour' ? app.actions.lens('colour', input.checked ? 'belief' : 'show') : app.actions.lens(key, input.checked as never));
    return h('label', { class: 'switch' }, input, h('span', { class: 'txt' }, h('b', {}, label), h('small', {}, desc)), k ? h('kbd', {}, k) : null);
  }
  function render() {
    const keep = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest('label')?.querySelector('b')?.textContent : null;
    el.innerHTML = '';
    queueMicrotask(() => { if (keep) [...el.querySelectorAll('label.switch')].find(l => l.querySelector('b')?.textContent === keep)?.querySelector('input')?.focus(); });
    el.append(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Lenses'), h('span', { class: 'hint' }, 'Visual only')),
      h('section', {},
        sw('xray', 'Radio X-ray', 'Real messages from the radio log; dims the show', 'X'),
        sw('colour', 'Belief colours', 'Colour each drone by the score version it holds', 'C'),
        sw('ghosts', 'Ghost slots', 'Observer view: vacant, in-transit, contested', 'G'),
        sw('tethers', 'Tethers', 'Line to where each drone believes it should be', ''),
        sw('zones', 'Zones', 'Jam spheres and partition groups', ''),
        sw('neighbourhood', 'Selected neighbourhood', 'Sensing sphere, radio range, sensed peers', '')),
      h('section', {},
        h('div', { class: 'row' }, h('span', { class: 'eyebrow grow' }, 'Camera'),
          ...(['audience', 'quarter', 'top'] as const).map((p, i) => h('button', { class: 'btn small', onclick: () => app.actions.camera(p) }, p === 'quarter' ? '¾' : p === 'audience' ? 'Front' : 'Top', h('kbd', {}, String(i + 1))))),
        h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.store.set({ lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true } }) }, 'Reset to performance view'), h('span', { class: 'grow' }), h('button', { class: 'btn small ghost', onclick: () => app.store.set({ chromeHidden: true }) }, 'Hide UI', h('kbd', {}, 'H')))),
    );
  }
  app.store.subscribe((_s, c) => { if (c.includes('lenses') && !el.hidden) render(); });
  Object.assign(el, { render: render });
  return el;
}

export function createDisrupt(app: App): HTMLElement {
  const el = h('div', { class: 'popover surface chrome', 'aria-label': 'Disrupt: failures and radio' });
  let radius = 8, jamR = 12, loss = 5;
  function act(ic: string, title: string, desc: string, run: () => void, opts: { k?: string; tag?: HTMLElement; disabled?: boolean; active?: boolean } = {}) {
    return h('button', { class: `action ${opts.active ? 'active' : ''}`, disabled: opts.disabled, onclick: () => { app.surfaces.close('disrupt', false); run(); } },
      h('span', { class: 'ic', html: ic }), h('span', { class: 'txt' }, h('b', {}, title), h('small', {}, desc)), opts.tag ?? null, opts.k ? h('kbd', {}, opts.k) : null);
  }
  function render() {
    const snap = app.session.arms.encore.curr;
    const sel = app.actions.selectedLive();
    const jams = snap.jams, parted = snap.partitions.length > 0;
    const rIn = h('input', { type: 'range', class: 'range', min: 3, max: 16, step: 1, value: radius, 'aria-label': 'Region radius' }) as HTMLInputElement;
    const rOut = h('span', { class: 'mono hint' }, `${radius} m`);
    rIn.addEventListener('input', () => { radius = Number(rIn.value); rOut.textContent = `${radius} m`; });
    const jIn = h('input', { type: 'range', class: 'range', min: 4, max: 30, step: 1, value: jamR, 'aria-label': 'Jam radius' }) as HTMLInputElement;
    const jOut = h('span', { class: 'mono hint' }, `${jamR} m`);
    jIn.addEventListener('input', () => { jamR = Number(jIn.value); jOut.textContent = `${jamR} m`; });
    const lIn = h('input', { type: 'range', class: 'range', min: 0, max: 60, step: 5, value: loss, 'aria-label': 'Packet loss' }) as HTMLInputElement;
    const lOut = h('span', { class: 'mono hint' }, `${loss}%`);
    lIn.addEventListener('input', () => { loss = Number(lIn.value); lOut.textContent = `${loss}%`; });
    el.innerHTML = '';
    el.append(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Disrupt'), h('span', { class: 'hint' }, 'Both worlds, next tick')),
      h('section', {},
        act(icon.region, 'Destroy a region', 'Click a centre in the stage; every live drone inside dies', () => void app.actions.killRegion(radius), { k: 'K', tag: supportTag('KILL') }),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Region radius'), rOut), h('div', { class: 'row' }, rIn),
        act(icon.kill, sel !== null ? `Kill drone #${sel}` : 'Kill selected drone', sel !== null ? 'Removed from sensing and radio this tick' : 'Select a drone first', () => app.actions.killSelected(), { disabled: sel === null, tag: supportTag('KILL') }),
        act(icon.dice, 'Kill 10% at random', 'An even thinning: expect both worlds to look similar', () => app.actions.killRandom(0.1), { tag: supportTag('KILL') })),
      h('section', {},
        jams.length
          ? act(icon.jam, `Lift jam ${jams[jams.length - 1].id}`, `${jams.length} active · radius ${jams[jams.length - 1].radius} m`, () => app.actions.unjam(), { k: 'J', active: true, tag: supportTag('JAM_OFF') })
          : act(icon.jam, 'Jam radio', 'Click a centre; messages to or from inside are blocked. Sensing still works.', () => void app.actions.jam(jamR), { k: 'J', tag: supportTag('JAM_ON') }),
        jams.length ? null : h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Jam radius'), jOut),
        jams.length ? null : h('div', { class: 'row' }, jIn),
        act(icon.split, parted ? 'Reconnect partition' : 'Partition the swarm', parted ? 'Groups hear each other again' : 'Two radio groups split at x = 0, fixed wherever they fly', () => app.actions.partition(), { k: 'P', active: parted, tag: supportTag('PARTITION_ON') }),
        h('div', { class: 'row' }, h('span', { html: icon.loss, style: { width: '16px', color: 'var(--text-2)' } }), h('label', { class: 'grow' }, `Packet loss (now ${(app.session.loss * 100).toFixed(0)}%)`), lOut, supportTag('SET_LOSS')),
        h('div', { class: 'row' }, lIn, h('button', { class: 'btn small', onclick: () => app.actions.setLoss(loss / 100) }, 'Apply'))),
    );
  }
  Object.assign(el, { render: render });
  return el;
}

function spark(series: MetricsSample[], other: MetricsSample[], colourA: string, colourB: string): HTMLCanvasElement {
  const c = h('canvas', { class: 'spark', width: 340, height: 34, role: 'img', 'aria-label': 'nPWC over the last minute, Encore solid, static dashed' }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const draw = (s: MetricsSample[], col: string, dash: number[]) => {
    const last = s.slice(-240);
    if (last.length < 2) return;
    g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = 1.5; g.beginPath();
    last.forEach((m, i) => { const x = i / 239 * 340, y = 32 - (m.npwc ?? 0) * 30; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  };
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(0, 32 - 0.95 * 30); g.lineTo(340, 32 - 0.95 * 30); g.stroke();
  draw(other, colourB, [3, 3]); draw(series, colourA, []);
  return c;
}

export function createMetrics(app: App): HTMLElement {
  const el = h('div', { class: 'popover metrics surface chrome', 'aria-label': 'Metrics' });
  function render() {
    const E = app.session.arms.encore, S = app.session.arms.static;
    const a = E.sample, b = S.sample;
    if (!a || !b) { el.innerHTML = '<div class="pop-title"><span class="eyebrow">Metrics</span></div><p class="hint" style="padding:8px">Waiting for the first observer sample…</p>'; return; }
    const perSec = (s: MetricsSample[], k: 'hb' | 'score') => { const n = s.length; if (n < 5) return 0; return (s[n - 1].msgs[k] - s[n - 5].msgs[k]) / 1; };
    const share = (m: MetricsSample) => { const t = m.msgs.delivered + m.msgs.lost + m.msgs.blocked; return t ? `${(m.msgs.delivered / t * 100).toFixed(0)}%` : '—'; };
    const recE = E.observer.recovery(), recS = S.observer.recovery();
    const rec = (r: typeof recE) => r.since === null ? '—' : r.seconds !== null ? `${r.seconds.toFixed(1)} s` : 'not yet';
    const vbar = (m: MetricsSample) => {
      const total = Math.max(1, m.alive);
      return h('div', { class: 'bar', style: { width: '100%' }, title: Object.entries(m.versions).map(([k, n]) => `v${k}: ${n}`).join(' · ') }, ...Object.entries(m.versions).map(([k, n]) => h('i', { style: { width: `${n / total * 100}%`, background: app.palette.colour(k) } })));
    };
    const row = (label: string, va: string | Node, vb: string | Node, opts: { big?: boolean; sub?: string } = {}) => [
      h('div', { class: 'l' }, label, opts.sub ? h('small', {}, opts.sub) : null),
      h('div', { class: `v ${opts.big ? 'big' : ''}` }, va), h('div', { class: `v ${opts.big ? 'big' : ''} ${typeof vb === 'string' && vb.startsWith('n/a') ? 'muted' : ''}` }, vb)];
    const rc = app.stage.radioCounter('encore');
    const inHold = E.observer.slotStatus(E.curr).inHold;
    el.innerHTML = '';
    el.append(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Metrics'), h('span', { class: 'tag proto', title: 'Computed by the prototype observer with the evaluation-doc formulas. Production reads src/observer.' }, 'mock observer')),
      h('div', { style: { padding: '0 8px 6px' } }, spark(E.series, S.series, '#d6ecf3', '#7f99a6')),
      h('div', { class: 'mgrid' },
        h('div', { class: 'h' }, ''), h('div', { class: 'h v' }, 'Encore'), h('div', { class: 'h v' }, 'Static'),
        ...row('nPWC', fmt(a.npwc, 3), fmt(b.npwc, 3), { big: true, sub: inHold ? 'priority-weighted, our slot order' : 'in transition — read with care' }),
        ...row('Alive', `${a.alive}/${app.session.params.n0}`, `${b.alive}/${app.session.params.n0}`),
        ...row('Coverage', fmt(a.coverage, 3), fmt(b.coverage, 3)),
        ...row('Recovery', rec(recE), rec(recS), { sub: 'nPWC ≥ 0.95 for 3 s' }),
        ...row('Duplicate slots', String(a.dupSlots), String(b.dupSlots)),
        ...row('Score versions', vbar(a), 'n/a · no uplinks', { sub: `${Object.keys(a.versions).length} held` }),
        ...row('Radio / s', `${perSec(E.series, 'hb').toFixed(0)} HB ${perSec(E.series, 'score').toFixed(0)} SC`, 'n/a · sends none'),
        ...row('Delivered', share(a), '—', { sub: 'of in-range receivers' }),
        ...row('Collisions', String(a.collisions), String(b.collisions), { sub: 'measured' }),
        ...row('Near misses', String(a.nearMisses), String(b.nearMisses), { sub: 'measured' }),
        ...row('Slot changes', String(a.slotChanges), String(b.slotChanges))),
      h('div', { class: 'mfoot' },
        h('div', {}, 'Tick', h('b', {}, String(app.session.tick))),
        h('div', {}, 'Sim step', h('b', {}, `${app.session.stepMs.toFixed(1)} ms`)),
        h('div', {}, 'Render', h('b', {}, `${app.stage.fps.toFixed(0)} fps · ${app.stage.quality}`)),
        h('div', {}, 'Sim rate', h('b', {}, `${(20 * app.session.speed).toFixed(0)} Hz target`)),
        h('div', {}, 'Radio drawn', h('b', {}, app.store.state.lenses.xray ? `${rc.drawn} / ${rc.logged}` : `X-ray off · ${rc.logged} logged`)),
        h('div', {}, 'Seed', h('b', {}, String(app.session.seed)))),
    );
  }
  let acc = 0;
  Object.assign(el, { tick: (dt: number) => { acc += dt; if (acc > 0.25 && !el.hidden) { acc = 0; render(); } } });
  Object.assign(el, { render: render });
  return el;
}

export function createHelp(app: App): HTMLElement {
  const el = h('div', { class: 'popover help surface chrome', 'aria-label': 'Help and settings' });
  const keys: [string, string][] = [
    ['Space', 'Play / pause'], ['.', 'Step one tick (paused)'], ['[ ]', 'Slower / faster'], ['R', 'Reset from seed'],
    ['1 2 3', 'Camera: audience, ¾, top'], ['F', 'Compose'], ['I', 'Inject current draft'], ['T', 'Show timeline'], ['/ or `', 'Console'],
    ['K', 'Destroy a region'], ['J', 'Jam / lift jam'], ['P', 'Partition / reconnect'], ['X', 'Radio X-ray'], ['C', 'Belief colours'], ['G', 'Ghost slots'],
    ['B', 'Encore → split → static'], ['M', 'Metrics'], ['D', 'Run 90 s demo'], ['H', 'Hide all controls'], ['Esc', 'Close / cancel / deselect'],
  ];
  function render() {
    const rm = h('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement; rm.checked = app.store.state.reducedMotion;
    rm.addEventListener('change', () => app.store.set({ reducedMotion: rm.checked }));
    const q = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Render quality' }, ...(['auto', 'high', 'low'] as const).map(v => h('button', { role: 'radio', 'aria-checked': String(app.store.state.quality === v), onclick: () => { app.store.set({ quality: v }); render(); } }, v)));
    el.innerHTML = '';
    el.append(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Help'), h('button', { class: 'icon-btn', 'aria-label': 'Close help', html: icon.close, onclick: () => app.surfaces.close('help') })),
      h('h3', {}, 'Keyboard'),
      h('div', { class: 'cols' }, ...keys.map(([k, d]) => h('div', { class: 'k' }, h('span', {}, d), h('kbd', {}, k)))),
      h('h3', {}, 'What is simulated'),
      h('p', {}, 'Everything. There are no physical drones. Each drone is an independent software agent with private state; it senses nearby drones anonymously and hears one-hop radio broadcasts. The program plays the air and the radio, never a controller. Collisions are measured, not prevented.'),
      h('h3', {}, 'Labels in this prototype'),
      h('p', {}, h('span', { class: 'tag main' }, 'main'), ' runs on code merged today.  ', h('span', { class: 'tag proto' }, 'proto'), ' runs only on the prototype engine (mock Encore brain, mock observer, events main still rejects).  ', h('span', { class: 'tag later' }, 'later'), ' designed, not built.  ', h('span', { class: 'tag obs' }, 'observer'), ' ground truth the drone cannot see.'),
      h('h3', {}, 'Settings'),
      h('label', { class: 'switch' }, rm, h('span', { class: 'txt' }, h('b', {}, 'Reduce motion'), h('small', {}, 'No camera glides, pulses or flash fades'))),
      h('div', { class: 'row' }, h('span', { class: 'grow', style: { fontSize: '12.5px' } }, 'Render quality'), q),
    );
  }
  Object.assign(el, { render: render });
  return el;
}
