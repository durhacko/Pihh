// src/app/ui/Legend.ts
// The legend (DESIGN.md §4): appears only while something on the stage needs a key: the radio X-ray (with the
// honest "radio drawn n / m" counter), belief colours (version counts from the observer), deaf rings, and the
// partition. Every count comes from a snapshot, the radio layer's own tally or an observer MetricsSample.
// It replaces the X-ray layers' own floating counter and belief legend, which it hides (one key, not three).
// Shared module: no createPanel export, so the panel loader skips it.
import type { RGB } from '../../contracts';
import { versionColour } from '../render/colourModes/belief';
import { h } from './dom';

export interface LegendInput {
  xray: boolean;
  belief: boolean;
  /** "issuedTick:origin" → live drones believing it (MetricsSample.versions), or null before the first sample. */
  versions: Record<string, number> | null;
  /** The radio layer's own tally for the last second of simulation, or null while it has not drawn. */
  radio: { drawn: number; observed: number } | null;
  deaf: number;
  partitions: number;
  /** Ghost-slot counts from the observer's slot status (Observer.slotStatus), or null while the lens is off. */
  ghosts: { vacant: number; inTransit: number; contested: number; inHold: boolean } | null;
}
export type LegendItem =
  | { kind: 'title'; text: string }
  | { kind: 'line'; text: string; colour: string }
  | { kind: 'ring'; text: string; colour: string; count?: number }
  | { kind: 'honest'; text: string };

const css = (c: RGB): string => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

export function legendItems(input: LegendInput): LegendItem[] {
  const items: LegendItem[] = [];
  if (input.xray) {
    items.push({ kind: 'title', text: 'Radio · real log' },
      { kind: 'line', text: 'Heartbeat (sampled)', colour: 'var(--hb)' },
      { kind: 'line', text: 'Heartbeat carrying a claim', colour: 'var(--claim)' },
      { kind: 'line', text: 'SCORE message', colour: 'var(--score)' },
      { kind: 'line', text: 'Dropped: lost · jammed · split', colour: 'var(--lost)' },
      { kind: 'honest', text: input.radio ? `radio drawn ${input.radio.drawn} / ${input.radio.observed.toLocaleString('en-GB')} logged · last 1 s` : 'radio: nothing logged yet' });
  }
  if (input.belief) {
    items.push({ kind: 'title', text: 'Score version held' });
    const entries = Object.entries(input.versions ?? {});
    if (entries.length === 0) items.push({ kind: 'honest', text: 'Waiting for the first observer sample' });
    for (const [key, count] of entries) {
      const [issuedTick, origin] = key.split(':').map(Number);
      items.push({ kind: 'ring', text: `v${key}${origin === -1 ? ' preloaded' : ''}`, colour: css(versionColour({ issuedTick, origin })), count });
    }
  }
  if (input.ghosts) {
    items.push({ kind: 'title', text: `Slots · observer truth${input.ghosts.inHold ? '' : ' (in transition)'}` },
      { kind: 'ring', text: 'In transit (thin ring)', colour: 'var(--transit)', count: input.ghosts.inTransit },
      { kind: 'ring', text: 'Vacant (thick ring)', colour: 'var(--vacant)', count: input.ghosts.vacant },
      { kind: 'ring', text: 'Contested (double ring)', colour: 'var(--contested)', count: input.ghosts.contested });
  }
  if (input.deaf > 0) items.push({ kind: 'ring', text: 'Deaf: heard no radio for 2 s', colour: '#ffffff', count: input.deaf });
  if (input.partitions > 0 && input.xray) items.push({ kind: 'line', text: 'Partition active (groups fixed at split)', colour: 'var(--partition)' });
  return items;
}

export interface Legend { readonly el: HTMLElement; update(input: LegendInput): void; dispose(): void }

export function createLegend(): Legend {
  const el = h('div', { class: 'legend surface chrome', hidden: true, 'aria-label': 'Legend' });
  // The X-ray layers (#25) and the ghost-slot layer (#102) draw their own fixed counter / legends; this legend
  // carries all of them, next to the key that qualifies them, so those are hidden while the shell is mounted.
  const hideDuplicates = h('style', {}, '[data-radio-counter],[data-belief-legend],[data-ghost-legend]{display:none!important}');
  document.head.append(hideDuplicates);
  return {
    el,
    update(input) {
      const items = legendItems(input);
      el.hidden = items.length === 0;
      el.replaceChildren(...items.map(item => {
        if (item.kind === 'title') return h('div', { class: 'eyebrow' }, item.text);
        if (item.kind === 'honest') return h('div', { class: 'honest' }, item.text);
        if (item.kind === 'line') return h('div', { class: 'li' }, h('span', { class: 'ln', style: { background: item.colour } }), item.text);
        return h('div', { class: 'li' }, h('span', { class: 'rg', style: item.colour === '#ffffff' ? { border: '1.5px solid #fff' } : { background: item.colour } }), item.text,
          item.count === undefined ? null : h('span', { class: 'ct' }, String(item.count)));
      }));
    },
    dispose() { el.remove(); hideDuplicates.remove(); },
  };
}
