// tests/app/keys.test.ts
// Global shortcuts (#92): one map; typing never fires a shortcut; modified keys and key repeat are left to the
// browser. Space is always play / pause except in a text field or on a switch (#134). Pure: no DOM needed; the
// window wiring runs against a stubbed window.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts, focusOf, shortcutFor, spaceIsPlayPause, type FocusLike } from '../../src/app/ui/keys';

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
    expect(focusOf(sw)).toEqual({ tagName: 'INPUT', type: 'checkbox', role: 'switch', editable: false });
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
    expect((listeners.get('keydown')?.size ?? 0) + (listeners.get('keyup')?.size ?? 0)).toBe(0);
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
