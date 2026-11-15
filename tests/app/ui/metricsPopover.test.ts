// tests/app/ui/metricsPopover.test.ts
// #134 P1: the Metrics popover's nPWC note. Each arm is measured against its own reference formation, and an arm in
// transition reads low while it flies there. The note checked only Encore, so after an inject a static arm in
// transition (1.3–31.5 % beside Encore's 100 %) had no qualifier, in split and in Static-only view. Through the real
// createMetrics on a headless DOM (fakeDom as the global document), plus the pure npwcNote rule. The popover shows
// both columns in every view, so both arms are checked in every view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArmHud, HudPresentation } from '../../../src/app/ui/Hud';
import { createMetrics, npwcNote, type PopoverContext } from '../../../src/app/ui/popovers';
import { defaultUIState, Store, type ViewMode } from '../../../src/app/ui/store';
import { FakeDocument, FakeElement } from './fakeDom';

const proto = FakeElement.prototype as unknown as { replaceChildren?: (...nodes: (FakeElement | string)[]) => void };
proto.replaceChildren ??= function (this: FakeElement, ...nodes: (FakeElement | string)[]) { this.textContent = ''; this.append(...nodes); };

afterEach(() => { vi.unstubAllGlobals(); });

const DEFAULT = 'priority-weighted, our slot order';

function arm(name: string, npwc: string, transitioning: boolean | null): ArmHud {
  return {
    label: `${name} · ${name.toLowerCase()}`, tick: '100', alive: '200', npwc, npwcNote: '', transitioning,
    coverage: '—', fidelity: '—', messages: '—', delivered: '—', versions: '—',
    duplicates: '—', collisions: '—', nearMisses: '—', slotChanges: '—',
  };
}
function hud(encore: boolean | null, baseline: boolean | null): HudPresentation {
  return { encore: arm('Encore', '100.0%', encore), static: arm('Static', '1.3%', baseline), fps: '60', quality: '', radio: '', layout: '', status: 'Running' };
}

/** The real popover's nPWC row note, for a HUD and a view. */
function renderedNote(presentation: HudPresentation, view: ViewMode): string {
  vi.stubGlobal('document', new FakeDocument());
  const store = new Store({ ...defaultUIState(), view });
  const ctx = {
    store,
    hud: () => presentation,
    series: () => ({ encore: [], static: [] }),
    meta: () => ({ tick: 100, seed: 1, roster: 200, fps: 60, speed: 1, xray: false, radio: null }),
  } as unknown as PopoverContext;
  const popover = createMetrics(ctx);
  popover.render();
  const el = popover.el as unknown as FakeElement;
  const label = el.findAll('l').find(l => l.textContent.startsWith('nPWC'))!;
  expect(label).toBeDefined();
  return label.findTag('small')[0]?.textContent ?? '';
}

describe('Metrics nPWC note: both arms (#134 P1)', () => {
  it('split view: static in transition is qualified and named, Encore holding', () => {
    expect(renderedNote(hud(false, true), 'split')).toBe('static in transition: read with care');
  });
  it('split view: Encore in transition, static holding', () => {
    expect(renderedNote(hud(true, false), 'split')).toBe('Encore in transition: read with care');
  });
  it('split view: both in transition names both', () => {
    expect(renderedNote(hud(true, true), 'split')).toBe('Encore + static in transition: read with care');
  });
  it('split view: both holding, or no reading yet, keeps the normal note', () => {
    expect(renderedNote(hud(false, false), 'split')).toBe(DEFAULT);
    expect(renderedNote(hud(null, null), 'split')).toBe(DEFAULT);
  });
  // The popover shows both columns in every view, so a single view still qualifies the other arm's column.
  it('Static-only view checks both arms', () => {
    expect(renderedNote(hud(false, true), 'static')).toBe('static in transition: read with care');
    expect(renderedNote(hud(true, false), 'static')).toBe('Encore in transition: read with care');
    expect(renderedNote(hud(false, false), 'static')).toBe(DEFAULT);
  });
  it('Encore-only view checks both arms', () => {
    expect(renderedNote(hud(true, false), 'encore')).toBe('Encore in transition: read with care');
    expect(renderedNote(hud(false, true), 'encore')).toBe('static in transition: read with care');
    expect(renderedNote(hud(false, false), 'encore')).toBe(DEFAULT);
  });
  it('npwcNote tolerates a missing arm', () => {
    expect(npwcNote({ encore: null, static: arm('Static', '1.3%', true) })).toBe('static in transition: read with care');
    expect(npwcNote({ encore: null, static: null })).toBe(DEFAULT);
  });
});
