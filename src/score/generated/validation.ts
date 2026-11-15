// Pure, total validation of SceneSpec2D / SceneSpec3D (GF-WP-01), following the canonical
// spec docs/integrations/gemini-generated-formations.md §6.5 (layers) and §6.6 (limits).
//
// Order: V1a size, V2 parse, V3 schema, canonicalisation (§6.7 steps 1–3), V1b canonical
// size, then V4 references, V5 ranges, V6 geometry, V7 complexity and V9 floating parts on
// the canonical scene only. The first failing layer returns its errors and nothing later runs.
//
// Not here, by design: V8 (2D mask connectivity) and V10 (feature size against the mask
// resolution) need the 512² mask of GF-WP-03; V11 (trial compile) and V12 (linter) run
// operator-side once the compiler exists (GF-WP-10). No clock, no randomness, no I/O.

import type { SceneSpec } from './types';

export interface SceneIssue { code: string; path: string; message: string }

/** Field for field spec §6.5 V1 and §6.6. */
export interface SceneLimits {
  rawBytes: number; canonicalBytes: number; minParts: number;
  parts2D: number; parts3DDeclared: number; parts3DMirrored: number; materials3D: number;
  polygonVertices: number; segmentsPath: number; segmentsStroke: number; segmentsTube: number;
  controlPoints2D: number; controlPoints3D: number; subtractParts2D: number;
}

export const SCENE_LIMITS: Readonly<SceneLimits> = Object.freeze({
  rawBytes: 64 * 1024,      // V1a: 64 KiB before parsing (the X-IN gate)
  canonicalBytes: 16_000,   // V1b: 16 KB canonical (GF-D7, §8.8); decimal KB, as the spec writes KB vs KiB
  minParts: 1,              // CL-1 is a one-part sphere
  parts2D: 24,
  parts3DDeclared: 32,
  parts3DMirrored: 48,
  materials3D: 12,
  polygonVertices: 64,
  segmentsPath: 32,
  segmentsStroke: 8,
  segmentsTube: 5,
  controlPoints2D: 512,     // every point of every polygon, path and stroke
  controlPoints3D: 256,     // every declared taperedTube point
  subtractParts2D: 8,
});

export type SceneValidation =
  | { ok: true; scene: SceneSpec; warnings: SceneIssue[] }
  | { ok: false; errors: SceneIssue[] };

/** §6.1 / §6.5 V5–V6 constants. */
export const SCENE_COORD_LIMIT = 1.5;
export const SCENE_BOX_LIMIT = 1.6;
export const SCENE_SIZE_MIN = 0.005;
export const SCENE_SIZE_MAX = 1;
export const SCENE_ROTATION_LIMIT = 360;
export const SCENE_QUANTUM = 1e-4;
export const PATH_CLOSE_TOLERANCE = 1e-3;
/** V9: boxes are inflated by this fraction of the scene's extent before the touch test. */
export const FLOAT_INFLATE = 0.02;

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TITLE_MAX = 60;
const MAX_DEPTH = 32;
const MAX_ISSUES = 32;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VIEWS = ['front', 'side', 'three-quarter'];
const EPS = 1e-12;

type Obj = Record<string, unknown>;
type V = number[];

class Issues {
  readonly list: SceneIssue[] = [];
  add(code: string, path: string, message: string): void {
    if (this.list.length < MAX_ISSUES) this.list.push({ code, path, message });
  }
  get any(): boolean { return this.list.length > 0; }
}

const fail = (issues: SceneIssue[]): SceneValidation => ({ ok: false, errors: issues });

export function validateScene(input: unknown, limits: SceneLimits = SCENE_LIMITS): SceneValidation {
  let raw: unknown;
  try {
    const decoded = decode(input, limits);
    if ('errors' in decoded) return fail(decoded.errors);
    raw = decoded.value;
  } catch {
    // A throwing getter or proxy: the input is not plain data.
    return fail([{ code: 'parse', path: '', message: 'input could not be read as plain JSON data' }]);
  }
  try {
    return validateDecoded(raw, limits);
  } catch (error) {
    return fail([{ code: 'internal', path: '', message: `validator invariant breached: ${String(error)}` }]);
  }
}

function validateDecoded(raw: unknown, limits: SceneLimits): SceneValidation {
  const schema = new Issues();
  checkSchema(raw, limits, schema);                     // V3
  if (schema.any) return fail(schema.list);
  const scene = canonicalise(raw as Obj);               // §6.7 steps 1–3
  const bytes = utf8Length(placeholderCanonicalJson(scene));
  if (bytes > limits.canonicalBytes) {                  // V1b
    return fail([{ code: 'too-large', path: '', message: `canonical scene is ${bytes} bytes; the cap is ${limits.canonicalBytes}` }]);
  }
  const warnings = new Issues();
  for (const layer of [checkReferences, checkRanges]) { // V4, V5
    const issues = new Issues();
    layer(scene, issues);
    if (issues.any) return fail(issues.list);
  }
  const geometry = new Issues();
  const boxes = checkGeometry(scene, geometry, warnings); // V6
  if (geometry.any) return fail(geometry.list);
  const complexity = new Issues();
  checkComplexity(scene, boxes, limits, complexity);    // V7
  if (complexity.any) return fail(complexity.list);
  if (scene.mode === 'scene3d') checkFloating(boxes, warnings); // V9
  return { ok: true, scene: deepFreeze(scene) as unknown as SceneSpec, warnings: warnings.list };
}

// ---------------------------------------------------------------- V1a and V2

