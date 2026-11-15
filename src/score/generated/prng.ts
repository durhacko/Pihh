// Seeded randomness for the formation compiler (GF-WP-02), spec
// docs/integrations/gemini-generated-formations.md §7.12: sfc32, integer-only, seeded from sceneHash,
// one independent stream per label, no global state. Never Math.random, Date or performance.
//
// Seeding (approved default for #205; the spec does not fix it): the four sfc32 state words are the
// first four big-endian 32-bit words of sha256Hex(seedHex + '\u0000' + label), followed by
// SFC32_WARMUP discarded outputs. Each draw is a uint32 divided by 2^32: an exact double in [0, 1).

import { sha256Hex } from './hashing';

/** Outputs discarded after seeding, so related seeds have diverged before the first draw. */
export const SFC32_WARMUP = 12;

/** sfc32 (PractRand's small fast chaotic generator, 32-bit). Each call returns the next uint32. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  a |= 0; b |= 0; c |= 0; d |= 0;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/** The stream for one label: deterministic in (seedHex, label), independent of every other label. Values in [0, 1). */
export function seededStream(seedHex: string, label: string): () => number {
  const h = sha256Hex(`${seedHex}\u0000${label}`);
  const word = (i: number) => parseInt(h.slice(8 * i, 8 * i + 8), 16);
  const next = sfc32(word(0), word(1), word(2), word(3));
  for (let i = 0; i < SFC32_WARMUP; i++) next();
  return () => next() / 4294967296;
}
