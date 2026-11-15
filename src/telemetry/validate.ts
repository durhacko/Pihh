// src/telemetry/validate.ts
// RunRecord artifact validation (TIGER_TELEMETRY_AND_INGESTION_RFC.md §3; TIG-02). One pure function from file
// bytes to a validated record: it checks the parsed value field by field and returns it as a `RunRecord` only when
// every rule passes. Every error is listed (up to MAX_ISSUES), not just the first. Messages describe the rule and
// never echo payload values. No node:*, network or clock.
import type { RunRecord } from '../contracts/metrics';
import { FONT } from '../score/font';
import { canonicalJson } from '../score/canonical';

/** Stored with every import. A rule or cap change is a bump (RFC §3, §3.6). */
export const VALIDATOR_VERSION = '1.0.0';

/** RFC §3.6. */
export const CAPS = Object.freeze({
  fileBytes: 1024 * 1024,
  events: 1000,
  eventBytes: 64 * 1024,
  versionKeys: 64,
  gitChars: 46,
  n0: 10_000,
});

/** Errors listed before validation stops adding more (a hostile file could otherwise produce millions). */
export const MAX_ISSUES = 200;

/** `SCENARIO_IDS` in src/cli/scenarios.ts:13 (src/telemetry may not import src/cli; a test guards equality). */
export const SCENARIO_IDS: readonly string[] = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);

/** The 23 keys `calculateSummary` always emits (src/observer/summary.ts); `tRec` is added iff a KILL exists. */
export const SUMMARY_BASE_KEYS: readonly string[] = Object.freeze([
  'npwcEndA', 'npwcEnd', 'coverageEnd', 'sfMeanEnd', 'sfMaxEnd', 'sfMaxEndA', 'capacityLoss', 'coordLoss',
  'npwcDeficitSec', 'slotChanges', 'slotChangesMaxDrone', 'lateSlotChanges', 'dupSlotSec', 'dupSlotsEnd', 'collisions',
  'nearMisses', 'msgsPerDroneSec', 'deliveryRatio', 'adoptP50', 'adoptMax', 'unadopted', 'splitSec', 'tVersion',
]);
const SUMMARY_NON_NULL = new Set(['slotChanges', 'slotChangesMaxDrone', 'lateSlotChanges', 'dupSlotSec', 'collisions', 'nearMisses']);
const SUMMARY_INTEGER = new Set(['slotChanges', 'slotChangesMaxDrone', 'lateSlotChanges', 'collisions', 'nearMisses', 'dupSlotsEnd', 'unadopted']);

const RECORD_KEYS = ['v', 'git', 'paramsHash', 'scenario', 'arm', 'seed', 'n0', 'events', 'series', 'summary', 'stateHash'];
const SAMPLE_KEYS = ['tick', 'alive', 'coverage', 'pwc', 'npwc', 'sfMean', 'sfMax', 'dupSlots', 'versions', 'msgs', 'collisions', 'nearMisses', 'slotChanges'];
const MSG_KEYS = ['hb', 'score', 'delivered', 'lost', 'blocked'] as const;
const CUMULATIVE = ['collisions', 'nearMisses', 'slotChanges'] as const;
const SAMPLE_EVERY = 5;   // "one per 5 ticks" (metrics.ts:6)
const PWC_TOLERANCE = 1e-9;   // TCR-12: every fixture overshoots to 1.0000000000000004
const UINT32_MAX = 2 ** 32 - 1;
const OPERATOR = -1;

const GIT = /^([0-9a-f]{40}(-dirty)?|unknown)$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const VERSION_KEY = /^-?\d+:-?\d+$/;

const EVENT_KEYS: Record<string, readonly string[]> = {
  KILL: ['type', 'tick', 'ids'],
  JAM_ON: ['type', 'tick', 'id', 'centre', 'radius'],
  JAM_OFF: ['type', 'tick', 'id'],
  PARTITION_ON: ['type', 'tick', 'id', 'point', 'normal'],
  PARTITION_OFF: ['type', 'tick', 'id'],
  INJECT_SCORE: ['type', 'tick', 'droneId', 'score'],
  SET_LOSS: ['type', 'tick', 'loss'],
};

export type SourceKind = 'cli-scenario' | 'app-export';
export interface ValidationContext { sourceKind: SourceKind; expectedTicks: number }

