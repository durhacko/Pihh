// GF-WP-11 (#214): run provenance and replay for generated scenes (src/cli/generated.ts), against every committed
// fixture scene in tests/fixtures/scenes/. No model, gateway or network: replay re-derives a formation from the
// stored scene and its provenance alone.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { makeParams } from '../../src/contracts';
import { compileWithProvenance, injectPreflight, isProvenance, provenanceFromCompile, replayFromProvenance, type GeneratedProvenance } from '../../src/cli/generated';
import { COMPILER_VERSION, compileGeneratedScene, type SceneSpec } from '../../src/score/generated';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sceneDir = resolve(root, 'tests/fixtures/scenes');
const fixtures = readdirSync(sceneDir).filter(f => f.endsWith('.json')).sort()
  .map(f => ({ file: f, scene: JSON.parse(readFileSync(resolve(sceneDir, f), 'utf8')) as SceneSpec }));
const valid = fixtures.filter(f => f.file.startsWith('valid-'));
const invalid = fixtures.filter(f => f.file.startsWith('invalid-'));
const N0S = [40, 200];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The fixtures that compile today at `n0` (2D waits for GF-WP-04 on some branches: those are typed rejections). */
function compiled(n0: number) {
  const params = makeParams(n0);
  return valid.map(f => ({ ...f, params, result: compileWithProvenance(f.scene, params, 'fixture', f.file) }));
}

describe('provenance from a compile', () => {
  for (const n0 of N0S) {
    it(`records sceneHash, compilerVersion, slotsDigest, n0, slotSpacingMin, title and source at n0 ${n0}`, () => {
      const all = compiled(n0);
      const ok = all.filter(c => c.result.ok);
      expect(ok.length).toBeGreaterThan(0);   // at least one committed scene compiles, so this is not vacuous
      for (const c of ok) {
        if (!c.result.ok) continue;
        const p = c.result.provenance;
        const direct = compileGeneratedScene(c.scene, c.params, n0);
        if (!direct.ok) throw new Error(c.file);
        expect(p).toEqual({ sceneHash: direct.sceneHash, compilerVersion: COMPILER_VERSION, slotsDigest: direct.slotsDigest, n0, slotSpacingMin: c.params.slotSpacingMin, title: c.scene.title, source: 'fixture', fixture: c.file });
        expect(isProvenance(clone(p))).toBe(true);
        expect(c.result.formation.slots).toHaveLength(n0);
      }
      for (const c of all.filter(x => !x.result.ok)) expect(c.result.ok ? '' : c.result.reason).toBe('rejected');   // never a substitute
    });
  }

  it('a rejected compile records no provenance; a live source carries no fixture id', () => {
    const params = makeParams(40);
    const rejected = compileGeneratedScene(valid[0]!.scene, params, 0);
    expect(rejected.ok).toBe(false);
    expect(provenanceFromCompile(valid[0]!.scene, rejected, params, 'fixture', 'x')).toBeNull();
    const c = compiled(40).find(x => x.result.ok)!;
    const live = provenanceFromCompile(c.scene, compileGeneratedScene(c.scene, params, 40), params, 'live', 'ignored');
    expect(live?.source).toBe('live');
    expect(live && 'fixture' in live).toBe(false);
  });
});

describe('replay re-derives the same formation from provenance alone', () => {
  for (const n0 of N0S) {
    it(`stored scene + stored provenance → the identical formation and digest at n0 ${n0}`, () => {
      for (const c of compiled(n0)) {
        if (!c.result.ok) continue;
        // As a run stores them: plain JSON, read back later, possibly by another process.
        const r = replayFromProvenance(clone(c.scene), clone(c.result.provenance));
        expect(r.ok, c.file).toBe(true);
        if (!r.ok) continue;
        expect(r.formation).toEqual(c.result.formation);
        expect(r.provenance).toEqual(c.result.provenance);
      }
    });
  }

  it('is deterministic across fresh module instances', async () => {
    const c = compiled(40).find(x => x.result.ok)!;
    if (!c.result.ok) throw new Error('no compiling fixture');
    vi.resetModules();
    const fresh = await import('../../src/cli/generated');
    const again = fresh.replayFromProvenance(clone(c.scene), clone(c.result.provenance));
    expect(again.ok && again.provenance.slotsDigest).toBe(c.result.provenance.slotsDigest);
  });
});

