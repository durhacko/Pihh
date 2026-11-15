// P2-WP-02 part b: the FZ1 fuzzer (PHASE2_EVALUATION §6.2; P2-T03, P2-T04, P2-T05).
// Default suite: restatement pins, generator determinism and uniqueness (P2-T03), units, CLI arguments and a short
// smoke campaign whose finds replay (P2-T04's replay half). Opt-in: P2_FUZZ=1 runs P2-T05 (positive control and the
// unaided calibration) and P2-T04's 1-minimality; P2_WIDE=1 runs the byte-identical campaign check of P2-T03.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { EnvEvent } from '../../src/contracts';
import { makeScore } from '../../src/score';
import { KNOWN_LIMIT_3 } from '../../src/observer/invariants';
import {
  buildRepro, calibrationSchedule, firstOf, FZ1_TICKS, fromUnits, fz1Setup, generateSchedule, healReadyTick, LONG_HOLD, MAX_KILLED,
  parseFuzzArgs, replay, runCalibration, runCampaign, runSchedule, shrinkSchedule, sortEvents, toUnits,
} from '../../src/cli/fuzz';
import { readRepro, serialiseRepro, writeRepro } from '../../src/cli/repro';
import * as g1 from '../g1/helpers';

const setup = fz1Setup();
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fz1-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('restatements pinned to tests/g1/helpers.ts', () => {
  it('healReadyTick, LONG_HOLD, the params and the score equal G1\'s', () => {
    for (const [hold, since] of [[241, 0], [500, 300], [0, 0]] as const) expect(healReadyTick(hold, since, setup.params)).toBe(g1.healReadyTick(hold, since, setup.params));
    expect(LONG_HOLD).toBe(g1.LONG_HOLD);
    expect(setup.params).toEqual(g1.g1Params(40));
    expect(setup.score).toEqual(makeScore([g1.TEXT], 40, g1.g1Params(40), g1.LONG_HOLD));
  });

  it('the calibration profile is killSetUp\'s clumped kill of 5 at the G1 kill tick, for every centre', () => {
    for (let centre = 0; centre < 40; centre++) expect(calibrationSchedule(setup, centre)).toEqual(g1.killSetUp(1, 40, 5, centre).events);
  });
});