function decode(input: unknown, limits: SceneLimits): { value: unknown } | { errors: SceneIssue[] } {
  const tooLarge = (bytes: string) => ({ errors: [{ code: 'too-large', path: '', message: `raw scene is ${bytes} bytes; the cap is ${limits.rawBytes}` }] });
  let parsed: unknown = input;
  if (typeof input === 'string') {
    const bytes = utf8Length(input);
    if (bytes > limits.rawBytes) return tooLarge(String(bytes));
    try { parsed = JSON.parse(input); } catch {
      return { errors: [{ code: 'parse', path: '', message: 'input is not valid JSON' }] };
    }
  }
  const state: CopyState = { nodes: 0, chars: 0, budget: limits.rawBytes, error: null };
  const value = freshCopy(parsed, '', 0, state);
  if (state.error) return { errors: [state.error] };
  if (typeof input !== 'string') {
    const bytes = utf8Length(JSON.stringify(value));
    if (bytes > limits.rawBytes) return tooLarge(String(bytes));
  }
  return { value };
}

interface CopyState { nodes: number; chars: number; budget: number; error: SceneIssue | null }

/** V2: a fresh copy made only of plain objects, arrays, strings, numbers, booleans and null. */
function freshCopy(value: unknown, path: string, depth: number, state: CopyState): unknown {
  if (state.error) return null;
  const reject = (code: string, message: string) => { state.error = { code, path, message }; return null; };
  // Every JSON value costs at least one byte, so more nodes than raw bytes cannot fit the cap.
  if (++state.nodes > state.budget) return reject('too-large', `input has more than ${state.budget} values`);
  if (depth > MAX_DEPTH) return reject('parse', `input is nested more than ${MAX_DEPTH} levels deep`);
  if (typeof value === 'string') {
    // A string's UTF-8 size is at least its UTF-16 length, so this bounds the raw size as we go.
    state.chars += value.length;
    if (state.chars > state.budget) return reject('too-large', `strings exceed the ${state.budget}-byte size cap`);
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return reject('parse', 'value is not a plain array');
    if (value.length > state.budget - state.nodes) return reject('too-large', `array of ${value.length} items exceeds the size cap`);
    const own = Reflect.ownKeys(value);
    if (own.length !== value.length + 1) return reject('parse', 'array has holes or non-index properties');
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor) return reject('parse', `array has a hole at index ${i}`);
      if (!('value' in descriptor)) { state.error = { code: 'parse', path: `${path}/${i}`, message: 'accessor properties are not data' }; return null; }
      out.push(freshCopy(descriptor.value, `${path}/${i}`, depth + 1, state));
      if (state.error) return null;
    }
    return out;
  }
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return reject('parse', 'value is not a plain object');
    const out: Obj = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return reject('parse', 'object has a symbol key');
      const keyPath = `${path}/${pointerEscape(key)}`;
      if (FORBIDDEN_KEYS.has(key)) { state.error = { code: 'parse', path: keyPath, message: `forbidden key "${key}"` }; return null; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) { state.error = { code: 'parse', path: keyPath, message: 'accessor properties are not data' }; return null; }
      out[key] = freshCopy(descriptor.value, keyPath, depth + 1, state);
      if (state.error) return null;
    }
    return out;
  }
  return reject('parse', `${typeof value} is not a JSON value`);
}

// ---------------------------------------------------------------- V3 schema

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function keys(o: Obj, path: string, required: string[], optional: string[], issues: Issues): boolean {
  let ok = true;
  for (const k of required) if (!Object.hasOwn(o, k)) { issues.add('schema', `${path}/${k}`, `missing required field "${k}"`); ok = false; }
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) { issues.add('schema', `${path}/${pointerEscape(k)}`, `unknown field "${k}"`); ok = false; }
  }
  return ok;
}

function num(v: unknown, path: string, issues: Issues, integer = false): void {
  if (!finite(v)) issues.add('schema', path, `expected a finite number, got ${describe(v)}`);
  else if (integer && !Number.isInteger(v)) issues.add('schema', path, `expected an integer, got ${v}`);
}

function vec(v: unknown, n: number, path: string, issues: Issues): void {
  if (!Array.isArray(v) || v.length !== n) { issues.add('schema', path, `expected an array of ${n} numbers, got ${describe(v)}`); return; }
  v.forEach((x, i) => num(x, `${path}/${i}`, issues));
}

/** Minimum lengths are schema (V3, as minItems in §6.8); 3k+1 and maximum counts are V6 / V7. */
function points(v: unknown, dim: number, min: number, path: string, issues: Issues): void {
  if (!Array.isArray(v)) { issues.add('schema', path, `expected an array of points, got ${describe(v)}`); return; }
  if (v.length < min) { issues.add('schema', path, `expected at least ${min} points, got ${v.length}`); return; }
  v.forEach((p, i) => vec(p, dim, `${path}/${i}`, issues));
}

function oneOf(v: unknown, allowed: readonly string[], path: string, issues: Issues): boolean {
  if (typeof v === 'string' && allowed.includes(v)) return true;
  issues.add('schema', path, `expected one of ${allowed.map(a => `"${a}"`).join(', ')}, got ${describe(v)}`);
  return false;
}

function id(v: unknown, path: string, issues: Issues): void {
  if (typeof v !== 'string' || !ID_RE.test(v)) issues.add('schema', path, `id must match ${ID_RE.source} (1..32 characters), got ${describe(v)}`);
}

