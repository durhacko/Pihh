// GF-WP-02 (#205): canonical scene form, sceneHash, slotsDigest and the seeded stream. Test GF-T20 of
// docs/validation/gemini-formation-evaluation.md §5 (the parts this package delivers), and the canonical
// byte size GF-T04 checks. Compile-based slotsDigest goldens and the compilerVersion guard arrive with the
// compiler (GF-WP-06, #212). node:crypto is the independent reference for SHA-256 (tests may import Node).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Formation, Vec3 } from '../../../src/contracts';
import { canonicalJson } from '../../../src/score/canonical';
import {
  canonicalSceneBytes, canonicalSceneJson, normaliseScene, SCENE_QUANTUM, sceneHash, sha256Hex, SLOT_QUANTUM, slotsDigest,
} from '../../../src/score/generated/hashing';
import { SFC32_WARMUP, seededStream, sfc32 } from '../../../src/score/generated/prng';
import type { SceneSpec } from '../../../src/score/generated/types';
import { SCENE_LIMITS, utf8Length, validateScene } from '../../../src/score/generated/validation';

const fixtureDir = new URL('../../fixtures/scenes/', import.meta.url);
const sourceDir = new URL('../../../src/score/generated/', import.meta.url);
const text = (name: string) => readFileSync(new URL(name, fixtureDir), 'utf8');
const load = (name: string) => JSON.parse(text(name)) as SceneSpec;
const clone = <T>(v: T): T => structuredClone(v);   // keeps -0 and undefined, unlike a JSON round trip
const VALID = readdirSync(fixtureDir).filter((f) => f.startsWith('valid-') && f.endsWith('.json')).sort();
const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

type Path = (string | number)[];
type Json = Record<string, unknown>;

