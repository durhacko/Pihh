// Command language: tokenise → match against the grammar table → validate → call the shared Actions.
// The console never evaluates JavaScript or shell input; anything not in the table is an error or a
// clearly labelled future command. Commands that schedule simulation events are only "accepted" here;
// completion is reported later by the session's applied/observed log entries.
import type { RGB, Vec3 } from '@encore/contracts';
import type { App } from './app';
import { hexToRgb } from './store';

export type OutKind = 'input' | 'info' | 'error' | 'future';
export interface Out { kind: OutKind; text: string; tag?: 'proto' | 'later' | 'main' }
type Flags = Record<string, string[]>;
interface Parsed { words: string[]; flags: Flags }
interface Cmd {
  path: string[];             // e.g. ['fault', 'jam']
  args?: string;              // positional usage
  flags?: { name: string; arity: number; hint: string; values?: string[] }[];
  desc: string;
  status: 'main' | 'proto' | 'ui' | 'later';
  values?: string[];          // completions for the first positional argument
  run?(p: Parsed, app: App, out: (o: Out) => void): void | Promise<void>;
}

const colour = (s: string): RGB | null => (/^#[0-9a-f]{6}$/i.test(s) ? hexToRgb(s) : null);
const int = (s: string | undefined): number | null => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : null);
const num = (s: string | undefined): number | null => (s !== undefined && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null);
const flagNum = (p: Parsed, f: string) => num(p.flags[f]?.[0]);

function makeForm(kind: 'text' | 'sphere' | 'helix') {
  return (p: Parsed, app: App, out: (o: Out) => void) => {
    let text = '';
    if (kind === 'text') {
      text = (p.words[0] ?? '').toUpperCase();
      if (!text) { out({ kind: 'error', text: 'form text needs a word in quotes, e.g. form text "DURHACK"' }); return; }
    }
    let palette: [RGB, RGB] | null = null;
    if (p.flags.colors) {
      const [a, b] = p.flags.colors.map(colour);
      if (!a || !b) { out({ kind: 'error', text: '--colors needs two hex colours, e.g. --colors #FFB000 #FF3D7F' }); return; }
      palette = [a, b];
    }
    const name = p.flags.name?.[0] ?? (kind === 'text' ? text.charAt(0) + text.slice(1).toLowerCase() : kind === 'sphere' ? 'Sphere' : 'Helix');
    const d = app.drafts.add({ name, kind, text, palette });
    const v = app.validate(d);
    if (!v.ok) { out({ kind: 'error', text: `Draft ${d.id} saved but invalid: ${v.errors[0]}` }); return; }
    app.store.set({ preview: { recipe: v.recipe!, label: name } });
    out({ kind: 'info', text: `Draft ${d.id} “${name}” ready · previewing locally (nothing sent).${v.warnings.length ? `\n  ⚠ ${v.warnings[0]}` : ''}\n  Next: inject --drone <id>   or   inject --pick` });
  };
}

