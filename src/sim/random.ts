/** Integer-only avalanche: the world and each brain get separate seeded streams. */
export function hashSeed(seed: number, id: number): number {
  let x = (seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x85ebca6b);
  x = Math.imul(x ^ x >>> 13, 0xc2b2ae35);
  return (x ^ x >>> 16) >>> 0;
}

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = state + 0x6d2b79f5 >>> 0;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
