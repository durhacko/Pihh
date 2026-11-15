// tests/app/ui/store.test.ts
import { describe, expect, it, vi } from 'vitest';
import { defaultUIState, hexToRgb, rgbToHex, Store, VERSION_HUES, VersionPalette } from '../../../src/app/ui/store';

describe('Store change events', () => {
  it('notifies with exactly the keys whose value changed', () => {
    const store = new Store();
    const calls: string[][] = [];
    store.subscribe((_, changed) => calls.push([...changed]));
    store.set({ view: 'split', chromeHidden: false, quality: 'low' });   // chromeHidden is already false
    expect(calls).toEqual([['view', 'quality']]);
    expect(store.state.view).toBe('split');
    expect(store.get('quality')).toBe('low');
  });

  it('does not notify when nothing changes', () => {
    const store = new Store();
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ view: 'encore', selected: null });
    store.set({});
    store.lens('zones', true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('replaces state instead of mutating it, and passes the new state to listeners', () => {
    const store = new Store();
    const before = store.state;
    let seen: unknown = null;
    store.subscribe((s) => { seen = s; });
    store.set({ selected: { id: 7, arm: 'encore' } });
    expect(before.selected).toBeNull();
    expect(seen).toBe(store.state);
    expect(store.state.selected).toEqual({ id: 7, arm: 'encore' });
  });

  it('lens() changes one lens and reports "lenses"', () => {
    const store = new Store();
    const before = store.state.lenses;
    const calls: string[][] = [];
    store.subscribe((_, changed) => calls.push([...changed]));
    store.lens('xray', true);
    expect(calls).toEqual([['lenses']]);
    expect(store.state.lenses).toEqual({ ...before, xray: true });
    expect(before.xray).toBe(false);
  });

  it('unsubscribe stops events, also from inside a listener', () => {
    const store = new Store();
    const a = vi.fn();
    const offA = store.subscribe(a);
    const offB = store.subscribe(() => offB());
    const c = vi.fn();
    store.subscribe(c);
    store.set({ view: 'static' });
    offA();
    store.set({ view: 'split' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(2);
  });

  it('starts from the prototype defaults; the caller supplies quality and reduced motion', () => {
    expect(defaultUIState()).toEqual({
      lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true },
      view: 'encore', selected: null, hovered: null, pick: null, pickPoint: null, preview: null,
      quality: 'auto', reducedMotion: false, chromeHidden: false, camera: null,
      killRadius: 6, jamRadius: 12,
    });
    expect(defaultUIState({ quality: 'low', reducedMotion: true })).toMatchObject({ quality: 'low', reducedMotion: true });
    expect(new Store().state).toEqual(defaultUIState());
  });
});

describe('VersionPalette', () => {
  it('assigns Okabe–Ito hues in order of first appearance and keeps them stable', () => {
    const p = new VersionPalette();
    expect(p.colour('0:-1')).toBe(VERSION_HUES[0]);
    expect(p.colour('400:7')).toBe(VERSION_HUES[1]);
    expect(p.colour('0:-1')).toBe(VERSION_HUES[0]);
    expect(p.index('400:7')).toBe(1);
    p.reset();
    expect(p.colour('400:7')).toBe(VERSION_HUES[0]);
  });

  it('never uses vermilion (reserved for vacancy and jams)', () => {
    expect(VERSION_HUES.map((c) => c.toLowerCase())).not.toContain('#ff5a1f');
  });
});

describe('colour conversion', () => {
  it('round-trips hex and RGB', () => {
    expect(hexToRgb('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbToHex([1, 128 / 255, 0])).toBe('#FF8000');
    expect(rgbToHex([2, -1, 0.5])).toBe('#FF0080');
    expect(() => hexToRgb('#F80')).toThrow(/#RRGGBB/);
  });
});
