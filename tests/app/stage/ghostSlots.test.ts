// FE-C #91 / #28: ghost slots come only from Observer.slotStatus, through a throttled feed. Headless: no WebGL.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, InstancedMesh, PerspectiveCamera, Scene } from 'three';
import { makeParams } from '../../../src/contracts';
import type { Observer, SlotStatus, WorldSnapshot } from '../../../src/contracts';
import createGhostLayer, { createSlotStatusFeed, GHOST_COLOURS, type GhostCounts, type SlotFrame } from '../../../src/app/render/layers/GhostSlotLayer';
import { createWorlds } from '../../../src/app/worlds';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';

const N0 = 40;
const context = () => ({ scene: new Scene(), camera: new PerspectiveCamera(), params: makeParams(N0) });

function slotsWith(statuses: SlotStatus[]): SlotFrame {
  return {
    formation: { slots: statuses.map((_, index) => ({ index, pos: [index, 20, 0], colour: [1, 1, 1] })), dense: [], bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    inHold: true,
    status: statuses,
  };
}
function meshes(scene: Scene) {
  const group = scene.children[0] as Group;
  const [dots, vacant, inTransit, contested] = group.children as InstancedMesh[];
  return { group, dots, vacant, inTransit, contested };
}

describe('GhostSlotLayer', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); dispose = undefined; });

  it('draws nothing until the app feeds LayerFrame.slots', () => {
    const ctx = context(); const layer = createGhostLayer(); layer.init(ctx); dispose = () => layer.dispose();
    const snap = makeFakeSnapshot(1, N0);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    const { group, dots } = meshes(ctx.scene);
    expect(group.visible).toBe(false);
    expect(dots.count).toBe(0);
  });

  it('marks every slot, and rings only the non-occupied ones, one shape and colour per status', () => {
    const ctx = context(); const layer = createGhostLayer(); layer.init(ctx); dispose = () => layer.dispose();
    const statuses: SlotStatus[] = Array.from({ length: N0 }, (_, i) => (['occupied', 'occupied', 'inTransit', 'vacant', 'contested'] as const)[i % 5]);
    const snap = makeFakeSnapshot(1, N0);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0, slots: slotsWith(statuses) });
    const { group, dots, vacant, inTransit, contested } = meshes(ctx.scene);
    expect(group.visible).toBe(true);
    expect(dots.count).toBe(N0);
    expect([vacant.count, inTransit.count, contested.count]).toEqual([8, 8, 8]);
    expect(group.userData.ghosts).toEqual<GhostCounts>({ slots: N0, occupied: 16, vacant: 8, inTransit: 8, contested: 8 });
    expect(((vacant.material as unknown) as { color: { getHex(): number } }).color.getHex()).toBe(GHOST_COLOURS.vacant);
    expect(((inTransit.material as unknown) as { color: { getHex(): number } }).color.getHex()).toBe(GHOST_COLOURS.inTransit);
    expect(((contested.material as unknown) as { color: { getHex(): number } }).color.getHex()).toBe(GHOST_COLOURS.contested);
    // Different shapes, not only colours: the contested ring is a double ring (twice the vertices of a single one).
    expect(contested.geometry.getAttribute('position').count).toBe(2 * vacant.geometry.getAttribute('position').count);
    expect(vacant.geometry.getAttribute('position').count).toBe(inTransit.geometry.getAttribute('position').count);
  });

  it('draws no ring when every slot is occupied', () => {
    const ctx = context(); const layer = createGhostLayer(); layer.init(ctx); dispose = () => layer.dispose();
    const snap = makeFakeSnapshot(1, N0);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0, slots: slotsWith(Array(N0).fill('occupied')) });
    const { dots, vacant, inTransit, contested } = meshes(ctx.scene);
    expect(dots.count).toBe(N0);
    expect(vacant.count + inTransit.count + contested.count).toBe(0);
  });

  it('hides on setVisible(false) and removes everything on dispose', () => {
    const ctx = context(); const layer = createGhostLayer(); layer.init(ctx);
    const snap = makeFakeSnapshot(1, N0);
    layer.setVisible(false);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0, slots: slotsWith(Array(N0).fill('vacant')) });
    expect(meshes(ctx.scene).group.visible).toBe(false);
    layer.dispose();
    expect(ctx.scene.children).toHaveLength(0);
  });

  it('ghost count equals n0 against the real observer, and occupied slots carry no ring', () => {
    const worlds = createWorlds({ seed: 5, n0: N0 });
    let snapshot: WorldSnapshot = worlds.stepBoth().encore;
    for (let i = 0; i < 30; i++) snapshot = worlds.stepBoth().encore;
    const feed = createSlotStatusFeed(() => worlds.observers.encore);
    const slots = feed.read(snapshot);
    const ctx = context(); const layer = createGhostLayer(); layer.init(ctx); dispose = () => layer.dispose();
    layer.update({ prev: snapshot, curr: snapshot, alpha: 0, dtReal: 0, slots });
    const counts = meshes(ctx.scene).group.userData.ghosts as GhostCounts;
    expect(counts.slots).toBe(N0);
    expect(counts.occupied).toBe(slots.status.filter(status => status === 'occupied').length);
    expect(counts.vacant + counts.inTransit + counts.contested).toBe(N0 - counts.occupied);
  });
});

describe('createSlotStatusFeed', () => {
  function setup() {
    let time = 0;
    const slotStatus = vi.fn((snapshot: WorldSnapshot) => slotsWith(Array(2).fill(snapshot.tick % 2 ? 'vacant' : 'occupied')));
    let observer: Pick<Observer, 'slotStatus'> = { slotStatus };
    const feed = createSlotStatusFeed(() => observer, { intervalMs: 250, now: () => time });
    return { feed, slotStatus, advance: (ms: number) => { time += ms; }, replaceObserver: () => { observer = { slotStatus }; } };
  }
  const snap = (tick: number) => makeFakeSnapshot(tick, 4);

  it('calls slotStatus at most once per interval while ticks advance', () => {
    const { feed, slotStatus, advance } = setup();
    expect(feed.latest()).toBeNull();
    feed.read(snap(1));
    for (let tick = 2; tick <= 10; tick++) { advance(16); feed.read(snap(tick)); }   // ~144 ms of frames
    expect(slotStatus).toHaveBeenCalledTimes(1);
    advance(120); feed.read(snap(11));                                               // 264 ms since the first call
    expect(slotStatus).toHaveBeenCalledTimes(2);
    expect(feed.latest()?.tick).toBe(11);
  });

  it('does not recompute a paused tick, however much time passes', () => {
    const { feed, slotStatus, advance } = setup();
    feed.read(snap(5)); advance(10_000); feed.read(snap(5));
    expect(slotStatus).toHaveBeenCalledTimes(1);
  });

  it('recomputes at once after a reset: a new observer or a tick that went backwards', () => {
    const { feed, slotStatus, advance, replaceObserver } = setup();
    feed.read(snap(40)); advance(1); feed.read(snap(3));
    expect(slotStatus).toHaveBeenCalledTimes(2);
    replaceObserver(); advance(1); feed.read(snap(3));
    expect(slotStatus).toHaveBeenCalledTimes(3);
  });
});
