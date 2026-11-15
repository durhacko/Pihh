// tests/app/ui/shell.test.ts
// The #92 shell's decision logic, headless: readout and legend models (observer data only), the Disrupt
// popover's choices and their intents reaching both worlds through the one action API, keyboard scrolling of
// the Metrics popover, the Escape order with the shell's deselect, and that the new modules load without a DOM.
import { describe, expect, it } from 'vitest';
import type { MetricsSample } from '../../../src/contracts';
import { createActionController } from '../../../src/app/actions';
import { legendItems } from '../../../src/app/ui/Legend';
import { disruptActions, scrollByKey, type DisruptRun } from '../../../src/app/ui/popovers';
import { readoutItems } from '../../../src/app/ui/Readout';
import { defaultUIState, Store } from '../../../src/app/ui/store';
import { handleEscape, Surfaces, type SurfaceEnv } from '../../../src/app/ui/surfaces';
import { ARMS, controlContext, createWorlds } from '../../../src/app/worlds';

function sample(tick: number, overrides: Partial<MetricsSample> = {}): MetricsSample {
  return { tick, alive: 200, coverage: 1, pwc: 1, npwc: 0.98765, sfMean: 0.2, sfMax: 0.5, dupSlots: 0, versions: { '0:-1': 200 }, msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0, ...overrides };
}

describe('readout', () => {
  const base = { n0: 200, phase: { inHold: true, name: '“ENCORE”' }, fps: 59.6, stopped: null };
  it('shows only observer numbers: nPWC and alive of the shown arm, both arms in split', () => {
    const samples = { encore: sample(5, { npwc: 0.91234, alive: 188 }), static: sample(5, { npwc: 0.5, alive: 188 }) };
    const single = readoutItems({ ...base, samples, view: 'encore' });
    expect(single.find(i => i.key === 'npwc')!.value).toBe('0.912');
    expect(single.find(i => i.key === 'alive')!.value).toBe('188');
    const split = readoutItems({ ...base, samples, view: 'split' });
    expect(split.find(i => i.key === 'npwc')).toMatchObject({ label: 'nPWC E / S', value: '0.912 / 0.500' });
    expect(split.find(i => i.key === 'alive')!.value).toBe('188 / 188');
    expect(readoutItems({ ...base, samples, view: 'static' }).find(i => i.key === 'npwc')!.value).toBe('0.500');
    expect(single.find(i => i.key === 'fps')!.value).toBe('60 fps');
    expect(single.find(i => i.key === 'phase')).toMatchObject({ label: 'Hold', value: '“ENCORE”' });
  });
  it('keeps missing values missing (never 0), greys nPWC in transition, and flags a stopped loop', () => {
    const items = readoutItems({ ...base, samples: { encore: null, static: null }, view: 'split', phase: { inHold: false, name: 'Sphere' }, fps: null, stopped: 'boom' });
    expect(items.find(i => i.key === 'npwc')).toMatchObject({ value: '— / —', muted: true });
    expect(items.find(i => i.key === 'alive')!.value).toBe('— / —');
    expect(items.find(i => i.key === 'fps')!.value).toBe('— fps');
    expect(items.find(i => i.key === 'stopped')).toMatchObject({ value: 'press R', title: 'boom' });
    expect(readoutItems({ ...base, samples: { encore: sample(5, { npwc: null }), static: null }, view: 'encore' }).find(i => i.key === 'npwc')!.value).toBe('—');
  });
});

