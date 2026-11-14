// tests/app/ui/timeline.test.ts
// The Show timeline from real inputs: a real makeScore plan with a real composeNext injection, the action
// controller's real event log, and real observer series from two stepped worlds. DOM via tests/app/ui/fakeDom.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { EnvEvent, MetricsSample } from '../../../src/contracts';
import { currentMovement } from '../../../src/score';
import { createActionController } from '../../../src/app/actions';
import { controlContext, createWorlds, type WorldsOptions } from '../../../src/app/worlds';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import * as timelineModule from '../../../src/app/ui/Timeline';
import { connectTimeline, cueStatus, eventLane, holdColumns, planCues, windowEnd, type Cue, type TimelineContext } from '../../../src/app/ui/Timeline';
import { FakeDocument, type FakeContext2D, type FakeElement } from './fakeDom';

/** Two real worlds (40 drones) and the real action controller, driven like the app does. */
function rig(brains?: WorldsOptions['brains']) {
  const worlds = createWorlds({ seed: 101, n0: 40, brains });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1, seed: 101 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? (() => { throw new Error('no snapshot'); })(),
    getTransport: () => ({ ...transport }), setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: seed => { worlds.reset(seed); worlds.stepBoth(); },
  }));
  const steps = (n: number) => { for (let i = 0; i < n; i++) worlds.stepBoth(); };
  const must = (intent: Parameters<typeof controller.handle>[0]) => {
    const result = controller.handle(intent);
    if (!result.ok) throw new Error(result.message);
    return result;
  };
  const ctx: TimelineContext = { getScore: () => worlds.score, getEvents: () => controller.getEventLog(), getSeries: () => worlds.series(), getTick: () => worlds.tick };
  return { worlds, controller, steps, must, ctx };
}

/** kill, jam on/off, loss, an open partition and one injection, with samples on both sides. */
function scenario() {
  const r = rig();
  r.steps(29);                                                   // tick 30
  r.must({ type: 'select', id: 3 }); r.must({ type: 'kill-selected' });
  r.must({ type: 'select', id: 4 }); r.must({ type: 'jam', radius: 6 });
  r.must({ type: 'loss', loss: 0.2 });
  r.steps(20);                                                   // tick 50
  r.must({ type: 'jam' });                                       // JAM_OFF
  r.must({ type: 'partition' });                                 // PARTITION_ON, left open
  const inject = r.must({ type: 'inject', recipe: { kind: 'helix', palette: [[1, 0, 0], [0, 0, 1]] } });
  r.steps(70);                                                   // tick 120
  return { ...r, inject: inject.event as Extract<EnvEvent, { type: 'INJECT_SCORE' }> };
}

