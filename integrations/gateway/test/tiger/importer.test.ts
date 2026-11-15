// TIG-04 offline: the importer over the REAL committed RunRecords in results/ (read-only) into the in-memory fake
// repository. Acceptance (#261): idempotent re-import, censored and unrecovered runs preserved, a conflicting artifact
// recorded and never overwritten. Everything here is a dry run into a fake: nothing is "imported into Tiger".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHash, replayLedger, type ImportManifestV1, type LedgerLine } from '../../../../src/telemetry/index.ts';
import { createFakeRepository } from '../../src/tiger/fakeRepository.ts';
import {
  ENCORE_TIGER_NS_V1, importFiles, operatorDt, parseDt, uuidV5, type ArtifactFile, type ImporterDeps, type ManifestStore,
} from '../../src/tiger/importer.ts';
import { fileLedger } from '../../src/tiger/ledgerFile.ts';
import { fileManifestStore } from '../../src/tiger/manifestFile.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const RESULTS = join(REPO, 'results');
const sha256 = (d: string | Uint8Array) => createHash('sha256').update(d).digest('hex');
const sha1 = (d: Uint8Array) => createHash('sha1').update(d).digest('hex');
// DT at the record commits, checked by the operator: `git show <c>:src/contracts/params.ts` gives
// `export const DT = 0.05;` for both (and for this checkout).
const FREEZE = '0b2f8f3c7c57f1f3d34adf99a1748ab20baae973';
const OLD = '571c8e44f8e85a87807c15543b75f924e23b9413';
const DT = parseDt(readFileSync(join(REPO, 'src/contracts/params.ts'), 'utf8'));
const SETS = ['', 'full/n200', 'full/n100', 'superseded-571c8e4'];

function files(set: string): ArtifactFile[] {
  const dir = join(RESULTS, set);
  return readdirSync(dir).filter(n => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(n)).sort()
    .map(n => ({ path: ['results', set, n].filter(Boolean).join('/'), bytes: new Uint8Array(readFileSync(join(dir, n))) }));
}
const ALL = SETS.flatMap(files);
const TOP = files('');
const byName = (name: string) => TOP.find(f => f.path === `results/${name}`)!;
function changed(file: ArtifactFile, change: (r: Record<string, unknown>) => void, path = file.path): ArtifactFile {
  const value = JSON.parse(new TextDecoder().decode(file.bytes)) as Record<string, unknown>;
  change(value);
  return { path, bytes: new TextEncoder().encode(`${JSON.stringify(value)}\n`) };
}

function memoryManifests(): ManifestStore & { all: Map<string, ImportManifestV1> } {
  const all = new Map<string, ImportManifestV1>();
  return {
    all,
    read: hash => all.get(hash) ?? null,
    write: m => { if (all.has(m.artifactHash)) throw new Error('never overwritten'); all.set(m.artifactHash, structuredClone(m)); },
  };
}
function setup(over: Partial<ImporterDeps> = {}) {
  let attempts = 0;
  const lines: LedgerLine[] = [];
  const repo = createFakeRepository(() => '2026-11-15T09:30:00.000Z');
  const manifests = memoryManifests();
  const deps: ImporterDeps = {
    repo, manifests, ledger: { append: l => { lines.push(structuredClone(l)); } }, sha256, sha1,
    now: () => '2026-11-15T09:30:00.000Z',
    attemptId: () => `00000000-0000-4000-8000-${String(++attempts).padStart(12, '0')}`,
    dtFor: operatorDt(DT, [FREEZE, OLD]), schema: 'encore', importerVersion: 'importer-test', ...over,
  };
  return { deps, repo, manifests, lines };
}