describe('legend', () => {
  const off = { xray: false, belief: false, versions: { '0:-1': 200 }, radio: { drawn: 3, observed: 120 }, deaf: 0, partitions: 0, ghosts: null };
  it('ghost slots show the observer slot-status counts by ring shape', () => {
    const items = legendItems({ ...off, ghosts: { vacant: 5, inTransit: 2, contested: 1, inHold: true } });
    expect(items[0]).toEqual({ kind: 'title', text: 'Slots · observer truth' });
    expect(items.filter(i => i.kind === 'ring').map(i => (i.kind === 'ring' ? [i.text, i.count] : null))).toEqual([['In transit (thin ring)', 2], ['Vacant (thick ring)', 5], ['Contested (double ring)', 1]]);
  });
  it('appears only while something needs a key', () => {
    expect(legendItems(off)).toEqual([]);
    expect(legendItems({ ...off, partitions: 1 })).toEqual([]);   // the partition plane is drawn only with X-ray
  });
  it('X-ray carries the radio key and the honest counter from the radio layer', () => {
    const items = legendItems({ ...off, xray: true, partitions: 1 });
    expect(items).toContainEqual({ kind: 'honest', text: 'radio drawn 3 / 120 logged · last 1 s' });
    expect(items.some(i => i.kind === 'line' && i.text.startsWith('Partition'))).toBe(true);
    expect(legendItems({ ...off, xray: true, radio: null })).toContainEqual({ kind: 'honest', text: 'radio: nothing logged yet' });
  });
  it('belief colours list the observer version counts; deaf rings are counted from the snapshot', () => {
    const items = legendItems({ ...off, belief: true, versions: { '0:-1': 150, '300:42': 50 }, deaf: 4 });
    expect(items.filter(i => i.kind === 'ring').map(i => [i.text, i.kind === 'ring' ? i.count : null])).toEqual([['v0:-1 preloaded', 150], ['v300:42', 50], ['Deaf: heard no radio for 2 s', 4]]);
    expect(legendItems({ ...off, belief: true, versions: null })).toContainEqual({ kind: 'honest', text: 'Waiting for the first observer sample' });
  });
});

describe('disrupt popover', () => {
  const settings = { regionRadius: 8, jamRadius: 12 };
  const idle = { selectedId: null, selectedAlive: false, jamActive: false, partitioned: false };
  it('offers region kill and jam as picks, the rest as intents; kill-selected needs a live selection', () => {
    const a = disruptActions(idle, settings);
    expect(a.map(x => x.id)).toEqual(['kill-region', 'kill-selected', 'kill-random', 'jam', 'partition']);
    expect(a.find(x => x.id === 'kill-region')!.run).toEqual({ kind: 'pick', purpose: 'killRegion', radius: 8 });
    expect(a.find(x => x.id === 'jam')!.run).toEqual({ kind: 'pick', purpose: 'jam', radius: 12 });
    expect(a.find(x => x.id === 'kill-selected')!.disabled).toBe(true);
    const live = disruptActions({ ...idle, selectedId: 42, selectedAlive: true, jamActive: true, partitioned: true }, settings);
    expect(live.find(x => x.id === 'kill-selected')).toMatchObject({ title: 'Kill drone #42', disabled: false });
    expect(live.find(x => x.id === 'jam')).toMatchObject({ title: 'Lift jam', active: true, run: { kind: 'intent', intent: { type: 'jam' } } });
    expect(live.find(x => x.id === 'partition')).toMatchObject({ title: 'Reconnect partition', active: true });
    expect(disruptActions({ ...idle, selectedId: 42, selectedAlive: false }, settings).find(x => x.id === 'kill-selected')!.disabled).toBe(true);
  });

  it('every choice drives the same action API and reaches both worlds', () => {
    const worlds = createWorlds({ seed: 4, n0: 60 });
    for (let t = 0; t < 40; t++) worlds.stepBoth();
    const transport = { playing: false, speed: 1 };
    const controller = createActionController(controlContext(worlds, {
      getSnapshots: () => worlds.latest()!, getTransport: () => ({ ...transport, seed: worlds.seed }),
      setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; }, reset: s => { worlds.reset(s); worlds.stepBoth(); },
    }));
    controller.handle({ type: 'select', id: 10 });
    const centre = worlds.latest()!.encore.drones[30].pos;
    /** What the popover does with a choice: a pick resolves to the clicked centre, then runs the intent. */
    const perform = (run: DisruptRun) => controller.handle(run.kind === 'intent' ? run.intent
      : run.purpose === 'killRegion' ? { type: 'kill-region', radius: run.radius, centre } : { type: 'jam', radius: run.radius, centre });
    const state = () => ({ ...idle, selectedId: 10, selectedAlive: true, jamActive: worlds.latest()!.encore.jams.length > 0, partitioned: worlds.latest()!.encore.partitions.length > 0 });
    const types: string[] = [];
    for (const id of ['kill-selected', 'kill-region', 'kill-random', 'jam', 'partition']) {
      const result = perform(disruptActions(state(), settings).find(a => a.id === id)!.run);
      expect(result.ok, `${id}: ${result.message}`).toBe(true);
      types.push(result.event!.type);
      const snaps = worlds.stepBoth();
      expect(snaps.encore.drones.map(d => d.alive)).toEqual(snaps.static.drones.map(d => d.alive));
      expect(snaps.encore.jams).toEqual(snaps.static.jams);
      expect(snaps.encore.partitions).toEqual(snaps.static.partitions);
    }
    expect(types).toEqual(['KILL', 'KILL', 'KILL', 'JAM_ON', 'PARTITION_ON']);
    expect(worlds.latest()!.encore.jams[0].centre).toEqual(centre);
    // Toggling back: lift the jam, reconnect, and set the loss.
    for (const id of ['jam', 'partition']) { perform(disruptActions(state(), settings).find(a => a.id === id)!.run); worlds.stepBoth(); }
    expect(worlds.latest()!.encore.jams).toEqual([]);
    expect(worlds.latest()!.static.partitions).toEqual([]);
    expect(controller.handle({ type: 'loss', loss: 0.25 }).event).toMatchObject({ type: 'SET_LOSS', loss: 0.25 });
    for (const arm of ARMS) expect(worlds.latest()![arm].drones.filter(d => d.alive).length).toBe(worlds.latest()!.encore.drones.filter(d => d.alive).length);
  });
});

