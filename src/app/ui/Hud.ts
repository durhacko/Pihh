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
export function createPanel({ host }: PanelContext) {
  const existing = panels.get(host);
  if (existing) return existing;
  const panel = document.createElement('section');
  panel.className = 'encore-hud'; panel.tabIndex = 0; panel.setAttribute('aria-label', 'Observer comparison');
  panel.innerHTML = `<style>
    .encore-hud{position:absolute;right:24px;bottom:105px;width:min(680px,calc(100vw - 380px));max-height:calc(100dvh - 260px);overflow:auto;overscroll-behavior:contain;border:1px solid #406475;border-radius:10px;background:#06111d;padding:18px;color:#d2e5ed;font:16px/1.45 system-ui;z-index:2;pointer-events:auto;scrollbar-gutter:stable}
    .encore-hud h2{font-size:16px;font-weight:600;letter-spacing:.06em;color:#a8c5d2;margin:0 0 14px}
    .encore-hud .arms{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
    .encore-hud .arm{min-width:0;overflow-wrap:anywhere}.encore-hud .arm+.arm{border-left:1px solid #406475;padding-left:20px}
    .encore-hud .name,.encore-hud .note,.encore-hud .versions,.encore-hud .meta,.encore-hud .status{font-size:16px;color:#a8c5d2}
    .encore-hud .npwc{font-size:38px;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:#d9f5ee;margin-top:5px;line-height:1.2}.encore-hud .npwc.transition{color:#a8b8c2}
    .encore-hud .note{margin:5px 0 12px}.encore-hud dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 12px;margin:0;font-variant-numeric:tabular-nums}
    .encore-hud dt{color:#a8c5d2}.encore-hud dd{min-width:0;margin:0;text-align:right;overflow-wrap:anywhere}.encore-hud .versions{margin-top:12px;overflow-wrap:anywhere}
    .encore-hud .meta{border-top:1px solid #406475;margin-top:16px;padding-top:12px;display:flex;flex-wrap:wrap;gap:8px 16px}.encore-hud .status{margin-top:12px}
    .encore-hud:focus-visible{outline:2px solid #71d5dd;outline-offset:2px}
    @media(max-width:900px){.encore-hud{right:12px;width:calc(100vw - 330px);padding:12px}.encore-hud .arms{grid-template-columns:1fr}.encore-hud .arm+.arm{border-left:0;border-top:1px solid #406475;padding:16px 0 0}.encore-hud .npwc{font-size:32px}}
    @media(max-width:700px){.encore-control{left:12px;right:12px;top:150px;width:auto;max-height:calc((100dvh - 260px)/2)}.encore-hud{left:12px;right:12px;bottom:90px;width:auto;max-height:calc((100dvh - 260px)/2)}}
  </style><h2>nPWC / OBSERVER COMPARISON</h2><div class="arms">${(['encore', 'static'] as const).map(arm => `<article class="arm" data-arm="${arm}"><div class="name" data-field="label"></div><div class="npwc" data-field="npwc">Waiting</div><div class="note" data-field="npwcNote">Waiting for observer samples</div><dl><dt>Alive / roster</dt><dd data-field="alive">— / ?</dd><dt>Coverage</dt><dd data-field="coverage">Unavailable</dd><dt>Tick</dt><dd data-field="tick">—</dd><dt>Duplicate slots</dt><dd data-field="duplicates">—</dd><dt>Collisions, measured</dt><dd data-field="collisions">—</dd><dt>Near misses, measured</dt><dd data-field="nearMisses">—</dd><dt class="detail">Slot changes</dt><dd class="detail" data-field="slotChanges">—</dd></dl><div class="versions detail" data-field="fidelity"></div><div class="versions detail" data-field="messages"></div><div class="versions detail" data-field="delivered"></div><div class="versions" data-field="versions"></div></article>`).join('')}</div><div class="meta"><span data-meta="fps">FPS not measured</span><span data-meta="quality">Quality not reported</span><span data-meta="radio">Radio drawing not reported</span><span data-meta="layout">View layout not reported</span></div><div class="status" role="status">Waiting for both observer samples</div>`;
  host.append(panel);
  function onPresentation(event: Event) {
    const view = (event as CustomEvent<HudPresentation>).detail;
    for (const arm of ['encore', 'static'] as const) {
      const article = panel.querySelector<HTMLElement>(`[data-arm=${arm}]`)!;
      const sample = view[arm];
      for (const field of article.querySelectorAll<HTMLElement>('[data-field]')) {
        const name = field.dataset.field as keyof ArmHud;
        field.textContent = sample ? String(sample[name]) : name === 'label' ? arm === 'encore' ? 'Encore arm' : 'Static baseline' : name === 'npwc' ? 'Waiting' : name === 'npwcNote' ? 'Waiting for observer samples' : name === 'alive' ? '— / ?' : '—';
      }
      article.querySelector('[data-field=npwc]')!.classList.toggle('transition', sample?.transitioning === true);
    }
    for (const field of panel.querySelectorAll<HTMLElement>('[data-meta]')) field.textContent = view[field.dataset.meta as 'fps' | 'quality' | 'radio' | 'layout'];
    panel.querySelector('.status')!.textContent = view.status;
  }
  host.addEventListener('encore:hud-presentation', onPresentation);
  host.dispatchEvent(new Event('encore:hud-query'));
  let disposed = false;
  const binding = { dispose() { if (disposed) return; disposed = true; host.removeEventListener('encore:hud-presentation', onPresentation); panel.remove(); panels.delete(host); } };
  panels.set(host, binding); return binding;
}
