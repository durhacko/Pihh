import { DT, type MetricsSample } from '../../contracts';
import type { PanelContext } from './index';

export interface HudPayload {
  encore: MetricsSample | null;
  static: MetricsSample | null;
  rosterSize?: number;
  fps?: number | null;
  quality?: string;
  inHold?: { encore?: boolean; static?: boolean };
  layout?: 'split' | 'encore' | 'static';
  radio?: { drawn: number; observed: number };
  brainKinds?: { encore?: 'encore' | 'static'; static?: 'encore' | 'static' };
}

export interface ArmHud {
  label: string; tick: string; alive: string; npwc: string; npwcNote: string; transitioning: boolean | null;
  coverage: string; fidelity: string; messages: string; delivered: string; versions: string;
  duplicates: string; collisions: string; nearMisses: string; slotChanges: string;
}
export interface HudPresentation {
  encore: ArmHud | null; static: ArmHud | null;
  fps: string; quality: string; radio: string; layout: string; status: string;
}

export function formatPercent(value: number | null): string { return value === null || !Number.isFinite(value) ? 'Unavailable' : `${(value * 100).toFixed(1)}%`; }
export function formatMetres(value: number | null): string { return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(2)} m`; }
function count(value: number): string { return Number.isFinite(value) ? value.toLocaleString('en-GB') : 'Unavailable'; }

/** Read-only presentation state. Rates use simulation tick/counter deltas, never frame timing. */
export class HudModel {
  private previous: { encore: MetricsSample | null; static: MetricsSample | null } = { encore: null, static: null };
  private rates: { encore: number | null; static: number | null } = { encore: null, static: null };
  private payload: HudPayload = { encore: null, static: null };

  update(payload: HudPayload): void {
    // Each update describes the current observation. Omitted optional telemetry is unknown,
    // not permission to retain an old run's FPS, hold state, layout or brain label.
    this.payload = structuredClone(payload);
    for (const arm of ['encore', 'static'] as const) {
      const sample = payload[arm];
      const previous = this.previous[arm];
      if (!sample || (previous && (sample.tick < previous.tick || sample.msgs.hb + sample.msgs.score < previous.msgs.hb + previous.msgs.score))) { this.previous[arm] = null; this.rates[arm] = null; }
      if (!sample) continue;
      const before = this.previous[arm];
      if (before && sample.tick > before.tick) {
        const delta = sample.msgs.hb + sample.msgs.score - before.msgs.hb - before.msgs.score;
        this.rates[arm] = delta >= 0 ? delta / ((sample.tick - before.tick) * DT) : null;
      }
      if (!before || sample.tick !== before.tick) this.previous[arm] = structuredClone(sample);
    }
  }

  present(): HudPresentation {
    const payload = this.payload;
    const armView = (arm: 'encore' | 'static'): ArmHud | null => {
      const sample = payload[arm];
      if (!sample) return null;
      const roster = payload.rosterSize === undefined ? '?' : count(payload.rosterSize);
      const candidates = sample.msgs.delivered + sample.msgs.lost + sample.msgs.blocked;
      const rate = this.rates[arm];
      const base = arm === 'encore' ? 'Encore arm' : 'Static baseline';
      const kind = payload.brainKinds?.[arm];
      return {
        label: kind ? `${base} · ${kind === 'static' ? 'static brain' : 'Encore brain'}` : `${base} · brain not reported`,
        tick: count(sample.tick), alive: `${count(sample.alive)} / ${roster}`,
        npwc: formatPercent(sample.npwc), npwcNote: sample.npwc === null ? sample.alive === 0 ? 'No live drones' : 'Observer value unavailable' : 'Priority-weighted by our own slot order',
        transitioning: payload.inHold?.[arm] === undefined ? null : !payload.inHold[arm],
        coverage: formatPercent(sample.coverage), fidelity: `${formatMetres(sample.sfMean)} mean / ${formatMetres(sample.sfMax)} max`,
        messages: rate === null ? 'Waiting for rate sample' : `${rate.toFixed(1)} broadcasts / sim s`,
        delivered: candidates === 0 ? 'No transmission candidates' : `${formatPercent(sample.msgs.delivered / candidates)} delivered (cumulative)`,
        versions: Object.entries(sample.versions).map(([version, live]) => `${version}: ${count(live)} live`).join(' · ') || 'No live score beliefs',
        duplicates: count(sample.dupSlots), collisions: count(sample.collisions), nearMisses: count(sample.nearMisses), slotChanges: count(sample.slotChanges),
      };
    };
    const layout = payload.layout === 'split' ? 'Stacked comparison' : payload.layout === 'encore' ? 'Encore view · both metrics shown' : payload.layout === 'static' ? 'Static view · both metrics shown' : 'View layout not reported';
    const status = !payload.encore || !payload.static ? 'Waiting for both observer samples' : payload.encore.tick !== payload.static.tick ? 'Samples are from different ticks' : 'Observer measurements · same simulation tick';
    return {
      encore: armView('encore'), static: armView('static'), status, layout,
      fps: payload.fps === undefined || payload.fps === null || !Number.isFinite(payload.fps) ? 'FPS not measured' : `${payload.fps.toFixed(1)} measured fps`,
      quality: payload.quality || 'Quality not reported',
      radio: payload.radio ? `Radio drawn ${count(payload.radio.drawn)} / ${count(payload.radio.observed)} observed deliveries` : 'Radio drawing not reported',
    };
  }
}

interface HudClock { now(): number; schedule(callback: () => void, delay: number): unknown; cancel(token: unknown): void }
const clock: HudClock = { now: () => performance.now(), schedule: (callback, delay) => setTimeout(callback, delay), cancel: token => clearTimeout(token as ReturnType<typeof setTimeout>) };
type HudBinding = { update(payload: HudPayload): void; dispose(): void };
const bindings = new WeakMap<HTMLElement, HudBinding>();

/** Bootstrap feeds real samples explicitly. One binder per host; the panel owns its DOM. */
export function bindHud(host: HTMLElement, timing: HudClock = clock): HudBinding {
  const existing = bindings.get(host);
  if (existing) return existing;
  const model = new HudModel();
  let lastPublished = -Infinity;
  let pending: unknown;
  let disposed = false;
  function publish() {
    if (disposed) return;
    pending = undefined; lastPublished = timing.now();
    host.dispatchEvent(new CustomEvent<HudPresentation>('encore:hud-presentation', { detail: model.present() }));
  }
  const onQuery = () => host.dispatchEvent(new CustomEvent<HudPresentation>('encore:hud-presentation', { detail: model.present() }));
  host.addEventListener('encore:hud-query', onQuery);
  const binding: HudBinding = {
    update(payload) {
      if (disposed) return;
      model.update(payload);
      const remaining = 250 - (timing.now() - lastPublished);
      if (remaining <= 0) { if (pending !== undefined) timing.cancel(pending); publish(); }
      else if (pending === undefined) pending = timing.schedule(publish, remaining);
    },
    dispose() {
      if (disposed) return;
      disposed = true; if (pending !== undefined) timing.cancel(pending);
      host.removeEventListener('encore:hud-query', onQuery); bindings.delete(host);
      host.dispatchEvent(new CustomEvent<HudPresentation>('encore:hud-presentation', { detail: new HudModel().present() }));
    },
  };
  bindings.set(host, binding); return binding;
}

const panels = new WeakMap<HTMLElement, { dispose(): void }>();
const ESSENTIAL: [keyof ArmHud, string][] = [['npwc', 'nPWC'], ['alive', 'Alive'], ['collisions', 'Collisions'], ['messages', 'Messages']];
const DETAIL: [keyof ArmHud, string][] = [
  ['coverage', 'Coverage'], ['nearMisses', 'Near misses'], ['duplicates', 'Duplicate slots'], ['slotChanges', 'Slot changes'],
  ['fidelity', 'Shape fidelity'], ['delivered', 'Delivered'], ['versions', 'Score beliefs'], ['npwcNote', 'nPWC note'], ['tick', 'Tick'],
];
const ARM_NAMES = { encore: 'Encore arm', static: 'Static baseline' } as const;
function placeholder(name: keyof ArmHud): string {
  return name === 'npwc' ? 'Waiting' : name === 'npwcNote' ? 'Waiting for observer samples' : name === 'alive' ? '— / ?' : '—';
}
const row = ([name, label]: [keyof ArmHud, string], key = false) =>
  `<tr${key ? ' class="key"' : ''}><th scope="row">${label}</th>${(['encore', 'static'] as const).map(arm => `<td data-arm="${arm}" data-field="${name}">${placeholder(name)}</td>`).join('')}</tr>`;

/**
 * Compact, semi-transparent comparison: the essential numbers (nPWC, alive, collisions, messages for both
 * arms) above the fold, everything else under "More measurements". H (or the button) collapses it to a
 * one-line summary; it starts collapsed on narrow screens. Every rule is scoped to .encore-hud.
 */
export function createPanel({ host }: PanelContext) {
  const existing = panels.get(host);
  if (existing) return existing;
  const panel = document.createElement('section');
  panel.className = 'encore-hud'; panel.setAttribute('aria-label', 'Observer comparison');
  panel.innerHTML = `<style>
    .encore-hud{position:absolute;right:24px;bottom:112px;width:min(360px,calc(100vw - 48px));max-height:calc(100dvh - 330px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;border:1px solid #2f4b5a;border-radius:10px;background:rgba(5,13,22,.74);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);padding:10px 14px;color:#d2e5ed;font:13px/1.4 system-ui;z-index:2;pointer-events:auto}
    .encore-hud header{display:flex;align-items:center;gap:10px}
    .encore-hud h2{flex:1;margin:0;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#9fbccb}
    .encore-hud .summary{display:none;font-variant-numeric:tabular-nums;color:#d9f5ee;white-space:nowrap}
    .encore-hud.collapsed .summary{display:inline}.encore-hud.collapsed .body,.encore-hud.collapsed h2{display:none}
    .encore-hud.collapsed{width:auto;max-width:calc(100vw - 24px)}
    .encore-hud .toggle{font:11px system-ui;color:#a8c5d2;background:transparent;border:1px solid #2f4b5a;border-radius:5px;padding:4px 8px;cursor:pointer}
    .encore-hud .toggle:hover{color:#fff;background:#12293a}.encore-hud :focus-visible{outline:2px solid #71d5dd;outline-offset:2px}
    .encore-hud kbd{font:10px system-ui;opacity:.7;margin-left:4px}
    .encore-hud table{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed;font-variant-numeric:tabular-nums}
    .encore-hud th,.encore-hud td{padding:3px 0;vertical-align:baseline;overflow-wrap:anywhere}
    .encore-hud thead th{font-size:11px;font-weight:500;color:#9fbccb;text-align:right;padding-bottom:4px;border-bottom:1px solid #2f4b5a}
    .encore-hud thead th:first-child,.encore-hud tbody th{text-align:left;font-weight:400;color:#9fbccb;width:31%}
    .encore-hud td{text-align:right;padding-left:10px}
    .encore-hud tr.key td{font-size:20px;letter-spacing:-.02em;color:#d9f5ee}.encore-hud tr.key td.transition{color:#a8b8c2}
    .encore-hud details{margin-top:6px}.encore-hud summary{cursor:pointer;color:#9fbccb;font-size:12px}
    .encore-hud details table{margin-top:4px;font-size:12px}
    .encore-hud .meta{margin:8px 0 0;font-size:11px;color:#8fb0bf}
    @media(max-width:700px){.encore-hud{right:12px;bottom:160px;width:min(360px,calc(100vw - 249px));max-width:calc(100vw - 249px);max-height:calc(100dvh - 330px)}.encore-hud .summary{white-space:normal}.encore-hud.collapsed{max-width:calc(100vw - 249px)}}
  </style><header><h2>Observer comparison</h2><span class="summary" data-summary></span><button type="button" class="toggle" aria-expanded="true">Hide<kbd>H</kbd></button></header>
  <div class="body"><table><thead><tr><th scope="col">Measured</th>${(['encore', 'static'] as const).map(arm => `<th scope="col" data-arm-label="${arm}">${ARM_NAMES[arm]}</th>`).join('')}</tr></thead>
  <tbody>${ESSENTIAL.map((entry, index) => row(entry, index === 0)).join('')}</tbody></table>
  <details><summary>More measurements</summary><table><tbody>${DETAIL.map(entry => row(entry)).join('')}</tbody></table></details>
  <p class="meta"><span data-meta="fps">FPS not measured</span> · <span data-meta="layout">View layout not reported</span> · <span data-meta="radio">Radio drawing not reported</span> · <span data-meta="quality">Quality not reported</span><br><span class="status" role="status">Waiting for both observer samples</span></p></div>`;
  host.append(panel);
  const toggle = panel.querySelector<HTMLButtonElement>('.toggle')!;
  const summary = panel.querySelector<HTMLElement>('[data-summary]')!;
  function setCollapsed(collapsed: boolean) {
    // Focus inside the body would vanish with it: keep keyboard users on the toggle.
    if (collapsed && document.activeElement instanceof HTMLElement && panel.querySelector('.body')!.contains(document.activeElement)) toggle.focus();
    panel.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.innerHTML = `${collapsed ? 'Show' : 'Hide'}<kbd>H</kbd>`;
  }
  setCollapsed(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches);
  const onToggle = () => setCollapsed(!panel.classList.contains('collapsed'));
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'h') return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    event.preventDefault(); onToggle();
  };
  toggle.addEventListener('click', onToggle);
  window.addEventListener('keydown', onKey);
  function onPresentation(event: Event) {
    const view = (event as CustomEvent<HudPresentation>).detail;
    for (const arm of ['encore', 'static'] as const) {
      const sample = view[arm];
      panel.querySelector(`[data-arm-label=${arm}]`)!.textContent = sample ? sample.label : ARM_NAMES[arm];
      for (const field of panel.querySelectorAll<HTMLElement>(`[data-arm=${arm}][data-field]`)) {
        const name = field.dataset.field as keyof ArmHud;
        field.textContent = sample ? String(sample[name]) : placeholder(name);
      }
      panel.querySelector(`tr.key [data-arm=${arm}]`)!.classList.toggle('transition', sample?.transitioning === true);
    }
    summary.textContent = `nPWC ${view.encore?.npwc ?? '—'} encore · ${view.static?.npwc ?? '—'} static`;
    for (const field of panel.querySelectorAll<HTMLElement>('[data-meta]')) field.textContent = view[field.dataset.meta as 'fps' | 'quality' | 'radio' | 'layout'];
    panel.querySelector('.status')!.textContent = view.status;
  }
  host.addEventListener('encore:hud-presentation', onPresentation);
  host.dispatchEvent(new Event('encore:hud-query'));
  let disposed = false;
  const binding = { dispose() {
    if (disposed) return; disposed = true;
    host.removeEventListener('encore:hud-presentation', onPresentation); toggle.removeEventListener('click', onToggle); window.removeEventListener('keydown', onKey);
    panel.remove(); panels.delete(host);
  } };
  panels.set(host, binding); return binding;
}
