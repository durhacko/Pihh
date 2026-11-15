// src/app/ui/surfaces.ts
// Surface manager (research/ui-prototype DESIGN.md §2.2, §4): one place that owns which panels, trays and
// popovers are open.
// - Panels (composer, inspector) and trays (timeline, console) are non-modal and stay open until closed;
//   any number may be open, and the 3D viewport stays interactive.
// - Popovers (lenses, disrupt, metrics, help) light-dismiss on an outside pointerdown; at most one is open.
// - Escape closes the most recently opened surface; focus returns to whatever opened it.
// Shared module: it does not export createPanel, so the panel loader in ./index.ts imports it without effect.
// Nothing touches the DOM at import; a Surfaces instance attaches its two listeners when constructed and
// removes them in dispose().
import type { Store } from './store';

export type SurfaceKind = 'panel' | 'tray' | 'popover';

export interface SurfaceDef {
  id: string;
  kind: SurfaceKind;
  el: HTMLElement;
  anchor?: () => HTMLElement | null;         // popovers are positioned against this; clicks on it are not "outside"
  place?: 'above' | 'below-right';
  onOpen?(): void;
  onClose?(): void;
  focusOnOpen?: () => HTMLElement | null;    // the input that receives focus, if the surface has one
}

/** The parts of the browser the manager uses. Injected so it can run headless in tests. */
export interface SurfaceEnv {
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'contains'> & { readonly activeElement: Element | null };
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> & { readonly innerWidth: number; readonly innerHeight: number };
  /** Runs `fn` after the surface has been laid out (requestAnimationFrame in the browser). */
  nextFrame(fn: () => void): void;
}

function browserEnv(): SurfaceEnv {
  return { document, window, nextFrame: (fn) => { requestAnimationFrame(fn); } };
}

export class Surfaces {
  private readonly defs = new Map<string, SurfaceDef>();
  private stack: string[] = [];                                   // open surfaces, most recently opened last
  private readonly returnFocus = new Map<string, HTMLElement | null>();
  private readonly listeners = new Set<(open: string[]) => void>();
  private readonly env: SurfaceEnv;

  private readonly onPointerDown = (e: Event): void => {
    const target = e.target as Node | null;
    for (const id of this.stack.filter((s) => this.kindOf(s) === 'popover')) {
      const d = this.defs.get(id) as SurfaceDef;
      if (target && (d.el.contains(target) || d.anchor?.()?.contains(target))) continue;
      this.close(id, false);   // the click moves focus itself; do not pull it back
    }
  };

  private readonly onResize = (): void => {
    for (const id of this.stack) this.position(id);
  };

  constructor(env: SurfaceEnv = browserEnv()) {
    this.env = env;
    env.document.addEventListener('pointerdown', this.onPointerDown, true);
    env.window.addEventListener('resize', this.onResize);
  }

  /** Removes the global listeners. The manager must not be used afterwards. */
  dispose(): void {
    this.env.document.removeEventListener('pointerdown', this.onPointerDown, true);
    this.env.window.removeEventListener('resize', this.onResize);
    this.listeners.clear();
  }

  register(def: SurfaceDef): void {
    if (this.defs.has(def.id)) throw new Error(`Surface '${def.id}' is already registered`);
    this.defs.set(def.id, def);
    def.el.hidden = true;
    if (def.kind === 'popover') {
      def.el.setAttribute('role', 'dialog');
      def.el.setAttribute('aria-modal', 'false');
    }
  }

