// TIG-06 offline part: GET /api/runs and GET /api/runs/:runId/metrics over the TigerReader seam, fed with the 50
// genuine committed records from results/ (read-only). Responses are checked against rowsToRecord of the stored rows
// and against the source records. Everything here is an OFFLINE FIXTURE: provenance.source is 'fixture', never 'tiger'.
import '../no-network.mjs'; // the network tripwire, FIRST: it must be in force before any module captures fetch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { RunRecord } from '../../../../src/contracts/index.ts';
import { computeIdentity, recordToRows, rowsToRecord, scenarioCompositionId, type RunRows } from '../../../../src/telemetry/index.ts';
import { buildGateway } from '../../src/router.ts';
import type { ModuleEntry } from '../../src/modules.ts';
import type { StoredRunRow, TigerReader, VerificationRow } from '../../src/tiger/repository.ts';
import { createModule, createTigerModule, OFFLINE_FIXTURE_ENV } from '../../src/tiger/module.ts';
import { readSourceFrom, type RunReadSource } from '../../src/tiger/services/source.ts';
import { listRuns, parseListQuery } from '../../src/tiger/services/runs.ts';
import { createFakeRepository } from '../../src/tiger/fakeRepository.ts';
import { importFiles, operatorDt, type ArtifactFile } from '../../src/tiger/importer.ts';
import type { ImportManifestV1 } from '../../../../src/telemetry/index.ts';
import { TigerConfigError } from '../../src/tiger/config.ts';

assert.equal(fetch.name, 'guardedFetch', 'the network tripwire (test/no-network.mjs) is not in force');

const RESULTS = new URL('../../../../results/', import.meta.url);
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const uuidOf = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

interface Fixture { record: RunRecord; rows: RunRows; stored: StoredRunRow }

/** The 50 committed records, normalised to rows exactly as the importer does (identity, recordToRows). */
function loadFixtures(): Fixture[] {
  const files = readdirSync(RESULTS).filter(f => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(f)).sort();
  return files.map((file) => {
    const bytes = readFileSync(new URL(file, RESULTS));
    const record = JSON.parse(bytes.toString('utf8')) as RunRecord;
    const id = computeIdentity(record, new Uint8Array(bytes), scenarioCompositionId(record), sha256);
    const runId = uuidOf(id.artifactHash);
    const rows = recordToRows(record, id, runId);
    const stored: StoredRunRow = {
      ...rows.run, manifest_version: 1, validator_version: 'test', importer_version: 'test', source_kind: 'cli-scenario',
      artifact_path: `results/${file}`, file_bytes: bytes.length, file_sha256: id.fileSha256, dt_seconds: 0.05,
      telemetry_state: 'present', imported_at: '2026-11-15T09:00:00.000Z',
    };
    return { record, rows, stored };
  });
}
const FIXTURES = loadFixtures();

/** A minimal in-memory TigerReader over the fixtures (the TIG-04 fake repository will replace it). */
function reader(fixtures: Fixture[], over: { archived?: string[]; verifications?: Record<string, VerificationRow['outcome']> } = {}): TigerReader {
  const byId = new Map(fixtures.map(f => [f.stored.run_id, f]));
  const state = (f: Fixture): StoredRunRow => ({ ...f.stored, telemetry_state: over.archived?.includes(f.stored.run_id) ? 'archived' : 'present' });
  return {
    async listRuns({ limit, after }) {
      const ids = [...byId.keys()].sort().filter(id => after == null || id > after);
      const page = ids.slice(0, limit);
      return { runs: page.map(id => state(byId.get(id)!)), next: ids.length > page.length ? page[page.length - 1]! : null };
    },
    async readBack(runId) { const f = byId.get(runId); return f ? { run: state(f), rows: structuredClone(f.rows) } : null; },
    async verifications(runId) {
      const outcome = over.verifications?.[runId];
      return outcome ? [{ verificationId: 1, runId, verifiedAt: 'x', verifierVersion: 't', digests: { seriesDigest: '', eventsDigest: '', summaryDigest: '' }, outcome }] : [];
    },
    async conflicts() { return []; },
  };
}

function gatewayWith(source: RunReadSource | null, env: Record<string, string> = { [OFFLINE_FIXTURE_ENV]: '1' }) {
  const entry: ModuleEntry = { name: 'tiger', envPrefix: 'TIGER_', create: e => createTigerModule(e, { fixtureSource: () => source }) };
  return buildGateway(env, [entry]);
}
const get = async (g: ReturnType<typeof gatewayWith>, url: string) => g.handle({ method: 'GET', url, rawBody: '' });
const body = (r: { body: unknown }) => r.body as any;   // eslint-disable-line @typescript-eslint/no-explicit-any

