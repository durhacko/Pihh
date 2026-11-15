import type { RGB, ScoreVersion } from '../../../contracts';

const palette: readonly RGB[] = [[0.9, 0.62, 0], [0, 0.62, 0.45], [0.8, 0.47, 0.65], [0.94, 0.89, 0.26]];

/**
 * Colour per score version (#134 P1-10). A version keeps its colour for as long as it is mapped. A new version takes
 * the first palette colour no mapped version holds; when all are taken, it takes the colour of the version used
 * LEAST RECENTLY, which is dropped. Every rendered view colours every live drone on every frame, so versions that
 * are still held stay recent: their colours stay distinct as long as at most palette.length versions are held at
 * once (more cannot be told apart by four colours anyway). resetVersionColours() runs on every world reset.
 */
const versions = new Map<string, { index: number; used: number }>();
let clock = 0;

export function versionKey(version: ScoreVersion): string { return `${version.issuedTick}:${version.origin}`; }

export function versionColour(version: ScoreVersion): RGB {
  const key = versionKey(version);
  clock++;
  let entry = versions.get(key);
  if (entry === undefined) {
    const taken = new Set([...versions.values()].map(e => e.index));
    let index = palette.findIndex((_, i) => !taken.has(i));
    if (index < 0) {
      let oldest: string | null = null;
      for (const [k, e] of versions) if (oldest === null || e.used < versions.get(oldest)!.used) oldest = k;
      index = versions.get(oldest!)!.index;
      versions.delete(oldest!);
    }
    entry = { index, used: clock };
    versions.set(key, entry);
  }
  entry.used = clock;
  return [...palette[entry.index]];
}

export function resetVersionColours(): void { versions.clear(); clock = 0; }
