// tests/app/xray/invariantsLayer.test.ts
// #209 (P2-WP-06, P2-T10): the live invariant readout. It shows only with ?p2=inv AND X-ray AND quality level 0;
// without the flag it is inert (no checker, no DOM) at every scripted-demo beat. Opted in, the live INV-DUP and
// INV-MONO results equal the CLI's runCustom report on the same run (the snapshot-checkable subset), including on a
// deliberately faulty brain that makes both fire. Results are "checked on this run, not proofs".
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { makeParams } from '../../../src/contracts';
import type { AgentBrain, Params, RadioEvent, WorldSnapshot } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import createLayer, {
  AIRSPACE_CANVAS, buildLegend, createInvariantsLayer, IN_PANE_CSS, INVARIANTS_TITLE, invariantsOptIn, legendLines, LIVE_COMPARED, LIVE_REQUESTED,
  type InvariantsLayer, type InvariantsLegend,
} from '../../../src/app/render/layers/InvariantsLayer';
import { createLayers } from '../../../src/app/render/layers';
import { resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';
import { DEMO_BEATS, demoViewAt, dispatchTick } from '../../../src/app/ui/DemoScript';
import { createWorlds } from '../../../src/app/worlds';
import { runCustom } from '../../../src/cli/harness';
import { BRAINS } from '../../../src/cli/brains';
import { buildScenario } from '../../../src/cli/scenarios';
import { INVARIANT_IDS, type InvariantReport, type Violation } from '../../../src/observer/invariants';

/** Every layer a test creates is disposed after it, so the page-wide view numbering starts at 1 in each test. */
const created: InvariantsLayer[] = [];
afterEach(() => { for (const layer of created.splice(0)) layer.dispose(); resetViewMode(); vi.unstubAllGlobals(); });

const N = 40;
const params = makeParams(N);

// ---------- a minimal DOM: just what the layer uses (createElement, body.append, replaceChildren, remove) ----------
class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = { cssText: '' };
  attributes: Record<string, string> = {};
  textContent = '';
  title = '';
  rebuilt = 0;
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...nodes: FakeEl[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: FakeEl[]) { this.rebuilt++; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  get parentElement(): FakeEl | null { return this.parent; }
  get text(): string[] { return this.children.map(child => child.textContent); }
}
function stubDocument() {
  const body = new FakeEl('body');
  vi.stubGlobal('document', { body, createElement: (tag: string) => new FakeEl(tag) });
  return body;
}
/** The app's stage: one pane per arm (data-arm), each holding the airspace canvas its WorldView appended. */
function stubStage() {
  const body = new FakeEl('body');
  const panes = (['encore', 'static'] as const).map(arm => { const pane = new FakeEl('div'); pane.dataset.arm = arm; pane.append(new FakeEl('canvas')); return pane; });
  body.append(...panes);
  vi.stubGlobal('document', {
    body, createElement: (tag: string) => new FakeEl(tag),
    querySelectorAll: (selector: string) => (selector === AIRSPACE_CANVAS ? panes.map(pane => pane.children[0]) : []),
  });
  return { body, panes };
}

// ---------- synthetic snapshots: every drone alive on its own slot unless overridden ----------
interface D { slot?: number; heldSince?: number }
function snap(tick: number, overrides: Record<number, D> = {}, radio: RadioEvent[] = []): WorldSnapshot {
  const base = makeFakeSnapshot(tick, N);
  return {
    ...base, radio, jams: [], partitions: [],
    drones: base.drones.map((d, i) => ({ ...d, alive: true, diedTick: null, belief: { ...d.belief, slot: overrides[i]?.slot ?? i, heldSince: overrides[i]?.heldSince ?? 0 } })),
  };
}
const hb = (tick: number, from: number, delivered: number[]): RadioEvent => ({ tick, from, type: 'HB', claimSlot: null, delivered, lost: 0, jammed: 0, partitioned: 0 });

function setup(layer: InvariantsLayer = createInvariantsLayer({ optIn: true }), p: Params = params) {
  const scene = new Scene();
  created.push(layer);
  layer.init({ scene, camera: new PerspectiveCamera(), params: p });
  const group = scene.children[0] as Group;
  let prev: WorldSnapshot | undefined;
  const feed = (s: WorldSnapshot) => { layer.ingest!(s); layer.update({ prev: prev ?? s, curr: s, alpha: 0, dtReal: 0 }); prev = s; };
  const legend = () => group.userData.invariants.legend as InvariantsLegend | null;
  return { scene, layer, group, feed, legend };
}
const rowOf = (legend: InvariantsLegend | null, inv: string) => legend?.rows.find(row => row.inv === inv);
/** The fields a reader compares; detail too, since both paths run the same checker code. */
const pick = (vs: Violation[]) => vs.filter(v => LIVE_COMPARED.includes(v.inv)).map(v => ({ inv: v.inv, tick: v.tick, ids: v.ids, slot: v.slot, knownLimit: v.knownLimit, detail: v.detail }));

describe('invariants layer: opt-in flag', () => {
  it('parses ?p2=<name>[,<name>…] for exactly "inv"', () => {
    expect(invariantsOptIn('')).toBe(false);
    expect(invariantsOptIn('?p2=inv')).toBe(true);
    expect(invariantsOptIn('?q=low&p2=cascade, inv')).toBe(true);
    expect(invariantsOptIn('?p2=invariants')).toBe(false);
    expect(invariantsOptIn('?inv=1')).toBe(false);
  });

  it('the registered default layer reads the flag once from location in init, and is off without a location', () => {
    expect(createLayers().map(layer => layer.id)).toContain('invariants');
    const off = setup(createLayer() as InvariantsLayer);           // node: no location
    expect(off.group.userData.invariants.optIn).toBe(false);
    vi.stubGlobal('location', { search: '?p2=inv' });
    const on = setup(createLayer() as InvariantsLayer);
    expect(on.group.userData.invariants.optIn).toBe(true);
    vi.stubGlobal('location', { search: '' });                     // read once: a later URL change does not switch it
    setViewMode({ xray: true });
    on.feed(snap(1));
    expect(on.group.visible).toBe(true);
    off.layer.dispose(); on.layer.dispose();
  });
});

describe('invariants layer: disabled (no ?p2=inv) is inert', () => {
  it('ingest and update never read the snapshot or frame; no checker, no report, no DOM', () => {
    const body = stubDocument();
    const { scene, layer, group } = setup(createInvariantsLayer({ optIn: false }));
    expect(scene.children).toEqual([group]);
    expect(group.children).toHaveLength(0);
    expect(group.visible).toBe(false);
    const untouchable = new Proxy({}, { get(_, key) { throw new Error(`read ${String(key)}`); } });
    setViewMode({ xray: true });
    expect(() => layer.ingest!(untouchable as WorldSnapshot)).not.toThrow();
    expect(() => layer.update(untouchable as never)).not.toThrow();
    expect(() => layer.reset!()).not.toThrow();
    expect(layer.report()).toBeNull();
    expect(body.children).toHaveLength(0);
    layer.dispose();
  });

  // WP-06 acceptance: with X-ray on and no p2 flag, group.visible === false and no legend is in the DOM at every
  // DEMO_BEATS tick (with the overlays the script has set by then). Opted in, it shows exactly when X-ray is on.
  for (const optIn of [false, true]) {
    it(`${optIn ? 'with' : 'without'} ?p2=inv, at every scripted-demo beat: ${optIn ? 'shown exactly when X-ray is on' : 'never shown, no legend in the DOM'}`, () => {
      const body = stubDocument();
      let xrayBeats = 0;
      for (const beat of DEMO_BEATS) {
        const tick = Math.max(1, dispatchTick(beat));
        const { layer, group, feed } = setup(createInvariantsLayer({ optIn }));
        const view = demoViewAt(tick);
        if (view.xray) xrayBeats++;
        setViewMode(view);
        for (let t = 1; t <= 3; t++) feed(snap(t));
        expect(group.visible, beat.id).toBe(optIn && view.xray);
        expect(body.children.length, beat.id).toBe(optIn && view.xray ? 1 : 0);
        expect(group.userData.invariants.lastTick, beat.id).toBe(optIn ? 3 : 0);   // opted in: still ingesting while hidden
        layer.dispose();
        expect(body.children, beat.id).toHaveLength(0);
      }
      expect(xrayBeats).toBeGreaterThan(0);   // the script does turn X-ray on, so the flag is what keeps it off
    });
  }
});

describe('invariants layer: legend text', () => {
  it('holding, nothing-to-check-yet and unavailable states, with the required wording', () => {
    const { feed, legend } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    let l = legend()!;
    expect(l.title).toBe(INVARIANTS_TITLE);
    expect(l.title).toBe('Checked on this run, not proofs');
    expect(l.rows.map(row => row.inv)).toEqual([...INVARIANT_IDS]);
    expect(rowOf(l, 'INV-DUP')).toMatchObject({ state: 'idle', text: 'INV-DUP · nothing to check yet (no delivered heartbeats)' });
    expect(rowOf(l, 'INV-MONO')).toMatchObject({ state: 'idle', text: 'INV-MONO · nothing to check yet (no slot changes)' });
    for (const inv of ['INV-SILENCE', 'INV-QUIET', 'INV-CONVERGE', 'INV-STATIC'] as const) {
      expect(rowOf(l, inv), inv).toMatchObject({ state: 'unavailable', text: `${inv} – not checkable live (see CLI)` });
      expect(rowOf(l, inv)?.why, inv).toBeTruthy();
    }
    expect(rowOf(l, 'INV-QUIET')?.why).toMatch(/no registered score/);
    expect(rowOf(l, 'INV-STATIC')?.why).toMatch(/static arm only/);
    expect(l.footer).toBe('2 of 6 checkable live · dupContactRuns unavailable live');
    // A delivered heartbeat and a legal commit (drop 5 >= claimGap + 1 = 3): both now hold on evidence.
    feed(snap(2, { 9: { slot: 4, heldSince: 2 } }, [hb(2, 1, [0])]));
    l = legend()!;
    expect(rowOf(l, 'INV-DUP')).toMatchObject({ state: 'holding', text: 'INV-DUP ✓ holding' });
    expect(rowOf(l, 'INV-MONO')).toMatchObject({ state: 'holding', text: 'INV-MONO ✓ holding' });
    // No wording that suggests a guarantee.
    for (const row of l.rows) expect(row.text).not.toMatch(/prov|guarant|safe|verified/i);
  });

  it('violated: first tick, seconds, drone ids and the total; INV-DUP after a delivered heartbeat (exact rule)', () => {
    const { feed, legend, layer } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    // Tick 2: drone 9 jumps up to slot 2 (a commit of 7, legal) while drone 2 holds it from earlier; 2's heartbeat reaches 9.
    const dup = { 9: { slot: 2, heldSince: 2 } };
    feed(snap(2, dup, [hb(2, 2, [9])]));
    feed(snap(3, dup));
    feed(snap(4, dup));
    expect(rowOf(legend(), 'INV-DUP')?.state).toBe('holding');      // not yet: latencyMax + 1 = 3 ticks after the send
    feed(snap(5, dup));
    expect(rowOf(legend(), 'INV-DUP')).toMatchObject({ state: 'violated', text: 'INV-DUP ✗ violated · first t=5 (0.25 s), drones 2 and 9' });
    expect(rowOf(legend(), 'INV-DUP')?.why).toMatch(/delivered heartbeat sent at 2/);
    // Two INV-MONO violations: commits that drop by 1 < claimGap + 1.
    feed(snap(6, { ...dup, 30: { slot: 29 } }));
    feed(snap(7, { ...dup, 30: { slot: 29 }, 20: { slot: 19 } }));
    const mono = rowOf(legend(), 'INV-MONO');
    expect(mono).toMatchObject({ state: 'violated', text: 'INV-MONO ✗ violated · first t=6 (0.30 s), drone 30 · 2 in total' });
    expect(layer.report()!.counts['INV-MONO']).toBe(2);
  });

  it('a known-limit tag and a derived note are shown, never hidden (pure legend builder)', () => {
    const report: InvariantReport = {
      checked: ['INV-QUIET'], unavailable: [], derived: [{ inv: 'INV-QUIET', why: 'events not recorded: anchor derived' }], holding: [],
      violations: [{ inv: 'INV-QUIET', tick: 812, ids: [17], slot: 3, knownLimit: '§8.5 limit 3', detail: 'late' }],
      counterexamples: [], knownLimitInstances: [], counts: { 'INV-DUP': 0, 'INV-MONO': 0, 'INV-SILENCE': 0, 'INV-QUIET': 1, 'INV-CONVERGE': 0, 'INV-STATIC': 0 },
      silenceExcused: 0, lastTick: 900,
    };
    const l = buildLegend(report, { heartbeats: true, slotChanges: true }, null);
    expect(rowOf(l, 'INV-QUIET')?.text).toBe('INV-QUIET ✗ violated (derived) · first t=812 (40.60 s), drone 17 · matches known limit §8.5 limit 3');
    expect(l.footer).toBe('1 of 6 checkable live · dupContactRuns unavailable live');
  });
});

describe('invariants layer: visibility, DOM and failure handling', () => {
  it('in the DOM only while shown; quality above 0 and setVisible(false) hide it; it keeps ingesting while hidden', () => {
    const body = stubDocument();
    const { layer, group, feed } = setup();
    feed(snap(1));
    expect(group.visible).toBe(false);                 // X-ray off
    expect(body.children).toHaveLength(0);
    setViewMode({ xray: true });
    feed(snap(2));
    expect(group.visible).toBe(true);
    expect(body.children).toHaveLength(1);
    const element = body.children[0];
    expect(element.text[0]).toBe('View 1 · Checked on this run, not proofs');
    expect(element.text.at(-1)).toBe('2 of 6 checkable live · dupContactRuns unavailable live');
    expect(element.style.cssText).toMatch(/pointer-events:none/);
    layer.setQuality!(1);
    expect(group.visible).toBe(false);
    expect(body.children).toHaveLength(0);
    feed(snap(3, { 30: { slot: 29 } }));               // a violation while hidden is still recorded
    expect(layer.report()!.counts['INV-MONO']).toBe(1);
    layer.setQuality!(0);
    feed(snap(4, { 30: { slot: 29 } }));
    expect(body.children[0].text).toContain('INV-MONO ✗ violated · first t=3 (0.15 s), drone 30');
    layer.setVisible(false);
    expect(body.children).toHaveLength(0);
    expect(group.visible).toBe(false);
    layer.dispose();
  });

  it('rebuilds the legend only when the report changes, not every frame', () => {
    const body = stubDocument();
    const { feed } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    const element = body.children[0];
    const first = element.rebuilt;
    for (let t = 2; t <= 60; t++) feed(snap(t));
    expect(element.rebuilt).toBe(first);
    feed(snap(61, { 30: { slot: 29 } }));
    expect(element.rebuilt).toBe(first + 1);
  });

  it('two views get their own legend, numbered and placed apart', () => {
    const body = stubDocument();
    const a = setup(), b = setup();
    setViewMode({ xray: true });
    a.feed(snap(1)); b.feed(snap(1));
    expect(body.children.map(e => e.dataset.invariantsLegend)).toEqual(['1', '2']);
    expect(body.children[1].text[0]).toBe('View 2 · Checked on this run, not proofs');
    expect(body.children[0].style.cssText).not.toBe(body.children[1].style.cssText);
    a.layer.dispose(); b.layer.dispose();
    expect(body.children).toHaveLength(0);
  });

  it('in the app: each readout goes into its own pane (hidden with it, under the shell panels), labelled by the pane', () => {
    const { body, panes } = stubStage();
    const encore = setup(), statics = setup();   // WorldViews are built in ARMS order, each right after its canvas
    setViewMode({ xray: true });
    encore.feed(snap(1)); statics.feed(snap(1));
    expect(body.children).toEqual(panes);           // nothing fixed on body
    const [a, b] = panes.map(pane => pane.children[1]);
    expect(a.text[0]).toBe('Encore arm · Checked on this run, not proofs');
    expect(b.text[0]).toBe('Static arm · Checked on this run, not proofs');
    expect(a.dataset.invariantsLegend).toBe('encore');
    expect(a.style.cssText.startsWith(IN_PANE_CSS)).toBe(true);
    expect(a.style.cssText).not.toMatch(/fixed|z-index/);
    encore.layer.dispose();
    expect(panes[0].children).toHaveLength(1);      // only the canvas is left
    const again = setup();                          // a rebuilt view claims the released pane again
    again.feed(snap(1));
    expect(panes[0].children[1].text[0]).toBe('Encore arm · Checked on this run, not proofs');
  });

  it('the pane lookup matches WorldView: the canvas label, and the canvas is appended before the layers init', () => {
    const source = readFileSync(new URL('../../../src/app/render/WorldView.ts', import.meta.url), 'utf8');
    expect(AIRSPACE_CANVAS).toBe('canvas[aria-label="Three dimensional drone airspace"]');
    expect(source).toContain("setAttribute('aria-label', 'Three dimensional drone airspace')");
    const append = source.indexOf('host.append(this.renderer.domElement)');
    expect(append).toBeGreaterThan(0);
    expect(source.indexOf('layer.init(')).toBeGreaterThan(append);
  });

  it('the DOM lines group the not-checkable invariants into one line', () => {
    const { feed, legend } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    expect(legendLines(legend()!, 'Encore arm').map(line => line.text)).toEqual([
      'Encore arm · Checked on this run, not proofs',
      'INV-DUP · nothing to check yet (no delivered heartbeats)',
      'INV-MONO · nothing to check yet (no slot changes)',
      'Not checkable live (see CLI): INV-SILENCE, INV-QUIET, INV-CONVERGE, INV-STATIC',
      '2 of 6 checkable live · dupContactRuns unavailable live',
    ]);
  });

  it('a pane hidden by the layout loses its element at the next tick, although that pane is no longer rendered', () => {
    const { panes } = stubStage();
    const encore = setup(), statics = setup();
    setViewMode({ xray: true });
    encore.feed(snap(1)); statics.feed(snap(1));
    expect(panes[1].children).toHaveLength(2);
    (panes[1].style as Record<string, string>).visibility = 'hidden';   // main.ts layoutViews('encore')
    encore.feed(snap(2)); statics.layer.ingest!(snap(2));             // a hidden pane is ingested, not rendered
    expect(panes[1].children).toHaveLength(1);
    expect(panes[0].children).toHaveLength(2);
    expect(statics.layer.report()!.lastTick).toBe(2);                 // still checking while hidden
    (panes[1].style as Record<string, string>).visibility = 'visible';
    statics.feed(snap(3));
    expect(panes[1].children).toHaveLength(2);
  });

  it('after a reset, update never ingests the buffered frame of the discarded show; the next real ingest starts it', () => {
    const { layer, group, legend } = setup();
    setViewMode({ xray: true });
    for (let t = 1; t <= 40; t++) { layer.ingest!(snap(t)); layer.update({ prev: snap(t), curr: snap(t), alpha: 0, dtReal: 0 }); }
    layer.reset!();
    const stale = snap(40);                             // the new show's first tick failed: the buffer still holds this
    layer.update({ prev: stale, curr: stale, alpha: 0, dtReal: 0 });
    expect(legend()?.failure).toBeNull();
    expect(group.userData.invariants.lastTick).toBe(0);
    expect(legend()?.footer).toBe('Waiting for the first tick');
    layer.ingest!(snap(1)); layer.update({ prev: snap(1), curr: snap(1), alpha: 0, dtReal: 0 });
    expect(group.userData.invariants.lastTick).toBe(1);
    expect(legend()?.failure).toBeNull();
  });

  it('a tick gap makes the readout unavailable (never a crash); reset clears it', () => {
    const body = stubDocument();
    const { layer, feed, legend } = setup();
    setViewMode({ xray: true });
    feed(snap(1));
    expect(() => feed(snap(3))).not.toThrow();
    expect(legend()).toMatchObject({ failure: 'tick gap', rows: [], footer: 'Readout unavailable (tick gap) until the show is reset' });
    expect(body.children[0].text).toEqual(['View 1 · Checked on this run, not proofs', 'Readout unavailable (tick gap) until the show is reset']);
    feed(snap(4));                                      // stays unavailable: nothing after a gap is judged
    expect(legend()?.failure).toBe('tick gap');
    layer.reset!();
    expect(body.children).toHaveLength(0);
    feed(snap(1));
    expect(legend()?.failure).toBeNull();
    expect(rowOf(legend(), 'INV-DUP')?.state).toBe('idle');
  });

  it('a repeated tick is a no-op; a tick that goes backwards without reset is unavailable too', () => {
    const { feed, legend, layer } = setup();
    setViewMode({ xray: true });
    feed(snap(1)); feed(snap(2)); feed(snap(2));
    expect(legend()?.failure).toBeNull();
    layer.ingest!(snap(1));
    expect(legend()?.failure).toBe(null);               // not shown until the next update
    layer.update({ prev: snap(2), curr: snap(2), alpha: 0, dtReal: 0 });
    expect(legend()?.failure).toBe('tick went backwards');
  });
});

// ---------- integration: a real run in the app's worlds against the CLI's runCustom on the same run ----------
/** A brain that lies in its belief only: from tick `at`, drone `liar` claims slot `slot` (held since `at`). Its radio
 *  and motion are the real Encore brain's, so the world is unchanged apart from what the belief shows. */
function liarBrain(inner: AgentBrain, liar: number, slot: number, at: number): AgentBrain<{ inner: unknown; id: number; tick: number }> {
  return {
    kind: 'encore',
    init: init => ({ inner: inner.init(init), id: init.id, tick: 0 }),
    step(state, input) { state.tick = input.tick; return inner.step(state.inner, input); },
    belief(state) {
      const belief = inner.belief(state.inner);
      return state.id === liar && state.tick >= at ? { ...belief, slot, heldSince: at } : belief;
    },
  };
}

function liveVsCli(ticks: number, brains?: { encore: AgentBrain }) {
  const scenario = buildScenario('S2', 101, params);
  const worlds = createWorlds({ seed: 101, params, score: scenario.score, events: scenario.events, ...(brains ? { brains } : {}) });
  const layers = { encore: setup(), static: setup() };
  setViewMode({ xray: true });
  for (let t = 1; t <= ticks; t++) {
    const s = worlds.stepBoth();
    layers.encore.feed(s.encore);
    layers.static.feed(s.static);
  }
  const cli = (arm: 'encore' | 'static') => runCustom({ label: 'S2', seed: 101, params, score: scenario.score, events: scenario.events, ticks, arm }, brains ? { brains: { ...BRAINS, ...brains } } : {});
  const out = {
    worlds,
    legends: { encore: layers.encore.legend(), static: layers.static.legend() },
    live: { encore: layers.encore.layer.report()!, static: layers.static.layer.report()! },
    cli: { encore: cli('encore'), static: brains ? null : cli('static') },
  };
  layers.encore.layer.dispose(); layers.static.layer.dispose();
  return out;
}

describe('invariants layer: live report equals the CLI runCustom report (snapshot-checkable subset)', () => {
  // Neutral too: the app's worlds stepped WITH the readout attached reach the same stateHash as the CLI's run, which
  // has no readout (P2-T10's neutrality, on the default-suite run; the scripted demo on and off is opt-in below).
  it('S2-like kill at n0 40 (seed 101, 450 ticks, kill at 400), both arms: same world, same INV-DUP and INV-MONO result', () => {
    const r = liveVsCli(450);
    for (const arm of ['encore', 'static'] as const) {
      expect(r.worlds.worlds[arm].stateHash(), arm).toBe(r.cli[arm]!.record.stateHash);   // the same run
      const live = r.live[arm], cli = r.cli[arm]!.report as InvariantReport;
      expect(live.lastTick).toBe(450);
      expect(live.checked, arm).toEqual(['INV-DUP', 'INV-MONO']);
      for (const inv of LIVE_COMPARED) {
        expect(cli.checked, `${arm} ${inv}`).toContain(inv);
        expect(live.counts[inv], `${arm} ${inv}`).toBe(cli.counts[inv]);
      }
      expect(pick(live.violations), arm).toEqual(pick(cli.violations));
      expect(live.unavailable.map(u => u.inv).sort(), arm).toEqual(['INV-QUIET', 'INV-SILENCE', 'INV-STATIC']);
      console.log(`#209 live vs CLI, S2 seed 101 n0 40 450 ticks, ${arm}: INV-DUP ${live.counts['INV-DUP']} = ${cli.counts['INV-DUP']}, INV-MONO ${live.counts['INV-MONO']} = ${cli.counts['INV-MONO']} (checked on this run, not proofs)`);
    }
    expect(LIVE_REQUESTED).not.toContain('INV-CONVERGE');
  }, 60_000);

  it('falsification: a belief-lying brain makes INV-DUP and INV-MONO fire, and live and CLI report the same violations', () => {
    // Drone 25 claims slot 24 at tick 100 (a commit of 1 < claimGap + 1) and never lets go, while drone 24 keeps it.
    const brains = { encore: liarBrain(BRAINS.encore!, 25, 24, 100) };
    const r = liveVsCli(130, brains);
    const live = r.live.encore, cli = r.cli.encore!.report as InvariantReport;
    expect(r.worlds.worlds.encore.stateHash()).toBe(r.cli.encore!.record.stateHash);
    expect(cli.counts['INV-MONO']).toBeGreaterThan(0);  // anti-vacuity: the comparison is not [] = []
    expect(cli.counts['INV-DUP']).toBeGreaterThan(0);
    expect(pick(live.violations)).toEqual(pick(cli.violations));
    expect(pick(live.violations).find(v => v.inv === 'INV-MONO')).toMatchObject({ tick: 100, ids: [25], slot: 24 });
    expect(pick(live.violations).find(v => v.inv === 'INV-DUP')).toMatchObject({ ids: [24, 25], slot: 24 });
    const legend = r.legends.encore;
    expect(rowOf(legend, 'INV-MONO')?.text).toMatch(/^INV-MONO ✗ violated · first t=100 \(5\.00 s\), drone 25/);
    expect(rowOf(legend, 'INV-DUP')?.text).toMatch(/^INV-DUP ✗ violated · first t=\d+ \(.+ s\), drones 24 and 25/);
  }, 60_000);
});

// ---------- opt-in: P2-T10 cost (P2_PERF=1) and the scripted demo with the readout on and off (P2_WIDE=1) ----------
describe.skipIf(!process.env.P2_PERF)('P2-T10: readout cost at n0 200 (P2_PERF=1)', () => {
  it('ingest and the per-frame update each stay within 0.5 ms/tick/world', async () => {
    const { performance } = await import('node:perf_hooks');
    const wide = makeParams(200);
    const scenario = buildScenario('S2', 1, wide);
    const worlds = createWorlds({ seed: 1, params: wide, score: scenario.score, events: scenario.events });
    const stream: WorldSnapshot[] = [];
    for (let t = 1; t <= scenario.ticks; t++) stream.push(worlds.stepBoth().encore);
    const time = (label: string, pass: () => number[]) => {
      pass();                                          // warm-up, discarded
      const means: number[] = [];
      let worst = 0;
      for (let p = 0; p < 5; p++) {
        const per = pass();
        means.push(per.reduce((a, b) => a + b, 0) / per.length);
        for (let w = 0; w + 100 <= per.length; w += 100) worst = Math.max(worst, per.slice(w, w + 100).reduce((a, b) => a + b, 0) / 100);
      }
      const median = [...means].sort((a, b) => a - b)[2];
      console.log(`P2-T10 ${label}: median of 5 per-pass means ${median.toFixed(4)} ms/tick (passes ${means.map(m => m.toFixed(4)).join(', ')}); worst 100-tick window ${worst.toFixed(4)} ms/tick`);
      return median;
    };
    const ingest = time('ingest', () => {
      const layer = createInvariantsLayer({ optIn: true });
      layer.init({ scene: new Scene(), camera: new PerspectiveCamera(), params: wide });
      const out = stream.map(s => { const t0 = performance.now(); layer.ingest!(s); return performance.now() - t0; });
      layer.dispose();
      return out;
    });
    setViewMode({ xray: true });
    const update = time('update (opted in, X-ray, no DOM)', () => {
      const layer = createInvariantsLayer({ optIn: true });
      layer.init({ scene: new Scene(), camera: new PerspectiveCamera(), params: wide });
      const out = stream.map((s, i) => {
        layer.ingest!(s);
        const t0 = performance.now();
        layer.update({ prev: stream[Math.max(0, i - 1)], curr: s, alpha: 0.5, dtReal: 0 });
        return performance.now() - t0;
      });
      layer.dispose();
      return out;
    });
    // The budget is per addition (P2-NFR-02): ingest and one update of the same tick, timed together.
    const both = time('ingest + update (one budget)', () => {
      const layer = createInvariantsLayer({ optIn: true });
      layer.init({ scene: new Scene(), camera: new PerspectiveCamera(), params: wide });
      const out = stream.map((s, i) => {
        const t0 = performance.now();
        layer.ingest!(s);
        layer.update({ prev: stream[Math.max(0, i - 1)], curr: s, alpha: 0.5, dtReal: 0 });
        return performance.now() - t0;
      });
      layer.dispose();
      return out;
    });
    console.log(`P2-T10 stream: S2 seed 1 n0 200, ${stream.length} ticks, Encore arm; ingest ${ingest.toFixed(4)} + update ${update.toFixed(4)} ms/tick separately`);
    expect(both).toBeLessThanOrEqual(0.5);
  }, 300_000);
});

describe.skipIf(process.env.P2_WIDE !== '1')('P2-T10: the scripted demo with the readout on and off (P2_WIDE=1)', () => {
  it('same stateHash and samples on both arms; the live violations are printed for the storyboard', async () => {
    const { bindControls } = await import('../../../src/app/actions');
    const { connectDemo, DEMO_SEED, DEMO_TICKS } = await import('../../../src/app/ui/DemoScript');
    const { controlContext, viewModeDisplay } = await import('../../../src/app/worlds');
    const run = (attach: boolean) => {
      const worlds = createWorlds({ seed: DEMO_SEED });
      const layers = attach ? { encore: setup(createInvariantsLayer({ optIn: true }), worlds.params), static: setup(createInvariantsLayer({ optIn: true }), worlds.params) } : null;
      const first = worlds.stepBoth();
      layers?.encore.feed(first.encore); layers?.static.feed(first.static);
      const transport = { playing: true, speed: 1 };
      const host = new EventTarget() as unknown as HTMLElement;
      const controls = bindControls(host, controlContext(worlds, {
        getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
        getTransport: () => ({ ...transport, seed: worlds.seed }),
        setPlaying: playing => { transport.playing = playing; },
        setSpeed: speed => { transport.speed = speed; },
        // As main.ts's pipeline.restart: rebuild, reset every view's layers, then run and fan out the first tick.
        reset: next => {
          worlds.reset(next); layers?.encore.layer.reset!(); layers?.static.layer.reset!();
          const s = worlds.stepBoth(); layers?.encore.feed(s.encore); layers?.static.feed(s.static);
        },
        display: viewModeDisplay,
      }));
      const demo = connectDemo(host, { camera: () => {}, changed: () => {} });
      expect(demo.runner.start()).toBe(true);
      while (worlds.tick < DEMO_TICKS.END) {
        const s = worlds.stepBoth();
        layers?.encore.feed(s.encore); layers?.static.feed(s.static);
        if (worlds.tick % 4 === 0) controls.refresh();
      }
      if (layers) for (const arm of ['encore', 'static'] as const) expect(layers[arm].legend()?.failure ?? null, arm).toBeNull();
      const reports = layers ? { encore: layers.encore.layer.report()!, static: layers.static.layer.report()! } : null;
      if (layers) { layers.encore.layer.dispose(); layers.static.layer.dispose(); }
      return { hashes: { encore: worlds.worlds.encore.stateHash(), static: worlds.worlds.static.stateHash() }, samples: worlds.samples(), reports };
    };
    const on = run(true), off = run(false);
    expect(on.hashes).toEqual(off.hashes);
    expect(on.samples).toEqual(off.samples);
    for (const arm of ['encore', 'static'] as const) {
      const r = on.reports![arm];
      expect(r.lastTick).toBe(DEMO_TICKS.END);
      console.log(`#209 scripted demo (seed ${DEMO_SEED}), ${arm}, live readout to t=${r.lastTick}: ${r.checked.map(inv => `${inv} ${r.counts[inv] === 0 ? 'holds' : `${r.counts[inv]} violation(s), first t=${r.violations.find(v => v.inv === inv)?.tick}`}`).join(' | ')} (checked on this run, not proofs)`);
      for (const v of r.violations) console.log(`   ${v.inv} t=${v.tick} ids=${v.ids.join(',')} ${v.knownLimit ?? 'untagged'}: ${v.detail}`);
    }
  }, 600_000);
});
