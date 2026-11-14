import { describe, expect, it } from 'vitest';
import type { MetricsSample } from '../../../src/contracts';
import { bindHud, formatMetres, formatPercent, HudModel, type HudPresentation } from '../../../src/app/ui/Hud';

function sample(tick = 5, overrides: Partial<MetricsSample> = {}): MetricsSample {
  return { tick, alive: 40, coverage: 1, pwc: 20, npwc: 1, sfMean: 0.2, sfMax: 0.5, dupSlots: 0, versions: { '0:-1': 40 }, msgs: { hb: 10, score: 0, delivered: 80, lost: 10, blocked: 10 }, collisions: 2, nearMisses: 3, slotChanges: 0, ...overrides };
}

describe('HUD sample presentation', () => {
  it('keeps unavailable values distinct from valid zero', () => {
    expect(formatPercent(null)).toBe('Unavailable'); expect(formatPercent(0)).toBe('0.0%');
    expect(formatMetres(null)).toBe('Unavailable'); expect(formatMetres(0)).toBe('0.00 m');
    const model = new HudModel(); const empty = sample(5, { alive: 0, coverage: 0, pwc: 0, npwc: null, sfMean: null, sfMax: null, versions: {} });
    model.update({ encore: empty, static: empty }); const view = model.present();
    expect(view.encore?.npwc).toBe('Unavailable'); expect(view.encore?.npwcNote).toBe('No live drones');
    expect(view.encore?.coverage).toBe('0.0%'); expect(view.encore?.fidelity).toBe('Unavailable mean / Unavailable max');
    expect(view.encore?.alive).toBe('0 / ?');
  });
  it('starts waiting without invented FPS, roster, layout or hold state', () => {
    const model = new HudModel(); expect(model.present().encore).toBeNull(); expect(model.present().fps).toBe('FPS not measured');
    model.update({ encore: sample(), static: sample() }); expect(model.present().encore?.alive).toBe('40 / ?');
    expect(model.present().encore?.transitioning).toBeNull(); expect(model.present().layout).toBe('View layout not reported');
    expect(model.present().encore?.label).toContain('brain not reported');
  });
  it('derives message rates only from actual simulation tick/counter deltas', () => {
    const model = new HudModel(); model.update({ encore: sample(), static: sample(), fps: 120 });
    expect(model.present().encore?.messages).toBe('Waiting for rate sample');
    const next = sample(10, { msgs: { hb: 12, score: 1, delivered: 100, lost: 15, blocked: 10 } });
    model.update({ encore: next, static: next, fps: 10 });
    expect(model.present().encore?.messages).toBe('12.0 broadcasts / sim s');
    expect(model.present().encore?.delivered).toBe('80.0% delivered (cumulative)');
    model.update({ encore: next, static: next, fps: 60 }); expect(model.present().encore?.messages).toBe('12.0 broadcasts / sim s');
  });
  it('retains both arm values in either single-view fallback and labels reported brain kinds', () => {
    const model = new HudModel(); const encore = sample(5, { npwc: 0.9 }); const baseline = sample(5, { npwc: 0.6 });
    for (const layout of ['split', 'encore', 'static'] as const) {
      model.update({ encore, static: baseline, rosterSize: 200, layout, inHold: { encore: false }, brainKinds: { encore: 'static', static: 'static' } });
      const view = model.present(); expect(view.encore?.npwc).toBe('90.0%'); expect(view.static?.npwc).toBe('60.0%');
      expect(view.encore?.alive).toBe('40 / 200'); expect(view.encore?.transitioning).toBe(true); expect(view.static?.transitioning).toBeNull();
      expect(view.encore?.label).toContain('static brain');
    }
  });
  it('copies samples and resets rates on backward ticks or counter resets', () => {
    const model = new HudModel(); const first = sample(); model.update({ encore: first, static: first });
    first.npwc = 0; expect(model.present().encore?.npwc).toBe('100.0%');
    model.update({ encore: sample(10), static: sample(10) });
    model.update({ encore: sample(0), static: sample(0) }); expect(model.present().encore?.messages).toBe('Waiting for rate sample');
    model.update({ encore: sample(5), static: sample(5) });
    const reset = sample(5, { msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 } });
    model.update({ encore: reset, static: reset }); expect(model.present().encore?.messages).toBe('Waiting for rate sample');
  });
  it('reports tick mismatch and no transmission candidates without pretending synchrony or 0% delivery', () => {
    const model = new HudModel(); const quiet = sample(10, { msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 } });
    model.update({ encore: sample(5), static: quiet }); expect(model.present().status).toBe('Samples are from different ticks');
    expect(model.present().static?.delivered).toBe('No transmission candidates');
  });
});

describe('HUD explicit binding', () => {
  it('publishes at most four times per second and flushes the latest pending sample', () => {
    const host = new EventTarget() as HTMLElement; const received: HudPresentation[] = [];
    host.addEventListener('encore:hud-presentation', event => received.push((event as CustomEvent<HudPresentation>).detail));
    let now = 0; let callback: (() => void) | undefined; let schedules = 0;
    const timing = { now: () => now, schedule(fn: () => void) { callback = fn; return ++schedules; }, cancel() { callback = undefined; } };
    const binding = bindHud(host, timing); binding.update({ encore: sample(5), static: sample(5) }); expect(received).toHaveLength(1);
    now = 100; binding.update({ encore: sample(10), static: sample(10) });
    now = 200; binding.update({ encore: sample(15), static: sample(15) }); expect(received).toHaveLength(1); expect(schedules).toBe(1);
    now = 250; callback!(); expect(received).toHaveLength(2); expect(received[1].encore?.tick).toBe('15'); binding.dispose();
  });
  it('reuses one binder per host and cleans pending work/listeners idempotently', () => {
    const host = new EventTarget() as HTMLElement; let now = 0; let cancelled = 0;
    const timing = { now: () => now, schedule() { return 1; }, cancel() { cancelled++; } };
    const binding = bindHud(host, timing); expect(bindHud(host, timing)).toBe(binding);
    binding.update({ encore: sample(5), static: sample(5) }); now = 100; binding.update({ encore: sample(10), static: sample(10) });
    binding.dispose(); binding.dispose(); expect(cancelled).toBe(1);
    let events = 0; host.addEventListener('encore:hud-presentation', () => events++);
    host.dispatchEvent(new Event('encore:hud-query')); binding.update({ encore: sample(), static: sample() }); expect(events).toBe(0);
    const fresh = bindHud(host, timing); expect(fresh).not.toBe(binding); fresh.dispose();
  });
});