export const COMMANDS: Cmd[] = [
  { path: ['help'], args: '[command]', desc: 'List commands, or explain one', status: 'ui' },
  { path: ['form', 'text'], args: '"WORD"', desc: 'New text draft (A–Z, 0–9, space) and preview it', status: 'main', flags: [{ name: 'colors', arity: 2, hint: '#RRGGBB #RRGGBB' }, { name: 'name', arity: 1, hint: 'NAME' }], run: makeForm('text') },
  { path: ['form', 'sphere'], desc: 'New sphere draft and preview it', status: 'main', flags: [{ name: 'colors', arity: 2, hint: '#RRGGBB #RRGGBB' }, { name: 'name', arity: 1, hint: 'NAME' }], run: makeForm('sphere') },
  { path: ['form', 'helix'], desc: 'New double-helix draft and preview it', status: 'main', flags: [{ name: 'colors', arity: 2, hint: '#RRGGBB #RRGGBB' }, { name: 'name', arity: 1, hint: 'NAME' }], run: makeForm('helix') },
  { path: ['form', 'svg'], args: 'FILE', desc: 'Formation from an SVG outline', status: 'later' },
  { path: ['form', 'cloud'], args: 'FILE', desc: 'Formation from an imported 3D point cloud', status: 'later' },
  { path: ['drafts'], desc: 'List local drafts', status: 'ui', run: (_p, app, out) => {
    out({ kind: 'info', text: app.drafts.list.map(d => `${d.id === app.drafts.currentId ? '›' : ' '} ${d.id}  ${d.name.padEnd(12)} ${d.kind}${d.kind === 'text' ? ` "${d.text}"` : ''}${d.sent.length ? `  sent as v${d.sent.join(', v')}` : ''}`).join('\n') });
  } },
  { path: ['draft', 'use'], args: 'ID', desc: 'Make a draft current', status: 'ui', run: (p, app, out) => {
    const id = p.words[0]; if (!app.drafts.list.some(d => d.id === id)) { out({ kind: 'error', text: `No draft ${id ?? ''}. Type drafts.` }); return; }
    app.drafts.select(id!); out({ kind: 'info', text: `Current draft: ${id} “${app.drafts.current.name}”` });
  } },
  { path: ['preview'], args: 'on|off', values: ['on', 'off'], desc: 'Show the current draft in the stage (local only)', status: 'ui', run: (p, app, out) => {
    const on = (p.words[0] ?? 'on') !== 'off';
    const v = app.validate(app.drafts.current);
    if (on && !v.ok) { out({ kind: 'error', text: v.errors[0] }); return; }
    app.store.set({ preview: on ? { recipe: v.recipe!, label: app.drafts.current.name } : null });
    out({ kind: 'info', text: on ? `Previewing “${app.drafts.current.name}” locally. Nothing is sent.` : 'Preview off.' });
  } },
  { path: ['inject'], desc: 'Uplink the current draft into ONE drone; radio does the rest', status: 'proto', flags: [{ name: 'drone', arity: 1, hint: 'ID' }, { name: 'draft', arity: 1, hint: 'DRAFT' }, { name: 'pick', arity: 0, hint: '' }], run: async (p, app, out) => {
    let id = int(p.flags.drone?.[0]);
    if (p.flags.pick) {
      out({ kind: 'info', text: 'Click a drone in the stage to receive the uplink (Esc cancels).' });
      app.actions.quiet = false;
      const r = await app.actions.pick('inject', 'Click the drone that will receive the uplink');
      app.actions.quiet = true;
      if (!r || r.droneId === null) { out({ kind: 'error', text: 'Injection cancelled: no drone picked.' }); app.actions.quiet = false; return; }
      id = r.droneId;
    }
    if (id === null) { const s = app.actions.selectedLive(); if (s === null) { out({ kind: 'error', text: 'inject needs --drone <id>, --pick, or a selected drone.' }); return; } id = s; }
    app.actions.inject(id, p.flags.draft?.[0]);
    app.actions.quiet = false;
  } },
  { path: ['play'], desc: 'Resume the simulation', status: 'main', run: (_p, app, out) => { app.actions.togglePlay(true); out({ kind: 'info', text: 'Playing.' }); } },
  { path: ['pause'], desc: 'Pause; radio lines freeze', status: 'main', run: (_p, app, out) => { app.actions.togglePlay(false); out({ kind: 'info', text: `Paused at tick ${app.session.tick}.` }); } },
  { path: ['step'], desc: 'Advance exactly one tick (50 ms)', status: 'main', run: (_p, app, out) => { app.actions.step(); out({ kind: 'info', text: `Tick ${app.session.tick}.` }); } },
  { path: ['reset'], desc: 'Rebuild both worlds from a seed', status: 'main', flags: [{ name: 'seed', arity: 1, hint: 'N' }], run: (p, app, out) => {
    const seed = p.flags.seed ? int(p.flags.seed[0]) : app.session.seed;
    if (seed === null || seed < 0) { out({ kind: 'error', text: '--seed must be a non-negative integer.' }); return; }
    app.actions.reset(seed);
  } },
  { path: ['speed'], args: 'X', values: ['0.25', '0.5', '1', '2', '4'], desc: 'Playback speed 0.25–4×', status: 'main', run: (p, app, out) => {
    const v = num(p.words[0]); if (v === null || v < 0.25 || v > 4) { out({ kind: 'error', text: 'speed takes a number from 0.25 to 4, e.g. speed 0.5' }); return; }
    app.actions.setSpeed(v); out({ kind: 'info', text: `Speed ${v}×.` });
  } },
  { path: ['fault', 'kill'], desc: 'Kill one drone (selected if no --drone)', status: 'main', flags: [{ name: 'drone', arity: 1, hint: 'ID' }], run: (p, app, out) => {
    const id = p.flags.drone ? int(p.flags.drone[0]) : app.actions.selectedLive();
    if (id === null) { out({ kind: 'error', text: 'fault kill needs --drone <id> or a selected drone.' }); return; }
    app.actions.dispatch({ kind: 'kill', ids: [id] });
  } },
  { path: ['fault', 'kill-region'], desc: 'Kill every live drone in a sphere', status: 'main', flags: [{ name: 'radius', arity: 1, hint: 'METRES' }, { name: 'at', arity: 1, hint: 'DRONE' }, { name: 'pick', arity: 0, hint: '' }], run: async (p, app, out) => {
    const r = flagNum(p, 'radius') ?? 8;
    const at = int(p.flags.at?.[0]);
    if (at !== null) {
      const d = app.session.arms.encore.curr.drones[at];
      if (!d) { out({ kind: 'error', text: `No drone ${at}.` }); return; }
      app.actions.dispatch({ kind: 'killRegion', centre: d.pos, radius: r }); return;
    }
    out({ kind: 'info', text: `Click the centre of the ${r} m region in the stage (Esc cancels).` });
    app.actions.quiet = false; await app.actions.killRegion(r);
  } },
  { path: ['fault', 'kill-random'], desc: 'Kill a random share of live drones', status: 'main', flags: [{ name: 'percent', arity: 1, hint: '1–50' }], run: (p, app, out) => {
    const pc = flagNum(p, 'percent') ?? 10; if (pc <= 0 || pc > 50) { out({ kind: 'error', text: '--percent must be between 1 and 50.' }); return; }
    app.actions.killRandom(pc / 100);
  } },
  { path: ['fault', 'jam'], desc: 'Jam radio inside a sphere (sensing still works)', status: 'main', flags: [{ name: 'radius', arity: 1, hint: 'METRES' }, { name: 'at', arity: 1, hint: 'DRONE' }, { name: 'pick', arity: 0, hint: '' }], run: async (p, app, out) => {
    const r = flagNum(p, 'radius') ?? 12;
    const at = int(p.flags.at?.[0]);
    if (at !== null) { const d = app.session.arms.encore.curr.drones[at]; if (!d) { out({ kind: 'error', text: `No drone ${at}.` }); return; } app.actions.dispatch({ kind: 'jamOn', centre: d.pos.map(v => Math.round(v)) as Vec3, radius: r }); return; }
    out({ kind: 'info', text: `Click where to centre the ${r} m jam (Esc cancels).` });
    app.actions.quiet = false; await app.actions.jam(r);
  } },
  { path: ['fault', 'unjam'], args: '[JAM-ID]', desc: 'Lift a jam (latest if no id)', status: 'main', run: (p, app) => { app.actions.unjam(p.words[0]); } },
  { path: ['fault', 'partition'], args: 'on|off', values: ['on', 'off'], desc: 'Split the swarm into two radio groups at x = 0', status: 'proto', run: (p, app) => { app.actions.partition(p.words[0] ? p.words[0] === 'on' : undefined); } },
  { path: ['fault', 'loss'], args: 'PERCENT', desc: 'Set packet loss for every receiver', status: 'proto', run: (p, app, out) => {
    const v = num(p.words[0]); if (v === null) { out({ kind: 'error', text: 'fault loss takes a percentage, e.g. fault loss 20' }); return; }
    app.actions.setLoss(v / 100);
  } },
  { path: ['inspect'], args: 'ID|off', desc: 'Open the inspector on a drone', status: 'ui', flags: [{ name: 'static', arity: 0, hint: '' }], run: (p, app, out) => {
    if (p.words[0] === 'off') { app.actions.select(null); out({ kind: 'info', text: 'Inspector closed.' }); return; }
    const id = int(p.words[0]); if (id === null || id < 0 || id >= app.session.params.n0) { out({ kind: 'error', text: `inspect takes a drone id 0–${app.session.params.n0 - 1}.` }); return; }
    app.actions.select(id, p.flags.static ? 'static' : 'encore'); out({ kind: 'info', text: `Inspecting drone ${id} (${p.flags.static ? 'static' : 'Encore'} world).` });
  } },
  { path: ['view'], args: 'LENS [on|off]', values: ['xray', 'beliefs', 'ghosts', 'tethers', 'zones', 'neighbourhood', 'show'], desc: 'Toggle a diagnostic lens (visual only)', status: 'ui', run: (p, app, out) => {
    const [lens, state] = p.words;
    const on = state === undefined ? undefined : state === 'on';
    const map: Record<string, () => void> = {
      xray: () => app.actions.lens('xray', on), ghosts: () => app.actions.lens('ghosts', on), tethers: () => app.actions.lens('tethers', on),
      zones: () => app.actions.lens('zones', on), neighbourhood: () => app.actions.lens('neighbourhood', on),
      beliefs: () => app.actions.lens('colour', on === false ? 'show' : app.store.state.lenses.colour === 'belief' && on === undefined ? 'show' : 'belief'),
      show: () => { app.store.set({ lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true } }); },
    };
    if (!lens || !map[lens]) { out({ kind: 'error', text: `view takes one of: ${Object.keys(map).join(', ')}` }); return; }
    map[lens](); out({ kind: 'info', text: `Lens ${lens}: ${lens === 'show' ? 'performance view' : JSON.stringify(app.store.state.lenses)}. Lenses change only what is drawn.` });
  } },
  { path: ['camera'], args: 'PRESET', values: ['audience', 'quarter', 'top'], desc: 'Move the camera to a preset', status: 'ui', run: (p, app, out) => {
    const v = p.words[0]; if (v !== 'audience' && v !== 'quarter' && v !== 'top') { out({ kind: 'error', text: 'camera takes audience, quarter or top.' }); return; }
    app.actions.camera(v); out({ kind: 'info', text: `Camera: ${v}.` });
  } },
  { path: ['compare'], args: 'on|off|static', values: ['on', 'off', 'static'], desc: 'Stacked Encore/static split, or show one world', status: 'ui', run: (p, app, out) => {
    const v = p.words[0] ?? (app.store.state.view === 'split' ? 'off' : 'on');
    app.actions.setView(v === 'on' ? 'split' : v === 'static' ? 'static' : 'encore');
    out({ kind: 'info', text: v === 'on' ? 'Split: Encore above, static baseline below, one camera.' : `Showing ${v === 'static' ? 'static baseline' : 'Encore'} only.` });
  } },
  { path: ['demo', 'run'], args: '90', values: ['90', '180'], desc: 'Run the scripted demo (same dispatch as the buttons)', status: 'proto', run: (p, app, out) => {
    if ((p.words[0] ?? '90') === '180') { out({ kind: 'future', text: 'The 3-minute script is not built yet (experience doc §9, SHOULD).', tag: 'later' }); return; }
    app.runDemo(); out({ kind: 'info', text: '90 s demo started from a fresh reset.' });
  } },
  { path: ['demo', 'stop'], desc: 'Stop the scripted demo', status: 'ui', run: (_p, app, out) => { app.actions.demo?.stop(); out({ kind: 'info', text: 'Demo stopped; the simulation keeps running.' }); } },
  { path: ['metrics'], desc: 'Open the metrics readout', status: 'ui', run: (_p, app) => app.surfaces.open('metrics') },
  { path: ['timeline'], desc: 'Toggle the show timeline', status: 'ui', run: (_p, app) => app.surfaces.toggle('timeline') },
  { path: ['cue', 'add'], desc: 'Add a cue to the planned show', status: 'later' },
  { path: ['cue', 'move'], desc: 'Re-order or retime cues', status: 'later' },
  { path: ['show', 'save'], desc: 'Save the show to a file', status: 'later' },
  { path: ['show', 'load'], desc: 'Load a saved show', status: 'later' },
  { path: ['seek'], args: 'TIME', desc: 'Jump to a time (needs replay-to-tick)', status: 'later' },
  { path: ['clear'], desc: 'Clear the console', status: 'ui' },
  { path: ['history'], desc: 'Show command history', status: 'ui' },
];

