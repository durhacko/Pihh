// GF-WP-07 (#215): GF-CC-01 (the generated recipe kind) and GF-CC-02 (slotsDigest, the adoption check, copyRecipe on
// adoption). Legacy behaviour is pinned first; then the generated path through compose, expansion and the brain.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeParams } from '../../src/contracts';
import type { GeneratedRecipe, Recipe, RunRecord, Score } from '../../src/contracts';
import type { ScenarioId } from '../../src/cli/scenarios';
import { encoreBrain } from '../../src/agent/encoreBrain';
import type { EncoreState } from '../../src/agent/state';
import { BRAINS } from '../../src/cli/brains';
import { getObserverFactory } from '../../src/cli/observer';
import { runOne } from '../../src/cli/run';
import {
  acceptsRecipe, composeNext, sceneHashOf, copyRecipe, expandRecipe, expandRecipeStrict, GeneratedSceneRejected, isFallbackFormation,
  makeGeneratedRecipe, makeScore,
} from '../../src/score';
import { isPackageFrozenScene } from '../../src/score/compose';   // internal (for GF-WP-08), not public API
import { canonicalJson } from '../../src/score/canonical';
import { COMPILER_VERSION } from '../../src/score/generated/compile';
import { sceneHash } from '../../src/score/generated/hashing';
import { createWorld } from '../../src/sim';

const root = resolve(__dirname, '../..');
const sha = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const scene = (name: string): unknown => JSON.parse(readFileSync(resolve(root, 'tests/fixtures/scenes', name), 'utf8'));

// ------------------------------------------------------------------------------------------------ legacy, pinned

// Computed on phase2/development 1039027 (before GF-CC-01) and on this branch: identical (PR evidence).
const LEGACY_PINS: Record<string, string> = {
  '{"kind":"text","text":"ENCORE"}|40': '24832b32e79202ee84bec204359ed822de5f22f96f5038d85d4353ff70f1bed1',
  '{"kind":"sphere"}|40': 'f533a287879c9879dcb63e8ef0ec741158e696fb53970d9830c2fa324594ccae',
  '{"kind":"helix"}|40': 'f98a7a8f603f4eabcb44d3b5d6c43e2e910edcfe1c4f3ccf94a7586a64ce54be',
  '{"kind":"text","text":"HI","palette":[[1,0,0],[0,0,1]]}|40': '6cfd3098043f6a7824a637ce26055638d649e3ae6888d90c3bd16d9a46f8488c',
  'makeScore|40': 'd1a66d25b544f46665cf1fe08a7eb8f0470d3ca2f8bd80f4cbf15a60c5d19fc5',
  '{"kind":"text","text":"ENCORE"}|100': '5925bf00c407972204653daa588bd0833f2f7a3fe1d36468b50af511f85dfbe9',
  '{"kind":"sphere"}|100': '59d54f147faf59cc510f761313028248bcd881fce0eb73163d372b67654e4ff0',
  '{"kind":"helix"}|100': 'e58f2cce7a9d57f5f32fd9008e56c4d65784c46f2ad347878cf4ea50012e80b0',
  '{"kind":"text","text":"HI","palette":[[1,0,0],[0,0,1]]}|100': '7bf3ceb3313de90a24b7c19edd20b731aa60e2ecb5f78c07b052b7e18f11c70c',
  'makeScore|100': 'f3744a4ae607b8b2571fe9ed469b4990b8a5b805f005c6900a7467d79681080a',
  '{"kind":"text","text":"ENCORE"}|200': 'c22f55b5a87ff0258a07027fc54b0ca1f65f7795533d0f345c8f2b444c7caf2f',
  '{"kind":"sphere"}|200': '4c613abf23b0cc8dab09f85e7aff921680dd53827e704eb7d5136bd6f95be5ff',
  '{"kind":"helix"}|200': '24573b6f2dfda4b476ab14917819986ffb6d9d2039789c96565983c4f3ff4ce0',
  '{"kind":"text","text":"HI","palette":[[1,0,0],[0,0,1]]}|200': 'f0ffa3b232000734d0cf41ac73d0a2c398a5e94e7db8e23a0b6f21a306bec15b',
  'makeScore|200': '853766c6699d6a0a6ee16e00f7018b40493492130e453dac9aba0bd42d028060',
};
const LEGACY: Recipe[] = [{ kind: 'text', text: 'ENCORE' }, { kind: 'sphere' }, { kind: 'helix' }, { kind: 'text', text: 'HI', palette: [[1, 0, 0], [0, 0, 1]] }];