test('RFC 4122 UUIDv5 vector, and a fixed namespace', () => {
  assert.equal(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com', sha1), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  assert.match(ENCORE_TIGER_NS_V1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(DT, 0.05);
});

test('imports all 420 real records, then a second pass is identical with zero new rows', { timeout: 180_000 }, async () => {
  // Expectations come from the records themselves: distinct artifacts by artifactHash, and their event counts.
  const distinct = new Map<string, number>();
  for (const f of ALL) {
    const record = JSON.parse(new TextDecoder().decode(f.bytes)) as { events: unknown[] };
    distinct.set(canonicalHash(sha256, record), record.events.length);
  }
  // The 50 top-level records are the same artifacts as full/n200 seeds 1–5 (one freeze), so they dedupe.
  for (const f of TOP) {
    const twin = ALL.find(g => g.path === f.path.replace('results/', 'results/full/n200/'))!;
    assert.equal(canonicalHash(sha256, JSON.parse(new TextDecoder().decode(f.bytes))), canonicalHash(sha256, JSON.parse(new TextDecoder().decode(twin.bytes))));
  }
  assert.equal(distinct.size, 370);
  const events = [...distinct.values()].reduce((a, b) => a + b, 0);

  const { deps, repo, manifests, lines } = setup();
  const first = await importFiles(ALL, deps);
  assert.deepEqual({ ...first, results: undefined }, { discovered: 420, imported: 370, identical: 50, rejected: 0, conflicts: 0, incomplete: 0, archived: 0, retryable: 0, results: undefined });
  assert.deepEqual(repo.counts(), { runs: 370, metrics: 370 * 360, events, summaries: 370, verifications: 420, conflicts: 0 });
  assert.equal(manifests.all.size, 370);

  const before = repo.counts();
  const second = await importFiles(ALL, deps);
  assert.equal(second.identical, 420);
  assert.equal(second.imported, 0);
  assert.deepEqual({ ...repo.counts(), verifications: before.verifications }, before);   // no data rows added
  assert.equal(repo.counts().verifications, 840);                                       // one Q13 row per re-verification
  // Identity is deterministic across attempts: the same run_id for every file, and the manifests were reused.
  assert.deepEqual(second.results.map(r => r.runId), first.results.map(r => r.runId));
  assert.equal(manifests.all.size, 370);
  assert.deepEqual(replayLedger(lines).anomalies, []);
  assert.equal(lines.filter(l => l.to === 'discovered').length, 840);
});

test('the 50 top-level records give 18,000 sample rows, 90 events and 50 summaries', async () => {
  const { deps, repo } = setup();
  await importFiles(TOP, deps);
  assert.deepEqual(repo.counts(), { runs: 50, metrics: 18_000, events: 90, summaries: 50, verifications: 50, conflicts: 0 });
});

test('censored, unrecovered and recovered runs are preserved through the repository', async () => {
  const { deps, repo } = setup();
  const report = await importFiles([byName('S0_n200_encore_s1.json'), byName('S1_n200_static_s1.json'), byName('S1_n200_encore_s1.json')], deps);
  const summary = async (i: number) => (await repo.readBack(report.results[i]!.runId!))!.rows.summary.summary_json;
  assert.equal(Object.hasOwn(await summary(0), 'tRec'), false);   // no KILL: not applicable
  assert.equal((await summary(1)).tRec, null);                    // censored
  assert.equal(typeof (await summary(2)).tRec, 'number');         // recovered
});

test('FX-RESER and FX-MOVED are identical: manifest reused, new file recorded on its discovered line', async () => {
  const { deps, repo, lines } = setup();
  const original = byName('S0_n200_encore_s1.json');
  await importFiles([original], deps);
  // FX-RESER: the same record re-serialised (different bytes and fileSha256); FX-MOVED: the same bytes elsewhere.
  const reser = { path: 'scratch/reser.json', bytes: new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(original.bytes)), null, 2)) };
  assert.notDeepEqual(reser.bytes, original.bytes);
  const moved = { path: 'elsewhere/moved/copy.json', bytes: original.bytes };
  const report = await importFiles([reser, moved], deps);
  assert.deepEqual(report.results.map(r => [r.state, r.inserted]), [['verified', false], ['verified', false]]);
  assert.equal(repo.counts().runs, 1);
  const discovered = lines.filter(l => l.to === 'discovered').map(l => l.file?.artifactPath);
  assert.deepEqual(discovered, ['results/S0_n200_encore_s1.json', 'scratch/reser.json', 'elsewhere/moved/copy.json']);
});