test('disabled by default: both routes registered, 503 MODULE_DISABLED, health { enabled: false, db: "disabled" }', async () => {
  const module = createModule({});
  assert.deepEqual(module.routes.map(r => [r.method, r.path]), [['GET', '/api/runs'], ['GET', '/api/runs/:runId/metrics']]);
  assert.deepEqual(module.health(), { enabled: false, db: 'disabled' });
  for (const url of ['/api/runs', `/api/runs/${FIXTURES[0]!.stored.run_id}/metrics`]) {
    const r = await gatewayWith(null, {}).handle({ method: 'GET', url: `${url}?requestId=req-7`, rawBody: '' });
    assert.equal(r.status, 503);
    assert.deepEqual(body(r).error.details, [{ path: '', reason: 'MODULE_DISABLED' }]);
    assert.equal(body(r).error.requestId, 'req-7');
  }
  // The fixture flag without a supplied source changes nothing; another flag value is refused (contained).
  assert.deepEqual(createModule({ [OFFLINE_FIXTURE_ENV]: '1' }).health(), { enabled: false, db: 'disabled' });
  assert.throws(() => createModule({ [OFFLINE_FIXTURE_ENV]: 'true' }), TigerConfigError);
  // A source that is not labelled fixture is refused: fixture data can never pose as Tiger.
  assert.throws(() => createTigerModule({ [OFFLINE_FIXTURE_ENV]: '1' }, { fixtureSource: () => readSourceFrom(reader(FIXTURES), 'tiger') }), TigerConfigError);
});

test('fixture: health and every run say source "fixture", verified false; never "tiger"', async () => {
  const g = gatewayWith(readSourceFrom(reader(FIXTURES), 'fixture'));
  assert.deepEqual(g.health().modules.tiger, { enabled: true, db: 'disabled', source: 'fixture' });
  const list = await get(g, '/api/runs?limit=200');
  assert.equal(list.status, 200);
  assert.equal(body(list).items.length, 50);
  for (const item of body(list).items) {
    assert.deepEqual(item.provenance.source, 'fixture');
    assert.equal(item.provenance.verified, false);
    assert.equal(item.provenance.verification, null);
  }
  const metrics = await get(g, `/api/runs/${FIXTURES[0]!.stored.run_id}/metrics`);
  for (const text of [JSON.stringify(body(list)), JSON.stringify(body(metrics))]) assert.ok(!text.includes('"source":"tiger"'));
});

test('GET /api/runs: RunMeta from the stored rows, Q17 order, stable cursor pages, filters', async () => {
  const g = gatewayWith(readSourceFrom(reader(FIXTURES), 'fixture'));
  const all = body(await get(g, '/api/runs?limit=200')).items;
  const order = (m: any) => [m.scenario, m.n0, m.seed, m.arm, m.runId];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const sorted = [...all].sort((a, b) => (JSON.stringify(order(a)) < JSON.stringify(order(b)) ? -1 : 1));
  assert.deepEqual(all.map((m: any) => m.runId), sorted.map((m: any) => m.runId));   // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const m of all) {
    const f = FIXTURES.find(x => x.stored.run_id === m.runId)!;
    assert.deepEqual([m.scenario, m.arm, m.seed, m.n0, m.git, m.paramsHash, m.stateHash], [f.record.scenario, f.record.arm, f.record.seed, f.record.n0, f.record.git, f.record.paramsHash, f.record.stateHash]);
    assert.equal(m.expectedSamples, 360);
    assert.equal(m.dtSeconds, 0.05);
    assert.equal(m.telemetryState, 'present');
    assert.equal(m.provenance.artifactHash, f.stored.artifact_hash);
  }
  // Paging: 50 runs in pages of 7 concatenate to the full list; the last page has no cursor.
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 20; pages++) {
    const r: any = body(await get(g, `/api/runs?limit=7${cursor ? `&cursor=${cursor}` : ''}`));   // eslint-disable-line @typescript-eslint/no-explicit-any
    seen.push(...r.items.map((m: any) => m.runId));   // eslint-disable-line @typescript-eslint/no-explicit-any
    cursor = r.nextCursor;
    if (cursor === null) break;
  }
  assert.deepEqual(seen, all.map((m: any) => m.runId));   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(body(await get(g, '/api/runs?scenario=S2')).items.length, 10);
  assert.equal(body(await get(g, '/api/runs?scenario=S2&arm=static&seed=3')).items.length, 1);
  assert.equal(body(await get(g, '/api/runs?seed=4294967295')).items.length, 0);   // max uint32 is valid
  assert.equal(body(await get(g, '/api/runs?telemetry=archived')).items.length, 0);
});