export function tokenize(line: string): { tokens: string[]; trailingSpace: boolean; openQuote: boolean } {
  const tokens: string[] = [];
  let cur = '', quote = false, had = false;
  for (const ch of line) {
    if (ch === '"') { quote = !quote; had = true; continue; }
    if (!quote && /\s/.test(ch)) { if (cur || had) tokens.push(cur); cur = ''; had = false; continue; }
    cur += ch;
  }
  if (cur || had) tokens.push(cur);
  return { tokens, trailingSpace: /\s$/.test(line) && !quote, openQuote: quote };
}

export function match(tokens: string[]): { cmd: Cmd | null; rest: string[] } {
  let best: Cmd | null = null;
  for (const c of COMMANDS) if (c.path.every((w, i) => tokens[i] === w) && (!best || c.path.length > best.path.length)) best = c;
  return { cmd: best, rest: best ? tokens.slice(best.path.length) : tokens };
}

function parseArgs(cmd: Cmd, rest: string[]): Parsed | string {
  const words: string[] = [], flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('--')) {
      const name = t.slice(2);
      const spec = cmd.flags?.find(f => f.name === name);
      if (!spec) return `Unknown option --${name} for ${cmd.path.join(' ')}.${cmd.flags?.length ? ` Options: ${cmd.flags.map(f => '--' + f.name).join(' ')}` : ''}`;
      const vals = rest.slice(i + 1, i + 1 + spec.arity);
      if (vals.length < spec.arity || vals.some(v => v.startsWith('--'))) return `--${name} needs ${spec.arity === 1 ? 'a value' : `${spec.arity} values`} (${spec.hint}).`;
      flags[name] = vals; i += spec.arity;
    } else words.push(t);
  }
  return { words, flags };
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function usage(c: Cmd): string {
  return [c.path.join(' '), c.args, ...(c.flags ?? []).map(f => `[--${f.name}${f.hint ? ' ' + f.hint : ''}]`)].filter(Boolean).join(' ');
}

