// TIG-02 identity (RFC §4) and manifest (RFC §5): TIG-T08, T09 and the offline half of T12, over the REAL
// committed RunRecords in results/ (read-only). The pinned hex values were computed independently of this module
// (node:crypto plus a separate canonical-JSON implementation, cross-checked byte for byte against
// src/score/canonical.ts over all 420 records) and match the RFC §4.4 prefixes for the 571c8e4 set.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_TICKS } from '../../src/cli/scenarios';
import { canonicalJson } from '../../src/score/canonical';
import type { RunRecord } from '../../src/contracts/metrics';
import {
  advisoryLockKey, buildManifest, computeIdentity, experimentKeyOf, FIRST_OBSERVATION_FIELDS, IDENTITY_FIELDS, isFairPair,
  manifestFileName, manifestMismatches,
  normaliseArtifactPath, pairKeyOf, scenarioCompositionId, validateRunRecord, VALIDATOR_VERSION, type RunIdentity, type Sha256,
} from '../../src/telemetry';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');
const CTX = { sourceKind: 'cli-scenario' as const, expectedTicks: SCENARIO_TICKS };
const sha256: Sha256 = data => createHash('sha256').update(data).digest('hex');
const SETS = ['', 'full/n200', 'full/n100', 'superseded-571c8e4'];

function load(path: string): { bytes: Uint8Array; record: RunRecord } {
  const bytes = new Uint8Array(readFileSync(join(RESULTS, path)));
  const result = validateRunRecord(bytes, CTX);
  if (!result.ok) throw new Error(`${path} does not validate`);
  return { bytes, record: result.record };
}
function identityOf(path: string): RunIdentity {
  const { bytes, record } = load(path);
  return computeIdentity(record, bytes, scenarioCompositionId(record), sha256);
}
const ALL = SETS.flatMap(set => readdirSync(join(RESULTS, set)).filter(n => /^S\d_n\d+_(encore|static)_s\d+\.json$/.test(n)).sort().map(n => (set ? `${set}/${n}` : n)));

/** Full vectors for the 0b2f8f3 freeze (results/ top level). */
const CURRENT = {
  'S0_n200_encore_s1.json': {
    fileBytes: 109_386,
    fileSha256: '52daabead13e76cc7ca9646a3cd36f7b908e28348d3dc9770f30d2a4b736b56c',
    artifactHash: 'a57f6103f79b604512c090862f7573be22c9545469d816ee04880ee2cfd12978',
    seriesDigest: 'cb8e21fd681508b9c27c7462644314f1560939fb776f799a4409e4f93aff8ea5',
    eventsDigest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    summaryDigest: '6e0b499a76bf7cd1991045ffa956a53ce9062c06ebe43e0038128b67a20d4455',
    experimentKey: '8cd5bd9e811bba00526905d8e25c8b7bcafdaa930c27f1a4cfd8d7797d5acc60',
    pairKey: '1c35aa7d34f3002d787207a6dc76c461856cc18fede5b55bbe4a969cb1091c89',
  },
  'S2_n200_encore_s1.json': {
    fileBytes: 110_281,
    fileSha256: '5d58946216368974c22f6062174b6e82125b53605db0374063ecc99945499543',
    artifactHash: '79265e5ab8432b68487f1e99f36cb7bb871d8a51a536390e82658f1ebd1fe4a2',
    seriesDigest: '6e5858d7f060bbfbfa2124f2c25db0db1032450e1be8527366d993c9c62db9a9',
    eventsDigest: 'a4704e45ffe925fd7d35e3f0977ee401cb866e2929f4133f67958ef7cefea7fe',
    summaryDigest: '496a45c28583e328cc860dc45bcc01762e1c40c0a92c89a18c9a87c54d79fbf1',
    experimentKey: '246d7f8de33238e301cf67d9b404e97aca7aebc19185cad26fd6c45906cd6514',
    pairKey: '2cf3f0cc12402ee3098d830bd7b7d5f671417b3242b9094cfe198e4f025240a2',
  },
  'S2_n200_static_s1.json': {
    fileBytes: 104_324,
    fileSha256: '196dc32a619cbd1b387e3737ede25dacdc9d1ca05ef1ae130d3c318c5c29d8bd',
    artifactHash: 'f50955bfd5f7a5aa0fd18b41c2e51326c4da3fa3ad1dfae4429ed96cb0dc6c8f',
    seriesDigest: '245d6bdc816011feb0c7419bb7f2221aeadc45d0656a23a1b9f4781b6af6cfc9',
    eventsDigest: 'a4704e45ffe925fd7d35e3f0977ee401cb866e2929f4133f67958ef7cefea7fe',
    summaryDigest: 'f01b86aa17ea3881c89229e46892118fd2033eac03c916a9fc887e6dca3c5773',
    experimentKey: 'b18a23c35c666a3ad4fa43bf0a6559454119691c1bf2f99eddd673c24e34effa',
    pairKey: '2cf3f0cc12402ee3098d830bd7b7d5f671417b3242b9094cfe198e4f025240a2',
  },
};

