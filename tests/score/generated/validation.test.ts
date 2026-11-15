// GF-WP-01 (#203): SceneSpec schemas and pure validation. Tests GF-T01–GF-T05 of
// docs/validation/gemini-formation-evaluation.md §5.1, plus totality and purity.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SCENE_LIMITS, quantise, utf8Length, validateScene, type SceneIssue, type SceneValidation } from '../../../src/score/generated/validation';
import { canonicalJson } from '../../../src/score/canonical';
import { canonicalSceneBytes } from '../../../src/score/generated/hashing';

const fixtureDir = new URL('../../fixtures/scenes/', import.meta.url);
const schemaDir = new URL('../../../src/score/generated/schema/', import.meta.url);
const sourceDir = new URL('../../../src/score/generated/', import.meta.url);
const fixtureFiles = readdirSync(fixtureDir).filter(f => f.endsWith('.json')).sort();
const text = (name: string) => readFileSync(new URL(name, fixtureDir), 'utf8');
const load = (name: string) => JSON.parse(text(name)) as Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Json = Record<string, unknown>;
type Fail = Extract<SceneValidation, { ok: false }>;
type Pass = Extract<SceneValidation, { ok: true }>;

function rejected(result: SceneValidation): SceneIssue[] {
  if (result.ok) throw new Error(`expected a rejection, got ok with warnings ${JSON.stringify(result.warnings)}`);
  return (result as Fail).errors;
}
function accepted(result: SceneValidation): Pass {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify((result as Fail).errors)}`);
  return result;
}
const first = (result: SceneValidation) => { const [e] = rejected(result); return { code: e.code, path: e.path }; };
const warningCodes = (result: SceneValidation) => accepted(result).warnings.map(w => w.code);

// ------------------------------------------------------------------ minimal JSON Schema
// Only the subset Gemini accepts (canonical spec §6.8). No schema library is a dependency.
const GEMINI_KEYWORDS = new Set(['$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf', 'properties',
  'additionalProperties', 'required']);
const schemas = {
  silhouette2d: JSON.parse(readFileSync(new URL('scene2d.schema.json', schemaDir), 'utf8')) as Json,
  scene3d: JSON.parse(readFileSync(new URL('scene3d.schema.json', schemaDir), 'utf8')) as Json,
};

function keywordsUsed(node: Json, out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(node)) {
    out.add(k);
    if (k === 'properties' || k === '$defs') for (const child of Object.values(v as Json)) keywordsUsed(child as Json, out);
    if (k === 'items') keywordsUsed(v as Json, out);
    if (k === 'anyOf') for (const child of v as Json[]) keywordsUsed(child, out);
  }
  return out;
}

function schemaAccepts(root: Json, node: Json, v: unknown): boolean {
  if (typeof node.$ref === 'string') return schemaAccepts(root, (root.$defs as Json)[node.$ref.replace('#/$defs/', '')] as Json, v);
  if (Array.isArray(node.anyOf)) return node.anyOf.some(s => schemaAccepts(root, s as Json, v));
  if (Array.isArray(node.enum) && !node.enum.includes(v)) return false;
  switch (node.type) {
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const o = v as Json, props = (node.properties ?? {}) as Json;
      if (((node.required ?? []) as string[]).some(k => !(k in o))) return false;
      return Object.entries(o).every(([k, x]) => Object.hasOwn(props, k) ? schemaAccepts(root, props[k] as Json, x) : node.additionalProperties !== false);
    }
    case 'array':
      if (!Array.isArray(v)) return false;
      if (typeof node.minItems === 'number' && v.length < node.minItems) return false;
      if (typeof node.maxItems === 'number' && v.length > node.maxItems) return false;
      return !node.items || v.every(x => schemaAccepts(root, node.items as Json, x));
    case 'integer':
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || (node.type === 'integer' && !Number.isInteger(v))) return false;
      return !(typeof node.minimum === 'number' && v < node.minimum) && !(typeof node.maximum === 'number' && v > node.maximum);
    case 'string': return typeof v === 'string';
    default: return true;
  }
}

/** The model is asked for the array foreground only (§6.8); hand-written fixtures may use hex. */
function asModelOutput(scene: Json): Json {
  const out = clone(scene);
  if (typeof out.foreground === 'string') {
    const h = out.foreground.slice(1);
    out.foreground = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  return out;
}
const modelSchemaAccepts = (scene: Json) => {
  const root = schemas[scene.mode as keyof typeof schemas];
  return root !== undefined && schemaAccepts(root, root, asModelOutput(scene));
};

// ------------------------------------------------------------------ scene builders
const disc = (over: Json = {}): Json => ({ id: 'disc', operation: 'union', geometry: { type: 'ellipse', center: [0, 0], radii: [0.5, 0.5] }, priority: 5, ...over });
const scene2D = (parts: Json[], over: Json = {}): Json => ({ version: 1, mode: 'silhouette2d', title: 'Test', view: 'front', foreground: [1, 1, 1], parts, ...over });
const ball = (id: string, center: number[], over: Json = {}): Json => ({ id, shape: { type: 'ellipsoid', center, radii: [0.1, 0.1, 0.1] }, materialId: 'm', importance: 3, ...over });
const scene3D = (parts: Json[], over: Json = {}): Json => ({ version: 1, mode: 'scene3d', title: 'Test', referenceView: 'front', materials: [{ id: 'm', rgb: [1, 1, 1] }], parts, ...over });
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const ring = (n: number, r = 1): number[][] => Array.from({ length: n }, (_, i) => [r4(r * Math.cos((2 * Math.PI * i) / n)), r4(r * Math.sin((2 * Math.PI * i) / n))]);
/** A closed Bézier chain of k segments around a circle (3k+1 points). */
function circlePath(k: number, r = 1): number[][] {
  const pts: number[][] = [];
  const h = (4 / 3) * Math.tan(Math.PI / (2 * k)) * r;
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k, b = (2 * Math.PI * (i + 1)) / k;
    const p0 = [r * Math.cos(a), r * Math.sin(a)], p3 = [r * Math.cos(b), r * Math.sin(b)];
    if (i === 0) pts.push(p0.map(r4));
    pts.push([p0[0] - h * Math.sin(a), p0[1] + h * Math.cos(a)].map(r4), [p3[0] + h * Math.sin(b), p3[1] - h * Math.cos(b)].map(r4), p3.map(r4));
  }
  return pts;
}
/** An open wavy chain of k segments along x (3k+1 points). */
const wave = (k: number, dim = 2, y = 0): number[][] => Array.from({ length: 3 * k + 1 }, (_, i) => {
  const x = r4(-1 + (2 * i) / (3 * k)), wy = r4(y + (i % 3 === 0 ? 0 : 0.05));
  return dim === 2 ? [x, wy] : [x, wy, 0];
});
const tube = (id: string, k: number, y: number): Json => ({ id, shape: { type: 'taperedTube', points: wave(k, 3, y), startRadius: 0.01, endRadius: 0.01 }, materialId: 'm', importance: 3 });

// ------------------------------------------------------------------ fixtures

/** Warnings each valid fixture is expected to carry. */
const VALID: Record<string, string[]> = {
  'valid-2d-annulus.json': [],
  'valid-2d-disc.json': [],
  'valid-2d-elephant-excerpt.json': [],
  'valid-2d-elephant.json': [],
  'valid-2d-heart.json': [],
  'valid-2d-path-auto-closed.json': ['path-auto-closed'],
  'valid-2d-rocket.json': [],
  'valid-2d-two-blobs.json': [],
  'valid-3d-elephant-excerpt-x.json': [],
  'valid-3d-elephant.json': [],
  'valid-3d-mirrored-pair.json': [],
  'valid-3d-primitives.json': [],
  'valid-3d-sphere.json': [],
  'valid-3d-straight-tube.json': [],
  'valid-3d-two-spheres.json': [],
};

/** One invalid fixture per error code: expected first error. */
const INVALID: Record<string, { code: string; path: string }> = {
  'invalid-bad-colour.json': { code: 'bad-colour', path: '/foreground' },
  'invalid-complexity-subtracts.json': { code: 'complexity', path: '/parts' },
  'invalid-geometry-bowtie.json': { code: 'geometry', path: '/parts/0/geometry/points/0' },
  'invalid-geometry-box.json': { code: 'geometry', path: '/parts/0/geometry' },
  'invalid-geometry-quantised-merge.json': { code: 'geometry', path: '/parts/0/geometry/points/2' },
  'invalid-geometry-stroke-points.json': { code: 'geometry', path: '/parts/0/geometry/points' },
  'invalid-geometry-tube-curvature.json': { code: 'geometry', path: '/parts/0/shape/points/0' },
  'invalid-parse-proto-key.json': { code: 'parse', path: '/__proto__' },
  'invalid-range-centre.json': { code: 'range', path: '/parts/0/geometry/center/0' },
  'invalid-reference-duplicate-id.json': { code: 'reference', path: '/parts/1/id' },
  'invalid-reference-material.json': { code: 'reference', path: '/parts/0/materialId' },
  'invalid-reference-no-union.json': { code: 'reference', path: '/parts' },
  'invalid-schema-symmetry.json': { code: 'schema', path: '/parts/0/symmetry' },
  'invalid-schema-unknown-key.json': { code: 'schema', path: '/parts/0/colour' },
  'invalid-schema-unknown-type.json': { code: 'schema', path: '/parts/0/geometry/type' },
  'invalid-too-large-canonical.json': { code: 'too-large', path: '' },
  'invalid-unsupported-version.json': { code: 'unsupported-version', path: '/version' },
};

describe('fixtures', () => {
  it('every fixture file has an expected verdict, and every listed fixture exists', () => {
    expect(fixtureFiles).toEqual(Object.keys({ ...VALID, ...INVALID }).sort());
  });

  it('cover every primitive and both modes among the valid fixtures', () => {
    const types = new Set<string>();
    for (const name of Object.keys(VALID)) {
      const s = load(name);
      for (const p of s.parts as Json[]) types.add(((p.geometry ?? p.shape) as Json).type as string);
    }
    expect([...types].sort()).toEqual(['capsule', 'cone', 'cylinder', 'ellipse', 'ellipsoid', 'path', 'polygon', 'stroke', 'taperedTube']);
  });
});

describe('GF-T01 schema accept/reject', () => {
  it('the model-facing schemas use only the keywords Gemini accepts', () => {
    for (const root of Object.values(schemas)) {
      for (const k of keywordsUsed(root)) expect(GEMINI_KEYWORDS, k).toContain(k);
    }
  });

  it.each(Object.entries(VALID))('%s passes the app validator (raw text and parsed object) and the model schema', (name, warnings) => {
    expect(warningCodes(validateScene(text(name)))).toEqual(warnings);
    expect(warningCodes(validateScene(load(name)))).toEqual(warnings);
    expect(modelSchemaAccepts(load(name))).toBe(true);
  });

  it.each(Object.entries(INVALID))('%s is rejected with a typed error naming the path', (name, expected) => {
    const result = validateScene(text(name));
    expect(first(result)).toEqual(expected);
    // One layer only: every reported error carries that layer's code.
    expect(new Set(rejected(result).map(e => e.code))).toEqual(new Set([expected.code]));
  });

  it('an unknown key is rejected (additionalProperties: false), by the app and by the model schema', () => {
    const s = load('invalid-schema-unknown-key.json');
    expect(modelSchemaAccepts(s)).toBe(false);
    expect(first(validateScene(scene2D([disc()], { extra: 1 })))).toEqual({ code: 'schema', path: '/extra' });
  });

  it("William's 3D excerpt validates both as the +x-facing original and rotated to face +z", () => {
    accepted(validateScene(text('valid-3d-elephant-excerpt-x.json')));
    const full = accepted(validateScene(text('valid-3d-elephant.json')));
    expect(full.scene.parts.map(p => p.id)).toEqual(['body', 'head', 'trunk', 'ear', 'tusk', 'leg-front', 'leg-back', 'eye', 'tail']);
  });
});

describe('GF-T02 semantic geometry rejects', () => {
  const coordinate = (v: unknown) => scene2D([disc({ geometry: { type: 'ellipse', center: [v, 0], radii: [0.5, 0.5] } })]);

  it.each([['NaN', NaN], ['+Infinity', Infinity], ['-Infinity', -Infinity], ['a string', '0'], ['null', null]])('a %s coordinate is a schema error', (_, v) => {
    expect(first(validateScene(coordinate(v)))).toEqual({ code: 'schema', path: '/parts/0/geometry/center/0' });
  });

  it('values outside the V5 ranges are range errors', () => {
    const range = (s: Json) => first(validateScene(s));
    expect(range(coordinate(-1.5001))).toEqual({ code: 'range', path: '/parts/0/geometry/center/0' });
    expect(range(scene2D([disc({ geometry: { type: 'ellipse', center: [0, 0], radii: [0.004, 0.5] } })]))).toEqual({ code: 'range', path: '/parts/0/geometry/radii/0' });
    expect(range(scene2D([disc({ geometry: { type: 'ellipse', center: [0, 0], radii: [0.5, 1.01] } })]))).toEqual({ code: 'range', path: '/parts/0/geometry/radii/1' });
    expect(range(scene2D([disc({ geometry: { type: 'ellipse', center: [0, 0], radii: [0.5, 0.5], rotationDeg: 361 } })]))).toEqual({ code: 'range', path: '/parts/0/geometry/rotationDeg' });
    expect(range(scene2D([disc({ priority: 6 })]))).toEqual({ code: 'range', path: '/parts/0/priority' });
    expect(range(scene2D([disc({ priority: 0 })]))).toEqual({ code: 'range', path: '/parts/0/priority' });
    expect(range(scene2D([disc()], { foreground: [1, 1.2, 1] }))).toEqual({ code: 'range', path: '/foreground/1' });
    expect(range(scene3D([ball('b', [0, 0, 0], { importance: 9 })]))).toEqual({ code: 'range', path: '/parts/0/importance' });
    expect(range(scene3D([ball('b', [0, 0, 0])], { materials: [{ id: 'm', rgb: [-0.1, 0, 0] }] }))).toEqual({ code: 'range', path: '/materials/0/rgb/0' });
    expect(range(scene3D([ball('b', [0, 0, 0], { shape: { type: 'ellipsoid', center: [0, 0, 0], radii: [0.1, 0.1, 0.1], rotationDeg: [0, -360.5, 0] } })]))).toEqual({ code: 'range', path: '/parts/0/shape/rotationDeg/1' });
  });

  it('a fractional priority is a schema error (integer field)', () => {
    expect(first(validateScene(scene2D([disc({ priority: 2.5 })])))).toEqual({ code: 'schema', path: '/parts/0/priority' });
  });

  it('zero or negative radius and width are rejected, and so is a negative cone.topRadius', () => {
    const solid = (shape: Json) => first(validateScene(scene3D([ball('s', [0, 0, 0], { shape })])));
    expect(solid({ type: 'capsule', center: [0, 0, 0], radius: 0, length: 0.5 })).toEqual({ code: 'range', path: '/parts/0/shape/radius' });
    expect(solid({ type: 'cylinder', center: [0, 0, 0], radius: -0.2, height: 0.5 })).toEqual({ code: 'range', path: '/parts/0/shape/radius' });
    expect(solid({ type: 'cone', center: [0, 0, 0], baseRadius: 0.3, topRadius: -0.01, height: 0.5 })).toEqual({ code: 'range', path: '/parts/0/shape/topRadius' });
    expect(solid({ type: 'cone', center: [0, 0, 0], baseRadius: 0.2, topRadius: 0.3, height: 0.5 })).toEqual({ code: 'range', path: '/parts/0/shape/topRadius' });
    expect(first(validateScene(scene2D([disc({ geometry: { type: 'stroke', points: wave(1), width: 0 } })])))).toEqual({ code: 'range', path: '/parts/0/geometry/width' });
  });

  it('a centre at 1.5 and a pointed cone are accepted', () => {
    accepted(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [1.5, -1.5], radii: [0.1, 0.1] } })])));
    accepted(validateScene(scene3D([ball('spire', [0, 0, 0], { shape: { type: 'cone', center: [0, 0, 0], baseRadius: 0.005, topRadius: 0, height: 0.5 } })])));
  });

  it('evaluated geometry beyond ±1.6 is a geometry error, for rotated solids too', () => {
    expect(first(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [1.5, 0], radii: [0.11, 0.05] } })])))).toEqual({ code: 'geometry', path: '/parts/0/geometry' });
    // A capsule along local y reaches x = 1.4 + 0.1 = 1.5; rotated 90° about z onto the x axis, 1.4 + 0.2 + 0.1 = 1.7.
    const capsule = (rz: number) => scene3D([ball('c', [1.4, 0, 0], { shape: { type: 'capsule', center: [1.4, 0, 0], radius: 0.1, length: 0.4, rotationDeg: [0, 0, rz] } })]);
    accepted(validateScene(capsule(0)));
    expect(first(validateScene(capsule(90)))).toEqual({ code: 'geometry', path: '/parts/0/shape' });
    const solid = (shape: Json) => validateScene(scene3D([ball('s', [0, 0, 0], { shape })]));
    // Ellipsoid: long axis y (0.35) turned onto x reaches 1.3 + 0.35 = 1.65.
    accepted(solid({ type: 'ellipsoid', center: [1.3, 0, 0], radii: [0.05, 0.35, 0.05] }));
    expect(first(solid({ type: 'ellipsoid', center: [1.3, 0, 0], radii: [0.05, 0.35, 0.05], rotationDeg: [0, 0, 90] }))).toEqual({ code: 'geometry', path: '/parts/0/shape' });
    // Cylinder: height 0.7 turned onto x reaches 1.3 + 0.35 = 1.65; upright it reaches 1.35.
    accepted(solid({ type: 'cylinder', center: [1.3, 0, 0], radius: 0.05, height: 0.7 }));
    expect(first(solid({ type: 'cylinder', center: [1.3, 0, 0], radius: 0.05, height: 0.7, rotationDeg: [0, 0, 90] }))).toEqual({ code: 'geometry', path: '/parts/0/shape' });
    // Cone: upright its y reach is 1.4 + 0.15 = 1.55; tipped 90° about x, the base disc reaches 1.4 + 0.3 = 1.7.
    accepted(solid({ type: 'cone', center: [0, 1.4, 0], baseRadius: 0.3, topRadius: 0, height: 0.3 }));
    expect(first(solid({ type: 'cone', center: [0, 1.4, 0], baseRadius: 0.3, topRadius: 0, height: 0.3, rotationDeg: [90, 0, 0] }))).toEqual({ code: 'geometry', path: '/parts/0/shape' });
  });

  it('an undeclared materialId, an unsupported symmetry and an unknown geometry type are rejected', () => {
    expect(first(validateScene(text('invalid-reference-material.json'))).code).toBe('reference');
    expect(first(validateScene(text('invalid-schema-symmetry.json'))).code).toBe('schema');
    expect(first(validateScene(scene3D([ball('b', [0, 0, 0], { shape: { type: 'torus', center: [0, 0, 0] } })])))).toEqual({ code: 'schema', path: '/parts/0/shape/type' });
  });
});

describe('GF-T03 malformed curves and tubes', () => {
  const curve = (type: string, points: number[][], extra: Json = {}) => scene2D([disc({ geometry: { type, points, ...extra } })]);

  it.each([
    ['path', 3, 'schema'], ['stroke', 2, 'schema'], ['path', 5, 'geometry'], ['path', 6, 'geometry'], ['stroke', 8, 'geometry'],
  ])('a %s with %i points is not 3k+1 and is rejected (%s: below the minimum is V3, otherwise V6)', (type, n, code) => {
    const points = Array.from({ length: n }, (_, i) => [r4(-1 + i * 0.2), r4((i % 2) * 0.3)]);
    expect(first(validateScene(curve(type as string, points, type === 'stroke' ? { width: 0.1 } : {})))).toEqual({ code, path: '/parts/0/geometry/points' });
  });

  it('a tube whose centreline has a cusp is rejected, at a sample point or between samples', () => {
    const kinked = (points: number[][], r: number) => scene3D([{ ...tube('t', 1, 0), shape: { type: 'taperedTube', points, startRadius: r, endRadius: r } }]);
    const exact = rejected(validateScene(kinked([[-0.3, 0, 0], [0.3, 0.3, 0], [-0.3, 0.3, 0], [0.3, 0, 0]], 0.02)))[0];
    expect(exact).toMatchObject({ code: 'geometry', path: '/parts/0/shape/points/0' });
    expect(exact.message).toMatch(/cusp/);
    // A near-cusp whose tight spot falls between the 64 uniform samples: only the bisected speed minimum finds it.
    expect(first(validateScene(kinked([[-0.3, 0, 0], [0.3028, 0.3098, 0], [-0.2973, 0.2902, 0], [0.3, 0, 0]], 0.005)))).toEqual({ code: 'geometry', path: '/parts/0/shape/points/0' });
    expect(first(validateScene(kinked([[-0.4, 0, 0], [0.4, 0.4, 0], [-0.6038, 0.0496, 0], [0.4, 0, 0]], 0.0386)))).toEqual({ code: 'geometry', path: '/parts/0/shape/points/0' });
    // A coincident end handle on a curved run has unbounded curvature at that end, at either end.
    expect(first(validateScene(kinked([[0, 0, 0], [0, 0, 0], [0.3, 0, 0], [0.3, 0.3, 0]], 0.04)))).toEqual({ code: 'geometry', path: '/parts/0/shape/points/0' });
    expect(first(validateScene(kinked([[0, 0, 0], [0.3, 0, 0], [0.3, 0.3, 0], [0.3, 0.3, 0]], 0.04)))).toEqual({ code: 'geometry', path: '/parts/0/shape/points/0' });
    // Control: a gentle arch with the same radius is accepted, as is a zero speed at the end of a straight run.
    accepted(validateScene(kinked([[-0.4, 0, 0], [-0.2, 0.3, 0], [0.2, 0.3, 0], [0.4, 0, 0]], 0.02)));
    accepted(validateScene(kinked([[-0.4, 0, 0], [-0.4, 0, 0], [0, 0, 0], [0.4, 0, 0]], 0.02)));
  });

  it('a chain beyond the k range is rejected (complexity), at the k range it is accepted', () => {
    accepted(validateScene(curve('stroke', wave(8), { width: 0.05 })));
    expect(first(validateScene(curve('stroke', wave(9), { width: 0.05 })))).toEqual({ code: 'complexity', path: '/parts/0/geometry/points' });
    accepted(validateScene(curve('path', circlePath(32))));
    expect(first(validateScene(curve('path', circlePath(33))))).toEqual({ code: 'complexity', path: '/parts/0/geometry/points' });
    accepted(validateScene(scene3D([tube('t', 5, 0)])));
    expect(first(validateScene(scene3D([tube('t', 6, 0)])))).toEqual({ code: 'complexity', path: '/parts/0/shape/points' });
    expect(first(validateScene(scene3D([{ ...tube('t', 1, 0), shape: { type: 'taperedTube', points: [[0, 0, 0], [0, 1, 0], [1, 1, 0]], startRadius: 0.1, endRadius: 0.1 } }])))).toEqual({ code: 'schema', path: '/parts/0/shape/points' });
    expect(first(validateScene(scene3D([{ ...tube('t', 1, 0), shape: { type: 'taperedTube', points: wave(1, 3).concat([[1, 0.5, 0]]), startRadius: 0.01, endRadius: 0.01 } }])))).toEqual({ code: 'geometry', path: '/parts/0/shape/points' });
  });

  it('a zero-length tube and a degenerate segment are rejected', () => {
    const still = [[0.2, 0.2, 0.2], [0.2, 0.2, 0.2], [0.2, 0.2, 0.2], [0.2, 0.2, 0.2]];
    expect(first(validateScene(scene3D([{ ...tube('t', 1, 0), shape: { type: 'taperedTube', points: still, startRadius: 0.1, endRadius: 0.1 } }])))).toEqual({ code: 'geometry', path: '/parts/0/shape/points/0' });
    const pts = [[-1, 0], [-0.5, 0.5], [0, 0.5], [0.5, 0], [0.5, 0], [0.5, 0], [0.5, 0], [1, 0.3], [0.5, -0.5], [-1, 0]];
    expect(first(validateScene(curve('path', pts)))).toEqual({ code: 'geometry', path: '/parts/0/geometry/points/3' });
  });

  it('a negative tube radius is rejected; a zero stroke width is rejected', () => {
    expect(first(validateScene(scene3D([{ ...tube('t', 1, 0), shape: { type: 'taperedTube', points: wave(1, 3), startRadius: -0.1, endRadius: 0.1 } }])))).toEqual({ code: 'range', path: '/parts/0/shape/startRadius' });
    expect(first(validateScene(curve('stroke', wave(2), { width: 0 })))).toEqual({ code: 'range', path: '/parts/0/geometry/width' });
  });

  it('a path not closed within 1e-3 is accepted with path-auto-closed; one closed within it is not warned', () => {
    expect(warningCodes(validateScene(curve('path', [[0, -1], [-1, 0], [0, 1], [0.0011, -1]])))).toEqual(['path-auto-closed']);
    expect(warningCodes(validateScene(curve('path', [[0, -1], [-1, 0], [0, 1], [0.0009, -1]])))).toEqual([]);
  });

  it('validation runs on the canonical scene: vertices that merge on the 1e-4 grid are rejected', () => {
    const raw = load('invalid-geometry-quantised-merge.json');
    const pts = ((raw.parts as Json[])[0].geometry as Json).points as number[][];
    expect(pts[1]).not.toEqual(pts[2]);                          // distinct before quantisation
    expect(pts[2].map(quantise)).toEqual(pts[1].map(quantise));   // equal after it
    expect(first(validateScene(raw))).toEqual({ code: 'geometry', path: '/parts/0/geometry/points/2' });
    // Control: move the notch vertex onto its own grid cell and the same polygon is accepted.
    pts[2] = [0.5002, -0.4999];
    accepted(validateScene(raw));
  });

  it('a polygon that folds back on itself or has fewer than 3 vertices is rejected', () => {
    expect(first(validateScene(curve('polygon', [[0, 0], [1, 0], [0.5, 0]])))).toEqual({ code: 'geometry', path: '/parts/0/geometry/points/1' });
    expect(first(validateScene(curve('polygon', [[0, 0], [1, 0]])))).toEqual({ code: 'schema', path: '/parts/0/geometry/points' });
    // Self-touching: vertex 3 lies on edge 0-1.
    expect(first(validateScene(curve('polygon', [[-1, -1], [1, -1], [1, 1], [0, -1], [-1, 1]]))).code).toBe('geometry');
  });

  it('a polygon that becomes self-touching (not merged) only on the 1e-4 grid is rejected', () => {
    // Vertex 3 dips to y = -0.49996, 4e-5 above edge 0; quantised it lands on that edge.
    const notch = (y: number) => curve('polygon', [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0, y], [-0.5, 0.5]]);
    expect(quantise(-0.49996)).toBe(-0.5);
    expect(first(validateScene(notch(-0.49996))).code).toBe('geometry');
    accepted(validateScene(notch(-0.499)));
  });
});

describe('GF-T04 complexity and byte limits', () => {
  const polygon = (id: string, n: number, r = 0.3, cx = 0) => disc({ id, geometry: { type: 'polygon', points: ring(n, r).map(([x, y]) => [r4(x + cx), y]) } });

  it('2D: exactly at each cap is accepted; one over is a complexity error', () => {
    const parts = (n: number) => Array.from({ length: n }, (_, i) => disc({ id: `p${i}` }));
    accepted(validateScene(scene2D(parts(24))));
    expect(first(validateScene(scene2D(parts(25))))).toEqual({ code: 'complexity', path: '/parts' });
    accepted(validateScene(scene2D([polygon('poly', 64)])));
    expect(first(validateScene(scene2D([polygon('poly', 65)])))).toEqual({ code: 'complexity', path: '/parts/0/geometry/points' });
    const holes = (n: number) => [disc(), ...Array.from({ length: n }, (_, i) => disc({ id: `h${i}`, operation: 'subtract', geometry: { type: 'ellipse', center: [0, 0], radii: [0.1, 0.1] } }))];
    accepted(validateScene(scene2D(holes(8))));
    expect(first(validateScene(text('invalid-complexity-subtracts.json')))).toEqual({ code: 'complexity', path: '/parts' });
    const points = (extra: Json[]) => scene2D([...Array.from({ length: 8 }, (_, i) => polygon(`p${i}`, 64, 0.1, r4(-1.2 + i * 0.3))), ...extra]);
    accepted(validateScene(points([])));                                       // 8 × 64 = 512 points
    expect(first(validateScene(points([polygon('extra', 3)])))).toEqual({ code: 'complexity', path: '/parts' });
  });

  it('3D: exactly at each cap is accepted; one over is a complexity error', () => {
    const balls = (n: number, over: Json = {}) => Array.from({ length: n }, (_, i) => ball(`b${i}`, [r4(0.2 + (i % 8) * 0.15), r4(-1 + Math.floor(i / 8) * 0.3), 0], over));
    accepted(validateScene(scene3D(balls(32))));
    expect(first(validateScene(scene3D(balls(33))))).toEqual({ code: 'complexity', path: '/parts' });
    accepted(validateScene(scene3D(balls(24, { symmetry: 'mirror-x' }))));        // 48 after mirroring
    expect(first(validateScene(scene3D(balls(25, { symmetry: 'mirror-x' }))))).toEqual({ code: 'complexity', path: '/parts' });
    const materials = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i === 0 ? 'm' : `m${i}`, rgb: [0.5, 0.5, 0.5] }));
    accepted(validateScene(scene3D(balls(1), { materials: materials(12) })));
    expect(first(validateScene(scene3D(balls(1), { materials: materials(13) })))).toEqual({ code: 'complexity', path: '/materials' });
    const tubes = (n: number) => Array.from({ length: n }, (_, i) => tube(`t${i}`, 5, r4(-1.2 + i * 0.14)));
    accepted(validateScene(scene3D(tubes(16))));                                  // 16 × 16 = 256 points
    expect(first(validateScene(scene3D([...tubes(16), tube('t16', 1, 1.3)])))).toEqual({ code: 'complexity', path: '/parts' });
  });

  it('raw input: exactly 64 KiB is accepted; one byte more is too-large', () => {
    const body = JSON.stringify(scene2D([disc()]));
    const pad = (n: number) => body + ' '.repeat(n - utf8Length(body));
    expect(utf8Length(pad(SCENE_LIMITS.rawBytes))).toBe(65536);
    accepted(validateScene(pad(SCENE_LIMITS.rawBytes)));
    expect(first(validateScene(pad(SCENE_LIMITS.rawBytes + 1)))).toEqual({ code: 'too-large', path: '' });
    // Multi-byte characters are counted as UTF-8 bytes, not UTF-16 units.
    expect(utf8Length('é€😀')).toBe(2 + 3 + 4);
  });

  it('object input over the raw cap is too-large without being walked in full', () => {
    expect(first(validateScene(scene2D([disc()], { title: 'x'.repeat(70_000) })))).toEqual({ code: 'too-large', path: '/title' });
    // Under the string budget but over the cap once serialised (many small numbers): measured after the copy.
    expect(first(validateScene(scene2D([disc()], { pad: Array.from({ length: 30_000 }, () => 0.123) })))).toEqual({ code: 'too-large', path: '' });
    expect(first(validateScene(new Array(1_000_000).fill(0))).code).toBe('too-large');
  });

  it('canonical size: a scene over 16 KB is too-large before the complexity layer runs', () => {
    const big = scene2D([disc({ geometry: { type: 'polygon', points: ring(1200, 1.2) } })]);
    expect(utf8Length(JSON.stringify(big))).toBeLessThan(SCENE_LIMITS.rawBytes);
    expect(first(validateScene(big))).toEqual({ code: 'too-large', path: '' });
  });

  it('canonical size: exactly at the cap is accepted; one byte under the size is rejected', () => {
    const s = load('valid-3d-elephant.json');
    const bytes = canonicalSceneBytes(accepted(validateScene(s)).scene);
    expect(bytes).toBe(utf8Length(canonicalJson(accepted(validateScene(s)).scene)));
    accepted(validateScene(s, { ...SCENE_LIMITS, canonicalBytes: bytes }));
    expect(first(validateScene(s, { ...SCENE_LIMITS, canonicalBytes: bytes - 1 }))).toEqual({ code: 'too-large', path: '' });
  });
});

describe('GF-T05 constraints Gemini ignores, re-checked in the app', () => {
  it('the model schema cannot see these faults; the app rejects each', () => {
    for (const name of ['invalid-reference-duplicate-id.json', 'invalid-reference-no-union.json', 'invalid-geometry-bowtie.json',
      'invalid-geometry-stroke-points.json', 'invalid-geometry-quantised-merge.json', 'invalid-geometry-tube-curvature.json']) {
      expect(modelSchemaAccepts(load(name)), name).toBe(true);
      expect(validateScene(text(name)).ok, name).toBe(false);
    }
  });

  it('duplicate part ids and duplicate material ids', () => {
    expect(first(validateScene(text('invalid-reference-duplicate-id.json')))).toEqual({ code: 'reference', path: '/parts/1/id' });
    const materials = [{ id: 'm', rgb: [1, 1, 1] }, { id: 'm', rgb: [0, 0, 0] }];
    expect(first(validateScene(scene3D([ball('b', [0, 0, 0])], { materials })))).toEqual({ code: 'reference', path: '/materials/1/id' });
  });

  it('empty, blank, overlong or non-printable titles; 60 characters is accepted', () => {
    for (const title of ['', '   ', 'x'.repeat(61), 'tab\there', 'line\nbreak', '\uD800', '​', '​​', '﻿￿', '‮abc', 'soft­hyphen']) {
      expect(first(validateScene(scene2D([disc()], { title }))), JSON.stringify(title)).toEqual({ code: 'schema', path: '/title' });
    }
    accepted(validateScene(scene2D([disc()], { title: 'x'.repeat(60) })));
    accepted(validateScene(scene2D([disc()], { title: 'é'.repeat(60) })));
    accepted(validateScene(scene2D([disc()], { title: 'Éléphant 🐘 象' })));
  });

  it('empty, overlong or malformed ids; 32 characters is accepted', () => {
    for (const id of ['', 'a'.repeat(33), 'Body', '1leg', 'ear~m', 'left ear']) {
      expect(first(validateScene(scene2D([disc({ id })]))), id).toEqual({ code: 'schema', path: '/parts/0/id' });
    }
    accepted(validateScene(scene2D([disc({ id: `a${'b'.repeat(31)}` })])));
  });

  it('an empty parts array, and an empty materials array', () => {
    expect(first(validateScene(scene2D([])))).toEqual({ code: 'schema', path: '/parts' });
    expect(first(validateScene(scene3D([ball('b', [0, 0, 0])], { materials: [] })))).toEqual({ code: 'schema', path: '/materials' });
  });

  it.each([['white'], ['#fff'], ['#ggffff'], ['#FFFFFF '], [[1, 1]], [[1, 1, 1, 1]], [['1', 1, 1]]])('foreground %j is bad-colour', fg => {
    expect(first(validateScene(scene2D([disc()], { foreground: fg })))).toEqual({ code: 'bad-colour', path: '/foreground' });
  });

  it.each([[null], [5], [{ r: 1 }]])('foreground %j is neither form at all: schema', fg => {
    expect(first(validateScene(scene2D([disc()], { foreground: fg })))).toEqual({ code: 'schema', path: '/foreground' });
  });

  it('accepts both foreground forms, hex in either case', () => {
    for (const fg of ['#FFCC00', '#ffcc00', [1, 0.8, 0]]) accepted(validateScene(scene2D([disc()], { foreground: fg })));
  });

  it('minItems / maxItems / minimum / maximum are re-checked in the app', () => {
    expect(first(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [0, 0], radii: [0.5] } })])))).toEqual({ code: 'schema', path: '/parts/0/geometry/radii' });
    expect(first(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [0, 0, 0], radii: [0.5, 0.5] } })])))).toEqual({ code: 'schema', path: '/parts/0/geometry/center' });
    expect(first(validateScene(scene2D([disc({ priority: 7 })]))).code).toBe('range');
  });
});

describe('totality: validateScene never throws', () => {
  const cyclic: Json = { version: 1 }; cyclic.self = cyclic;
  const sparse: unknown[] = []; sparse.length = 1_000_000_000;
  const holed = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const getter = Object.defineProperty({}, 'version', { get() { throw new Error('boom'); }, enumerable: true });
  const proxy = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
  class Scene { version = 1; }
  const deep = '['.repeat(30_000) + ']'.repeat(30_000);
  const inputs: [string, unknown][] = [
    ['undefined', undefined], ['null', null], ['a number', 42], ['true', true], ['an empty string', ''],
    ['"null"', 'null'], ['invalid JSON', '{"version": 1,'], ['an array', []], ['an empty object', {}],
    ['a cycle', cyclic], ['a 1e9-length sparse array', sparse], ['an array with a hole', holed],
    ['a throwing getter', getter], ['a throwing proxy', proxy], ['a class instance', new Scene()],
    ['a function', () => 1], ['a bigint', 10n], ['a symbol', Symbol('s')], ['a symbol key', { [Symbol('k')]: 1 }],
    ['30,000-deep nesting', deep], ['a Date', new Date(0)], ['a Map', new Map()],
    ['constructor key', { constructor: 1 }], ['prototype key', JSON.parse('{"parts":[{"prototype":1}]}')],
    ['mode missing', { version: 1 }], ['unknown mode', { version: 1, mode: 'scene4d' }], ['version as string', { version: '1' }],
  ];

  it.each(inputs)('%s is rejected with typed errors', (_, input) => {
    let result: SceneValidation | undefined;
    expect(() => { result = validateScene(input); }).not.toThrow();
    const errors = rejected(result!);
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(typeof e.code).toBe('string');
      expect(typeof e.path).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('arrays are plain data too: extra own keys and accessor elements are parse errors', () => {
    expect(first(validateScene(Object.assign([1, 2], { extra: 1 }))).code).toBe('parse');
    const constructorKey = scene2D([disc()]);
    Object.defineProperty(constructorKey.parts, 'constructor', { value: 1, enumerable: false });
    expect(first(validateScene(constructorKey)).code).toBe('parse');
    let reads = 0;
    const lazy = scene2D([disc()]);
    Object.defineProperty(lazy.parts, 0, { get() { reads++; return disc(); }, enumerable: true });
    expect(first(validateScene(lazy))).toEqual({ code: 'parse', path: '/parts/0' });
    expect(reads).toBe(0);
  });

  it('a huge string in object input is too-large while copying, before any stringify', () => {
    expect(first(validateScene(scene2D([disc()], { title: 'x'.repeat(10_000_000) })))).toEqual({ code: 'too-large', path: '/title' });
  });

  it('forbidden keys are parse errors with their path', () => {
    expect(first(validateScene({ constructor: 1 }))).toEqual({ code: 'parse', path: '/constructor' });
    expect(first(validateScene('{"parts":[{"prototype":1}]}'))).toEqual({ code: 'parse', path: '/parts/0/prototype' });
    expect(({} as Json).polluted).toBeUndefined();
  });

  it('caps the number of issues reported', () => {
    const parts = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, bogus1: 1, bogus2: 2 }));
    expect(rejected(validateScene(scene2D(parts))).length).toBeLessThanOrEqual(32);
  });
});

describe('canonical scene and determinism', () => {
  it('returns the canonical scene: quantised numbers, no -0, defaults expanded, deep-frozen', () => {
    const s = scene2D([disc({ geometry: { type: 'ellipse', center: [0.123456, -0.00001], radii: [0.5, 0.5] } })]);
    const { scene } = accepted(validateScene(s));
    const g = (scene.parts[0] as unknown as Json).geometry as Json;
    expect(g.center).toEqual([0.1235, 0]);
    expect(Object.is((g.center as number[])[1], 0)).toBe(true);
    expect(g.rotationDeg).toBe(0);
    expect(Object.isFrozen(scene) && Object.isFrozen(g) && Object.isFrozen(g.center)).toBe(true);
    const three = accepted(validateScene(scene3D([ball('b', [0, 0, 0])]))).scene.parts[0] as unknown as Json;
    expect(three.symmetry).toBe('none');
    expect((three.shape as Json).rotationDeg).toEqual([0, 0, 0]);
  });

  it('two scenes that differ only below the grid validate to the same canonical scene', () => {
    const a = accepted(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [0.30001, 0], radii: [0.5, 0.5] } })])));
    const b = accepted(validateScene(scene2D([disc({ geometry: { type: 'ellipse', center: [0.29999, 0], radii: [0.5, 0.5] } })])));
    expect(canonicalJson(a.scene)).toBe(canonicalJson(b.scene));
  });

  it('is deterministic and never mutates its input', () => {
    for (const name of fixtureFiles) {
      const input = load(name), before = clone(input);
      expect(validateScene(input)).toEqual(validateScene(text(name)));
      expect(input).toEqual(before);
    }
  });

  it('warns, never rejects, for mirror-overlaps-self and floating-part', () => {
    const straddle = accepted(validateScene(scene3D([ball('core', [0, 0, 0], { symmetry: 'mirror-x' })])));
    expect(straddle.warnings).toEqual([expect.objectContaining({ code: 'mirror-overlaps-self', path: '/parts/0/symmetry' })]);
    const apart = accepted(validateScene(scene3D([ball('a', [-1, 0, 0]), ball('b', [1, 0, 0])])));
    expect(apart.warnings.map(w => w.code)).toEqual(['floating-part', 'floating-part']);
  });
});

describe('purity and import boundaries', () => {
  const sources = readdirSync(sourceDir).filter(f => f.endsWith('.ts'));

  it('generated sources import only each other and the one canonical-JSON module', () => {
    for (const file of sources) {
      const src = readFileSync(new URL(file, sourceDir), 'utf8');
      for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) expect(spec, file).toMatch(/^(?:\.\/[a-z0-9]+|\.\.\/canonical|\.\.\/fps|\.\.\/expand)$/);
      expect(src, file).not.toMatch(/\b(?:require|import)\s*\(/);
    }
  });

  it('generated sources use no clock, randomness, network or platform crypto', () => {
    for (const file of sources) {
      const code = readFileSync(new URL(file, sourceDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\b(?:Date|performance|fetch|crypto|globalThis|XMLHttpRequest|WebSocket|TextEncoder)\b|Math\.random/);
    }
  });
});
