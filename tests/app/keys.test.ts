// tests/app/keys.test.ts
// Global shortcuts (#92): one map; typing never fires a shortcut; modified keys and key repeat are left to the
// browser. Space is always play / pause except in a text field or on a switch (#134). Pure: no DOM needed; the
// window wiring runs against a stubbed window.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts, focusOf, shortcutFor, spaceIsPlayPause, type FocusLike, type ShortcutAction } from '../../src/app/ui/keys';

describe('shortcutFor', () => {
  it('maps the DESIGN §2.3 keys, case-insensitively', () => {
    const cases: [string, string][] = [[' ', 'play'], ['.', 'step'], ['[', 'slower'], [']', 'faster'], ['r', 'reset'], ['R', 'reset'],
      ['1', 'camera-audience'], ['2', 'camera-quarter'], ['3', 'camera-top'], ['k', 'kill-region'], ['j', 'jam'], ['p', 'partition'],
      ['x', 'xray'], ['c', 'belief'], ['b', 'view'], ['m', 'metrics'], ['h', 'hide'], ['?', 'help'], ['f', 'compose'], ['/', 'console']];
    for (const [key, action] of cases) expect(shortcutFor({ key }, false), key).toBe(action);
    expect(shortcutFor({ key: 'q' }, false)).toBeNull();
  });

  it('never fires while typing in a field', () => {
    for (const key of [' ', 'r', 'k', 'j', 'x', 'h', '?', '1', '.']) expect(shortcutFor({ key }, true), key).toBeNull();
  });

  it('leaves modified keys and auto-repeat to the browser', () => {
    expect(shortcutFor({ key: 'r', ctrlKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'r', metaKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'k', altKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'k', repeat: true }, false)).toBeNull();
  });

  it('Space kept by a control (a text field or switch) is not play; every other key still works there', () => {
    expect(shortcutFor({ key: ' ' }, false, true)).toBeNull();
    expect(shortcutFor({ key: ' ' }, false, false)).toBe('play');
    for (const key of ['k', 'j', 'p', 'x', 'c', 'r', ']', '[', 'm', 'h']) expect(shortcutFor({ key }, false, true), key).not.toBeNull();
  });
});

describe('spaceIsPlayPause (#134)', () => {
  const plays: FocusLike[] = [
    { tagName: 'BUTTON', type: 'button' },                           // Show, Reset, Step, any dock button
    { tagName: 'BUTTON', type: 'button', role: 'radio' },            // the Encore / Split / Static segment
    { tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'radio' }, { tagName: 'INPUT', type: 'button' },
    { tagName: 'DIV' }, { tagName: 'BODY' }, { tagName: 'CANVAS' },
  ];
  const kept: FocusLike[] = [
    { tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'INPUT', type: 'number' },
    { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', editable: true },
    { tagName: 'INPUT', type: 'checkbox', role: 'switch' },          // the popover switches
    { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'BUTTON', role: 'switch' }, { tagName: 'DIV', role: 'checkbox' },
  ];
  it('is play / pause on buttons, radio segments, sliders and nothing focused', () => {
    expect(spaceIsPlayPause(null)).toBe(true);
    for (const f of plays) expect(spaceIsPlayPause(f), JSON.stringify(f)).toBe(true);
  });
  it('leaves Space to text fields and switches', () => {
    for (const f of kept) expect(spaceIsPlayPause(f), JSON.stringify(f)).toBe(false);
  });
  it('focusOf reads an element and gives null for window / document', () => {
    expect(focusOf(null)).toBeNull();
    expect(focusOf({} as EventTarget)).toBeNull();
    const sw = { tagName: 'INPUT', type: 'checkbox', getAttribute: (k: string) => (k === 'role' ? 'switch' : null) } as unknown as EventTarget;
    expect(focusOf(sw)).toEqual({ tagName: 'INPUT', type: 'checkbox', role: 'switch', editable: false, byKeyboard: false });
  });
});

describe('bindShortcuts: Space on a just-clicked button (#134)', () => {
  type Fn = (e: KeyboardEvent) => void;
  const listeners = new Map<string, Set<Fn>>();
  afterEach(() => { listeners.clear(); vi.unstubAllGlobals(); });
  function stubWindow() {
    vi.stubGlobal('window', {
      addEventListener: (t: string, f: Fn) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f); },
      removeEventListener: (t: string, f: Fn) => { listeners.get(t)?.delete(f); },
    });
  }
  const el = (tagName: string, type: string, role: string | null = null) =>
    ({ tagName, type, getAttribute: (k: string) => (k === 'role' ? role : null) }) as unknown as EventTarget;
  /** Dispatches to the window listeners; returns whether the default action was prevented. */
  function fire(type: 'keydown' | 'keyup', target: EventTarget, init: Partial<KeyboardEvent> = {}): boolean {
    let prevented = false;
    const event = { type, key: ' ', target, repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => { prevented = true; }, ...init } as unknown as KeyboardEvent;
    for (const f of listeners.get(type) ?? []) f(event);
    return prevented;
  }

  it('plays once and stops the button activating (keydown, auto-repeat and keyup all prevented)', () => {
    stubWindow();
    let plays = 0, demo = 0;
    const unbind = bindShortcuts({ play: () => plays++, demo: () => demo++ }, () => {});
    const show = el('BUTTON', 'button');
    expect(fire('keydown', show)).toBe(true);
    expect(fire('keydown', show, { repeat: true })).toBe(true);
    expect(fire('keyup', show)).toBe(true);
    expect(plays).toBe(1);
    expect(demo).toBe(0);
    unbind();
    expect([...listeners.values()].reduce((n, set) => n + set.size, 0)).toBe(0);   // every listener, focus tracking included
  });

  it('leaves Space to switches and text fields, and leaves Enter and Ctrl+Space alone', () => {
    stubWindow();
    let plays = 0;
    bindShortcuts({ play: () => plays++ }, () => {});
    for (const kept of [el('INPUT', 'checkbox', 'switch'), el('INPUT', 'text'), el('TEXTAREA', 'textarea')]) {
      expect(fire('keydown', kept)).toBe(false);
      expect(fire('keyup', kept)).toBe(false);
    }
    const reset = el('BUTTON', 'button');
    expect(fire('keydown', reset, { key: 'Enter' })).toBe(false);
    expect(fire('keyup', reset, { key: 'Enter' })).toBe(false);
    expect(fire('keydown', reset, { ctrlKey: true })).toBe(false);
    expect(plays).toBe(0);
  });
});