test('GET /api/runs: validation refusals use the XI-3 envelope with the RFC reasons', async () => {
  const g = gatewayWith(readSourceFrom(reader(FIXTURES), 'fixture'));
  const cases: [string, string, string][] = [
    ['/api/runs?bogus=1', 'INVALID_QUERY', 'bogus'],
    ['/api/runs?seed=4294967296', 'INVALID_QUERY', 'seed'],
    ['/api/runs?seed=-1', 'INVALID_QUERY', 'seed'],
    ["/api/runs?scenario=S1'%3B%20DROP%20TABLE%20experiment_runs%3B--", 'INVALID_QUERY', 'scenario'],
    ['/api/runs?limit=201', 'INVALID_QUERY', 'limit'],
    ['/api/runs?limit=0', 'INVALID_QUERY', 'limit'],
    ['/api/runs?arm=both', 'INVALID_QUERY', 'arm'],
    ['/api/runs?git=abc', 'INVALID_QUERY', 'git'],
    ['/api/runs?cursor=not!base64', 'INVALID_CURSOR', 'cursor'],
    [`/api/runs?cursor=${Buffer.from('[1,2]').toString('base64url')}`, 'INVALID_CURSOR', 'cursor'],
  ];
  for (const [url, reason, path] of cases) {
    const r = await get(g, `${url}&requestId=ok.1`);
    assert.equal(r.status, 400, url);
    assert.equal(body(r).error.code, 'VALIDATION_FAILED', url);
    assert.deepEqual(body(r).error.details, [{ path, reason }], url);
    assert.equal(body(r).error.requestId, 'ok.1', url);
  }
  // An invalid requestId is dropped, never echoed, and the request proceeds.
  const r = await get(g, '/api/runs?bogus=1&requestId=bad%20id');
  assert.equal(body(r).error.requestId, undefined);
});

test('GET /api/runs/:runId/metrics: every one of the 50 runs equals rowsToRecord of its stored rows, and its source record', async () => {
  const g = gatewayWith(readSourceFrom(reader(FIXTURES), 'fixture'));
  for (const f of FIXTURES) {
    const r = await get(g, `/api/runs/${f.stored.run_id}/metrics`);
    assert.equal(r.status, 200);
    const m = body(r);
    const back = rowsToRecord(f.rows);
    assert.deepEqual(back, f.record);   // the round trip the route relies on (E1)
    assert.equal(m.samples.length, back.series.length);
    m.samples.forEach((s: any, i: number) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const x = back.series[i]!;
      assert.deepEqual(
        [s.tick, s.alive, s.coverage, s.pwc, s.npwc, s.sfMean, s.sfMax, s.dupSlots, s.versions],
        [x.tick, x.alive, x.coverage, x.pwc, x.npwc, x.sfMean, x.sfMax, x.dupSlots, x.versions]);
      assert.deepEqual(s.totals, { ...x.msgs, collisions: x.collisions, nearMisses: x.nearMisses, slotChanges: x.slotChanges });
      assert.equal(s.simSeconds, x.tick * 0.05);
    });
    // Deltas add up to the final totals; the first interval starts at the run start.
    const sum = (k: string) => m.samples.reduce((a: number, s: any) => a + s.deltas[k], 0);   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(sum('collisions'), back.series.at(-1)!.collisions);
    assert.equal(m.samples[0].sinceRunStart, true);
    assert.equal(m.counters.check, 'ok');
    assert.deepEqual(m.completeness, { expected: 360, present: 360, missingTicks: [], offScheduleTicks: [] });
    assert.deepEqual(m.events.map((e: any) => e.details), back.events);   // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const [k, v] of Object.entries(back.summary)) assert.deepEqual(m.summary.cells[k], { present: true, value: v });
    const tRec = back.summary.tRec;
    if (!('tRec' in back.summary)) assert.deepEqual(m.summary.recovery, { state: 'not-applicable' });
    else if (tRec === null) assert.equal(m.summary.recovery.state, 'censored');
    else assert.equal(m.summary.recovery.tRec, tRec);
    assert.deepEqual(m.summary.integrity, [], `${f.stored.artifact_path}: ${m.summary.integrity.join(', ')}`);
    assert.equal(m.timeAxis.authoritative, 'tick');
  }
});