test('a conflicting artifact is recorded once and never overwrites the stored run', async () => {
  const { deps, repo } = setup();
  const original = byName('S2_n200_encore_s1.json');
  await importFiles([original], deps);
  const before = await repo.readBack((await repo.listRuns({ limit: 1 })).runs[0]!.run_id);
  const conflict = changed(original, r => { const s = r.summary as Record<string, number>; s.npwcEnd = (s.npwcEnd ?? 0) + 1e-12; }, 'scratch/conflict.json');
  const report = await importFiles([conflict, conflict], deps);
  assert.deepEqual(report.results.map(r => r.state), ['conflict', 'conflict']);
  assert.equal(report.conflicts, 2);
  assert.equal((await repo.conflicts()).length, 1);
  assert.equal(repo.counts().runs, 1);
  assert.deepEqual(await repo.readBack(before!.run.run_id), before);
});

test('dirty duplicates are conflict-exempt; unknown git gets DT_ASSUMED', async () => {
  const { deps, repo, lines } = setup();
  const base = byName('S2_n200_encore_s1.json');
  const dirty = (bump: number, path: string) => changed(base, r => { r.git = `${String(r.git)}-dirty`; const s = r.summary as Record<string, number>; s.npwcEnd = (s.npwcEnd ?? 0) + bump; }, path);
  const unknown = changed(base, r => { r.git = 'unknown'; }, 'scratch/unknown.json');
  const report = await importFiles([dirty(1e-12, 'scratch/d1.json'), dirty(2e-12, 'scratch/d2.json'), unknown], deps);
  assert.deepEqual(report.results.map(r => r.state), ['verified', 'verified', 'verified']);
  assert.equal(repo.counts().runs, 3);
  assert.equal(lines.find(l => l.to === 'validated' && l.code === 'DT_ASSUMED')?.attemptId, lines.filter(l => l.to === 'discovered')[2]?.attemptId);
});

test('an archived run is reported ARCHIVED, never restored and never VERIFY_MISMATCH', async () => {
  const { deps, repo } = setup();
  const file = byName('S3_n200_static_s1.json');
  const [first] = (await importFiles([file], deps)).results;
  repo.owner.archive(first!.runId!);
  const again = (await importFiles([file], deps)).results[0]!;
  assert.deepEqual([again.state, again.code], ['archived', 'ARCHIVED']);
  assert.equal((await repo.readBack(first!.runId!))!.rows.metrics.length, 0);
});

test('T11: a fault after 200 metric rows or a failed check leaves zero rows and stays validated; a retry succeeds', async () => {
  const { deps, repo } = setup();
  const file = byName('S1_n200_encore_s2.json');
  repo.inject({ failAfterMetricRows: 200 });
  const faulted = (await importFiles([file], deps)).results[0]!;
  assert.deepEqual([faulted.state, faulted.code], ['validated', 'ROLLED_BACK']);
  assert.equal(await repo.readBack(faulted.runId!), null);
  repo.inject({ failCheck: true });
  assert.deepEqual((await importFiles([file], deps)).results.map(r => [r.state, r.code]), [['validated', 'CHECK_FAILED']]);
  assert.equal(repo.counts().runs, 0);
  assert.deepEqual((await importFiles([file], deps)).results.map(r => [r.state, r.inserted]), [['verified', true]]);
});

test('T11: a lost COMMIT acknowledgement is incomplete, then reconciled to verified by the next attempt', async () => {
  const { deps, repo, lines } = setup();
  const file = byName('S5_n200_encore_s1.json');
  repo.inject({ loseCommitAck: true });
  assert.deepEqual((await importFiles([file], deps)).results.map(r => [r.state, r.code]), [['incomplete', 'COMMIT_UNKNOWN']]);
  assert.deepEqual((await importFiles([file], deps)).results.map(r => [r.state, r.inserted]), [['verified', false]]);
  assert.equal(repo.counts().runs, 1);
  assert.deepEqual(replayLedger(lines).anomalies, []);
});

