// FE-C #91 (UI-07, DESIGN §8.3): Inspector.ts and SelectionLayer.ts never import WorldSnapshot, and never reach
// src/agent (or the world / observer implementations), directly or through anything they import.
//
// One documented exception: SelectionLayer is a Layer, and the shared Layer interface (Layer.ts, which FE-C may not
// edit) hands every layer a render frame typed through SnapshotBuffer.ts. That path is allowed by name below, and
// selectionAndTethers.test.ts proves at runtime that SelectionLayer reads only the selected drone from that frame.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FORBIDDEN_DIRS = ['src/agent', 'src/sim', 'src/observer'];
/** The contracts define WorldSnapshot; importing other contract types from them is the shared vocabulary, not a leak. */
const CONTRACTS = 'src/contracts';
const LAYER_INTERFACE = ['src/app/render/Layer.ts', 'src/app/render/SnapshotBuffer.ts'];
const GUARDED: [string, string[]][] = [['src/app/ui/Inspector.ts', []], ['src/app/render/layers/SelectionLayer.ts', LAYER_INTERFACE]];

/** Every module specifier in a source file (static, re-export, dynamic, require, import type), and every WorldSnapshot mention. */
function scan(source: string, filename: string): { specifiers: string[]; worldSnapshot: string[] } {
  const specifiers: string[] = [];
  const worldSnapshot: string[] = [];
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const add = (node: ts.Node | undefined) => { if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text); else specifiers.push('<non-literal>'); };
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node)) add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
    if (ts.isIdentifier(node) && node.text === 'WorldSnapshot') worldSnapshot.push(`${filename}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { specifiers, worldSnapshot };
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;   // packages (three) are not part of the app's own graph
  const base = resolve(root, dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, resolve(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return relative(root, candidate).replaceAll('\\', '/');
  }
  throw new Error(`${fromFile}: cannot resolve ${specifier}`);
}

/**
 * Walks the local import graph from `entry`. Reports edges into forbidden directories, and every WorldSnapshot
 * mention in a reached module outside the contracts and outside `allowed`.
 */
function reach(entry: string, allowed: readonly string[] = []): { modules: Set<string>; forbidden: string[]; snapshot: string[] } {
  const modules = new Set<string>();
  const forbidden: string[] = [];
  const snapshot: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const scanned = scan(readFileSync(resolve(root, file), 'utf8'), file);
    if (!file.startsWith(`${CONTRACTS}/`) && !allowed.includes(file)) snapshot.push(...scanned.worldSnapshot);
    for (const specifier of scanned.specifiers) {
      if (specifier === '<non-literal>') { forbidden.push(`${file}: non-literal import`); continue; }
      const target = resolveLocal(file, specifier);
      if (!target) continue;
      if (FORBIDDEN_DIRS.some(dir => target === dir || target.startsWith(`${dir}/`))) forbidden.push(`${file} -> ${target}`);
      queue.push(target);
    }
  }
  return { modules, forbidden, snapshot };
}

describe('inspector and selection isolation (UI-07)', () => {
  it.each(GUARDED)('%s never names WorldSnapshot, directly or through its imports', (file, allowed) => {
    expect(scan(readFileSync(resolve(root, file), 'utf8'), file).worldSnapshot).toEqual([]);
    expect(reach(file, allowed).snapshot).toEqual([]);
  });

  it.each(GUARDED)('%s never reaches src/agent, src/sim or src/observer, even transitively', file => {
    const { modules, forbidden } = reach(file);
    expect(forbidden).toEqual([]);
    expect(modules.has(file)).toBe(true);
  });

  it('the Inspector needs no exception at all, and never reaches the truth builder', () => {
    const inspector = reach('src/app/ui/Inspector.ts');
    expect(inspector.snapshot).toEqual([]);
    expect(LAYER_INTERFACE.some(file => inspector.modules.has(file))).toBe(false);
    expect(inspector.modules.has('src/app/ui/inspectorTruth.ts')).toBe(false);
  });

  it('the checker is not vacuous: it catches each forbidden form, directly and through the graph', () => {
    for (const source of [
      "import type { WorldSnapshot } from '../../contracts';",
      "type S = import('../../contracts').WorldSnapshot;",
      'function f(s: WorldSnapshot) { return s; }',
    ]) expect(scan(source, 'src/app/ui/Inspector.ts').worldSnapshot.length).toBeGreaterThan(0);
    expect(scan('const m = import(path);', 'src/app/ui/Inspector.ts').specifiers).toEqual(['<non-literal>']);
    expect(resolveLocal('src/app/ui/Inspector.ts', '../../agent/staticBrain')).toBe('src/agent/staticBrain.ts');
    // Through the graph: any other layer reaches the snapshot type via the Layer interface, and worlds.ts reaches
    // the brain, the world and the observer.
    expect(reach('src/app/render/layers/TetherLayer.ts').snapshot.length).toBeGreaterThan(0);
    expect(reach('src/app/ui/inspectorTruth.ts').snapshot.length).toBeGreaterThan(0);
    const worlds = reach('src/app/worlds.ts').forbidden.join('\n');
    for (const dir of FORBIDDEN_DIRS) expect(worlds).toContain(` -> ${dir}/`);
  });
});
