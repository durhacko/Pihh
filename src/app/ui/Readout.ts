// src/app/ui/Readout.ts
// The one-line readout at the top right (DESIGN.md §1, §4): nPWC (both arms when both are shown), alive, the
// score phase and fps. Numbers come only from observer MetricsSamples; a missing sample shows "—", never 0.
// The phase is PER ARM and comes from one observer reading per arm (src/app/armPhase.ts): hold or transition, and the
// movement the observer measures that arm against. After an injection the Encore arm can be flying a new formation
// while the static arm holds the old one; each is labelled for what it is. While an arm is in transition its nPWC is
// greyed and labelled "in transition · measured against the new formation" (DESIGN §7): the number is never hidden or
// replaced. Clicking opens Metrics. Shared module: no createPanel export, so the panel loader skips it.
import type { MetricsSample } from '../../contracts';
import type { ArmPhase } from '../armPhase';
import type { Pair } from '../worlds';
import { fmt, h } from './dom';
import type { ViewMode } from './store';
import { LOWEST_QUALITY, QUALITY_LADDER, sharedQuality } from '../render/quality';

export type { ArmPhase } from '../armPhase';

export interface ReadoutInput {
  samples: Pair<MetricsSample | null>;
  view: ViewMode;
  n0: number;
  /** Per arm, from the observer (armPhase). Takes precedence over `phase`. */
  phases?: Pair<ArmPhase | null>;
  /** One phase for both arms (older callers): hold or transition, and the movement's name. */
  phase?: ArmPhase | null;
  fps: number | null;
  /** Set while the loop is stopped by an error. */
  stopped: string | null;
  /** Render quality ladder (render/quality.ts). Shown only below full quality: nothing changes at level 0. */
  quality?: { level: number; lowest: number; name: string; description: string };
}
export interface ReadoutPart { value: string; muted: boolean }
export interface ReadoutItem {
  key: 'npwc' | 'transition' | 'comparable' | 'alive' | 'phase' | 'fps' | 'quality' | 'stopped'; label: string; value: string; muted?: boolean; title?: string;
  /** For a split headline: each arm's number, greyed on its own when that arm is in transition. */
  parts?: ReadoutPart[];
}

// Short on screen so the readout stays one line at 1280 px; the full wording is in each item's title (tooltip).
export const TRANSITION_LABEL = 'in transition';
export const TRANSITION_VALUE = 'new formation';
export const TRANSITION_TITLE = 'In transition: measured against the new formation, which the arm is still flying to; it dips until the drones arrive';
export const NOT_COMPARABLE_LABEL = 'not comparable';
export const NOT_COMPARABLE_VALUE = 'different formations';

const alive = (s: MetricsSample | null): string => (s ? String(s.alive) : '—');

