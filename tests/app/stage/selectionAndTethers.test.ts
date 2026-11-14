// FE-C #91: selection (four arcs, sensing sphere, radio ring, target cross) and tethers, from belief.target only.
import { afterEach, describe, expect, it } from 'vitest';
import { Group, LineSegments, Mesh, PerspectiveCamera, Scene } from 'three';
import { makeParams } from '../../../src/contracts';
import type { Vec3 } from '../../../src/contracts';
import createSelectionLayer, { type SelectionState } from '../../../src/app/render/layers/SelectionLayer';
import createTetherLayer from '../../../src/app/render/layers/TetherLayer';
import { resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';

const N0 = 40;
const params = makeParams(N0);
const context = () => ({ scene: new Scene(), camera: new PerspectiveCamera(), params });
afterEach(() => resetViewMode());

describe('SelectionLayer', () => {
  function setup() {
    const ctx = context(); const layer = createSelectionLayer(); layer.init(ctx);
    const group = ctx.scene.children[0] as Group;
    const part = (name: string) => group.getObjectByName(name)!;
    return { ctx, layer, group, part };
  }

  it('is hidden with no selection, or a selection outside the roster', () => {
    const { layer, group } = setup(); const snap = makeFakeSnapshot(1, N0);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(group.visible).toBe(false);
    setViewMode({ selectedDroneId: 999 });
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(group.visible).toBe(false); layer.dispose();
  });

  it('draws arcs on the drawn (interpolated) position, ranges from params, and the cross at belief.target', () => {
    const { layer, group, part } = setup();
    const prev = makeFakeSnapshot(10, N0); const curr = makeFakeSnapshot(11, N0);
    const id = 7; const target: Vec3 = [3, 25, -4];
    curr.drones[id].belief.target = target;
    setViewMode({ selectedDroneId: id });
    layer.update({ prev, curr, alpha: 0.5, dtReal: 0 });
    expect(group.visible).toBe(true);
    const expected = prev.drones[id].pos.map((p, i) => (p + curr.drones[id].pos[i]) / 2);
    part('arcs').position.toArray().forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
    expect(part('sensing').position.toArray()).toEqual(part('arcs').position.toArray());
    expect(part('target').position.toArray()).toEqual(target);
    expect((part('arcs') as LineSegments).geometry.getAttribute('position').count).toBe(4 * 6 * 2);   // four arcs, six segments each
    (part('sensing') as LineSegments).geometry.computeBoundingSphere();
    expect((part('sensing') as LineSegments).geometry.boundingSphere!.radius).toBeCloseTo(params.rSense, 3);
    const ring = (part('radio') as Mesh).geometry as unknown as { parameters: { innerRadius: number; outerRadius: number } };
    expect((ring.parameters.innerRadius + ring.parameters.outerRadius) / 2).toBeCloseTo(params.rRadio, 6);
    expect((group.userData.selection as SelectionState).target).toEqual(target);
    layer.dispose();
  });

  it('keeps only the arcs for a dead drone, at the place it fell', () => {
    const { layer, part } = setup(); const snap = makeFakeSnapshot(5, N0);
    const dead = snap.drones.find(drone => !drone.alive)!;
    setViewMode({ selectedDroneId: dead.id });
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(part('arcs').visible).toBe(true);
    expect([part('sensing').visible, part('radio').visible, part('target').visible]).toEqual([false, false, false]);
    expect(part('arcs').position.toArray()).toEqual(dead.pos);
    layer.dispose();
  });

  it('reads only the selected drone from the render frame: no other drone, no radio, jams or partitions', () => {
    const { layer } = setup();
    const id = 12;
    const reads: string[] = [];
    /** Wraps a snapshot so every property read (and every drone index read) is recorded. */
    const spy = (name: string, snapshot: ReturnType<typeof makeFakeSnapshot>) => {
      const drones = new Proxy(snapshot.drones, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(`${name}.drones[${key}]`); return Reflect.get(target, key, receiver); } });
      return new Proxy(snapshot, { get(target, key, receiver) { if (typeof key === 'string' && key !== 'drones') reads.push(`${name}.${key}`); return key === 'drones' ? drones : Reflect.get(target, key, receiver); } });
    };
    setViewMode({ selectedDroneId: id });
    layer.update({ prev: spy('prev', makeFakeSnapshot(3, N0)), curr: spy('curr', makeFakeSnapshot(4, N0)), alpha: 0.3, dtReal: 0 });
    expect([...new Set(reads)].sort()).toEqual([`curr.drones[${id}]`, `prev.drones[${id}]`]);
    layer.dispose();
  });

  it('cleans up the scene on dispose', () => {
    const { ctx, layer } = setup(); layer.dispose();
    expect(ctx.scene.children).toHaveLength(0);
  });
});

describe('TetherLayer', () => {
  function setup() {
    const ctx = context(); const layer = createTetherLayer(); layer.init(ctx);
    const lines = ctx.scene.children[0] as LineSegments;
    return { ctx, layer, lines };
  }
  /** A snapshot where every live drone is far from its own target except drone 0, which is on it. */
  function snapshot() {
    const snap = makeFakeSnapshot(2, N0);
    for (const drone of snap.drones) drone.belief.target = [drone.pos[0] + 5, drone.pos[1], drone.pos[2]];
    snap.drones[0].belief.target = [...snap.drones[0].pos];
    return snap;
  }

  it('draws nothing with no selection and X-ray off', () => {
    const { layer, lines } = setup(); const snap = snapshot();
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(lines.userData.tethers).toBe(0); expect(lines.visible).toBe(false); layer.dispose();
  });

  it('draws the selected drone tether, ending exactly at its belief.target', () => {
    const { layer, lines } = setup(); const snap = snapshot();
    setViewMode({ selectedDroneId: 9 });
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(lines.userData.tethers).toBe(1);
    const position = lines.geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)].map(v => Math.fround(v))).toEqual(snap.drones[9].pos.map(v => Math.fround(v)));
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual(snap.drones[9].belief.target.map(v => Math.fround(v)));
    layer.dispose();
  });

  it('in X-ray draws one tether per live drone away from its own target, skipping the dead and the arrived', () => {
    const { layer, lines } = setup(); const snap = snapshot();
    setViewMode({ xray: true });
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    const expected = snap.drones.filter(drone => drone.alive && drone.id !== 0).length;
    expect(lines.userData.tethers).toBe(expected);
    expect(lines.geometry.drawRange.count).toBe(expected * 2);
    layer.setVisible(false);
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(lines.visible).toBe(false); expect(lines.userData.tethers).toBe(0);
    layer.dispose();
  });
});
