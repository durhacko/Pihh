// MDB-WP-03 (#241): the XI-2 import allow-list for the shows module (MDB-T09's gateway half).
// - Only src/shows/validate.ts leaves the gateway, and only to src/app/compose/validate.ts, src/score/canonical.ts and
//   src/contracts/params.ts; its one built-in is node:crypto { createHash }.
// - Every other shows file imports only shows files and the skeleton's config, errors and module.
// - Transitively, those app files reach only src/contracts, src/score and src/app/compose/validate.ts: never src/agent,
//   src/sim, src/observer, src/cli, the rest of src/app, three, a node built-in or a DOM global.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gateway = resolve(here, '../..');
const repo = resolve(gateway, '../..');
const showsDir = join(gateway, 'src/shows');

const BRIDGE = 'validate.ts';
const SRC_TARGETS = ['src/app/compose/validate.ts', 'src/score/canonical.ts', 'src/contracts/params.ts'];
const SKELETON = ['src/config.ts', 'src/errors.ts', 'src/module.ts'];

/**
 * Every static specifier, from raw text (comments cannot hide one): `import`/`export ... from` statements AND bare
 * side-effect imports (`import './x.ts'`), which load a module just the same. The statement is kept for name checks.
 */
function specifiers(text: string): { spec: string; statement: string }[] {
  const from = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm)];
  const bare = [...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)];
  return [...from, ...bare].map(m => ({ spec: m[1] ?? '', statement: m[0] }));
}

const toRepo = (file: string) => relative(repo, file).replaceAll('\\', '/');
const toGateway = (file: string) => relative(gateway, file).replaceAll('\\', '/');

/** Resolves a relative specifier as the gateway's loader does for src/: as written, then .ts, then /index.ts. */
function resolveSpec(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${toRepo(from)}: cannot resolve ${spec}`);
}

/** Every .ts file under src/shows, at any depth, so a file in a subfolder cannot escape the scan. */
const showsFiles = (readdirSync(showsDir, { recursive: true }) as string[])
  .filter(n => n.endsWith('.ts')).map(n => join(showsDir, n));

test('the scanner sees side-effect imports and imports split over lines', () => {
  const found = specifiers("import './a.ts';\nimport {\n  b,\n} from '../b.ts';\nexport * from 'node:c';\n").map(s => s.spec).sort();
  assert.deepEqual(found, ['../b.ts', './a.ts', 'node:c']);
});

test('the shows folder has the files this package owns, at any depth', () => {
  assert.deepEqual(showsFiles.map(f => toGateway(f)).sort(), [
    'src/shows/body.ts', 'src/shows/errorMap.ts', 'src/shows/memoryRepository.ts', 'src/shows/module.ts', 'src/shows/repository.ts',
    'src/shows/routes.ts', 'src/shows/types.ts', 'src/shows/validate.ts',
  ]);
});

test('only validate.ts leaves the gateway, and only to the XI-2 targets; its one built-in is node:crypto { createHash }', () => {
  for (const file of showsFiles) {
    const name = toGateway(file);
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\bimport\s*\(|\brequire\s*\(/.test(text), `${name}: dynamic import or require`);
    for (const { spec, statement } of specifiers(text)) {
      if (spec.startsWith('node:')) {
        assert.equal(name, `src/shows/${BRIDGE}`, `${name} imports ${spec}`);
        assert.equal(spec, 'node:crypto');
        assert.match(statement, /^\s*import\s*\{\s*createHash\s*\}\s*from/);
        continue;
      }
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${name} imports ${spec}`);
      assert.ok(spec.endsWith('.ts'), `${name}: ${spec} needs its .ts extension`);
      const target = resolveSpec(file, spec);
      const inGateway = toGateway(target);
      if (inGateway.startsWith('src/shows/')) continue;
      if (SKELETON.includes(inGateway)) continue;
      assert.equal(name, `src/shows/${BRIDGE}`, `${name} reaches ${toRepo(target)}: only the bridge may leave the module`);
      assert.ok(SRC_TARGETS.includes(toRepo(target)), `${name} reaches ${toRepo(target)}, outside the XI-2 allow-list`);
    }
  }
});

test('transitively, the app files the bridge reaches stay in src/contracts, src/score and src/app/compose/validate.ts', () => {
  const seen = new Set<string>();
  const queue = SRC_TARGETS.map(t => join(repo, t));
  const allowed = (path: string) => path.startsWith('src/contracts/') || path.startsWith('src/score/') || path === 'src/app/compose/validate.ts';
  while (queue.length > 0) {
    const file = queue.pop() as string;
    const path = toRepo(file);
    if (seen.has(path)) continue;
    seen.add(path);
    assert.ok(allowed(path), `reached ${path}`);
    const text = readFileSync(file, 'utf8');
    const codeOnly = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    for (const global of ['window', 'document', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket']) {
      assert.ok(!new RegExp(`\\b${global}\\b`).test(codeOnly), `${path} uses ${global}`);
    }
    assert.ok(!/\bimport\s*\(|\brequire\s*\(/.test(codeOnly), `${path}: dynamic import or require`);
    for (const { spec } of specifiers(text)) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${path} imports ${spec} (a package or a node built-in)`);
      queue.push(resolveSpec(file, spec));
    }
  }
  assert.ok(seen.has('src/app/compose/validate.ts') && seen.has('src/score/expand.ts') && seen.has('src/contracts/params.ts'), [...seen].join(', '));
  for (const path of seen) assert.ok(!/^src\/(agent|sim|observer|cli)\//.test(path) && !/^src\/app\/(?!compose\/validate\.ts$)/.test(path), path);
});
