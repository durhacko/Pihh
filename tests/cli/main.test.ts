import { describe, expect, it } from 'vitest';
import { overwriteConflicts, parseArgs, parseSeeds, recordFileName } from '../../src/cli/main';

describe('CLI arguments', () => {
  it('parses seed lists and ranges', () => {
    expect(parseSeeds('1-5')).toEqual([1, 2, 3, 4, 5]);
    expect(parseSeeds('1,3,101-102')).toEqual([1, 3, 101, 102]);
    expect(() => parseSeeds('5-1')).toThrow(/Bad seed range/);
    expect(() => parseSeeds('x')).toThrow(/Bad seed list/);
  });

  it('parses a batch command', () => {
    expect(parseArgs(['--scenario', 'S2', '--seeds', '1-5', '--arms', 'static,encore', '--n0', '200', '--out', 'results/'])).toEqual({
      scenarios: ['S2'], seeds: [1, 2, 3, 4, 5], arms: ['static', 'encore'], n0: 200, out: 'results/', report: null, reportOut: null,
    });
    expect(parseArgs(['--scenario', 'min', '--seeds', '1']).scenarios).toEqual(['S0', 'S1', 'S2', 'S3', 'S5']);
  });

  it('parses a report command', () => {
    expect(parseArgs(['--report', 'results/']).report).toBe('results/');
  });

  it('rejects unknown scenarios, arms and flags', () => {
    expect(() => parseArgs(['--scenario', 'S9', '--seeds', '1'])).toThrow(/Unknown scenario 'S9'/);
    expect(() => parseArgs(['--scenario', 'S0', '--seeds', '1', '--arms', 'oracle'])).toThrow(/Unknown arm 'oracle'/);
    expect(() => parseArgs(['--scenaro', 'S0'])).toThrow(/Unknown flag --scenaro/);
    expect(() => parseArgs(['--seeds', '1'])).toThrow(/Missing --scenario/);
  });

  it('refuses to overwrite a record from another git or paramsHash, allows a replay', () => {
    const files: Record<string, string> = {
      'same.json': JSON.stringify({ git: 'g1', paramsHash: 'p1' }),
      'otherGit.json': JSON.stringify({ git: 'g0', paramsHash: 'p1' }),
      'otherParams.json': JSON.stringify({ git: 'g1', paramsHash: 'p0' }),
      'broken.json': '{',
    };
    const read = (f: string) => files[f] ?? null;
    expect(overwriteConflicts(['same.json', 'missing.json'], 'g1', 'p1', read)).toEqual([]);
    const conflicts = overwriteConflicts(Object.keys(files), 'g1', 'p1', read);
    expect(conflicts.map((c) => c.split(':')[0])).toEqual(['otherGit.json', 'otherParams.json', 'broken.json']);
  });

  it('names one file per scenario, n0, arm and seed', () => {
    expect(recordFileName({ scenario: 'S2', n0: 200, arm: 'static', seed: 3 })).toBe('S2_n200_static_s3.json');
  });
});
