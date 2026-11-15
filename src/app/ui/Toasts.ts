// src/app/ui/Toasts.ts
// Transient feedback (DESIGN.md §2.2: never takes focus; aria-live). At most three on screen; errors stay longer.
// Shared module: no createPanel export, so the panel loader skips it.
import { h } from './dom';

export type ToastKind = 'ok' | 'err' | 'info';
export interface Toaster {
  readonly el: HTMLElement;
  toast(text: string, kind?: ToastKind, action?: { label: string; run(): void }): void;
  dispose(): void;
}

export const MAX_TOASTS = 3;

export function createToasts(): Toaster {
  const el = h('div', { class: 'toasts chrome', 'aria-live': 'polite' });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    el,
    toast(text, kind = 'info', action) {
      const mark = kind === 'err' ? '▲' : kind === 'ok' ? '●' : '·';
      const colour = kind === 'err' ? 'var(--danger)' : kind === 'ok' ? '#8fd9b6' : 'var(--text-3)';
      const t = h('div', { class: `toast surface ${kind === 'err' ? 'err' : ''}`, role: kind === 'err' ? 'alert' : 'status' },
        h('span', { style: { color: colour } }, mark), h('span', {}, text),
        action ? h('button', { class: 'btn small act', type: 'button', onclick: () => { action.run(); t.remove(); } }, action.label) : null);
      el.append(t);
      while (el.childElementCount > MAX_TOASTS) el.firstElementChild?.remove();
      const timer = setTimeout(() => { t.remove(); timers.delete(timer); }, kind === 'err' ? 6000 : 4200);
      timers.add(timer);
    },
    dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); el.remove(); },
  };
}