test('rejections: DEV_SEED in encore only, DT_UNVERIFIABLE, MANIFEST_MISMATCH, invalid files and bad paths', async () => {
  const dev = changed(byName('S2_n200_encore_s1.json'), r => { r.seed = 101; }, 'scratch/dev.json');
  assert.deepEqual((await importFiles([dev], setup().deps)).results.map(r => r.code), ['DEV_SEED']);
  assert.deepEqual((await importFiles([dev], setup({ schema: 'tig_test_0123456789ab' }).deps)).results.map(r => r.state), ['verified']);

  const unvouched = setup({ dtFor: operatorDt(DT, [OLD]) });
  assert.deepEqual((await importFiles([byName('S0_n200_static_s1.json')], unvouched.deps)).results.map(r => r.code), ['DT_UNVERIFIABLE']);
  assert.equal(unvouched.repo.counts().runs, 0);
  assert.deepEqual((await importFiles([byName('S0_n200_static_s1.json')], setup({ dtFor: operatorDt(null, []) }).deps)).results.map(r => r.code), ['DT_UNVERIFIABLE']);

  const s = setup();
  const file = byName('S3_n200_encore_s2.json');
  await importFiles([file], s.deps);
  const [stored] = [...s.manifests.all.values()];
  s.manifests.all.set(stored!.artifactHash, { ...stored!, dtSeconds: 0.1 });
  assert.deepEqual((await importFiles([file], s.deps)).results.map(r => r.code), ['MANIFEST_MISMATCH']);

  const bad = { path: 'scratch/bad.json', bytes: new TextEncoder().encode('{"v":2}') };
  const hostile = { path: '../../etc/x.json', bytes: byName('S0_n200_encore_s1.json').bytes };
  assert.deepEqual((await importFiles([bad, hostile], setup().deps)).results.map(r => [r.state, r.code]), [['rejected', 'SCHEMA_VERSION_UNSUPPORTED'], ['rejected', 'BAD_PATH']]);
});

test('file stores: atomic, never-overwritten manifests and an fsynced append-only ledger, outside results/', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tig-261-'));
  try {
    const ledger = fileLedger(join(dir, 'imports.ndjson'));
    const s = setup({ manifests: fileManifestStore(dir), ledger });
    await importFiles([byName('S0_n200_encore_s1.json'), byName('S1_n200_static_s1.json')], s.deps);
    const first = readFileSync(ledger.path, 'utf8');
    await importFiles([byName('S0_n200_encore_s1.json')], s.deps);
    assert.ok(readFileSync(ledger.path, 'utf8').startsWith(first));   // append-only: earlier bytes unchanged
    const parsed = ledger.read();
    assert.deepEqual(parsed.skipped, []);
    assert.deepEqual(replayLedger(parsed.lines).anomalies, []);
    assert.equal(readdirSync(join(dir, 'manifests')).length, 2);
    const store = fileManifestStore(dir);
    const one = store.read(parsed.lines.find(l => l.artifactHash)!.artifactHash!);
    assert.ok(one);
    assert.throws(() => store.write(one));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the dry-run CLI imports the real results/ twice into the fake repository and says so', () => {
  const state = mkdtempSync(join(tmpdir(), 'tig-261-cli-'));
  try {
    const out = execFileSync(process.execPath, [
      '--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--import', './integrations/gateway/loader/register.mjs',
      'integrations/gateway/src/tiger/cli/import.ts', '--dir', 'results', '--state-dir', state,
      '--dt-file', 'src/contracts/params.ts', '--dt-commits', `${FREEZE},${OLD}`, '--passes', '2',
    ], { cwd: REPO, encoding: 'utf8' });
    const [banner, ...passes] = out.trim().split('\n');
    assert.match(banner ?? '', /^FAKE IN-MEMORY REPOSITORY \(dry run\): nothing is sent to Tiger\. 50 files from results/);
    const [one, two] = passes.map(p => JSON.parse(p) as { imported: number; identical: number; rejected: number; rows: { metrics: number } });
    assert.deepEqual([one?.imported, one?.rejected, one?.rows.metrics], [50, 0, 18_000]);
    assert.deepEqual([two?.identical, two?.imported, two?.rows.metrics], [50, 0, 18_000]);
    assert.throws(() => execFileSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--import', './integrations/gateway/loader/register.mjs',
      'integrations/gateway/src/tiger/cli/import.ts', '--dir', 'results', '--state-dir', 'results/state'], { cwd: REPO, stdio: 'pipe' }));
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
