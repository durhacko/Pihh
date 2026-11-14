import { afterEach, describe, expect, it } from 'vitest';
import { Group, InstancedMesh, LineSegments, PerspectiveCamera, Scene } from 'three';
import { makeParams } from '../../../src/contracts';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import createRadioLayer from '../../../src/app/render/layers/RadioLayer';
import createZoneLayer from '../../../src/app/render/layers/ZoneLayer';
import createBeliefLayer from '../../../src/app/render/layers/BeliefLayer';
import { resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';
import { resetVersionColours } from '../../../src/app/render/colourModes/belief';

afterEach(() => { resetViewMode(); resetVersionColours(); });
const context = () => ({ scene: new Scene(), camera: new PerspectiveCamera(), params: makeParams(40) });

describe('rendered evidence layers without a GPU', () => {
  it('creates zero real line vertices for an empty radio log', () => {
    const ctx = context(); const layer = createRadioLayer(); layer.init(ctx); setViewMode({ xray: true });
    const snap = { ...makeFakeSnapshot(1, 40), radio: [] }; layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    const group = ctx.scene.children[0] as Group; const lines = group.children[0] as LineSegments;
    expect(lines.geometry.getAttribute('position').count).toBe(0);
    expect(group.userData.radio).toEqual({ drawn: 0, observed: 0, currentSegments: 0, droppedStubs: 0 }); layer.dispose();
  });
  it('builds real geometry only for logged recipients and selected filtering', () => {
    const ctx = context(); const layer = createRadioLayer(); layer.init(ctx); setViewMode({ xray: true, selectedDroneId: 2 });
    const snap = { ...makeFakeSnapshot(1, 40), radio: [{ tick: 1, from: 0, type: 'SCORE' as const, claimSlot: null, delivered: [1, 2, 4], lost: 0, jammed: 0, partitioned: 0 }] };
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 }); const group = ctx.scene.children[0] as Group;
    const lines = group.children[0] as LineSegments;
    expect(lines.geometry.getAttribute('position').count).toBe(2); expect(group.userData.radio.drawn).toBe(1); expect(group.userData.radio.observed).toBe(3);
    for (let i = 0; i < 5; i++) layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(group.userData.radio.drawn).toBe(1); layer.dispose(); expect(ctx.scene.children).toHaveLength(0);
  });
  it('creates zone geometry only from snapshot jams and partitions', () => {
    const ctx = context(); const layer = createZoneLayer(); layer.init(ctx); setViewMode({ xray: true });
    const snap = makeFakeSnapshot(1, 40); layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    const group = ctx.scene.children[0] as Group; expect(group.children).toHaveLength(0);
    snap.jams = [{ id: 'J', centre: [4, 20, 7], radius: 9 }];
    snap.partitions = [{ id: 'P', point: [0, 30, 0], normal: [1, 0, 0] }];
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    expect(group.children).toHaveLength(2); expect(group.children[0].position.toArray()).toEqual([4, 20, 7]);
    expect(group.children[0].userData.jamId).toBe('J'); expect(group.children[1].userData.partitionId).toBe('P'); layer.dispose();
  });
  it('draws deaf rings only for actual live deaf beliefs, including audience mode', () => {
    const ctx = context(); const layer = createBeliefLayer(); layer.init(ctx); const snap = makeFakeSnapshot(1, 40);
    snap.drones[0].belief.deaf = true; snap.drones[3].belief.deaf = true;
    layer.update({ prev: snap, curr: snap, alpha: 0, dtReal: 0 });
    const rings = ctx.scene.children[0] as InstancedMesh; expect(rings.count).toBe(1); expect(rings.visible).toBe(true); layer.dispose();
  });
});
