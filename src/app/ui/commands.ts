// Command terminal language (FE-B1, #90): tokenise -> match the command table -> validate -> typed Intent.
// Pure module: no DOM, no clock, no dispatch, no eval/Function/dynamic import. Dispatch is FE-B2's job.
// Grammar and command table: research/ui-prototype/DESIGN.md section 6.
//
// Intents are shaped for the one action API in src/app/actions.ts. A `control` intent carries the exact
// ControlIntent steps to pass to the controller's handle(), in order. Where that API only toggles, the intent
// also carries `when`: dispatch only if the live state matches, otherwise the command is already in effect.
import type { EnvEvent, RGB, Recipe, WorldSnapshot } from '../../contracts';
import { FONT } from '../../score/font';
import { OPERATOR_JAM_ID, OPERATOR_PARTITION_ID, toggleOnAt, type ControlIntent, type ControlStatus } from '../actions';

// ---------------------------------------------------------------------------------------------- types

export type Precondition = { playing: boolean } | { jam: boolean } | { partition: boolean };

/**
 * Simulation commands: pass each step to the action controller's handle(), in order; stop at the first failure.
 * A leading `{ type: 'select' }` step (from --drone / --at) changes the selection even if a later step fails;
 * restore the previous selection in that case.
 */
export interface ControlPlan {
  kind: 'control';
  command: string;
  steps: ControlIntent[];
  /** Ask the stage for a drone first, then dispatch `{ type: 'select', id }` before the steps. The text is the prompt. */
  pick?: string;
  /** Toggle-based actions: dispatch only when the live state matches (see `liveState` and `shouldDispatch`). */
  when?: Precondition;
}

/** `inject`: the recipe comes from the draft store (FE-B2). `withRecipe` turns this into a ControlPlan. */
export interface InjectPlan {
  kind: 'inject';
  command: 'inject';
  /** `[{ type: 'select', id }]` for `--drone N`; empty when the current selection or a pick is used. */
  steps: ControlIntent[];
  pick?: string;
  /** null: the current draft. */
  draftId: string | null;
}

/** `form ...`: a new local draft. Nothing reaches a world until it is injected. */
export interface DraftIntent { kind: 'draft'; command: string; name: string; recipe: Recipe }

/** `step`: advance one tick. The action API has no step; the transport must provide it (FE-B2). */
export interface StepIntent { kind: 'step'; command: 'step' }

export type Lens = 'xray' | 'beliefs' | 'zones' | 'show' | 'ghosts' | 'tethers' | 'neighbourhood';
export type CameraPreset = 'audience' | 'quarter' | 'top';

/** Interface-only commands: they change what is shown, never a world. */
export type UiAction =
  | { type: 'inspect'; id: number; world: 'encore' | 'static'; alive: boolean }
  | { type: 'inspect-off' }
  | { type: 'view'; lens: Lens; on?: boolean }
  | { type: 'camera'; preset: CameraPreset }
  | { type: 'compare'; mode: 'on' | 'off' | 'static' }
  | { type: 'metrics' } | { type: 'timeline' } | { type: 'clear' } | { type: 'history' }
  | { type: 'drafts' } | { type: 'draft-use'; id: string } | { type: 'preview'; on: boolean }
  | { type: 'demo-run'; seconds: 90 } | { type: 'demo-stop' };
export interface UiIntent { kind: 'ui'; command: string; ui: UiAction }

export interface HelpIntent { kind: 'help'; command: 'help'; text: string }

/** A command from the design that is not built. It changes nothing. */
export interface PlannedIntent { kind: 'planned'; command: string; message: string }

export type Intent = ControlPlan | InjectPlan | DraftIntent | StepIntent | UiIntent | HelpIntent | PlannedIntent;

export type ParseResult = { ok: true; intent: Intent } | { ok: false; error: string; usage?: string };

/** What the caller knows. Every field is optional; commands that need a missing field are rejected. */
export interface ParseContext {
  /** The Encore world's latest snapshot: drone ids are checked against it (both worlds share the roster). */
  snapshot?: WorldSnapshot;
  /** The current seed: the default for `reset`. */
  seed?: number;
  /** Ids in the draft store, for `draft use` and `inject --draft`. Unchecked when absent. */
  drafts?: readonly string[];
  /** For completion only: offered first for `--drone` and `--at`. */
  selectedId?: number | null;
}

// --------------------------------------------------------------------------------------- the table

export type Status = 'main' | 'proto' | 'ui' | 'later';
type ValueType = 'int' | 'number' | 'colour' | 'text';

interface FlagSpec { name: string; arity: 0 | 1 | 2; hint: string; type?: ValueType; values?: readonly string[] }

interface Args { positional: string[]; flags: Map<string, string[]> }
type Build = (args: Args, ctx: ParseContext, spec: CommandSpec) => Intent | string;

