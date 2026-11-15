// The real server-side validator (spec §10.2): GF-WP-01's validateScene through the module's one XI-2 bridge, the
// server's own sceneHash (GF-WP-02), and the trial-compile hook that answers 'not yet compiled' until #212.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSceneValidator, TRIAL_COMPILE_AVAILABLE, TRIAL_COMPILE_N0, trialCompileHook, type TrialCompile } from '../../src/gemini/validate.ts';
import { sceneHash } from '../../../../src/score/generated/hashing.ts';

const FIXTURES = new URL('../../../../tests/fixtures/scenes/', import.meta.url);
const fixtures = readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort();
const load = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as Record<string, unknown>;
const validator = createSceneValidator();

test('there are valid and invalid fixtures to run', () => {
  assert.ok(fixtures.filter(f => f.startsWith('valid-')).length >= 10);
  assert.ok(fixtures.filter(f => f.startsWith('invalid-')).length >= 10);
});

test('every valid fixture passes, comes back canonical and frozen, and is re-hashed by the server', () => {
  for (const name of fixtures.filter(f => f.startsWith('valid-'))) {
    const input = load(name);
    const check = validator.validate(input, input.mode as 'silhouette2d' | 'scene3d');
    assert.ok(check.ok, name);
    if (!check.ok) continue;
    assert.equal(check.sceneHash, sceneHash(check.scene), name);
    assert.match(check.sceneHash, /^[0-9a-f]{64}$/, name);
    assert.equal(check.trialCompile, 'not-yet-compiled', name);
    assert.ok(Object.isFrozen(check.scene), name);
    assert.notEqual(check.scene as unknown, input, `${name}: a fresh object`);
  }
});

test('a hash the model claims is never used: the server hash depends only on the scene', () => {
  const scene = load('valid-3d-sphere.json');
  const check = validator.validate({ ...scene }, 'scene3d');
  const again = validator.validate(JSON.parse(JSON.stringify(scene)), 'scene3d');
  assert.ok(check.ok && again.ok && check.sceneHash === again.sceneHash);
  const withClaim = validator.validate({ ...scene, sceneHash: 'f'.repeat(64) }, 'scene3d');
  assert.ok(!withClaim.ok, 'an extra sceneHash field is an unknown key (additionalProperties: false)');
});

test('every invalid fixture is refused with its code and path', () => {
  for (const name of fixtures.filter(f => f.startsWith('invalid-'))) {
    const input = load(name);
    const mode = (input.mode === 'scene3d' ? 'scene3d' : 'silhouette2d');
    const check = validator.validate(input, mode);
    assert.ok(!check.ok, name);
    if (check.ok) continue;
    assert.ok(check.issues.length > 0 && check.issues.every(i => typeof i.code === 'string' && typeof i.path === 'string'), name);
  }
});

test('a valid scene of the other mode is refused as schema at /mode', () => {
  const check = validator.validate(load('valid-2d-disc.json'), 'scene3d');
  assert.deepEqual(check, { ok: false, issues: [{ path: '/mode', code: 'schema' }] });
});

test('the trial-compile hook never fakes a result, and health says it is unavailable', () => {
  assert.deepEqual(trialCompileHook(load('valid-3d-sphere.json') as never, TRIAL_COMPILE_N0), { status: 'not-yet-compiled' });
  assert.equal(TRIAL_COMPILE_AVAILABLE, false);
  assert.deepEqual([...TRIAL_COMPILE_N0], [100, 200]);
});

test('GF-T33 (9) wiring: a compile that rejects at one roster limit refuses the scene with the compiler code', () => {
  const seen: number[][] = [];
  const compile = (_scene: unknown, n0s: readonly number[]): TrialCompile => {
    seen.push([...n0s]);
    return { status: 'rejected', n0: 200, code: 'below-floor', path: '' };
  };
  const check = createSceneValidator(compile).validate(load('valid-3d-sphere.json'), 'scene3d');
  assert.deepEqual(check, { ok: false, issues: [{ path: '', code: 'below-floor' }] });
  assert.deepEqual(seen, [[100, 200]]);
  const passing = createSceneValidator(() => ({ status: 'compiled' })).validate(load('valid-3d-sphere.json'), 'scene3d');
  assert.ok(passing.ok && passing.trialCompile === 'compiled');
});

test('GF-T34 fuzz: hostile titles and ids are rejected or carried as inert text; Object.prototype is untouched', () => {
  const base = load('valid-2d-disc.json');
  const hostile = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '{{constructor.constructor("x")()}}', '__proto__', 'constructor'];
  for (const text of hostile) {
    const asTitle = validator.validate({ ...base, title: text }, 'silhouette2d');
    if (asTitle.ok) assert.equal((asTitle.scene as { title: string }).title, text, 'kept verbatim as data, never interpreted');
    const parts = (base.parts as Record<string, unknown>[]).map(p => ({ ...p, id: text }));
    const asId = validator.validate({ ...base, parts }, 'silhouette2d');
    // `constructor` matches the spec's id pattern (^[a-z][a-z0-9_-]{0,31}$), so it may pass, as inert data;
    // everything with markup, braces or a leading underscore is refused by that pattern.
    if (asId.ok) {
      assert.equal(text, 'constructor', `only a pattern-valid id may pass: ${text}`);
      assert.equal(((asId.scene as unknown as { parts: { id: string }[] }).parts[0])?.id, text);
    }
  }
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
  const polluted = JSON.parse('{"__proto__": {"polluted": true}, "version": 1}');
  assert.ok(!validator.validate(polluted, 'silhouette2d').ok);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('#268 review: a candidate that is not a plain object is refused, so double-encoded JSON is never parsed twice', () => {
  const sphere = load('valid-3d-sphere.json');
  const doubleEncoded = JSON.stringify(sphere);
  // validateScene alone accepts JSON text; the gemini bridge must not.
  for (const candidate of [doubleEncoded, JSON.stringify(doubleEncoded), [sphere], null, 42, true, new Map(Object.entries(sphere))]) {
    assert.deepEqual(validator.validate(candidate, 'scene3d'), { ok: false, issues: [{ path: '', code: 'schema' }] }, typeof candidate);
  }
  assert.ok(validator.validate(Object.assign(Object.create(null), sphere), 'scene3d').ok, 'a null-prototype object is plain');
  assert.ok(validator.validate(sphere, 'scene3d').ok);
});
