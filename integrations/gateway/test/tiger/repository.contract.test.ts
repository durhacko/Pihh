// The TigerRepository contract (TIG-04). `repositoryContract` is written against the interface only, so
// pgRepository (TIG-03 live, D3) can run the same suite later: `repositoryContract('pg', makePgRepository)`.
// Inputs are built from the REAL committed RunRecords in results/ (read-only) through src/telemetry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildManifest, canonicalHash, computeIdentity, recordToRows, rowsToRecord, validateRunRecord, VALIDATOR_VERSION,
  type ImportManifestV1, type RunRows,
} from '../../../../src/telemetry/index.ts';
import { runIdFor } from '../../src/tiger/importer.ts';
import type { ImportInput, TigerRepository } from '../../src/tiger/repository.ts';
import { createFakeRepository } from '../../src/tiger/fakeRepository.ts';

const RESULTS = new URL('../../../../results/', import.meta.url);
const sha256 = (d: string | Uint8Array) => createHash('sha256').update(d).digest('hex');
const sha1 = (d: Uint8Array) => createHash('sha1').update(d).digest('hex');

/** A real artifact as an ImportInput, optionally changed in memory first (never on disk). */
export function inputFor(name: string, change?: (record: Record<string, unknown>) => void, opts: { dt?: number; path?: string } = {}): ImportInput {
  let bytes = new Uint8Array(readFileSync(new URL(name, RESULTS)));
  if (change) {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    change(value);
    bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  }
  const result = validateRunRecord(bytes, { sourceKind: 'cli-scenario', expectedTicks: 1800 });
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors.slice(0, 2))}`);
  const id = computeIdentity(result.record, bytes, `scenario:${result.record.scenario}`, sha256);
  const runId = runIdFor(id.artifactHash, sha1);
  const manifest: ImportManifestV1 = buildManifest(id, {
    artifactPath: opts.path ?? `results/${name}`, runId, sourceKind: 'cli-scenario', validatorVersion: VALIDATOR_VERSION,
    fileForm: result.fileForm ?? 'other', dtSeconds: opts.dt ?? 0.05, createdAt: '2026-11-15T09:00:00.000Z',
  });
  return { rows: recordToRows(result.record, id, runId), manifest, importerVersion: 'contract-test' };
}
const recordOf = (rows: RunRows) => canonicalHash(sha256, rowsToRecord(rows));

export function repositoryContract(label: string, make: () => TigerRepository | Promise<TigerRepository>): void {
  test(`${label}: imports a real run and reads it back exactly, with the manifest's first-observation columns`, async () => {
    const repo = await make();
    const input = inputFor('S2_n200_encore_s1.json');
    assert.deepEqual(await repo.findIdentity(input.manifest.artifactHash, input.manifest.experimentKey), { byArtifact: null, byExperiment: null });
    assert.deepEqual(await repo.importRun(input), { kind: 'imported', runId: input.manifest.runId });
    const stored = await repo.readBack(input.manifest.runId);
    assert.ok(stored);
    assert.equal(recordOf(stored.rows), recordOf(input.rows));
    assert.equal(stored.rows.metrics.length, 360);
    assert.equal(stored.run.telemetry_state, 'present');
    assert.deepEqual(
      [stored.run.artifact_path, stored.run.file_sha256, stored.run.file_bytes, stored.run.dt_seconds, stored.run.source_kind],
      [input.manifest.artifactPath, input.manifest.fileSha256, input.manifest.fileBytes, 0.05, 'cli-scenario'],
    );
    assert.equal(await repo.readBack('00000000-0000-5000-8000-000000000000'), null);
  });

  test(`${label}: a second import of the same artifact is identical and adds no rows`, async () => {
    const repo = await make();
    const input = inputFor('S0_n200_encore_s1.json');
    await repo.importRun(input);
    const before = await repo.listRuns({ limit: 200 });
    assert.deepEqual(await repo.importRun(input), { kind: 'identical', runId: input.manifest.runId });
    assert.deepEqual(await repo.listRuns({ limit: 200 }), before);
    const hit = await repo.findIdentity(input.manifest.artifactHash, input.manifest.experimentKey);
    assert.deepEqual(hit.byArtifact, { runId: input.manifest.runId, experimentKey: input.manifest.experimentKey, telemetryState: 'present' });
  });

  test(`${label}: a clean same-experimentKey, different-artifact import is a conflict and changes nothing`, async () => {
    const repo = await make();
    const original = inputFor('S2_n200_encore_s1.json');
    const conflicting = inputFor('S2_n200_encore_s1.json', r => { const s = r.summary as Record<string, number>; s.npwcEnd = (s.npwcEnd ?? 0) + 1e-12; });
    assert.equal(conflicting.manifest.experimentKey, original.manifest.experimentKey);
    await repo.importRun(original);
    assert.deepEqual(await repo.findIdentity(conflicting.manifest.artifactHash, conflicting.manifest.experimentKey),
      { byArtifact: null, byExperiment: { runId: original.manifest.runId, artifactHash: original.manifest.artifactHash } });
    const outcome = await repo.importRun(conflicting);
    assert.deepEqual(outcome, { kind: 'conflict', experimentKey: original.manifest.experimentKey, existingRunId: original.manifest.runId, existingArtifactHash: original.manifest.artifactHash });
    assert.equal(await repo.readBack(conflicting.manifest.runId), null);
    assert.equal(recordOf((await repo.readBack(original.manifest.runId))!.rows), recordOf(original.rows));
    await repo.recordConflict(conflicting.manifest, { runId: original.manifest.runId, artifactHash: original.manifest.artifactHash });
    await repo.recordConflict(conflicting.manifest, { runId: original.manifest.runId, artifactHash: original.manifest.artifactHash });
    const conflicts = await repo.conflicts();
    assert.equal(conflicts.length, 1);   // Q15 is idempotent on its key
    assert.equal(conflicts[0]?.incomingArtifactHash, conflicting.manifest.artifactHash);
  });

  test(`${label}: dirty duplicates on one HEAD are conflict-exempt`, async () => {
    const repo = await make();
    const dirty = (bump: number) => inputFor('S2_n200_encore_s1.json', r => {
      r.git = `${String(r.git)}-dirty`;
      const s = r.summary as Record<string, number>;
      s.npwcEnd = (s.npwcEnd ?? 0) + bump;
    });
    const a = dirty(1e-12);
    const b = dirty(2e-12);
    assert.equal(a.manifest.experimentKey, b.manifest.experimentKey);
    assert.equal((await repo.importRun(a)).kind, 'imported');
    assert.equal((await repo.importRun(b)).kind, 'imported');
    assert.equal((await repo.listRuns({ limit: 10 })).runs.length, 2);
  });

  test(`${label}: a run whose checks fail is rolled back to zero rows`, async () => {
    const repo = await make();
    const input = inputFor('S1_n200_static_s1.json', undefined, { dt: 0.1 });   // CHECK dt_seconds = 0.05
    assert.deepEqual(await repo.importRun(input), { kind: 'failed', code: 'CHECK_FAILED' });
    assert.equal(await repo.readBack(input.manifest.runId), null);
    assert.deepEqual(await repo.listRuns({ limit: 10 }), { runs: [], next: null });
  });

  test(`${label}: verifications are append-only and readBack never aliases stored rows`, async () => {
    const repo = await make();
    const input = inputFor('S3_n200_encore_s1.json');
    await repo.importRun(input);
    const digests = { seriesDigest: input.manifest.seriesDigest, eventsDigest: input.manifest.eventsDigest, summaryDigest: input.manifest.summaryDigest };
    await repo.recordVerification(input.manifest.runId, digests, 'verified', 'v1');
    const first = await repo.verifications(input.manifest.runId);
    await repo.recordVerification(input.manifest.runId, digests, 'mismatch', 'v1');
    const both = await repo.verifications(input.manifest.runId);
    assert.deepEqual(both.slice(0, 1), first);
    assert.deepEqual(both.map(v => v.outcome), ['verified', 'mismatch']);
    await assert.rejects(repo.recordVerification('00000000-0000-5000-8000-000000000000', digests, 'verified', 'v1'));
    const stored = (await repo.readBack(input.manifest.runId))!;
    stored.rows.metrics[0]!.alive = -1;
    stored.run.scenario = 'S9';
    const again = (await repo.readBack(input.manifest.runId))!;
    assert.equal(again.rows.metrics[0]!.alive, input.rows.metrics[0]!.alive);
    assert.equal(again.run.scenario, 'S3');
  });

  test(`${label}: listRuns pages by run_id`, async () => {
    const repo = await make();
    const inputs = ['S0_n200_static_s2.json', 'S1_n200_static_s2.json', 'S3_n200_static_s2.json'].map(n => inputFor(n));
    for (const input of inputs) await repo.importRun(input);
    const ids = inputs.map(i => i.manifest.runId).sort();
    const first = await repo.listRuns({ limit: 2 });
    assert.deepEqual(first.runs.map(r => r.run_id), ids.slice(0, 2));
    assert.equal(first.next, ids[1]);
    const second = await repo.listRuns({ limit: 2, after: first.next });
    assert.deepEqual(second.runs.map(r => r.run_id), ids.slice(2));
    assert.equal(second.next, null);
    await assert.rejects(repo.listRuns({ limit: 0 }));
    await assert.rejects(repo.listRuns({ limit: 201 }));
  });
}

repositoryContract('fakeRepository', () => createFakeRepository(() => '2026-11-15T09:00:00.000Z'));
