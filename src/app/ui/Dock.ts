// src/app/ui/Dock.ts
// The single bottom dock (DESIGN.md §2.1, §4): transport (play, clock, step, speed, reset) | Compose, Disrupt,
// Lenses | Encore · Split · Static | Show, Console | Help. Buttons only call back; the shell routes every one
// through the action API. Each button names its key; open surfaces are marked with aria-expanded.
// Shared module: no createPanel export, so the panel loader skips it.
import { fmtTime, h } from './dom';
import { icon } from './icons';
import type { ViewMode } from './store';

export interface DockHandlers {
  play(): void; step(): void; speed(): void; reset(): void;
  compose(): void; disrupt(): void; lenses(): void; view(v: ViewMode): void;
  show(): void; console(): void; help(): void;
}
export interface DockState { playing: boolean; tick: number; speed: number; view: ViewMode; stopped: boolean }
export interface Dock {
  /** The bottom stack (trays will stack above the dock here). */
  readonly el: HTMLElement;
  readonly buttons: { compose: HTMLButtonElement; disrupt: HTMLButtonElement; lenses: HTMLButtonElement; show: HTMLButtonElement; console: HTMLButtonElement; help: HTMLButtonElement };
  update(state: DockState): void;
}

const VIEWS: { v: ViewMode; label: string; title: string }[] = [
  { v: 'encore', label: 'Encore', title: 'Encore only (B)' },
  { v: 'split', label: 'Split', title: 'Encore above, static baseline below (B)' },
  { v: 'static', label: 'Static', title: 'Static baseline only (B)' },
];

export function createDock(on: DockHandlers): Dock {
  const btn = (ic: string, label: string, key: string, onclick: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', class: 'dock-btn', 'data-tip': '', 'aria-label': `${label} (${key})`, onclick, ...extra },
      h('span', { html: ic }), h('span', { class: 'lbl' }, label), h('span', { class: 'tip' }, label, h('kbd', {}, key)));
  const play = h('button', { type: 'button', class: 'dock-btn play', 'data-tip': '', 'aria-label': 'Play or pause (Space)', onclick: on.play });
  const clock = h('div', { class: 'clock', 'aria-live': 'off' }, h('span', { class: 't' }, fmtTime(0)), h('span', { class: 's' }, 'tick 0'));
  const step = h('button', { type: 'button', class: 'dock-btn', 'data-tip': '', 'aria-label': 'Step one tick (.)', onclick: on.step }, h('span', { html: icon.step }), h('span', { class: 'tip' }, 'Step one tick', h('kbd', {}, '.')));
  const speed = h('button', { type: 'button', class: 'dock-btn speed', 'data-tip': '', 'aria-label': 'Playback speed ([ and ])', onclick: on.speed }, '1×');
  const reset = btn(icon.reset, 'Reset', 'R', on.reset);
  const compose = btn(icon.compose, 'Compose', 'F', on.compose, { 'aria-expanded': 'false' });
  const disrupt = btn(icon.disrupt, 'Disrupt', 'K J P', on.disrupt, { 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
  const lenses = btn(icon.lenses, 'Lenses', 'X C', on.lenses, { 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
  const compare = h('div', { class: 'seg compare', role: 'radiogroup', 'aria-label': 'World shown (B)' },
    ...VIEWS.map(({ v, label, title }) => h('button', { type: 'button', role: 'radio', 'data-view': v, 'aria-checked': String(v === 'encore'), title, onclick: () => on.view(v) }, label)));
  const show = btn(icon.timeline, 'Show', 'D', on.show, { 'aria-pressed': 'false', title: 'Run or stop the scripted 90-second show (D). The timeline is T.' });
  const consoleBtn = btn(icon.console, 'Console', '/', on.console, { 'aria-expanded': 'false' });
  const help = btn(icon.help, 'Help', '?', on.help, { 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
  const sep = () => h('span', { class: 'sep', 'aria-hidden': 'true' });
  const dock = h('nav', { class: 'dock surface chrome', 'aria-label': 'Encore controls' },
    play, clock, step, speed, reset, sep(), compose, disrupt, lenses, sep(), compare, sep(), show, consoleBtn, sep(), help);
  const el = h('div', { class: 'bottom' }, dock);
  let last = '';
  return {
    el,
    buttons: { compose, disrupt, lenses, show, console: consoleBtn, help },
    update(state) {
      const key = `${state.playing}|${state.tick}|${state.speed}|${state.view}|${state.stopped}`;
      if (key === last) return;
      last = key;
      play.innerHTML = state.playing ? icon.pause : icon.play;
      play.setAttribute('aria-pressed', String(state.playing));   // pressed = playing
      play.title = state.stopped ? 'Stopped by an error: press R to reset' : state.playing ? 'Pause (Space)' : 'Play (Space)';
      (clock.children[0] as HTMLElement).textContent = fmtTime(state.tick);
      (clock.children[1] as HTMLElement).textContent = `tick ${state.tick}`;
      speed.textContent = `${state.speed}×`;
      for (const b of compare.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.view === state.view));
    },
  };
}