/** `code` is SCREAMING_SNAKE; `path` is a JSON pointer into the record (`""` = the file). */
export interface Issue { code: string; path: string; message: string }

/** `cli-writer`: the bytes are exactly `JSON.stringify(record) + '\n'` (src/cli/main.ts); otherwise `other`. */
export type FileForm = 'cli-writer' | 'other';

/** `fileForm` is null when the input was an in-memory value rather than file bytes (`validateRecordObject`). */
export type Validation =
  | { ok: true; record: RunRecord; warnings: Issue[]; fileForm: FileForm | null }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

type Obj = Record<string, unknown>;

class Collector {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];
  private dropped = 0;
  private droppedWarnings = 0;
  error(code: string, path: string, message: string): void {
    if (this.errors.length < MAX_ISSUES) this.errors.push({ code, path, message });
    else this.dropped++;
  }
  warn(code: string, path: string, message: string): void {
    if (this.warnings.length < MAX_ISSUES) this.warnings.push({ code, path, message });
    else this.droppedWarnings++;
  }
  finish(): void {
    if (this.dropped > 0) this.errors.push({ code: 'TOO_MANY_ERRORS', path: '', message: `${this.dropped} further errors were not listed` });
    if (this.droppedWarnings > 0) this.warnings.push({ code: 'TOO_MANY_WARNINGS', path: '', message: `${this.droppedWarnings} further warnings were not listed` });
  }
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isNum);
}
function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

/** Exactly `keys`, no more, no fewer. Unknown key names are not echoed. Returns false if the shape is wrong. */
function exactKeys(c: Collector, value: Obj, keys: readonly string[], path: string, optional: readonly string[] = []): boolean {
  let ok = true;
  const allowed = new Set([...keys, ...optional]);
  const own = Object.keys(value);
  const unknown = own.filter(k => !allowed.has(k)).length;
  if (unknown > 0) { c.error('UNKNOWN_KEY', path, `${unknown} key(s) not allowed here`); ok = false; }
  for (const key of keys) if (!Object.hasOwn(value, key)) { c.error('MISSING_KEY', pointer(path, key), 'required key is missing'); ok = false; }
  return ok;
}

function hasBadString(text: string): boolean {
  if (text.includes('\u0000')) return true;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i++; continue; }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

/** Nesting deeper than this is refused before any recursive step (JSON.stringify, canonicalJson) can run. A real
 *  RunRecord is at most 9 levels deep (events → score → movements → recipe → palette → RGB). */
export const MAX_DEPTH = 64;

/** True iff the array's own keys are exactly '0'..'n-1' (no hole, no extra named key). Checked without walking
 *  `length` indices, so a huge sparse length costs only its own keys. */
function isDenseArray(value: unknown[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== value.length) return false;
  for (let i = 0; i < keys.length; i++) if (keys[i] !== String(i)) return false;
  return true;
}

/**
 * RFC §3.1 rules 2–3 over every reachable value: strings (keys included) and numbers. Iterative, depth-bounded and
 * cycle-safe. Returns false when the structure itself is unusable (too deep, a cycle, or a non-JSON array): the
 * caller then stops before any rule that recurses or walks array indices.
 */
