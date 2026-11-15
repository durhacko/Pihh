// MDB-WP-02 (#230), extends MDB-T09: src/app/compose/validate.ts is pure, so the optional gateway can import it by
// relative path (XI-2, XI-13). Transitive import scan: every module it reaches must be under src/contracts or src/score
// (src/score/font and src/score/canonical included), with no bare package (three, mongodb, …), no node:*, no dynamic
// import or require, and no DOM, network or process globals. The negative control shows the scan does catch
// commands.ts reaching src/app/actions and src/sim.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BANNED_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'require', 'Buffer', '__dirname', 'globalThis'];
const ALLOWED_DIRS = ['src/contracts/', 'src/score/'];

function resolveModule(fromFile: string, spec: string): string | null {
  const base = resolve(root, dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) if (existsSync(candidate) && candidate.endsWith('.ts')) return relative(root, candidate).replaceAll('\\', '/');
  return null;
}

/** Walks the import graph from `entry`; returns every reached file and every problem found. */
function scan(entry: string): { files: string[]; problems: string[] } {
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const ast = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const follow = (spec: ts.Node | undefined) => {
      if (!spec || !ts.isStringLiteralLike(spec)) { problems.push(`${file}: non-literal module specifier`); return; }
      const text = spec.text;
      if (!text.startsWith('.')) { problems.push(`${file}: package import ${text}`); return; }
      const target = resolveModule(file, text);
      if (!target) { problems.push(`${file}: unresolved ${text}`); return; }
      queue.push(target);
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) follow(node.moduleSpecifier);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) follow(node.argument.literal);
      if (ts.isImportEqualsDeclaration(node)) problems.push(`${file}: import =`);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`${file}: dynamic import`);
      if (ts.isIdentifier(node) && BANNED_GLOBALS.includes(node.text)) problems.push(`${file}: global ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const files = [...seen].sort();
  for (const f of files) if (f !== entry && !ALLOWED_DIRS.some(d => f.startsWith(d))) problems.push(`reaches ${f}`);
  return { files, problems };
}

describe('src/app/compose/validate.ts is pure (XI-2, XI-13)', () => {
  it('reaches only src/contracts and src/score: no three, node:*, network, DOM, src/sim, src/app/actions or src/app/ui', () => {
    const { files, problems } = scan('src/app/compose/validate.ts');
    expect(problems).toEqual([]);
    expect(files).toContain('src/score/font.ts');
    expect(files).toContain('src/score/expand.ts');
    expect(files.some(f => /src\/(sim|agent|observer|cli|app\/(actions|ui|render))/.test(f))).toBe(false);
  });

  it('negative control: the same scan flags commands.ts, which reaches src/app/actions and src/sim', () => {
    const { files, problems } = scan('src/app/ui/commands.ts');
    expect(files).toContain('src/app/actions.ts');
    expect(files.some(f => f.startsWith('src/sim/'))).toBe(true);
    expect(problems.some(p => p === 'reaches src/app/actions.ts')).toBe(true);
  });

  it('commands.ts keeps only an import and a re-export of the moved validateText and TEXT_MAX', () => {
    const source = readFileSync(resolve(root, 'src/app/ui/commands.ts'), 'utf8');
    expect(source).not.toMatch(/export (const TEXT_MAX|function validateText)/);
    expect(source).toContain("export { TEXT_MAX, validateText } from '../compose/validate';");
  });
});