/**
 * Printable, by explicit ranges (not \p{...}, whose tables vary with the engine's Unicode
 * version): no C0/C1 controls, line/paragraph separators, lone surrogates, non-characters,
 * or invisible format characters (soft hyphen, zero-width, bidi controls, BOM).
 */
function printable(c: number): boolean {
  return !(c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0xad ||
    (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x206f) || c === 0xfeff || (c >= 0xfff9 && c <= 0xfffb) ||
    (c >= 0xd800 && c <= 0xdfff) || (c >= 0xfdd0 && c <= 0xfdef) || (c & 0xfffe) === 0xfffe);
}

function title(v: unknown, path: string, issues: Issues): void {
  if (typeof v !== 'string') { issues.add('schema', path, `title must be a string, got ${describe(v)}`); return; }
  const length = [...v].length;
  if ([...v].some(ch => !printable(ch.codePointAt(0)!))) issues.add('schema', path, 'title must contain printable characters only');
  else if (v.trim().length === 0) issues.add('schema', path, 'title must not be empty');
  else if (length > TITLE_MAX) issues.add('schema', path, `title is ${length} characters; the maximum is ${TITLE_MAX}`);
}

function header(o: Obj, issues: Issues): boolean {
  if (!Object.hasOwn(o, 'version')) { issues.add('schema', '/version', 'missing required field "version"'); return false; }
  if (!finite(o.version) || !Number.isInteger(o.version)) { issues.add('schema', '/version', `version must be an integer, got ${describe(o.version)}`); return false; }
  if (o.version !== 1) { issues.add('unsupported-version', '/version', `scene version ${o.version} is not supported; only version 1 is`); return false; }
  return oneOf(o.mode, ['silhouette2d', 'scene3d'], '/mode', issues);
}

function checkSchema(raw: unknown, limits: SceneLimits, issues: Issues): void {
  if (!isObj(raw)) { issues.add('schema', '', `scene must be an object, got ${describe(raw)}`); return; }
  if (!header(raw, issues)) return;
  if (raw.mode === 'silhouette2d') schema2D(raw, limits, issues);
  else schema3D(raw, limits, issues);
}

function partsArray(v: unknown, limits: SceneLimits, issues: Issues): v is unknown[] {
  if (!Array.isArray(v)) { issues.add('schema', '/parts', `parts must be an array, got ${describe(v)}`); return false; }
  if (v.length < limits.minParts) { issues.add('schema', '/parts', `parts has ${v.length} items; at least ${limits.minParts} required`); return false; }
  return true;
}

function schema2D(o: Obj, limits: SceneLimits, issues: Issues): void {
  keys(o, '', ['version', 'mode', 'title', 'view', 'foreground', 'parts'], [], issues);
  if (Object.hasOwn(o, 'title')) title(o.title, '/title', issues);
  if (Object.hasOwn(o, 'view')) oneOf(o.view, VIEWS, '/view', issues);
  if (Object.hasOwn(o, 'foreground')) {
    const f = o.foreground;
    const isHex = typeof f === 'string' && HEX_RE.test(f);
    const isRgb = Array.isArray(f) && f.length === 3 && f.every(finite);
    if (typeof f !== 'string' && !Array.isArray(f)) issues.add('schema', '/foreground', `foreground must be a string or an array, got ${describe(f)}`);
    else if (!isHex && !isRgb) issues.add('bad-colour', '/foreground', `foreground must be "#RRGGBB" or [r, g, b], got ${describe(f)}`);
  }
  if (!Object.hasOwn(o, 'parts') || !partsArray(o.parts, limits, issues)) return;
  o.parts.forEach((part, i) => {
    const p = `/parts/${i}`;
    if (!isObj(part)) { issues.add('schema', p, `part must be an object, got ${describe(part)}`); return; }
    keys(part, p, ['id', 'operation', 'geometry', 'priority'], [], issues);
    if (Object.hasOwn(part, 'id')) id(part.id, `${p}/id`, issues);
    if (Object.hasOwn(part, 'operation')) oneOf(part.operation, ['union', 'subtract'], `${p}/operation`, issues);
    if (Object.hasOwn(part, 'priority')) num(part.priority, `${p}/priority`, issues, true);
    if (Object.hasOwn(part, 'geometry')) geometry2D(part.geometry, `${p}/geometry`, issues);
  });
}

function geometry2D(g: unknown, p: string, issues: Issues): void {
  if (!isObj(g)) { issues.add('schema', p, `geometry must be an object, got ${describe(g)}`); return; }
  if (!oneOf(g.type, ['ellipse', 'polygon', 'path', 'stroke'], `${p}/type`, issues)) return;
  if (g.type === 'ellipse') {
    keys(g, p, ['type', 'center', 'radii'], ['rotationDeg'], issues);
    if (Object.hasOwn(g, 'center')) vec(g.center, 2, `${p}/center`, issues);
    if (Object.hasOwn(g, 'radii')) vec(g.radii, 2, `${p}/radii`, issues);
    if (Object.hasOwn(g, 'rotationDeg')) num(g.rotationDeg, `${p}/rotationDeg`, issues);
  } else {
    keys(g, p, g.type === 'stroke' ? ['type', 'points', 'width'] : ['type', 'points'], [], issues);
    if (Object.hasOwn(g, 'points')) points(g.points, 2, g.type === 'polygon' ? 3 : 4, `${p}/points`, issues);
    if (Object.hasOwn(g, 'width')) num(g.width, `${p}/width`, issues);
  }
}

