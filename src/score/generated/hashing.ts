// Canonical scene form, sceneHash and slotsDigest (GF-WP-02), following the canonical spec
// docs/integrations/gemini-generated-formations.md §6.7 (canonicalisation, sceneHash), §7.1 and
// §8.2 (slotsDigest). Pure: imports only src/score and src/contracts; no clock, no randomness,
// no platform globals (no TextEncoder, no crypto). SHA-256 is hand-written with 32-bit integer
// operations only, so it is exact in every engine and equals node:crypto's digest.
//
// Encore recomputes sceneHash; it never trusts a hash from the model, the gateway or a recipe's
// own field (§6.7). The compiler compiles normaliseScene(scene), never the raw scene, so two
// scenes with the same hash compile identically.

import { canonicalJson } from '../canonical';
import type { SceneSpec } from './types';
import { quantise, SCENE_QUANTUM, utf8Length } from './validation';

/** §6.7 step 3: the scene grid. Defined once, in validation.ts (GF-WP-01); re-exported here. */
export { SCENE_QUANTUM };

/** §7.1 / §8.2: slot positions and colours are put on this grid before slotsDigest. */
export const SLOT_QUANTUM = 1e-6;

type Obj = Record<string, unknown>;

/**
 * The part of the contract's Formation (src/contracts/score.ts) that slotsDigest reads. Structural, so
 * every Formation is accepted while src/score/generated keeps importing only itself and ../canonical
 * (tests/score/generated/validation.test.ts, GF-WP-01).
 */
export interface FormationSlots {
  readonly slots: readonly { readonly index: number; readonly pos: readonly number[]; readonly colour: readonly number[] }[];
}

/**
 * §6.7 steps 1–3 on a V3-valid scene: every non-integer number on the 1e-4 grid, -0 as 0, and
 * defaults expanded (a missing rotationDeg becomes 0 / [0, 0, 0] and a missing 3D symmetry 'none';
 * a hex foreground stays a string). Returns a new object and never mutates its input, which may be
 * frozen. A key whose value is undefined counts as missing. Idempotent.
 * Throws RangeError on NaN or ±Infinity anywhere (§6.7 step 3: checked again, though V3 rejects them).
 */
export function normaliseScene(scene: SceneSpec): SceneSpec {
  const out = normalise(scene, '') as Obj;
  // The same expansion as validation.ts's canonicalise on V3-valid scenes; guarded so that other
  // input is normalised without throwing (only non-finite numbers throw).
  for (const part of Array.isArray(out.parts) ? out.parts : []) {
    if (!isObj(part)) continue;
    if (out.mode === 'silhouette2d') {
      const g = part.geometry;
      if (isObj(g) && g.type === 'ellipse' && !Object.hasOwn(g, 'rotationDeg')) g.rotationDeg = 0;
    } else if (out.mode === 'scene3d') {
      const s = part.shape;
      if (isObj(s) && s.type !== 'taperedTube' && !Object.hasOwn(s, 'rotationDeg')) s.rotationDeg = [0, 0, 0];
      if (!Object.hasOwn(part, 'symmetry')) part.symmetry = 'none';
    }
  }
  return out as unknown as SceneSpec;
}

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalise(v: unknown, path: string): unknown {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError(`normaliseScene: non-finite number ${v} at ${path || '/'}`);
    return quantise(v);
  }
  if (Array.isArray(v)) return v.map((x, i) => normalise(x, `${path}/${i}`));
  if (v !== null && typeof v === 'object') {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = normalise(x, `${path}/${k}`);
    return out;
  }
  return v;
}

/** §6.7 step 4: the repo's one canonical JSON (XI-7) of the normalised scene. Throws RangeError on NaN or ±Infinity. */
export function canonicalSceneJson(scene: SceneSpec): string {
  return canonicalJson(normaliseScene(scene));
}

/** UTF-8 byte length of the canonical form: the `sceneBytes` that V1b caps at 16 KB (§6.5, GF-T04). */
export function canonicalSceneBytes(scene: SceneSpec): number {
  return utf8Length(canonicalSceneJson(scene));
}

/** §6.7: SHA-256 hex of the canonical form's UTF-8 bytes. Recomputed by Encore, never trusted from elsewhere. */
export function sceneHash(scene: SceneSpec): string {
  return sha256Hex(canonicalSceneJson(scene));
}

/**
 * §7.1 / §8.2: SHA-256 hex over the canonical slot list [index, pos, colour] in index order, with
 * positions and colours on the 1e-6 grid (-0 as 0), together with n0 and slotSpacingMin. It is the
 * string CompileResult.slotsDigest and SlotsDigest.digest hold. Throws RangeError on a non-finite input.
 * Bytes: canonicalJson({ n0, slotSpacingMin, slots: [[index, [x, y, z], [r, g, b]], ...] }).
 */
export function slotsDigest(formation: FormationSlots, n0: number, slotSpacingMin: number): string {
  finite(n0, 'n0');
  finite(slotSpacingMin, 'slotSpacingMin');
  const slots = formation.slots
    .map((s, i) => [finite(s.index, `slots/${i}/index`), s.pos.map((v, j) => onSlotGrid(v, `slots/${i}/pos/${j}`)),
      s.colour.map((v, j) => onSlotGrid(v, `slots/${i}/colour/${j}`))] as const)
    .sort((a, b) => a[0] - b[0]);
  return sha256Hex(canonicalJson({ n0, slotSpacingMin, slots }));
}

function finite(v: number, what: string): number {
  if (!Number.isFinite(v)) throw new RangeError(`slotsDigest: non-finite number ${v} at ${what}`);
  return v;
}

function onSlotGrid(v: number, what: string): number {
  const q = Math.round(finite(v, what) * 1e6) / 1e6;   // SLOT_QUANTUM
  return q === 0 ? 0 : q;
}

// ---------------------------------------------------------------- SHA-256 (FIPS 180-4)

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** SHA-256 hex of the UTF-8 encoding of `text` (§6.7 step 5). Lone surrogates encode as U+FFFD, as node:crypto does. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const length = bytes.length;
  const blocks = Math.ceil((length + 9) / 64);
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < length; i++) words[i >>> 2] |= bytes[i] << (24 - 8 * (i & 3));
  words[length >>> 2] |= 0x80 << (24 - 8 * (length & 3));
  const bits = length * 8;                                   // exact below 2^53
  words[words.length - 2] = Math.floor(bits / 0x100000000);
  words[words.length - 1] = bits >>> 0;
  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let block = 0; block < blocks; block++) {
    for (let t = 0; t < 16; t++) w[t] = words[block * 16 + t];
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15];
      const b = w[t - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 without platform encoders; the same rule as utf8Length (lone surrogates become U+FFFD). */
function utf8Bytes(s: string): Uint8Array {
  const out = new Uint8Array(utf8Length(s));
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) { out[o++] = c; continue; }
    if (c < 0x800) { out[o++] = 0xc0 | (c >> 6); out[o++] = 0x80 | (c & 0x3f); continue; }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      out[o++] = 0xf0 | (cp >> 18); out[o++] = 0x80 | ((cp >> 12) & 0x3f);
      out[o++] = 0x80 | ((cp >> 6) & 0x3f); out[o++] = 0x80 | (cp & 0x3f);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;             // lone surrogate
    out[o++] = 0xe0 | (c >> 12); out[o++] = 0x80 | ((c >> 6) & 0x3f); out[o++] = 0x80 | (c & 0x3f);
  }
  return out;
}
