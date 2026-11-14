// tests/app/ui/surfaces.test.ts
// Surface lifecycle and the DESIGN §2.2 rules, headless: minimal element, document and window stubs.
import { describe, expect, it, vi } from 'vitest';
import { defaultUIState, Store } from '../../../src/app/ui/store';
import { handleEscape, Surfaces, type SurfaceDef, type SurfaceEnv, type SurfaceKind } from '../../../src/app/ui/surfaces';

class FakeEl {
  hidden = false;
  style: Record<string, string> = {};
  offsetWidth = 300;
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  rect = { left: 500, right: 540, top: 700, bottom: 740, width: 40, height: 40 };
  constructor(readonly name: string, private readonly env: FakeEnv) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  contains(node: unknown): boolean { return node === this || this.children.some((c) => c.contains(node)); }
  focus() { this.env.active = this; }
  getBoundingClientRect() { return this.rect; }
  add(child: FakeEl) { this.children.push(child); return child; }
}

class FakeEnv {
  active: FakeEl | null = null;
  attached = new Set<FakeEl>();
  frames: (() => void)[] = [];
  docListeners = new Map<string, ((e: Event) => void)[]>();
  winListeners = new Map<string, (() => void)[]>();
  removed: string[] = [];
  el(name: string) { const e = new FakeEl(name, this); this.attached.add(e); return e; }
  env(): SurfaceEnv {
    const activeElement = () => this.active as unknown as Element;
    const document = {
      contains: (n: Node | null) => [...this.attached].some((e) => e.contains(n)),
      addEventListener: (type: string, fn: (e: Event) => void) => { this.docListeners.set(type, [...(this.docListeners.get(type) ?? []), fn]); },
      removeEventListener: (type: string) => { this.removed.push(`doc:${type}`); this.docListeners.delete(type); },
    };
    Object.defineProperty(document, 'activeElement', { get: activeElement });
    return {
      document: document as unknown as SurfaceEnv['document'],
      window: {
        innerWidth: 1280, innerHeight: 800,
        addEventListener: (type: string, fn: () => void) => { this.winListeners.set(type, [...(this.winListeners.get(type) ?? []), fn]); },
        removeEventListener: (type: string) => { this.removed.push(`win:${type}`); this.winListeners.delete(type); },
      } as unknown as SurfaceEnv['window'],
      nextFrame: (fn) => { this.frames.push(fn); },
    };
  }
  flushFrames() { const f = this.frames; this.frames = []; f.forEach((fn) => fn()); }
  pointerDown(target: FakeEl) { for (const fn of this.docListeners.get('pointerdown') ?? []) fn({ target } as unknown as Event); }
}

function setup() {
  const fake = new FakeEnv();
  const surfaces = new Surfaces(fake.env());
  const els: Record<string, FakeEl> = {};
  const openers: Record<string, FakeEl> = {};
  const def = (id: string, kind: SurfaceKind, extra: Partial<SurfaceDef> = {}) => {
    els[id] = fake.el(id);
    openers[id] = fake.el(`btn-${id}`);
    surfaces.register({ id, kind, el: els[id] as unknown as HTMLElement, anchor: () => openers[id] as unknown as HTMLElement, ...extra });
  };
  const input = fake.el('composer-input');
  def('composer', 'panel', { focusOnOpen: () => input as unknown as HTMLElement });
  def('inspector', 'panel');
  def('timeline', 'tray');
  def('console', 'tray');
  def('lenses', 'popover');
  def('disrupt', 'popover');
  def('metrics', 'popover', { place: 'below-right' });
  els.composer?.add(input);
  /** Click an opener button: it takes focus, then opens the surface (as a dock button does). */
  const openFrom = (id: string) => { openers[id]?.focus(); surfaces.open(id); };
  return { fake, surfaces, els, openers, input, openFrom };
}

describe('Surfaces lifecycle', () => {
  it('registers surfaces hidden; popovers are non-modal dialogs', () => {
    const { els } = setup();
    expect(els.lenses?.hidden).toBe(true);
    expect(els.lenses?.getAttribute('role')).toBe('dialog');
    expect(els.lenses?.getAttribute('aria-modal')).toBe('false');
    expect(els.composer?.getAttribute('role')).toBeNull();
  });

  it('keeps at most one popover open; panels and trays stay open beside it', () => {
    const { surfaces, els } = setup();
    surfaces.open('composer');
    surfaces.open('timeline');
    surfaces.open('console');
    surfaces.open('lenses');
    surfaces.open('disrupt');
    expect(surfaces.openIds()).toEqual(['composer', 'timeline', 'console', 'disrupt']);
    expect(els.lenses?.hidden).toBe(true);
    expect(els.disrupt?.hidden).toBe(false);
    surfaces.open('metrics');
    expect(surfaces.openIds()).toEqual(['composer', 'timeline', 'console', 'metrics']);
  });

  it('reopening moves a surface to the top of the Escape stack; toggle closes it', () => {
    const { surfaces } = setup();
    surfaces.open('composer');
    surfaces.open('inspector');
    surfaces.open('composer');
    expect(surfaces.openIds()).toEqual(['inspector', 'composer']);
    surfaces.toggle('composer');
    expect(surfaces.openIds()).toEqual(['inspector']);
  });

  it('notifies onChange with the open ids and calls onOpen / onClose', () => {
    const fake = new FakeEnv();
    const surfaces = new Surfaces(fake.env());
    const onOpen = vi.fn();
    const onClose = vi.fn();
    surfaces.register({ id: 'help', kind: 'popover', el: fake.el('help') as unknown as HTMLElement, onOpen, onClose });
    const seen: string[][] = [];
    const off = surfaces.onChange((ids) => seen.push(ids));
    surfaces.open('help');
    surfaces.close('help');
    off();
    surfaces.open('help');
    expect(seen).toEqual([['help'], []]);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown and duplicate surfaces', () => {
    const { surfaces, fake } = setup();
    expect(() => surfaces.open('nope')).toThrow(/Unknown surface/);
    expect(() => surfaces.register({ id: 'lenses', kind: 'popover', el: fake.el('x') as unknown as HTMLElement })).toThrow(/already registered/);
  });
});