describe('GF-CC-01/02 leave legacy recipes byte-identical', () => {
  it.each([40, 100, 200])('n0 = %i: every legacy formation and makeScore hash as before the change', (n0) => {
    const params = makeParams(n0);
    for (const r of LEGACY) expect(sha(expandRecipe(r, n0, params)), JSON.stringify(r)).toBe(LEGACY_PINS[`${JSON.stringify(r)}|${n0}`]);
    expect(sha(makeScore(LEGACY, n0, params))).toBe(LEGACY_PINS[`makeScore|${n0}`]);
  });

  it('legacy recipes are always accepted, with no work, and never the fallback', () => {
    const params = makeParams(40);
    for (const r of LEGACY) {
      expect(acceptsRecipe(r, 40, params)).toBe(true);
      expect(isFallbackFormation(expandRecipe(r, 40, params))).toBe(false);
      expect(expandRecipeStrict(r, 40, params)).toBe(expandRecipe(r, 40, params));
    }
  });

  // S5 injects one score into one drone at tick 400, which reaches the swarm over the radio: adoption and gossip.
  it('the committed S5 n0 = 200 encore record re-derives: stateHash and paramsHash unchanged, no refused field', () => {
    const committed = JSON.parse(readFileSync(resolve(root, 'results/S5_n200_encore_s1.json'), 'utf8')) as RunRecord;
    expect(committed.events.filter(e => e.type === 'INJECT_SCORE')).toHaveLength(1);
    const record = runOne({
      scenario: committed.scenario as ScenarioId, seed: committed.seed, arm: committed.arm, n0: committed.n0,
      brains: BRAINS, makeObserver: getObserverFactory(), git: committed.git,
    });
    expect(record.stateHash).toBe(committed.stateHash);
    expect(record.paramsHash).toBe(committed.paramsHash);
  }, 180_000);
});

// ------------------------------------------------------------------------------------------------ the generated kind

const N0 = 40;
const params = makeParams(N0);
const made = makeGeneratedRecipe(scene('valid-3d-sphere.json'), N0, params);
if (!made.ok) throw new Error(`fixture did not compile: ${made.code} ${made.detail}`);
const generated: GeneratedRecipe = made.recipe;

describe('GF-CC-01: makeGeneratedRecipe, copyRecipe, expansion', () => {
  it('labels come from one compile at this roster; the scene is canonical, frozen and package-frozen', () => {
    expect(generated.kind).toBe('generated');
    expect(generated.compilerVersion).toBe(COMPILER_VERSION);
    expect(generated.sceneHash).toBe(sceneHash(generated.scene));
    expect(generated.slotsDigest).toEqual({ n0: N0, slotSpacingMin: params.slotSpacingMin, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(Object.isFrozen(generated.scene)).toBe(true);
    expect(isPackageFrozenScene(generated.scene)).toBe(true);
    expect('palette' in generated).toBe(false);
  });

  it('invalid and rejected scenes are typed results, never a throw', () => {
    expect(makeGeneratedRecipe({ version: 1 }, N0, params)).toMatchObject({ ok: false, code: 'schema' });
    expect(makeGeneratedRecipe(null, N0, params).ok).toBe(false);
  });

  it('copyRecipe shares nothing, freezes the scene, keeps the JSON', () => {
    const copy = copyRecipe(generated) as GeneratedRecipe;
    expect(copy).not.toBe(generated);
    expect(copy.scene).not.toBe(generated.scene);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(generated));
    expect(Object.isFrozen(copy.scene) && isPackageFrozenScene(copy.scene)).toBe(true);
    expect(() => { (copy.scene as { title: string }).title = 'changed'; }).toThrow(TypeError);
  });

  it('expandRecipe compiles the scene: n0 slots, frozen, deterministic, not the fallback', () => {
    const f = expandRecipe(generated, N0, params);
    expect(f.slots).toHaveLength(N0);
    expect(Object.isFrozen(f)).toBe(true);
    expect(isFallbackFormation(f)).toBe(false);
    expect(expandRecipeStrict(generated, N0, params)).toBe(f);
    expect(sha(expandRecipe(copyRecipe(generated), N0, params))).toBe(sha(f));
  });

  it('composeNext and makeScore round-trip a generated recipe, with the slotsDigest of the compile that timed it', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const next = composeNext(pre, 100, generated, 3, N0, params);
    const carried = next.movements[1]!.recipe as GeneratedRecipe;
    expect(carried.kind).toBe('generated');
    expect(carried.sceneHash).toBe(generated.sceneHash);
    expect(carried.slotsDigest).toEqual(generated.slotsDigest);
    expect(isPackageFrozenScene(carried.scene)).toBe(true);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);   // plain JSON: it travels over the radio as is
    const score = makeScore([{ kind: 'sphere' }, generated], N0, params);
    expect((score.movements[1]!.recipe as GeneratedRecipe).slotsDigest.n0).toBe(N0);
    // Composed at another roster, the digest is that roster's.
    const p100 = makeParams(100);
    expect((composeNext(makeScore([{ kind: 'sphere' }], 100, p100), 100, generated, 3, 100, p100).movements[1]!.recipe as GeneratedRecipe).slotsDigest.n0).toBe(100);
  });
});