export interface CommandSpec {
  path: readonly string[];
  /** Positional usage text, e.g. `"WORD"` or `on|off`. */
  args?: string;
  /** Number of positional arguments allowed. */
  min?: number;
  max?: number;
  /** Completions for the first positional argument. */
  values?: readonly string[];
  flags?: readonly FlagSpec[];
  /** Pairs of flags that cannot be used together. */
  exclusive?: readonly (readonly [string, string])[];
  desc: string;
  status: Status;
  build?: Build;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const SWATCHES = ['#FFB000', '#FF3D7F', '#00C2A8', '#B6F500', '#9B7BFF'] as const;
export const RADIUS_MAX = 40;
export const LOSS_MAX_PERCENT = 90;
export const TEXT_MAX = 20;
export const NAME_MAX = 24;

/** Lenses the production renderer has (ghost slots and tethers: #102, toggled through the layers' setVisible). */
const LENSES: Record<Lens, boolean> = { xray: true, beliefs: true, zones: true, show: true, ghosts: true, tethers: true, neighbourhood: false };

const FORM_FLAGS: readonly FlagSpec[] = [
  { name: 'colors', arity: 2, hint: '#RRGGBB #RRGGBB', type: 'colour', values: SWATCHES },
  { name: 'name', arity: 1, hint: 'NAME', type: 'text' },
];
const DRONE_FLAG = (name: string): FlagSpec => ({ name, arity: 1, hint: 'ID', type: 'int' });
const RADIUS_FLAG: FlagSpec = { name: 'radius', arity: 1, hint: `METRES (0, ${RADIUS_MAX}]`, type: 'number', values: ['6', '8', '12'] };
const PICK_FLAG: FlagSpec = { name: 'pick', arity: 0, hint: '' };

export const COMMANDS: readonly CommandSpec[] = [
  { path: ['help'], args: '[command]', max: 2, desc: 'List commands, or explain one', status: 'ui', build: buildHelp },
  { path: ['form', 'text'], args: '"WORD"', min: 1, max: 1, flags: FORM_FLAGS, desc: `New text draft (A–Z, 0–9, space; up to ${TEXT_MAX})`, status: 'main', build: buildForm('text') },
  { path: ['form', 'sphere'], flags: FORM_FLAGS, desc: 'New sphere draft', status: 'main', build: buildForm('sphere') },
  { path: ['form', 'helix'], flags: FORM_FLAGS, desc: 'New double-helix draft', status: 'main', build: buildForm('helix') },
  { path: ['form', 'svg'], args: 'FILE', desc: 'Formation from an SVG outline', status: 'later' },
  { path: ['form', 'cloud'], args: 'FILE', desc: 'Formation from an imported 3D point cloud', status: 'later' },
  { path: ['drafts'], desc: 'List local drafts', status: 'ui', build: ui({ type: 'drafts' }) },
  { path: ['draft', 'use'], args: 'ID', min: 1, max: 1, desc: 'Make a draft current', status: 'ui', build: buildDraftUse },
  { path: ['preview'], args: 'on|off', max: 1, values: ['on', 'off'], desc: 'Show the current draft in the stage (local only)', status: 'ui', build: buildPreview },
  { path: ['inject'], flags: [DRONE_FLAG('drone'), PICK_FLAG, { name: 'draft', arity: 1, hint: 'DRAFT', type: 'text' }], exclusive: [['drone', 'pick']], desc: 'Uplink a draft into ONE drone; radio does the rest', status: 'proto', build: buildInject },
  { path: ['play'], desc: 'Resume the simulation', status: 'main', build: () => control('play', [{ type: 'play' }], { when: { playing: false } }) },
  { path: ['pause'], desc: 'Pause the simulation', status: 'main', build: () => control('pause', [{ type: 'play' }], { when: { playing: true } }) },
  { path: ['step'], desc: 'Advance exactly one tick (50 ms)', status: 'main', build: () => ({ kind: 'step', command: 'step' }) },
  { path: ['reset'], flags: [{ name: 'seed', arity: 1, hint: 'N', type: 'int', values: ['101', '42'] }], desc: 'Rebuild both worlds from a seed', status: 'main', build: buildReset },
  { path: ['speed'], args: 'X', min: 1, max: 1, values: SPEEDS.map(String), desc: 'Playback speed 0.25–4×', status: 'main', build: buildSpeed },
  { path: ['fault', 'kill'], flags: [DRONE_FLAG('drone')], desc: 'Kill one drone (the selected one without --drone)', status: 'main', build: buildKill },
  { path: ['fault', 'kill-region'], flags: [RADIUS_FLAG, DRONE_FLAG('at'), PICK_FLAG], exclusive: [['at', 'pick']], desc: 'Kill every live drone in a sphere', status: 'main', build: buildKillRegion },
  { path: ['fault', 'kill-random'], flags: [{ name: 'percent', arity: 1, hint: '1–50', type: 'number', values: ['10'] }], desc: 'Kill 10% of the roster at random', status: 'main', build: buildKillRandom },
  { path: ['fault', 'jam'], flags: [RADIUS_FLAG, DRONE_FLAG('at'), PICK_FLAG], exclusive: [['at', 'pick']], desc: 'Jam radio inside a sphere (sensing still works)', status: 'main', build: buildJam },
  { path: ['fault', 'unjam'], args: '[ID]', max: 1, desc: 'Lift the jam', status: 'main', build: buildUnjam },
  { path: ['fault', 'partition'], args: 'on|off', min: 1, max: 1, values: ['on', 'off'], desc: 'Split the swarm into two radio groups at x = 0', status: 'proto', build: buildPartition },
  { path: ['fault', 'loss'], args: 'PERCENT', min: 1, max: 1, values: ['0', '5', '20', '50'], desc: `Packet loss for every receiver, 0–${LOSS_MAX_PERCENT} %`, status: 'proto', build: buildLoss },
  { path: ['inspect'], args: 'ID|off', min: 1, max: 1, values: ['off'], flags: [{ name: 'static', arity: 0, hint: '' }], desc: 'Open the inspector on a drone', status: 'ui', build: buildInspect },
  { path: ['view'], args: 'LENS [on|off]', min: 1, max: 2, values: Object.keys(LENSES), desc: 'Toggle a diagnostic lens (visual only)', status: 'ui', build: buildView },
  { path: ['camera'], args: 'PRESET', min: 1, max: 1, values: ['audience', 'quarter', 'top'], desc: 'Move the camera to a preset', status: 'ui', build: buildCamera },
  { path: ['compare'], args: 'on|off|static', min: 1, max: 1, values: ['on', 'off', 'static'], desc: 'Encore/static split, or show one world', status: 'ui', build: buildCompare },
  { path: ['metrics'], desc: 'Open the metrics readout', status: 'ui', build: ui({ type: 'metrics' }) },
  { path: ['timeline'], desc: 'Toggle the show timeline', status: 'ui', build: ui({ type: 'timeline' }) },
  { path: ['clear'], desc: 'Clear the console', status: 'ui', build: ui({ type: 'clear' }) },
  { path: ['history'], desc: 'Show command history', status: 'ui', build: ui({ type: 'history' }) },
  { path: ['demo', 'run'], args: '90', max: 1, values: ['90', '180'], desc: 'Run the 90-second scripted demo', status: 'proto', build: buildDemoRun },
  { path: ['demo', 'stop'], desc: 'Stop the scripted demo', status: 'ui', build: ui({ type: 'demo-stop' }) },
  { path: ['cue', 'add'], desc: 'Add a cue to the planned show', status: 'later' },
  { path: ['cue', 'move'], desc: 'Re-order or retime cues', status: 'later' },
  { path: ['show', 'save'], desc: 'Save the show to a file', status: 'later' },
  { path: ['show', 'load'], desc: 'Load a saved show', status: 'later' },
  { path: ['seek'], args: 'TIME', desc: 'Jump to a time (needs replay-to-tick)', status: 'later' },
];

// ---------------------------------------------------------------------------------------- tokenise

export interface Token { text: string; quoted: boolean }
export interface Tokens { tokens: Token[]; trailingSpace: boolean; openQuote: boolean; error?: string }

/** Splits on whitespace; a double-quoted value is one token. A quote must wrap a whole token. */
export function tokenize(line: string): Tokens {
  const tokens: Token[] = [];
  let error: string | undefined;
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) { i++; continue; }
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      if (end === -1) return { tokens: [...tokens, { text: line.slice(i + 1), quoted: true }], trailingSpace: false, openQuote: true, error: error ?? 'Unterminated quote: close it with ".' };
      tokens.push({ text: line.slice(i + 1, end), quoted: true });
      i = end + 1;
      if (i < line.length && !/\s/.test(line[i])) error ??= 'Quotes must wrap a whole value, e.g. form text "HELLO WORLD".';
      continue;
    }
    let j = i;
    while (j < line.length && !/\s/.test(line[j])) {
      if (line[j] === '"') error ??= 'Quotes must wrap a whole value, e.g. form text "HELLO WORLD".';
      j++;
    }
    tokens.push({ text: line.slice(i, j), quoted: false });
    i = j;
  }
  return { tokens, trailingSpace: /\s$/.test(line), openQuote: false, error };
}