/** Every [path, value] leaf of a JSON value whose value has the given type. */
function leaves(v: unknown, kind: 'number' | 'string', path: Path = []): [Path, unknown][] {
  if (typeof v === kind) return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, kind, [...path, i]));
  if (v !== null && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, kind, [...path, k]));
  return [];
}
function setAt<T>(root: T, path: Path, value: unknown): T {
  const out = clone(root) as unknown as Json;
  let node = out as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
  return out as unknown as T;
}
/** Deep copy with every object's keys inserted in reverse order. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
  return v;
}
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); }
  return v;
}

// Goldens: sceneHash of each valid fixture. Each also equals node:crypto's SHA-256 of the canonical form
// (checked below), so a change here means the canonical form changed. Never update one silently.
const SCENE_HASH_GOLDEN: Record<string, string> = {
  'valid-2d-annulus.json': '5d4bd7c58979cbd9f2256b193409d5ba8b04f4d998c2de393cbfda8fd02db143',
  'valid-2d-disc.json': '1c2d9a6604611f3c5af608c5512c1e0fc85cf5460c867af79fbf7e7e0015d8dc',
  'valid-2d-elephant-excerpt.json': '72377498cb68f450204ed1846eb4a5ba673d0e8098e75b394293b8e6265ffad5',
  'valid-2d-elephant.json': 'c3289ef6d6eef8d4c724c006fe6cfc9e640e5e0b1b152d9d4e705d0631b79987',
  'valid-2d-heart.json': '4eba6cf9e0e92e81c00d726772eca1140b70e315968eed1eefb91d277e55b946',
  'valid-2d-path-auto-closed.json': 'a46cc676d80f9359043e039b63e67720788c1eb1e2aab7537eda5b79b0707380',
  'valid-2d-rocket.json': '3a74d11f82aa69948db2d86d7910387f064e0bc72b31f6af8a555baf2e206608',
  'valid-2d-two-blobs.json': 'ffa4d662f56b3cd59d6fde0d03ffaf98a4bef1d5f7c1c0451423f2b1fb5f33e3',
  'valid-3d-elephant-excerpt-x.json': '3bc58723fec68fe8ff4be8f80559551062680bd587ae5e006eead461a9c66a27',
  'valid-3d-elephant.json': 'e847a23a6bfbf1ba9cdf6f341f5db0a176eda6ef4a4c6004128042909a1b9ea7',
  'valid-3d-mirrored-pair.json': '6a6a9cd6fea24bbb404857d07a98852a22f77c3e98a32e8343efa5c6854f6c23',
  'valid-3d-primitives.json': '296a85a72236b2b792d89fac80e7dfdf6b13ab3c62e33e32584ccccf3f3bea0e',
  'valid-3d-sphere.json': '4c41caca195079bd1707d5ac0f295964e2ddc3fe30ad68b4ad055a3b4f0c8b83',
  'valid-3d-straight-tube.json': 'b437ab299c38621032a4404bbd77e0145a242947b770df11464f9451f92820d9',
  'valid-3d-two-spheres.json': '1e92bfa395c35dc625cd7951435537af9f5f50444173da9d13e2e5919802324b',
};

describe('sha256Hex: pure TypeScript SHA-256 (§6.7 step 5)', () => {
  it('matches the FIPS 180-4 / NIST test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))
      .toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('equals node:crypto on every length across the padding boundaries (0..200 bytes)', () => {
    for (let n = 0; n <= 200; n++) {
      const s = Array.from({ length: n }, (_, i) => String.fromCharCode(32 + ((i * 7 + n) % 95))).join('');
      expect(sha256Hex(s), `length ${n}`).toBe(nodeSha(s));
    }
  });

  it('equals node:crypto on non-ASCII text, including titles, astral characters and lone surrogates', () => {
    const corpus = [
      'Éléphant', 'Слон', '大象', 'ゾウ 🐘', 'Ünïcödé “quotes” — dash', '😀😃😄', '\u0000\u0001\u007f\u0080߿ࠀ￿',
      '\ud83d', 'x\udc00y', '􏿿', '\ud800𐀀', 'é'.repeat(31) + '€'.repeat(3) + '𝄞',
    ];
    for (const s of corpus) {
      expect(sha256Hex(s), JSON.stringify(s)).toBe(nodeSha(s));
      expect(utf8Length(s)).toBe(Buffer.byteLength(s, 'utf8'));
    }
    // A deterministic sweep of code units from every UTF-8 length class, lone surrogates included.
    let x = 12345;
    for (let k = 0; k < 200; k++) {
      let s = '';
      for (let i = 0; i < k % 80; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; s += String.fromCharCode(x >>> 16); }
      expect(sha256Hex(s)).toBe(nodeSha(s));
    }
  });

  it('equals node:crypto on every fixture file\'s text', () => {
    for (const f of readdirSync(fixtureDir).filter((n) => n.endsWith('.json'))) expect(sha256Hex(text(f)), f).toBe(nodeSha(text(f)));
  });
});

describe('normaliseScene and canonicalSceneJson (§6.7 steps 1–4)', () => {
  it.each(VALID)('%s: equals the canonical scene validateScene returns, so V1b measures the hashed form', (f) => {
    const raw = load(f);
    const result = validateScene(raw);
    if (!result.ok) throw new Error(`fixture ${f} should be valid`);
    expect(normaliseScene(raw)).toEqual(result.scene);
    expect(canonicalSceneJson(raw)).toBe(canonicalJson(result.scene));
    expect(canonicalSceneBytes(raw)).toBe(Buffer.byteLength(canonicalSceneJson(raw), 'utf8'));
    expect(sceneHash(result.scene)).toBe(sceneHash(raw));               // frozen input works and agrees
  });

  it('supplies the canonical byte size GF-T04 checks: the too-large fixture is over the cap by the same count V1b reports', () => {
    const big = load('invalid-too-large-canonical.json');
    const bytes = canonicalSceneBytes(big);
    expect(bytes).toBeGreaterThan(SCENE_LIMITS.canonicalBytes);
    const result = validateScene(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ code: 'too-large', message: expect.stringContaining(`${bytes} bytes`) });
  });

  it('does not mutate its input, accepts frozen input and is idempotent', () => {
    for (const f of VALID) {
      const raw = load(f);
      const before = JSON.stringify(raw);
      const once = normaliseScene(deepFreeze(raw));
      expect(JSON.stringify(raw)).toBe(before);
      expect(normaliseScene(once)).toEqual(once);
      expect(canonicalSceneJson(once)).toBe(canonicalSceneJson(raw));
    }
  });

  it('expands defaults: a missing rotationDeg or symmetry hashes as the explicit default; undefined counts as missing', () => {
    const disc = load('valid-2d-disc.json') as unknown as Json;
    const discGeometry = ((disc.parts as Json[])[0].geometry as Json);
    expect(discGeometry.type).toBe('ellipse');
    const withRot = setAt(disc, ['parts', 0, 'geometry', 'rotationDeg'], 0);
    const withUndefined = clone(disc) as Json;
    ((withUndefined.parts as Json[])[0].geometry as Json).rotationDeg = undefined;
    const without = clone(disc) as Json;
    delete ((without.parts as Json[])[0].geometry as Json).rotationDeg;
    for (const s of [withRot, withUndefined]) expect(sceneHash(s as unknown as SceneSpec)).toBe(sceneHash(without as unknown as SceneSpec));
    expect(canonicalSceneJson(without as unknown as SceneSpec)).toContain('"rotationDeg":0');

    const sphere = load('valid-3d-sphere.json') as unknown as Json;
    const bare = clone(sphere) as Json;
    const part = (bare.parts as Json[])[0];
    delete part.symmetry;
    delete (part.shape as Json).rotationDeg;
    const explicit = setAt(setAt(bare, ['parts', 0, 'symmetry'], 'none'), ['parts', 0, 'shape', 'rotationDeg'], [0, 0, 0]);
    expect(sceneHash(bare as unknown as SceneSpec)).toBe(sceneHash(explicit as unknown as SceneSpec));
    expect(sceneHash(setAt(bare, ['parts', 0, 'symmetry'], 'mirror-x') as unknown as SceneSpec)).not.toBe(sceneHash(bare as unknown as SceneSpec));
  });
});

describe('sceneHash stability (GF-T20)', () => {
  it('has a committed golden per valid fixture, equal to node:crypto over the canonical form', () => {
    const actual = Object.fromEntries(VALID.map((f) => [f, sceneHash(load(f))]));
    for (const f of VALID) expect(actual[f], f).toBe(nodeSha(canonicalSceneJson(load(f))));
    expect(actual).toEqual(SCENE_HASH_GOLDEN);
    expect(new Set(Object.values(actual)).size).toBe(VALID.length);
  });

  it.each(VALID)('%s: unchanged by key order, whitespace, -0 and number noise below the grid', (f) => {
    const raw = load(f);
    const h = sceneHash(raw);
    expect(sceneHash(reverseKeys(raw) as SceneSpec)).toBe(h);
    expect(sceneHash(JSON.parse(JSON.stringify(raw, null, 3)) as SceneSpec)).toBe(h);
    expect(sceneHash(JSON.parse(text(f).replace(/\s+/g, ' ')) as SceneSpec)).toBe(h);
    // Noise of ±0.4 grid steps on every number of the canonical scene rounds back to the same grid point.
    const canonical = normaliseScene(raw);
    let noisy: SceneSpec = canonical;
    leaves(canonical, 'number').forEach(([path, v], i) => {
      if (Number.isInteger(v)) { if (v === 0) noisy = setAt(noisy, path, -0); return; }
      noisy = setAt(noisy, path, (v as number) + (i % 2 ? 0.4 : -0.4) * SCENE_QUANTUM);
    });
    expect(noisy).not.toEqual(canonical);
    expect(sceneHash(noisy)).toBe(h);
  });

  it.each(VALID)('%s: changes when any number moves one grid step, or any string changes', (f) => {
    const canonical = normaliseScene(load(f));
    const h = sceneHash(canonical);
    const seen = new Set([h]);
    const numbers = leaves(canonical, 'number');
    for (const [path, v] of numbers) seen.add(sceneHash(setAt(canonical, path, (v as number) + SCENE_QUANTUM)));
    const strings = leaves(canonical, 'string');
    for (const [path, v] of strings) seen.add(sceneHash(setAt(canonical, path, `${v as string}x`)));
    expect(seen.size).toBe(1 + numbers.length + strings.length);   // every change gives its own hash
  });

  it.each([NaN, Infinity, -Infinity])('rejects %s anywhere with a RangeError naming the path', (bad) => {
    const scene = load('valid-2d-heart.json');
    for (const [path] of leaves(scene, 'number').slice(0, 5)) {
      const broken = setAt(scene, path, bad);
      const where = `/${path.join('/')}`;
      expect(() => normaliseScene(broken)).toThrow(RangeError);
      expect(() => canonicalSceneJson(broken)).toThrow(`non-finite number ${bad} at ${where}`);
      expect(() => sceneHash(broken)).toThrow(RangeError);
    }
  });
});

const FORMATION: Formation = {
  slots: [
    { index: 0, pos: [0, 30, 0], colour: [1, 1, 1] },
    { index: 1, pos: [1.5, 30.25, -0.125], colour: [0.9, 0.1, 0.2] },
    { index: 2, pos: [-1.5, 31.000_000_1, 2], colour: [0.123_456_7, 0.5, 0] },
    { index: 3, pos: [0.333_333_333, 29, -2], colour: [0, 0, 1] },
  ],
  dense: [[0, 30, 0], [1, 30, 0]],
  bounds: { min: [-1.5, 29, -2], max: [1.5, 31, 2] },
};
const SLOTS_DIGEST_GOLDEN = '830ef889f41003cf6ac8ba6912e48963dc88c7103fc2b3fd83d3ece5c9d38ae8';

describe('slotsDigest (§7.1, §8.2)', () => {
  it('is SHA-256 of canonicalJson({ n0, slotSpacingMin, slots: [[index, pos, colour]] }) on the 1e-6 grid, with a golden', () => {
    const spelled = canonicalJson({
      n0: 4, slotSpacingMin: 1.5,
      slots: [[0, [0, 30, 0], [1, 1, 1]], [1, [1.5, 30.25, -0.125], [0.9, 0.1, 0.2]],
        [2, [-1.5, 31, 2], [0.123457, 0.5, 0]], [3, [0.333333, 29, -2], [0, 0, 1]]],
    });
    expect(slotsDigest(FORMATION, 4, 1.5)).toBe(nodeSha(spelled));
    expect(slotsDigest(FORMATION, 4, 1.5)).toBe(SLOTS_DIGEST_GOLDEN);
  });

  it('uses index order, ignores dense and bounds, and is unchanged by -0 and noise below the grid', () => {
    const d = slotsDigest(FORMATION, 4, 1.5);
    expect(slotsDigest({ ...FORMATION, slots: [...FORMATION.slots].reverse() }, 4, 1.5)).toBe(d);
    const otherDense: Formation = { ...FORMATION, dense: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
    expect(slotsDigest(otherDense, 4, 1.5)).toBe(d);
    // Noise of ±0.4 grid steps around each grid point (the raw formation has off-grid values on purpose).
    const onGrid: Formation = { ...FORMATION, slots: FORMATION.slots.map((s) => ({
      index: s.index, pos: s.pos.map((v) => Math.round(v * 1e6) / 1e6) as Vec3, colour: s.colour.map((v) => Math.round(v * 1e6) / 1e6) as Vec3 })) };
    expect(slotsDigest(onGrid, 4, 1.5)).toBe(d);
    let noisy = onGrid;
    leaves(onGrid.slots, 'number').forEach(([path, v], i) => {
      if (path[1] === 'index') return;
      noisy = setAt(noisy, ['slots', ...path], v === 0 ? -0 : (v as number) + (i % 2 ? 0.4 : -0.4) * SLOT_QUANTUM);
    });
    expect(slotsDigest(noisy, 4, 1.5)).toBe(d);
  });

  it('changes with one grid step in any position or colour, with n0, with slotSpacingMin and with an index', () => {
    const d = slotsDigest(FORMATION, 4, 1.5);
    const seen = new Set([d]);
    const numbers = leaves(FORMATION.slots, 'number').filter(([path]) => path[1] !== 'index');
    for (const [path, v] of numbers) seen.add(slotsDigest(setAt(FORMATION, ['slots', ...path], (v as number) + SLOT_QUANTUM), 4, 1.5));
    seen.add(slotsDigest(FORMATION, 5, 1.5));
    seen.add(slotsDigest(FORMATION, 4, 1.6));
    seen.add(slotsDigest(setAt(FORMATION, ['slots', 3, 'index'], 4), 4, 1.5));
    expect(seen.size).toBe(1 + numbers.length + 3);
  });

  it.each([NaN, Infinity, -Infinity])('rejects %s with a RangeError', (bad) => {
    expect(() => slotsDigest(setAt(FORMATION, ['slots', 2, 'pos', 1], bad), 4, 1.5)).toThrow(RangeError);
    expect(() => slotsDigest(setAt(FORMATION, ['slots', 0, 'colour', 0], bad), 4, 1.5)).toThrow(RangeError);
    expect(() => slotsDigest(FORMATION, bad, 1.5)).toThrow(RangeError);
    expect(() => slotsDigest(FORMATION, 4, bad)).toThrow(RangeError);
  });
});

/** Independent sfc32 in BigInt arithmetic, seeded as documented in prng.ts, with node:crypto for the SHA. */
function oracleStream(seedHex: string, label: string): () => number {
  const h = createHash('sha256').update(`${seedHex}\u0000${label}`, 'utf8').digest();
  const M = (1n << 32n) - 1n;
  let [a, b, c, d] = [0, 4, 8, 12].map((i) => BigInt(h.readUInt32BE(i)));
  const next = () => {
    const t = (a + b + d) & M;
    d = (d + 1n) & M;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & M;
    c = ((c << 21n) | (c >> 11n)) & M;
    c = (c + t) & M;
    return Number(t);
  };
  for (let i = 0; i < SFC32_WARMUP; i++) next();
  return () => next() / 2 ** 32;
}
const draw = (next: () => number, n: number) => Array.from({ length: n }, next);
const SEED = sha256Hex('a scene');
const STREAM_GOLDEN = [0.3632534935604781, 0.38698323140852153, 0.8936689025722444, 0.2507771421223879];

