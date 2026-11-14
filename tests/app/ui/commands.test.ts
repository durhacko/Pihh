import { describe, expect, it } from 'vitest';
import { makeParams, type Score, type WorldSnapshot } from '../../../src/contracts';
import { createWorld } from '../../../src/sim';
import { staticBrain } from '../../../src/agent/staticBrain';
import { COMMANDS, parse, parseColour, parseInteger, parseNumber, tokenize, validateText, type Intent, type ParseContext } from '../../../src/app/ui/commands';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };

/** A real snapshot of 12 drones in which drone 3 is dead. */
function snapshotWithDeadDrone(): WorldSnapshot {
  const world = createWorld({ seed: 101, params: makeParams(12), score, brain: staticBrain });
  world.step();
  world.schedule({ type: 'KILL', tick: 2, ids: [3] });
  return world.step();
}
const snapshot = snapshotWithDeadDrone();
const ctx: ParseContext = { snapshot, seed: 101, drafts: ['d1', 'd2'] };

function ok(line: string, context: ParseContext = ctx): Intent {
  const result = parse(line, context);
  if (!result.ok) throw new Error(`expected "${line}" to parse, got: ${result.error}`);
  return result.intent;
}
function error(line: string, context: ParseContext = ctx): string {
  const result = parse(line, context);
  if (result.ok) throw new Error(`expected "${line}" to be rejected, got ${JSON.stringify(result.intent)}`);
  return result.error;
}

describe('fixture', () => {
  it('has a real dead drone 3 and live drones around it', () => {
    expect(snapshot.drones[3].alive).toBe(false);
    expect(snapshot.drones[4].alive).toBe(true);
  });
});

describe('tokenize', () => {
  it('keeps a quoted value, spaces included, as one quoted token', () => {
    expect(tokenize('form text "HELLO WORLD" --name x').tokens).toEqual([
      { text: 'form', quoted: false }, { text: 'text', quoted: false }, { text: 'HELLO WORLD', quoted: true }, { text: '--name', quoted: false }, { text: 'x', quoted: false },
    ]);
  });
  it('reports an open quote and a trailing space for completion', () => {
    expect(tokenize('form text "HEL').openQuote).toBe(true);
    expect(tokenize('fault ').trailingSpace).toBe(true);
  });
});

describe('typed values', () => {
  it.each([
    ['12', 12], ['-3', -3], ['0.5', 0.5],
    ['Infinity', null], ['-Infinity', null], ['NaN', null], ['1e3', null], ['0x10', null], ['', null], ['1.', null], ['.5', null], ['1'.padEnd(400, '0'), null],
  ])('parseNumber(%j) = %j', (text, expected) => expect(parseNumber(text)).toBe(expected));
  it.each([['7', 7], ['7.5', null], ['9007199254740993', null], ['Infinity', null]])('parseInteger(%j) = %j', (text, expected) => expect(parseInteger(text)).toBe(expected));
  it('reads #RRGGBB as 0–1 RGB and rejects anything else', () => {
    expect(parseColour('#FF0000')).toEqual([1, 0, 0]);
    expect(parseColour('#00c2a8')).toEqual([0, 194 / 255, 168 / 255]);
    for (const bad of ['FF0000', '#FFF', '#GG0000', '#FF00000', 'red']) expect(parseColour(bad)).toBeNull();
  });
  it('validates text against the score font', () => {
    expect(validateText('Durhack 26')).toBeNull();
    expect(validateText('HI!')).toMatch(/"!"/);
    expect(validateText('ÉTÉ')).toMatch(/"É"/);
    expect(validateText('🙂')).toMatch(/🙂/);
    expect(validateText('   ')).toMatch(/needs a word/);
    expect(validateText('A'.repeat(21))).toMatch(/most is 20/);
  });
});

describe('the command table', () => {
  it('has no duplicate paths and every built command has a builder', () => {
    const paths = COMMANDS.map(c => c.path.join(' '));
    expect(new Set(paths).size).toBe(paths.length);
    for (const c of COMMANDS) expect(c.status === 'later' || typeof c.build === 'function').toBe(true);
  });
});

