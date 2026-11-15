// src/app/compose/validate.ts (XI-13): the pure composition validator of the show library (MDB-WP-02, #230).
// Canonical spec: docs/integrations/mongodb-atlas-show-library.md section 9, rules R1-R16; tests MDB-T01-T10.
//
// PURE: imports only src/contracts, src/score and src/score/font. No DOM, no three.js, no node:*, no network, no
// src/sim, src/app/actions or src/app/ui (tests/persistence/imports.test.ts scans the transitive imports), so the
// app (before save, before load) and the optional gateway (on write, on read) run this ONE module (XI-2).
//
// - validateComposition: the stored body, SavedShowComposition (section 8.1).
// - validateShowRequest: the POST /api/shows body (section 10.2) around it: schemaVersion, title, prompt, source,
//   generator. The stored-document reader (_id, preview, hashes, dates), operationId and R1 (bytes, UTF-8, the
//   depth pre-scan) belong to the gateway (MDB-WP-03/04).
//
// Both are total over unknown and never throw. Validation is shape-directed: it descends only into known fields, so
// anything outside the shape fails as UNKNOWN_KEY or INVALID_FIELD before canonicalJson (src/score/canonical.ts) could
// recurse into it. Outputs are fresh plain objects; text is upper-cased so equal shows hash equally.
// contentHash = sha256(canonicalJson(composition)) is computed by its callers, never here (no copy of either).
import type { Params, Recipe, RGB } from '../../contracts';
import { expandRecipe } from '../../score';
import { FONT } from '../../score/font';

// ------------------------------------------------------------------------- text (moved from src/app/ui/commands.ts)

/** The most characters a text recipe may have. Moved here from commands.ts, which re-exports it (XI-13). */
export const TEXT_MAX = 20;

/**
 * Text a text recipe can draw: 1–20 characters, not all spaces, each in the score package's font table either as
 * typed or as an ASCII lower-case letter. Checked per character as typed, so Unicode case mapping (ß -> SS,
 * ı -> I) cannot smuggle a character past the font. Moved here from commands.ts, which re-exports it (XI-13).
 */
export function validateText(text: string): string | null {
  const chars = [...text];
  if (!text.trim()) return 'form text needs a word in quotes, e.g. form text "DURHACK".';
  if (chars.length > TEXT_MAX) return `Text is ${chars.length} characters; the most is ${TEXT_MAX}.`;
  const drawable = (ch: string) => Object.hasOwn(FONT, ch) || (/^[a-z]$/.test(ch) && Object.hasOwn(FONT, ch.toUpperCase()));
  const bad = [...new Set(chars.filter(ch => !drawable(ch)))];
  if (bad.length) return `The font has no ${bad.map(ch => `"${ch}"`).join(', ')}. Use A–Z, 0–9 and spaces.`;
  return null;
}

// ------------------------------------------------------------------------------------------------ types and limits

/** One stored movement: what to fly and for how long. No startTick, transitionTicks or version (MCR-04, MCR-06). */
export interface SavedShowMovement { recipe: Recipe; holdTicks: number }
/** The stored body (XI-21): a reusable composition, not a runtime Score. Not the X-IN file kind encore.composition. */
export interface SavedShowComposition { v: 1; movements: SavedShowMovement[] }

/** Canonical spec section 7.1 and section 9 (R1, R8, R9). maxBodyBytes is enforced by the gateway's body reader. */
export const COMPOSITION_LIMITS: Readonly<{ maxMovements: number; maxHoldTicks: number; maxTitleChars: number; maxPromptChars: number; maxBodyBytes: number }> =
  Object.freeze({ maxMovements: 16, maxHoldTicks: 6000, maxTitleChars: 80, maxPromptChars: 2000, maxBodyBytes: 65536 });

/** Section 7.1: generator field bounds (model 1–100, integrationVersion 1–20, at most 16 scene hashes of 64 hex). */
export const GENERATOR_LIMITS: Readonly<{ maxModelChars: number; maxIntegrationVersionChars: number; maxSceneHashes: number }> =
  Object.freeze({ maxModelChars: 100, maxIntegrationVersionChars: 20, maxSceneHashes: 16 });