describe('plan lane', () => {
  it('lists the preloaded movements as cues, chained end to start', () => {
    const { worlds } = rig();
    const cues = planCues(worlds.score, []);
    expect(cues.map(c => [c.name, c.source, c.startTick, c.transitionTicks])).toEqual(worlds.score.movements.map(m => [m.recipe.kind === 'text' ? m.recipe.text : m.recipe.kind === 'sphere' ? 'Sphere' : 'Helix', 'preloaded', m.startTick, m.transitionTicks]));
    expect(cues.map(c => c.endTick)).toEqual([...worlds.score.movements.slice(1).map(m => m.startTick), null]);
    expect(cues[0]?.versionKey).toBe('0:-1');
  });

  it('adds an injected composeNext movement and drops the planned movements it supersedes', () => {
    const { worlds, controller, inject } = scenario();
    const issued = inject.score.version.issuedTick;
    const cues = planCues(worlds.score, controller.getEventLog());
    const kept = worlds.score.movements.filter(m => m.startTick <= issued);
    expect(cues).toHaveLength(kept.length + 1);
    const added = cues[cues.length - 1]!;
    const movement = inject.score.movements[1]!;
    expect(added).toMatchObject({ name: 'Helix', source: 'injected', versionKey: `${issued}:${inject.droneId}`, droneId: inject.droneId, startTick: movement.startTick, transitionTicks: movement.transitionTicks, endTick: null, palette: [[1, 0, 0], [0, 0, 1]] });
    expect(added.startTick).toBe(issued + worlds.params.scoreLead);
    expect(cues[cues.length - 2]?.endTick).toBe(added.startTick);
    for (const dropped of worlds.score.movements.filter(m => m.startTick > issued)) expect(cues.some(c => c.source === 'preloaded' && c.startTick === dropped.startTick)).toBe(false);
  });

  it('a later injection supersedes an earlier injected cue that has not started', () => {
    const r = rig();
    r.steps(10);
    r.must({ type: 'select', id: 2 });
    r.must({ type: 'inject', recipe: { kind: 'sphere' } });
    r.steps(5);
    r.must({ type: 'inject', recipe: { kind: 'text', text: 'HI' } });
    const cues = planCues(r.worlds.score, r.controller.getEventLog());
    expect(cues.filter(c => c.source === 'injected').map(c => c.name)).toEqual(['HI']);
  });

  it('gives each cue a status from the tick', () => {
    const cue = { key: 'k', name: 'X', source: 'preloaded' as const, versionKey: '0:-1', startTick: 100, transitionTicks: 50, endTick: 300, palette: null, droneId: null };
    expect([99, 100, 149, 150, 299, 300].map(t => cueStatus(cue, t))).toEqual(['upcoming', 'in transition', 'in transition', 'holding', 'holding', 'done']);
    expect(cueStatus({ ...cue, endTick: null }, 10_000)).toBe('holding');
  });
});

describe('events lane', () => {
  it('shows every scheduled event from the real log, with applied versus scheduled', () => {
    const { controller, worlds, inject } = scenario();
    const log = controller.getEventLog();
    const { marks, bands } = eventLane(log, worlds.tick);
    expect(marks.map(m => m.kind)).toEqual(['kill', 'loss', 'inject']);
    expect(marks[0]).toMatchObject({ tick: 31, scheduled: false, label: 'KILL 1 drone at 00:01.6' });
    expect(marks[2]?.label).toBe(`INJECT_SCORE v${inject.score.version.issuedTick}:${inject.droneId} into drone ${inject.droneId} at 00:02.6`);
    expect(bands).toEqual([
      { key: 'jam:operator-jam@31', kind: 'jam', id: 'operator-jam', start: 31, end: 51, scheduled: false, label: 'Jam operator-jam: on at 00:01.6, off at 00:02.6' },
      { key: 'partition:operator-partition@51', kind: 'partition', id: 'operator-partition', start: 51, end: null, scheduled: false, label: 'Partition operator-partition: on at 00:02.6, still on' },
    ]);
    // the same log read before those ticks: everything is scheduled, nothing applied
    const early = eventLane(log, 30);
    expect([...early.marks, ...early.bands].every(x => x.scheduled)).toBe(true);
    expect(early.marks[0]?.label).toBe('KILL 1 drone scheduled for 00:01.6');
  });

  it('widens the window to include the last event and the last cue', () => {
    expect(windowEnd([], [{ type: 'KILL', tick: 5000, ids: [1] }], 0)).toBe(5100);
    expect(windowEnd([], [], 100)).toBe(700);
  });
});