describe('Space for keyboard users (#139)', () => {
  it('a control reached by keyboard keeps Space; the same control focused by mouse plays / pauses', () => {
    for (const f of [{ tagName: 'BUTTON', type: 'button' }, { tagName: 'BUTTON', type: 'button', role: 'radio' }, { tagName: 'INPUT', type: 'radio' }, { tagName: 'A' }, { tagName: 'DIV', role: 'button' }] as FocusLike[]) {
      expect(spaceIsPlayPause({ ...f, byKeyboard: true }), JSON.stringify(f)).toBe(false);
      expect(spaceIsPlayPause({ ...f, byKeyboard: false }), JSON.stringify(f)).toBe(true);
    }
    // Space activates nothing on a slider or a plain region, so it stays play / pause even when reached by keyboard.
    for (const f of [{ tagName: 'INPUT', type: 'range' }, { tagName: 'DIV' }, { tagName: 'CANVAS' }] as FocusLike[]) expect(spaceIsPlayPause({ ...f, byKeyboard: true }), JSON.stringify(f)).toBe(true);
    // Text fields and switches keep Space either way, as before.
    expect(spaceIsPlayPause({ tagName: 'INPUT', type: 'checkbox', role: 'switch', byKeyboard: false })).toBe(false);
    expect(spaceIsPlayPause({ tagName: 'INPUT', type: 'text', byKeyboard: false })).toBe(false);
  });

  /**
   * A page in the shell's shape, driven through bindShortcuts with real event sequences. It models Chrome's
   * :focus-visible (what the old approach read): a focus that follows a keypress, and any element a key goes down on,
   * match it; a pointer press resets that. M opens Metrics and / the console field (each moves focus there), and Escape
   * returns focus to the control that opened them, as Surfaces.close does.
   */
  function page() {
    type Fn = (e: Event) => void;
    const listeners = new Map<string, { fn: Fn; capture: boolean }[]>();
    vi.stubGlobal('window', {
      addEventListener: (t: string, fn: Fn, capture = false) => { (listeners.get(t) ?? listeners.set(t, []).get(t)!).push({ fn, capture: !!capture }); },
      removeEventListener: (t: string, fn: Fn, capture = false) => { listeners.set(t, (listeners.get(t) ?? []).filter(l => l.fn !== fn || l.capture !== !!capture)); },
    });
    type El = EventTarget & { tagName: string; type: string; fv: boolean; group: El | null; getAttribute(k: string): string | null; matches(s: string): boolean; closest(s: string): El | null };
    const el = (tagName: string, type = 'button', role: string | null = null, group: El | null = null): El => {
      const node = { tagName, type, fv: false, group, getAttribute: (k: string) => (k === 'role' ? role : null), matches: (s: string) => s === ':focus-visible' && node.fv, closest: (s: string) => (s === '[role=radiogroup]' ? node.group : null) } as unknown as El;
      return node;
    };
    const body = el('BODY', ''), show = el('BUTTON'), reset = el('BUTTON'), metrics = el('DIV', ''), field = el('INPUT', 'text');
    const radiogroup = el('DIV', '', 'radiogroup');
    const encore = el('BUTTON', 'button', 'radio', radiogroup), split = el('BUTTON', 'button', 'radio', radiogroup);
    let active: El = body;
    let lastInput: 'key' | 'mouse' = 'mouse';
    let returnFocus: El | null = null;
    let prevented = false;
    const dispatch = (type: string, target: El, key = '') => {
      const event = { type, key, target, repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => { prevented = true; } } as unknown as Event;
      const all = listeners.get(type) ?? [];
      for (const l of [...all.filter(x => x.capture), ...all.filter(x => !x.capture)]) l.fn(event);
    };
    const focus = (target: El) => { active.fv = false; active = target; target.fv = lastInput === 'key'; dispatch('focusin', target); };
    const plays: ShortcutAction[] = [];
    const record = (action: ShortcutAction) => () => { plays.push(action); };
    const unbind = bindShortcuts({
      play: record('play'),
      metrics: () => { returnFocus = active; focus(metrics); },
      console: () => { returnFocus = active; focus(field); },
    }, () => { if (returnFocus) { const back = returnFocus; returnFocus = null; focus(back); } });
    /** A pointer click: press (capture listeners see it first), then focus moves if the target is not focused yet. */
    const click = (target: El) => { lastInput = 'mouse'; dispatch('pointerdown', target); if (active !== target) focus(target); };
    /** One key press on the focused element. Returns whether its default action (a button's Space activation) was prevented. */
    const press = (key: string, moveTo?: El) => {
      prevented = false;
      lastInput = 'key';
      active.fv = true;                     // Chrome: any key on the focused element makes it :focus-visible
      dispatch('keydown', active, key);
      if (moveTo) focus(moveTo);            // Tab / arrows: the browser moves focus after keydown
      dispatch('keyup', active, key);
      return prevented;
    };
    return { show, reset, body, encore, split, plays, click, press, unbind, active: () => active };
  }
  afterEach(() => { vi.unstubAllGlobals(); });

  it('(a) click Show, M, Escape, Space: play / pause, Show is not activated', () => {
    const p = page();
    p.click(p.show);
    p.press('m');                            // Metrics opens; Show is its return focus
    p.press('Escape');                       // focus returns to Show programmatically, after a keypress
    expect(p.active()).toBe(p.show);
    expect(p.press(' ')).toBe(true);         // prevented: the button does not activate (the demo is not stopped)
    expect(p.plays).toEqual(['play']);
  });

  it('(b) Tab to Show, Space: Show activates (nothing prevented, no play)', () => {
    const p = page();
    p.press('Tab', p.show);
    expect(p.press(' ')).toBe(false);
    expect(p.plays).toEqual([]);
  });

  it('(c) Tab to Show, then click it (no focusin), Space: play / pause', () => {
    const p = page();
    p.press('Tab', p.show);
    p.click(p.show);                         // already focused: no focusin, but the pointer press still counts
    expect(p.press(' ')).toBe(true);
    expect(p.plays).toEqual(['play']);
  });

  it('(d) click Reset, /, Escape, Space: play / pause, no second reset', () => {
    const p = page();
    p.click(p.reset);
    p.press('/');                            // the console field takes focus; Reset is its return focus
    p.press('Escape');
    expect(p.active()).toBe(p.reset);
    expect(p.press(' ')).toBe(true);
    expect(p.plays).toEqual(['play']);
  });

  it('a keyboard user keeps Space through M / Escape, and arrows in the Encore / Split / Static group count as keyboard', () => {
    const p = page();
    p.press('Tab', p.show);
    p.press('m');
    p.press('Escape');
    expect(p.press(' ')).toBe(false);        // still the keyboard user's Space: Show activates
    p.click(p.encore);
    expect(p.press(' ')).toBe(true);         // clicked segment: play / pause
    p.press('ArrowRight', p.split);          // roving focus inside the radio group
    expect(p.press(' ')).toBe(false);        // reached by keyboard: Space selects it
    expect(p.plays).toEqual(['play']);
  });

  it('an arrow key outside a radio group does not count as keyboard navigation', () => {
    const p = page();
    p.click(p.show);
    p.press('ArrowDown');
    p.press('m');
    p.press('Escape');
    expect(p.press(' ')).toBe(true);
  });

  it('unbind removes every listener, focus tracking included', () => {
    const p = page();
    p.unbind();
    p.click(p.show);
    expect(p.press(' ')).toBe(false);        // nothing bound any more: no preventDefault, no play
    expect(p.plays).toEqual([]);
  });
});