/** The schemaVersion this reader supports. 2 (generated recipes) arrives with GF-CC-01 (XI-8). */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Reasons (spec section 10.1 ReasonCode, plus the XI-3 code SCHEMA_VERSION_UNSUPPORTED for a newer schemaVersion). */
export type CompositionReason =
  | 'UNSUPPORTED_RECIPE' | 'INVALID_TEXT' | 'INVALID_COLOUR' | 'INVALID_TIMING' | 'RUNTIME_FIELD'
  | 'UNKNOWN_KEY' | 'INVALID_FIELD' | 'TOO_MANY_MOVEMENTS' | 'EXPANSION_FAILED' | 'SCHEMA_VERSION_UNSUPPORTED';
/** One problem: a JSON path ("" for the whole input), the rule R1–R16 it breaks, and its reason. An XI-3 details[] entry. */
export interface CompositionIssue { path: string; rule: string; reason: CompositionReason }
export type CompositionCheck =
  | { ok: true; composition: SavedShowComposition; warnings: CompositionIssue[] }
  | { ok: false; errors: CompositionIssue[] };

export type ShowSource = 'gemini' | 'manual';
export interface Generator { model: string; integrationVersion: string; sceneHashes?: string[] }
/** A validated, normalised POST /api/shows body: the fields requestHash covers (section 7.3). */
export interface ShowRequest {
  schemaVersion: 1; title: string; prompt?: string; composition: SavedShowComposition; source: ShowSource; generator?: Generator;
}
export type ShowRequestCheck =
  | { ok: true; request: ShowRequest; warnings: CompositionIssue[] }
  | { ok: false; errors: CompositionIssue[] };

export interface CompositionOptions {
  /**
   * 'save' (default): text in ASCII lower case is accepted and upper-cased in the output.
   * 'stored': data read back from storage must already be canonical; lower-case text is rejected, not normalised (MDB-T03).
   */
  mode?: 'save' | 'stored';
}

// ------------------------------------------------------------------------------------------------------- helpers

const KINDS: readonly string[] = ['text', 'sphere', 'helix'];   // GF-CC-01 hook: 'generated', schemaVersion 2 only
/** Runtime fields (spec section 10.1): RUNTIME_FIELD wherever they appear, at any level of the shape (MDB-T06). */
const RUNTIME_FIELDS: readonly string[] = ['version', 'startTick', 'transitionTicks', 'origin', 'droneId'];
const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

type Issues = CompositionIssue[];
/** JSON path: `a.b[0].c`; a key that is not an identifier (dotted, empty, …) is quoted, `a["x.y"]`, so it cannot pose as nesting. */
const at = (path: string, key: string | number) =>
  typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;

// READ ONCE. Every container is read exactly once, through property descriptors, into a snapshot; every check and the
// output copy then use only the snapshot. No [[Get]] and no `.length` read ever touches the input, so a Proxy or an
// accessor cannot show one value to the check and another to the copy.

/** One read of a plain data object: its own keys, the value of each own data property, and its accessor keys. */
interface Fields { keys: readonly (string | symbol)[]; values: ReadonlyMap<string, unknown>; accessors: ReadonlySet<string> }

/** Snapshot of a plain object (prototype Object.prototype or null, not an array), or null for anything else. */
function readFields(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto: unknown = Reflect.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(value);
  const values = new Map<string, unknown>();
  const accessors = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const d = Reflect.getOwnPropertyDescriptor(value, key);
    if (d && 'value' in d) values.set(key, d.value);
    else accessors.add(key);   // an accessor, or a key that vanished between the two reads: never a value
  }
  return { keys, values, accessors };
}

/**
 * Snapshot of a dense array: its own keys must be exactly '0'…'n-1' and 'length', every index an own data property.
 * Holes, extra keys, accessors and a non-array give 'shape'; more than `max` elements give 'too-long', unread.
 */
function readArray(value: unknown, max: number): { items: unknown[] } | { problem: 'shape' | 'too-long' } {
  if (!Array.isArray(value)) return { problem: 'shape' };
  const lengthDesc = Reflect.getOwnPropertyDescriptor(value, 'length');
  const n: unknown = lengthDesc && 'value' in lengthDesc ? lengthDesc.value : undefined;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return { problem: 'shape' };
  if (n > max) return { problem: 'too-long' };
  const keys = Reflect.ownKeys(value);
  if (keys.length !== n + 1) return { problem: 'shape' };
  const expected = new Set<string | symbol>(['length']);
  for (let i = 0; i < n; i++) expected.add(String(i));
  if (!keys.every(k => expected.has(k))) return { problem: 'shape' };
  const items: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const d = Reflect.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) return { problem: 'shape' };
    items.push(d.value);
  }
  return { items };
}