describe('metrics popover keyboard scrolling', () => {
  const box = { scrollTop: 100, clientHeight: 300, scrollHeight: 1000 };
  it('arrow keys, page keys, Home and End scroll within bounds; other keys are not taken', () => {
    expect(scrollByKey('ArrowDown', box)).toBe(140);
    expect(scrollByKey('ArrowUp', box)).toBe(60);
    expect(scrollByKey('PageDown', box)).toBe(370);
    expect(scrollByKey('PageUp', box)).toBe(0);
    expect(scrollByKey('Home', box)).toBe(0);
    expect(scrollByKey('End', box)).toBe(700);
    expect(scrollByKey('ArrowDown', { ...box, scrollTop: 690 })).toBe(700);
    expect(scrollByKey('ArrowDown', { scrollTop: 0, clientHeight: 300, scrollHeight: 200 })).toBe(0);
    expect(scrollByKey('x', box)).toBeNull();
    expect(scrollByKey('Escape', box)).toBeNull();   // Escape still closes the popover
  });
});

describe('Escape order with the shell deselect', () => {
  it('cancel pick → show controls → close the newest popover → deselect, one step per press', () => {
    const noop = () => {};
    const env: SurfaceEnv = {
      document: { addEventListener: noop, removeEventListener: noop, contains: () => true, activeElement: null } as unknown as SurfaceEnv['document'],
      window: { addEventListener: noop, removeEventListener: noop, innerWidth: 1440, innerHeight: 900 } as unknown as SurfaceEnv['window'],
      nextFrame: fn => fn(),
    };
    const el = () => ({ hidden: false, style: {}, offsetWidth: 300, setAttribute: noop, contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) }) as unknown as HTMLElement;
    const surfaces = new Surfaces(env);
    surfaces.register({ id: 'disrupt', kind: 'popover', el: el() });
    const store = new Store(defaultUIState());
    let deselected = 0;
    let cancelled = 0;
    store.set({ selected: { id: 3, arm: 'encore' }, chromeHidden: true, pick: { purpose: 'killRegion', radius: 8, prompt: '', resolve: r => { if (r === null) cancelled++; } } });
    surfaces.open('disrupt');
    const deselect = () => { deselected++; store.set({ selected: null }); };
    expect(handleEscape(store, surfaces, deselect)).toBe('cancelPick');
    expect(cancelled).toBe(1);
    expect(handleEscape(store, surfaces, deselect)).toBe('showChrome');
    expect(handleEscape(store, surfaces, deselect)).toBe('closeSurface');
    expect(surfaces.isOpen('disrupt')).toBe(false);
    expect(handleEscape(store, surfaces, deselect)).toBe('deselect');
    expect(deselected).toBe(1);
    expect(handleEscape(store, surfaces, deselect)).toBeNull();
  });
});

describe('the new shell modules load headless and stay out of the panel loader', () => {
  it('Dock, Readout, Legend, Toasts, popovers, keys, Hud and DemoScript (its bar is opt-in) import without a DOM and export no createPanel', async () => {
    expect(typeof document).toBe('undefined');
    for (const name of ['Dock', 'Readout', 'Legend', 'Toasts', 'popovers', 'keys', 'Hud', 'DemoScript']) {
      const mod = await import(`../../../src/app/ui/${name}.ts`);
      expect(Object.keys(mod), name).not.toContain('createPanel');
    }
  });
});
