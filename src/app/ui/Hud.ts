// src/app/ui/Hud.ts
// Observer comparison: the presentation model (HudModel) and its throttled binder. The on-screen HUD panel was
// retired in #92: the readout (top right) and the Metrics popover (M) present these values now.
// Shared module: no createPanel export, so the panel loader skips it.
import { DT, type MetricsSample } from '../../contracts';

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
/** nPWC as the readout and the pane labels show it: a 0–1 fraction to 3 places (E7: Metrics showed a percentage). */
export function formatFraction(value: number | null): string { return value === null || !Number.isFinite(value) ? 'Unavailable' : value.toFixed(3); }
/** A MetricsSample.versions key "issuedTick:origin" as the inspector labels it: "v0:-1 (preloaded)", "v400:12 (uplink via #12)". */
export function versionText(key: string): string {
  const origin = key.split(':')[1];
  return origin === '-1' ? `v${key} (preloaded)` : origin !== undefined && /^\d+$/.test(origin) ? `v${key} (uplink via #${origin})` : key;
}
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
        npwc: formatFraction(sample.npwc), npwcNote: sample.npwc === null ? sample.alive === 0 ? 'No live drones' : 'Observer value unavailable' : 'Priority-weighted by our own slot order',
        transitioning: payload.inHold?.[arm] === undefined ? null : !payload.inHold[arm],
        coverage: formatPercent(sample.coverage), fidelity: `${formatMetres(sample.sfMean)} mean / ${formatMetres(sample.sfMax)} max`,
        messages: rate === null ? 'Waiting for rate sample' : `${rate.toFixed(1)} broadcasts / sim s`,
        delivered: candidates === 0 ? 'No transmission candidates' : `${formatPercent(sample.msgs.delivered / candidates)} delivered (cumulative)`,
        versions: Object.entries(sample.versions).map(([version, live]) => `${versionText(version)}: ${count(live)} live`).join(' · ') || 'No live score beliefs',
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