function scanValues(c: Collector, root: unknown): boolean {
  let usable = true;
  const seen = new WeakSet<object>();
  const stack: { value: unknown; path: string; depth: number }[] = [{ value: root, path: '', depth: 0 }];
  while (stack.length > 0) {
    const { value, path, depth } = stack.pop()!;
    if (typeof value === 'string') {
      if (hasBadString(value)) c.error('BAD_STRING', path, 'string contains U+0000 or an unpaired surrogate');
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) c.error('NON_FINITE', path, 'number is not finite');
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    if (depth > MAX_DEPTH) { c.error('TOO_DEEP', path, `nesting is deeper than ${MAX_DEPTH}`); usable = false; continue; }
    // A parsed JSON value is a tree. In memory, a cycle (or a shared reference, which would make a depth-bounded walk
    // exponential) is refused; JSON.parse output never has either.
    if (seen.has(value)) { c.error('CYCLE', path, 'value is reachable twice (a cycle or shared reference; JSON data is a tree)'); usable = false; continue; }
    seen.add(value);
    if (Array.isArray(value)) {
      // A hole (sparse array) or an extra named key is not JSON: canonicalJson would emit `[,…]` or drop the key.
      // Only in-memory values can have either. Never walk such an array's indices.
      if (!isDenseArray(value)) { c.error('BAD_VALUE', path, 'array is not a JSON array (hole or named key)'); usable = false; continue; }
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], path: pointer(path, i), depth: depth + 1 });
    } else {
      for (const key of Object.keys(value)) {
        const bad = hasBadString(key);
        if (bad) c.error('BAD_STRING', path, 'a key contains U+0000 or an unpaired surrogate');
        stack.push({ value: (value as Obj)[key], path: bad ? path : pointer(path, key), depth: depth + 1 });
      }
    }
  }
  return usable;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function checkTop(c: Collector, r: Obj): void {
  if (typeof r.scenario !== 'string' || !SCENARIO_IDS.includes(r.scenario)) c.error('BAD_VALUE', '/scenario', 'scenario must be one of S0–S5');
  if (r.arm !== 'encore' && r.arm !== 'static') c.error('BAD_VALUE', '/arm', "arm must be 'encore' or 'static'");
  if (!isInt(r.seed) || r.seed < 0 || r.seed > UINT32_MAX) c.error('BAD_VALUE', '/seed', 'seed must be an integer in [0, 2^32 − 1]');
  if (!isInt(r.n0) || r.n0 < 1 || r.n0 > CAPS.n0) c.error('BAD_VALUE', '/n0', `n0 must be an integer in [1, ${CAPS.n0}]`);
  if (typeof r.git !== 'string' || r.git.length > CAPS.gitChars || !GIT.test(r.git)) c.error('BAD_VALUE', '/git', "git must be 40 hex, 40 hex + '-dirty', or 'unknown'");
  if (typeof r.paramsHash !== 'string' || !HEX64.test(r.paramsHash)) c.error('BAD_VALUE', '/paramsHash', 'paramsHash must be 64 lower-case hex');
  if (typeof r.stateHash !== 'string' || !HEX16.test(r.stateHash)) c.error('BAD_VALUE', '/stateHash', 'stateHash must be 16 lower-case hex');
}

function checkRecipe(c: Collector, recipe: unknown, path: string): void {
  if (!isObj(recipe)) { c.error('BAD_EVENT', path, 'recipe must be an object'); return; }
  const kind = recipe.kind;
  if (kind !== 'text' && kind !== 'sphere' && kind !== 'helix') { c.error('BAD_EVENT', pointer(path, 'kind'), 'recipe kind must be text, sphere or helix'); return; }
  exactKeys(c, recipe, kind === 'text' ? ['kind', 'text'] : ['kind'], path, ['palette']);
  if (kind === 'text') {
    const text = recipe.text;
    const drawable = (ch: string) => Object.hasOwn(FONT, ch) || (/^[a-z]$/.test(ch) && Object.hasOwn(FONT, ch.toUpperCase()));
    if (typeof text !== 'string' || ![...text].every(drawable)) c.error('BAD_EVENT', pointer(path, 'text'), 'text must use glyphs of the 5×7 font');
  }
  if (Object.hasOwn(recipe, 'palette')) {
    const palette = recipe.palette;
    const rgb = (v: unknown) => isVec3(v) && v.every(x => x >= 0 && x <= 1);
    if (!Array.isArray(palette) || palette.length !== 2 || !palette.every(rgb)) c.error('BAD_EVENT', pointer(path, 'palette'), 'palette must be two RGB triples in [0, 1]');
  }
}