describe('replay refuses anything that is not the recorded scene', () => {
  const c = compiled(40).find(x => x.result.ok)!;
  if (!c.result.ok) throw new Error('no compiling fixture');
  const p: GeneratedProvenance = c.result.provenance;
  const reason = (scene: unknown, prov: unknown) => { const r = replayFromProvenance(scene, prov); return r.ok ? 'ok' : r.reason; };

  it('a tampered scene: hash-mismatch (a changed title is content too)', () => {
    expect(reason({ ...clone(c.scene), title: `${c.scene.title} edited` }, p)).toBe('hash-mismatch');
  });
  it('another compiler version: compiler-mismatch', () => {
    expect(reason(clone(c.scene), { ...p, compilerVersion: COMPILER_VERSION + 1 })).toBe('compiler-mismatch');
  });
  it('a wrong digest: digest-mismatch', () => {
    expect(reason(clone(c.scene), { ...p, slotsDigest: '0'.repeat(64) })).toBe('digest-mismatch');
  });
  it('an invalid scene: scene-invalid, for every committed invalid fixture', () => {
    expect(invalid.length).toBeGreaterThan(5);
    for (const f of invalid) expect(reason(f.scene, p), f.file).toBe('scene-invalid');
  });
  it('a malformed provenance record: provenance-invalid', () => {
    for (const bad of [null, {}, { ...p, sceneHash: 'XYZ' }, { ...p, n0: 0 }, { ...p, source: 'gemini' }, { ...p, slotSpacingMin: -1 }, [p]]) {
      expect(reason(clone(c.scene), bad)).toBe('provenance-invalid');
    }
  });
});

describe('injectPreflight (GF-WP-11 step 1)', () => {
  it('at the recorded parameters it is replay; at another n0 the scene must still hash and compile', () => {
    const c = compiled(40).find(x => x.result.ok)!;
    if (!c.result.ok) throw new Error('no compiling fixture');
    const same = injectPreflight(clone(c.scene), c.result.provenance, makeParams(40));
    expect(same.ok && same.provenance).toEqual(c.result.provenance);
    const other = injectPreflight(clone(c.scene), c.result.provenance, makeParams(200));
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(other.provenance.n0).toBe(200);
      expect(other.provenance.sceneHash).toBe(c.result.provenance.sceneHash);
      expect(other.provenance.slotsDigest).not.toBe(c.result.provenance.slotsDigest);   // a digest is per n0
      expect(other.formation.slots).toHaveLength(200);
    }
    const tampered = injectPreflight({ ...clone(c.scene), title: 'other' }, c.result.provenance, makeParams(200));
    expect(tampered.ok ? 'ok' : tampered.reason).toBe('hash-mismatch');
  });
});

describe('src/cli/generated.ts is pure', () => {
  it('imports only src/contracts, src/score/generated and src/score/canonical; no Node built-ins, DOM, clock, randomness or network', () => {
    const file = 'src/cli/generated.ts';
    const source = readFileSync(resolve(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    const banned: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) banned.push('dynamic import');
      if (ts.isIdentifier(node) && ['require', 'process', 'window', 'document', 'fetch', 'Date', 'performance', 'globalThis'].includes(node.text)) banned.push(node.text);
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math' && node.name.text === 'random') banned.push('Math.random');
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(banned).toEqual([]);
    for (const spec of imports) {
      expect(spec.startsWith('.'), spec).toBe(true);
      expect(['src/contracts', 'src/score/generated', 'src/score/canonical'], spec).toContain(relative(root, resolve(root, dirname(file), spec)).replaceAll('\\', '/'));
    }
  });
});