/** The longest command path matching the leading unquoted tokens. */
export function match(tokens: readonly Token[]): { spec: CommandSpec | null; rest: Token[] } {
  let best: CommandSpec | null = null;
  for (const spec of COMMANDS) {
    const hit = spec.path.every((word, i) => tokens[i] !== undefined && !tokens[i].quoted && tokens[i].text.toLowerCase() === word);
    if (hit && (!best || spec.path.length > best.path.length)) best = spec;
  }
  return { spec: best, rest: best ? tokens.slice(best.path.length) : [...tokens] };
}

export function usage(spec: CommandSpec): string {
  return [spec.path.join(' '), spec.args, ...(spec.flags ?? []).map(f => `[--${f.name}${f.hint ? ` ${f.hint}` : ''}]`)].filter(Boolean).join(' ');
}

// ------------------------------------------------------------------------------------------- parse

/** Parse one console line into an Intent, or an error with the command's usage. Never dispatches. */
export function parse(line: string, ctx: ParseContext = {}): ParseResult {
  const { tokens, error } = tokenize(line);
  if (error) return { ok: false, error };
  if (!tokens.length) return { ok: false, error: 'Empty command. Type help.' };
  const { spec, rest } = match(tokens);
  if (!spec) return { ok: false, error: unknownCommand(tokens) };
  if (spec.status === 'later') return { ok: true, intent: planned(spec) };
  const args = parseArgs(spec, rest);
  if (typeof args === 'string') return { ok: false, error: args, usage: usage(spec) };
  const built = spec.build ? spec.build(args, ctx, spec) : planned(spec);
  return typeof built === 'string' ? { ok: false, error: built, usage: usage(spec) } : { ok: true, intent: built };
}

