// src/app/ui/dom.ts
// Tiny DOM helpers. No framework: the app's UI layer is DOM-only by design (experience doc §1).
// Shared module: it does not export createPanel, so the panel loader in ./index.ts imports it without effect.
import { DT } from '../../contracts';

export type Child = Node | string | null | undefined | false;

/**
 * Creates an element. `class` sets className; `onX` functions become event listeners; a `style` object is
 * assigned; `true` sets an empty attribute; null, undefined and false are skipped. `html` sets innerHTML and
 * is for trusted markup only (the icons below): never pass user or console text through it, use `esc` or text children.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes text. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

/** Input types that take no text: keys on them are never typing (DESIGN §2.2), and Space there is play / pause
 *  (keys.ts spaceIsPlayPause; a checkbox is a switch there). One list, so the two rules cannot disagree (#134). */
export const NON_TEXT_INPUT_TYPES = ['checkbox', 'range', 'color', 'radio', 'button', 'submit', 'reset', 'image', 'file'] as const;
const TYPING = `input${NON_TEXT_INPUT_TYPES.map(type => `:not([type=${type}])`).join('')},textarea,select,[contenteditable=true]`;

/** True if keystrokes on `t` are text entry, so global shortcuts must ignore them (DESIGN §2.2). */
export const isTyping = (t: EventTarget | null): boolean =>
  typeof HTMLElement !== 'undefined' && t instanceof HTMLElement && t.matches(TYPING);

/** Show-clock time for a tick: "mm:ss.s". Rounded in whole tenths first, so it never shows "01:60.0". */
export const fmtTime = (tick: number): string => {
  const tenths = Math.round(tick * (DT * 10));   // DT * 10 = 0.5 exactly, so no floating-point drift
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  return `${String(m).padStart(2, '0')}:${(rest / 10).toFixed(1).padStart(4, '0')}`;
};

/** Fixed decimals, or "—" for a missing value (null metrics stay visibly missing, never 0). */
export const fmt = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d));

/** "(x, y, z)" with `d` decimals. */
export const vec = (v: readonly number[], d = 1): string => `(${v.map((x) => x.toFixed(d)).join(', ')})`;