function schema3D(o: Obj, limits: SceneLimits, issues: Issues): void {
  keys(o, '', ['version', 'mode', 'title', 'referenceView', 'materials', 'parts'], [], issues);
  if (Object.hasOwn(o, 'title')) title(o.title, '/title', issues);
  if (Object.hasOwn(o, 'referenceView')) oneOf(o.referenceView, VIEWS, '/referenceView', issues);
  if (Object.hasOwn(o, 'materials')) {
    if (!Array.isArray(o.materials) || o.materials.length < 1) issues.add('schema', '/materials', `materials must be a non-empty array, got ${describe(o.materials)}`);
    else o.materials.forEach((m, i) => {
      const p = `/materials/${i}`;
      if (!isObj(m)) { issues.add('schema', p, `material must be an object, got ${describe(m)}`); return; }
      keys(m, p, ['id', 'rgb'], [], issues);
      if (Object.hasOwn(m, 'id')) id(m.id, `${p}/id`, issues);
      if (Object.hasOwn(m, 'rgb')) vec(m.rgb, 3, `${p}/rgb`, issues);
    });
  }
  if (!Object.hasOwn(o, 'parts') || !partsArray(o.parts, limits, issues)) return;
  o.parts.forEach((part, i) => {
    const p = `/parts/${i}`;
    if (!isObj(part)) { issues.add('schema', p, `part must be an object, got ${describe(part)}`); return; }
    keys(part, p, ['id', 'shape', 'materialId', 'importance'], ['symmetry'], issues);
    if (Object.hasOwn(part, 'id')) id(part.id, `${p}/id`, issues);
    if (Object.hasOwn(part, 'materialId') && typeof part.materialId !== 'string') issues.add('schema', `${p}/materialId`, `materialId must be a string, got ${describe(part.materialId)}`);
    if (Object.hasOwn(part, 'importance')) num(part.importance, `${p}/importance`, issues, true);
    if (Object.hasOwn(part, 'symmetry')) oneOf(part.symmetry, ['none', 'mirror-x'], `${p}/symmetry`, issues);
    if (Object.hasOwn(part, 'shape')) geometry3D(part.shape, `${p}/shape`, issues);
  });
}

const SHAPE_FIELDS: Record<string, string[]> = {
  ellipsoid: ['center', 'radii'],
  capsule: ['center', 'radius', 'length'],
  cylinder: ['center', 'radius', 'height'],
  cone: ['center', 'baseRadius', 'topRadius', 'height'],
  taperedTube: ['points', 'startRadius', 'endRadius'],
};

function geometry3D(g: unknown, p: string, issues: Issues): void {
  if (!isObj(g)) { issues.add('schema', p, `shape must be an object, got ${describe(g)}`); return; }
  if (!oneOf(g.type, Object.keys(SHAPE_FIELDS), `${p}/type`, issues)) return;
  const type = g.type as string;
  keys(g, p, ['type', ...SHAPE_FIELDS[type]], type === 'taperedTube' ? [] : ['rotationDeg'], issues);
  for (const field of [...SHAPE_FIELDS[type], 'rotationDeg']) {
    if (!Object.hasOwn(g, field)) continue;
    const fp = `${p}/${field}`;
    if (field === 'center' || field === 'radii' || field === 'rotationDeg') vec(g[field], 3, fp, issues);
    else if (field === 'points') points(g[field], 3, 4, fp, issues);
    else num(g[field], fp, issues);
  }
}

// ---------------------------------------------------------------- canonicalisation (§6.7)

/** §6.7 step 3: quantise every non-integer to the 1e-4 grid; -0 becomes 0. */
export function quantise(v: number): number {
  const q = Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4; // exactly §6.7 step 3 (SCENE_QUANTUM)
  return q === 0 ? 0 : q;
}

function canonicalise(raw: Obj): Obj {
  const q = (v: unknown): unknown => typeof v === 'number' ? quantise(v)
    : Array.isArray(v) ? v.map(q)
    : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, q(x)])) : v;
  const scene = q(raw) as Obj;
  // §6.7 step 2: expand defaults. Hex foreground stays a string.
  for (const part of scene.parts as Obj[]) {
    if (scene.mode === 'silhouette2d') {
      const g = part.geometry as Obj;
      if (g.type === 'ellipse' && !Object.hasOwn(g, 'rotationDeg')) g.rotationDeg = 0;
    } else {
      const s = part.shape as Obj;
      if (s.type !== 'taperedTube' && !Object.hasOwn(s, 'rotationDeg')) s.rotationDeg = [0, 0, 0];
      if (!Object.hasOwn(part, 'symmetry')) part.symmetry = 'none';
    }
  }
  return scene;
}

/**
 * TEMPORARY PLACEHOLDER for GF-WP-02's `canonicalSceneJson` (src/score/canonical.ts, XI-7):
 * keys sorted by UTF-16 code unit, no whitespace, values through JSON.stringify. It is used
 * here only to measure V1b; it is not the hash input and must be replaced, not copied.
 * TODO(GF-WP-02): import the canonical-JSON module once it lands.
 */
function placeholderCanonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(placeholderCanonicalJson).join(',')}]`;
  if (isObj(v)) {
    const ks = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${ks.map(k => `${JSON.stringify(k)}:${placeholderCanonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- V4 references

function checkReferences(scene: Obj, issues: Issues): void {
  const parts = scene.parts as Obj[];
  duplicates(parts.map(p => p.id as string), '/parts', 'part', issues);
  if (scene.mode === 'silhouette2d') {
    if (!parts.some(p => p.operation === 'union')) issues.add('reference', '/parts', 'a 2D scene needs at least one "union" part');
    return;
  }
  const materials = scene.materials as Obj[];
  duplicates(materials.map(m => m.id as string), '/materials', 'material', issues);
  const declared = new Set(materials.map(m => m.id as string));
  parts.forEach((p, i) => {
    if (!declared.has(p.materialId as string)) issues.add('reference', `/parts/${i}/materialId`, `materialId "${String(p.materialId)}" names no declared material`);
  });
}

function duplicates(ids: string[], path: string, what: string, issues: Issues): void {
  const first = new Map<string, number>();
  ids.forEach((v, i) => {
    if (first.has(v)) issues.add('reference', `${path}/${i}/id`, `duplicate ${what} id "${v}" (first at index ${first.get(v)})`);
    else first.set(v, i);
  });
}

// ---------------------------------------------------------------- V5 ranges

function inRange(v: number, lo: number, hi: number, path: string, what: string, issues: Issues): void {
  if (v < lo || v > hi) issues.add('range', path, `${what} ${v} is outside [${lo}, ${hi}]`);
}

function checkRanges(scene: Obj, issues: Issues): void {
  const coord = (pt: V, path: string) => pt.forEach((x, i) => inRange(x, -SCENE_COORD_LIMIT, SCENE_COORD_LIMIT, `${path}/${i}`, 'coordinate', issues));
  const size = (v: number, path: string) => inRange(v, SCENE_SIZE_MIN, SCENE_SIZE_MAX, path, 'size', issues);
  const rotation = (v: number, path: string) => inRange(v, -SCENE_ROTATION_LIMIT, SCENE_ROTATION_LIMIT, path, 'rotation', issues);
  const colour = (c: V, path: string) => c.forEach((x, i) => inRange(x, 0, 1, `${path}/${i}`, 'colour channel', issues));
  const parts = scene.parts as Obj[];
  if (scene.mode === 'silhouette2d') {
    if (Array.isArray(scene.foreground)) colour(scene.foreground as V, '/foreground');
    parts.forEach((part, i) => {
      const p = `/parts/${i}`, g = part.geometry as Obj, gp = `${p}/geometry`;
      inRange(part.priority as number, 1, 5, `${p}/priority`, 'priority', issues);
      if (g.type === 'ellipse') {
        coord(g.center as V, `${gp}/center`);
        (g.radii as V).forEach((r, k) => size(r, `${gp}/radii/${k}`));
        rotation(g.rotationDeg as number, `${gp}/rotationDeg`);
      } else {
        (g.points as V[]).forEach((pt, k) => coord(pt, `${gp}/points/${k}`));
        if (g.type === 'stroke') size(g.width as number, `${gp}/width`);
      }
    });
    return;
  }
  (scene.materials as Obj[]).forEach((m, i) => colour(m.rgb as V, `/materials/${i}/rgb`));
  parts.forEach((part, i) => {
    const p = `/parts/${i}`, s = part.shape as Obj, sp = `${p}/shape`;
    inRange(part.importance as number, 1, 5, `${p}/importance`, 'importance', issues);
    if (s.type === 'taperedTube') {
      (s.points as V[]).forEach((pt, k) => coord(pt, `${sp}/points/${k}`));
      size(s.startRadius as number, `${sp}/startRadius`);
      size(s.endRadius as number, `${sp}/endRadius`);
      return;
    }
    coord(s.center as V, `${sp}/center`);
    (s.rotationDeg as V).forEach((r, k) => rotation(r, `${sp}/rotationDeg/${k}`));
    if (s.type === 'ellipsoid') (s.radii as V).forEach((r, k) => size(r, `${sp}/radii/${k}`));
    if (s.type === 'capsule') { size(s.radius as number, `${sp}/radius`); size(s.length as number, `${sp}/length`); }
    if (s.type === 'cylinder') { size(s.radius as number, `${sp}/radius`); size(s.height as number, `${sp}/height`); }
    if (s.type === 'cone') {
      size(s.baseRadius as number, `${sp}/baseRadius`);
      size(s.height as number, `${sp}/height`);
      inRange(s.topRadius as number, 0, SCENE_SIZE_MAX, `${sp}/topRadius`, 'topRadius', issues);
      if ((s.topRadius as number) > (s.baseRadius as number)) issues.add('range', `${sp}/topRadius`, `topRadius ${String(s.topRadius)} exceeds baseRadius ${String(s.baseRadius)}`);
    }
  });
}

// ---------------------------------------------------------------- V6 geometry

/** One evaluated axis-aligned box per compiled part (mirror copies included, for 3D). */
interface PartBox { id: string; min: V; max: V }

function segmentCount(n: number): number | null {
  return n >= 4 && (n - 1) % 3 === 0 ? (n - 1) / 3 : null;
}

function checkGeometry(scene: Obj, issues: Issues, warnings: Issues): PartBox[] {
  const boxes: PartBox[] = [];
  const bound = (box: PartBox, path: string) => {
    for (let a = 0; a < box.min.length; a++) {
      const reach = Math.max(-box.min[a], box.max[a]);
      if (reach > SCENE_BOX_LIMIT + 1e-9) {
        issues.add('geometry', path, `evaluated geometry reaches ${round(reach)} on ${'xyz'[a]}; the limit is ±${SCENE_BOX_LIMIT}`);
        return;
      }
    }
  };
  const chain = (pts: V[], path: string, what: string): boolean => {
    if (segmentCount(pts.length) === null) {
      issues.add('geometry', `${path}/points`, `${what} needs 3k+1 points (k >= 1), got ${pts.length}`);
      return false;
    }
    for (let s = 0; s * 3 + 3 < pts.length; s++) {
      const seg = pts.slice(s * 3, s * 3 + 4);
      if (seg.every(q => same(q, seg[0]))) {
        issues.add('geometry', `${path}/points/${s * 3}`, `segment ${s} is degenerate: its four control points coincide`);
        return false;
      }
    }
    return true;
  };
  const parts = scene.parts as Obj[];
  if (scene.mode === 'silhouette2d') {
    parts.forEach((part, i) => {
      const g = part.geometry as Obj, gp = `/parts/${i}/geometry`, id = part.id as string;
      if (g.type === 'ellipse') {
        const [cx, cy] = g.center as V, [a, b] = g.radii as V, t = deg(g.rotationDeg as number);
        const ex = Math.hypot(a * Math.cos(t), b * Math.sin(t)), ey = Math.hypot(a * Math.sin(t), b * Math.cos(t));
        const box = { id, min: [cx - ex, cy - ey], max: [cx + ex, cy + ey] };
        bound(box, gp); boxes.push(box);
      } else if (g.type === 'polygon') {
        const pts = g.points as V[];
        if (simplePolygon(pts, gp, issues)) boxes.push(pointBox(id, pts, 0));
      } else if (chain(g.points as V[], gp, g.type as string)) {
        const pts = g.points as V[];
        if (g.type === 'path' && dist(pts[0], pts[pts.length - 1]) > PATH_CLOSE_TOLERANCE) {
          warnings.add('path-auto-closed', `${gp}/points`, `path is not closed within ${PATH_CLOSE_TOLERANCE}; a straight closing segment is added`);
        }
        const box = curveBox(id, pts, () => g.type === 'stroke' ? (g.width as number) / 2 : 0);
        bound(box, gp); boxes.push(box);
      }
    });
    return boxes;
  }
  parts.forEach((part, i) => {
    const s = part.shape as Obj, sp = `/parts/${i}/shape`, id = part.id as string;
    let box: PartBox | null = null;
    if (s.type === 'taperedTube') {
      const pts = s.points as V[], k = segmentCount(pts.length);
      if (!chain(pts, sp, 'taperedTube') || k === null) return;
      const r0 = s.startRadius as number, r1 = s.endRadius as number;
      const radius = (u: number) => r0 + (r1 - r0) * u;
      box = curveBox(id, pts, seg => Math.max(radius(seg / k), radius((seg + 1) / k)));
      tubeCurvature(pts, k, radius, sp, issues);
    } else {
      box = solidBox(id, s);
    }
    bound(box, sp);
    boxes.push(box);
    if (part.symmetry === 'mirror-x') {
      if (box.min[0] < 0 && box.max[0] > 0) {
        warnings.add('mirror-overlaps-self', `/parts/${i}/symmetry`, `part "${id}" straddles x = 0, so it is not mirrored`);
      } else {
        boxes.push({ id: `${id}~m`, min: [-box.max[0], box.min[1], box.min[2]], max: [-box.min[0], box.max[1], box.max[2]] });
      }
    }
  });
  return boxes;
}

function simplePolygon(pts: V[], path: string, issues: Issues): boolean {
  const n = pts.length;
  if (n < 3) { issues.add('geometry', `${path}/points`, `polygon needs at least 3 vertices, got ${n}`); return false; }
  for (let i = 0; i < n; i++) {
    if (same(pts[i], pts[(i + 1) % n])) {
      issues.add('geometry', `${path}/points/${(i + 1) % n}`, `vertex ${(i + 1) % n} repeats vertex ${i} (a zero-length edge)`);
      return false;
    }
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    // Adjacent edges ab and bc overlap if c lies back along ba (a spike).
    if (orient(b, a, c) === 0 && dot(sub(a, b), sub(c, b)) > 0) {
      issues.add('geometry', `${path}/points/${(i + 1) % n}`, `polygon folds back on itself at vertex ${(i + 1) % n}`);
      return false;
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // edges 0 and n-1 share vertex 0
      if (segmentsTouch(a, b, pts[j], pts[(j + 1) % n])) {
        issues.add('geometry', `${path}/points/${i}`, `polygon is not simple: edge ${i} meets edge ${j}`);
        return false;
      }
    }
  }
  return true;
}

/** Orientation of c against the line a→b: -1, 0 or 1 (scalar, allocation-free: this runs O(n²)). */
function orient(a: V, b: V, c: V): number {
  const x = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(x) <= EPS ? 0 : x > 0 ? 1 : -1;
}

/** Closed segments pq and rs intersect or touch. */
function segmentsTouch(p: V, q: V, r: V, s: V): boolean {
  // Box reject first: most edge pairs of a simple polygon are far apart.
  if (Math.max(p[0], q[0]) + EPS < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) + EPS < Math.min(p[0], q[0]) ||
    Math.max(p[1], q[1]) + EPS < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) + EPS < Math.min(p[1], q[1])) return false;
  const o1 = orient(p, q, r), o2 = orient(p, q, s), o3 = orient(r, s, p), o4 = orient(r, s, q);
  if (o1 !== o2 && o3 !== o4) return true;
  // Collinear cases: after the box test, a collinear endpoint lies on the other segment.
  return (o1 === 0 && within(p, q, r)) || (o2 === 0 && within(p, q, s)) || (o3 === 0 && within(r, s, p)) || (o4 === 0 && within(r, s, q));
}

