// src/app/ui/keys.ts
// Global keyboard shortcuts (research/ui-prototype DESIGN.md §2.3). One map, one listener. Typing never
// triggers a shortcut (§2.2) and modified keys are left to the browser. Space is play / pause (#134) except in a
// text field, on a switch, or on a control reached by keyboard (#139): a keyboard user's Space activates the focused
// button as usual, while a button focused by a mouse click never fires a second time on Space.
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
export interface FocusLike {
  tagName: string; type?: string; role?: string | null; editable?: boolean;
  /** The element was reached by keyboard: it matched :focus-visible when it took focus (#139). */
  focusVisible?: boolean;
}

/** Input types that do not take text: the same list isTyping uses (dom.ts). A checkbox is handled as a switch. */
const NOT_TEXT_INPUTS: ReadonlySet<string> = new Set(NON_TEXT_INPUT_TYPES);
/** Roles that Space flips (a checkbox-like toggle). A role=radio segment and an aria-pressed button are not among them. */
const SWITCH_ROLES = new Set(['switch', 'checkbox', 'menuitemcheckbox']);
/** Controls that Space activates natively. Reached by keyboard, Space goes to them, not to play / pause (#139).
 *  A range slider is not one (Space does nothing there), so it stays play / pause. */
const SPACE_ACTIVATED_TAGS = new Set(['button', 'summary', 'a']);
const SPACE_ACTIVATED_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'file', 'radio', 'color']);
const SPACE_ACTIVATED_ROLES = new Set(['button', 'radio', 'tab', 'link', 'menuitem', 'menuitemradio', 'option']);

/** True if Space is play / pause with this element focused (#134, #139). It is not where Space types (a text
 *  input, textarea, select or editable region), where it flips a switch (a checkbox, role=switch / checkbox), or on a
 *  control reached by keyboard that Space activates (a button, radio segment, link…: the keyboard user's Space).
 *  On a mouse-focused button, a slider or nothing focused it is play / pause. `null` means no element. */
export function spaceIsPlayPause(focus: FocusLike | null): boolean {
  if (!focus) return true;
  const tag = focus.tagName.toLowerCase();
  const type = (focus.type || 'text').toLowerCase();
  const role = (focus.role ?? '').toLowerCase();
  if (focus.editable || tag === 'textarea' || tag === 'select') return false;
  if (tag === 'input' && (type === 'checkbox' || !NOT_TEXT_INPUTS.has(type))) return false;
  if (SWITCH_ROLES.has(role)) return false;
  const activated = (tag === 'input' ? SPACE_ACTIVATED_INPUTS.has(type) : SPACE_ACTIVATED_TAGS.has(tag)) || SPACE_ACTIVATED_ROLES.has(role);
  return !(focus.focusVisible && activated);
}

/** The DOM side of spaceIsPlayPause: describes a key event's target, or null for window / document. Duck-typed
 *  (no instanceof Element) so the wiring also runs in the node test environment. `focusVisible`: whether the target
 *  was reached by keyboard, as recorded when it took focus (focusVisibleNow at focusin; see bindShortcuts). */
export function focusOf(target: EventTarget | null, focusVisible = false): FocusLike | null {
  const el = target as Partial<HTMLInputElement> | null;
  if (!el || typeof el.tagName !== 'string' || typeof el.getAttribute !== 'function') return null;
  return { tagName: el.tagName, type: typeof el.type === 'string' ? el.type : undefined, role: el.getAttribute('role'), editable: el.isContentEditable === true, focusVisible };
}

/** Whether `target` matches :focus-visible right now (false without matches(), or where the selector is unsupported). */
export function focusVisibleNow(target: EventTarget | null): boolean {
  const el = target as Partial<Element> | null;
  if (!el || typeof el.matches !== 'function') return false;
  try { return el.matches(':focus-visible'); } catch { return false; }
}

/** Listens on window; returns the unbind function. Escape goes to `onEscape` before the typing check, so it
 *  also closes a surface whose input has focus. */
export function bindShortcuts(handlers: Partial<Record<ShortcutAction, () => void>>, onEscape: () => void): () => void {
  // Reached by keyboard or not, read ONCE as each element takes focus. Not at key time: Chrome makes a mouse-focused
  // button match :focus-visible as soon as any key goes down on it, which would hand a just-clicked Show or Reset
  // its Space again (the #134 bug). Unknown (focused before binding) counts as not by keyboard: Space plays.
  const reachedByKeyboard = new WeakMap<object, boolean>();
  const onFocusIn = (event: Event): void => { if (event.target && typeof event.target === 'object') reachedByKeyboard.set(event.target, focusVisibleNow(event.target)); };
  /** Unmodified Space that is play / pause where it lands. */
  const playsOnSpace = (event: KeyboardEvent): boolean => event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
    && !isTyping(event.target) && spaceIsPlayPause(focusOf(event.target, event.target ? reachedByKeyboard.get(event.target) ?? false : false));
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
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  return () => { window.removeEventListener('focusin', onFocusIn, true); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
}