/** RFC §4.4 (FX-PAIR) and the TIG-02 S0 prefix: computed on the 571c8e4 records, now in results/superseded-571c8e4/. */
const RFC_44 = {
  'superseded-571c8e4/S2_n200_encore_s1.json': {
    fileBytes: 110_281,
    fileSha256: '8539d03d89ac66d1ccd69e86df4fa8247ac67827cdb72787dd9d4565b15a4c9b',
    artifactHash: '0b35b281cdb361bd01ff9e7aa06a4ab03ee206dca5fd2928cecd1dd064370e76',
    seriesDigest: '6e5858d7f060bbfbfa2124f2c25db0db1032450e1be8527366d993c9c62db9a9',
    eventsDigest: 'a4704e45ffe925fd7d35e3f0977ee401cb866e2929f4133f67958ef7cefea7fe',
    summaryDigest: '496a45c28583e328cc860dc45bcc01762e1c40c0a92c89a18c9a87c54d79fbf1',
    experimentKey: '8a55cda8450d81045ea26c9a6a2919eea0319556ae0b6c13fce609877ae31409',
    pairKey: 'f660290359fee12f9517dd20d8c3b0ece99ad661c3a325615eabad2843ead376',
  },
  'superseded-571c8e4/S2_n200_static_s1.json': {
    fileBytes: 104_324,
    fileSha256: '189110d543deed44017a70b945944ffb482291a119f98ba216116aa7e3073bdc',
    artifactHash: '35ac712886627df56978d66249d38f8bcf69815938ee1b98391d3cee259eeeb7',
    seriesDigest: '245d6bdc816011feb0c7419bb7f2221aeadc45d0656a23a1b9f4781b6af6cfc9',
    eventsDigest: 'a4704e45ffe925fd7d35e3f0977ee401cb866e2929f4133f67958ef7cefea7fe',
    summaryDigest: 'f01b86aa17ea3881c89229e46892118fd2033eac03c916a9fc887e6dca3c5773',
    experimentKey: '3a078cb7d94f3ef6504a8b7695e45e2849bed4ea5dae0222c32d7fed2abee079',
    pairKey: 'f660290359fee12f9517dd20d8c3b0ece99ad661c3a325615eabad2843ead376',
  },
};