describe('GF-CC-01 §7.11: strict throws, total falls back', () => {
  const mutated: GeneratedRecipe = { ...generated, scene: { ...generated.scene, title: 'Mutated' } as GeneratedRecipe['scene'] };
  // A scene the compiler rejects (no parts: a schema failure), labelled as if it were fine.
  const rejectedScene = { ...generated.scene, parts: [] } as GeneratedRecipe['scene'];
  const rejectedRecipe: GeneratedRecipe = { kind: 'generated', compilerVersion: COMPILER_VERSION, sceneHash: 'a'.repeat(64), slotsDigest: { n0: N0, slotSpacingMin: params.slotSpacingMin, digest: '0'.repeat(64) }, scene: rejectedScene };
  const wrongCompiler: GeneratedRecipe = { ...generated, compilerVersion: COMPILER_VERSION + 1 };

  it.each([
    ['a sceneHash label that is not the scene', mutated, 'hash-mismatch'],
    ['a compiler version this build is not', wrongCompiler, 'unsupported-compiler'],
  ] as const)('strict: %s throws GeneratedSceneRejected', (_, recipe, code) => {
    expect(() => expandRecipeStrict(recipe, N0, params)).toThrow(GeneratedSceneRejected);
    try { expandRecipeStrict(recipe, N0, params); } catch (e) { expect((e as GeneratedSceneRejected).code).toBe(code); }
  });

  it('a scene the compiler rejects: strict throws its code; total returns the frozen fallback, never a throw', () => {
    let code = '';
    try { expandRecipeStrict(rejectedRecipe, N0, params); } catch (e) { code = (e as GeneratedSceneRejected).code; }
    expect(code).toBe('schema');
    const total = expandRecipe(rejectedRecipe, N0, params);
    expect(isFallbackFormation(total)).toBe(true);
    expect(total.slots).toHaveLength(N0);
    expect(Object.isFrozen(total)).toBe(true);
    expect(isFallbackFormation(expandRecipe({ kind: 'sphere' }, N0, params))).toBe(false);   // a real sphere is not
    expect(() => composeNext(makeScore([{ kind: 'sphere' }], N0, params), 100, rejectedRecipe, 3, N0, params)).toThrow(GeneratedSceneRejected);
    expect(() => makeScore([rejectedRecipe], N0, params)).toThrow(GeneratedSceneRejected);
  });

  it('total path: every rejected generated recipe flies the fallback, a wrong label included (WP-07 acceptance)', () => {
    expect(isFallbackFormation(expandRecipe(wrongCompiler, N0, params))).toBe(true);   // §6.4: another compiler's
    expect(isFallbackFormation(expandRecipe(mutated, N0, params))).toBe(true);         // a valid scene, wrong sceneHash
    expect(isFallbackFormation(expandRecipe(rejectedRecipe, N0, params))).toBe(true);  // a rejected compile
    expect(isFallbackFormation(expandRecipe(generated, N0, params))).toBe(false);
    // The total path agrees with acceptsRecipe and the strict path on every one of them.
    for (const r of [wrongCompiler, mutated, rejectedRecipe]) {
      expect(acceptsRecipe(r, N0, params)).toBe(false);
      expect(() => expandRecipeStrict(r, N0, params)).toThrow(GeneratedSceneRejected);
    }
  });

  it('strict: a slotsDigest label for THIS roster must match the compile (digest-mismatch); one for another roster is not compared', () => {
    const tampered: GeneratedRecipe = { ...generated, slotsDigest: { ...generated.slotsDigest, digest: 'f'.repeat(64) } };
    let code = '';
    try { expandRecipeStrict(tampered, N0, params); } catch (e) { code = (e as GeneratedSceneRejected).code; }
    expect(code).toBe('digest-mismatch');
    const otherRoster: GeneratedRecipe = { ...generated, slotsDigest: { n0: 999, slotSpacingMin: 9, digest: 'f'.repeat(64) } };
    expect(expandRecipeStrict(otherRoster, N0, params).slots).toHaveLength(N0);
  });

  it('a missing, null or malformed slotsDigest: strict throws digest-mismatch, total falls back, acceptsRecipe refuses (one rule)', () => {
    const bad = [
      (() => { const r: Partial<GeneratedRecipe> = { ...generated }; delete r.slotsDigest; return r; })(),
      { ...generated, slotsDigest: null },
      { ...generated, slotsDigest: { n0: N0, slotSpacingMin: params.slotSpacingMin, digest: 7 } },
      { ...generated, slotsDigest: { n0: 'x', slotSpacingMin: params.slotSpacingMin, digest: generated.slotsDigest.digest } },
    ] as unknown as GeneratedRecipe[];
    for (const r of bad) {
      let code = '';
      try { expandRecipeStrict(r, N0, params); } catch (e) { code = (e as GeneratedSceneRejected).code; }
      expect(code).toBe('digest-mismatch');
      expect(isFallbackFormation(expandRecipe(r, N0, params))).toBe(true);
      expect(acceptsRecipe(r, N0, params)).toBe(false);
    }
  });

  it('acceptsRecipe (GF-CC-02): refuses each mismatch, never throws, ignores a digest made for another roster', () => {
    expect(acceptsRecipe(generated, N0, params)).toBe(true);
    expect(acceptsRecipe(mutated, N0, params)).toBe(false);
    expect(acceptsRecipe(wrongCompiler, N0, params)).toBe(false);
    expect(acceptsRecipe(rejectedRecipe, N0, params)).toBe(false);
    expect(acceptsRecipe({ ...generated, slotsDigest: { ...generated.slotsDigest, digest: 'f'.repeat(64) } }, N0, params)).toBe(false);
    expect(acceptsRecipe({ ...generated, slotsDigest: { n0: 999, slotSpacingMin: 9, digest: 'f'.repeat(64) } }, N0, params)).toBe(true);
    expect(acceptsRecipe({ ...generated, scene: null } as unknown as GeneratedRecipe, N0, params)).toBe(false);
    expect(acceptsRecipe({ ...generated, sceneHash: 42 } as unknown as GeneratedRecipe, N0, params)).toBe(false);
  });

  it('the adoption memo (#289) keys on the scene JSON only: labels are compared on every hit, an edited scene is recomputed', () => {
    const copy = (): GeneratedRecipe => JSON.parse(JSON.stringify(generated)) as GeneratedRecipe;
    expect(acceptsRecipe(copy(), N0, params)).toBe(true);                                         // fills the memo
    expect(acceptsRecipe({ ...copy(), sceneHash: 'a'.repeat(64) }, N0, params)).toBe(false);     // hit, wrong hash label
    expect(acceptsRecipe({ ...copy(), slotsDigest: { ...generated.slotsDigest, digest: 'f'.repeat(64) } }, N0, params)).toBe(false);
    expect(acceptsRecipe({ ...copy(), compilerVersion: COMPILER_VERSION + 1 }, N0, params)).toBe(false);
    expect(acceptsRecipe(copy(), N0, params)).toBe(true);                                         // the memo was not poisoned
    // An unfrozen scene edited after one check is checked as it is now: its JSON, and so its key, changed.
    const editable = copy();
    expect(acceptsRecipe(editable, N0, params)).toBe(true);
    (editable.scene as { title: string }).title = 'Edited after the check';
    expect(acceptsRecipe(editable, N0, params)).toBe(false);
    expect(sceneHashOf(editable)).toMatch(/^[0-9a-f]{64}$/);
    expect(sceneHashOf(editable)).not.toBe(generated.sceneHash);
  });

  it('GF-T23: an unknown recipe kind fails to typecheck', () => {
    // @ts-expect-error: 'cube' is not a Recipe kind
    const bad: Recipe = { kind: 'cube' };
    expect(bad.kind).toBe('cube');
  });
});