/**
 * R2/R16 key check on a snapshot. Every own key must be in `allowed`; symbol, '$'-prefixed, dotted and prototype keys
 * are rejected (R2); runtime fields get RUNTIME_FIELD (R9) at every level; accessor properties are INVALID_FIELD.
 */
function checkKeys(fields: Fields, path: string, allowed: readonly string[], rule: string, issues: Issues): void {
  for (const key of fields.keys) {
    if (typeof key !== 'string') { issues.push({ path, rule: 'R2', reason: 'UNKNOWN_KEY' }); continue; }
    const p = at(path, key);
    if (FORBIDDEN_KEYS.includes(key) || key.startsWith('$') || key.includes('.')) issues.push({ path: p, rule: 'R2', reason: 'UNKNOWN_KEY' });
    else if (RUNTIME_FIELDS.includes(key)) issues.push({ path: p, rule: 'R9', reason: 'RUNTIME_FIELD' });
    else if (!allowed.includes(key)) issues.push({ path: p, rule, reason: 'UNKNOWN_KEY' });
    else if (fields.accessors.has(key)) issues.push({ path: p, rule, reason: 'INVALID_FIELD' });
  }
}

const codePoints = (s: string) => [...s].length;
/** Lone surrogates cannot be encoded as UTF-8; such a string is never a valid stored string. */
const wellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const channel = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

function checkPalette(value: unknown, path: string, issues: Issues): [RGB, RGB] | null {
  const pair = readArray(value, 2);
  if (!('items' in pair) || pair.items.length !== 2) { issues.push({ path, rule: 'R13', reason: 'INVALID_COLOUR' }); return null; }
  const out: RGB[] = [];
  pair.items.forEach((entry, i) => {
    const triple = readArray(entry, 3);
    if (!('items' in triple) || triple.items.length !== 3 || !triple.items.every(channel)) { issues.push({ path: at(path, i), rule: 'R13', reason: 'INVALID_COLOUR' }); return; }
    const [r, g, b] = triple.items as [number, number, number];
    out.push([r + 0, g + 0, b + 0]);   // the snapshot values; + 0 turns -0 into 0, as canonicalJson would
  });
  return out.length === 2 ? [out[0]!, out[1]!] : null;
}

function checkRecipe(value: unknown, path: string, mode: 'save' | 'stored', issues: Issues): Recipe | null {
  const fields = readFields(value);
  if (!fields) { issues.push({ path, rule: 'R11', reason: 'INVALID_FIELD' }); return null; }
  const kind = fields.values.get('kind');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    // GF-CC-01 hook: a 'generated' recipe (schemaVersion 2 only) is checked here, and its trial expansion uses the
    // strict path (expandRecipeStrict), never the total expandRecipe, whose fallback sphere would hide a rejection.
    issues.push({ path: at(path, 'kind'), rule: 'R10', reason: 'UNSUPPORTED_RECIPE' });
    return null;   // nothing else of an unsupported recipe is read, and it is never expanded (MDB-T02)
  }
  const before = issues.length;
  checkKeys(fields, path, kind === 'text' ? ['kind', 'text', 'palette'] : ['kind', 'palette'], 'R11', issues);
  let text = '';
  if (kind === 'text') {
    const raw = fields.values.get('text');
    const textPath = at(path, 'text');
    // validateText also rejects lone surrogates: they are not in FONT.
    if (typeof raw !== 'string' || validateText(raw) !== null) issues.push({ path: textPath, rule: 'R12', reason: 'INVALID_TEXT' });
    else if (mode === 'stored' && raw !== raw.toUpperCase()) issues.push({ path: textPath, rule: 'R12', reason: 'INVALID_TEXT' });
    else text = raw.toUpperCase();
  }
  let palette: [RGB, RGB] | null = null;
  if (fields.values.has('palette')) palette = checkPalette(fields.values.get('palette'), at(path, 'palette'), issues);
  if (issues.length > before) return null;
  const tail = palette ? { palette } : {};
  return kind === 'text' ? { kind: 'text', text, ...tail } : { kind: kind as 'sphere' | 'helix', ...tail };
}