describe('T08: identity hashes', () => {
  it('reproduces the pinned vectors for the current freeze (0b2f8f3)', () => {
    for (const [path, want] of Object.entries(CURRENT)) expect(identityOf(path), path).toMatchObject({ ...want, hashVersion: 1, gitClean: true });
  });

  it('reproduces the RFC §4.4 vectors in full, and the TIG-02 S0 prefix, on the 571c8e4 records they describe', () => {
    for (const [path, want] of Object.entries(RFC_44)) expect(identityOf(path), path).toMatchObject(want);
    // RFC §4.4 printed prefixes and suffixes
    const e = identityOf('superseded-571c8e4/S2_n200_encore_s1.json');
    expect(e.artifactHash.startsWith('0b35b281cdb361bd') && e.artifactHash.endsWith('0e76')).toBe(true);
    expect(e.experimentKey.startsWith('8a55cda8450d8104') && e.experimentKey.endsWith('1409')).toBe(true);
    expect(e.pairKey?.startsWith('f660290359fee12f') && e.pairKey.endsWith('d376')).toBe(true);
    expect(identityOf('superseded-571c8e4/S0_n200_encore_s1.json').artifactHash.startsWith('43338607c7be88f2')).toBe(true);
  });

  it('gives fileSha256 ≠ artifactHash for every real record (TCR-13), deterministically', () => {
    for (const path of ALL) {
      const a = identityOf(path);
      expect(a.fileSha256).not.toBe(a.artifactHash);
      expect(identityOf(path)).toEqual(a);
    }
  }, 120_000);

  it('keeps artifactHash for re-serialised and key-permuted copies (FX-RESER), but changes fileSha256', () => {
    const { bytes, record } = load('S0_n200_encore_s1.json');
    const reser = new TextEncoder().encode(canonicalJson(record));
    const reversed = (v: unknown): unknown => Array.isArray(v) ? v.map(reversed)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;
    const permuted = new TextEncoder().encode(JSON.stringify(reversed(record)));
    const base = computeIdentity(record, bytes, 'scenario:S0', sha256);
    for (const copy of [reser, permuted]) {
      const result = validateRunRecord(copy, CTX);
      expect(result.ok && result.fileForm).toBe('other');
      if (!result.ok) continue;
      const id = computeIdentity(result.record, copy, 'scenario:S0', sha256);
      expect(id.artifactHash).toBe(base.artifactHash);
      expect(id.experimentKey).toBe(base.experimentKey);
      expect(id.fileSha256).not.toBe(base.fileSha256);
    }
  });

  it('pairs: every real pair shares pairKey; pairKeys are distinct across pairs within a set', () => {
    for (const set of SETS) {
      const byPair = new Map<string, string[]>();
      for (const path of ALL.filter(p => (set ? p.startsWith(`${set}/`) : !p.includes('/')))) {
        const id = identityOf(path);
        const name = path.replace(/_(encore|static)_/, '_');
        byPair.set(name, [...(byPair.get(name) ?? []), id.pairKey!]);
      }
      const keys = [...byPair.values()];
      for (const pair of keys) expect(new Set(pair).size).toBe(1);
      expect(new Set(keys.map(k => k[0])).size).toBe(keys.length);
    }
  }, 120_000);

  it('changes pairKey when seed, n0, git, paramsHash, any event field or the composition changes', () => {
    const { record } = load('S2_n200_encore_s1.json');
    const key = (r: RunRecord, c: string | null = 'scenario:S2') => pairKeyOf(r, c, sha256);
    const base = key(record);
    const kill = record.events[0] as { type: 'KILL'; tick: number; ids: number[] };
    const variants: [string, string | null][] = [
      ['seed', key({ ...record, seed: 2 })],
      ['n0', key({ ...record, n0: 199 })],
      ['git', key({ ...record, git: '0'.repeat(40) })],
      ['paramsHash', key({ ...record, paramsHash: '0'.repeat(64) })],
      ['event tick', key({ ...record, events: [{ ...kill, tick: 401 }] })],
      ['event ids', key({ ...record, events: [{ ...kill, ids: [...kill.ids].reverse() }] })],
      ['composition', key(record, 'sceneHash:' + 'a'.repeat(64))],
    ];
    for (const [what, changed] of variants) expect(changed, what).not.toBe(base);
    expect(key({ ...record, arm: 'static' })).toBe(base);
    expect(experimentKeyOf({ ...record, arm: 'static' }, 'scenario:S2', sha256)).not.toBe(experimentKeyOf(record, 'scenario:S2', sha256));
  });

  it('computes Q2 lock keys as in RFC §9 / T08', () => {
    expect(advisoryLockKey(RFC_44['superseded-571c8e4/S2_n200_encore_s1.json'].experimentKey)).toBe(-8478644600858377980n);
    expect(advisoryLockKey(RFC_44['superseded-571c8e4/S2_n200_static_s1.json'].experimentKey)).toBe(4181465500289548022n);
    expect(() => advisoryLockKey('xyz')).toThrow();
  });

  it('rejects a sha256 injection that does not return 64 lower-case hex', () => {
    const { bytes, record } = load('S0_n200_encore_s1.json');
    expect(() => computeIdentity(record, bytes, 'scenario:S0', () => 'ABC')).toThrow();
  });
});