describe('holds lanes', () => {
  it('are built only from the observer series of each world', () => {
    const { worlds, controller, inject } = scenario();
    const injectedKey = `${inject.score.version.issuedTick}:${inject.droneId}`;
    for (const arm of ['encore', 'static'] as const) {
      const series = worlds.series()[arm];
      const columns = holdColumns(series, worlds.score, controller.getEventLog());
      expect(series.length).toBeGreaterThan(20);
      expect(columns.map(c => c.tick)).toEqual(series.map(s => s.tick));
      expect(columns.map(c => c.npwc)).toEqual(series.map(s => s.npwc));
      columns.forEach((c, i) => {
        const s = series[i] as MetricsSample;
        expect(c.shares.reduce((n, x) => n + x.count, 0)).toBe(Object.values(s.versions).reduce((n, x) => n + x, 0));
        expect(c.alive).toBe(s.alive);
        // The reference is the newest score some live drone believes: the injected one once anyone adopted it.
        const reference = (s.versions[injectedKey] ?? 0) > 0 ? inject.score : worlds.score;
        expect(c.phase).toBe(currentMovement(reference, s.tick).inHold ? 'hold' : 'transition');
      });
    }
    // The static brain never adopts an injection, so the static lane always follows the preloaded score.
    expect(worlds.series().static.every(s => !(injectedKey in s.versions))).toBe(true);
  });

  it('with the real Encore brain, an injection is planned and scheduled but held only where samples measure it', () => {
    // At this commit the Encore brain's score adoption is a stub for #21, so no drone adopts yet. The plan and
    // events lanes still show the injection; the holds lanes show exactly the measured versions, nothing assumed.
    const r = rig({ encore: encoreBrain });
    r.steps(40);
    r.must({ type: 'select', id: 5 });
    const event = r.must({ type: 'inject', recipe: { kind: 'sphere' } }).event as Extract<EnvEvent, { type: 'INJECT_SCORE' }>;
    r.steps(120);
    const key = `${event.score.version.issuedTick}:${event.droneId}`;
    const log = r.controller.getEventLog();
    expect(planCues(r.worlds.score, log).at(-1)).toMatchObject({ source: 'injected', versionKey: key });
    expect(eventLane(log, r.worlds.tick).marks).toMatchObject([{ kind: 'inject', scheduled: false }]);
    for (const arm of ['encore', 'static'] as const) {
      const series = r.worlds.series()[arm];
      holdColumns(series, r.worlds.score, log).forEach((column, i) => {
        expect(column.shares.find(s => s.key === key)?.count).toBe((series[i] as MetricsSample).versions[key] || undefined);
      });
    }
    expect(r.worlds.series().static.every(s => !(key in s.versions))).toBe(true);   // static never adopts
  });

  it('switch the reference to the newest version at least one live drone holds (observer rule)', () => {
    const { worlds, controller, inject } = scenario();
    const injectedKey = `${inject.score.version.issuedTick}:${inject.droneId}`;
    const real = worlds.series().encore.at(-1) as MetricsSample;
    const adopted: MetricsSample = { ...real, tick: inject.score.movements[1]!.startTick + 1, versions: { '0:-1': real.alive - 1, [injectedKey]: 1 } };
    const [column] = holdColumns([adopted], worlds.score, controller.getEventLog());
    expect(column?.phase).toBe('transition');      // the injected movement has just started
    expect(column?.shares.map(s => s.key)).toEqual(['0:-1', injectedKey]);
    const none: MetricsSample = { ...real, alive: 0, npwc: null, versions: {} };
    expect(holdColumns([none], worlds.score, [])[0]).toMatchObject({ phase: null, npwc: null, shares: [] });
  });
});