function checkMovement(value: unknown, path: string, params: Params, mode: 'save' | 'stored', issues: Issues): SavedShowMovement | null {
  const fields = readFields(value);
  if (!fields) { issues.push({ path, rule: 'R9', reason: 'INVALID_FIELD' }); return null; }
  const before = issues.length;
  checkKeys(fields, path, ['recipe', 'holdTicks'], 'R9', issues);
  const hold = fields.values.get('holdTicks');
  const holdOk = typeof hold === 'number' && Number.isSafeInteger(hold) && hold >= 0 && hold <= COMPOSITION_LIMITS.maxHoldTicks;
  if (!holdOk) issues.push({ path: at(path, 'holdTicks'), rule: 'R9', reason: 'INVALID_TIMING' });
  const recipe = checkRecipe(fields.values.get('recipe'), at(path, 'recipe'), mode, issues);
  if (recipe) {
    // R14: trial expansion at this n0, as validateDraft does. Today's kinds go through expandRecipe, which throws on a
    // bad recipe; it must also give exactly n0 slots. It expands the validated copy, never the input.
    let ok = false;
    try { ok = expandRecipe(recipe, params.n0, params).slots.length === params.n0; } catch { ok = false; }
    if (!ok) issues.push({ path: at(path, 'recipe'), rule: 'R14', reason: 'EXPANSION_FAILED' });
  }
  if (issues.length > before || !recipe || !holdOk) return null;
  return { recipe, holdTicks: (hold as number) + 0 };   // -0 -> 0
}

function checkComposition(value: unknown, path: string, params: Params, mode: 'save' | 'stored', issues: Issues): SavedShowComposition | null {
  const fields = readFields(value);
  if (!fields) { issues.push({ path, rule: 'R7', reason: 'INVALID_FIELD' }); return null; }
  const before = issues.length;
  checkKeys(fields, path, ['v', 'movements'], 'R7', issues);
  if (fields.values.get('v') !== 1) issues.push({ path: at(path, 'v'), rule: 'R7', reason: 'INVALID_FIELD' });
  const mPath = at(path, 'movements');
  const movements = readArray(fields.values.get('movements'), COMPOSITION_LIMITS.maxMovements);
  const out: SavedShowMovement[] = [];
  if (!('items' in movements)) issues.push({ path: mPath, rule: 'R8', reason: movements.problem === 'too-long' ? 'TOO_MANY_MOVEMENTS' : 'INVALID_FIELD' });   // too long: not descended into
  else if (movements.items.length === 0) issues.push({ path: mPath, rule: 'R8', reason: 'INVALID_FIELD' });
  else {
    movements.items.forEach((item, i) => {
      const m = checkMovement(item, at(mPath, i), params, mode, issues);
      if (m) out.push(m);
    });
  }
  return issues.length > before ? null : { v: 1, movements: out };
}

/** Last resort: the input defeated the checks themselves (a Proxy, a throwing trap). Rejected, never thrown. */
const UNREADABLE: CompositionIssue = { path: '', rule: 'R2', reason: 'INVALID_FIELD' };

// --------------------------------------------------------------------------------------------------- public API

/**
 * Validates a stored composition body (R7–R14, and R2 for its keys). Total over unknown: never throws.
 * On success returns a fresh, normalised copy (text upper-cased, absent palettes omitted).
 */
export function validateComposition(input: unknown, params: Params, options: CompositionOptions = {}): CompositionCheck {
  try {
    const errors: Issues = [];
    const composition = checkComposition(input, '', params, options.mode ?? 'save', errors);
    return composition && errors.length === 0 ? { ok: true, composition, warnings: [] } : { ok: false, errors };
  } catch {
    return { ok: false, errors: [{ ...UNREADABLE }] };
  }
}

function checkPrintable(value: unknown, path: string, rule: string, min: number, max: number, issues: Issues, allowControl = false): string | null {
  // title and generator: no control or format characters; prompt: control characters other than newline and tab.
  const bad = allowControl ? /[^\P{Cc}\n\t]/u : /[\p{Cc}\p{Cf}]/u;
  if (typeof value !== 'string' || !wellFormed(value) || bad.test(value) || codePoints(value) < min || codePoints(value) > max) {
    issues.push({ path, rule, reason: 'INVALID_FIELD' });
    return null;
  }
  return value;
}

