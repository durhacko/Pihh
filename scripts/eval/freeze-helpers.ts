// scripts/eval/freeze-helpers.ts
// Checks used by scripts/eval/freeze-run.sh (evaluation doc §5). Run with: npx tsx scripts/eval/freeze-helpers.ts <command> ...
// A matrix spec is "n0:scenarios:seeds", e.g. "200:S0,S1,S2,S3,S5:1-5" (both arms always).
//   params-hash <n0>                              paramsHash of makeParams(n0), the frozen evaluation params at that roster size
//   params-md <n0> <git> <out>                    write a PARAMS.md for makeParams(n0) (canonical JSON and its sha256)
//   check <dir> <git> <paramsHash> <spec>         the whole matrix is in <dir>, and every record carries git and paramsHash
//   replay <matrixDir> <replayDir> <spec> <seed>  every replayed Encore record (one per scenario) has the same stateHash, summary, series
//   compare <oldDir> <newDir> <spec>              exit 0 if every old record of the matrix equals its new one apart from `git`,
//                                                 3 if any differs or is missing, 4 if there are no old records of the matrix
//   old-git <dir> <spec>                          the commit label of the old records of the matrix (one sha, or "mixed-<sha>")
//   extras <dir> <spec>                           list records in <dir> (top level) outside the matrix; exit 7 if there are any
//   top-git <dir> <git>                           every record in <dir> (top level) carries <git>; exit 8 if not
//   split <RESULTS.md> <generatedOut> <notesOut> [--require-notes]
//                                                 split at the rule line before "## Notes"; with --require-notes, exit 6 if the
//                                                 file exists and is non-empty but has no notes section (never lose notes silently)
//   review <oldGenerated> <newGenerated> <notes>  print what in the notes may need a manual update; exit 5 if anything does
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, paramsHash } from '../../src/cli/run';
import { makeParams } from '../../src/contracts';
import type { RunRecord } from '../../src/contracts';

const ARMS = ['static', 'encore'] as const;
const RECORD = /^(S\d)_n(\d+)_(static|encore)_s(\d+)\.json$/;

interface Spec { n0: number; scenarios: string[]; seeds: number[] }

function fail(msg: string, code = 1): never {
  console.error(`FREEZE: ${msg}`);
  process.exit(code);
}

function parseSpec(text: string | undefined): Spec {
  const m = /^(\d+):([A-Z0-9,]+):(\d+)-(\d+)$/.exec(text ?? '');
  if (!m) fail(`bad matrix spec '${text ?? ''}' (want n0:S0,S1:1-5)`);
  const lo = Number(m[3]);
  const hi = Number(m[4]);
  return { n0: Number(m[1]), scenarios: (m[2] as string).split(','), seeds: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) };
}
const fileName = (n0: number, s: string, arm: string, seed: number) => `${s}_n${n0}_${arm}_s${seed}.json`;
const expected = (sp: Spec) => sp.scenarios.flatMap((s) => ARMS.flatMap((a) => sp.seeds.map((k) => fileName(sp.n0, s, a, k))));
const load = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunRecord;
const recordFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => RECORD.test(f)).sort() : []);
/** What must be equal between two runs of the same code: everything but the commit stamp. */
const body = (r: RunRecord) => JSON.stringify({ ...r, git: undefined });

