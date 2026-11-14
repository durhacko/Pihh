// tests/app/ui/fakeDom.ts
// A minimal headless DOM for UI modules that take an injected `document`. It models what focus tests need:
// moving or removing the focused element (or an ancestor) blurs it, exactly as browsers do, and every
// detachment is counted, so "the element was kept" is checkable.

type Listener = (e: FakeEvent) => void;
export interface FakeEvent { type: string; target: FakeElement; key?: string; defaultPrevented: boolean; preventDefault(): void }

export class FakeText {
  parentNode: FakeElement | null = null;
  constructor(public data: string) {}
  get textContent() { return this.data; }
  contains(n: unknown) { return n === this; }
}

export class FakeContext2D {
  calls: string[] = [];
  fillStyle = ''; strokeStyle = ''; globalAlpha = 1; lineWidth = 1;
  clearRect(...a: number[]) { this.calls.push(`clearRect(${a.join(',')})`); }
  rects: { style: string; alpha: number; x: number; y: number; w: number; h: number }[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect:${this.fillStyle}:${this.globalAlpha}`);
    this.rects.push({ style: this.fillStyle, alpha: this.globalAlpha, x, y, w, h });
  }
  beginPath() { this.calls.push('beginPath'); }
  moveTo(x: number, y: number) { this.calls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`); }
  lineTo(x: number, y: number) { this.calls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`); }
  stroke() { this.calls.push(`stroke:${this.globalAlpha}`); }
}

export class FakeElement {
  parentNode: FakeElement | null = null;
  childNodes: (FakeElement | FakeText)[] = [];
  style: Record<string, string> = {};
  type = '';
  disabled = false;
  width = 0;
  height = 0;
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private ctx: FakeContext2D | null = null;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  get className() { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); }
  get title() { return this.attrs.get('title') ?? ''; }
  set title(v: string) { this.attrs.set('title', v); }
  get children(): FakeElement[] { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextSibling(): FakeElement | FakeText | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v: string) {
    for (const n of [...this.childNodes]) this.detach(n);
    if (v) this.appendChild(new FakeText(v));
  }

  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }

  append(...nodes: (FakeElement | FakeText | string)[]) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  appendChild(n: FakeElement | FakeText) { return this.insertBefore(n, null); }
  insertBefore(n: FakeElement | FakeText, ref: FakeElement | FakeText | null) {
    if (n.parentNode) n.parentNode.detach(n);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(n); else this.childNodes.splice(at, 0, n);
    n.parentNode = this;
    return n;
  }
  remove() { this.parentNode?.detach(this); }
  private detach(n: FakeElement | FakeText) {
    this.childNodes.splice(this.childNodes.indexOf(n), 1);
    n.parentNode = null;
    if (n instanceof FakeElement) this.ownerDocument.noteDetached(n);
  }
  contains(n: unknown): boolean { return n === this || this.childNodes.some(c => c.contains(n)); }

  addEventListener(type: string, fn: Listener) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn); }
  removeEventListener(type: string, fn: Listener) { this.listeners.get(type)?.delete(fn); }
  listenerCount() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
  /** Dispatches a bubbling event from this element. */
  dispatch(type: string, init: { key?: string } = {}): FakeEvent {
    const event: FakeEvent = { type, target: this, key: init.key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const node of this.path()) for (const fn of [...(node.listeners.get(type) ?? [])]) fn(event);
    return event;
  }
  /** This element and its ancestors, innermost first (the bubbling path). */
  private path(): FakeElement[] {
    return this.parentNode ? [this, ...this.parentNode.path()] : [this];
  }
  /** Like a pointer click in a browser: a button takes focus first, then receives the click. */
  click() {
    if (this.disabled) return;
    if (this.tagName === 'button') this.focus();
    this.dispatch('click');
  }
  focus() { this.ownerDocument.setActive(this); }
  getContext(kind: string) {
    if (this.tagName !== 'canvas' || kind !== '2d') return null;
    return (this.ctx ??= new FakeContext2D());
  }
  /** Depth-first search for elements with a class. */
  findAll(cls: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const c of this.children) {
      if (c.className.split(' ').includes(cls)) out.push(c);
      out.push(...c.findAll(cls));
    }
    return out;
  }
  findTag(tag: string): FakeElement[] {
    return this.children.flatMap(c => [...(c.tagName === tag ? [c] : []), ...c.findTag(tag)]);
  }
}

export class FakeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement;
  /** Elements detached from a parent while they (or a descendant) had focus. */
  blurredByDetach: FakeElement[] = [];
  detachments = new Map<FakeElement, number>();
  constructor() { this.body = new FakeElement('body', this); this.activeElement = this.body; }
  createElement(tag: string) { return new FakeElement(tag, this); }
  setActive(el: FakeElement) {
    if (this.activeElement === el) return;
    const previous = this.activeElement;
    this.activeElement = el;
    if (previous !== this.body) previous.dispatch('focusout');
    el.dispatch('focusin');
  }
  noteDetached(el: FakeElement) {
    this.detachments.set(el, (this.detachments.get(el) ?? 0) + 1);
    if (el.contains(this.activeElement) && this.activeElement !== this.body) {
      this.blurredByDetach.push(this.activeElement);
      this.activeElement = this.body;
    }
  }
}
