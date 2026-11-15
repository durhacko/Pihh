// The readout's phase and transition state come per arm from the observer, and a mid-transition nPWC is greyed and
// labelled "in transition · measured against the new formation" (DESIGN §7). The value shown is always the
// observer's own sample: labelled, never hidden or replaced. Real worlds; the slot feed main.ts uses.
import { describe, expect, it } from 'vitest';
import { composeNext } from '../../../src/score';
import { createSlotStatusFeed } from '../../../src/app/render/layers/GhostSlotLayer';
import { armPhase, NOT_COMPARABLE_LABEL, readoutItems, TRANSITION_LABEL, TRANSITION_VALUE, type ArmPhase } from '../../../src/app/ui/Readout';
import { formatPercent, HudModel } from '../../../src/app/ui/Hud';
import { ARMS, createWorlds, hudPayload, type Pair, type Worlds } from '../../../src/app/worlds';
import { fmt } from '../../../src/app/ui/dom';

function toSample(worlds: Worlds) { do worlds.stepBoth(); while (worlds.tick % 5 !== 0); }
/** What main.ts's refreshChrome computes. A zero interval so every read reflects the current snapshot. */
function phases(worlds: Worlds, feeds: Pair<ReturnType<typeof createSlotStatusFeed>>): Pair<ArmPhase | null> {
  const snaps = worlds.latest()!;
  const samples = worlds.samples();
  return { encore: armPhase(feeds.encore.read(snaps.encore), samples.encore, worlds.scores(), worlds.tick), static: armPhase(feeds.static.read(snaps.static), samples.static, worlds.scores(), worlds.tick) };
}

