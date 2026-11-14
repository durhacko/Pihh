// Surface manager: one place that owns which panels and popovers are open.
// - Panels (composer, inspector, timeline, console) are non-modal and persist until dismissed.
// - Popovers (lenses, disrupt, metrics, help) light-dismiss on outside click; at most one at a time.
// - Escape closes the most recently opened surface first; focus returns to whatever opened it.
// - The 3D viewport stays interactive whenever only non-modal surfaces are open.
export type SurfaceKind = 'panel' | 'popover';
export interface SurfaceDef {
  id: string; kind: SurfaceKind; el: HTMLElement;
  anchor?: () => HTMLElement | null;         // popovers are positioned against this
  place?: 'above' | 'below-right';
  onOpen?(): void; onClose?(): void;
  focusOnOpen?: () => HTMLElement | null;
}

export class Surfaces {
  private defs = new Map<string, SurfaceDef>();
  private stack: string[] = [];
  private returnFocus = new Map<string, HTMLElement | null>();
  private listeners = new Set<(open: string[]) => void>();

  constructor() {
    document.addEventListener('pointerdown', e => {
      const top = this.stack.filter(id => this.defs.get(id)!.kind === 'popover');
      for (const id of top) {
        const d = this.defs.get(id)!;
        const anchor = d.anchor?.();
        if (d.el.contains(e.target as Node) || anchor?.contains(e.target as Node)) continue;
        this.close(id, false);
      }
    }, true);
    window.addEventListener('resize', () => this.stack.forEach(id => this.position(id)));
  }

  register(def: SurfaceDef): void {
    this.defs.set(def.id, def);
    def.el.hidden = true;
    if (def.kind === 'popover') { def.el.setAttribute('role', 'dialog'); def.el.setAttribute('aria-modal', 'false'); }
  }
  onChange(fn: (open: string[]) => void) { this.listeners.add(fn); }
  isOpen(id: string): boolean { return this.stack.includes(id); }
  openIds(): string[] { return [...this.stack]; }

  open(id: string): void {
    const d = this.defs.get(id);
    if (!d) return;
    if (d.kind === 'popover') for (const other of this.stack.filter(o => o !== id && this.defs.get(o)!.kind === 'popover')) this.close(other, false);
    if (!this.isOpen(id)) {
      this.returnFocus.set(id, document.activeElement as HTMLElement | null);
      this.stack.push(id);
    } else { this.stack = this.stack.filter(s => s !== id); this.stack.push(id); }
    d.el.hidden = false;
    this.position(id);
    d.onOpen?.();
    const f = d.focusOnOpen?.();
    if (f) requestAnimationFrame(() => f.focus());
    this.emit();
  }
  close(id: string, restoreFocus = true): void {
    const d = this.defs.get(id);
    if (!d || !this.isOpen(id)) return;
    this.stack = this.stack.filter(s => s !== id);
    d.el.hidden = true;
    d.onClose?.();
    const back = this.returnFocus.get(id);
    if (restoreFocus && back && document.contains(back)) back.focus();
    this.emit();
  }
  toggle(id: string): void { if (this.isOpen(id)) this.close(id); else this.open(id); }
  /** Escape: close the most recently opened surface. Returns false if nothing was open. */
  escape(): boolean {
    const id = this.stack[this.stack.length - 1];
    if (!id) return false;
    this.close(id);
    return true;
  }
  position(id: string): void {
    const d = this.defs.get(id);
    const a = d?.anchor?.();
    if (!d || !a || d.kind !== 'popover') return;
    const r = a.getBoundingClientRect();
    const w = d.el.offsetWidth || 300;
    if (d.place === 'below-right') {
      d.el.style.top = `${r.bottom + 8}px`;
      d.el.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
      d.el.style.left = 'auto'; d.el.style.bottom = 'auto';
    } else {
      const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
      d.el.style.left = `${left}px`;
      d.el.style.bottom = `${window.innerHeight - r.top + 10}px`;
      d.el.style.top = 'auto'; d.el.style.right = 'auto';
    }
  }
  private emit() { for (const fn of this.listeners) fn(this.openIds()); }
}