function checkScore(c: Collector, score: unknown, path: string): void {
  if (!isObj(score) || !exactKeys(c, score, ['version', 'movements'], path)) { if (!isObj(score)) c.error('BAD_EVENT', path, 'score must be an object'); return; }
  const version = score.version;
  if (!isObj(version) || !exactKeys(c, version, ['issuedTick', 'origin'], pointer(path, 'version'))) {
    if (!isObj(version)) c.error('BAD_EVENT', pointer(path, 'version'), 'version must be an object');
  } else {
    if (!isInt(version.issuedTick)) c.error('BAD_EVENT', pointer(pointer(path, 'version'), 'issuedTick'), 'issuedTick must be an integer');
    if (!isInt(version.origin) || version.origin < OPERATOR) c.error('BAD_EVENT', pointer(pointer(path, 'version'), 'origin'), 'origin must be an integer ≥ −1');
  }
  const movements = score.movements;
  if (!Array.isArray(movements) || movements.length === 0) { c.error('BAD_EVENT', pointer(path, 'movements'), 'movements must be a non-empty array'); return; }
  let last = -Infinity;
  movements.forEach((movement, i) => {
    const at = pointer(pointer(path, 'movements'), i);
    if (!isObj(movement)) { c.error('BAD_EVENT', at, 'movement must be an object'); return; }
    exactKeys(c, movement, ['startTick', 'transitionTicks', 'recipe'], at);
    if (!isInt(movement.startTick)) c.error('BAD_EVENT', pointer(at, 'startTick'), 'startTick must be an integer');
    else {
      if (movement.startTick < last) c.error('BAD_EVENT', pointer(at, 'startTick'), 'movements must be sorted by startTick');
      last = movement.startTick;
    }
    if (!isInt(movement.transitionTicks) || movement.transitionTicks < 0) c.error('BAD_EVENT', pointer(at, 'transitionTicks'), 'transitionTicks must be an integer ≥ 0');
    checkRecipe(c, movement.recipe, pointer(at, 'recipe'));
  });
}

function checkEvents(c: Collector, events: unknown, n0: number, expectedTicks: number): void {
  if (!Array.isArray(events)) { c.error('BAD_VALUE', '/events', 'events must be an array'); return; }
  if (events.length > CAPS.events) { c.error('CAP_EXCEEDED', '/events', `more than ${CAPS.events} events`); return; }
  let lastTick = -Infinity;
  const open = { JAM: new Map<string, number>(), PARTITION: new Map<string, number>() };
  events.forEach((event, i) => {
    const at = pointer('/events', i);
    if (!isObj(event)) { c.error('BAD_EVENT', at, 'event must be an object'); return; }
    const type = event.type;
    if (typeof type !== 'string' || !Object.hasOwn(EVENT_KEYS, type)) { c.error('BAD_EVENT', pointer(at, 'type'), 'unknown event type'); return; }
    exactKeys(c, event, EVENT_KEYS[type]!, at);
    const tick = event.tick;
    if (!isInt(tick) || tick < 0 || tick > expectedTicks) c.error('BAD_EVENT', pointer(at, 'tick'), 'tick must be an integer in [0, expectedTicks]');
    else {
      if (tick < lastTick) c.error('BAD_EVENT', pointer(at, 'tick'), 'event ticks must be non-decreasing');
      lastTick = tick;
    }
    if (type.startsWith('JAM_') || type.startsWith('PARTITION_')) {
      if (typeof event.id !== 'string' || !EVENT_ID.test(event.id)) c.error('BAD_EVENT', pointer(at, 'id'), 'id must match ^[A-Za-z0-9_.:-]{1,64}$');
      else {
        const family = type.startsWith('JAM_') ? open.JAM : open.PARTITION;
        if (type.endsWith('_ON')) {
          if (family.has(event.id)) c.warn('UNMATCHED_EVENT', at, 'an _ON for an id that is already on');
          family.set(event.id, i);
        } else if (!family.delete(event.id)) c.warn('UNMATCHED_EVENT', at, 'an _OFF with no open _ON for its id');
      }
    }
    switch (type) {
      case 'KILL': {
        const ids = event.ids;
        const valid = Array.isArray(ids) && ids.length > 0 && ids.every(id => isInt(id) && id >= 0 && id < n0) && new Set(ids).size === ids.length;
        if (!valid) c.error('BAD_EVENT', pointer(at, 'ids'), 'ids must be a non-empty array of distinct integers in [0, n0)');
        break;
      }
      case 'JAM_ON':
        if (!isVec3(event.centre)) c.error('BAD_EVENT', pointer(at, 'centre'), 'centre must be three finite numbers');
        if (!isNum(event.radius) || event.radius <= 0) c.error('BAD_EVENT', pointer(at, 'radius'), 'radius must be finite and > 0');
        break;
      case 'PARTITION_ON':
        if (!isVec3(event.point)) c.error('BAD_EVENT', pointer(at, 'point'), 'point must be three finite numbers');
        if (!isVec3(event.normal) || event.normal.every(x => x === 0)) c.error('BAD_EVENT', pointer(at, 'normal'), 'normal must be three finite numbers, not all zero');
        break;
      case 'SET_LOSS':
        if (!isNum(event.loss) || event.loss < 0 || event.loss > 1) c.error('BAD_EVENT', pointer(at, 'loss'), 'loss must be finite and in [0, 1]');
        break;
      case 'INJECT_SCORE':
        if (!isInt(event.droneId) || event.droneId < 0 || event.droneId >= n0) c.error('BAD_EVENT', pointer(at, 'droneId'), 'droneId must be an integer in [0, n0)');
        checkScore(c, event.score, pointer(at, 'score'));
        break;
    }
    try {
      if (utf8Length(canonicalJson(event)) > CAPS.eventBytes) c.error('CAP_EXCEEDED', at, `event canonical JSON is over ${CAPS.eventBytes} bytes`);
    } catch {
      // canonicalJson throws only on a non-finite number, already reported by scanValues.
    }
  });
  for (const [family, map] of Object.entries(open)) {
    for (const index of map.values()) c.warn('UNMATCHED_EVENT', pointer('/events', index), `a ${family}_ON that never closes`);
  }
}

