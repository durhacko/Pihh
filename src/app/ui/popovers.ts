// src/app/ui/popovers.ts
// Light-dismiss popovers (DESIGN.md §2.2, §4): Lenses, Disrupt, Metrics, Help. Ported from the prototype as
// plain modules. Every world-changing control goes through the one action API (src/app/actions.ts) via
// ctx.run, the same path as the keys; lenses and the camera are visual only. Numbers come from observer
// samples (through the HUD model), the radio layer's own tally, or a snapshot; nothing is invented.
// Shared module: no createPanel export, so the panel loader skips it.
import type { MetricsSample, WorldSnapshot } from '../../contracts';
import type { ControlIntent, ControlResult, ControlStatus } from '../actions';
import type { CameraPreset } from '../render/CameraRig';
import type { Pair } from '../worlds';
import { h } from './dom';
import type { HudPresentation } from './Hud';
import { icon } from './icons';
import type { Store } from './store';
import type { Surfaces } from './surfaces';

export interface PopoverContext {
  store: Store;
  surfaces: Surfaces;
  /** Runs an intent through the controller; the shell reports the result. */
  run(intent: ControlIntent): ControlResult;
  status(): ControlStatus;
  /** The Encore world's newest snapshot (read-only), or null. */
  encore(): WorldSnapshot | null;
  /** Ask for a centre in the stage, then run the region kill or jam there. */
  pick(purpose: 'killRegion' | 'jam', radius: number): void;
  camera(preset: CameraPreset): void;
  hud(): HudPresentation;
  series(): Pair<readonly MetricsSample[]>;
  meta(): { tick: number; seed: number; roster: number; fps: number | null; speed: number; radio: { drawn: number; observed: number } | null };
}
export interface Popover { readonly el: HTMLElement; render(): void }

// ---------- Disrupt ----------
export interface DisruptState { selectedId: number | null; selectedAlive: boolean; jamActive: boolean; partitioned: boolean }
export type DisruptRun = { kind: 'intent'; intent: ControlIntent } | { kind: 'pick'; purpose: 'killRegion' | 'jam'; radius: number };
export interface DisruptAction { id: string; title: string; desc: string; key?: string; disabled?: boolean; active?: boolean; run: DisruptRun }

/** What the Disrupt popover offers in a given state. Pure, so the choices are tested without a DOM. */
export function disruptActions(state: DisruptState, settings: { regionRadius: number; jamRadius: number }): DisruptAction[] {
  const sel = state.selectedAlive ? state.selectedId : null;
  return [
    { id: 'kill-region', title: 'Destroy a region', desc: `Click a centre in the stage; every live drone within ${settings.regionRadius} m dies`, key: 'K', run: { kind: 'pick', purpose: 'killRegion', radius: settings.regionRadius } },
    { id: 'kill-selected', title: sel !== null ? `Kill drone #${sel}` : 'Kill selected drone', desc: sel !== null ? 'Removed from sensing and radio next tick' : 'Select a drone first (click one)', disabled: sel === null, run: { kind: 'intent', intent: { type: 'kill-selected' } } },
    { id: 'kill-random', title: 'Kill 10% at random', desc: 'An even thinning: expect both worlds to look similar', run: { kind: 'intent', intent: { type: 'kill-random' } } },
    state.jamActive
      ? { id: 'jam', title: 'Lift jam', desc: 'Radio inside the sphere works again', key: 'J', active: true, run: { kind: 'intent', intent: { type: 'jam' } } }
      : { id: 'jam', title: 'Jam radio', desc: `Click a centre; messages to or from within ${settings.jamRadius} m are blocked. Sensing still works`, key: 'J', run: { kind: 'pick', purpose: 'jam', radius: settings.jamRadius } },
    { id: 'partition', title: state.partitioned ? 'Reconnect partition' : 'Partition the swarm', desc: state.partitioned ? 'The two groups hear each other again' : 'Two radio groups split at x = 0, fixed wherever they fly', key: 'P', active: state.partitioned, run: { kind: 'intent', intent: { type: 'partition' } } },
  ];
}

