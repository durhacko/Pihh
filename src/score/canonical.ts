// src/score/canonical.ts
// The one canonical-JSON rule (XI-7, XI-19): run records' paramsHash, and later sceneHash (GF-WP-02),
// MongoDB contentHash (#130) and Tiger artifact hashes (#142). Pure: no imports, no platform globals,
// so src/score and everything that may import it can share it. Never write a second copy.
// Moved byte for byte from src/cli/run.ts (#221); src/cli/run.ts imports and re-exports it.

/** JSON with object keys sorted at every level, so equal params always hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}