function within(a: V, b: V, c: V): boolean {
  return Math.min(a[0], b[0]) - EPS <= c[0] && c[0] <= Math.max(a[0], b[0]) + EPS &&
    Math.min(a[1], b[1]) - EPS <= c[1] && c[1] <= Math.max(a[1], b[1]) + EPS;
}

/** Exact box of a cubic Bézier chain, padded per segment. */
function curveBox(id: string, pts: V[], pad: (segment: number) => number): PartBox {
  const dim = pts[0].length, min = Array<number>(dim).fill(Infinity), max = Array<number>(dim).fill(-Infinity);
  for (let s = 0; s * 3 + 3 < pts.length; s++) {
    const [p0, p1, p2, p3] = pts.slice(s * 3, s * 3 + 4), r = pad(s);
    for (let a = 0; a < dim; a++) {
      const ts = [0, 1, ...derivativeRoots(p0[a], p1[a], p2[a], p3[a])];
      for (const t of ts) {
        const v = bezier(p0[a], p1[a], p2[a], p3[a], t);
        min[a] = Math.min(min[a], v - r); max[a] = Math.max(max[a], v + r);
      }
    }
  }
  return { id, min, max };
}

function derivativeRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = p1 - p0, b = p2 - p1, c = p3 - p2;
  const A = a - 2 * b + c, B = 2 * (b - a), C = a;
  const inside = (t: number) => t > 0 && t < 1;
  if (Math.abs(A) < EPS) return Math.abs(B) < EPS ? [] : [-C / B].filter(inside);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B + sq) / (2 * A), (-B - sq) / (2 * A)].filter(inside);
}

