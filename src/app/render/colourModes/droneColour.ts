import type { DroneSnap, RGB } from '../../../contracts';
import { versionColour } from './belief';
import { readViewMode } from './viewMode';

/** Display tint only. Never writes snapshot RGB, beliefs or partition membership. */
export function droneColour(drone: DroneSnap, interpolatedColour: RGB): RGB {
  const mode = readViewMode();
  let colour: RGB = mode.beliefColours ? versionColour(drone.belief.version) : [...interpolatedColour];
  if (mode.xray && drone.partitionSide !== null && !mode.beliefColours) {
    const tint: RGB = drone.partitionSide === 0 ? [0, 0.7, 0.9] : [0.95, 0.65, 0.1];
    colour = colour.map((value, index) => value * 0.5 + tint[index] * 0.5) as RGB;
  }
  return mode.xray ? colour.map(value => value * 0.25) as RGB : colour;
}