describe('the FZ1 generator (P2-T03)', () => {
  const schedules = Array.from({ length: 200 }, (_, r) => generateSchedule(4242, r, setup));

  it('is deterministic in (campaignSeed, run), and another seed or run differs', () => {
    expect(generateSchedule(4242, 5, setup)).toEqual(schedules[5]);
    expect(JSON.stringify(generateSchedule(4243, 5, setup))).not.toBe(JSON.stringify(schedules[5]));
    expect(new Set(schedules.map(s => JSON.stringify(s))).size).toBeGreaterThan(190);
  });

  it('gives every score a unique version and every jam and partition pair its own id', () => {
    for (const s of schedules) {
      const versions = s.filter(e => e.type === 'INJECT_SCORE').map(e => (e as Extract<EnvEvent, { type: 'INJECT_SCORE' }>).score.version);
      const keys = [...versions, setup.score.version].map(v => `${v.issuedTick}:${v.origin}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const type of ['JAM_ON', 'PARTITION_ON'] as const) {
        const ids = s.filter(e => e.type === type).map(e => (e as { id: string }).id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(type === 'JAM_ON' ? /^fz-j\d+$/ : /^fz-p\d+$/);
      }
    }
    expect(schedules.some(s => s.some(e => e.type === 'INJECT_SCORE'))).toBe(true);
  });

  it('keeps to the §6.2 shape: ticks in [tReady, ticks - tTail], at most 10 kills, windows closed inside, sorted', () => {
    const hi = setup.ticks - setup.tTail;
    for (const s of schedules) {
      expect(s.length).toBeGreaterThan(0);
      expect(sortEvents(s)).toEqual(s);
      for (const e of s) { expect(e.tick).toBeGreaterThanOrEqual(setup.tReady); expect(e.tick).toBeLessThanOrEqual(hi); }
      const killed = s.flatMap(e => (e.type === 'KILL' ? e.ids : []));
      expect(new Set(killed).size).toBe(killed.length);
      expect(killed.length).toBeLessThanOrEqual(MAX_KILLED);
      for (const on of s.filter(e => e.type === 'JAM_ON' || e.type === 'PARTITION_ON')) {
        const off = s.find(e => (e.type === 'JAM_OFF' || e.type === 'PARTITION_OFF') && e.id === (on as { id: string }).id);
        expect(off && off.tick > on.tick).toBe(true);
      }
      for (const e of s) if (e.type === 'INJECT_SCORE') expect(killed.filter(id => s.some(k => k.type === 'KILL' && k.tick <= e.tick && k.ids.includes(id)))).not.toContain(e.droneId);
    }
  });
});

describe('atomic units', () => {
  it('splits kills per id and pairs ON/OFF; fromUnits(toUnits(s)) preserves every event and is stable', () => {
    for (let r = 0; r < 60; r++) {
      const s = generateSchedule(9, r, setup);
      const units = toUnits(s);
      const back = fromUnits(units);
      const flat = (events: EnvEvent[]) => events.flatMap(e => (e.type === 'KILL' ? e.ids.map(id => `${e.tick}:KILL:${id}`) : [`${e.tick}:${e.type}:${JSON.stringify(e)}`])).sort();
      expect(flat(back)).toEqual(flat(s));
      expect(fromUnits(toUnits(back))).toEqual(back);
      expect(units.length).toBe(s.reduce((n, e) => n + (e.type === 'KILL' ? e.ids.length : e.type === 'JAM_OFF' || e.type === 'PARTITION_OFF' ? 0 : 1), 0));
      for (const u of units) if (u.events[0]?.type === 'JAM_ON' || u.events[0]?.type === 'PARTITION_ON') expect(u.events).toHaveLength(2);
    }
  });
});

describe('CLI arguments', () => {
  it('parses a campaign, calibration and replay, and refuses a missing --out or an unknown campaign', () => {
    expect(parseFuzzArgs(['--campaign', 'FZ1', '--seed', '7', '--runs', '3', '--out', 'x'])).toMatchObject({ mode: 'campaign', seed: 7, runs: 3, out: 'x', n0: 40, ticks: FZ1_TICKS });
    expect(parseFuzzArgs(['--calibrate', '--seed', '1', '--runs', '50'])).toMatchObject({ mode: 'calibrate', out: null });
    expect(parseFuzzArgs(['--replay', 'f.json'])).toMatchObject({ mode: 'replay', replay: 'f.json' });
    expect(() => parseFuzzArgs(['--campaign', 'FZ1', '--seed', '7', '--runs', '3'])).toThrow(/no default --out/);
    expect(() => parseFuzzArgs(['--campaign', 'FZ2', '--seed', '7', '--runs', '3', '--out', 'x'])).toThrow(/only FZ1/);
    expect(() => parseFuzzArgs(['--campaign', 'FZ1', '--seed', '7', '--runs', '401', '--out', 'x'])).toThrow(RangeError);
    expect(() => parseFuzzArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});

describe('smoke campaign (default suite, kept short)', () => {
  it('runs 3 schedules at 810 ticks; every find is shrunk, written under --out only, and replays to the same INV and tick', () => {
    const out = tmp();
    const short = fz1Setup(40, 810);
    const lines: string[] = [];
    const result = runCampaign({ campaignSeed: 2026, runs: 3, out, setup: short, shrinkBudget: 3, log: l => lines.push(l) });
    expect(result.runs).toBe(3);
    expect(lines.some(l => /first run wall time: \d+ ms/.test(l))).toBe(true);
    expect(readdirSync(out).sort()).toEqual(result.finds.map(f => (f.path ?? '').split(/[\\/]/).pop()).sort());
    for (const find of result.finds) {
      const repro = readRepro(find.path as string);
      expect(serialiseRepro(repro)).toBe(readFileSync(find.path as string, 'utf8'));
      expect(replay(repro)).toMatchObject({ same: true, expectedTick: repro.violation.firstTick });
    }
    expect(lines.at(-1)).toMatch(/Checked properties on these runs, not proofs\./);
  }, 120_000);
});

describe('a find is filed and replays (default suite, on a known violating schedule)', () => {
  // The short smoke campaign above may find nothing (it did on the seeds tried), so the file-and-replay path is driven
  // here on the known G1 late pair (seed 1, centre 15) with a shrink budget of 0: 3 runs, no shrinking.
  it('writes a p2-repro/1 file under --out that replays to the same INV and first tick; budget 0 is oneMinimal false', () => {
    const out = tmp();
    const events = calibrationSchedule(setup, 15);
    const shrunk = shrinkSchedule(setup, 1, events, 'INV-QUIET', 0);
    expect(shrunk).toMatchObject({ fromUnits: 5, toUnits: 5, tests: 0, oneMinimal: false });
    const repro = buildRepro(setup, { git: 'test', campaignSeed: 1, run: 0, seed: 1 }, shrunk, 'INV-QUIET');
    expect(repro.violation).toMatchObject({ inv: 'INV-QUIET', firstTick: 710 });
    const path = writeRepro(out, repro);
    expect(readdirSync(out)).toEqual(['fz1-s1-r0-inv-quiet.json']);
    expect(readFileSync(path, 'utf8')).toBe(serialiseRepro(repro));
    expect(replay(readRepro(path))).toMatchObject({ same: true, inv: 'INV-QUIET', expectedTick: 710, actualTick: 710, stateHash: repro.stateHash });
  }, 120_000);
});

const FUZZ = process.env.P2_FUZZ === '1';

describe.runIf(FUZZ)('P2-T05 calibration (P2_FUZZ=1)', () => {
  // Re-confirmation of the G1 late-commit miss on this tree: seed 1, centres 15 and 30 (tests/g1/g1.beyond.test.ts).
  const KNOWN_LATE = [15, 30];

  it('(a) positive control: the known late G1 pairs fire INV-QUIET through the checker, 404 ticks after the kill', () => {
    for (const centre of KNOWN_LATE) {
      const events = calibrationSchedule(setup, centre);
      const q = firstOf(runSchedule(setup, 1, events).report, 'INV-QUIET');
      expect(q, `centre ${centre}`).not.toBeNull();
      expect((q?.tick ?? 0) - (events[0] as EnvEvent).tick).toBe(404);
      console.log(`P2-T05 (a): seed 1 centre ${centre}: INV-QUIET at tick ${q?.tick} (kill at ${events[0]?.tick}), knownLimit ${String(q?.knownLimit)}`);
    }
  }, 120_000);

  // KNOWN GAP, recorded and not hidden: §6.2 expects these to be tagged '§8.5 limit 3'. The checker tags limit 3 only
  // when the committing drone already committed in (anchor, c); the G1 trace is a chain of waves whose late commit is a
  // drone's FIRST commit, so the tag is null. Reported to the orchestrator; the checker (src/observer) is not this
  // package's to change.
  it.fails('(a) ... and are tagged §8.5 limit 3 (spec expectation; currently untagged)', () => {
    for (const centre of KNOWN_LATE) expect(firstOf(runSchedule(setup, 1, calibrationSchedule(setup, centre)).report, 'INV-QUIET')?.knownLimit).toBe(KNOWN_LIMIT_3);
  }, 120_000);

  it('(b) unaided: the calibration profile finds INV-QUIET within its budget; the shrunk repro holds one KILL and replays (P2-T04)', () => {
    const out = tmp();
    const lines: string[] = [];
    const { runsToDiscovery, find } = runCalibration({ campaignSeed: 1, runs: 400, out, setup, log: l => lines.push(l) });
    console.log(`P2-T05 (b): runs to discovery ${runsToDiscovery}; ${lines.join(' | ')}`);
    expect(runsToDiscovery).not.toBeNull();
    const repro = find?.repro;
    expect(repro?.violation.inv).toBe('INV-QUIET');
    expect(repro?.events.filter(e => e.type === 'KILL')).toHaveLength(1);
    expect(replay(repro!).same).toBe(true);
    // P2-T04: removing any one unit stops the INV (or the repro says oneMinimal: false).
    if (repro!.shrink.oneMinimal) {
      const units = toUnits(repro!.events);
      for (let i = 0; i < units.length; i++) {
        const without = fromUnits(units.filter((_, j) => j !== i));
        expect(firstOf(runSchedule(setup, repro!.seed, without).report, 'INV-QUIET'), `unit ${i}`).toBeNull();
      }
    }
  }, 900_000);
});

describe.runIf(process.env.P2_WIDE === '1')('P2-T03 byte-identical repros (P2_WIDE=1)', () => {
  it('the same campaign twice writes byte-identical files', () => {
    const [a, b] = [tmp(), tmp()];
    const short = fz1Setup(40, 810);
    runCampaign({ campaignSeed: 77, runs: 6, out: a, setup: short, shrinkBudget: 40, git: 'pinned' });
    runCampaign({ campaignSeed: 77, runs: 6, out: b, setup: short, shrinkBudget: 40, git: 'pinned' });
    const files = readdirSync(a).sort();
    expect(readdirSync(b).sort()).toEqual(files);
    for (const f of files) expect(readFileSync(join(b, f), 'utf8')).toBe(readFileSync(join(a, f), 'utf8'));
    console.log(`P2-T03: ${files.length} repro files byte-identical across two campaigns`);
  }, 1_800_000);
});