describe('the tray DOM', () => {
  function mount(ctx: TimelineContext) {
    const doc = new FakeDocument();
    const handle = connectTimeline(ctx, { document: doc as unknown as Document });
    const root = handle.el as unknown as FakeElement;
    doc.body.append(root);
    const cues = () => root.findAll('cue');
    return { doc, handle, root, cues };
  }

  it('renders one button per cue, event marks and bands, two holds canvases and a playhead', () => {
    const s = scenario();
    const { root, cues } = mount(s.ctx);
    const plan = planCues(s.worlds.score, s.controller.getEventLog());
    expect(cues()).toHaveLength(plan.length);
    cues().forEach((button, i) => expect(button.getAttribute('aria-label')).toMatch(new RegExp(`^Cue ${i + 1}: ${plan[i]!.name}, ${plan[i]!.source}, starts \\d\\d:\\d\\d\\.\\d, planned (upcoming|in transition|holding|done); held by \\d+/\\d+ Encore, \\d+/\\d+ static$`)));
    expect(root.findAll('ev').every(e => e.getAttribute('role') === 'listitem' && (e.getAttribute('aria-label') ?? '').length > 0)).toBe(true);
    expect(root.findAll('ev').map(e => e.getAttribute('data-state'))).toEqual(['applied', 'applied', 'applied']);
    expect(root.findAll('band').map(b => b.className)).toEqual(['band jam', 'band part']);
    expect(root.findAll('band')[1]?.style.borderRightStyle).toBe('dashed');
    expect(root.findTag('canvas')).toHaveLength(2);
    expect(root.findAll('playhead')[0]?.style.left).toMatch(/^calc\(92px \+ \(100% - 106px\) \* 0\.\d+\)$/);
    expect(root.findAll('injected')).toHaveLength(1);
  });

  it('draws the holds from samples and labels the canvas with the latest sample', () => {
    const s = scenario();
    const { root } = mount(s.ctx);
    const [encore] = root.findTag('canvas');
    const last = s.worlds.series().encore.at(-1) as MetricsSample;
    expect(encore?.getAttribute('aria-label')).toContain(`nPWC ${last.npwc === null ? 'none' : last.npwc.toFixed(2)}`);
    expect(encore?.getAttribute('aria-label')).toContain(`${s.worlds.series().encore.length} observer samples`);
    const g = encore?.getContext('2d') as unknown as FakeContext2D;
    const series = s.worlds.series().encore;
    expect(g.calls.filter(c => c.startsWith('stroke')).length).toBe(series.filter(x => x.npwc !== null).length - 1);
    // One known column, checked against its sample: x from its tick, bar height from its version share.
    const end = windowEnd(planCues(s.worlds.score, s.controller.getEventLog()), s.controller.getEventLog(), s.worlds.tick);
    const sample = series[10] as MetricsSample;
    const x = Math.floor((sample.tick / end) * 1000);
    const bars = g.rects.filter(r => r.style.startsWith('#') && r.x === x);
    expect(bars).toHaveLength(Object.values(sample.versions).filter(n => n > 0).length);
    expect(bars[0]!.h).toBeCloseTo(((sample.versions['0:-1'] ?? 0) / sample.alive) * 40, 6);
    expect(bars[0]!.y + bars[0]!.h).toBe(44);   // stacked from the bottom
  });

  it('redraws after a reset even when the new run reaches the same tick and sample count (no stale run)', () => {
    const r = rig();
    r.steps(29);
    r.must({ type: 'kill-random' }); r.must({ type: 'kill-random' }); r.must({ type: 'kill-random' });
    r.steps(170);                                                       // tick 200
    const { root, handle } = mount(r.ctx);
    const canvas = root.findTag('canvas')[0] as FakeElement;
    const before = canvas.getAttribute('aria-label');
    const g = canvas.getContext('2d') as unknown as FakeContext2D;
    const draws = g.calls.filter(c => c.startsWith('clearRect')).length;
    r.must({ type: 'reset', seed: 999 });                               // tray "closed": no update in between
    r.steps(199);                                                       // tick 200 again, same sample count
    handle.update();
    expect(g.calls.filter(c => c.startsWith('clearRect')).length).toBe(draws + 1);
    const last = r.worlds.series().encore.at(-1) as MetricsSample;
    expect(canvas.getAttribute('aria-label')).toContain(`versions held v0:-1 ${last.alive}`);
    expect(canvas.getAttribute('aria-label')).not.toBe(before);
  });

  it('keeps the focused cue element, and its focus, across updates, new events and a new injected cue', () => {
    const s = scenario();
    const { doc, handle, cues } = mount(s.ctx);
    const target = cues()[0] as FakeElement;
    target.focus();
    expect(doc.activeElement).toBe(target);
    for (let i = 0; i < 12; i++) { s.steps(5); handle.update(); }       // 3 s of 4 Hz refreshes
    s.must({ type: 'select', id: 8 }); s.must({ type: 'kill-selected' });
    s.must({ type: 'select', id: 9 }); s.must({ type: 'inject', recipe: { kind: 'sphere' } });
    s.steps(5); handle.update();
    expect(cues()[0]).toBe(target);
    expect(doc.activeElement).toBe(target);
    expect(doc.detachments.get(target)).toBeUndefined();
    expect(doc.blurredByDetach).toEqual([]);
    // the helix had already started when the sphere was issued, so both injected cues stay in the plan
    expect(cues().filter(c => c.className.includes('injected'))).toHaveLength(2);
  });

  it('reuses event and axis elements instead of rebuilding them', () => {
    const s = scenario();
    const { root, handle } = mount(s.ctx);
    const before = [...root.findAll('ev'), ...root.findAll('band'), ...root.findAll('axis')[0]!.children];
    s.steps(5); handle.update(); handle.update();
    const after = [...root.findAll('ev'), ...root.findAll('band'), ...root.findAll('axis')[0]!.children];
    expect(after).toEqual(before);
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
  });

  it('shows cue detail on focus, toggles it on click, and moves with the arrow keys', () => {
    const s = scenario();
    const { root, cues, doc } = mount(s.ctx);
    const detail = root.findAll('cue-detail')[0] as FakeElement;
    expect(detail.textContent).toMatch(/Focus a cue/);
    const plan = planCues(s.worlds.score, s.controller.getEventLog());
    const [first, second] = cues() as [FakeElement, FakeElement];
    first.focus();
    expect(detail.textContent).toMatch(/^ENCOREpreloadedstarts 00:00\.0transition/);
    first.dispatch('keydown', { key: 'ArrowRight' });
    expect(doc.activeElement).toBe(second);
    expect(detail.textContent.startsWith(plan[1]!.name)).toBe(true);
    const last = cues().at(-1) as FakeElement;
    second.dispatch('keydown', { key: 'End' });
    expect(doc.activeElement).toBe(last);
    expect(detail.textContent).toMatch(/^Helixinjected · v\d+:\d+ into drone \d+/);
    expect(detail.textContent).toMatch(/held by 0\/\d+ Encore, 0\/\d+ static/);   // both arms fly the static brain here
    first.click();                                     // a click focuses the button, so the detail follows it
    expect(doc.activeElement).toBe(first);
    expect(detail.textContent).toMatch(/^ENCORE/);
    expect(first.hasAttribute('aria-pressed')).toBe(false);
  });

  it('a cue replaced during its own transition is done, not "in transition", and its hold is never negative', () => {
    const r = rig();
    r.steps(29);
    r.must({ type: 'select', id: 4 });
    r.must({ type: 'inject', recipe: { kind: 'sphere' } });             // INJECT at 31, new movement at 91
    const cues = planCues(r.worlds.score, r.controller.getEventLog());
    const [encore, sphere] = cues as [Cue, Cue];
    expect(encore.endTick).toBe(sphere.startTick);
    expect(encore.endTick).toBeLessThan(encore.startTick + encore.transitionTicks);
    expect([100, 150].map(t => [cueStatus(encore, t), cueStatus(sphere, t)])).toEqual([['done', 'in transition'], ['done', 'in transition']]);
    r.steps(80);
    const { root, cues: buttons } = mount(r.ctx);
    (buttons()[0] as FakeElement).focus();
    const detail = root.findAll('cue-detail')[0]!.textContent;
    expect(detail).toMatch(/replaced \d+\.\d s before its transition ended/);
    expect(detail).not.toMatch(/hold -/);
    expect(buttons()[0]!.className).toBe('cue');                     // not "now"
  });

  it('marks a cue as now only when some world measures drones holding its version', () => {
    const s = scenario();                                               // helix injected; static brains never adopt it
    const { cues } = mount(s.ctx);
    const helix = cues().at(-1) as FakeElement;
    expect(helix.getAttribute('aria-label')).toMatch(/planned (in transition|holding); held by 0\/\d+ Encore, 0\/\d+ static$/);
    expect(helix.className).toBe('cue injected');
    expect(cues()[0]!.getAttribute('aria-label')).toMatch(/held by \d+\/\d+ Encore/);
  });

  it('moves focus to the cue in its place when the focused cue is superseded, instead of dropping it on <body>', () => {
    const r = rig();
    r.steps(10);
    const { doc, handle, cues } = mount(r.ctx);
    const doomed = cues()[1] as FakeElement;                            // an upcoming preloaded cue
    doomed.focus();
    r.must({ type: 'select', id: 2 });
    r.must({ type: 'inject', recipe: { kind: 'helix' } });              // supersedes every cue after tick 11
    handle.update();
    expect(cues()).not.toContain(doomed);
    expect(doc.activeElement).toBe(cues()[1]);
    expect(cues()[1]!.getAttribute('aria-label')).toMatch(/^Cue 2: Helix, injected/);
  });

  it('a scheduled jam is never described as on, and is drawn as a visible stub', () => {
    const r = rig();
    r.steps(29);
    r.must({ type: 'select', id: 4 });
    r.must({ type: 'jam', radius: 5 });                                 // JAM_ON at 31, still at tick 30 (paused)
    const { bands } = eventLane(r.controller.getEventLog(), r.worlds.tick);
    expect(bands[0]).toMatchObject({ scheduled: true, label: 'Jam operator-jam: on scheduled for 00:01.6' });
    const { root } = mount(r.ctx);
    const band = root.findAll('band')[0] as FakeElement;
    expect([band.getAttribute('data-state'), band.getAttribute('role'), band.style.width]).toEqual(['scheduled', 'listitem', 'max(4px, 0.000%)']);
    r.steps(5);
    expect(eventLane(r.controller.getEventLog(), r.worlds.tick).bands[0]!.label).toBe('Jam operator-jam: on at 00:01.6, still on');
  });

  it('flags a held version whose score is not in the log instead of guessing the phase', () => {
    const { worlds } = rig();
    const real = { tick: 100, alive: 3, coverage: 0, pwc: 0, npwc: 0.5, sfMean: 1, sfMax: 1, dupSlots: 0, versions: { '0:-1': 2, '77:3': 1 }, msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0 } satisfies MetricsSample;
    expect(holdColumns([real], worlds.score, [])[0]).toMatchObject({ phase: null, unknown: ['77:3'] });
  });

  it('says the demo is not connected without #27, and starts and stops it when it is', () => {
    const s = scenario();
    const off = mount(s.ctx).root.findAll('btn')[0] as FakeElement;
    expect([off.textContent, off.disabled]).toEqual(['Demo · not connected', true]);
    let running = false;
    const demo = { start: vi.fn(() => { running = true; }), stop: vi.fn(() => { running = false; }), isRunning: () => running };
    const close = vi.fn();
    const { root } = mount({ ...s.ctx, demo, onClose: close });
    const button = root.findAll('btn')[0] as FakeElement;
    expect(button.textContent).toBe('▶ Run 90 s demo');
    button.click();
    expect(demo.start).toHaveBeenCalledOnce();
    expect(button.textContent).toBe('■ Stop demo');
    button.click();
    expect(demo.stop).toHaveBeenCalledOnce();
    (root.findAll('icon-btn')[0] as FakeElement).click();
    expect(close).toHaveBeenCalledOnce();
  });

  it('after a reset shows only what the new run has: preloaded plan, no events, empty holds', () => {
    const s = scenario();
    const { root, handle, cues } = mount(s.ctx);
    s.must({ type: 'reset', seed: 7 });
    handle.update();
    expect(cues().every(c => !c.className.includes('injected'))).toBe(true);
    expect(cues()).toHaveLength(s.worlds.score.movements.length);
    expect(root.findAll('ev')).toEqual([]);
    expect(root.findAll('band')).toEqual([]);
    expect(root.findTag('canvas')[0]?.getAttribute('aria-label')).toBe('Encore world: no observer samples yet');
  });

  it('dispose removes its listeners', () => {
    const s = scenario();
    const { handle, root } = mount(s.ctx);
    const plan = root.findAll('plan')[0]!.children[1] as FakeElement;
    expect(plan.listenerCount()).toBeGreaterThan(0);
    handle.dispose();
    expect(plan.listenerCount()).toBe(0);
  });
});

describe('module rules', () => {
  it('is not a panel and has no import side effects or invented numbers', () => {
    expect('createPanel' in timelineModule).toBe(false);
    const source = readFileSync(new URL('../../../src/app/ui/Timeline.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.random|Date\.now|performance\.now|innerHTML|fixture/);
  });
});