const bezier = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

const TUBE_SAMPLES = 64;
const SPEED_EPS = 1e-9;

/**
 * V6: the tube radius must stay below the centreline's local radius of curvature.
 * Curvature peaks where the speed |B'| dips, so besides a dense uniform sample this also
 * checks every local minimum of the speed (a root of B'·B'', found by bisection), and a
 * zero speed inside a segment is a cusp, which no tube can follow. A zero speed at a
 * segment end (P0 = P1 or P2 = P3) is a valid parametrisation and is skipped.
 */
function tubeCurvature(pts: V[], k: number, radius: (u: number) => number, path: string, issues: Issues): void {
  for (let s = 0; s < k; s++) {
    const [p0, p1, p2, p3] = pts.slice(s * 3, s * 3 + 4);
    const d1 = (t: number) => { const u = 1 - t; return [0, 1, 2].map(a => 3 * (u * u * (p1[a] - p0[a]) + 2 * u * t * (p2[a] - p1[a]) + t * t * (p3[a] - p2[a]))); };
    const d2 = (t: number) => { const u = 1 - t; return [0, 1, 2].map(a => 6 * (u * (p2[a] - 2 * p1[a] + p0[a]) + t * (p3[a] - 2 * p2[a] + p1[a]))); };
    const slope = (t: number) => { const a = d1(t), b = d2(t); return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
    const ts: number[] = [];
    for (let j = 0; j <= TUBE_SAMPLES; j++) ts.push(j / TUBE_SAMPLES);
    for (let j = 0; j < TUBE_SAMPLES; j++) {
      let lo = j / TUBE_SAMPLES, hi = (j + 1) / TUBE_SAMPLES, flo = slope(lo);
      if (!(flo < 0 && slope(hi) >= 0)) continue; // speed falls then rises: a local minimum inside
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2, f = slope(mid); if (f < 0) { lo = mid; flo = f; } else hi = mid; }
      ts.push((lo + hi) / 2);
    }
    const speedAt = (t: number) => { const a = d1(t); return Math.hypot(a[0], a[1], a[2]); };
    // Cusps first, so the error names the cause rather than a neighbouring sample's curvature.
    const cusp = ts.find(t => t > 0 && t < 1 && speedAt(t) < SPEED_EPS);
    if (cusp !== undefined) {
      issues.add('geometry', `${path}/points/${s * 3}`, `tube centreline has a cusp in segment ${s} (zero speed at t = ${round(cusp)})`);
      return;
    }
    for (const t of ts) {
      const a = d1(t), b = d2(t);
      const speed = Math.hypot(a[0], a[1], a[2]);
      if (speed < SPEED_EPS) {
        // A coincident end handle (P0 = P1 or P2 = P3): the curvature there is unbounded
        // unless the segment is locally straight (its distinct control points are collinear).
        if (!straight([p0, p1, p2, p3])) {
          issues.add('geometry', `${path}/points/${s * 3}`, `tube centreline has unbounded curvature at a coincident end handle in segment ${s}`);
          return;
        }
        continue;
      }
      const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const curvature = Math.hypot(c[0], c[1], c[2]) / speed ** 3;
      const r = radius((s + t) / k);
      if (curvature > 0 && r >= 1 / curvature) {
        issues.add('geometry', `${path}/points/${s * 3}`, `tube radius ${round(r)} is not below the centreline's radius of curvature ${round(1 / curvature)} in segment ${s}`);
        return;
      }
    }
  }
}

/** All distinct control points lie on one line (3D). */
function straight(pts: V[]): boolean {
  const distinct = pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));
  if (distinct.length <= 2) return true;
  const a = sub(distinct[1], distinct[0]);
  return distinct.slice(2).every(p => {
    const b = sub(p, distinct[0]);
    return Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) <= EPS;
  });
}