function parseArgs(spec: CommandSpec, rest: readonly Token[]): Args | string {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  const name = spec.path.join(' ');
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.quoted || !token.text.startsWith('-') || /^-\d/.test(token.text)) { positional.push(token.text); continue; }
    if (!token.text.startsWith('--')) return `Unknown option ${token.text} for ${name}. Options start with --.`;
    const flagName = token.text.slice(2).toLowerCase();
    const flag = spec.flags?.find(f => f.name === flagName);
    if (!flag) {
      const eq = flagName.indexOf('=');
      const known = eq > 0 ? spec.flags?.find(f => f.name === flagName.slice(0, eq)) : undefined;
      if (known) return `Write --${known.name} ${flagName.slice(eq + 1)} with a space, not =.`;
      return `Unknown option --${flagName} for ${name}.${spec.flags?.length ? ` Options: ${spec.flags.map(f => `--${f.name}`).join(' ')}.` : ' It takes no options.'}`;
    }
    if (flags.has(flag.name)) return `--${flag.name} is given twice.`;
    const values = rest.slice(i + 1, i + 1 + flag.arity);
    if (values.length < flag.arity || values.some(v => !v.quoted && v.text.startsWith('--'))) {
      return `--${flag.name} needs ${flag.arity === 1 ? 'a value' : `${flag.arity} values`} (${flag.hint}).`;
    }
    flags.set(flag.name, values.map(v => v.text));
    i += flag.arity;
  }
  for (const [a, b] of spec.exclusive ?? []) if (flags.has(a) && flags.has(b)) return `--${a} and --${b} cannot be used together.`;
  const min = spec.min ?? 0;
  const max = spec.max ?? 0;
  if (positional.length > max) {
    const extra = positional.slice(max).map(p => `"${p}"`).join(' ');
    return max === 0 ? `${name} takes no arguments; unexpected ${extra}.` : `Too many arguments for ${name}; unexpected ${extra}.`;
  }
  if (positional.length < min) return `${name} needs ${spec.args ?? 'an argument'}.`;
  return { positional, flags };
}

// --------------------------------------------------------------------------------- typed values

