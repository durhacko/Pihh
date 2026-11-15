// FE-C #91 / #29 (UI-07): the inspector's agent section is built from World.inspect(id) and that drone's Belief only;
// the observer box from a separate, pre-labelled truth object. Headless: the pure view model, against real worlds.
import { describe, expect, it } from 'vitest';
import { OPERATOR } from '../../../src/contracts';
import type { Belief, SlotStatus, Vec3 } from '../../../src/contracts';
import { agentRows, connectInspector, decisionLog, inspectorArm, toTree, truthRows, versionLabel, type AgentView, type ObserverTruth } from '../../../src/app/ui/Inspector';
import { observerTruth } from '../../../src/app/ui/inspectorTruth';
import { createSlotStatusFeed } from '../../../src/app/render/layers/GhostSlotLayer';
import { createWorlds } from '../../../src/app/worlds';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';

const rowsOf = (rows: { label: string; value: string }[]) => Object.fromEntries(rows.map(row => [row.label, row.value]));
function belief(patch: Partial<Belief> = {}): Belief {
  return { slot: 14, heldSince: 812, target: [1, 2, 3], version: { issuedTick: 0, origin: OPERATOR }, deaf: false, canHeal: true, claiming: null, peersKnown: 9, log: ['t=1 a', 't=2 b'], ...patch };
}

describe('agent section', () => {
  it('shows Belief fields and says honestly when no step is recorded', () => {
    const rows = rowsOf(agentRows({ id: 4, inspect: null, belief: belief({ deaf: true, claiming: 21 }) }));
    expect(rows.Slot).toBe('14 · held since t812');
    expect(rows['Flying to']).toBe('(1.0, 2.0, 3.0)');
    expect(rows['Score version']).toBe('v0:-1 (preloaded)');
    expect(rows.Claim).toBe('claiming slot 21');
    expect(rows.Radio).toBe('DEAF · 9 peers heard recently');
    expect(rows['Last step']).toBe('No step recorded yet');
  });

  it('labels an uplinked version with the drone that received it, and lists decisions newest first', () => {
    expect(versionLabel({ issuedTick: 400, origin: 12 })).toBe('v400:12 (uplink via #12)');
    expect(decisionLog({ id: 1, inspect: null, belief: belief() })).toEqual(['t=2 b', 't=1 a']);
  });

  it('reads a real World.inspect result: own body, inbox, outbox and senses', () => {
    const worlds = createWorlds({ seed: 3, n0: 30 });
    let snapshots = worlds.stepBoth();
    for (let i = 0; i < 25; i++) snapshots = worlds.stepBoth();
    const id = 6;
    const inspect = worlds.worlds.encore.inspect(id)!;
    const view: AgentView = { id, inspect, belief: snapshots.encore.drones[id].belief };
    const rows = rowsOf(agentRows(view));
    expect(rows['Last step']).toBe(`tick ${inspect.input.tick}`);
    const hb = inspect.input.inbox.filter(message => message.type === 'HB').length;
    expect(rows['Inbox (last step)']).toBe(`${hb} HB · ${inspect.input.inbox.length - hb} SCORE`);
    expect(rows.Senses.startsWith(`${inspect.input.sensed.length} drones`)).toBe(true);
    expect(rows['Flying to']).toMatch(/ m away$/);
  });
});

