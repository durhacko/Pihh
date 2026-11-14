// src/app/ui/keys.ts
// Global keyboard shortcuts (research/ui-prototype DESIGN.md §2.3). One map, one listener. Typing never
// triggers a shortcut (§2.2), modified keys are left to the browser, and Space on a focused button is left to
// the button (it activates it natively). Escape is handled by the caller (handleEscape in ./surfaces).
// Shared module: no createPanel export, so the panel loader skips it.
import { isTyping } from './dom';

export type ShortcutAction =
  | 'play' | 'step' | 'slower' | 'faster' | 'reset' | 'camera-audience' | 'camera-quarter' | 'camera-top'
  | 'kill-region' | 'jam' | 'partition' | 'xray' | 'belief' | 'ghosts' | 'view' | 'metrics' | 'hide' | 'help'
  | 'compose' | 'inject' | 'timeline' | 'console' | 'demo';

const MAP: Record<string, ShortcutAction> = {
  ' ': 'play', '.': 'step', '[': 'slower', ']': 'faster', r: 'reset',
  '1': 'camera-audience', '2': 'camera-quarter', '3': 'camera-top',
  k: 'kill-region', j: 'jam', p: 'partition', x: 'xray', c: 'belief', g: 'ghosts', b: 'view', m: 'metrics',
  h: 'hide', '?': 'help', f: 'compose', i: 'inject', t: 'timeline', '/': 'console', '`': 'console', d: 'demo',
};

export interface KeyLike { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean }

/** The shortcut for a key press, or null. `typing`: the event comes from a text field. `onButton`: from a button. */
export function shortcutFor(event: KeyLike, typing: boolean, onButton = false): ShortcutAction | null {
  if (typing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
  if (event.key === ' ' && onButton) return null;
  return MAP[event.key.toLowerCase()] ?? MAP[event.key] ?? null;
}

/** Listens on window; returns the unbind function. Escape goes to `onEscape` before the typing check, so it
 *  also closes a surface whose input has focus. */
export function bindShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>, onEscape: () => void): () => void {
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { onEscape(); return; }
    const onButton = event.target instanceof Element && event.target.closest('button') !== null;
    const action = shortcutFor(event, isTyping(event.target), onButton);
    const run = action ? handlers[action] : undefined;
    if (run) { event.preventDefault(); run(); }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