export function readoutItems(input: ReadoutInput): ReadoutItem[] {
  const { encore, static: baseline } = input.samples;
  const both = input.view === 'split';
  const shownArm = input.view === 'static' ? 'static' : 'encore';
  const shown = input.samples[shownArm];
  const phases: Pair<ArmPhase | null> = input.phases ?? { encore: input.phase ?? null, static: input.phase ?? null };
  const transit = (arm: 'encore' | 'static') => phases[arm] !== null && !phases[arm]!.inHold;
  const arms = both ? (['encore', 'static'] as const) : ([shownArm] as const);
  const moving = arms.filter(transit);
  const items: ReadoutItem[] = [
    {
      key: 'npwc', label: both ? 'nPWC E / S' : input.view === 'static' ? 'nPWC static' : 'nPWC',
      value: both ? `${fmt(encore?.npwc, 3)} / ${fmt(baseline?.npwc, 3)}` : fmt(shown?.npwc, 3), muted: moving.length > 0,
      parts: both ? [{ value: fmt(encore?.npwc, 3), muted: transit('encore') }, { value: fmt(baseline?.npwc, 3), muted: transit('static') }] : undefined,
      title: moving.length ? `In transition (${moving.join(', ')}): measured against the new formation, which the arm is still flying to` : 'Priority-weighted coverage, normalised (observer)',
    },
  ];
  // Each arm is scored against its OWN reference formation. After an injection the Encore arm can be scored on the
  // new one and the static arm on the old: the pair is then two different measurements, and says so.
  const differ = both && phases.encore !== null && phases.static !== null && phases.encore.name !== phases.static.name;
  if (differ) {
    items.push({
      key: 'comparable', label: NOT_COMPARABLE_LABEL, muted: true, value: NOT_COMPARABLE_VALUE,
      title: `Not comparable: Encore is measured against ${phases.encore!.name}, static against ${phases.static!.name}. Each arm is measured against the formation its own drones fly, so the two nPWC values do not compare`,
    });
  }
  if (moving.length) {
    items.push({
      key: 'transition', label: TRANSITION_LABEL, muted: true,
      value: both ? `${moving.map(arm => (arm === 'encore' ? 'E' : 'S')).join(' + ')} · ${TRANSITION_VALUE}` : TRANSITION_VALUE,
      title: TRANSITION_TITLE,
    });
  }
  items.push({ key: 'alive', label: 'Alive', value: both ? `${alive(encore)} / ${alive(baseline)}` : alive(shown), title: `of ${input.n0} launched (observer)` });
  const phaseLabel = (p: ArmPhase) => `${p.inHold ? 'Hold' : 'Transition'} · ${p.name}`;
  const e = phases.encore, s = phases.static;
  if (both && e && s && (e.inHold !== s.inHold || e.name !== s.name)) {
    // Compact (the readout must stay one line): "E Transition “HI” / S Hold “ENCORE”"; the key label is in the title.
    const compact = (p: ArmPhase) => `${p.inHold ? 'Hold' : 'Transition'} ${p.name}`;
    items.push({ key: 'phase', label: '', value: `E ${compact(e)} / S ${compact(s)}`, title: `Phase, per arm (observer reference formation): Encore ${phaseLabel(e)}; static ${phaseLabel(s)}` });
  } else {
    const p = both ? e ?? s : phases[shownArm];
    if (p) items.push({ key: 'phase', label: p.inHold ? 'Hold' : 'Transition', value: p.name, title: 'Reference formation (observer)' });
  }
  items.push({ key: 'fps', label: '', value: input.fps === null ? '— fps' : `${input.fps.toFixed(0)} fps`, muted: true });
  if (input.quality && input.quality.level > 0) {
    items.push({ key: 'quality', label: `Q${input.quality.level}/${input.quality.lowest}`, value: input.quality.name, muted: true, title: input.quality.description });
  }
  if (input.stopped) items.push({ key: 'stopped', label: 'Stopped', value: 'press R', title: input.stopped });
  return items;
}

export interface Readout { readonly el: HTMLElement; readonly button: HTMLButtonElement; update(input: ReadoutInput): void }

const MUTED = { color: 'var(--text-3)' };

export function createReadout(onOpen: () => void): Readout {
  const button = h('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Open metrics (M)', onclick: onOpen });
  const el = h('div', { class: 'readout surface chrome' }, button);
  return {
    el, button,
    update(given) {
      // The quality item comes from the shared ladder controller unless the caller passes one (tests).
      const q = sharedQuality();
      const input: ReadoutInput = given.quality ? given : { ...given, quality: { level: q.level, lowest: LOWEST_QUALITY, name: QUALITY_LADDER[q.level], description: q.describe() } };
      el.dataset.quality = String(input.quality?.level ?? 0);
      button.replaceChildren(...readoutItems(input).map(item => {
        // A split headline greys each arm's number on its own; a single one greys as a whole (.transit).
        const value = item.parts
          ? h('span', { class: 'v' }, ...item.parts.flatMap((part, i) => [i ? ' / ' : '', h('span', { style: part.muted ? MUTED : undefined }, part.value)]))
          : h('span', { class: 'v', style: item.muted && (item.key === 'fps' || item.key === 'transition' || item.key === 'comparable') ? MUTED : undefined }, item.value);
        return h('span', { class: `${item.key === 'npwc' ? 'npwc' : ''} ${item.muted && item.key === 'npwc' && !item.parts ? 'transit' : ''}`, title: item.title, 'data-item': item.key, style: item.key === 'stopped' ? { color: 'var(--danger)' } : undefined },
          item.label ? h('span', { class: 'k' }, item.label) : null, value);
      }));
      el.dataset.fps = input.fps === null ? '' : input.fps.toFixed(1);
      el.dataset.aliveEncore = input.samples.encore ? String(input.samples.encore.alive) : '';
      el.dataset.aliveStatic = input.samples.static ? String(input.samples.static.alive) : '';
      if (input.stopped) el.dataset.error = input.stopped; else delete el.dataset.error;
    },
  };
}