describe('accepted commands become typed intents', () => {
  it.each<[string, Intent]>([
    ['play', { kind: 'control', command: 'play', steps: [{ type: 'play' }], when: { playing: false } }],
    ['pause', { kind: 'control', command: 'pause', steps: [{ type: 'play' }], when: { playing: true } }],
    ['PLAY', { kind: 'control', command: 'play', steps: [{ type: 'play' }], when: { playing: false } }],
    ['step', { kind: 'step', command: 'step' }],
    ['reset', { kind: 'control', command: 'reset', steps: [{ type: 'reset', seed: 101 }] }],
    ['reset --seed 42', { kind: 'control', command: 'reset', steps: [{ type: 'reset', seed: 42 }] }],
    ['speed 0.5', { kind: 'control', command: 'speed', steps: [{ type: 'speed', speed: 0.5 }] }],
    ['speed 4', { kind: 'control', command: 'speed', steps: [{ type: 'speed', speed: 4 }] }],
    ['fault kill', { kind: 'control', command: 'fault kill', steps: [{ type: 'kill-selected' }] }],
    ['fault kill --drone 4', { kind: 'control', command: 'fault kill', steps: [{ type: 'select', id: 4 }, { type: 'kill-selected' }] }],
    ['fault kill-region', { kind: 'control', command: 'fault kill-region', steps: [{ type: 'kill-region' }] }],
    ['fault kill-region --radius 8 --at 5', { kind: 'control', command: 'fault kill-region', steps: [{ type: 'select', id: 5 }, { type: 'kill-region', radius: 8 }] }],
    ['fault kill-region --pick --radius 40', { kind: 'control', command: 'fault kill-region', steps: [{ type: 'kill-region', radius: 40 }], pick: 'Click the drone at the centre of the region' }],
    ['fault kill-random', { kind: 'control', command: 'fault kill-random', steps: [{ type: 'kill-random' }] }],
    ['fault kill-random --percent 10', { kind: 'control', command: 'fault kill-random', steps: [{ type: 'kill-random' }] }],
    ['fault jam --radius 12 --at 4', { kind: 'control', command: 'fault jam', steps: [{ type: 'select', id: 4 }, { type: 'jam', radius: 12 }], when: { jam: false } }],
    ['fault jam', { kind: 'control', command: 'fault jam', steps: [{ type: 'jam' }], when: { jam: false } }],
    ['fault unjam', { kind: 'control', command: 'fault unjam', steps: [{ type: 'jam' }], when: { jam: true } }],
    ['fault partition on', { kind: 'control', command: 'fault partition', steps: [{ type: 'partition' }], when: { partition: false } }],
    ['fault partition off', { kind: 'control', command: 'fault partition', steps: [{ type: 'partition' }], when: { partition: true } }],
    ['fault loss 20', { kind: 'control', command: 'fault loss', steps: [{ type: 'loss', loss: 0.2 }] }],
    ['fault loss 90%', { kind: 'control', command: 'fault loss', steps: [{ type: 'loss', loss: 0.9 }] }],
    ['fault loss 0', { kind: 'control', command: 'fault loss', steps: [{ type: 'loss', loss: 0 }] }],
    ['inject', { kind: 'inject', command: 'inject', steps: [], draftId: null }],
    ['inject --drone 4 --draft d2', { kind: 'inject', command: 'inject', steps: [{ type: 'select', id: 4 }], draftId: 'd2' }],
    ['inject --pick', { kind: 'inject', command: 'inject', steps: [], pick: 'Click the drone that will receive the uplink', draftId: null }],
    ['form text "durhack"', { kind: 'draft', command: 'form text', name: 'Durhack', recipe: { kind: 'text', text: 'DURHACK' } }],
    ['form text "HI 26" --colors #FF0000 #0000ff --name "Big hi"', { kind: 'draft', command: 'form text', name: 'Big hi', recipe: { kind: 'text', text: 'HI 26', palette: [[1, 0, 0], [0, 0, 1]] } }],
    ['form text ENCORE', { kind: 'draft', command: 'form text', name: 'Encore', recipe: { kind: 'text', text: 'ENCORE' } }],
    ['form sphere', { kind: 'draft', command: 'form sphere', name: 'Sphere', recipe: { kind: 'sphere' } }],
    ['form helix --name Twist', { kind: 'draft', command: 'form helix', name: 'Twist', recipe: { kind: 'helix' } }],
    ['inspect 4', { kind: 'ui', command: 'inspect', ui: { type: 'inspect', id: 4, world: 'encore', alive: true } }],
    ['inspect 3 --static', { kind: 'ui', command: 'inspect', ui: { type: 'inspect', id: 3, world: 'static', alive: false } }],
    ['inspect off', { kind: 'ui', command: 'inspect', ui: { type: 'inspect-off' } }],
    ['view xray', { kind: 'ui', command: 'view', ui: { type: 'view', lens: 'xray' } }],
    ['view beliefs off', { kind: 'ui', command: 'view', ui: { type: 'view', lens: 'beliefs', on: false } }],
    ['view zones on', { kind: 'ui', command: 'view', ui: { type: 'view', lens: 'zones', on: true } }],
    ['view ghosts on', { kind: 'ui', command: 'view', ui: { type: 'view', lens: 'ghosts', on: true } }],
    ['view tethers', { kind: 'ui', command: 'view', ui: { type: 'view', lens: 'tethers' } }],
    ['camera top', { kind: 'ui', command: 'camera', ui: { type: 'camera', preset: 'top' } }],
    ['compare on', { kind: 'ui', command: 'compare', ui: { type: 'compare', mode: 'on' } }],
    ['compare static', { kind: 'ui', command: 'compare', ui: { type: 'compare', mode: 'static' } }],
    ['compare off', { kind: 'ui', command: 'compare', ui: { type: 'compare', mode: 'off' } }],
    ['metrics', { kind: 'ui', command: 'metrics', ui: { type: 'metrics' } }],
    ['timeline', { kind: 'ui', command: 'timeline', ui: { type: 'timeline' } }],
    ['clear', { kind: 'ui', command: 'clear', ui: { type: 'clear' } }],
    ['history', { kind: 'ui', command: 'history', ui: { type: 'history' } }],
    ['drafts', { kind: 'ui', command: 'drafts', ui: { type: 'drafts' } }],
    ['draft use d1', { kind: 'ui', command: 'draft use', ui: { type: 'draft-use', id: 'd1' } }],
    ['preview', { kind: 'ui', command: 'preview', ui: { type: 'preview', on: true } }],
    ['preview off', { kind: 'ui', command: 'preview', ui: { type: 'preview', on: false } }],
    ['demo run 90', { kind: 'ui', command: 'demo run', ui: { type: 'demo-run', seconds: 90 } }],
    ['demo run', { kind: 'ui', command: 'demo run', ui: { type: 'demo-run', seconds: 90 } }],
    ['demo stop', { kind: 'ui', command: 'demo stop', ui: { type: 'demo-stop' } }],
    ['  play   ', { kind: 'control', command: 'play', steps: [{ type: 'play' }], when: { playing: false } }],
    ['\tplay ', { kind: 'control', command: 'play', steps: [{ type: 'play' }], when: { playing: false } }],
    ['FAULT KILL --Drone 4', { kind: 'control', command: 'fault kill', steps: [{ type: 'select', id: 4 }, { type: 'kill-selected' }] }],
    ['fault unjam operator-jam', { kind: 'control', command: 'fault unjam', steps: [{ type: 'jam' }], when: { jam: true } }],
    ['fault loss -0', { kind: 'control', command: 'fault loss', steps: [{ type: 'loss', loss: 0 }] }],
    ['reset --seed -0', { kind: 'control', command: 'reset', steps: [{ type: 'reset', seed: 0 }] }],
    ['reset --seed 007', { kind: 'control', command: 'reset', steps: [{ type: 'reset', seed: 7 }] }],
  ])('%s', (line, expected) => expect(ok(line)).toEqual(expected));

  it('answers help from the table itself', () => {
    const all = ok('help');
    expect(all.kind).toBe('help');
    if (all.kind !== 'help') return;
    for (const c of COMMANDS) expect(all.text).toContain(c.path.join(' '));
    const one = ok('help fault kill-region');
    expect(one.kind === 'help' && one.text).toMatch(/^fault kill-region \[--radius/);
    const group = ok('help fault');
    expect(group.kind === 'help' && group.text.split('\n')).toHaveLength(COMMANDS.filter(c => c.path[0] === 'fault').length);
  });
});

describe('"later" commands are honest and change nothing', () => {
  it('normalises -0 to 0', () => {
    const loss = ok('fault loss -0');
    expect(loss.kind === 'control' && loss.steps[0].type === 'loss' && Object.is(loss.steps[0].loss, 0)).toBe(true);
    const seed = ok('reset --seed -0');
    expect(seed.kind === 'control' && seed.steps[0].type === 'reset' && Object.is(seed.steps[0].seed, 0)).toBe(true);
  });

  it.each(['fault unjam J', 'form svg logo.svg', 'form cloud x.ply', 'cue add', 'cue move', 'show save', 'show load', 'seek 10', 'demo run 180', 'fault kill-random --percent 25', 'view neighbourhood'])('%s', line => {
    const intent = ok(line);
    expect(intent.kind).toBe('planned');
    expect(intent.kind === 'planned' && intent.message).toMatch(/planned, not built.*Nothing was changed\.$/);
  });
});

describe('rejections carry a useful message', () => {
  it.each<[string, RegExp]>([
    // unknown commands, with did-you-mean
    ['jump', /^Unknown command "jump"\. Type help\.$/],
    ['pley', /Did you mean "play"\?/],
    ['fault kil', /fault needs one of: kill, kill-region.*Did you mean "fault kill"\?/],
    ['fault', /fault needs one of/],
    ['"play"', /Unknown command/],
    ['eval("1")', /Quotes must wrap a whole value/],
    ['eval 1+1', /Unknown command "eval 1\+1"/],
    ['$(rm -rf /)', /Unknown command/],
    ['import x', /Unknown command/],
    // unexpected positional arguments
    ['play now', /play takes no arguments; unexpected "now"/],
    ['fault kill 4', /takes no arguments; unexpected "4"/],
    ['speed 1 2', /Too many arguments for speed; unexpected "2"/],
    ['form text "A" "B"', /Too many arguments/],
    ['inspect 4 5', /Too many arguments/],
    // unknown flags
    ['play --fast', /Unknown option --fast for play\. It takes no options\./],
    ['fault kill --radius 3', /Unknown option --radius for fault kill\. Options: --drone\./],
    ['fault kill -d 4', /Unknown option -d/],
    ['fault kill --drone=4', /Write --drone 4 with a space/],
    // duplicate and conflicting flags
    ['fault kill --drone 4 --drone 5', /--drone is given twice/],
    ['inject --drone 4 --pick', /--drone and --pick cannot be used together/],
    ['fault jam --at 4 --pick', /--at and --pick cannot be used together/],
    ['fault kill-region --pick --at 4', /--at and --pick cannot be used together/],
    ['inspect off --static', /inspect off takes no --static/],
    // wrong arity
    ['speed', /speed needs X/],
    ['inspect', /inspect needs ID\|off/],
    ['fault loss', /fault loss needs PERCENT/],
    ['fault partition', /fault partition needs on\|off/],
    ['form text', /form text needs "WORD"/],
    ['view', /view needs LENS/],
    ['fault kill --drone', /--drone needs a value \(ID\)/],
    ['fault kill --drone --drone', /--drone needs a value/],
    ['form sphere --colors #FF0000', /--colors needs 2 values/],
    ['form sphere --colors #FF0000 --name x', /--colors needs 2 values/],
    // out-of-range numbers
    ['fault kill-region --radius 0', /more than 0 and at most 40 m/],
    ['fault kill-region --radius 40.5', /at most 40 m/],
    ['fault jam --radius -1', /more than 0/],
    ['fault loss 91', /0 to 90 %/],
    ['fault loss -1', /0 to 90 %/],
    ['speed 0.2', /from 0.25 to 4/],
    ['speed 5', /from 0.25 to 4/],
    ['speed 3', /Supported speeds: 0.25, 0.5, 1, 2, 4/],
    ['fault kill-random --percent 0', /from 1 to 50/],
    ['fault kill-random --percent 51', /from 1 to 50/],
    ['reset --seed -1', /--seed must be a whole number from 0 to 4294967295/],
    ['reset --seed 4294967296', /--seed must be a whole number/],
    // non-finite and malformed numbers
    ['speed Infinity', /speed takes a number, not "Infinity"/],
    ['speed NaN', /not "NaN"/],
    ['speed 1e0', /not "1e0"/],
    ['fault loss Infinity', /takes a percentage/],
    ['fault kill-region --radius NaN', /--radius must be a number of metres, not "NaN"/],
    ['fault jam --radius 1e400', /--radius must be a number/],
    [`fault jam --radius ${'9'.repeat(400)}`, /--radius must be a number/],
    ['reset --seed 1.5', /--seed must be a whole number/],
    ['reset --seed 0x10', /--seed must be a whole number/],
    ['fault kill --drone 4.0', /must be a drone id/],
    ['fault kill --drone Infinity', /must be a drone id/],
    // invalid colours
    ['form sphere --colors #FF0000 red', /--colors needs two #RRGGBB colours/],
    ['form helix --colors #FFF #000', /--colors needs two #RRGGBB/],
    ['form helix --colors #GG0000 #000000', /--colors needs two #RRGGBB/],
    // text outside the font table
    ['form text "HELLO!"', /The font has no "!"/],
    ['form text "naïve"', /The font has no "ï"/],
    ['form text "straße"', /The font has no "ß"/],
    ['form text "ıce"', /The font has no "ı"/],
    ['form text "ſtop"', /The font has no "ſ"/],
    ['form text "ﬁx"', /The font has no "ﬁ"/],
    ['form sphere --name "‮evil"', /--name must be 1–24 printable/],
    ['form sphere --name "a​b"', /--name must be 1–24 printable/],
    ['form text ""', /needs a word/],
    ['form text "   "', /needs a word/],
    ['form text "ABCDEFGHIJKLMNOPQRSTU"', /21 characters; the most is 20/],
    ['form sphere --name ""', /--name must be 1–24 printable characters/],
    ['form sphere --name "\u0007bell"', /--name must be 1–24/],
    // dead or nonexistent drone ids
    ['fault kill --drone 3', /Drone 3 is dead/],
    ['fault kill --drone 99', /No drone 99: ids run 0–11/],
    ['fault kill --drone -1', /must be a drone id/],
    ['inject --drone 3', /Drone 3 is dead/],
    ['fault jam --at 12', /No drone 12/],
    ['fault kill-region --at 3', /Drone 3 is dead/],
    ['inspect 12', /No drone 12/],
    ['inspect abc', /inspect must be a drone id/],
    // quoted strings
    ['form text "HELLO', /Unterminated quote/],
    ['form text HEL"LO"', /Quotes must wrap a whole value/],
    ['form text "HEL"LO', /Quotes must wrap a whole value/],
    ['fault "kill"', /fault needs one of/],
    ['speed "fast"', /speed takes a number, not "fast"/],
    // enums
    ['fault partition maybe', /takes on or off, not "maybe"/],
    ['view radar', /view takes one of: xray, beliefs/],
    ['view xray sideways', /view takes on or off/],
    ['camera left', /camera takes audience, quarter or top/],
    ['compare both', /compare takes on, off or static/],
    ['demo run 60', /demo run takes 90/],
    ['preview maybe', /preview takes on or off/],
    // drafts
    ['draft use d9', /No draft "d9"/],
    ['inject --draft nope', /No draft "nope"/],
    ['help nothing', /No help for "nothing"/],
    // empty line
    ['', /Empty command/],
    ['   ', /Empty command/],
  ])('%s', (line, message) => expect(error(line)).toMatch(message));

  it('attaches the usage line to argument errors', () => {
    const result = parse('fault kill-region --radius 99', ctx);
    expect(result).toMatchObject({ ok: false, usage: 'fault kill-region [--radius METRES (0, 40]] [--at ID] [--pick]' });
  });

  it('cannot check drone ids without a snapshot', () => {
    expect(error('fault kill --drone 4', {})).toMatch(/No simulation snapshot yet/);
    expect(error('inspect 4', {})).toMatch(/No simulation snapshot yet/);
  });

  it('needs a seed for reset when none is known', () => {
    expect(error('reset', {})).toMatch(/reset needs --seed N/);
    expect(ok('reset --seed 7', {})).toEqual({ kind: 'control', command: 'reset', steps: [{ type: 'reset', seed: 7 }] });
  });

  it('does not check draft ids when the caller knows none', () => {
    expect(ok('draft use anything', { snapshot })).toEqual({ kind: 'ui', command: 'draft use', ui: { type: 'draft-use', id: 'anything' } });
  });

  it('treats a quoted --flag as a value, not a flag', () => {
    expect(error('form text "--pick"')).toMatch(/The font has no "-"/);
  });
});