describe('seededStream: sfc32 seeded from sceneHash, one stream per label (§7.12)', () => {
  it('equals an independent BigInt sfc32 with the documented seeding, and a golden prefix', () => {
    for (const label of ['candidates', 'fps', '', 'é😀']) expect(draw(seededStream(SEED, label), 2000)).toEqual(draw(oracleStream(SEED, label), 2000));
    expect(draw(seededStream(SEED, 'candidates'), 4)).toEqual(STREAM_GOLDEN);
  });

  it('is identical across two calls and keeps no global state (interleaving does not matter)', () => {
    const a = seededStream(SEED, 'candidates');
    const b = seededStream(SEED, 'candidates');
    const other = seededStream(SEED, 'fps');
    const fromA: number[] = [];
    const fromB: number[] = [];
    for (let i = 0; i < 500; i++) { fromA.push(a()); other(); other(); fromB.push(b()); }
    expect(fromA).toEqual(fromB);
    expect(fromA).toEqual(draw(seededStream(SEED, 'candidates'), 500));
  });

  it('is independent between labels and between seeds', () => {
    const streams = [seededStream(SEED, 'candidates'), seededStream(SEED, 'candidates2'), seededStream(SEED, 'fps'),
      seededStream(sha256Hex('another scene'), 'candidates')].map((s) => draw(s, 256));
    for (let i = 0; i < streams.length; i++) {
      for (let j = i + 1; j < streams.length; j++) {
        const equalAt = streams[i].filter((v, k) => v === streams[j][k]).length;
        expect(equalAt, `streams ${i} and ${j}`).toBe(0);
      }
    }
  });

  it('draws exact multiples of 2^-32 in [0, 1), roughly uniform', () => {
    const values = draw(seededStream(SEED, 'uniform'), 20_000);
    for (const v of values) {
      expect(v >= 0 && v < 1).toBe(true);
      expect(Number.isInteger(v * 2 ** 32)).toBe(true);
    }
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    const buckets = new Array(10).fill(0);
    for (const v of values) buckets[Math.floor(v * 10)]++;
    for (const n of buckets) expect(Math.abs(n - 2000)).toBeLessThan(200);
  });

  it('sfc32 returns uint32s and depends on all four state words', () => {
    const base = draw(sfc32(1, 2, 3, 4), 16);
    for (const v of base) expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    for (const seed of [[0, 2, 3, 4], [1, 0, 3, 4], [1, 2, 0, 4], [1, 2, 3, 0]]) {
      expect(draw(sfc32(seed[0], seed[1], seed[2], seed[3]), 16)).not.toEqual(base);
    }
  });
});

describe('purity of hashing.ts and prng.ts', () => {
  it.each(['hashing.ts', 'prng.ts'])('%s uses no clock, randomness, crypto, platform encoder or Math.hypot', (file) => {
    const source = readFileSync(new URL(file, sourceDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of [/\bDate\b/, /\bperformance\b/, /Math\.random/, /\bcrypto\b/, /Math\.hypot/, /\bTextEncoder\b/,
      /\bBuffer\b/, /\bglobalThis\b/, /\bfetch\b/, /\brequire\(/, /from 'node:/]) {
      expect(source, `${file} ${banned}`).not.toMatch(banned);
    }
  });
});