describe('T09: weak provenance', () => {
  it('gives gitClean false for -dirty and unknown git; two different dirty records on one HEAD share an experimentKey', () => {
    const { bytes, record } = load('S2_n200_encore_s1.json');
    const dirty = { ...record, git: `${record.git}-dirty` };
    const otherDirty = { ...dirty, summary: { ...dirty.summary, npwcEnd: 0.5 }, stateHash: '0'.repeat(16) };
    const a = computeIdentity(dirty, bytes, 'scenario:S2', sha256);
    const b = computeIdentity(otherDirty, bytes, 'scenario:S2', sha256);
    expect([a.gitClean, b.gitClean]).toEqual([false, false]);
    expect(a.experimentKey).toBe(b.experimentKey);   // why dirty runs are conflict-exempt (RFC §4.3)
    expect(a.artifactHash).not.toBe(b.artifactHash);
    expect(a.pairKey).not.toBeNull();                // a dirty record keeps its pairKey
    expect(computeIdentity({ ...record, git: 'unknown' }, bytes, 'scenario:S2', sha256).gitClean).toBe(false);
  });

  it('with no composition identity: storable, pairKey null, never a fair pair', () => {
    const { bytes, record } = load('S2_n200_encore_s1.json');
    const id = computeIdentity(record, bytes, null, sha256);
    expect(id.pairKey).toBeNull();
    expect(id.compositionId).toBeNull();
    expect(isFairPair({ ...id, arm: 'encore' }, { ...id, arm: 'static' })).toBe(false);
    expect(() => computeIdentity(record, bytes, 'scenario:S2; DROP TABLE', sha256)).toThrow();
  });

  it('FX-CONFLICT: one summary value changed keeps experimentKey and changes artifactHash', () => {
    const { bytes, record } = load('S2_n200_encore_s1.json');
    const conflict = { ...record, summary: { ...record.summary, npwcEnd: (record.summary.npwcEnd as number) + 1e-12 } };
    const a = computeIdentity(record, bytes, 'scenario:S2', sha256);
    const b = computeIdentity(conflict, bytes, 'scenario:S2', sha256);
    expect(b.experimentKey).toBe(a.experimentKey);
    expect(b.artifactHash).not.toBe(a.artifactHash);
  });
});