function checkSeries(c: Collector, series: unknown, n0: number, expectedTicks: number): Obj[] | null {
  if (!Array.isArray(series)) { c.error('BAD_VALUE', '/series', 'series must be an array'); return null; }
  const expected = expectedTicks / SAMPLE_EVERY;
  if (series.length !== expected) c.error('BAD_TICKS', '/series', `series must have exactly expectedTicks / ${SAMPLE_EVERY} samples`);
  if (series.length > expected) return null;   // the sample cap (§3.6): never walk an over-long series
  const samples: Obj[] = [];
  let previous: Obj | null = null;
  series.forEach((sample, i) => {
    const at = pointer('/series', i);
    if (!isObj(sample)) { c.error('BAD_SAMPLE', at, 'sample must be an object'); previous = null; return; }
    samples.push(sample);
    exactKeys(c, sample, SAMPLE_KEYS, at);
    if (sample.tick !== SAMPLE_EVERY * (i + 1)) c.error('BAD_TICKS', pointer(at, 'tick'), `tick must be ${SAMPLE_EVERY} × (index + 1)`);
    const alive = sample.alive;
    const aliveOk = isInt(alive) && alive >= 0 && alive <= n0;
    if (!aliveOk) c.error('BAD_SAMPLE', pointer(at, 'alive'), 'alive must be an integer in [0, n0]');
    if (!isInt(sample.dupSlots) || sample.dupSlots < 0 || (aliveOk && sample.dupSlots > (alive as number))) c.error('BAD_SAMPLE', pointer(at, 'dupSlots'), 'dupSlots must be an integer in [0, alive]');
    if (!isNum(sample.coverage) || sample.coverage < 0 || sample.coverage > 1) c.error('BAD_SAMPLE', pointer(at, 'coverage'), 'coverage must be in [0, 1]');
    if (!isNum(sample.pwc) || sample.pwc < 0 || sample.pwc > 1 + PWC_TOLERANCE) c.error('BAD_SAMPLE', pointer(at, 'pwc'), 'pwc must be in [0, 1 + 1e-9]');
    if (aliveOk) {
      if (alive === 0) {
        if (sample.npwc !== null) c.error('BAD_SAMPLE', pointer(at, 'npwc'), 'npwc must be null when alive is 0');
        if (sample.sfMean !== null || sample.sfMax !== null) c.error('BAD_SAMPLE', pointer(at, 'sfMean'), 'sfMean and sfMax must be null when alive is 0');
      } else {
        if (!isNum(sample.npwc) || sample.npwc < 0) c.error('BAD_SAMPLE', pointer(at, 'npwc'), 'npwc must be finite and ≥ 0 when alive > 0');
        for (const key of ['sfMean', 'sfMax'] as const) {
          const value = sample[key];
          if (value === null) c.warn('NULL_SHAPE_FIDELITY', pointer(at, key), `${key} is null with alive > 0 (a formation with no dense points)`);
          else if (!isNum(value) || value < 0) c.error('BAD_SAMPLE', pointer(at, key), `${key} must be finite and ≥ 0, or null`);
        }
      }
    }
    const versions = sample.versions;
    if (!isObj(versions)) c.error('BAD_SAMPLE', pointer(at, 'versions'), 'versions must be an object');
    else {
      const keys = Object.keys(versions);
      if (keys.length > CAPS.versionKeys) c.error('CAP_EXCEEDED', pointer(at, 'versions'), `more than ${CAPS.versionKeys} version keys`);
      let sum = 0;
      let valid = true;
      for (const key of keys) {
        const count = versions[key];
        if (!VERSION_KEY.test(key) || !isInt(count) || count < 0) { valid = false; continue; }
        sum += count;
      }
      if (!valid) c.error('BAD_SAMPLE', pointer(at, 'versions'), 'versions keys must be issuedTick:origin with integer counts ≥ 0');
      else if (aliveOk && sum !== alive) c.error('INCONSISTENT', pointer(at, 'versions'), 'versions counts must sum to alive');
    }
    const msgs = sample.msgs;
    if (!isObj(msgs)) c.error('BAD_SAMPLE', pointer(at, 'msgs'), 'msgs must be an object');
    else {
      exactKeys(c, msgs, MSG_KEYS, pointer(at, 'msgs'));
      for (const key of MSG_KEYS) if (!isInt(msgs[key]) || (msgs[key] as number) < 0) c.error('BAD_SAMPLE', pointer(pointer(at, 'msgs'), key), 'counter must be an integer ≥ 0');
    }
    for (const key of CUMULATIVE) if (!isInt(sample[key]) || (sample[key] as number) < 0) c.error('BAD_SAMPLE', pointer(at, key), 'counter must be an integer ≥ 0');

    const prev: Obj | null = previous;
    if (prev) {
      if (isInt(prev.alive) && aliveOk && (alive as number) > prev.alive) c.error('BAD_SAMPLE', pointer(at, 'alive'), 'alive must not increase');
      for (const key of CUMULATIVE) {
        if (isInt(prev[key]) && isInt(sample[key]) && (sample[key] as number) < (prev[key] as number)) c.error('COUNTER_DECREASED', pointer(at, key), 'cumulative counter decreased');
      }
      const before = prev.msgs;
      if (isObj(before) && isObj(msgs)) {
        for (const key of MSG_KEYS) {
          if (isInt(before[key]) && isInt(msgs[key]) && (msgs[key] as number) < (before[key] as number)) c.error('COUNTER_DECREASED', pointer(pointer(at, 'msgs'), key), 'cumulative counter decreased');
        }
      }
    }
    previous = sample;
  });
  return samples;
}