/** R = Rz · Ry · Rx, degrees (§6.1). */
function rotation(deg3: V): number[][] {
  const [x, y, z] = deg3.map(deg);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function solidBox(id: string, s: Obj): PartBox {
  const c = s.center as V, R = rotation(s.rotationDeg as V);
  const axis = [R[0][1], R[1][1], R[2][1]]; // local +y
  const disc = (r: number, a: number) => r * Math.sqrt(Math.max(0, 1 - axis[a] * axis[a]));
  const ext = (f: (a: number) => [number, number]) => {
    const min: V = [], max: V = [];
    for (let a = 0; a < 3; a++) { const [lo, hi] = f(a); min.push(lo); max.push(hi); }
    return { id, min, max };
  };
  if (s.type === 'ellipsoid') {
    const r = s.radii as V;
    return ext(a => { const e = Math.hypot(R[a][0] * r[0], R[a][1] * r[1], R[a][2] * r[2]); return [c[a] - e, c[a] + e]; });
  }
  if (s.type === 'capsule') {
    const half = (s.length as number) / 2, r = s.radius as number;
    return ext(a => { const e = Math.abs(axis[a]) * half + r; return [c[a] - e, c[a] + e]; });
  }
  if (s.type === 'cylinder') {
    const half = (s.height as number) / 2, r = s.radius as number;
    return ext(a => { const e = Math.abs(axis[a]) * half + disc(r, a); return [c[a] - e, c[a] + e]; });
  }
  // cone: base disc at -height/2, top disc at +height/2 along the local axis
  const half = (s.height as number) / 2, rb = s.baseRadius as number, rt = s.topRadius as number;
  return ext(a => {
    const base = c[a] - axis[a] * half, top = c[a] + axis[a] * half;
    return [Math.min(base - disc(rb, a), top - disc(rt, a)), Math.max(base + disc(rb, a), top + disc(rt, a))];
  });
}

function pointBox(id: string, pts: V[], pad: number): PartBox {
  const dim = pts[0].length;
  const min = Array.from({ length: dim }, (_, a) => Math.min(...pts.map(p => p[a])) - pad);
  const max = Array.from({ length: dim }, (_, a) => Math.max(...pts.map(p => p[a])) + pad);
  return { id, min, max };
}

// ---------------------------------------------------------------- V7 complexity

function checkComplexity(scene: Obj, boxes: PartBox[], limits: SceneLimits, issues: Issues): void {
  const over = (count: number, cap: number, path: string, what: string) => {
    if (count > cap) issues.add('complexity', path, `${what}: ${count}; the limit is ${cap}`);
  };
  const parts = scene.parts as Obj[];
  if (scene.mode === 'silhouette2d') {
    over(parts.length, limits.parts2D, '/parts', 'parts');
    over(parts.filter(p => p.operation === 'subtract').length, limits.subtractParts2D, '/parts', 'subtract parts');
    let total = 0;
    parts.forEach((part, i) => {
      const g = part.geometry as Obj, gp = `/parts/${i}/geometry/points`;
      if (g.type === 'ellipse') return;
      const n = (g.points as V[]).length;
      total += n;
      if (g.type === 'polygon') over(n, limits.polygonVertices, gp, 'polygon vertices');
      else over(segmentCount(n) ?? 0, g.type === 'path' ? limits.segmentsPath : limits.segmentsStroke, gp, `${String(g.type)} segments`);
    });
    over(total, limits.controlPoints2D, '/parts', 'total control points');
    return;
  }
  over(parts.length, limits.parts3DDeclared, '/parts', 'declared parts');
  over(boxes.length, limits.parts3DMirrored, '/parts', 'parts after mirroring');
  over((scene.materials as Obj[]).length, limits.materials3D, '/materials', 'materials');
  let total = 0;
  parts.forEach((part, i) => {
    const s = part.shape as Obj;
    if (s.type !== 'taperedTube') return;
    const n = (s.points as V[]).length;
    total += n;
    over(segmentCount(n) ?? 0, limits.segmentsTube, `/parts/${i}/shape/points`, 'taperedTube segments');
  });
  over(total, limits.controlPoints3D, '/parts', 'total control points');
}

// ---------------------------------------------------------------- V9 floating parts (3D, warning)

function checkFloating(boxes: PartBox[], warnings: Issues): void {
  if (boxes.length < 2) return;
  let extent = 0;
  for (let a = 0; a < 3; a++) {
    extent = Math.max(extent, Math.max(...boxes.map(b => b.max[a])) - Math.min(...boxes.map(b => b.min[a])));
  }
  const pad = FLOAT_INFLATE * extent;
  const touch = (p: PartBox, q: PartBox) => [0, 1, 2].every(a => p.min[a] - pad <= q.max[a] + pad && q.min[a] - pad <= p.max[a] + pad);
  boxes.forEach((box, i) => {
    if (!boxes.some((other, j) => j !== i && touch(box, other))) {
      warnings.add('floating-part', `/parts`, `part "${box.id}" touches no other part`);
    }
  });
}

// ---------------------------------------------------------------- helpers

const deg = (d: number) => (d * Math.PI) / 180;
const sub = (a: V, b: V): V => a.map((x, i) => x - b[i]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const dist = (a: V, b: V) => Math.hypot(...sub(a, b));
const same = (a: V, b: V) => a.every((x, i) => x === b[i]);
const round = (v: number) => Math.round(v * 1e4) / 1e4;

function pointerEscape(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function describe(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.length > 40 ? `a ${v.length}-character string` : JSON.stringify(v);
  if (Array.isArray(v)) return `an array of ${v.length}`;
  return v === null ? 'null' : typeof v;
}

/** UTF-8 byte length without platform encoders (lone surrogates count as U+FFFD, 3 bytes). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