export async function execute(line: string, app: App, out: (o: Out) => void): Promise<void> {
  const { tokens } = tokenize(line.trim());
  if (!tokens.length) return;
  const { cmd, rest } = match(tokens);
  if (!cmd) {
    const all = [...new Set(COMMANDS.map(c => c.path.join(' ')))];
    const guess = all.map(c => [c, lev(tokens.slice(0, c.split(' ').length).join(' '), c)] as const).sort((a, b) => a[1] - b[1])[0];
    out({ kind: 'error', text: `Unknown command “${tokens.join(' ')}”.${guess && guess[1] <= 3 ? ` Did you mean “${guess[0]}”?` : ''} Type help.` });
    return;
  }
  if (cmd.path[0] === 'help') {
    const topic = rest.join(' ');
    const list = topic ? COMMANDS.filter(c => c.path.join(' ').startsWith(topic)) : COMMANDS;
    if (!list.length) { out({ kind: 'error', text: `No help for “${topic}”.` }); return; }
    const groups = topic ? list : list;
    out({ kind: 'info', text: groups.map(c => `${usage(c).padEnd(46)} ${c.desc}${c.status === 'later' ? '  [later]' : c.status === 'proto' ? '  [prototype engine]' : ''}`).join('\n') });
    if (!topic) out({ kind: 'info', text: 'Tab completes · ↑↓ history · Esc closes · commands never run JavaScript or shell.' });
    return;
  }
  if (cmd.status === 'later') { out({ kind: 'future', text: `“${cmd.path.join(' ')}” is planned, not built: ${cmd.desc.toLowerCase()}. Nothing was changed.`, tag: 'later' }); return; }
  const parsed = parseArgs(cmd, rest);
  if (typeof parsed === 'string') { out({ kind: 'error', text: `${parsed}\nUsage: ${usage(cmd)}` }); return; }
  if (!cmd.run) return;
  app.actions.quiet = true;
  try { await cmd.run(parsed, app, out); } finally { app.actions.quiet = false; }
}

