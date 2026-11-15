import { describe, expect, it } from 'vitest';
import { makeParams, type Score } from '../../../src/contracts';
import { createWorld } from '../../../src/sim';
import { staticBrain } from '../../../src/agent/staticBrain';
import { complete, type ParseContext } from '../../../src/app/ui/commands';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const world = createWorld({ seed: 101, params: makeParams(10), score, brain: staticBrain });
world.step();
world.schedule({ type: 'KILL', tick: 2, ids: [0, 6] });
const snapshot = world.step();
const ctx: ParseContext = { snapshot, selectedId: 6, drafts: ['d1', 'd2'] };

const inserts = (line: string, context: ParseContext = ctx) => complete(line, context).map(s => s.insert);
const labels = (line: string, context: ParseContext = ctx) => complete(line, context).map(s => s.label);

describe('completion', () => {
  it('offers top-level commands for an empty line, at most 8', () => {
    const all = complete('', ctx);
    expect(all).toHaveLength(8);
    expect(all[0]).toMatchObject({ insert: 'help ', status: 'ui' });
  });

  it('completes a partial command word and groups multi-word commands', () => {
    expect(inserts('pl')).toEqual(['play ']);
    expect(complete('fa', ctx)).toEqual([{ insert: 'fault ', label: 'fault …', desc: '7 commands', status: 'ui' }]);
  });

  it('completes subcommands with their usage and status', () => {
    expect(inserts('fault kill')).toEqual(['fault kill ', 'fault kill-region ', 'fault kill-random ']);
    const partition = complete('fault part', ctx)[0];
    expect(partition).toMatchObject({ insert: 'fault partition ', label: 'fault partition on|off', status: 'main' });
    expect(complete('cue ', ctx).every(s => s.status === 'later')).toBe(true);
  });

  it('suggests flags with their hints, skipping flags already given', () => {
    expect(labels('fault kill-region ')).toEqual(['--radius METRES (0, 40]', '--at ID', '--pick']);
    expect(labels('fault kill-region --radius 8 ')).toEqual(['--at ID', '--pick']);
    expect(inserts('fault jam --r')).toEqual(['fault jam --radius ']);
  });

  it('suggests flag values: live drones (selected first), drafts, swatches, radii', () => {
    expect(labels('fault kill --drone ')).toEqual(['1', '5', '9']);
    expect(labels('inject --draft ')).toEqual(['d1', 'd2']);
    expect(labels('form sphere --colors ')).toContain('#FFB000');
    expect(labels('fault jam --radius ')).toEqual(['6', '8', '12']);
    expect(labels('fault kill --drone ', { ...ctx, selectedId: 3 })).toEqual(['3', '1', '5', '9']);
    expect(labels('fault kill --drone ', {})).toEqual([]);
  });

  it('suggests positional values', () => {
    expect(labels('fault partition ')).toEqual(['on', 'off']);
    expect(labels('compare ')).toEqual(['on', 'off', 'static']);
    expect(labels('view x')).toEqual(['xray']);
    expect(labels('speed ')).toEqual(['0.25', '0.5', '1', '2', '4']);
    expect(labels('inspect ')).toEqual(['1', '5', '9', 'off', '--static']);
  });

  it('opens a quote for form text and offers nothing inside an open quote', () => {
    expect(complete('form text ', ctx)[0]).toMatchObject({ insert: 'form text "', label: '"WORD"' });
    expect(complete('form text "HEL', ctx)).toEqual([]);
  });

  it('keeps quoted values quoted in the inserted line', () => {
    expect(inserts('form text "HI THERE" --n')).toEqual(['form text "HI THERE" --name ']);
  });

  it('never suggests a line that parse would reject', () => {
    expect(labels('inject --pick ')).toEqual(['--draft DRAFT']);
    expect(labels('fault jam --pick ')).toEqual(['--radius METRES (0, 40]']);
    expect(labels('fault jam --at 4 ')).toEqual(['--radius METRES (0, 40]']);
    expect(labels('inspect off ')).toEqual([]);
    expect(labels('inspect 4 ')).toEqual(['--static']);
  });

  it('does not count flag values as positional arguments', () => {
    expect(complete('form text --name X ', ctx)[0]).toMatchObject({ insert: 'form text --name X "', label: '"WORD"' });
  });

  it('completes command names after help, and matches partials case-insensitively', () => {
    expect(inserts('help fa')).toEqual(['help fault kill ', 'help fault kill-region ', 'help fault kill-random ', 'help fault jam ', 'help fault unjam ', 'help fault partition ', 'help fault loss ']);
    expect(inserts('PL')).toEqual(['play ']);
    expect(inserts('Fa')).toEqual(['fault ']);
  });

  it('offers nothing after a command that takes nothing more, or for unknown input', () => {
    expect(complete('play ', ctx)).toEqual([]);
    expect(complete('zz', ctx)).toEqual([]);
    expect(complete('fault partition on ', ctx)).toEqual([]);
  });
});