describe('Escape and focus', () => {
  it('Escape closes the most recently opened surface first', () => {
    const { surfaces } = setup();
    surfaces.open('composer');
    surfaces.open('console');
    surfaces.open('lenses');
    expect(surfaces.escape()).toBe(true);
    expect(surfaces.openIds()).toEqual(['composer', 'console']);
    surfaces.escape();
    surfaces.escape();
    expect(surfaces.escape()).toBe(false);
  });

  it('moves focus into a surface with an input after layout, and returns it to the opener on close', () => {
    const { surfaces, fake, openers, input, openFrom } = setup();
    openFrom('composer');
    expect(fake.active).toBe(openers.composer);   // not yet: focus moves on the next frame
    fake.flushFrames();
    expect(fake.active).toBe(input);
    surfaces.escape();
    expect(fake.active).toBe(openers.composer);
  });

  it('does not steal focus if the surface closed before the frame ran', () => {
    const { surfaces, fake, openers, openFrom } = setup();
    openFrom('composer');
    surfaces.close('composer');
    fake.flushFrames();
    expect(fake.active).toBe(openers.composer);
  });

  it('does not return focus to an opener that has left the document', () => {
    const { surfaces, fake, openers, openFrom } = setup();
    openFrom('inspector');
    fake.attached.delete(openers.inspector as FakeEl);
    fake.active = null;
    surfaces.escape();
    expect(fake.active).toBeNull();
  });
});

describe('Light dismiss', () => {
  it('an outside pointerdown closes the open popover without pulling focus back; panels stay', () => {
    const { surfaces, fake, openers, openFrom } = setup();
    surfaces.open('composer');
    openFrom('lenses');
    const canvas = fake.el('canvas');
    canvas.focus();
    fake.pointerDown(canvas);
    expect(surfaces.openIds()).toEqual(['composer']);
    expect(fake.active).toBe(canvas);
    expect(fake.active).not.toBe(openers.lenses);
  });

  it('a pointerdown inside the popover or on its anchor does not close it', () => {
    const { surfaces, fake, els, openers } = setup();
    surfaces.open('lenses');
    const toggle = els.lenses?.add(fake.el('switch')) as FakeEl;
    fake.pointerDown(toggle);
    fake.pointerDown(openers.lenses as FakeEl);
    expect(surfaces.isOpen('lenses')).toBe(true);
  });

  it('listens in the capture phase and removes its listeners on dispose', () => {
    const fake = new FakeEnv();
    const env = fake.env();
    const add = vi.spyOn(env.document, 'addEventListener');
    const surfaces = new Surfaces(env);
    expect(add).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    surfaces.dispose();
    expect(fake.removed).toEqual(['doc:pointerdown', 'win:resize']);
  });
});

describe('Popover placement', () => {
  it('centres above the anchor, or sits below-right of it', () => {
    const { surfaces, els } = setup();
    surfaces.open('lenses');
    expect(els.lenses?.style).toMatchObject({ left: '370px', bottom: '110px', top: 'auto', right: 'auto' });   // 500 + 20 - 150; 800 - 700 + 10
    surfaces.open('metrics');
    expect(els.metrics?.style).toMatchObject({ top: '748px', right: '740px', left: 'auto', bottom: 'auto' });   // 740 + 8; 1280 - 540
  });
});

describe('handleEscape order (DESIGN §2.2)', () => {
  it('cancel pick → show controls → close most recent → clear preview → deselect, one step per press', () => {
    const { surfaces } = setup();
    const store = new Store(defaultUIState());
    const resolve = vi.fn();
    store.set({
      pick: { purpose: 'inject', prompt: 'Pick a drone', resolve }, pickPoint: [1, 2, 3],
      chromeHidden: true, preview: { recipe: { kind: 'sphere' }, label: 'Sphere' },
      selected: { id: 4, arm: 'encore' },
    });
    surfaces.open('composer');
    surfaces.open('lenses');

    const steps = [];
    for (let i = 0; i < 7; i++) steps.push(handleEscape(store, surfaces));
    expect(steps).toEqual(['cancelPick', 'showChrome', 'closeSurface', 'closeSurface', 'clearPreview', 'deselect', null]);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(null);
    expect(store.state).toMatchObject({ pick: null, pickPoint: null, chromeHidden: false, preview: null, selected: null });
    expect(surfaces.openIds()).toEqual([]);
  });

  it('the pick is cleared before its resolver runs, so a resolver may start a new pick', () => {
    const { surfaces } = setup();
    const store = new Store();
    store.set({ pick: { purpose: 'select', prompt: 'a', resolve: () => store.set({ pick: { purpose: 'jam', prompt: 'b', resolve: () => {} } }) } });
    expect(handleEscape(store, surfaces)).toBe('cancelPick');
    expect(store.state.pick?.prompt).toBe('b');
  });

  it('uses the app-supplied deselect (e.g. to close the inspector too)', () => {
    const { surfaces } = setup();
    const store = new Store();
    store.set({ selected: { id: 1, arm: 'static' } });
    const deselect = vi.fn(() => store.set({ selected: null }));
    expect(handleEscape(store, surfaces, deselect)).toBe('deselect');
    expect(deselect).toHaveBeenCalledOnce();
  });
});