  /** Called with the open ids (oldest first) after every open, close or reorder. Returns the unsubscribe. */
  onChange(fn: (open: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  isOpen(id: string): boolean {
    return this.stack.includes(id);
  }

  openIds(): string[] {
    return [...this.stack];
  }

  open(id: string): void {
    const d = this.defs.get(id);
    if (!d) throw new Error(`Unknown surface '${id}'`);
    if (d.kind === 'popover') {
      for (const other of this.stack.filter((o) => o !== id && this.kindOf(o) === 'popover')) this.close(other, false);
    }
    if (this.isOpen(id)) {
      this.stack = [...this.stack.filter((s) => s !== id), id];   // re-opening moves it to the top
    } else {
      this.returnFocus.set(id, this.env.document.activeElement as HTMLElement | null);
      this.stack.push(id);
    }
    d.el.hidden = false;
    this.position(id);
    d.onOpen?.();
    const target = d.focusOnOpen?.();
    if (target) this.env.nextFrame(() => { if (this.isOpen(id)) target.focus(); });
    this.emit();
  }

  /** Closes `id`. With `restoreFocus`, focus goes back to the element that was focused when it opened. */
  close(id: string, restoreFocus = true): void {
    const d = this.defs.get(id);
    if (!d || !this.isOpen(id)) return;
    this.stack = this.stack.filter((s) => s !== id);
    d.el.hidden = true;
    d.onClose?.();
    const back = this.returnFocus.get(id);
    this.returnFocus.delete(id);
    if (restoreFocus && back && this.env.document.contains(back)) back.focus();
    this.emit();
  }

  toggle(id: string): void {
    if (this.isOpen(id)) this.close(id);
    else this.open(id);
  }

  /** Closes the most recently opened surface. Returns false if nothing was open. */
  escape(): boolean {
    const id = this.stack[this.stack.length - 1];
    if (id === undefined) return false;
    this.close(id);
    return true;
  }

  /** Places a popover against its anchor: centred above it, or below it right-aligned. Panels and trays are laid out by CSS. */
  position(id: string): void {
    const d = this.defs.get(id);
    const a = d?.anchor?.();
    if (!d || !a || d.kind !== 'popover') return;
    const r = a.getBoundingClientRect();
    const w = d.el.offsetWidth || 300;
    const { innerWidth, innerHeight } = this.env.window;
    if (d.place === 'below-right') {
      d.el.style.top = `${r.bottom + 8}px`;
      d.el.style.right = `${Math.max(12, innerWidth - r.right)}px`;
      d.el.style.left = 'auto';
      d.el.style.bottom = 'auto';
    } else {
      const left = Math.min(innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
      d.el.style.left = `${left}px`;
      d.el.style.bottom = `${innerHeight - r.top + 10}px`;
      d.el.style.top = 'auto';
      d.el.style.right = 'auto';
    }
  }

  private kindOf(id: string): SurfaceKind | undefined {
    return this.defs.get(id)?.kind;
  }

  private emit(): void {
    const open = this.openIds();
    for (const fn of [...this.listeners]) fn(open);
  }
}

/** What one Escape press did, in DESIGN §2.2 order; null if there was nothing to undo. */
export type EscapeStep = 'cancelPick' | 'showChrome' | 'closeSurface' | 'clearPreview' | 'deselect' | null;

/**
 * One Escape press, DESIGN §2.2: cancel a pending pick → show the controls again → close the most recently
 * opened surface → clear the preview → deselect. Exactly one step runs per press. `deselect` lets the app
 * also close the inspector; by default it clears `selected`.
 */
export function handleEscape(store: Store, surfaces: Surfaces, deselect: () => void = () => store.set({ selected: null })): EscapeStep {
  const s = store.state;
  if (s.pick) {
    const pick = s.pick;
    store.set({ pick: null, pickPoint: null });
    pick.resolve(null);
    return 'cancelPick';
  }
  if (s.chromeHidden) {
    store.set({ chromeHidden: false });
    return 'showChrome';
  }
  if (surfaces.escape()) return 'closeSurface';
  if (s.preview) {
    store.set({ preview: null });
    return 'clearPreview';
  }
  if (s.selected) {
    deselect();
    return 'deselect';
  }
  return null;
}

/**
 * The stage's bottom inset and where split view's two panes meet, in client px, from the viewport height and the
 * tops of the open trays (console, timeline). The stage stops 8 px above the highest open tray, and the panes are
 * 50% / 50% of the stage, so the divider and the lower pane label belong at half the stage's height. One source for
 * both numbers: the shell sets `stage.style.bottom` and `--split-mid` from the same call.
 */
export function stageLayout(viewportHeight: number, openTrayTops: readonly number[]): { stageBottom: number; splitMid: number } {
  const stageBottom = openTrayTops.length ? Math.max(0, viewportHeight - Math.min(...openTrayTops) + 8) : 0;
  return { stageBottom, splitMid: Math.max(0, viewportHeight - stageBottom) / 2 };
}