export function createDisrupt(ctx: PopoverContext): Popover {
  const el = h('div', { class: 'popover surface chrome', 'aria-label': 'Disrupt: failures and radio' });
  const settings = { regionRadius: 8, jamRadius: 12 };
  let loss = 5;
  function render(): void {
    const snap = ctx.encore();
    const status = ctx.status();
    const actions = disruptActions({
      selectedId: status.selectedId, selectedAlive: status.selectedAlive,
      jamActive: (snap?.jams.length ?? 0) > 0, partitioned: (snap?.partitions.length ?? 0) > 0,
    }, settings);
    const button = (a: DisruptAction) => h('button', {
      type: 'button', class: `action ${a.active ? 'active' : ''}`, disabled: a.disabled, 'data-action': a.id,
      onclick: () => {
        ctx.surfaces.close('disrupt', false);   // a popover closes when it runs an action
        if (a.run.kind === 'pick') ctx.pick(a.run.purpose, a.run.radius); else ctx.run(a.run.intent);
      },
    }, h('span', { class: 'ic', html: a.id === 'kill-region' ? icon.region : a.id === 'kill-random' ? icon.dice : a.id === 'jam' ? icon.jam : a.id === 'partition' ? icon.split : icon.kill }),
    h('span', { class: 'txt' }, h('b', {}, a.title), h('small', {}, a.desc)), a.key ? h('kbd', {}, a.key) : null);
    const slider = (label: string, min: number, max: number, step: number, value: number, unit: string, set: (v: number) => void) => {
      const out = h('span', { class: 'mono hint' }, `${value}${unit}`);
      const input = h('input', { type: 'range', class: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
      input.addEventListener('input', () => { set(Number(input.value)); out.textContent = `${input.value}${unit}`; });
      return [h('div', { class: 'row' }, h('label', { class: 'grow' }, label), out), h('div', { class: 'row' }, input)];
    };
    const byId = (id: string) => button(actions.find(a => a.id === id)!);
    const jam = actions.find(a => a.id === 'jam')!;
    el.replaceChildren(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Disrupt'), h('span', { class: 'hint' }, 'Both worlds, next tick')),
      h('section', {}, byId('kill-region'), ...slider('Region radius', 3, 16, 1, settings.regionRadius, ' m', v => { settings.regionRadius = v; }), byId('kill-selected'), byId('kill-random')),
      h('section', {}, button(jam), ...(jam.active ? [] : slider('Jam radius', 4, 30, 1, settings.jamRadius, ' m', v => { settings.jamRadius = v; })), byId('partition'),
        h('div', { class: 'row' }, h('span', { html: icon.loss, style: { width: '16px', color: 'var(--text-2)' } }), h('label', { class: 'grow' }, `Packet loss (now ${(status.loss * 100).toFixed(0)}%)`)),
        ...slider('Packet loss', 0, 100, 5, loss, '%', v => { loss = v; }),
        h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn small', 'data-action': 'loss', onclick: () => { ctx.surfaces.close('disrupt', false); ctx.run({ type: 'loss', loss: loss / 100 }); } }, 'Apply loss'))),
    );
  }
  return { el, render };
}

// ---------- Lenses ----------
export function createLenses(ctx: PopoverContext): Popover {
  const el = h('div', { class: 'popover surface chrome', 'aria-label': 'Lenses' });
  function sw(label: string, desc: string, key: string, checked: boolean, toggle: () => void, disabled = false, tag?: string) {
    const input = h('input', { type: 'checkbox', role: 'switch', disabled }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener('change', toggle);
    return h('label', { class: 'switch', style: disabled ? { opacity: '.55', cursor: 'not-allowed' } : undefined }, input,
      h('span', { class: 'txt' }, h('b', {}, label, tag ? h('span', { class: 'tag later', style: { marginLeft: '8px' } }, tag) : null), h('small', {}, desc)), key ? h('kbd', {}, key) : null);
  }
  function render(): void {
    const lenses = ctx.store.state.lenses;
    el.replaceChildren(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Lenses'), h('span', { class: 'hint' }, 'Visual only')),
      h('section', {},
        sw('Radio X-ray', 'Real messages from the radio log, jam spheres and the partition plane; dims the show', 'X', lenses.xray, () => ctx.run({ type: 'xray' })),
        sw('Belief colours', 'Colour each drone by the score version it holds', 'C', lenses.colour === 'belief', () => ctx.run({ type: 'belief' })),
        sw('Ghost slots', 'Observer view: vacant, in-transit, contested', 'G', lenses.ghosts, () => ctx.store.lens('ghosts', !ctx.store.state.lenses.ghosts)),
        sw('Tethers', 'Line to where a drone believes it should be (selected drone; all with X-ray)', '', lenses.tethers, () => ctx.store.lens('tethers', !ctx.store.state.lenses.tethers))),
      h('section', {},
        h('div', { class: 'row' }, h('span', { class: 'eyebrow grow' }, 'Camera'),
          ...(['audience', 'quarter', 'top'] as const).map((p, i) => h('button', { type: 'button', class: 'btn small', onclick: () => ctx.camera(p) }, p === 'quarter' ? '¾' : p === 'audience' ? 'Front' : 'Top', h('kbd', {}, String(i + 1))))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { if (lenses.xray) ctx.run({ type: 'xray' }); if (lenses.colour === 'belief') ctx.run({ type: 'belief' }); ctx.store.lens('ghosts', false); render(); } }, 'Reset to performance view'),
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { ctx.surfaces.close('lenses', false); ctx.store.set({ chromeHidden: true }); } }, 'Hide UI', h('kbd', {}, 'H')))),
    );
  }
  ctx.store.subscribe((_s, changed) => { if (changed.includes('lenses') && !el.hidden) render(); });
  return { el, render };
}