test('GET /api/runs/:runId/metrics: paging, 404, 400 INVALID_ID, archived runs', async () => {
  const f = FIXTURES.find(x => x.record.scenario === 'S2' && x.record.arm === 'encore')!;
  const g = gatewayWith(readSourceFrom(reader(FIXTURES, { archived: [FIXTURES[1]!.stored.run_id] }), 'fixture'));
  const ticks: number[] = [];
  let after = -1;
  for (let pages = 0; pages < 10; pages++) {
    const m = body(await get(g, `/api/runs/${f.stored.run_id}/metrics?afterTick=${after}&limit=100`));
    ticks.push(...m.samples.map((s: any) => s.tick));   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (m.page.nextAfterTick === null) break;
    after = m.page.nextAfterTick;
  }
  assert.deepEqual(ticks, f.record.series.map(x => x.tick));
  assert.equal(body(await get(g, `/api/runs/${f.stored.run_id}/metrics?toTick=50`)).samples.length, 10);
  const missing = await get(g, '/api/runs/00000000-0000-5000-8000-000000000000/metrics');
  assert.equal(missing.status, 404);
  assert.deepEqual(body(missing).error.details, [{ path: 'runId', reason: 'RUN_NOT_FOUND' }]);
  for (const id of ['not-a-uuid', 'ABCDEF00-0000-5000-8000-000000000000', '1%27%20OR%201%3D1']) {
    const r = await get(g, `/api/runs/${id}/metrics`);
    assert.equal(r.status, 400, id);
    assert.deepEqual(body(r).error.details, [{ path: 'runId', reason: 'INVALID_ID' }], id);
  }
  assert.deepEqual(body(await get(g, `/api/runs/${f.stored.run_id}/metrics?limit=2001`)).error.details, [{ path: 'limit', reason: 'INVALID_QUERY' }]);
  // Archived: 200 with samples [], events and summary kept; the list hides it by default.
  const archived = body(await get(g, `/api/runs/${FIXTURES[1]!.stored.run_id}/metrics`));
  assert.equal(archived.run.telemetryState, 'archived');
  assert.deepEqual(archived.samples, []);
  assert.ok(Object.keys(archived.summary.cells).length > 0);
  assert.equal(body(await get(g, '/api/runs?limit=200')).items.length, 49);
  assert.equal(body(await get(g, '/api/runs?telemetry=archived')).items.length, 1);
});

test('fed by the TIG-04 importer: results/ -> importFiles -> fake repository -> routes give back every record exactly', async () => {
  const repo = createFakeRepository(() => '2026-11-15T09:00:00.000Z');
  const manifests = new Map<string, ImportManifestV1>();
  let n = 0;
  const files: ArtifactFile[] = readdirSync(RESULTS).filter(f => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(f)).sort()
    .map(f => ({ path: `results/${f}`, bytes: new Uint8Array(readFileSync(new URL(f, RESULTS))) }));
  const commits = [...new Set(FIXTURES.map(f => f.record.git))];
  const report = await importFiles(files, {
    repo,
    manifests: { read: h => manifests.get(h) ?? null, write: m => { if (manifests.has(m.artifactHash)) throw new Error('exists'); manifests.set(m.artifactHash, m); } },
    ledger: { append: () => {} },
    sha256,
    sha1: (data: Uint8Array) => createHash('sha1').update(data).digest('hex'),
    now: () => '2026-11-15T09:00:00.000Z',
    attemptId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    dtFor: operatorDt(0.05, commits),
    schema: 'encore',
    importerVersion: 'routes-test',
  });
  assert.equal(report.imported, 50, JSON.stringify(report.results.filter(r => r.state !== 'verified').slice(0, 3)));
  const g = gatewayWith(readSourceFrom(repo, 'fixture'));
  const items = body(await get(g, '/api/runs?limit=200')).items;
  assert.equal(items.length, 50);
  for (const item of items) {
    assert.equal(item.provenance.source, 'fixture');
    const stored = await repo.readBack(item.runId);
    assert.ok(stored);
    const record = rowsToRecord(stored.rows);
    const original = FIXTURES.find(f => f.stored.artifact_hash === item.provenance.artifactHash)!.record;
    assert.deepEqual(record, original);
    const m = body(await get(g, `/api/runs/${item.runId}/metrics`));
    assert.deepEqual(m.samples.map((s: any) => s.tick), original.series.map(x => x.tick));   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(m.events.map((e: any) => e.details), original.events);   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(m.samples.at(-1).totals.collisions, original.summary.collisions);
  }
});

test('a Tiger-kind source maps verification as Q17 says (list: verified-at-import; metrics: verified / mismatch / not-checked)', async () => {
  const [a, b, c] = FIXTURES.map(f => f.stored.run_id);
  const tiger = readSourceFrom(reader(FIXTURES, { verifications: { [a!]: 'verified', [b!]: 'mismatch' } }), 'tiger');
  const list = await tiger.listRuns();
  const v = (id: string) => list.find(r => r.run.run_id === id)!.verification;
  assert.deepEqual([v(a!), v(b!), v(c!)], ['ok', 'mismatch', null]);
  const items = listRuns(list, parseListQuery({ limit: '200' }), 'tiger').items;
  const byId = (id: string) => items.find(m => m.runId === id)!.provenance;
  assert.deepEqual([byId(a!).verification, byId(a!).verified, byId(a!).source], ['verified-at-import', true, 'tiger']);
  assert.deepEqual([byId(b!).verification, byId(b!).verified], ['mismatch', false]);
  assert.deepEqual([byId(c!).verification, byId(c!).verified], ['not-checked', false]);
});
