// src/app/ui/Readout.ts
// The one-line readout at the top right (DESIGN.md §1, §4): nPWC (both arms when both are shown), alive, the
// score phase and fps. Numbers come only from observer MetricsSamples; a missing sample shows "—", never 0.
// The phase is the preloaded score's plan at this tick (score timing), labelled as such. Clicking opens Metrics.
// Shared module: no createPanel export, so the panel loader skips it.
import type { MetricsSample } from '../../contracts';
import type { Pair } from '../worlds';
import { fmt, h } from './dom';
import type { ViewMode } from './store';

export interface ReadoutInput {
  samples: Pair<MetricsSample | null>;
  view: ViewMode;
  n0: number;
  /** From currentMovement(score, tick): hold or transition, and the movement's name. */
  phase: { inHold: boolean; name: string } | null;
  fps: number | null;
  /** Set while the loop is stopped by an error. */
  stopped: string | null;
}
export interface ReadoutItem { key: 'npwc' | 'alive' | 'phase' | 'fps' | 'stopped'; label: string; value: string; muted?: boolean; title?: string }

const alive = (s: MetricsSample | null): string => (s ? String(s.alive) : '—');

export function readoutItems(input: ReadoutInput): ReadoutItem[] {
  const { encore, static: baseline } = input.samples;
  const both = input.view === 'split';
  const shown = input.view === 'static' ? baseline : encore;
  const transit = input.phase !== null && !input.phase.inHold;
  const items: ReadoutItem[] = [
    {
      key: 'npwc', label: both ? 'nPWC E / S' : input.view === 'static' ? 'nPWC static' : 'nPWC',
      value: both ? `${fmt(encore?.npwc, 3)} / ${fmt(baseline?.npwc, 3)}` : fmt(shown?.npwc, 3), muted: transit,
      title: transit ? 'In transition: coverage is expected to be low' : 'Priority-weighted coverage, normalised (observer)',
    },
    { key: 'alive', label: 'Alive', value: both ? `${alive(encore)} / ${alive(baseline)}` : alive(shown), title: `of ${input.n0} launched (observer)` },
  ];
  if (input.phase) items.push({ key: 'phase', label: input.phase.inHold ? 'Hold' : 'Transition', value: input.phase.name, title: 'Preloaded score plan at this tick' });
  items.push({ key: 'fps', label: '', value: input.fps === null ? '— fps' : `${input.fps.toFixed(0)} fps`, muted: true });
  if (input.stopped) items.push({ key: 'stopped', label: 'Stopped', value: 'press R', title: input.stopped });
  return items;
}

export interface Readout { readonly el: HTMLElement; readonly button: HTMLButtonElement; update(input: ReadoutInput): void }

export function createReadout(onOpen: () => void): Readout {
  const button = h('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Open metrics (M)', onclick: onOpen });
  const el = h('div', { class: 'readout surface chrome' }, button);
  return {
    el, button,
    update(input) {
      button.replaceChildren(...readoutItems(input).map(item => h('span', { class: `${item.key === 'npwc' ? 'npwc' : ''} ${item.muted && item.key === 'npwc' ? 'transit' : ''}`, title: item.title, 'data-item': item.key, style: item.key === 'stopped' ? { color: 'var(--danger)' } : undefined },
        item.label ? h('span', { class: 'k' }, item.label) : null,
        h('span', { class: 'v', style: item.muted && item.key === 'fps' ? { color: 'var(--text-3)' } : undefined }, item.value))));
      el.dataset.fps = input.fps === null ? '' : input.fps.toFixed(1);
      el.dataset.aliveEncore = input.samples.encore ? String(input.samples.encore.alive) : '';
      el.dataset.aliveStatic = input.samples.static ? String(input.samples.static.alive) : '';
      if (input.stopped) el.dataset.error = input.stopped; else delete el.dataset.error;
    },
  };
}