function checkGenerator(value: unknown, path: string, issues: Issues): Generator | null {
  const fields = readFields(value);
  if (!fields) { issues.push({ path, rule: 'R6', reason: 'INVALID_FIELD' }); return null; }
  const before = issues.length;
  checkKeys(fields, path, ['model', 'integrationVersion', 'sceneHashes'], 'R6', issues);
  const model = checkPrintable(fields.values.get('model'), at(path, 'model'), 'R6', 1, GENERATOR_LIMITS.maxModelChars, issues);
  const integrationVersion = checkPrintable(fields.values.get('integrationVersion'), at(path, 'integrationVersion'), 'R6', 1, GENERATOR_LIMITS.maxIntegrationVersionChars, issues);
  let sceneHashes: string[] | undefined;
  if (fields.values.has('sceneHashes')) {
    const hashes = readArray(fields.values.get('sceneHashes'), GENERATOR_LIMITS.maxSceneHashes);
    if (!('items' in hashes) || !hashes.items.every(h => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))) issues.push({ path: at(path, 'sceneHashes'), rule: 'R6', reason: 'INVALID_FIELD' });
    else sceneHashes = hashes.items as string[];
  }
  if (issues.length > before || model === null || integrationVersion === null) return null;
  return { model, integrationVersion, ...(sceneHashes ? { sceneHashes } : {}) };
}

/**
 * Validates a POST /api/shows body (R2–R14, R16) and returns the normalised request that requestHash covers
 * (title trimmed, text upper-cased, absent optional fields omitted). Total over unknown: never throws.
 * `operationId` is allowed as a key but not checked or returned: the gateway owns it (section 10.5). A newer
 * schemaVersion is reported as SCHEMA_VERSION_UNSUPPORTED and nothing else is read (never down-read, MDB-T10).
 */
export function validateShowRequest(input: unknown, params: Params): ShowRequestCheck {
  try {
    const errors: Issues = [];
    const fields = readFields(input);
    if (!fields) return { ok: false, errors: [{ path: '', rule: 'R16', reason: 'INVALID_FIELD' }] };
    const version = fields.values.get('schemaVersion');
    if (typeof version === 'number' && Number.isSafeInteger(version) && version > SUPPORTED_SCHEMA_VERSION) {
      return { ok: false, errors: [{ path: 'schemaVersion', rule: 'R3', reason: 'SCHEMA_VERSION_UNSUPPORTED' }] };
    }
    checkKeys(fields, '', ['schemaVersion', 'title', 'prompt', 'composition', 'source', 'generator', 'operationId'], 'R16', errors);
    if (version !== SUPPORTED_SCHEMA_VERSION) errors.push({ path: 'schemaVersion', rule: 'R3', reason: 'INVALID_FIELD' });
    const rawTitle = fields.values.get('title');
    const title = checkPrintable(typeof rawTitle === 'string' ? rawTitle.trim() : rawTitle, 'title', 'R4', 1, COMPOSITION_LIMITS.maxTitleChars, errors);
    let prompt: string | undefined;
    if (fields.values.has('prompt')) prompt = checkPrintable(fields.values.get('prompt'), 'prompt', 'R5', 0, COMPOSITION_LIMITS.maxPromptChars, errors, true) ?? undefined;
    const source = fields.values.get('source');
    if (source !== 'manual' && source !== 'gemini') errors.push({ path: 'source', rule: 'R6', reason: 'INVALID_FIELD' });
    let generator: Generator | null = null;
    const hasGenerator = fields.values.has('generator');
    if (source === 'gemini' && !hasGenerator) errors.push({ path: 'generator', rule: 'R6', reason: 'INVALID_FIELD' });
    else if (source !== 'gemini' && hasGenerator) errors.push({ path: 'generator', rule: 'R6', reason: 'INVALID_FIELD' });
    else if (hasGenerator) generator = checkGenerator(fields.values.get('generator'), 'generator', errors);
    const composition = checkComposition(fields.values.get('composition'), 'composition', params, 'save', errors);
    if (errors.length || title === null || !composition) return { ok: false, errors };
    const request: ShowRequest = {
      schemaVersion: 1, title, ...(prompt !== undefined ? { prompt } : {}), composition, source: source as ShowSource, ...(generator ? { generator } : {}),
    };
    return { ok: true, request, warnings: [] };
  } catch {
    return { ok: false, errors: [{ ...UNREADABLE }] };
  }
}

/** The listing summary a composition gives (section 7.1 `preview`). */
export function compositionPreview(c: SavedShowComposition): { movementCount: number; kinds: Recipe['kind'][] } {
  return { movementCount: c.movements.length, kinds: c.movements.map(m => m.recipe.kind) };
}