function checkSummary(c: Collector, summary: unknown, events: unknown, samples: Obj[] | null, expectedTicks: number): void {
  if (!isObj(summary)) { c.error('BAD_VALUE', '/summary', 'summary must be an object'); return; }
  const hasKill = Array.isArray(events) && events.some(e => isObj(e) && e.type === 'KILL');
  exactKeys(c, summary, hasKill ? [...SUMMARY_BASE_KEYS, 'tRec'] : SUMMARY_BASE_KEYS, '/summary');
  for (const key of Object.keys(summary)) {
    const value = summary[key];
    const at = pointer('/summary', key);
    if (value === null) {
      if (SUMMARY_NON_NULL.has(key)) c.error('BAD_SUMMARY', at, 'value must not be null');
      continue;
    }
    if (!isNum(value)) { c.error('BAD_SUMMARY', at, 'value must be a finite number or null'); continue; }
    if (SUMMARY_INTEGER.has(key) && !Number.isSafeInteger(value)) c.error('BAD_SUMMARY', at, 'value must be an integer');
    if (key === 'tRec' && value < 0) c.error('BAD_SUMMARY', at, 'tRec must be ≥ 0');
  }
  const last = samples?.at(-1);
  if (last && last.tick === expectedTicks) {
    for (const key of CUMULATIVE) {
      if (isNum(summary[key]) && isInt(last[key]) && summary[key] !== last[key]) c.error('INCONSISTENT', pointer('/summary', key), 'must equal the last sample counter');
    }
    if (isNum(summary.dupSlotsEnd) && isInt(last.dupSlots) && summary.dupSlotsEnd !== last.dupSlots) c.error('INCONSISTENT', '/summary/dupSlotsEnd', "must equal the last sample's dupSlots");
  }
}