describe('manifest (RFC §5; offline half of T12)', () => {
  const init = { artifactPath: 'results/S2_n200_encore_s1.json', runId: '6f0f3c1e-0b1a-5c3d-8e2f-1a2b3c4d5e6f', sourceKind: 'cli-scenario' as const, validatorVersion: VALIDATOR_VERSION, fileForm: 'cli-writer' as const, dtSeconds: 0.05, createdAt: '2026-11-15T03:00:00.000Z' };

  it('builds the RFC §5 manifest from a real record', () => {
    const m = buildManifest(identityOf('S2_n200_encore_s1.json'), init);
    expect(m).toMatchObject({
      manifestVersion: 1, hashVersion: 1, validatorVersion: '1.0.0', fileBytes: 110_281, fileForm: 'cli-writer', gitClean: true,
      compositionId: 'scenario:S2', sourceKind: 'cli-scenario', dtSeconds: 0.05, expectedSamples: 360, eventCount: 1,
      artifactHash: CURRENT['S2_n200_encore_s1.json'].artifactHash,
    });
  });

  it('reuses the manifest for FX-RESER, FX-MOVED and a pretty-printed copy (first-observation fields never compared)', () => {
    const { bytes, record } = load('S0_n200_encore_s1.json');
    const first = buildManifest(computeIdentity(record, bytes, 'scenario:S0', sha256), { ...init, artifactPath: 'results/S0_n200_encore_s1.json' });
    const copies = [
      { bytes: new TextEncoder().encode(canonicalJson(record)), path: 'scratch/reser.json', form: 'other' as const },
      { bytes, path: 'elsewhere/moved/copy.json', form: 'cli-writer' as const },
      { bytes: new TextEncoder().encode(JSON.stringify(record, null, 2)), path: 'pretty.json', form: 'other' as const },
    ];
    for (const copy of copies) {
      const again = buildManifest(computeIdentity(record, copy.bytes, 'scenario:S0', sha256), { ...init, artifactPath: copy.path, fileForm: copy.form, createdAt: '2026-11-16T00:00:00Z' });
      expect(manifestMismatches(first, again)).toEqual([]);
    }
  });

  it('reports MANIFEST_MISMATCH fields when an identity field differs', () => {
    const a = buildManifest(identityOf('S2_n200_encore_s1.json'), init);
    expect(manifestMismatches(a, { ...a, compositionId: 'scenario:S1', dtSeconds: 0.1 })).toEqual(['compositionId', 'dtSeconds']);
  });

  it('splits fields exactly as RFC §5: each identity field is compared, each first-observation field is not', () => {
    expect([...IDENTITY_FIELDS].sort()).toEqual(['artifactHash', 'compositionId', 'dtSeconds', 'eventCount', 'eventsDigest', 'expectedSamples', 'experimentKey', 'gitClean', 'hashVersion', 'pairKey', 'runId', 'seriesDigest', 'sourceKind', 'summaryDigest']);
    expect([...FIRST_OBSERVATION_FIELDS].sort()).toEqual(['artifactPath', 'createdAt', 'fileBytes', 'fileForm', 'fileSha256']);
    const a = buildManifest(identityOf('S2_n200_encore_s1.json'), init) as unknown as Record<string, unknown>;
    const flip = (v: unknown) => (typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1 : `${String(v)}x`);
    for (const f of IDENTITY_FIELDS) expect(manifestMismatches(a as never, { ...a, [f]: flip(a[f]) } as never), f).toEqual([f]);
    for (const f of FIRST_OBSERVATION_FIELDS) expect(manifestMismatches(a as never, { ...a, [f]: flip(a[f]) } as never), f).toEqual([]);
  });

  it('isFairPair needs equal non-null pairKeys and different arms', () => {
    const id = identityOf('S2_n200_encore_s1.json');
    expect(isFairPair({ ...id, arm: 'encore' }, { ...id, arm: 'static' })).toBe(true);
    expect(isFairPair({ ...id, arm: 'encore' }, { ...id, arm: 'encore' })).toBe(false);
    expect(isFairPair({ ...id, arm: 'encore' }, { ...identityOf('S2_n200_static_s2.json'), arm: 'static' })).toBe(false);
  });

  it('refuses hostile artifact paths (T33 strings) and accepts repo-relative ones', () => {
    for (const bad of ['../../x', 'results/../../x', '\\\\h\\s\\x.json', '/etc/passwd', '~/x.json', 'C:/x.json', 'a b.json', '']) {
      expect(normaliseArtifactPath(bad), bad).toBeNull();
      expect(() => buildManifest(identityOf('S2_n200_encore_s1.json'), { ...init, artifactPath: bad })).toThrow();
    }
    expect(normaliseArtifactPath('results\\full\\n200\\S0_n200_encore_s1.json')).toBe('results/full/n200/S0_n200_encore_s1.json');
  });

  it('validates runId, validatorVersion, createdAt and dtSeconds, and names manifest files', () => {
    const id = identityOf('S2_n200_encore_s1.json');
    expect(() => buildManifest(id, { ...init, runId: 'not-a-uuid' })).toThrow();
    expect(() => buildManifest(id, { ...init, validatorVersion: '1' })).toThrow();
    expect(() => buildManifest(id, { ...init, createdAt: 'yesterday' })).toThrow();
    expect(() => buildManifest(id, { ...init, dtSeconds: 0 })).toThrow();
    expect(manifestFileName(id.artifactHash)).toBe(`manifests/${id.artifactHash}.manifest.json`);
    expect(manifestFileName(id.artifactHash, '1.1.0')).toBe(`manifests/${id.artifactHash}.v1.1.0.manifest.json`);
  });
});

describe('inputs are never mutated', () => {
  it('computeIdentity and buildManifest work on deep-frozen records', () => {
    const { bytes, record } = load('S5_n200_encore_s1.json');
    const freeze = (v: unknown): unknown => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
    const before = canonicalJson(record);
    freeze(record);
    const id = computeIdentity(record, bytes, 'scenario:S5', sha256);
    buildManifest(id, { artifactPath: 'results/S5_n200_encore_s1.json', runId: '6f0f3c1e-0b1a-5c3d-8e2f-1a2b3c4d5e6f', sourceKind: 'cli-scenario', validatorVersion: VALIDATOR_VERSION, fileForm: 'cli-writer', dtSeconds: 0.05, createdAt: '2026-11-15T03:00:00Z' });
    expect(canonicalJson(record)).toBe(before);
  });
});
