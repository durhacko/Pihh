import { afterEach, describe, expect, it } from 'vitest';
import { makeFakeSnapshot } from '../../fixtures/fakeSnapshot';
import { DeathTrace } from '../../../src/app/render/colourModes/deathTrace';
import { droneColour } from '../../../src/app/render/colourModes/droneColour';
import { resetVersionColours, versionColour } from '../../../src/app/render/colourModes/belief';
import { readViewMode, resetViewMode, setViewMode } from '../../../src/app/render/colourModes/viewMode';

afterEach(() => { resetViewMode(); resetVersionColours(); });

describe('death evidence', () => {
  it('flashes exactly once on an observed death, freezes while paused, then hides in audience mode', () => {
    const trace = new DeathTrace(); const before = makeFakeSnapshot(10, 5); const after = makeFakeSnapshot(11, 5);
    after.drones[0].alive = false; after.drones[0].diedTick = 11;
    trace.update(before, after); expect(trace.markers(11, 0, false)).toHaveLength(1);
    expect(trace.markers(11, 0, false)[0].flash).toBe(1);
    for (let i = 0; i < 20; i++) trace.update(before, after);
    expect(trace.markers(11, 0, false)[0].flash).toBe(1);
    expect(trace.markers(20, 0, false)).toHaveLength(0);
    expect(trace.markers(20, 0, true).find(death => death.id === 0)?.cross).toBe(true);
    const later = makeFakeSnapshot(30, 5); later.drones[0] = after.drones[0]; trace.update(after, later);
    expect(trace.markers(30, 0, false)).toHaveLength(0);
  });
  it('shows existing dead drones as X-ray crosses without inventing a new death flash', () => {
    const trace = new DeathTrace(); const snap = makeFakeSnapshot(0, 5); trace.update(snap, snap);
    expect(trace.markers(0, 0, false)).toHaveLength(0); expect(trace.markers(0, 0, true).map(death => death.id)).toEqual([3]);
  });
});

describe('display-only colours', () => {
  it('defaults to audience and returns copies of settings and colours', () => {
    expect(readViewMode()).toEqual({ xray: false, beliefColours: false, selectedDroneId: null });
    const drone = makeFakeSnapshot(0, 5).drones[0]; const rgb: [number, number, number] = [0.8, 0.4, 0.2];
    expect(droneColour(drone, rgb)).toEqual(rgb); expect(droneColour(drone, rgb)).not.toBe(rgb);
    setViewMode({ xray: true }); expect(droneColour(drone, rgb)).toEqual([0.2, 0.1, 0.05]); expect(rgb).toEqual([0.8, 0.4, 0.2]);
  });
  it('assigns versions in first-observed order and uses the actual snapshot version', () => {
    const first = { issuedTick: 10, origin: 4 }; const second = { issuedTick: 2, origin: 1 };
    const colour = versionColour(first); expect(versionColour(second)).not.toEqual(colour); expect(versionColour(first)).toEqual(colour);
    const drone = makeFakeSnapshot(0, 5).drones[0]; drone.belief.version = first; const before = JSON.stringify(drone);
    setViewMode({ beliefColours: true }); expect(droneColour(drone, [0, 0, 0])).toEqual(colour); expect(JSON.stringify(drone)).toBe(before);
  });
  it('tints only actual partition members in X-ray mode', () => {
    const drone = makeFakeSnapshot(0, 5).drones[0]; setViewMode({ xray: true });
    const neutral = droneColour(drone, [1, 1, 1]); drone.partitionSide = 0; const left = droneColour(drone, [1, 1, 1]); drone.partitionSide = 1;
    expect(left).not.toEqual(neutral); expect(droneColour(drone, [1, 1, 1])).not.toEqual(left);
  });
});