/** A finite decimal: digits with an optional fraction and sign. Rejects Infinity, NaN, exponents and hex. */
export function parseNumber(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text) + 0;   // + 0 turns -0 into 0
  return Number.isFinite(value) ? value : null;
}
export function parseInteger(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+$/.test(text)) return null;
  const value = Number(text) + 0;
  return Number.isSafeInteger(value) ? value : null;
}
export function parseColour(text: string): RGB | null {
  if (!/^#[0-9a-f]{6}$/i.test(text)) return null;
  return [0, 2, 4].map(i => parseInt(text.slice(1 + i, 3 + i), 16) / 255) as RGB;
}

/**
 * Text a text recipe can draw: 1–20 characters, not all spaces, each in the score package's font table either as
 * typed or as an ASCII lower-case letter. Checked per character as typed, so Unicode case mapping (ß -> SS,
 * ı -> I) cannot smuggle a character past the font.
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

function droneId(text: string | undefined, ctx: ParseContext, what: string, allowDead = false): { id: number; alive: boolean } | string {
  const id = parseInteger(text);
  if (id === null || id < 0) return `${what} must be a drone id (a whole number from 0), not "${text ?? ''}".`;
  if (!ctx.snapshot) return 'No simulation snapshot yet, so drone ids cannot be checked.';
  const drone = ctx.snapshot.drones.find(d => d.id === id);
  if (!drone) return `No drone ${id}: ids run 0–${ctx.snapshot.drones.length - 1}.`;
  if (!drone.alive && !allowDead) return `Drone ${id} is dead. Pick a live drone.`;
  return { id, alive: drone.alive };
}

function radius(args: Args): number | undefined | string {
  const raw = args.flags.get('radius')?.[0];
  if (raw === undefined) return undefined;
  const value = parseNumber(raw);
  if (value === null) return `--radius must be a number of metres, not "${raw}".`;
  if (value <= 0 || value > RADIUS_MAX) return `--radius must be more than 0 and at most ${RADIUS_MAX} m.`;
  return value;
}

/** For --at and --pick: a select step, a stage pick, or (neither) the current selection. */
function target(args: Args, ctx: ParseContext, flag: 'at' | 'drone', prompt: string): { steps: ControlIntent[]; pick?: string } | string {
  if (args.flags.has('pick')) return { steps: [], pick: prompt };
  const raw = args.flags.get(flag)?.[0];
  if (raw === undefined) return { steps: [] };
  const drone = droneId(raw, ctx, `--${flag}`);
  return typeof drone === 'string' ? drone : { steps: [{ type: 'select', id: drone.id }] };
}

// ------------------------------------------------------------------------------------- builders

function control(command: string, steps: ControlIntent[], extra: { pick?: string; when?: Precondition } = {}): ControlPlan {
  return { kind: 'control', command, steps, ...(extra.pick ? { pick: extra.pick } : {}), ...(extra.when ? { when: extra.when } : {}) };
}
function ui(action: UiAction): Build {
  return (_args, _ctx, spec) => ({ kind: 'ui', command: spec.path.join(' '), ui: action });
}
function planned(spec: CommandSpec, reason?: string): PlannedIntent {
  const name = spec.path.join(' ');
  return { kind: 'planned', command: name, message: `"${name}" is planned, not built: ${reason ?? spec.desc.charAt(0).toLowerCase() + spec.desc.slice(1)}. Nothing was changed.` };
}

function buildForm(kind: 'text' | 'sphere' | 'helix'): Build {
  return (args, _ctx, spec) => {
    let recipe: Recipe;
    if (kind === 'text') {
      const text = args.positional[0];
      const problem = validateText(text);
      if (problem) return problem;
      recipe = { kind: 'text', text: text.toUpperCase() };
    } else recipe = { kind };
    const colours = args.flags.get('colors');
    if (colours) {
      const [a, b] = colours.map(parseColour);
      if (!a || !b) return `--colors needs two #RRGGBB colours, e.g. --colors ${SWATCHES[0]} ${SWATCHES[1]}.`;
      recipe = { ...recipe, palette: [a, b] };
    }
    const given = args.flags.get('name')?.[0];
    if (given !== undefined && (!given.trim() || [...given].length > NAME_MAX || /[\p{Cc}\p{Cf}]/u.test(given))) {
      return `--name must be 1–${NAME_MAX} printable characters.`;
    }
    const fallback = recipe.kind === 'text' ? recipe.text.charAt(0) + recipe.text.slice(1).toLowerCase() : kind === 'sphere' ? 'Sphere' : 'Helix';
    return { kind: 'draft', command: spec.path.join(' '), name: given?.trim() ?? fallback, recipe };
  };
}

function buildDraftUse(args: Args, ctx: ParseContext): Intent | string {
  const id = args.positional[0];
  if (ctx.drafts && !ctx.drafts.includes(id)) return `No draft "${id}". Type drafts.`;
  return { kind: 'ui', command: 'draft use', ui: { type: 'draft-use', id } };
}

function buildPreview(args: Args): Intent | string {
  const state = onOff(args.positional[0] ?? 'on', 'preview');
  return typeof state === 'string' ? state : { kind: 'ui', command: 'preview', ui: { type: 'preview', on: state } };
}

function buildInject(args: Args, ctx: ParseContext): Intent | string {
  const draftId = args.flags.get('draft')?.[0] ?? null;
  if (draftId !== null && ctx.drafts && !ctx.drafts.includes(draftId)) return `No draft "${draftId}". Type drafts.`;
  const where = target(args, ctx, 'drone', 'Click the drone that will receive the uplink');
  if (typeof where === 'string') return where;
  return { kind: 'inject', command: 'inject', steps: where.steps, ...(where.pick ? { pick: where.pick } : {}), draftId };
}

function buildReset(args: Args, ctx: ParseContext): Intent | string {
  const raw = args.flags.get('seed')?.[0];
  const seed = raw === undefined ? ctx.seed : parseInteger(raw);
  if (seed === undefined) return 'reset needs --seed N (the current seed is unknown).';
  if (seed === null || seed < 0 || seed > 0xffffffff) return `--seed must be a whole number from 0 to ${0xffffffff}, not "${raw}".`;
  return control('reset', [{ type: 'reset', seed }]);
}

function buildSpeed(args: Args): Intent | string {
  const raw = args.positional[0];
  const value = parseNumber(raw);
  if (value === null) return `speed takes a number, not "${raw}".`;
  if (value < 0.25 || value > 4) return 'speed must be from 0.25 to 4.';
  if (!(SPEEDS as readonly number[]).includes(value)) return `Supported speeds: ${SPEEDS.join(', ')}.`;
  return control('speed', [{ type: 'speed', speed: value }]);
}

function buildKill(args: Args, ctx: ParseContext): Intent | string {
  const where = target(args, ctx, 'drone', '');
  return typeof where === 'string' ? where : control('fault kill', [...where.steps, { type: 'kill-selected' }]);
}

function buildKillRegion(args: Args, ctx: ParseContext): Intent | string {
  const r = radius(args);
  if (typeof r === 'string') return r;
  const where = target(args, ctx, 'at', 'Click the drone at the centre of the region');
  if (typeof where === 'string') return where;
  return control('fault kill-region', [...where.steps, { type: 'kill-region', ...(r === undefined ? {} : { radius: r }) }], { pick: where.pick });
}

function buildKillRandom(args: Args, _ctx: ParseContext, spec: CommandSpec): Intent | string {
  const raw = args.flags.get('percent')?.[0];
  if (raw !== undefined) {
    const value = parseNumber(raw);
    if (value === null) return `--percent must be a number, not "${raw}".`;
    if (value < 1 || value > 50) return '--percent must be from 1 to 50.';
    if (value !== 10) return planned(spec, 'the action API kills exactly 10% of the roster; other shares');
  }
  return control('fault kill-random', [{ type: 'kill-random' }]);
}

function buildJam(args: Args, ctx: ParseContext): Intent | string {
  const r = radius(args);
  if (typeof r === 'string') return r;
  const where = target(args, ctx, 'at', 'Click the drone at the centre of the jam');
  if (typeof where === 'string') return where;
  return control('fault jam', [...where.steps, { type: 'jam', ...(r === undefined ? {} : { radius: r }) }], { pick: where.pick, when: { jam: false } });
}

function buildUnjam(args: Args, _ctx: ParseContext, spec: CommandSpec): Intent | string {
  const id = args.positional[0];
  if (id !== undefined && id !== OPERATOR_JAM_ID) return planned(spec, `lifting jam "${id}" by id (the console controls one jam; type fault unjam)`);
  return control('fault unjam', [{ type: 'jam' }], { when: { jam: true } });
}

function buildPartition(args: Args): Intent | string {
  const on = onOff(args.positional[0], 'fault partition');
  return typeof on === 'string' ? on : control('fault partition', [{ type: 'partition' }], { when: { partition: !on } });
}

function buildLoss(args: Args): Intent | string {
  const raw = args.positional[0].replace(/%$/, '');
  const value = parseNumber(raw);
  if (value === null) return `fault loss takes a percentage, e.g. fault loss 20, not "${args.positional[0]}".`;
  if (value < 0 || value > LOSS_MAX_PERCENT) return `Packet loss must be from 0 to ${LOSS_MAX_PERCENT} %.`;
  return control('fault loss', [{ type: 'loss', loss: value / 100 }]);
}

function buildInspect(args: Args, ctx: ParseContext): Intent | string {
  if (args.positional[0].toLowerCase() === 'off') {
    if (args.flags.has('static')) return 'inspect off takes no --static.';
    return { kind: 'ui', command: 'inspect', ui: { type: 'inspect-off' } };
  }
  // A dead drone may be inspected: World.inspect returns its final step (contract).
  const drone = droneId(args.positional[0], ctx, 'inspect', true);
  if (typeof drone === 'string') return drone;
  return { kind: 'ui', command: 'inspect', ui: { type: 'inspect', id: drone.id, world: args.flags.has('static') ? 'static' : 'encore', alive: drone.alive } };
}

function buildView(args: Args, _ctx: ParseContext, spec: CommandSpec): Intent | string {
  const lens = args.positional[0].toLowerCase();
  if (!Object.hasOwn(LENSES, lens)) return `view takes one of: ${Object.keys(LENSES).join(', ')}.`;
  let on: boolean | undefined;
  if (args.positional[1] !== undefined) {
    const state = onOff(args.positional[1], 'view');
    if (typeof state === 'string') return state;
    on = state;
  }
  if (!LENSES[lens as Lens]) return planned(spec, `the ${lens} lens`);
  return { kind: 'ui', command: 'view', ui: { type: 'view', lens: lens as Lens, ...(on === undefined ? {} : { on }) } };
}

function buildCamera(args: Args): Intent | string {
  const preset = args.positional[0].toLowerCase();
  if (preset !== 'audience' && preset !== 'quarter' && preset !== 'top') return 'camera takes audience, quarter or top.';
  return { kind: 'ui', command: 'camera', ui: { type: 'camera', preset } };
}

function buildCompare(args: Args): Intent | string {
  const mode = args.positional[0].toLowerCase();
  if (mode !== 'on' && mode !== 'off' && mode !== 'static') return 'compare takes on, off or static.';
  return { kind: 'ui', command: 'compare', ui: { type: 'compare', mode } };
}

function buildDemoRun(args: Args, _ctx: ParseContext, spec: CommandSpec): Intent | string {
  const length = args.positional[0] ?? '90';
  if (length === '180') return planned(spec, 'the 3-minute demo script');
  if (length !== '90') return 'demo run takes 90 (the 3-minute script is planned).';
  return { kind: 'ui', command: 'demo run', ui: { type: 'demo-run', seconds: 90 } };
}

function buildHelp(args: Args): Intent | string {
  const topic = args.positional.join(' ').toLowerCase();
  const list = topic ? COMMANDS.filter(c => c.path.join(' ') === topic || c.path[0] === topic) : COMMANDS;
  if (!list.length) return `No help for "${topic}".${didYouMean(topic)}`;
  const lines = list.map(c => `${usage(c).padEnd(46)} ${c.desc}${c.status === 'later' ? '  [later]' : c.status === 'proto' ? '  [prototype engine]' : ''}`);
  if (!topic) lines.push('Tab completes · ↑↓ history · commands never run JavaScript or shell.');
  return { kind: 'help', command: 'help', text: lines.join('\n') };
}

function onOff(text: string | undefined, command: string): boolean | string {
  const value = text?.toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  return `${command} takes on or off, not "${text ?? ''}".`;
}

// ------------------------------------------------------------------------------- did you mean

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

function didYouMean(typed: string): string {
  const names = [...new Set(COMMANDS.map(c => c.path.join(' ')))];
  const words = typed.split(' ');
  let best: { name: string; distance: number } | null = null;
  for (const name of names) {
    const distance = levenshtein(words.slice(0, name.split(' ').length).join(' '), name);
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best && best.distance <= 2 ? ` Did you mean "${best.name}"?` : '';
}

function unknownCommand(tokens: readonly Token[]): string {
  const typed = tokens.map(t => t.text.toLowerCase()).join(' ');
  const head = tokens[0];
  const group = COMMANDS.filter(c => c.path.length > 1 && !head.quoted && c.path[0] === head.text.toLowerCase());
  if (group.length) {
    const sub = tokens[1]?.text ?? '';
    return `${head.text.toLowerCase()} needs one of: ${group.map(c => c.path[1]).join(', ')}${sub ? `; "${sub}" is not one` : ''}.${didYouMean(typed)}`;
  }
  return `Unknown command "${tokens.map(t => t.text).join(' ')}".${didYouMean(typed)} Type help.`;
}

// ------------------------------------------------------------------------- dispatch helpers (pure)

export interface LiveState { playing: boolean; jam: boolean; partition: boolean }

/** The ids of the one jam and the one partition an operator controls, defined once in actions.ts. */
export { OPERATOR_JAM_ID, OPERATOR_PARTITION_ID };

/**
 * The state a `when` precondition is checked against: transport from the controller, and the operator's jam and
 * partition as they will be on the tick a dispatched toggle lands (snapshot.tick + 1). That is the snapshot's state
 * with the controller's pending events up to that tick applied in tick order (pass `controller.getEventLog()`),
 * through the SAME rule the controller uses (actions.ts toggleOnAt), so the two can never disagree: `on` twice is
 * idempotent, an `off` right after an `on` is dispatched, and an event pending for a later tick (a timed `at`, as
 * the scripted demo sends) does not count yet. Jams and partitions under other ids (scripted) are ignored, because
 * the controller never toggles them.
 */
export function liveState(status: Pick<ControlStatus, 'playing'>, snapshot: Pick<WorldSnapshot, 'tick' | 'jams' | 'partitions'>, log: readonly EnvEvent[] = []): LiveState {
  const at = snapshot.tick + 1;
  return {
    playing: status.playing,
    jam: toggleOnAt(log, 'jam', OPERATOR_JAM_ID, snapshot.tick, at, snapshot.jams.some(jam => jam.id === OPERATOR_JAM_ID)),
    partition: toggleOnAt(log, 'partition', OPERATOR_PARTITION_ID, snapshot.tick, at, snapshot.partitions.some(p => p.id === OPERATOR_PARTITION_ID)),
  };
}

/** False when the command is already in effect (e.g. `play` while playing): dispatch nothing and say so. */
export function shouldDispatch(plan: ControlPlan, state: LiveState): boolean {
  if (!plan.when) return true;
  if ('playing' in plan.when) return state.playing === plan.when.playing;
  if ('jam' in plan.when) return state.jam === plan.when.jam;
  return state.partition === plan.when.partition;
}

/** An inject plan with its draft's recipe: a ControlPlan the controller can run. */
export function withRecipe(plan: InjectPlan, recipe: Recipe): ControlPlan {
  return control('inject', [...plan.steps, { type: 'inject', recipe }], { pick: plan.pick });
}

// ------------------------------------------------------------------------------------- completion

export interface Suggestion { insert: string; label: string; desc: string; status: Status }

/** Tab suggestions for the text before the caret. `insert` replaces the whole line. At most 8. */
export function complete(line: string, ctx: ParseContext = {}): Suggestion[] {
  const { tokens, trailingSpace, openQuote } = tokenize(line);
  if (openQuote) return [];
  const done = trailingSpace ? tokens : tokens.slice(0, -1);
  const partial = trailingSpace ? '' : tokens[tokens.length - 1]?.text ?? '';
  const prefix = done.length ? `${done.map(t => (t.quoted ? `"${t.text}"` : t.text)).join(' ')} ` : '';
  const out: Suggestion[] = [];
  const add = (value: string, label: string, desc: string, status: Status) => {
    if (value.toLowerCase().startsWith(partial.toLowerCase()) && !out.some(s => s.label === label)) out.push({ insert: `${prefix}${value} `, label, desc, status });
  };

  // Command words.
  const doneWords = done.map(t => (t.quoted ? '\u0000' : t.text.toLowerCase()));
  const candidates = COMMANDS.filter(c => c.path.length > done.length && c.path.slice(0, done.length).every((w, i) => doneWords[i] === w));
  for (const c of candidates) {
    const word = c.path[done.length];
    const leaf = c.path.length === done.length + 1;
    const siblings = candidates.filter(x => x.path[done.length] === word).length;
    add(word, leaf ? usage(c) : `${c.path.slice(0, done.length + 1).join(' ')} …`, leaf ? c.desc : `${siblings} commands`, leaf ? c.status : 'ui');
  }

  // Arguments and flags of a matched command.
  const { spec, rest } = match(done);
  if (spec && spec.status !== 'later' && done.length >= spec.path.length) {
    // Walk the arguments: which flags are given, which positionals, and whether a flag still wants values.
    const given = new Set<string>();
    const positionals: string[] = [];
    let open: { flag: FlagSpec; missing: number } | null = null;
    for (const token of rest) {
      if (open) { if (--open.missing === 0) open = null; continue; }
      const flag = !token.quoted && token.text.startsWith('--') ? spec.flags?.find(f => f.name === token.text.slice(2).toLowerCase()) : undefined;
      if (flag) { given.add(flag.name); if (flag.arity > 0) open = { flag, missing: flag.arity }; } else positionals.push(token.text);
    }
    if (open) {
      for (const value of flagValues(open.flag, ctx)) add(value, value, open.flag.type === 'int' ? 'live drone' : open.flag.hint, 'ui');
    } else {
      if (spec.path[0] === 'help') {
        for (const name of new Set(COMMANDS.map(c => c.path.join(' ')))) if (positionals.length === 0) add(name, name, 'help', 'ui');
      } else if (positionals.length < (spec.max ?? 0)) {
        if (spec.path.join(' ') === 'form text' && !partial) out.push({ insert: `${prefix}"`, label: '"WORD"', desc: 'A–Z, 0–9, space', status: 'ui' });
        if (spec.path[0] === 'inspect') for (const id of droneSuggestions(ctx)) add(id, id, 'drone', 'ui');
        if (positionals.length === 0) for (const value of spec.values ?? []) add(value, value, spec.desc, spec.status);
      }
      const inspectOff = spec.path[0] === 'inspect' && positionals[0]?.toLowerCase() === 'off';
      for (const f of spec.flags ?? []) {
        if (given.has(f.name) || (inspectOff && f.name === 'static')) continue;
        if ((spec.exclusive ?? []).some(([a, b]) => (a === f.name && given.has(b)) || (b === f.name && given.has(a)))) continue;
        add(`--${f.name}`, `--${f.name}${f.hint ? ` ${f.hint}` : ''}`, '', 'ui');
      }
    }
  }
  return out.slice(0, 8);
}

function flagValues(flag: FlagSpec, ctx: ParseContext): readonly string[] {
  if (flag.name === 'drone' || flag.name === 'at') return droneSuggestions(ctx);
  if (flag.name === 'draft') return ctx.drafts ?? [];
  return flag.values ?? [];
}

/** The selected drone (if live), then the first, middle and last live drones. */
function droneSuggestions(ctx: ParseContext): string[] {
  const live = ctx.snapshot?.drones.filter(d => d.alive).map(d => d.id) ?? [];
  const selected = ctx.selectedId !== undefined && ctx.selectedId !== null && live.includes(ctx.selectedId) ? [ctx.selectedId] : [];
  return [...new Set([...selected, live[0], live[Math.floor(live.length / 2)], live[live.length - 1]])].filter((id): id is number => id !== undefined).map(String);
}