describe('readout phase and transition, per arm, from the observer', () => {
  it('after an injection the Encore arm is in transition on the new formation while the static arm holds', () => {
    const worlds = createWorlds({ seed: 101, n0: 40 });
    const feeds = { encore: createSlotStatusFeed(() => worlds.observers.encore, { intervalMs: 0 }), static: createSlotStatusFeed(() => worlds.observers.static, { intervalMs: 0 }) };
    while (worlds.tick < worlds.score.movements[0].transitionTicks + 40) toSample(worlds);
    expect(phases(worlds, feeds)).toEqual({ encore: { inHold: true, name: '“ENCORE”' }, static: { inHold: true, name: '“ENCORE”' } });

    const tick = worlds.tick + 1;
    worlds.scheduleBoth({ type: 'INJECT_SCORE', tick, droneId: 0, score: composeNext(worlds.score, tick, { kind: 'helix' }, 0, 40, worlds.params) });
    while (worlds.tick < tick + worlds.params.scoreLead + 10) toSample(worlds);
    const p = phases(worlds, feeds);
    // The old code read the preloaded score's plan for both: "Hold · ENCORE" while Encore flies the helix.
    expect(p).toEqual({ encore: { inHold: false, name: 'Double helix' }, static: { inHold: true, name: '“ENCORE”' } });
    // inHold is the observer's own, for each arm.
    for (const arm of ARMS) expect(p[arm]!.inHold).toBe(worlds.observers[arm].slotStatus(worlds.latest()![arm]).inHold);

    const samples = worlds.samples();
    const split = readoutItems({ samples, view: 'split', n0: 40, phases: p, fps: 30, stopped: null });
    const npwc = split.find(item => item.key === 'npwc')!;
    // The displayed values ARE the observer samples; only the Encore one is greyed.
    expect(npwc.parts).toEqual([{ value: fmt(samples.encore!.npwc, 3), muted: true }, { value: fmt(samples.static!.npwc, 3), muted: false }]);
    expect(npwc.value).toBe(`${fmt(samples.encore!.npwc, 3)} / ${fmt(samples.static!.npwc, 3)}`);
    expect(split.find(item => item.key === 'transition')).toMatchObject({ label: TRANSITION_LABEL, value: `E · ${TRANSITION_VALUE}` });
    expect(split.find(item => item.key === 'phase')!.value).toBe('E Transition · Double helix / S Hold · “ENCORE”');

    const single = readoutItems({ samples, view: 'encore', n0: 40, phases: p, fps: 30, stopped: null });
    expect(single.find(item => item.key === 'npwc')).toMatchObject({ value: fmt(samples.encore!.npwc, 3), muted: true });
    expect(single.find(item => item.key === 'transition')!.value).toBe(TRANSITION_VALUE);
    expect(single.find(item => item.key === 'phase')).toMatchObject({ label: 'Transition', value: 'Double helix' });
    // The static view holds: nothing greyed, no transition label.
    const staticView = readoutItems({ samples, view: 'static', n0: 40, phases: p, fps: 30, stopped: null });
    expect(staticView.find(item => item.key === 'npwc')).toMatchObject({ value: fmt(samples.static!.npwc, 3), muted: false });
    expect(staticView.some(item => item.key === 'transition')).toBe(false);

    // Judge red team #134: the split pair compares two arms scored on DIFFERENT formations. It must say so.
    expect(split.find(item => item.key === 'comparable')).toMatchObject({ label: NOT_COMPARABLE_LABEL, value: 'different formations: E Double helix / S “ENCORE”' });
    // Only one arm is shown in a single view: there is no pair to compare.
    expect(single.some(item => item.key === 'comparable')).toBe(false);

    // The Metrics popover's HUD model gets the same per-arm inHold through hudPayload, so its transition note shows.
    const model = new HudModel();
    model.update(hudPayload(worlds, { fps: 30, layout: 'split', inHold: { encore: p.encore!.inHold, static: p.static!.inHold } }));
    const shown = model.present();
    expect(shown.encore!.transitioning).toBe(true);
    expect(shown.static!.transitioning).toBe(false);
    expect(shown.encore!.npwc).toBe(formatPercent(samples.encore!.npwc));   // the observer's value, unchanged
  });

  it('the pair is comparable again once both arms fly the same formation, and while they always did', () => {
    const same = { encore: { inHold: true, name: 'Sphere' }, static: { inHold: true, name: 'Sphere' } };
    const items = readoutItems({ samples: { encore: null, static: null }, view: 'split', n0: 200, phases: same, fps: null, stopped: null });
    expect(items.some(item => item.key === 'comparable')).toBe(false);
    // An arm without a reading yet is not called different.
    const half = readoutItems({ samples: { encore: null, static: null }, view: 'split', n0: 200, phases: { encore: same.encore, static: null }, fps: null, stopped: null });
    expect(half.some(item => item.key === 'comparable')).toBe(false);
    // hudPayload without inHold reports none (older callers): the HUD model shows no transition state.
    const worlds = createWorlds({ seed: 3, n0: 30 });
    toSample(worlds);
    expect('inHold' in hudPayload(worlds, { fps: null, layout: 'split' })).toBe(false);
    expect(hudPayload(worlds, { fps: null, layout: 'split', inHold: { encore: null, static: true } }).inHold).toEqual({ encore: undefined, static: true });
  });

  it('marks an arm in transition whenever the observer says it is not in hold, and only then', () => {
    const samples = { encore: null, static: null };
    const hold = readoutItems({ samples, view: 'split', n0: 200, phases: { encore: { inHold: true, name: 'Sphere' }, static: { inHold: true, name: 'Sphere' } }, fps: null, stopped: null });
    expect(hold.find(item => item.key === 'npwc')!.parts!.every(part => !part.muted)).toBe(true);
    expect(hold.some(item => item.key === 'transition')).toBe(false);
    expect(hold.find(item => item.key === 'phase')).toMatchObject({ label: 'Hold', value: 'Sphere' });
    const bothMoving = readoutItems({ samples, view: 'split', n0: 200, phases: { encore: { inHold: false, name: 'Sphere' }, static: { inHold: false, name: 'Sphere' } }, fps: null, stopped: null });
    expect(bothMoving.find(item => item.key === 'npwc')!.parts!.every(part => part.muted)).toBe(true);
    expect(bothMoving.find(item => item.key === 'transition')!.value).toBe(`E + S · ${TRANSITION_VALUE}`);
    // No reading yet: no phase, nothing greyed; a missing sample still shows "—", never 0.
    const none = readoutItems({ samples, view: 'encore', n0: 200, phases: { encore: null, static: null }, fps: null, stopped: null });
    expect(none.find(item => item.key === 'npwc')).toMatchObject({ value: '—', muted: false });
    expect(none.some(item => item.key === 'phase' || item.key === 'transition')).toBe(false);
  });

  it('armPhase falls back to the preloaded score when no live drone believes a registered one, and needs a reading', () => {
    const worlds = createWorlds({ seed: 3, n0: 30 });
    toSample(worlds);
    expect(armPhase(null, worlds.samples().encore, worlds.scores(), worlds.tick)).toBeNull();
    expect(armPhase({ inHold: false }, null, worlds.scores(), worlds.tick)).toEqual({ inHold: false, name: '“ENCORE”' });
    worlds.reset();
    expect(worlds.scores()).toHaveLength(1);   // a reset forgets injected scores along with the observers
  });
});