// The rule line that opens the hand-written notes: ---, *** or ___ (3 or more), then within 4 lines a "## Notes" heading.
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const NOTES_HEADING = /^#{2,3}\s+notes\b/i;
function notesStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!RULE.test(lines[i] ?? '')) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (NOTES_HEADING.test(lines[j] ?? '')) return i;
      if ((lines[j] ?? '').trim() !== '') break;
    }
  }
  return -1;
}
/** Every commit named in a generated table's "Records: N. git: `a`, `b`. paramsHash: ..." line. */
function gitsOf(generated: string): string[] {
  const line = generated.split('\n').find((l) => l.startsWith('Records:')) ?? '';
  const part = line.split('paramsHash:')[0] ?? '';
  return [...part.matchAll(/`([0-9a-f]{7,40}(?:-dirty)?)`/g)].map((m) => m[1] as string);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'params-hash':
    console.log(paramsHash(makeParams(Number(args[0]))));
    break;

  case 'params-md': {
    const [n0Text, git, out] = args as [string, string, string];
    const n0 = Number(n0Text);
    const params = makeParams(n0);
    const json = canonicalJson(params);
    writeFileSync(out, `# Frozen evaluation parameters (n0 = ${n0})

Written by \`scripts/eval/freeze-run.sh\` at commit \`${git}\`. Every RunRecord in this directory carries \`paramsHash\` = the sha256 below.

- Source: \`makeParams(${n0})\` from \`src/contracts/params.ts\` (claimGap = max(2, ceil(0.03 · n0)) = ${params.claimGap}).
- \`paramsHash\` = sha256 of the canonical JSON (keys sorted at every level, no whitespace), as computed by \`paramsHash()\` in \`src/cli/run.ts\`.

\`\`\`text
paramsHash: ${paramsHash(params)}
\`\`\`

\`\`\`json
${JSON.stringify(JSON.parse(json), null, 2)}
\`\`\`
`);
    console.log(`params-md: ${out} (n0 ${n0}, ${paramsHash(params).slice(0, 12)})`);
    break;
  }

  case 'check': {
    const [dir, git, hash, specText] = args as [string, string, string, string];
    const sp = parseSpec(specText);
    const have = new Set(recordFiles(dir));
    const missing = expected(sp).filter((f) => !have.has(f));
    if (missing.length) fail(`${missing.length} records missing in ${dir}: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}`);
    const bad: string[] = [];
    for (const f of expected(sp)) {
      const r = load(dir, f);
      if (r.git !== git) bad.push(`${f}: git ${r.git}`);
      if (r.paramsHash !== hash) bad.push(`${f}: paramsHash ${r.paramsHash}`);
      if (r.n0 !== sp.n0 || r.v !== 1) bad.push(`${f}: n0 ${r.n0} v ${r.v}`);
    }
    if (bad.length) fail(`records do not carry git ${git} and paramsHash ${hash}:\n  ${bad.slice(0, 20).join('\n  ')}`);
    console.log(`check: ${expected(sp).length} records (n0 ${sp.n0}), all git ${git.slice(0, 12)}, all paramsHash ${hash.slice(0, 12)}`);
    break;
  }

  case 'replay': {
    const [matrix, replay, specText, seedText] = args as [string, string, string, string];
    const sp = parseSpec(specText);
    const seed = Number(seedText);
    let ok = true;
    for (const s of sp.scenarios) {
      const f = fileName(sp.n0, s, 'encore', seed);
      const a = load(matrix, f);
      const b = load(replay, f);
      const same = a.stateHash === b.stateHash && JSON.stringify(a.summary) === JSON.stringify(b.summary) && JSON.stringify(a.series) === JSON.stringify(b.series);
      ok &&= same;
      console.log(`${s} encore seed ${seed}: ${same ? 'EQUAL' : 'DIFFERENT'} (${a.stateHash} / ${b.stateHash})`);
    }
    if (!ok) fail('replay differs: the run is not reproducible');
    break;
  }

  case 'compare': {
    const [oldDir, newDir, specText] = args as [string, string, string];
    const sp = parseSpec(specText);
    const want = expected(sp);
    const old = recordFiles(oldDir).filter((f) => want.includes(f));
    if (old.length === 0) { console.log(`compare: no previous records of the n0 ${sp.n0} matrix in ${oldDir}`); process.exit(4); }
    const gits = [...new Set(old.map((f) => load(oldDir, f).git))];
    const differ: string[] = [];
    let summariesSame = 0;
    for (const f of want) {
      if (!old.includes(f)) { differ.push(`${f}: no previous record`); continue; }
      const a = load(oldDir, f);
      const b = load(newDir, f);
      if (JSON.stringify(a.summary) === JSON.stringify(b.summary)) summariesSame++;
      if (body(a) !== body(b)) differ.push(`${f}: stateHash ${a.stateHash} -> ${b.stateHash}${JSON.stringify(a.summary) === JSON.stringify(b.summary) ? ' (summary identical)' : ' (SUMMARY DIFFERS)'}`);
    }
    console.log(`compare: previous records from git ${gits.join(', ')}; ${want.length - differ.length} of ${want.length} identical apart from git; summaries identical in ${summariesSame} of ${old.length}`);
    if (differ.length) { console.log(`  differ (${differ.length}):\n  ${differ.join('\n  ')}`); process.exit(3); }
    break;
  }

  case 'old-git': {
    const [dir, specText] = args as [string, string];
    const want = expected(parseSpec(specText));
    const gits = [...new Set(recordFiles(dir).filter((f) => want.includes(f)).map((f) => load(dir, f).git))].sort();
    if (gits.length === 0) fail(`no previous records in ${dir}`);
    console.log(gits.length === 1 ? (gits[0] as string).slice(0, 7) : `mixed-${(gits[0] as string).slice(0, 7)}`);
    break;
  }

  case 'extras': {
    const [dir, specText] = args as [string, string];
    const want = expected(parseSpec(specText));
    const extra = recordFiles(dir).filter((f) => !want.includes(f));
    if (extra.length) {
      console.log(`extras: ${extra.length} records in ${dir} outside the minimum matrix: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ', …' : ''}`);
      process.exit(7);
    }
    console.log(`extras: none in ${dir}`);
    break;
  }

  case 'top-git': {
    const [dir, git] = args as [string, string];
    const bad = recordFiles(dir).filter((f) => load(dir, f).git !== git);
    if (bad.length) {
      console.error(`FREEZE: ${bad.length} records in ${dir} do not carry git ${git}: ${bad.slice(0, 10).join(', ')}`);
      process.exit(8);
    }
    console.log(`top-git: all ${recordFiles(dir).length} records in ${dir} carry git ${git.slice(0, 12)}`);
    break;
  }

  case 'split': {
    const [path, genOut, notesOut] = args as [string, string, string];
    const requireNotes = args.includes('--require-notes');
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const lines = text.split('\n');
    const at = notesStart(lines);
    if (at < 0 && requireNotes && text.trim() !== '') {
      fail(`${path} has content but no notes section (a ---, *** or ___ rule followed by a '## Notes' heading).\n` +
        `  Refusing to continue: the hand-written notes would be lost. Restore the marker, or move the notes, and run again.`, 6);
    }
    const gen = at < 0 ? lines : lines.slice(0, at);
    const notes = at < 0 ? [] : lines.slice(at);
    while (gen.length && gen[gen.length - 1] === '') gen.pop();
    writeFileSync(genOut, gen.length && text.trim() !== '' ? `${gen.join('\n')}\n` : '');
    writeFileSync(notesOut, notes.join('\n'));
    console.log(`split: ${path}: generated ${text.trim() ? gen.length : 0} lines, notes ${notes.length} lines${at < 0 ? ' (no notes section)' : ''}`);
    break;
  }

  case 'review': {
    const [oldGenPath, newGenPath, notesPath] = args as [string, string, string];
    const oldGen = readFileSync(oldGenPath, 'utf8');
    const newGen = readFileSync(newGenPath, 'utf8');
    const notes = readFileSync(notesPath, 'utf8').split('\n');
    const flags: string[] = [];
    // Every commit the old tables name and the new ones do not: notes lines naming any of them describe the old run.
    const newGits = new Set(gitsOf(newGen));
    const gone = gitsOf(oldGen).filter((g) => !newGits.has(g));
    if (newGits.size > 1) flags.push(`the new tables name more than one commit (${[...newGits].join(', ')}): the records are not one frozen revision`);
    for (const g of gone) {
      notes.forEach((l, i) => { if (l.includes(g) || l.includes(g.slice(0, 7))) flags.push(`notes line ${i + 1} names the previous commit ${g.slice(0, 7)}: ${l.trim().slice(0, 160)}`); });
    }
    notes.forEach((l, i) => { if (/wall-clock|load average/i.test(l)) flags.push(`notes line ${i + 1} quotes run timing or load (always run-specific): ${l.trim().slice(0, 160)}`); });
    // Numbers the notes quote that were in the old generated tables but are gone from the new ones.
    const nums = (s: string) => new Set(s.match(/-?\d+\.\d+/g) ?? []);
    const oldNums = nums(oldGen);
    const newNums = nums(newGen);
    notes.forEach((l, i) => {
      const lost = [...nums(l)].filter((n) => oldNums.has(n) && !newNums.has(n));
      if (lost.length) flags.push(`notes line ${i + 1} quotes ${lost.join(', ')}, which the new tables no longer contain: ${l.trim().slice(0, 160)}`);
    });
    const strip = (s: string) => s.split('\n').filter((l) => !l.startsWith('Records:')).join('\n');
    console.log(`review: generated tables ${strip(oldGen) === strip(newGen) ? 'IDENTICAL apart from the Records/git line' : 'CHANGED'}; old commits ${gitsOf(oldGen).map((g) => g.slice(0, 7)).join(', ') || 'none'}, new ${[...newGits].map((g) => g.slice(0, 7)).join(', ')}`);
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