// ------------------------------------------------------------------------------------------------ the brain (GF-CC-02)

const state = (w: ReturnType<typeof createWorld>, id: number) => w.inspect(id)?.state as EncoreState | undefined;
const versionOf = (w: ReturnType<typeof createWorld>, id: number) => state(w, id)?.score.version;

function world(events: { tick: number; droneId: number; score: Score }[], preloaded = makeScore([{ kind: 'sphere' }], N0, params)) {
  return createWorld({ seed: 1, params, brain: encoreBrain, score: preloaded, events: events.map(e => ({ type: 'INJECT_SCORE', ...e })) });
}

describe('GF-CC-02 in the swarm: one drone, the existing radio', () => {
  it('a generated score injected into ONE drone reaches every drone by gossip; nobody refuses', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const injected = composeNext(pre, 20, generated, 0, N0, params);
    const w = world([{ tick: 20, droneId: 0, score: injected }], pre);
    let all = false;
    for (let t = 0; t < 600 && !all; t++) {
      w.step();
      all = Array.from({ length: N0 }, (_, id) => versionOf(w, id)).every(v => v?.issuedTick === 20 && v.origin === 0);
    }
    expect(all).toBe(true);
    for (let id = 0; id < N0; id++) {
      const s = state(w, id)!;
      expect(s.refused).toBeUndefined();
      const r = s.score.movements[1]!.recipe as GeneratedRecipe;
      expect([r.kind, r.sceneHash]).toEqual(['generated', generated.sceneHash]);
    }
  }, 120_000);

  it('a mismatched generated score is refused by the drone that hears it: logged once, remembered, not relayed, the world keeps running', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const good = composeNext(pre, 20, generated, 0, N0, params);
    const bad: Score = { ...good, movements: [good.movements[0]!, { ...good.movements[1]!, recipe: { ...(good.movements[1]!.recipe as GeneratedRecipe), scene: { ...generated.scene, title: 'Tampered' } as GeneratedRecipe['scene'] } }] };
    const w = world([{ tick: 20, droneId: 0, score: bad }, { tick: 60, droneId: 0, score: bad }], pre);
    expect(() => { for (let t = 0; t < 200; t++) w.step(); }).not.toThrow();
    const s0 = state(w, 0)!;
    expect(s0.score.version).toEqual(pre.version);
    const tamperedHash = sceneHash((bad.movements[1]!.recipe as GeneratedRecipe).scene);   // the recomputed hash, never the label
    expect(tamperedHash).not.toBe(generated.sceneHash);
    expect(s0.refused).toEqual([{ version: { issuedTick: 20, origin: 0 }, sceneHash: tamperedHash }]);
    expect(s0.log.filter(l => l.includes('refuse score'))).toHaveLength(1);   // the re-send at tick 60 is not rechecked
    for (let id = 1; id < N0; id++) {
      expect(versionOf(w, id), `drone ${id}`).toEqual(pre.version);
      expect(state(w, id)!.refused, `drone ${id}`).toBeUndefined();          // never relayed, so never heard
    }
  }, 120_000);

  it('one bad message cannot stop the world: a generated recipe with no, null or malformed slotsDigest is refused, never thrown', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const good = composeNext(pre, 20, generated, 0, N0, params);
    const withDigest = (d: unknown, tick: number): Score => ({ ...good, version: { issuedTick: tick, origin: 0 },
      movements: [good.movements[0]!, { ...good.movements[1]!, recipe: { ...(good.movements[1]!.recipe as GeneratedRecipe), slotsDigest: d } as unknown as GeneratedRecipe }] });
    const noDigestRecipe: Record<string, unknown> = { ...(good.movements[1]!.recipe as GeneratedRecipe) };
    delete noDigestRecipe.slotsDigest;
    const noDigest: Score = { ...good, version: { issuedTick: 18, origin: 0 }, movements: [good.movements[0]!, { ...good.movements[1]!, recipe: noDigestRecipe as unknown as GeneratedRecipe }] };
    const bad = [noDigest, withDigest(null, 22), withDigest({ n0: 'x' }, 24), withDigest(7, 26)];
    for (const score of bad) expect(acceptsRecipe(score.movements[1]!.recipe, N0, params)).toBe(false);
    const w = world(bad.map((score, i) => ({ tick: 18 + 2 * i, droneId: 0, score })), pre);
    expect(() => { for (let t = 0; t < 80; t++) w.step(); }).not.toThrow();
    expect(versionOf(w, 0)).toEqual(pre.version);
    expect(state(w, 0)!.refused).toHaveLength(4);
  }, 60_000);

  it('a malformed legacy score (a later movement with no recipe) is adopted exactly as before: no throw in the new code', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const next = composeNext(pre, 20, { kind: 'helix' }, 0, N0, params);
    const malformed = { ...next, movements: [...next.movements, { startTick: 1_000_000, transitionTicks: 1, recipe: null }] } as unknown as Score;
    const w = world([{ tick: 20, droneId: 0, score: malformed }], pre);
    expect(() => { for (let t = 0; t < 60; t++) w.step(); }).not.toThrow();
    expect(versionOf(w, 0)).toEqual({ issuedTick: 20, origin: 0 });
    expect(state(w, 0)!.refused).toBeUndefined();
  }, 60_000);

  it('a legacy score adopted AFTER a generated one, and after a refusal, is adopted by gossip as always', () => {
    const pre = makeScore([{ kind: 'sphere' }], N0, params);
    const gen = composeNext(pre, 20, generated, 0, N0, params);
    const legacy = composeNext(gen, 300, { kind: 'helix' }, 5, N0, params);
    const tampered: Score = { ...gen, movements: [gen.movements[0]!, { ...gen.movements[1]!, recipe: { ...(gen.movements[1]!.recipe as GeneratedRecipe), scene: { ...generated.scene, title: 'Tampered' } as GeneratedRecipe['scene'] } }] };
    // After a generated score: everyone moves on to the legacy one.
    const a = world([{ tick: 20, droneId: 0, score: gen }, { tick: 300, droneId: 5, score: legacy }], pre);
    for (let t = 0; t < 900; t++) a.step();
    for (let id = 0; id < N0; id++) expect(versionOf(a, id), `drone ${id}`).toEqual({ issuedTick: 300, origin: 5 });
    // After a refusal: the refusing drone still adopts a later legacy score; its refused record stays.
    const later = composeNext(pre, 100, { kind: 'helix' }, 0, N0, params);
    const b = world([{ tick: 20, droneId: 0, score: tampered }, { tick: 100, droneId: 0, score: later }], pre);
    for (let t = 0; t < 600; t++) b.step();
    expect(state(b, 0)!.refused).toHaveLength(1);
    for (let id = 0; id < N0; id++) expect(versionOf(b, id), `drone ${id}`).toEqual({ issuedTick: 100, origin: 0 });
  }, 180_000);

  it('a preloaded score holding a rejected generated movement leaves world.step running (the total path)', () => {
    const s = { ...generated.scene, parts: [] } as GeneratedRecipe['scene'];   // rejected by the compiler
    const rejected: GeneratedRecipe = { kind: 'generated', compilerVersion: COMPILER_VERSION, sceneHash: 'a'.repeat(64), slotsDigest: { n0: N0, slotSpacingMin: params.slotSpacingMin, digest: '0'.repeat(64) }, scene: s };
    const preloaded: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 200, recipe: rejected }] };
    const w = world([], preloaded);
    expect(() => { for (let t = 0; t < 50; t++) w.step(); }).not.toThrow();
  }, 60_000);
});

// Opt-in (P2_WIDE=1, as tests/score/canonical.test.ts): the other committed n0 = 200 scenarios re-derive too.
const WIDE = process.env.P2_WIDE === '1';
describe.runIf(WIDE)('P2_WIDE: committed S1-S3 n0 = 200 records re-derive on this branch', () => {
  it.each((['S1', 'S2', 'S3'] as const).flatMap(sc => (['static', 'encore'] as const).map(arm => [sc, arm] as const)))('%s %s seed 1', (sc, arm) => {
    const committed = JSON.parse(readFileSync(resolve(root, `results/${sc}_n200_${arm}_s1.json`), 'utf8')) as RunRecord;
    const record = runOne({ scenario: committed.scenario as ScenarioId, seed: committed.seed, arm: committed.arm, n0: committed.n0, brains: BRAINS, makeObserver: getObserverFactory(), git: committed.git });
    expect(record.stateHash).toBe(committed.stateHash);
    expect(record.paramsHash).toBe(committed.paramsHash);
  }, 180_000);
});