function checkContext(ctx: ValidationContext): void {
  if (!Number.isSafeInteger(ctx.expectedTicks) || ctx.expectedTicks <= 0 || ctx.expectedTicks % SAMPLE_EVERY !== 0) {
    throw new Error('validate: expectedTicks must be a positive multiple of 5');
  }
  if (ctx.sourceKind !== 'cli-scenario' && ctx.sourceKind !== 'app-export') throw new Error('validate: unknown sourceKind');
}

/** §3.2–§3.5 over a parsed value. `text` is the decoded file, for the writer-form check, or null. `bom` is true when
 *  the bytes began with a UTF-8 BOM (stripped by the decoder, as RFC §3.1's `TextDecoder` does), which the CLI writer
 *  never emits. */
function checkParsed(parsed: unknown, ctx: ValidationContext, text: string | null, bom = false): Validation {
  if (!isObj(parsed)) return { ok: false, errors: [{ code: 'NOT_OBJECT', path: '', message: 'top level must be a JSON object' }], warnings: [] };
  // §3.2 rule 6 first: another version has another shape, so nothing else applies.
  if (Object.hasOwn(parsed, 'v') && parsed.v !== 1) {
    return { ok: false, errors: [{ code: 'SCHEMA_VERSION_UNSUPPORTED', path: '/v', message: 'only RunRecord v 1 is supported' }], warnings: [] };
  }
  const c = new Collector();
  if (!scanValues(c, parsed)) {
    // Too deep, a cycle or a non-JSON array: the rules below recurse or walk indices, so stop here.
    c.finish();
    return { ok: false, errors: c.errors, warnings: c.warnings };
  }
  exactKeys(c, parsed, RECORD_KEYS, '');
  checkTop(c, parsed);
  const n0 = isInt(parsed.n0) && parsed.n0 >= 1 ? parsed.n0 : 0;
  checkEvents(c, parsed.events, n0, ctx.expectedTicks);
  const samples = checkSeries(c, parsed.series, n0, ctx.expectedTicks);
  checkSummary(c, parsed.summary, parsed.events, samples, ctx.expectedTicks);

  let fileForm: FileForm | null = null;
  if (text !== null && c.errors.length === 0) {
    // Only for a record that passed every rule (so its depth and size are bounded); never throws out of here.
    let writerText: string | null = null;
    try { writerText = `${JSON.stringify(parsed)}\n`; } catch { writerText = null; }
    fileForm = !bom && writerText !== null && text === writerText ? 'cli-writer' : 'other';
    if (fileForm === 'other') c.warn('WRITER_FORM', '', "bytes are not the CLI writer's form (re-serialised, pretty-printed or duplicate keys)");
  }
  c.finish();
  if (c.errors.length > 0) return { ok: false, errors: c.errors, warnings: c.warnings };
  return { ok: true, record: parsed as unknown as RunRecord, warnings: c.warnings, fileForm };
}

/** §3.2–§3.5 over an in-memory value (no bytes, so no size, UTF-8 or writer-form check). Used for values that never
 *  went through JSON, where a NaN or Infinity can still be present (T03). The value must be JSON-shaped: a tree (no
 *  cycle or shared reference), dense arrays, depth ≤ MAX_DEPTH. Never mutates `value`. */
export function validateRecordObject(value: unknown, ctx: ValidationContext): Validation {
  checkContext(ctx);
  return checkParsed(value, ctx, null);
}

/** RFC §3: bytes → validated `RunRecord`, or every error found. Never mutates `bytes`. */
export function validateRunRecord(bytes: Uint8Array, ctx: ValidationContext): Validation {
  checkContext(ctx);
  // §3.1: size before parsing, strict UTF-8, JSON, plain object.
  if (bytes.byteLength > CAPS.fileBytes) return { ok: false, errors: [{ code: 'CAP_EXCEEDED', path: '', message: `file is over ${CAPS.fileBytes} bytes` }], warnings: [] };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);   // RFC §3.1 rule 2; strips a leading BOM
  } catch {
    return { ok: false, errors: [{ code: 'NOT_UTF8', path: '', message: 'file is not valid UTF-8' }], warnings: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ code: 'NOT_JSON', path: '', message: 'file is not valid JSON' }], warnings: [] };
  }
  const bom = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return checkParsed(parsed, ctx, text, bom);
}
