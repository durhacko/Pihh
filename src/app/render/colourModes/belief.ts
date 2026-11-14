import type { RGB, ScoreVersion } from '../../../contracts';

const palette: readonly RGB[] = [[0.9, 0.62, 0], [0, 0.62, 0.45], [0.8, 0.47, 0.65], [0.94, 0.89, 0.26]];
const versions = new Map<string, RGB>();
export function versionKey(version: ScoreVersion): string { return `${version.issuedTick}:${version.origin}`; }
export function versionColour(version: ScoreVersion): RGB {
  const key = versionKey(version);
  if (!versions.has(key)) versions.set(key, [...palette[versions.size % palette.length]]);
  return [...versions.get(key)!];
}
export function resetVersionColours(): void { versions.clear(); }