// ---------- Metrics ----------
/** Keyboard scrolling for a focused scroll container; returns the new scrollTop, or null if the key is not a scroll key. */
export function scrollByKey(key: string, box: { scrollTop: number; clientHeight: number; scrollHeight: number }, line = 40): number | null {
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  const page = Math.max(line, box.clientHeight * 0.9);
  const next = key === 'ArrowDown' ? box.scrollTop + line : key === 'ArrowUp' ? box.scrollTop - line
    : key === 'PageDown' ? box.scrollTop + page : key === 'PageUp' ? box.scrollTop - page
      : key === 'Home' ? 0 : key === 'End' ? max : null;
  return next === null ? null : Math.min(max, Math.max(0, next));
}

function spark(series: Pair<readonly MetricsSample[]>): HTMLCanvasElement {
  const c = h('canvas', { class: 'spark', width: 400, height: 34, role: 'img', 'aria-label': 'nPWC over the last minute: Encore solid, static dashed' }) as HTMLCanvasElement;
  const g = c.getContext('2d');
  if (!g) return c;
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(0, 32 - 0.95 * 30); g.lineTo(400, 32 - 0.95 * 30); g.stroke();
  const draw = (s: readonly MetricsSample[], colour: string, dash: number[]) => {
    const last = s.slice(-240).filter(m => m.npwc !== null);
    if (last.length < 2) return;
    g.strokeStyle = colour; g.setLineDash(dash); g.lineWidth = 1.5; g.beginPath();
    last.forEach((m, i) => { const x = i / (last.length - 1) * 400; const y = 32 - (m.npwc ?? 0) * 30; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  };
  draw(series.static, '#7f99a6', [3, 3]); draw(series.encore, '#d6ecf3', []);
  return c;
}

export function createMetrics(ctx: PopoverContext): Popover {
  const el = h('div', { class: 'popover metrics surface chrome', 'aria-label': 'Metrics', tabindex: '0' });
  el.addEventListener('keydown', (event: KeyboardEvent) => {
    const next = scrollByKey(event.key, el);
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    el.scrollTop = next;
  });
  function render(): void {
    const view = ctx.hud();
    const meta = ctx.meta();
    const a = view.encore, b = view.static;
    const title = h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Metrics'), h('span', { class: 'tag obs', title: 'Measured by src/observer: ground truth the drones cannot see' }, 'observer'));
    if (!a || !b) { el.replaceChildren(title, h('p', { class: 'hint', style: { padding: '8px' } }, view.status)); return; }
    const row = (label: string, va: string, vb: string, opts: { big?: boolean; sub?: string } = {}) => [
      h('div', { class: 'l' }, label, opts.sub ? h('small', {}, opts.sub) : null),
      h('div', { class: `v ${opts.big ? 'big' : ''}` }, va), h('div', { class: `v ${opts.big ? 'big' : ''}` }, vb)];
    el.replaceChildren(
      title,
      h('div', { style: { padding: '0 8px 6px' } }, spark(ctx.series())),
      h('div', { class: 'mgrid' },
        h('div', { class: 'h' }, ''), h('div', { class: 'h v' }, 'Encore'), h('div', { class: 'h v' }, 'Static'),
        ...row('nPWC', a.npwc, b.npwc, { big: true, sub: a.transitioning ? 'in transition: read with care' : 'priority-weighted, our slot order' }),
        ...row('Alive', a.alive, b.alive),
        ...row('Coverage', a.coverage, b.coverage),
        ...row('Duplicate slots', a.duplicates, b.duplicates),
        ...row('Score versions', a.versions, b.versions),
        ...row('Messages', a.messages, b.messages),
        ...row('Delivered', a.delivered, b.delivered, { sub: 'of in-range receivers' }),
        ...row('Collisions', a.collisions, b.collisions, { sub: 'measured' }),
        ...row('Near misses', a.nearMisses, b.nearMisses, { sub: 'measured' }),
        ...row('Slot changes', a.slotChanges, b.slotChanges),
        ...row('Shape fidelity', a.fidelity, b.fidelity)),
      h('div', { class: 'mfoot' },
        h('div', {}, 'Tick', h('b', {}, String(meta.tick))),
        h('div', {}, 'Seed · roster', h('b', {}, `${meta.seed} · ${meta.roster}`)),
        h('div', {}, 'Render', h('b', {}, meta.fps === null ? '—' : `${meta.fps.toFixed(0)} fps`)),
        h('div', {}, 'Speed', h('b', {}, `${meta.speed}×`)),
        h('div', {}, 'Radio drawn', h('b', {}, meta.radio ? `${meta.radio.drawn} / ${meta.radio.observed}` : 'X-ray off')),
        h('div', {}, 'Brains', h('b', {}, `${a.label.split(' · ')[1] ?? '?'} / ${b.label.split(' · ')[1] ?? '?'}`))),
      h('p', { class: 'hint', style: { margin: '6px 8px 2px' } }, view.status, '. Static drones ignore injected scores by design: a capability difference, not a performance result.'),
    );
  }
  return { el, render };
}

// ---------- Help ----------
export function createHelp(ctx: PopoverContext): Popover {
  const el = h('div', { class: 'popover help surface chrome', 'aria-label': 'Help and settings' });
  const keys: [string, string][] = [
    ['Space', 'Play / pause'], ['.', 'Step one tick'], ['[ ]', 'Slower / faster'], ['R', 'Reset from seed'],
    ['1 2 3', 'Camera: front, ¾, top'], ['K', 'Destroy a region'], ['J', 'Jam / lift jam'], ['P', 'Partition / reconnect'],
    ['X', 'Radio X-ray'], ['C', 'Belief colours'], ['G', 'Ghost slots (observer)'], ['B', 'Encore → split → static'], ['M', 'Metrics'],
    ['H', 'Hide all controls'], ['?', 'This help'], ['Esc', 'Close / cancel / deselect'], ['F', 'Compose'], ['I', 'Compose and inject'],
    ['/ or `', 'Console'], ['T', 'Show timeline'], ['D', 'Run / stop the 90 s show'],
  ];
  function render(): void {
    const rm = h('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
    rm.checked = ctx.store.state.reducedMotion;
    rm.addEventListener('change', () => ctx.store.set({ reducedMotion: rm.checked }));
    el.replaceChildren(
      h('div', { class: 'pop-title' }, h('span', { class: 'eyebrow' }, 'Help'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close help', html: icon.close, onclick: () => ctx.surfaces.close('help') })),
      h('h3', {}, 'Keyboard'),
      h('div', { class: 'cols' }, ...keys.map(([k, d]) => h('div', { class: 'k' }, h('span', {}, d), h('kbd', {}, k)))),
      h('h3', {}, 'What is simulated'),
      h('p', {}, 'Everything. There are no physical drones. Each drone is an independent software agent with private state; it senses nearby drones anonymously and hears one-hop radio broadcasts. The program plays the air and the radio, never a controller. Collisions are measured, not prevented.'),
      h('p', {}, 'Two worlds run from the same seed and receive the same events: Encore above, the static, pre-programmed baseline below. Every number on screen is measured by the observer.'),
      h('h3', {}, 'Settings'),
      h('label', { class: 'switch' }, rm, h('span', { class: 'txt' }, h('b', {}, 'Reduce motion'), h('small', {}, 'No transitions or toast animations'))),
    );
  }
  return { el, render };
}