describe('observer box', () => {
  /** A slot reading whose slot `i` sits exactly at drone i's belief.target, every status `status`. */
  function readingFor(snap: ReturnType<typeof makeFakeSnapshot>, status: SlotStatus) {
    return { tick: 45, slots: { status: snap.drones.map(() => status), formation: { slots: snap.drones.map(drone => ({ pos: [...drone.belief.target] as Vec3 })) } } };
  }

  it('is built outside the inspector from the snapshot and the throttled slot status, pre-labelled', () => {
    const snap = makeFakeSnapshot(50, 20);
    for (const drone of snap.drones) drone.belief.slot = drone.id;
    snap.jams = [{ id: 'J1', centre: [...snap.drones[2].pos], radius: 1 }];
    const truth = observerTruth(snap, readingFor(snap, 'vacant'), { rRadio: 1e6, rOcc: 0.6 }, 2)!;
    expect(truth.source).toBe('observer');
    expect(truth.jammedBy).toEqual(['J1']);
    expect(truth.believedSlot).toBe(2);
    expect(truth.sameFormation).toBe(true);
    expect(truth.believedSlotStatus).toBe('vacant');
    expect(truth.inRadioRange.live + truth.inRadioRange.dead).toBe(19);
    expect(rowsOf(truthRows(truth))['Slot 2, per observer']).toBe('vacant (t45)');
    expect(observerTruth(snap, null, { rRadio: 15, rOcc: 0.6 }, 99)).toBeNull();
  });

  it('never reports another score\'s slot as this drone\'s: a different reference formation is "not comparable"', () => {
    const snap = makeFakeSnapshot(50, 20);
    for (const drone of snap.drones) drone.belief.slot = drone.id;
    const reading = readingFor(snap, 'occupied');
    reading.slots.formation.slots[2] = { pos: [snap.drones[2].belief.target[0] + 10, 0, 0] };   // the reference moved slot 2 elsewhere
    const truth = observerTruth(snap, reading, { rRadio: 15, rOcc: 0.6 }, 2)!;
    expect(truth.sameFormation).toBe(false);
    expect(truth.believedSlotStatus).toBeNull();
    expect(rowsOf(truthRows(truth))['Slot 2, per observer']).toMatch(/^not comparable/);
  });

  it('says "not sampled yet" before the first slot reading, and reports death from the observer', () => {
    const alive: ObserverTruth = { source: 'observer', id: 3, tick: 9, alive: true, diedTick: null, believedSlot: 3, sameFormation: null, believedSlotStatus: null, slotStatusTick: null, jammedBy: [], partitionSide: null, inRadioRange: { live: 2, dead: 1 } };
    expect(rowsOf(truthRows(alive))['Slot 3, per observer']).toBe('not sampled yet');
    const rows = rowsOf(truthRows({ ...alive, alive: false, diedTick: 4 }));
    expect(rows['True state']).toBe('dead since t4');
    expect(rows['Slot 3, per observer']).toBe('dead since t4; target frozen');
    expect(rows['Partition group']).toBe('none');
  });

  it('a dead drone whose frozen target no longer matches the reference is dead, not "flying a different score"', () => {
    const snap = makeFakeSnapshot(50, 20);
    for (const drone of snap.drones) drone.belief.slot = drone.id;
    snap.drones[2].alive = false; snap.drones[2].diedTick = 30;
    const reading = readingFor(snap, 'vacant');
    reading.slots.formation.slots[2] = { pos: [snap.drones[2].belief.target[0] + 10, 0, 0] };   // the score moved on after it died
    const truth = observerTruth(snap, reading, { rRadio: 15, rOcc: 0.6 }, 2)!;
    expect(truth.sameFormation).toBe(false);
    const rows = rowsOf(truthRows(truth));
    expect(rows['Slot 2, per observer']).toBe('dead since t30; target frozen');
    expect(rows['Slot 2, per observer']).not.toMatch(/different score/);
    // A live drone in the same position still gets the honest "not comparable".
    snap.drones[2].alive = true; snap.drones[2].diedTick = null;
    expect(rowsOf(truthRows(observerTruth(snap, reading, { rRadio: 15, rOcc: 0.6 }, 2)!))['Slot 2, per observer']).toMatch(/^not comparable/);
  });

  it('a dead drone whose frozen target still IS the reference slot shows that slot\'s observer status and when it froze', () => {
    const snap = makeFakeSnapshot(50, 20);
    for (const drone of snap.drones) drone.belief.slot = drone.id;
    snap.drones[2].alive = false; snap.drones[2].diedTick = 30;
    const vacant = observerTruth(snap, readingFor(snap, 'vacant'), { rRadio: 15, rOcc: 0.6 }, 2)!;
    expect(vacant.sameFormation).toBe(true);
    const rows = rowsOf(truthRows(vacant));
    expect(rows['Slot 2, per observer']).toBe('vacant (t45); its target frozen since t30');
    expect(rows['True state']).toBe('dead since t30');   // the slot row no longer repeats the True state row
    // Another (live) drone may hold the slot now: still true, still shown.
    expect(rowsOf(truthRows(observerTruth(snap, readingFor(snap, 'occupied'), { rRadio: 15, rOcc: 0.6 }, 2)!))['Slot 2, per observer'])
      .toBe('occupied by a live drone (t45); its target frozen since t30');
    // Without a reading tick the status is still shown, just undated.
    expect(rowsOf(truthRows({ ...vacant, slotStatusTick: null }))['Slot 2, per observer']).toBe('vacant; its target frozen since t30');
  });

  it('a drone killed in a real world, while the score holds the same movement, reads its slot\'s real observer status', () => {
    const worlds = createWorlds({ seed: 9, n0: 30 });
    for (let i = 0; i < 40; i++) worlds.stepBoth();
    const killTick = worlds.tick + 1;
    worlds.scheduleBoth({ type: 'KILL', tick: killTick, ids: [11] });
    let snapshot = worlds.stepBoth().encore;
    for (let i = 0; i < 5; i++) snapshot = worlds.stepBoth().encore;
    expect(snapshot.drones[11].alive).toBe(false);
    expect(snapshot.drones[11].diedTick).toBe(killTick);
    const feed = createSlotStatusFeed(() => worlds.observers.encore);
    const slots = feed.read(snapshot);
    const truth = observerTruth(snapshot, feed.latest(), worlds.params, 11)!;
    expect(truth.sameFormation).toBe(true);   // one preloaded score, same movement: the frozen target IS the reference slot
    const status = slots.status[snapshot.drones[11].belief.slot];
    expect(truth.believedSlotStatus).toBe(status);
    expect(rowsOf(truthRows(truth))[`Slot ${truth.believedSlot}, per observer`]).toMatch(new RegExp(`\\(t${snapshot.tick}\\); its target frozen since t${killTick}$`));
  }, 30_000); // Heavy world stepping: headroom for CPU contention under parallel load.

  it('matches the real observer for a real drone', () => {
    const worlds = createWorlds({ seed: 9, n0: 30 });
    let snapshot = worlds.stepBoth().encore;
    for (let i = 0; i < 40; i++) snapshot = worlds.stepBoth().encore;
    const feed = createSlotStatusFeed(() => worlds.observers.encore);
    const slots = feed.read(snapshot);
    const truth = observerTruth(snapshot, feed.latest(), worlds.params, 11)!;
    expect(truth.sameFormation).toBe(true);   // one preloaded score: the drone's slot IS the reference slot
    expect(truth.believedSlotStatus).toBe(slots.status[snapshot.drones[11].belief.slot]);
    expect(truth.slotStatusTick).toBe(snapshot.tick);
  });
});

describe('generic state tree and connection', () => {
  it('names no fields itself and bounds width and depth', () => {
    const tree = toTree({ a: 1, list: [1, 2, 3, 4], deep: { x: { y: { z: 1 } } } }, 'state', 3, 2);
    expect(tree.summary).toBe('{3}');
    expect(tree.children!.map(child => child.key)).toEqual(['a', 'list', 'deep']);
    const list = tree.children![1];
    expect(list.summary).toBe('[4]'); expect(list.children).toHaveLength(3); expect(list.more).toBe(1);
    expect(tree.children![2].children![0].summary).toBe('{1} …');
    expect(toTree(null).summary).toBe('null');
  });

  it('defaults the connected arm to Encore and can be pointed at the static arm', () => {
    const source = { agent: () => null, truth: () => null };
    connectInspector(source); expect(inspectorArm()).toBe('encore');
    connectInspector(source, { arm: 'static' }); expect(inspectorArm()).toBe('static');
    connectInspector(null); expect(inspectorArm()).toBeNull();
  });
});