export interface Suggestion { insert: string; label: string; desc: string; status: Cmd['status'] }

/** Completions for the text before the caret. `insert` replaces the whole line. */
export function complete(line: string, app: App): Suggestion[] {
  const { tokens, trailingSpace, openQuote } = tokenize(line);
  if (openQuote) return [];
  const done = trailingSpace ? tokens : tokens.slice(0, -1);
  const partial = trailingSpace ? '' : tokens[tokens.length - 1] ?? '';
  const prefix = done.length ? done.map(t => (/\s/.test(t) || t === '' ? `"${t}"` : t)).join(' ') + ' ' : '';
  const out: Suggestion[] = [];
  // Command words
  const cands = COMMANDS.filter(c => c.path.slice(0, done.length).every((w, i) => done[i] === w) && c.path.length > done.length);
  const seen = new Set<string>();
  for (const c of cands) {
    const w = c.path[done.length];
    if (!w.startsWith(partial) || seen.has(w)) continue;
    seen.add(w);
    const leaf = c.path.length === done.length + 1;
    out.push({ insert: prefix + w + ' ', label: c.path.slice(0, done.length + 1).join(' ') + (leaf && c.args ? ' ' + c.args : leaf ? '' : ' …'), desc: leaf ? c.desc : `${cands.filter(x => x.path[done.length] === w).length} commands`, status: leaf ? c.status : 'ui' });
  }
  const { cmd, rest } = match(done);
  if (cmd && done.length >= cmd.path.length) {
    const restDone = rest;
    const lastFlag = [...restDone].reverse().find(t => t.startsWith('--'));
    const spec = lastFlag ? cmd.flags?.find(f => '--' + f.name === lastFlag) : undefined;
    const argsAfterFlag = lastFlag ? restDone.length - 1 - restDone.lastIndexOf(lastFlag) : 0;
    if (spec && argsAfterFlag < spec.arity) {
      const vals = spec.name === 'drone' || spec.name === 'at' ? suggestDrones(app) : spec.name === 'draft' ? app.drafts.list.map(d => d.id) : spec.name === 'radius' ? ['6', '8', '12'] : spec.name === 'colors' ? ['#FFB000', '#FF3D7F', '#00C2A8', '#B6F500', '#9B7BFF'] : spec.name === 'seed' ? ['42', '7'] : [];
      for (const v of vals) if (v.startsWith(partial)) out.push({ insert: prefix + v + ' ', label: v, desc: spec.name === 'draft' ? app.drafts.list.find(d => d.id === v)?.name ?? '' : spec.name === 'drone' || spec.name === 'at' ? 'live drone' : spec.hint, status: 'ui' });
    } else {
      if (cmd.values && restDone.filter(t => !t.startsWith('--')).length === 0) for (const v of cmd.values) if (v.startsWith(partial)) out.push({ insert: prefix + v + ' ', label: v, desc: cmd.desc, status: cmd.status });
      for (const f of cmd.flags ?? []) if (!restDone.includes('--' + f.name) && ('--' + f.name).startsWith(partial || '-')) out.push({ insert: prefix + '--' + f.name + ' ', label: `--${f.name}${f.hint ? ' ' + f.hint : ''}`, desc: '', status: 'ui' });
      if (cmd.path[0] === 'form' && cmd.path[1] === 'text' && restDone.length === 0 && !partial) out.push({ insert: prefix + '"', label: '"WORD"', desc: 'A–Z, 0–9, space', status: 'ui' });
    }
  }
  return out.slice(0, 8);
}

function suggestDrones(app: App): string[] {
  const sel = app.store.state.selected?.id;
  const live = app.session.liveIds();
  const pick = [sel, live[0], live[Math.floor(live.length / 2)], live[live.length - 1]].filter((v): v is number => v !== undefined && v !== null);
  return [...new Set(pick)].map(String);
}
