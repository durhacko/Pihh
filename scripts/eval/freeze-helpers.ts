// scripts/eval/freeze-helpers.ts
// Checks used by scripts/eval/freeze-run.sh (evaluation doc §5). Run with: npx tsx scripts/eval/freeze-helpers.ts <command> ...
//   params-hash                                  paramsHash of makeParams(200), the frozen evaluation params
//   check <dir> <git> <paramsHash>               the full minimum matrix is there, and every record carries git and paramsHash
//   replay <matrixDir> <replayDir>               every replayed record has the same stateHash, summary and series
//   compare <oldDir> <newDir>                    exit 0 if every old record equals its new one apart from `git`, 3 if any differs, 4 if there are no old records
//   split <RESULTS.md> <generatedOut> <notesOut> split at the "---" before "## Notes": generated section / hand-written notes
//   review <oldGenerated> <newGenerated> <notes> print what in the notes may need a manual update; exit 5 if anything does
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeParams } from '../../src/contracts';
import type { RunRecord } from '../../src/contracts';
import { paramsHash } from '../../src/cli/run';

export const SCENARIOS = ['S0', 'S1', 'S2', 'S3', 'S5'] as const;
export const SEEDS = [1, 2, 3, 4, 5];
export const ARMS = ['static', 'encore'] as const;
export const N0 = 200;
export const REPLAY_SEED = 3;

const fileName = (s: string, arm: string, seed: number) => `${s}_n${N0}_${arm}_s${seed}.json`;
const expected = () => SCENARIOS.flatMap((s) => ARMS.flatMap((a) => SEEDS.map((k) => fileName(s, a, k))));
const load = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunRecord;
const recordFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^S\d_n\d+_(static|encore)_s\d+\.json$/.test(f)).sort() : []);
/** What must be equal between two runs of the same code: everything but the commit stamp. */
const body = (r: RunRecord) => JSON.stringify({ ...r, git: undefined });

function fail(msg: string, code = 1): never {
  console.error(`FREEZE: ${msg}`);
  process.exit(code);
}

const NOTES_MARKER = /^## Notes\b/;

