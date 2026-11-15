// src/app/ui/keys.ts
// Global keyboard shortcuts (research/ui-prototype DESIGN.md §2.3). One map, one listener. Typing never
// triggers a shortcut (§2.2) and modified keys are left to the browser. Space is always play / pause (#134),
// except in a text field or on a switch: on a focused button it never activates the button as well.
// Escape is handled by the caller (handleEscape in ./surfaces).
// Shared module: no createPanel export, so the panel loader skips it.
import { isTyping, NON_TEXT_INPUT_TYPES } from './dom';

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

/** The shortcut for a key press, or null. `typing`: the event comes from a text field. `spaceKept`: the focused
 *  control keeps Space for itself (see spaceIsPlayPause), so Space is not play / pause there. */
export function shortcutFor(event: KeyLike, typing: boolean, spaceKept = false): ShortcutAction | null {
  if (typing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return null;
  if (event.key === ' ' && spaceKept) return null;
  return MAP[event.key.toLowerCase()] ?? MAP[event.key] ?? null;
}

/** What Space needs to know about the focused element. Plain data, so it is testable without a DOM. */
export interface FocusLike { tagName: string; type?: string; role?: string | null; editable?: boolean }

/** Input types that do not take text: the same list isTyping uses (dom.ts). A checkbox is handled as a switch. */
const NOT_TEXT_INPUTS: ReadonlySet<string> = new Set(NON_TEXT_INPUT_TYPES);
/** Roles that Space flips (a checkbox-like toggle). A role=radio segment and an aria-pressed button are not among them. */
const SWITCH_ROLES = new Set(['switch', 'checkbox', 'menuitemcheckbox']);

/** True if Space is play / pause with this element focused (#134). It is not only where Space types (a text
 *  input, textarea, select or editable region) or flips a switch (a checkbox, role=switch / checkbox). On a
 *  button, a radio segment, a slider or nothing focused it is play / pause. `null` means no element. */
export function spaceIsPlayPause(focus: FocusLike | null): boolean {
  if (!focus) return true;
  const tag = focus.tagName.toLowerCase();
  if (focus.editable || tag === 'textarea' || tag === 'select') return false;
  if (tag === 'input') {
    const type = (focus.type || 'text').toLowerCase();
    if (type === 'checkbox' || !NOT_TEXT_INPUTS.has(type)) return false;
  }
  return !SWITCH_ROLES.has((focus.role ?? '').toLowerCase());
}

/** The DOM side of spaceIsPlayPause: describes a key event's target, or null for window / document. Duck-typed
 *  (no instanceof Element) so the wiring also runs in the node test environment. */
export function focusOf(target: EventTarget | null): FocusLike | null {
  const el = target as Partial<HTMLInputElement> | null;
  if (!el || typeof el.tagName !== 'string' || typeof el.getAttribute !== 'function') return null;
  return { tagName: el.tagName, type: typeof el.type === 'string' ? el.type : undefined, role: el.getAttribute('role'), editable: el.isContentEditable === true };
}

/** Listens on window; returns the unbind function. Escape goes to `onEscape` before the typing check, so it
 *  also closes a surface whose input has focus. */
export function bindShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>, onEscape: () => void): () => void {
  /** Unmodified Space that is play / pause where it lands. */
  const playsOnSpace = (event: KeyboardEvent): boolean => event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
    && !isTyping(event.target) && spaceIsPlayPause(focusOf(event.target));
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { onEscape(); return; }
    // A focused button activates on Space when the key comes up (Chrome / Safari after any unprevented keydown,
    // auto-repeats included; Firefox even then). So Space that plays is prevented on every keydown, repeats too,
    // and again on keyup (onKeyUp). Otherwise a just-clicked Show or Reset fires a second time (#134).
    const space = playsOnSpace(event);
    if (space) event.preventDefault();
    const action = shortcutFor(event, isTyping(event.target), event.key === ' ' && !space);
    const run = action ? handlers[action] : undefined;
    if (run) { event.preventDefault(); run(); }
  }
  function onKeyUp(event: KeyboardEvent): void { if (playsOnSpace(event)) event.preventDefault(); }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
}