/** Index of the "---" line that opens the hand-written notes, or -1. */
function notesStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== '---') continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) if (NOTES_MARKER.test(lines[j] ?? '')) return i;
  }
  return -1;
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'params-hash':
    console.log(paramsHash(makeParams(N0)));
    break;

  case 'check': {
    const [dir, git, hash] = args as [string, string, string];
    const have = new Set(recordFiles(dir));
    const missing = expected().filter((f) => !have.has(f));
    if (missing.length) fail(`${missing.length} records missing in ${dir}: ${missing.join(', ')}`);
    const bad: string[] = [];
    for (const f of expected()) {
      const r = load(dir, f);
      if (r.git !== git) bad.push(`${f}: git ${r.git}`);
      if (r.paramsHash !== hash) bad.push(`${f}: paramsHash ${r.paramsHash}`);
      if (r.n0 !== N0 || r.v !== 1) bad.push(`${f}: n0 ${r.n0} v ${r.v}`);
    }
    if (bad.length) fail(`records do not carry git ${git} and paramsHash ${hash}:\n  ${bad.join('\n  ')}`);
    console.log(`check: ${expected().length} records, all git ${git}, all paramsHash ${hash.slice(0, 12)}`);
    break;
  }

  case 'replay': {
    const [matrix, replay] = args as [string, string];
    const out: string[] = [];
    let ok = true;
    for (const s of SCENARIOS) {
      const f = fileName(s, 'encore', REPLAY_SEED);
      const a = load(matrix, f);
      const b = load(replay, f);
      const same = a.stateHash === b.stateHash && JSON.stringify(a.summary) === JSON.stringify(b.summary) && JSON.stringify(a.series) === JSON.stringify(b.series);
      ok &&= same;
      out.push(`${s} encore seed ${REPLAY_SEED}: ${same ? 'EQUAL' : 'DIFFERENT'} (${a.stateHash} / ${b.stateHash})`);
    }
    console.log(out.join('\n'));
    if (!ok) fail('replay differs: the run is not reproducible');
    break;
  }

  case 'compare': {
    const [oldDir, newDir] = args as [string, string];
    const old = recordFiles(oldDir);
    if (old.length === 0) { console.log('compare: no previous records'); process.exit(4); }
    const gits = [...new Set(old.map((f) => load(oldDir, f).git))];
    const differ: string[] = [];
    for (const f of expected()) {
      if (!old.includes(f)) { differ.push(`${f}: no previous record`); continue; }
      if (body(load(oldDir, f)) !== body(load(newDir, f))) differ.push(`${f}: ${load(oldDir, f).stateHash} -> ${load(newDir, f).stateHash}`);
    }
    // Records outside the minimum matrix (another n0, S4, more seeds) are not touched by the freeze run: reported only.
    const extra = old.filter((f) => !expected().includes(f));
    console.log(`compare: previous records from git ${gits.join(', ')}; ${expected().length - differ.length} of ${expected().length} identical apart from git` + (extra.length ? `; ${extra.length} other records left as they are: ${extra.join(', ')}` : ''));
    if (differ.length) { console.log(`  differ:\n  ${differ.join('\n  ')}`); process.exit(3); }
    break;
  }

  case 'split': {
    const [path, genOut, notesOut] = args as [string, string, string];
    const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
    const at = notesStart(lines);
    const gen = at < 0 ? lines : lines.slice(0, at);
    const notes = at < 0 ? [] : lines.slice(at);
    while (gen.length && gen[gen.length - 1] === '') gen.pop();
    writeFileSync(genOut, gen.length ? `${gen.join('\n')}\n` : '');
    writeFileSync(notesOut, notes.join('\n'));
    console.log(`split: generated ${gen.length} lines, notes ${notes.length} lines${at < 0 ? ' (no notes section found)' : ''}`);
    break;
  }

  case 'review': {
    const [oldGenPath, newGenPath, notesPath] = args as [string, string, string];
    const oldGen = readFileSync(oldGenPath, 'utf8');
    const newGen = readFileSync(newGenPath, 'utf8');
    const notes = readFileSync(notesPath, 'utf8').split('\n');
    const flags: string[] = [];
    // The commit the old records came from: every line of the notes that names it describes that run.
    const oldGit = /git: `([0-9a-f]{7,40})`/.exec(oldGen)?.[1];
    const newGit = /git: `([0-9a-f]{7,40})`/.exec(newGen)?.[1];
    if (oldGit && newGit && oldGit !== newGit) {
      notes.forEach((l, i) => { if (l.includes(oldGit) || l.includes(oldGit.slice(0, 7))) flags.push(`notes line ${i + 1} names the previous commit ${oldGit.slice(0, 7)}: ${l.trim().slice(0, 160)}`); });
    }
    notes.forEach((l, i) => { if (/wall-clock|load average/i.test(l)) flags.push(`notes line ${i + 1} quotes run timing or load (always run-specific): ${l.trim().slice(0, 160)}`); });
    // Numbers the notes quote that were in the old generated tables but are gone from the new ones.
    const nums = (s: string) => new Set(s.match(/-?\d+\.\d+/g) ?? []);
    const oldNums = nums(oldGen);
    const newNums = nums(newGen);
    notes.forEach((l, i) => {
      const gone = [...nums(l)].filter((n) => oldNums.has(n) && !newNums.has(n));
      if (gone.length) flags.push(`notes line ${i + 1} quotes ${gone.join(', ')}, which the new tables no longer contain: ${l.trim().slice(0, 160)}`);
    });
    const tablesSame = oldGen.split('\n').filter((l) => !l.startsWith('Records:')).join('\n') === newGen.split('\n').filter((l) => !l.startsWith('Records:')).join('\n');
    console.log(`review: generated tables ${tablesSame ? 'IDENTICAL apart from the Records/git line' : 'CHANGED'}`);
    if (flags.length) {
      console.log(`MANUAL REVIEW of the hand-written notes (${flags.length}):\n  ${flags.join('\n  ')}`);
      process.exit(5);
    }
    console.log('review: nothing in the notes needs updating');
    break;
  }

  default:
    fail(`unknown command '${cmd ?? ''}'`);
}
